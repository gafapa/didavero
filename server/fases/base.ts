import { ENGINE_NAMES } from '../../shared/engines';
// Base del flujo: dependencias, lanzar agentes, estado del documento y chat libre.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { writeFileAtomic } from '../atomicFiles';
import type {
  EstadoFlujo,
  Indice,
  Motor,
  PasoFlujo,
  PreguntaInvestigacion,
  PropuestaVisual,
  HerramientasChat,
  SeleccionTexto,
  Sugerencia,
  Trabajo,
  Diagnostico,
} from '../../shared/tipos';
import { ARCHIVO_AUTOEVALUACION, permisosEfectivos } from '../../shared/tipos';
import { ErrorUsuario } from '../store';
import type { Postproceso } from '../agents/cola';
import { type BloqueActividad } from '../../shared/actividades';
import { AGENTES, construirPrompt } from '../agents/agentes';
import { modeloDe, motorElegido } from '../agents/modelos';
import { extraerJson, contarPalabras } from '../texto';
import { asegurarTextos } from '../conversion';
import { buscar as buscarRag, buscarEnTexto, formatear, hayIndice, indexar } from '../rag';
import { respuestaEnDossier, textoRestricciones, menorEsfuerzo, AMBITOS, instantaneaDocumento } from './utilidades';
import type { Dependencias, Lanzamiento, AmbitoChat } from './utilidades';
import { buildSectionReference } from '../contextSelection';

export class FlujoBase {
  protected candados = new Map<string, Promise<unknown>>();

  constructor(protected dep: Dependencias) {}

  protected get almacen() {
    return this.dep.almacen();
  }

  /** Ejecuta las operaciones sobre un mismo archivo de una en una. */
  protected conCandado<T>(clave: string, fn: () => Promise<T>): Promise<T> {
    const previo = this.candados.get(clave) ?? Promise.resolve();
    const siguiente = previo.catch(() => {}).then(fn);
    this.candados.set(clave, siguiente);
    return siguiente;
  }

  motorPara(agente: string, forzado?: Motor): Motor {
    if (!Object.hasOwn(AGENTES, agente)) throw new ErrorUsuario('Agente desconocido');
    const info = AGENTES[agente];
    const listos = this.dep.motoresListos();
    if (forzado) {
      if (!listos.has(forzado)) throw new ErrorUsuario(`Esta tarea necesita ${ENGINE_NAMES[forzado]}, que no está disponible`);
      return forzado;
    }
    if (info.soloMotor) return info.soloMotor;
    const preferido = motorElegido(this.dep.ajustes(), agente);
    if (listos.has(preferido) || listos.size === 0) return preferido;
    return [...listos][0];
  }

  instrucciones(agente: string) {
    return this.dep.ajustes().agentes[agente]?.instrucciones?.trim() || AGENTES[agente].instrucciones;
  }

  protected ocupado(paso: PasoFlujo, asig: string, doc?: string, seccion?: string, ref?: string) {
    return this.dep.cola
      .listar()
      .some(
        (t) =>
          (t.estado === 'ejecutando' || t.estado === 'en-cola') &&
          t.paso === paso &&
          t.asignatura === asig &&
          t.documento === doc &&
          (seccion === undefined || t.seccion === seccion) &&
          (ref === undefined || t.ref === ref),
      );
  }

  /** Permisos efectivos de un documento (ficha de la asignatura y, encima, la del documento). */
  async permisos(asig: string, doc?: string) {
    const a = await this.almacen.obtenerAsignatura(asig);
    const d = doc ? await this.almacen.obtenerDocumento(asig, doc) : undefined;
    return permisosEfectivos(a.permisos, d?.permisos);
  }

