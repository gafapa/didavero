// Fases 3 y 4: redacción en paralelo, revisión con sugerencias y versiones adaptadas.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Indice, Sugerencia, TipoRevision, Trabajo } from '../../shared/tipos';
import { ErrorUsuario } from '../store';
import { PedirAlAgente } from '../agents/cola';
import { sustituirFragmento, buscarFragmento } from '../texto';
import { INDICE_VACIO, estructuraMarkdown, aplanarApartados, GUIAS_VERSION } from './utilidades';
import type { TipoVersion } from './utilidades';
import { FlujoPreparacion } from './preparacion';

export class FlujoEscritura extends FlujoPreparacion {

  // ---------------------------------------------------------------------------
  // 3. Redacción (un agente por sección, en paralelo)

  async redactar(asig: string, doc: string, archivos: string[], indicaciones?: string) {
    if (!archivos?.length) throw new ErrorUsuario('Elige al menos una sección');
    await this.prepararFuentes(asig, doc);
    const indice = await this.almacen.leerJsonDoc<Indice>(asig, doc, 'indice.json', INDICE_VACIO);
    const secciones = await this.almacen.listarSecciones(asig, doc);
    const hayDossier = existsSync(path.join(this.almacen.dirDocumento(asig, doc), 'investigacion.md'));
    const guia = await this.guiaImportacion(asig, doc);
    const lanzados: Trabajo[] = [];
    for (const archivo of archivos) {
      const s = secciones.find((x) => x.archivo === archivo);
      if (!s) continue;
      if (this.ocupado('redaccion', asig, doc, archivo)) continue;
      const entrada = indice.entradas.find((e) => e.archivo === archivo);
      const plan = entrada
        ? [
            `- Título: ${entrada.titulo}`,
            entrada.objetivo && `- Objetivo: ${entrada.objetivo}`,
            entrada.contenidos.length && `- Contenidos:\n${entrada.contenidos.map((c) => `  - ${c}`).join('\n')}`,
            entrada.extension && `- Extensión: ${entrada.extension}`,
            entrada.visuales && `- Apoyos visuales sugeridos: ${entrada.visuales}`,
            entrada.apartados?.length &&
              `- Estructura de apartados (OBLIGATORIA: usa exactamente estos encabezados, en este orden; puedes añadir párrafos, listas y tablas dentro de cada uno, pero no otros encabezados del mismo nivel):\n${estructuraMarkdown(entrada.apartados).map((l) => `  ${l}`).join('\n')}`,
          ]
            .filter(Boolean)
            .join('\n')
        : `- Título: ${s.titulo} (sin plan en el índice: dedúcelo del título y del resto del documento)`;
      const mapa = indice.entradas.length
        ? indice.entradas.map((e, i) => `${i + 1}. ${e.titulo}${e.archivo === archivo ? '  ← ESTA' : ''}${e.objetivo ? ` — ${e.objetivo}` : ''}`).join('\n')
        : secciones.map((x, i) => `${i + 1}. ${x.titulo}${x.archivo === archivo ? '  ← ESTA' : ''}`).join('\n');
      lanzados.push(
        await this.lanzar({
          agente: 'redactor',
          asignatura: asig,
          documento: doc,
          titulo: `Redactar «${s.titulo}»`,
          paso: 'redaccion',
          seccion: archivo,
          incluir: {
            dossier: true,
            glosario: true,
            secciones: [archivo],
            // Para recuperar del dossier y de las fuentes solo lo relevante para esta sección
            consulta: [
              entrada?.titulo ?? s.titulo,
              entrada?.objetivo,
              ...(entrada?.contenidos ?? []),
              ...aplanarApartados(entrada?.apartados ?? []),
            ]
              .filter(Boolean)
              .join('. '),
          },
          indicaciones,
          tarea: `Redacta la sección \`secciones/${archivo}\`${s.palabras > 40 ? ' (ya tiene contenido: mejóralo y complétalo sin perder lo valioso)' : ''}.

### Plan de esta sección
${plan}

### Índice completo del documento (para no repetir lo que tratan otras secciones)
${mapa}

### Instrucciones
- Basa el contenido en ${hayDossier ? '`investigacion.md` y ' : ''}el material aportado${hayDossier ? '' : ' (si lo hay) y en fuentes fiables'}. No inventes datos.
- La primera línea debe ser exactamente \`# ${entrada?.titulo ?? s.titulo}\`. Usa \`##\` y \`###\` para los apartados internos.
- Escribe SOLO en \`secciones/${archivo}\`. Otros agentes están escribiendo las demás secciones a la vez.
- Puedes incluir un diagrama \`\`\`mermaid si el plan lo pide y aporta claridad, y fórmulas en LaTeX ($...$).
- No añadas bibliografía al final de la sección; las fuentes están en el dossier.${guia}`,
        }),
      );
    }
    if (!lanzados.length) throw new ErrorUsuario('Esas secciones ya se están redactando');
    return lanzados;
  }