  protected async lanzar(l: Lanzamiento): Promise<Trabajo> {
    const asignatura = await this.almacen.obtenerAsignatura(l.asignatura);
    const documento = l.documento ? await this.almacen.obtenerDocumento(l.asignatura, l.documento) : undefined;
    if (documento?.presupuesto && this.dep.gastoDocumento) {
      const gastado = this.dep.gastoDocumento(l.asignatura, documento.id);
      if (gastado >= documento.presupuesto) {
        const m = (n: number) => `${(n / 1e6).toLocaleString('es', { maximumFractionDigits: 1 })} M`;
        throw new ErrorUsuario(
          `«${documento.titulo}» ha llegado a su tope de ${m(documento.presupuesto)} tokens (lleva ${m(gastado)}). Súbelo o quítalo en la ficha del documento para seguir.`,
        );
      }
    }
    const secciones = documento ? await this.almacen.listarSecciones(l.asignatura, documento.id) : undefined;
    const dirAsig = this.almacen.dirAsignatura(asignatura.id);
    const cwd = documento ? this.almacen.dirDocumento(asignatura.id, documento.id) : dirAsig;
    await fs.mkdir(path.join(cwd, '.agentes'), { recursive: true });
    const motor = this.motorPara(l.agente, l.motor);
    // Con fuentes indexadas, el agente recibe la herramienta de búsqueda en lugar de leer documentos enteros
    const carpetas = l.carpetas ?? this.carpetasFuentes(asignatura.id, documento?.id);
    // Lo que la ficha de la asignatura (y la del documento) permite usar a los agentes
    const permisos = permisosEfectivos(asignatura.permisos, documento?.permisos);
    const referencia = await this.contenidoReferencia(asignatura.id, documento?.id, l.incluir,
      { folders: carpetas, allowSources: l.fuentes !== false && permisos.fuentes });
    const imagenes = !!l.imagenes && permisos.busquedaImagenes;
    // Calculadora para comprobar ejercicios y datos numéricos (agentes que escriben o revisan contenido)
    const calculo = ['redactor', 'calidad', 'autoevaluacion', 'examinador', 'orquestador', 'fuentes'].includes(l.agente);
    const conIndice = l.fuentes !== false && permisos.fuentes && !!this.dep.mcpFuentes && (await hayIndice(carpetas).catch(() => false));
    const avisoFuentes = conIndice
      ? '\n\n## Material aportado\nEstá indexado. Usa `buscar_en_fuentes`, `listar_fuentes` y `leer_pagina`. Para consultas concretas, recupera solo lo necesario. Si la tarea exige cobertura completa, inventaría y lee todas las partes del ámbito pedido, por bloques; los primeros resultados no acreditan exhaustividad. Cita archivo y página al usar un dato.'
      : '';
    const { sistema, prompt } = construirPrompt(
      this.instrucciones(l.agente),
      { asignatura: l.agente === 'curriculo' || l.publicContext ? { ...asignatura, contexto: '', destinatarios: '', documentos: [], estilo: '' } : asignatura, documento, secciones, seccionActiva: l.seccionActiva },
      l.tarea + avisoFuentes + textoRestricciones(permisos) + referencia,
      l.indicaciones,
      l.agente === 'curriculo' ? 'curriculum'
        : ['investigador', 'arquitecto', 'examinador', 'glosario', 'diagnostico', 'director-visual'].includes(l.agente) ? 'structured' : undefined,
    );
    // Modelo y esfuerzo del agente en el motor con el que va a trabajar (Ajustes › Agentes)
    const elegido = modeloDe(this.dep.ajustes(), l.agente, motor);
    return this.dep.cola.encolar({
      agente: l.agente,
      nombreAgente: AGENTES[l.agente].nombre,
      motor,
      titulo: l.titulo,
      asignatura: asignatura.id,
      documento: documento?.id,
      paso: l.paso,
      seccion: l.seccion,
      ref: l.ref,
      prompt,
      sistema,
      web: (l.web ?? AGENTES[l.agente].web) && permisos.busquedaWeb,
      // Algunas tareas sencillas piden menos esfuerzo que el del agente (p. ej. añadir pies)
      esfuerzo: l.esfuerzo && elegido.esfuerzo ? menorEsfuerzo(l.esfuerzo, elegido.esfuerzo) : elegido.esfuerzo,
      modelo: elegido.modelo,
      mcp:
        this.dep.mcpFuentes && (conIndice || imagenes || calculo)
          ? {
              ...this.dep.mcpFuentes,
              args: [
                ...this.dep.mcpFuentes.args,
                ...(imagenes ? ['--imagenes'] : []),
                ...(calculo ? ['--calculo'] : []),
                ...(imagenes && l.guardarImagenes ? [`--recursos=${path.join(cwd, 'recursos')}`] : []),
                ...(conIndice ? Object.entries(carpetas).map(([k, v]) => `${k}=${v}`) : []),
              ],
              env: { ...this.dep.mcpFuentes.env, ...(imagenes ? { APUNTES_CLAVES_IMAGENES: JSON.stringify(this.dep.ajustes().claves ?? {}) } : {}) },
            }
          : undefined,
      cwd,
      dirsExtra: documento ? [dirAsig] : [],
      post: l.post,
    });
  }