  // ---------------------------------------------------------------------------
  // 4. Revisión: los revisores proponen sugerencias; el usuario decide

  async revisar(asig: string, doc: string, tipos: TipoRevision[], archivos?: string[], indicaciones?: string) {
    const secciones = (await this.almacen.listarSecciones(asig, doc)).filter((s) => !archivos?.length || archivos.includes(s.archivo));
    if (!secciones.length) throw new ErrorUsuario('No hay secciones que revisar');
    const lista = secciones.map((s) => `- secciones/${s.archivo} (${s.titulo})`).join('\n');
    const foco: Record<TipoRevision, string> = {
      estilo: 'claridad, tono adecuado a los destinatarios, frases largas o ambiguas, repeticiones, ortografía, gramática y coherencia terminológica',
      calidad: 'errores conceptuales, imprecisiones, explicaciones incompletas, saltos lógicos, conceptos usados antes de explicarlos y contenidos que faltan para cumplir el objetivo',
      fuentes: 'datos, cifras, fechas, nombres y afirmaciones verificables; compruébalos contra el dossier, el material aportado y fuentes fiables de la web',
      curriculo:
        'la cobertura del currículo oficial (incluido abajo): qué resultados de aprendizaje, criterios de evaluación o saberes básicos que corresponden a este documento —según su índice y su objetivo— no están tratados o lo están de forma insuficiente. Propón el texto que falta en el lugar adecuado y cita en el motivo el código del criterio (p. ej. «RA2.c» o «CE 3.1»). No exijas lo que pertenece a otros temas',
    };
    const agente: Record<TipoRevision, string> = { estilo: 'estilo', calidad: 'calidad', fuentes: 'fuentes', curriculo: 'curriculo' };
    const curriculo = tipos.includes('curriculo') ? await this.curriculumReference(asig, doc, 40_000) : '';
    if (tipos.includes('curriculo') && !curriculo.trim()) {
      throw new ErrorUsuario('Esta asignatura aún no tiene el currículo oficial. Búscalo en la pestaña «Currículo» de la asignatura.');
    }
    const lanzados: Trabajo[] = [];
    for (const tipo of tipos) {
      if (this.ocupado('revision', asig, doc, undefined, tipo)) continue;
      const salida = this.salida(`revision-${tipo}`);
      lanzados.push(
        await this.lanzar({
          agente: agente[tipo],
          asignatura: asig,
          documento: doc,
          titulo: `Revisión de ${tipo === 'fuentes' ? 'fuentes y datos' : tipo === 'curriculo' ? 'cobertura del currículo' : tipo}`,
          paso: 'revision',
          ref: tipo,
          incluir: { secciones: secciones.map((s) => s.archivo), dossier: tipo === 'fuentes', glosario: tipo === 'estilo' },
          indicaciones,
          tarea: `Revisa estas secciones fijándote en: ${foco[tipo]}.
${lista}
${tipo === 'curriculo' ? `
===== Currículo estructurado activo de la asignatura =====
${curriculo}
===== fin del currículo =====
` : ''}
NO modifiques las secciones: el usuario decidirá qué cambios aceptar. Escribe tus sugerencias en \`${salida}\` con este JSON exacto:

{
  "sugerencias": [
    {
      "seccion": "nombre del archivo, p. ej. 02-membrana.md",
      "original": "fragmento EXACTO copiado del archivo (una o pocas frases, lo bastante largo para ser único)",
      "propuesta": "texto que sustituye al original (para añadir algo, incluye el original y lo añadido)",
      "motivo": "explicación breve",
      "gravedad": "baja | media | alta"
    }
  ]
}

Como máximo 25 sugerencias; prioriza las importantes. Copia el original carácter a carácter, incluida la sintaxis Markdown. Si no hay nada que mejorar, deja la lista vacía.
Si el usuario te responde pidiendo cambios, vuelve a escribir el archivo completo.`,
          post: { tipo: 'revision', datos: { salida, tipo } },
        }),
      );
    }
    if (!lanzados.length) throw new ErrorUsuario('Esas revisiones ya están en curso');
    return lanzados;
  }