  /**
   * Incluye en el mensaje el texto de los archivos que el agente va a necesitar. Leerlos con
   * herramientas cuesta una vuelta más por archivo, y en cada vuelta se reenvía todo el contexto.
   */
  protected async contenidoReferencia(asig: string, doc: string | undefined, incluir?: Lanzamiento['incluir'],
    sourceOptions?: { folders: Record<string, string>; allowSources: boolean }): Promise<string> {
    if (!incluir) return '';
    const partes: string[] = [];
    const MAX_DOSSIER = 40_000;
    const MAX_SECCIONES = 90_000;
    if (doc && incluir.dossier) {
      const d = await this.almacen.leerArchivoDoc(asig, doc, 'investigacion.md');
      // Dossier largo y tarea concreta: solo las partes relevantes (y siempre la lista de fuentes)
      if (incluir.consulta && d.length > 14_000) {
        const partes2 = buscarEnTexto(d, 'investigacion.md', incluir.consulta, 10);
        const fuentes = d.match(/\n## Fuentes[\s\S]*$/)?.[0] ?? '';
        if (partes2.length) partes.push(
          '===== investigacion.md (solo las partes relevantes para esta tarea; el dossier completo está en investigacion.md) =====',
          partes2.map((p) => (p.titulo ? `[${p.titulo}]\n${p.texto}` : p.texto)).join('\n\n[…]\n\n'),
          fuentes.trim(),
          '===== fin del extracto del dossier =====',
        );
        else partes.push('===== investigacion.md (sin coincidencias: no se presupone ausencia de información) =====',
          d.length > MAX_DOSSIER ? `${d.slice(0, MAX_DOSSIER)}\n[… PENDIENTE: lee el resto de investigacion.md antes de descartar información]` : d,
          '===== fin de investigacion.md =====');
      } else if (d.trim()) {
        partes.push(
          '===== investigacion.md =====',
          d.length > MAX_DOSSIER ? `${d.slice(0, MAX_DOSSIER)}\n[… recortado: lee investigacion.md si necesitas el resto]` : d,
          '===== fin de investigacion.md =====',
        );
      }
    }
    if (incluir.glosario) {
      const g = await this.almacen.leerGlosario(asig);
      if (g.replace(/^#\s*Glosario\s*/i, '').trim()) partes.push('===== ../../glosario.md =====', g.length > 15_000
        ? `${g.slice(0, 15_000)}\n[… PENDIENTE: lee ../../glosario.md para consultar el resto]` : g, '===== fin del glosario =====');
    }
    if (doc && incluir.secciones?.length) {
      partes.push(await buildSectionReference(incluir.secciones, (filename) => this.almacen.leerSeccion(asig, doc, filename), MAX_SECCIONES));
    }
    if (incluir.consulta && sourceOptions?.allowSources !== false) {
      const r = await buscarRag(sourceOptions?.folders ?? this.carpetasFuentes(asig, doc), incluir.consulta, 6).catch(() => []);
      if (r.length) partes.push('===== Fragmentos del material aportado más relevantes para esta tarea =====', formatear(r, { subjectLevel: !doc }), '===== fin de los fragmentos =====');
    }
    if (!partes.length) return '';
    return `\n\n## Contexto de referencia (no releas lo incluido; consulta lo marcado como pendiente)\n${partes.join('\n')}`;
  }

  /** Bound inline curriculum context without silently losing the rest of its captured version. */
  protected async curriculumReference(subjectId: string, documentId?: string, characterLimit = 30_000): Promise<string> {
    const content = await this.almacen.curriculumPrompt(subjectId);
    if (content.length <= characterLimit) return content;
    const digest = createHash('sha256').update(content).digest('hex');
    const filename = `curriculum-${digest}.md`;
    const directory = path.join(this.almacen.dirAsignatura(subjectId), '.agentes');
    await fs.mkdir(directory, { recursive: true });
    await writeFileAtomic(path.join(directory, filename), content);
    const prefix = content.slice(0, characterLimit);
    const boundary = prefix.lastIndexOf('\n\n');
    const preview = boundary > 0 ? prefix.slice(0, boundary) : '';
    const reference = `${documentId ? '../../' : ''}.agentes/${filename}`;
    return `${preview}\n\nPENDIENTE: el currículo tiene ${content.length} caracteres y aquí solo se incluye un extracto. Antes de seleccionar criterios o concluir sobre cobertura, lee el currículo COMPLETO en \`${reference}\`, por bloques si es necesario. Es la instantánea exacta de la versión activa usada en esta tarea; no modifiques ese archivo. Una búsqueda de fragmentos no acredita cobertura completa.`;
  }

  /** Ruta (relativa a la carpeta del documento) para el resultado estructurado de un agente. */
  protected salida(prefijo: string, ext = 'json') {
    return `.agentes/${prefijo}-${randomUUID().slice(0, 8)}.${ext}`;
  }

  protected async leerSalida<T>(asig: string, doc: string, rel: string): Promise<T> {
    const ruta = path.join(this.almacen.dirDocumento(asig, doc), rel);
    let texto: string;
    try {
      texto = await fs.readFile(ruta, 'utf8');
    } catch {
      throw new Error(`El agente no ha escrito el archivo de resultado (${rel}). Respóndele para que lo haga.`);
    }
    try {
      return extraerJson<T>(texto);
    } catch {
      throw new Error(`El archivo ${rel} no contiene JSON válido. Respóndele para que lo corrija.`);
    }
  }

  /** Extrae el texto de las fuentes y actualiza su índice de búsqueda. */
  async prepararFuentes(asig: string, doc?: string) {
    for (const dir of [this.almacen.dirFuentes(asig), ...(doc ? [this.almacen.dirFuentes(asig, doc)] : [])]) {
      if (this.dep.dirBin) await asegurarTextos(dir, this.dep.dirBin).catch(() => {});
      await indexar(dir).catch((e) => console.warn('No se pudo indexar', dir, e));
    }
  }

  /** Carpetas de fuentes visibles desde un documento (o una asignatura). */
  carpetasFuentes(asig: string, doc?: string): Record<string, string> {
    return { asignatura: this.almacen.dirFuentes(asig), ...(doc ? { documento: this.almacen.dirFuentes(asig, doc) } : {}) };
  }

  // ---------------------------------------------------------------------------
  // Estado

  async estado(asig: string, doc: string): Promise<EstadoFlujo> {
    const a = this.almacen;
    const [info, document, secciones, storedQuestions, indice, sugerencias, visuales, actividades, diagnostico, exportados] = await Promise.all([
      a.infoArchivoDoc(asig, doc, 'investigacion.md'),
      a.obtenerDocumento(asig, doc),
      a.listarSecciones(asig, doc),
      a.leerJsonDoc<PreguntaInvestigacion[]>(asig, doc, 'preguntas.json', []),
      a.leerJsonDoc<Indice | null>(asig, doc, 'indice.json', null),
      a.leerJsonDoc<Sugerencia[]>(asig, doc, 'sugerencias.json', []),
      a.leerJsonDoc<PropuestaVisual[]>(asig, doc, 'visuales.json', []),
      this.actividades(asig, doc),
      a.leerJsonDoc<Diagnostico | null>(asig, doc, 'diagnostico.json', null),
      a.listarExportados(asig, doc),
    ]);
    const dossier = info ? await a.leerArchivoDoc(asig, doc, 'investigacion.md') : '';
    const preguntas = storedQuestions.map((p) => ({
      ...p,
      respuesta: respuestaEnDossier(dossier, p.texto),
    }));
    return {
      imported: !!document.importado,
      investigacion: info ? { palabras: contarPalabras(dossier), actualizado: info.modificado } : undefined,
      preguntas,
      indice: indice ?? undefined,
      secciones,
      sugerencias,
      visuales,
      autoevaluacion: secciones.find((s) => ARCHIVO_AUTOEVALUACION.test(s.archivo))?.archivo,
      actividades,
      diagnostico: diagnostico ?? undefined,
      exportados,
    };
  }

  // ---------------------------------------------------------------------------
  // Chat libre con el orquestador

  async chat(
    asig: string,
    doc: string | undefined,
    tarea: string,
    motor?: Motor,
    seccionActiva?: string,
    herramientas: HerramientasChat = {},
    seleccionTexto?: SeleccionTexto,
    ambito?: AmbitoChat,
  ) {
    if (!tarea.trim()) throw new ErrorUsuario('Escribe qué quieres que haga');
    // El agente solo actúa sobre lo que está abierto en la zona central. Con una sección abierta,
    // es como si estuviera seleccionada entera (la app sustituye la sección y no puede tocar nada más)
    let todaLaSeccion = false;
    if (doc && !seleccionTexto?.fragmento.trim() && ambito?.vista === 'apuntes' && ambito.seccion) {
      const texto = await this.almacen.leerSeccion(asig, doc, ambito.seccion).catch(() => '');
      if (texto.trim()) {
        seleccionTexto = { seccion: ambito.seccion, desde: 0, hasta: texto.split('\n').length, fragmento: texto, texto: '' };
        todaLaSeccion = true;
      }
    }
    // Petición sobre un fragmento seleccionado en la vista previa: el agente no edita la sección,
    // escribe el fragmento nuevo y la app lo sustituye en su sitio (así no puede tocar nada más)
    let sobreSeleccion: { texto: string; post: Postproceso } | undefined;
    if (doc && seleccionTexto?.fragmento.trim()) {
      const sel = seleccionTexto;
      const salida = this.salida('seleccion', 'md');
      const parcial = !sel.figura && sel.texto && sel.texto.replace(/\s+/g, ' ').length < sel.fragmento.replace(/\s+/g, ' ').length * 0.8;
      sobreSeleccion = {
        texto: `

## ${todaLaSeccion ? 'Sección abierta' : 'Selección'}
${todaLaSeccion ? `El usuario tiene abierta la sección \`secciones/${sel.seccion}\` y solo se puede trabajar sobre ella. Su contenido actual es este` : sel.figura ? `El usuario ha seleccionado esta figura (imagen, diagrama, mapa, molécula o tabla, con su pie y su referencia) de \`secciones/${sel.seccion}\`` : `El usuario ha seleccionado este fragmento de \`secciones/${sel.seccion}\``}${
          parcial ? ` (y, dentro de él, en concreto el texto «${sel.texto.slice(0, 1500)}»)` : ''
        }:

\`\`\`\`markdown
${sel.fragmento}
\`\`\`\`

Actúa SOLO sobre ${todaLaSeccion ? 'esta sección; no modifiques otros archivos' : 'este fragmento; puedes leer la sección para entender el contexto'}.
- Si la petición pide cambiarlo (reescribir, ampliar, corregir, añadir algo junto a él, sustituir una imagen…), NO edites la sección: escribe en \`${salida}\` el fragmento nuevo completo, en Markdown, que sustituirá exactamente al de arriba (incluye también lo que no cambie). Nada más en ese archivo.
- Si es una pregunta o una consulta, respóndela sin escribir ningún archivo.${
          sel.figura
            ? '\n- Es una figura: si es un bloque (```mapa, ```grafica, ```mermaid…), cambia su contenido; si es una imagen que hay que sustituir, busca otra con las herramientas de imágenes si las tienes, guárdala en `recursos/` y actualiza el pie y la referencia APA.'
            : ''
        }`,
        post: { tipo: 'seleccion', datos: { salida, seccion: sel.seccion, fragmento: sel.fragmento } },
      };
    }
    let estado = '';
    if (doc) {
      const e = await this.estado(asig, doc);
      estado = [
        '\n## Estado del flujo',
        `- Investigación: ${e.investigacion ? `hecha (${e.investigacion.palabras} palabras en investigacion.md)` : 'no hecha'}`,
        `- Índice: ${e.indice ? `${e.indice.entradas.length} secciones${e.indice.aprobado ? ', aprobado' : ', pendiente de aprobar'}` : 'no existe'}`,
        `- Secciones redactadas: ${e.secciones.filter((s) => s.palabras > 40).length} de ${e.secciones.length}`,
        `- Sugerencias de revisión pendientes: ${e.sugerencias.filter((s) => s.estado === 'pendiente').length}`,
        `- Propuestas visuales pendientes: ${e.visuales.filter((v) => v.estado === 'propuesta').length}`,
      ].join('\n');
    }
    // En las demás pestañas: se le dice qué puede tocar y, al terminar, se deshace lo de fuera
    let restriccion = '';
    let postAmbito: Postproceso | undefined;
    if (doc && !sobreSeleccion && ambito?.vista) {
      const a = AMBITOS[ambito.vista] ?? AMBITOS.apuntes;
      restriccion = `\n\n## Pestaña abierta: ${a.nombre}\nEl usuario está en la pestaña «${a.nombre}» y solo se puede trabajar sobre ella: ${a.descripcion}${
        a.permitidos.length ? '' : ' No modifiques ningún archivo: responde a lo que pregunte.'
      } Si la petición pide cambiar otra cosa, explícale que debe abrir la pestaña correspondiente.`;
      postAmbito = { tipo: 'ambito', datos: { permitidos: a.permitidos, nombre: a.nombre } };
    }
    await this.prepararFuentes(asig, doc);
    const motorFinal = motor && this.dep.motoresListos().has(motor) ? motor : undefined;
    const instantanea = postAmbito && doc ? await instantaneaDocumento(this.almacen.dirDocumento(asig, doc)) : undefined;
    const trabajo = await this.lanzar({
      agente: 'orquestador',
      asignatura: asig,
      documento: doc,
      titulo: tarea.trim().split(/\r?\n/)[0].slice(0, 120),
      tarea: tarea + estado + (sobreSeleccion?.texto ?? '') + restriccion,
      paso: 'chat',
      motor: motorFinal,
      seccionActiva: seleccionTexto?.seccion ?? seccionActiva,
      post: sobreSeleccion?.post ?? postAmbito,
      // Herramientas elegidas en el panel (por defecto: web y fuentes sí, imágenes no)
      web: herramientas.web ?? true,
      imagenes: !!herramientas.imagenes && !!this.dep.mcpFuentes,
      guardarImagenes: !!doc,
      fuentes: herramientas.fuentes ?? true,
    });
    if (instantanea) this.instantaneas.set(trabajo.id, instantanea);
    return trabajo;
  }

  /** Copia de los archivos de texto del documento antes de una petición limitada a una pestaña. */
  protected instantaneas = new Map<string, Map<string, string>>();

  /** Deshace los cambios que el agente haya hecho fuera de la pestaña abierta. */
  protected async restaurarFueraDeAmbito(t: Trabajo, datos: Record<string, unknown>): Promise<string[]> {
    const antes = this.instantaneas.get(t.id);
    this.instantaneas.delete(t.id);
    if (!antes || !t.documento) return [];
    const dir = this.almacen.dirDocumento(t.asignatura, t.documento);
    const permitidos = (datos.permitidos as string[]) ?? [];
    const permitido = (rel: string) => permitidos.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p));
    const ahora = await instantaneaDocumento(dir);
    const deshechos: string[] = [];
    for (const rel of new Set([...antes.keys(), ...ahora.keys()])) {
      if (permitido(rel) || antes.get(rel) === ahora.get(rel)) continue;
      if (antes.has(rel)) await fs.writeFile(path.join(dir, rel), antes.get(rel)!, 'utf8');
      else await fs.rm(path.join(dir, rel), { force: true });
      deshechos.push(rel);
    }
    return deshechos;
  }

  /** Para el arquitecto y los redactores: cómo usar los apuntes de partida (modos reestructurar y reescribir). */
  protected async guiaImportacion(asig: string, doc: string): Promise<string> {
    const imp = (await this.almacen.obtenerDocumento(asig, doc)).importado;
    if (!imp || imp.modo === 'conservador') return '';
    const fuente = imp.formato === 'pdf' ? `el PDF \`fuentes/${imp.archivo}\`` : '`fuentes/apuntes-originales.md`';
    const imagenes = imp.formato === 'pdf' ? '' : ' Sus imágenes están en `recursos/` (archivos `importada-…`): reutilízalas con la misma ruta y con su pie.';
    return imp.modo === 'reestructurar'
      ? `\n\n## Apuntes de partida\nEste documento parte de unos apuntes existentes del profesor (${fuente}; también aparecen al buscar en las fuentes). Son la base: conserva sus explicaciones, ejemplos, ejercicios y datos, reorganízalos según el índice y mejora la redacción donde haga falta. No elimines contenido valioso.${imagenes}`
      : `\n\n## Apuntes de partida\nEste documento rehace unos apuntes existentes del profesor (${fuente}; también aparecen al buscar en las fuentes). Son la fuente principal: cubre al menos lo mismo que ellos (y lo que les falte), pero escribe de nuevo, con otra redacción y actualizando lo que esté desfasado.${imagenes}`;
  }

  // ---------------------------------------------------------------------------
  // 6. Autoevaluación: bloques de actividades que se generan por separado

  protected async actividades(asig: string, doc: string) {
    return this.almacen.leerJsonDoc<BloqueActividad[]>(asig, doc, 'actividades.json', []);
  }
}