  async decidirSugerencias(asig: string, doc: string, ids: string[], decision: 'aceptar' | 'rechazar', propuestaEditada?: string) {
    return this.conCandado(`${asig}/${doc}/sugerencias`, async () => {
      const lista = await this.almacen.leerJsonDoc<Sugerencia[]>(asig, doc, 'sugerencias.json', []);
      let aplicadas = 0;
      let fallidas = 0;
      for (const id of ids) {
        const s = lista.find((x) => x.id === id);
        if (!s || s.estado !== 'pendiente') continue;
        if (decision === 'rechazar') {
          s.estado = 'rechazada';
          continue;
        }
        if (propuestaEditada !== undefined && ids.length === 1) s.propuesta = propuestaEditada;
        const ok = await this.conCandado(`${asig}/${doc}/sec/${s.seccion}`, async () => {
          const texto = await this.almacen.leerSeccion(asig, doc, s.seccion).catch(() => null);
          const nuevo = texto === null ? null : sustituirFragmento(texto, s.original, s.propuesta);
          if (nuevo === null) return false;
          await this.almacen.guardarSeccion(asig, doc, s.seccion, nuevo);
          return true;
        });
        s.estado = ok ? 'aceptada' : 'fallida';
        ok ? aplicadas++ : fallidas++;
      }
      await this.almacen.escribirJsonDoc(asig, doc, 'sugerencias.json', lista);
      return { aplicadas, fallidas };
    });
  }

  async limpiarSugerencias(asig: string, doc: string) {
    return this.conCandado(`${asig}/${doc}/sugerencias`, async () => {
      const lista = await this.almacen.leerJsonDoc<Sugerencia[]>(asig, doc, 'sugerencias.json', []);
      await this.almacen.escribirJsonDoc(asig, doc, 'sugerencias.json', lista.filter((s) => s.estado === 'pendiente'));
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Autoevaluación

  /**
   * Versión adaptada de un documento (atención a la diversidad, DUA): crea un documento nuevo con
   * las mismas secciones, imágenes e índice, y un redactor adapta cada sección.
   */
  async crearVersion(asig: string, doc: string, tipo: TipoVersion, indicaciones?: string) {
    const guia = GUIAS_VERSION[tipo];
    if (!guia) throw new ErrorUsuario('Tipo de versión no válido');
    const original = await this.almacen.obtenerDocumento(asig, doc);
    const secciones = (await this.almacen.listarSecciones(asig, doc)).filter((s) => s.palabras > 20);
    if (!secciones.length) throw new ErrorUsuario('El documento todavía no tiene secciones redactadas');
    const nuevo = await this.almacen.crearDocumento(asig, {
      titulo: `${original.titulo} (${guia.nombre.toLowerCase()})`,
      objetivo: original.objetivo,
      destinatarios: original.destinatarios,
      extension: original.extension,
      permisos: original.permisos,
    });
    // Copia de lo que define el contenido (no los trabajos, sugerencias ni exportaciones)
    const origen = this.almacen.dirDocumento(asig, doc);
    const destino = this.almacen.dirDocumento(asig, nuevo.id);
    for (const sub of ['secciones', 'recursos']) {
      await fs.cp(path.join(origen, sub), path.join(destino, sub), { recursive: true, force: true }).catch(() => {});
    }
    for (const archivo of ['indice.json', 'investigacion.md', 'actividades.json']) {
      await fs.copyFile(path.join(origen, archivo), path.join(destino, archivo)).catch(() => {});
    }
    const trabajos: Trabajo[] = [];
    for (const s of secciones) {
      trabajos.push(
        await this.lanzar({
          agente: 'redactor',
          asignatura: asig,
          documento: nuevo.id,
          titulo: `Adaptar «${s.titulo}» (${guia.nombre.toLowerCase()})`,
          paso: 'redaccion',
          seccion: s.archivo,
          ref: s.archivo,
          incluir: { secciones: [s.archivo] },
          indicaciones,
          tarea: `Esta es una versión adaptada del documento «${original.titulo}»: ${guia.nombre.toLowerCase()}.
Reescribe la sección \`secciones/${s.archivo}\` (sobrescríbela) siguiendo estas pautas:
${guia.pautas}

Conserva los títulos de los apartados, las imágenes (con su pie y su referencia), los diagramas, las tablas, las fórmulas y los demás bloques salvo que la pauta diga otra cosa, y respeta las normas de formato. No toques otras secciones.`,
        }),
      );
    }
    return { documento: nuevo, trabajos: trabajos.length };
  }

  protected async postRevision(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const salida = String(datos.salida);
    const tipo = datos.tipo as TipoRevision;
    const r = await this.leerSalida<{ sugerencias?: Partial<Sugerencia>[] }>(asig, doc, salida);
    return this.conCandado(`${asig}/${doc}/sugerencias`, async () => {
      const actuales = await this.almacen.leerJsonDoc<Sugerencia[]>(asig, doc, 'sugerencias.json', []);
      const textos = new Map((await this.almacen.textoCompleto(asig, doc)).map((x) => [x.archivo, x.texto]));
      let validas = 0;
      let descartadas = 0;
      for (const s of r.sugerencias ?? []) {
        const seccion = String(s.seccion ?? '').replace(/^secciones\//, '');
        const texto = textos.get(seccion);
        if (!texto || !s.original || !s.propuesta || s.original === s.propuesta || !buscarFragmento(texto, String(s.original))) {
          descartadas++;
          continue;
        }
        const dup = actuales.some((x) => x.estado === 'pendiente' && x.seccion === seccion && x.original === s.original && x.propuesta === s.propuesta);
        if (dup) continue;
        actuales.push({
          id: randomUUID().slice(0, 10),
          tipo,
          seccion,
          original: String(s.original),
          propuesta: String(s.propuesta),
          motivo: String(s.motivo ?? ''),
          gravedad: s.gravedad === 'alta' || s.gravedad === 'baja' ? s.gravedad : 'media',
          estado: 'pendiente',
          trabajo: t.id,
          creado: new Date().toISOString(),
        });
        validas++;
      }
      await this.almacen.escribirJsonDoc(asig, doc, 'sugerencias.json', actuales);
      return `${validas} sugerencia${validas === 1 ? '' : 's'}${descartadas ? ` (${descartadas} descartada${descartadas === 1 ? '' : 's'}: no se encontró el texto citado)` : ''}`;
    });

  }

  /** Petición sobre una selección: si el agente ha escrito el fragmento nuevo, sustituye al seleccionado. */
  protected async postSeleccion(t: Trabajo, datos: Record<string, unknown>): Promise<string | void> {
    const asig = t.asignatura;
    const doc = t.documento!;
    const salida = String(datos.salida);
    const seccion = String(datos.seccion);
    const original = String(datos.fragmento);
    const ruta = path.join(this.almacen.dirDocumento(asig, doc), salida);
    const nuevo = await fs.readFile(ruta, 'utf8').catch(() => undefined);
    if (nuevo === undefined) return; // era una pregunta: ya ha respondido
    // Por si lo ha envuelto en un bloque ```markdown
    const limpio = nuevo.replace(/^\s*`{3,4}(?:markdown|md)?\s*\n([\s\S]*?)\n`{3,4}\s*$/, '$1').trim();
    if (!limpio) throw new PedirAlAgente('El fragmento nuevo está vacío.', `\`${salida}\` está vacío. Escribe en él el fragmento nuevo completo.`);
    const resultado = await this.conCandado(`${asig}/${doc}/sec/${seccion}`, async () => {
      const texto = await this.almacen.leerSeccion(asig, doc, seccion);
      const cambiado = sustituirFragmento(texto, original, limpio);
      if (cambiado === null) return false;
      await this.almacen.guardarSeccion(asig, doc, seccion, cambiado);
      return true;
    });
    await fs.rm(ruta, { force: true }).catch(() => {});
    if (!resultado) {
      throw new Error('El fragmento seleccionado ya no está en la sección (¿se ha editado mientras tanto?). Vuelve a seleccionarlo y repite la petición.');
    }
    return 'Selección actualizada';
  }
}
