// Exámenes de la asignatura, con su solucionario y su rúbrica de corrección. Se preparan a partir
// de documentos de la asignatura (enteros o algunas secciones), de sus fuentes y de archivos subidos
// solo para el examen: apuntes propios, el libro, exámenes de otros años… (examenes/<id>/fuentes/).
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Trabajo } from '../../shared/tipos';
import { ARCHIVO_AUTOEVALUACION } from '../../shared/tipos';
import { DIFICULTADES, TIPOS_ACTIVIDAD, preguntaValida, type PreguntaActividad, type TipoActividad } from '../../shared/actividades';
import {
  MAX_PREGUNTAS_EXAMEN,
  EXAM_ADAPTATIONS,
  OPCIONES_EXAMEN,
  TIPOS_CON_RUBRICA,
  ajustarRubrica,
  maximoTipoExamen,
  nombreTipo,
  redondear,
  repartirPuntos,
  tiposExamen,
  type CriterioRubrica,
  type Examen,
  type OpcionesExamen,
  type PreguntaExamen,
  type ExamAdaptationRequest,
} from '../../shared/examenes';
import { ErrorUsuario } from '../store';
import { PedirAlAgente } from '../agents/cola';
import { asegurarTextos } from '../conversion';
import { extraerJson } from '../texto';
import { indexar, leerPagina, type InfoIndice } from '../rag';
import { FORMATO_PREGUNTA } from './actividades';
import { FlujoAsignatura } from './asignatura';
import { selectExamAdaptationContext } from '../examContext';

/** Texto del material que va en el mensaje; lo que no quepa, el agente lo lee o lo busca. */
const MAX_MATERIAL = 160_000;

const texto = (v: unknown, max = 20_000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const textos = (v: unknown, max = 30) => (Array.isArray(v) ? v.map((x) => texto(x, 1000)).filter(Boolean).slice(0, max) : []);

/** Rúbrica que escribe la IA (o el usuario), con la forma esperada. */
function limpiarRubrica(v: unknown): CriterioRubrica[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const r = v
    .map((c) => {
      const x = (c ?? {}) as Partial<CriterioRubrica>;
      const niveles = (Array.isArray(x.niveles) ? x.niveles : [])
        .map((n) => ({ nivel: texto(n?.nivel, 80), descripcion: texto(n?.descripcion, 2000), puntos: Math.max(0, Number(n?.puntos) || 0) }))
        .filter((n) => n.nivel || n.descripcion)
        .slice(0, 6);
      return { criterio: texto(x.criterio, 300), puntos: Math.max(0, Number(x.puntos) || 0), niveles };
    })
    .filter((c) => c.criterio && c.niveles.length)
    .slice(0, 8);
  return r.length ? r : undefined;
}

/** Pregunta de examen a partir de lo que escribe la IA o el usuario (sin id ni comprobaciones del tipo). */
function limpiarPregunta(v: Partial<PreguntaExamen>, id: string): PreguntaExamen {
  const p: PreguntaExamen = {
    id,
    tipo: v.tipo as TipoActividad,
    enunciado: texto(v.enunciado),
    puntos: Math.max(0, redondear(Number(v.puntos) || 0)),
  };
  if (Array.isArray(v.opciones)) p.opciones = textos(v.opciones, 8);
  if (typeof v.correcta === 'number' || typeof v.correcta === 'boolean') p.correcta = v.correcta;
  if (Array.isArray(v.correctas)) p.correctas = [...new Set(v.correctas.map(Number).filter(Number.isInteger))].slice(0, 8);
  if (Array.isArray(v.respuestas)) p.respuestas = textos(v.respuestas, 10);
  if (Array.isArray(v.pares)) p.pares = v.pares.filter((x) => Array.isArray(x) && x.length === 2).map((x) => [texto(x[0], 500), texto(x[1], 500)] as [string, string]).slice(0, 12);
  if (Array.isArray(v.elementos)) p.elementos = textos(v.elementos, 12);
  if (Array.isArray(v.categorias)) {
    p.categorias = v.categorias
      .map((c) => ({ nombre: texto(c?.nombre, 200), elementos: textos(c?.elementos, 15) }))
      .filter((c) => c.nombre && c.elementos.length)
      .slice(0, 6);
  }
  if (texto(v.material)) p.material = texto(v.material);
  if (v.valor !== undefined && v.valor !== null && Number.isFinite(Number(v.valor))) p.valor = Number(v.valor);
  if (Number(v.tolerancia) > 0) p.tolerancia = Math.abs(Number(v.tolerancia));
  if (texto(v.unidades, 60)) p.unidades = texto(v.unidades, 60);
  if (texto(v.explicacion)) p.explicacion = texto(v.explicacion);
  if (texto(v.solucion)) p.solucion = texto(v.solucion);
  const rubrica = TIPOS_CON_RUBRICA.includes(p.tipo) ? limpiarRubrica(v.rubrica) : undefined;
  if (rubrica) p.rubrica = rubrica;
  const errores = textos(v.errores, 12);
  if (errores.length) p.errores = errores;
  const criterios = textos(v.criterios, 12);
  if (criterios.length) p.criterios = criterios;
  if (texto(v.origen, 300)) p.origen = texto(v.origen, 300);
  if (v.lineas !== undefined && v.lineas !== null && String(v.lineas) !== '') p.lineas = Math.min(40, Math.max(0, Math.round(Number(v.lineas) || 0)));
  return p;
}

const orden = (t: TipoActividad) => TIPOS_ACTIVIDAD.findIndex((x) => x.id === t);

export class FlujoExamenes extends FlujoAsignatura {
  protected dirFuentesExamen(asig: string, id: string) {
    return path.join(this.almacen.dirExamen(asig, id), 'fuentes');
  }

  /** Lee, cambia y guarda un examen, de uno en uno. */
  protected cambiarExamen(asig: string, id: string, fn: (ex: Examen) => void): Promise<Examen> {
    return this.conCandado(`${asig}/examenes/${id}`, async () => {
      const ex = await this.almacen.leerExamen(asig, id);
      fn(ex);
      ex.actualizado = new Date().toISOString();
      await this.almacen.guardarExamen(asig, ex);
      return ex;
    });
  }

  listarExamenes(asig: string) {
    return this.almacen.listarExamenes(asig);
  }

  examen(asig: string, id: string) {
    return this.almacen.leerExamen(asig, id);
  }

  /** Opciones de un examen a partir de lo que llega de la interfaz. */
  protected async limpiarOpciones(asig: string, entrada: Partial<OpcionesExamen>, previas: OpcionesExamen): Promise<OpcionesExamen> {
    const a = await this.almacen.obtenerAsignatura(asig);
    const ids = new Set(a.documentos.map((d) => d.id));
    const fuentes = new Set((await this.almacen.listarFuentes(asig)).map((f) => f.nombre));
    const op: OpcionesExamen = { ...previas };
    if (Array.isArray(entrada.documentos)) {
      op.documentos = entrada.documentos
        .filter((d) => d && ids.has(d.id))
        .map((d) => ({ id: d.id, secciones: Array.isArray(d.secciones) ? d.secciones.filter((s) => typeof s === 'string').slice(0, 200) : [] }));
    }
    if (Array.isArray(entrada.fuentesAsignatura)) op.fuentesAsignatura = entrada.fuentesAsignatura.filter((f) => fuentes.has(f));
    if (entrada.tipos && typeof entrada.tipos === 'object') {
      op.tipos = Object.fromEntries(
        TIPOS_ACTIVIDAD.map((t) => [t.id, Math.min(maximoTipoExamen(t.id), Math.max(0, Math.round(Number(entrada.tipos![t.id]) || 0)))]).filter(([, n]) => n),
      );
    }
    if (DIFICULTADES.some((d) => d.id === entrada.dificultad)) op.dificultad = entrada.dificultad!;
    if (entrada.total !== undefined) op.total = Math.min(1000, Math.max(1, redondear(Number(entrada.total) || 10)));
    if (entrada.duracion !== undefined) op.duracion = Math.min(600, Math.max(0, Math.round(Number(entrada.duracion) || 0))) || undefined;
    if (entrada.penalizar !== undefined) op.penalizar = !!entrada.penalizar || undefined;
    if (entrada.instrucciones !== undefined) op.instrucciones = texto(entrada.instrucciones, 3000) || undefined;
    if (entrada.indicaciones !== undefined) op.indicaciones = texto(entrada.indicaciones, 3000) || undefined;
    // Answer space is opt-in; preserve the selection for previews and exports.
    if (entrada.espacio !== undefined) op.espacio = entrada.espacio === true;
    if (entrada.tablaNotas !== undefined) op.tablaNotas = entrada.tablaNotas === false ? false : undefined;
    if (entrada.hojaRespuestas !== undefined) op.hojaRespuestas = !!entrada.hojaRespuestas || undefined;
    if (entrada.modeloB !== undefined) op.modeloB = !!entrada.modeloB || undefined;
    if (entrada.elegir && typeof entrada.elegir === 'object') {
      const elegir = Object.fromEntries(
        TIPOS_ACTIVIDAD.map((t) => [t.id, Math.max(0, Math.round(Number(entrada.elegir![t.id]) || 0))]).filter(([, n]) => n),
      );
      op.elegir = Object.keys(elegir).length ? elegir : undefined;
    }
    return op;
  }

  async crearExamen(asig: string, datos: { titulo?: string; opciones?: Partial<OpcionesExamen> }) {
    const titulo = texto(datos.titulo, 150) || 'Examen';
    const a = await this.almacen.obtenerAsignatura(asig);
    // Por defecto, sobre todos los documentos con algo escrito
    const documentos = a.documentos.map((d) => ({ id: d.id, secciones: [] }));
    const opciones = await this.limpiarOpciones(asig, datos.opciones ?? {}, { ...OPCIONES_EXAMEN, documentos });
    const id = await this.almacen.reservarExamen(asig, titulo);
    const ahora = new Date().toISOString();
    const ex: Examen = { id, titulo, opciones, estado: 'borrador', preguntas: [], creado: ahora, actualizado: ahora };
    await this.almacen.guardarExamen(asig, ex);
    await fs.mkdir(this.dirFuentesExamen(asig, id), { recursive: true });
    return ex;
  }

  async editarExamen(asig: string, id: string, datos: { titulo?: string; opciones?: Partial<OpcionesExamen> }) {
    const previo = await this.almacen.leerExamen(asig, id);
    const opciones = datos.opciones ? await this.limpiarOpciones(asig, datos.opciones, previo.opciones) : previo.opciones;
    return this.cambiarExamen(asig, id, (ex) => {
      if (texto(datos.titulo, 150)) ex.titulo = texto(datos.titulo, 150);
      ex.opciones = opciones;
    });
  }

  async eliminarExamen(asig: string, id: string) {
    if (this.ocupado('examen', asig, undefined, undefined, id) || this.dep.cola.listar().some((t) => t.paso === 'examen' && t.asignatura === asig && t.ref?.startsWith(`${id}/`) && (t.estado === 'ejecutando' || t.estado === 'en-cola'))) {
      throw new ErrorUsuario('Espera a que termine el agente que trabaja en este examen (o cancélalo)');
    }
    await this.conCandado(`${asig}/examenes/${id}`, () => this.almacen.eliminarExamen(asig, id));
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Archivos propios del examen (documentos que no se han hecho con la aplicación)

  async fuentesExamen(asig: string, id: string): Promise<{ nombre: string; tamano: number; estado?: InfoIndice['estado']; paginas?: number }[]> {
    await this.almacen.leerExamen(asig, id);
    const dir = this.dirFuentesExamen(asig, id);
    await fs.mkdir(dir, { recursive: true });
    const indice = await this.prepararFuentesExamen(asig, id);
    const res = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name.startsWith('.')) continue;
      const st = await fs.stat(path.join(dir, e.name));
      const i = indice.find((x) => x.archivo === e.name);
      res.push({ nombre: e.name, tamano: st.size, estado: i?.estado, paginas: i?.paginas });
    }
    return res.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  /** Ruta libre para un archivo nuevo del examen. */
  async rutaFuenteExamen(asig: string, id: string, nombre: string) {
    await this.almacen.leerExamen(asig, id);
    const dir = this.dirFuentesExamen(asig, id);
    await fs.mkdir(dir, { recursive: true });
    const limpio = path.basename(nombre).replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '') || 'archivo';
    const ext = path.extname(limpio);
    let final = limpio;
    for (let i = 2; existsSync(path.join(dir, final)); i++) final = `${path.basename(limpio, ext)} (${i})${ext}`;
    return path.join(dir, final);
  }

  async eliminarFuenteExamen(asig: string, id: string, nombre: string) {
    if (!nombre || nombre.startsWith('.') || /[\\/:*?"<>|]/.test(nombre)) throw new ErrorUsuario('Nombre no válido');
    await fs.rm(path.join(this.dirFuentesExamen(asig, id), nombre), { force: true });
    await this.prepararFuentesExamen(asig, id);
    return { ok: true };
  }

  /** Extrae el texto de los archivos del examen (Word, LibreOffice…) y los indexa. */
  async prepararFuentesExamen(asig: string, id: string): Promise<InfoIndice[]> {
    const dir = this.dirFuentesExamen(asig, id);
    if (!existsSync(dir)) return [];
    if (this.dep.dirBin) await asegurarTextos(dir, this.dep.dirBin).catch(() => {});
    return indexar(dir).catch(() => []);
  }

  // ---------------------------------------------------------------------------
  // Material: lo que va en el mensaje y lo que el agente tiene que leer o buscar

  protected async materialExamen(asig: string, ex: Examen) {
    const op = ex.opciones;
    const partes: string[] = [];
    const lista: string[] = [];
    const leer: string[] = []; // no caben en el mensaje: el agente los lee
    const directos: string[] = []; // sin texto extraíble (escaneados, imágenes): el agente los abre
    let usado = 0;
    const meter = (titulo: string, contenido: string) => {
      if (usado + contenido.length > MAX_MATERIAL) return false;
      usado += contenido.length;
      partes.push(`===== ${titulo} =====`, contenido.trim(), `===== fin de ${titulo} =====`);
      return true;
    };
    const a = await this.almacen.obtenerAsignatura(asig);
    for (const sel of op.documentos) {
      const d = a.documentos.find((x) => x.id === sel.id);
      if (!d) continue;
      const secciones = (await this.almacen.listarSecciones(asig, d.id)).filter(
        (s) => !ARCHIVO_AUTOEVALUACION.test(s.archivo) && s.palabras > 40 && (!sel.secciones.length || sel.secciones.includes(s.archivo)),
      );
      if (!secciones.length) continue;
      lista.push(`- Documento «${d.titulo}»${sel.secciones.length ? `, solo estas secciones: ${secciones.map((s) => `«${s.titulo}»`).join(', ')}` : ' (entero)'}`);
      for (const s of secciones) {
        const rel = `documentos/${d.id}/secciones/${s.archivo}`;
        if (!meter(rel, await this.almacen.leerSeccion(asig, d.id, s.archivo))) leer.push(rel);
      }
    }
    // Archivos subidos al examen (todos) y fuentes elegidas de la asignatura
    const dirExamen = this.dirFuentesExamen(asig, ex.id);
    const indiceExamen = await this.prepararFuentesExamen(asig, ex.id);
    await this.prepararFuentes(asig).catch(() => {});
    const archivos: { rel: string; dir: string; nombre: string }[] = [];
    if (existsSync(dirExamen)) {
      for (const e of await fs.readdir(dirExamen, { withFileTypes: true })) {
        if (e.isFile() && !e.name.startsWith('.')) archivos.push({ rel: `examenes/${ex.id}/fuentes/${e.name}`, dir: dirExamen, nombre: e.name });
      }
    }
    for (const f of op.fuentesAsignatura) {
      if (existsSync(path.join(this.almacen.dirFuentes(asig), f))) archivos.push({ rel: `fuentes/${f}`, dir: this.almacen.dirFuentes(asig), nombre: f });
    }
    let buscar = false;
    for (const f of archivos) {
      const contenido = await leerPagina({ x: f.dir }, f.nombre).catch(() => '');
      const sinTexto = f.dir === dirExamen && indiceExamen.find((i) => i.archivo === f.nombre)?.estado !== 'indexado';
      lista.push(`- Archivo \`${f.rel}\``);
      if (!contenido.trim() || sinTexto) directos.push(f.rel);
      else if (!meter(f.rel, contenido)) buscar = true;
    }
    return { lista, partes, leer, directos, buscar, carpetas: { asignatura: this.almacen.dirFuentes(asig), examen: dirExamen }, vacio: !lista.length };
  }

  /** Texto común de las dos tareas (examen entero y una pregunta): material y currículo. */
  protected async contextoExamen(asig: string, ex: Examen) {
    const m = await this.materialExamen(asig, ex);
    if (m.vacio) throw new ErrorUsuario('Elige el material del examen: algún documento con secciones redactadas, una fuente o un archivo subido');
    const curriculo = (await this.curriculumReference(asig)).trim();
    const texto = `## Material del examen
Pregunta SOLO por lo que está en este material, no por contenidos que no aparezcan en él:
${m.lista.join('\n')}
${m.leer.length ? `\nNo caben en este mensaje y tienes que leerlos: ${m.leer.map((r) => `\`${r}\``).join(', ')}.` : ''}${
      m.directos.length ? `\nSin texto extraíble (escaneados o imágenes): ábrelos y léelos directamente: ${m.directos.map((r) => `\`${r}\``).join(', ')}.` : ''
    }${m.buscar ? '\nAlgunos archivos son demasiado largos para incluirlos enteros: búscalos con `buscar_en_fuentes` y lee sus páginas con `leer_pagina`.' : ''}
${curriculo ? `\n## Currículo estructurado activo\nIndica en «criterios» qué criterios de evaluación de este currículo evalúa cada pregunta (su numeración, p. ej. «1.2» o «RA2.b»).\n\n${curriculo}\n` : ''}${
      m.partes.length ? `\n## Contenido del material (ya incluido: no hace falta que lo leas)\n${m.partes.join('\n')}` : ''
    }`;
    return { texto, carpetas: m.carpetas };
  }

  // ---------------------------------------------------------------------------
  // Generación

  /** Create an independent adaptation from a durable snapshot of the source exam. */
  async adaptExam(subjectId: string, examId: string, request: ExamAdaptationRequest): Promise<Examen> {
    const variant = EXAM_ADAPTATIONS.find((item) => item.id === request?.kind);
    if (!variant) throw new ErrorUsuario('Tipo de adaptación no válido');
    const source = await this.almacen.leerExamen(subjectId, examId);
    if (source.estado === 'generando' || this.ocupado('examen', subjectId, undefined, undefined, examId)
      || this.dep.cola.listar().some((job) => job.asignatura === subjectId && job.paso === 'examen' && job.ref?.startsWith(`${examId}/`) && ['ejecutando', 'en-cola'].includes(job.estado))) {
      throw new ErrorUsuario('Espera a que termine el agente que trabaja en este examen');
    }
    if (!source.preguntas.length) throw new ErrorUsuario('El examen todavía no tiene preguntas');
    if (source.adaptation && !source.adaptation.completedAt) throw new ErrorUsuario('La adaptación todavía no está lista');
    if (!Array.isArray(request.questionIds) || !request.questionIds.length
      || new Set(request.questionIds).size !== request.questionIds.length
      || request.questionIds.some((id) => !source.preguntas.some((question) => question.id === id))) {
      throw new ErrorUsuario('Selecciona preguntas válidas para adaptar');
    }
    const title = `${source.titulo} — ${variant.name}`.slice(0, 150);
    const copyId = await this.almacen.reservarExamen(subjectId, title);
    const now = new Date().toISOString();
    const copy: Examen = {
      id: copyId, titulo: title, opciones: structuredClone(source.opciones), preguntas: [],
      estado: 'generando', creado: now, actualizado: now,
      adaptation: {
        kind: variant.id, sourceExamId: source.id, sourceTitle: source.titulo, sourceUpdatedAt: source.actualizado,
        questionIds: [...request.questionIds], instructions: texto(request.instructions, 3000) || undefined,
        originalQuestions: structuredClone(source.preguntas),
      },
    };
    await this.almacen.guardarExamen(subjectId, copy);
    try {
      const sourceFiles = this.dirFuentesExamen(subjectId, examId);
      const targetFiles = this.dirFuentesExamen(subjectId, copyId);
      if (existsSync(sourceFiles)) await fs.cp(sourceFiles, targetFiles, { recursive: true });
      else await fs.mkdir(targetFiles, { recursive: true });
      const output = this.salida(`examen-${copyId}`);
      const { selectedQuestions: selected, referenceQuestions } = selectExamAdaptationContext(source.preguntas, request.questionIds);
      await this.lanzar({
        agente: 'examinador', asignatura: subjectId, titulo: `Adaptación: ${title}`, paso: 'examen', ref: copyId,
        carpetas: { asignatura: this.almacen.dirFuentes(subjectId), examen: targetFiles },
        tarea: `Adapta las preguntas seleccionadas del examen «${source.titulo}».
Modalidad: ${variant.name}. ${variant.description}
${variant.id === 'extension'
  ? 'Aumenta la profundidad cognitiva y exige justificar, aplicar o relacionar. No introduzcas contenidos ajenos al examen.'
  : 'Mantén los objetivos, criterios de evaluación y dificultad originales. Facilita el acceso al enunciado, sin simplificar el conocimiento evaluado.'}
${variant.id === 'supported' ? 'Divide las instrucciones en pasos y añade apoyos textuales o ejemplos de cómo organizar la respuesta. No resuelvas la pregunta ni des pistas sobre la opción correcta. No uses imágenes externas.' : ''}
Mantén EXACTAMENTE el id, tipo, orden, puntos y criterios de evaluación de cada pregunta seleccionada.
Revisa y adapta también explicacion, solucion, rubrica y errores para que correspondan al nuevo enunciado.
Las preguntas abiertas (${TIPOS_CON_RUBRICA.join(', ')}) deben incluir solucion y rubrica con criterios observables cuyos puntos sumen los de la pregunta.
Conserva los campos propios del tipo de pregunta (opciones, correcta, correctas, respuestas, valor, tolerancia, unidades, etc.) y comprueba la validez de cada respuesta.
Usa el mismo idioma que el examen original. No incluyas las soluciones dentro del enunciado.
No modifiques ningún archivo del material ni el examen original.
${copy.adaptation!.instructions ? `Indicaciones adicionales del docente: ${copy.adaptation!.instructions}` : ''}

Preguntas seleccionadas completas (incluyen sus soluciones y rúbricas):
${JSON.stringify({ instrucciones: source.opciones.instrucciones, preguntas: selected })}

Otras preguntas, solo como referencia para conservar datos compartidos y evitar repeticiones (sin su desarrollo de corrección):
${JSON.stringify(referenceQuestions)}
Si una pregunta seleccionada depende de una solución o rúbrica omitida, consulta únicamente esa pregunta en adaptation.originalQuestions de \`examenes/${copyId}/examen.json\`. Esa instantánea conserva el examen original completo; no modifiques ese archivo.

Devuelve SOLO las preguntas con estos ids, exactamente una por id: ${JSON.stringify(selected.map((question) => question.id))}.
Escribe en \`${output}\` un JSON con esta estructura: {"preguntas": [cada pregunta adaptada completa, incluido su id]}.
Las preguntas no seleccionadas se conservarán automáticamente sin cambios.`,
        post: { tipo: 'examen', datos: { salida: output, id: copyId, adaptation: true } },
      });
    } catch (error) {
      await this.cambiarExamen(subjectId, copyId, (exam) => {
        exam.estado = 'error';
        exam.error = (error as Error).message;
      });
      // Keep the failed copy visible so that it can be inspected or deleted.
    }
    return this.almacen.leerExamen(subjectId, copyId);
  }

  /** Genera (o rehace) todas las preguntas del examen con las opciones guardadas. */
  async generarExamen(asig: string, id: string, opciones?: Partial<OpcionesExamen>) {
    if (opciones) await this.editarExamen(asig, id, { opciones });
    const ex = await this.almacen.leerExamen(asig, id);
    if (ex.adaptation) throw new ErrorUsuario('Crea otra versión desde el examen original para volver a adaptarlo; puedes editar las preguntas de esta copia');
    if (ex.estado === 'generando' || this.ocupado('examen', asig, undefined, undefined, id)) throw new ErrorUsuario('El examen ya se está generando');
    const pedidas = tiposExamen(ex.opciones);
    if (!pedidas.length) throw new ErrorUsuario('Elige al menos un tipo de pregunta');
    const total = pedidas.reduce((n, [, c]) => n + c, 0);
    if (total > MAX_PREGUNTAS_EXAMEN) throw new ErrorUsuario(`Como máximo ${MAX_PREGUNTAS_EXAMEN} preguntas por examen`);
    const { texto: contexto, carpetas } = await this.contextoExamen(asig, ex);
    const op = ex.opciones;
    const salida = this.salida(`examen-${id}`);
    const dificultad = DIFICULTADES.find((d) => d.id === op.dificultad)!.nombre.toLowerCase();
    await this.cambiarExamen(asig, id, (e) => {
      e.estado = 'generando';
      e.error = undefined;
    });
    try {
      return await this.lanzar({
        agente: 'examinador',
        asignatura: asig,
        titulo: `Examen: ${ex.titulo}`,
        paso: 'examen',
        ref: id,
        carpetas,
        indicaciones: op.indicaciones,
        tarea: `Prepara el examen «${ex.titulo}», con su solucionario y su rúbrica de corrección.

${contexto}

## Preguntas
- De cada tipo, exactamente:
${pedidas.map(([t, n]) => `  · ${n} de tipo «${t}» (${nombreTipo(t)})`).join('\n')}
- Dificultad: ${dificultad}, adecuada a los destinatarios. Combina preguntas de recordar, comprender, aplicar y relacionar.
- Reparte las preguntas por todo el material, sin repetir ideas. Enunciados claros y autosuficientes (con todos los datos necesarios), sin ambigüedades ni pistas en la redacción.
- En las de test y respuesta múltiple, nada de «todas las anteriores» ni «ninguna de las anteriores»: las opciones se pueden desordenar.
- Puntuación total: exactamente ${op.total} puntos. Da a cada pregunta los «puntos» que correspondan a su dificultad y al trabajo que pide (una de test vale menos que una de desarrollo), en múltiplos de 0,25.${
          op.duracion ? `\n- Duración: ${op.duracion} minutos. Que se pueda hacer con calma en ese tiempo.` : ''
        }${op.penalizar ? '\n- En las de test, los errores restan: que haya una sola respuesta claramente correcta.' : ''}
- En cada pregunta:
  · «explicacion»: por qué la respuesta es esa (breve).
  · «solucion»: en las abiertas (${TIPOS_CON_RUBRICA.join(', ')}), la respuesta modelo completa, tal como la escribiría un alumno excelente (en «ejercicio», la resolución paso a paso con el resultado). En las demás, no hace falta.
  · Solo en ${TIPOS_CON_RUBRICA.map((t) => `«${t}»`).join(', ')}: «rubrica», con 2-4 criterios observables. Cada criterio tiene sus «puntos» (los de los criterios suman los de la pregunta) y los mismos cuatro niveles en el mismo orden: «Excelente» (todos los puntos del criterio), «Adecuado», «Insuficiente» y «No lo hace» (0), cada uno con una descripción concreta de lo que hace el alumno y sus puntos. Y «errores»: los errores frecuentes y cuánto restan.
  · «origen»: el documento o archivo del que sale.
  · «criterios»: los criterios de evaluación del currículo que evalúa (si se ha incluido el currículo; si no, lista vacía).
- Fórmulas en LaTeX entre $…$. Sin imágenes ni diagramas.
- Comprueba cada respuesta y cada cálculo antes de escribirlo.

NO modifiques ningún archivo del material. Escribe SOLO en \`${salida}\` este JSON exacto, con las preguntas agrupadas por tipo en ese orden:
{"preguntas": [
${pedidas.map(([t]) => `  {"tipo": "${t}", "puntos": 1, ${FORMATO_PREGUNTA[t].slice(1)}`).join(',\n')}
]}
Cada pregunta lleva además «origen» y «criterios»${pedidas.some(([t]) => TIPOS_CON_RUBRICA.includes(t)) ? '; las abiertas, también «solucion», «rubrica» y «errores»:\n{"solucion": "…", "rubrica": [{"criterio": "…", "puntos": 1, "niveles": [{"nivel": "Excelente", "descripcion": "…", "puntos": 1}, {"nivel": "Adecuado", "descripcion": "…", "puntos": 0.5}, {"nivel": "Insuficiente", "descripcion": "…", "puntos": 0.25}, {"nivel": "No lo hace", "descripcion": "…", "puntos": 0}]}], "errores": ["… (−0,25)"]}' : '.'}`,
        post: { tipo: 'examen', datos: { salida, id } },
      });
    } catch (e) {
      await this.cambiarExamen(asig, id, (x) => Object.assign(x, { estado: ex.preguntas.length ? 'listo' : 'borrador', error: (e as Error).message })).catch(() => {});
      throw e;
    }
  }

  /** Rehace una pregunta (`preguntaId`) o añade una nueva del tipo indicado. */
  async pedirPreguntaExamen(asig: string, id: string, datos: { preguntaId?: string; tipo?: TipoActividad; indicaciones?: string }) {
    const ex = await this.almacen.leerExamen(asig, id);
    if (ex.estado === 'generando') throw new ErrorUsuario('Espera a que termine de generarse el examen');
    const previa = datos.preguntaId ? ex.preguntas.find((p) => p.id === datos.preguntaId) : undefined;
    if (datos.preguntaId && !previa) throw new ErrorUsuario('Pregunta no encontrada', 404);
    const tipo = previa?.tipo ?? datos.tipo;
    if (!tipo || !TIPOS_ACTIVIDAD.some((t) => t.id === tipo)) throw new ErrorUsuario('Elige el tipo de la pregunta');
    const ref = `${id}/${previa?.id ?? 'nueva'}`;
    if (this.ocupado('examen', asig, undefined, undefined, ref)) throw new ErrorUsuario(previa ? 'Esta pregunta ya se está rehaciendo' : 'Ya se está añadiendo una pregunta');
    if (!previa && ex.preguntas.length >= MAX_PREGUNTAS_EXAMEN) throw new ErrorUsuario(`Como máximo ${MAX_PREGUNTAS_EXAMEN} preguntas por examen`);
    const { texto: contexto, carpetas } = await this.contextoExamen(asig, ex);
    const salida = this.salida(`pregunta-${id}`);
    const n = previa ? ex.preguntas.indexOf(previa) + 1 : 0;
    const otras = ex.preguntas
      .filter((p) => p !== previa)
      .map((p) => `- (${p.tipo}) ${p.enunciado.replace(/\s+/g, ' ').slice(0, 220)}`)
      .join('\n');
    const conRubrica = TIPOS_CON_RUBRICA.includes(tipo);
    return this.lanzar({
      agente: 'examinador',
      asignatura: asig,
      titulo: previa ? `Examen «${ex.titulo}»: rehacer la pregunta ${n}` : `Examen «${ex.titulo}»: nueva pregunta (${nombreTipo(tipo).toLowerCase()})`,
      paso: 'examen',
      ref,
      carpetas,
      indicaciones: texto(datos.indicaciones, 3000) || undefined,
      tarea: `${
        previa
          ? `Rehaz la pregunta ${n} del examen «${ex.titulo}». Es de tipo «${tipo}» y vale ${previa.puntos} puntos. Ahora es esta:\n\n\`\`\`json\n${JSON.stringify(previa, null, 1)}\n\`\`\`\n\nEscribe otra pregunta que la sustituya${datos.indicaciones?.trim() ? ', siguiendo las indicaciones del usuario' : ' (distinta, sobre el mismo contenido u otro cercano, con la misma dificultad)'}.`
          : `Añade una pregunta nueva de tipo «${tipo}» (${nombreTipo(tipo)}) al examen «${ex.titulo}».`
      }

Dificultad del examen: ${DIFICULTADES.find((d) => d.id === ex.opciones.dificultad)!.nombre.toLowerCase()}. No repitas lo que ya preguntan las demás:
${otras || '(no hay más preguntas)'}

${contexto}

## Formato
- «explicacion»: por qué la respuesta es esa (breve).${
        conRubrica
          ? `\n- «solucion»: ${tipo === 'ejercicio' ? 'la resolución paso a paso con el resultado' : 'la respuesta modelo completa'}.\n- «rubrica»: 2-4 criterios observables; sus «puntos» suman los de la pregunta; cada uno con los niveles «Excelente» (todos los puntos del criterio), «Adecuado», «Insuficiente» y «No lo hace» (0), con descripción y puntos.\n- «errores»: errores frecuentes y cuánto restan.`
          : ''
      }
- «origen»: el documento o archivo del que sale; «criterios»: criterios de evaluación del currículo que evalúa (o lista vacía).
- Fórmulas en LaTeX entre $…$. Comprueba la respuesta antes de escribirla.

NO modifiques ningún otro archivo. Escribe SOLO en \`${salida}\` este JSON exacto:
{"pregunta": {"tipo": "${tipo}", "puntos": ${previa?.puntos ?? 1}, ${FORMATO_PREGUNTA[tipo].slice(1)}}
(con «origen» y «criterios»${conRubrica ? ', «solucion», «rubrica» y «errores»' : ''} dentro de «pregunta»)`,
      post: { tipo: 'examen-pregunta', datos: { salida, id, preguntaId: previa?.id, tipo } },
    });
  }

  protected async leerSalidaAsig<T>(asig: string, rel: string): Promise<T> {
    let contenido: string;
    try {
      contenido = await fs.readFile(path.join(this.almacen.dirAsignatura(asig), rel), 'utf8');
    } catch {
      throw new PedirAlAgente('El agente no ha escrito el archivo de resultado.', `No encuentro \`${rel}\`. Escribe en ese archivo el JSON pedido.`);
    }
    try {
      return extraerJson<T>(contenido);
    } catch {
      throw new PedirAlAgente('El resultado no es un JSON válido.', `\`${rel}\` no contiene JSON válido. Vuelve a escribirlo con el JSON exacto que se pidió.`);
    }
  }

  /** Resultado del examen entero: se comprueba, se ajusta la puntuación y se guarda. */
  protected async postExamen(t: Trabajo, datos: Record<string, unknown>): Promise<string> {
    const asig = t.asignatura;
    const id = String(datos.id);
    const salida = String(datos.salida);
    const ex = await this.almacen.leerExamen(asig, id).catch(() => undefined);
    if (!ex) return 'El examen se ha eliminado mientras se generaba';
    if (datos.adaptation === true) return this.processExamAdaptation(asig, ex, salida);
    const r = await this.leerSalidaAsig<{ preguntas?: Partial<PreguntaExamen>[] }>(asig, salida);
    const pedidas = new Set(tiposExamen(ex.opciones).map(([tipo]) => tipo));
    const recibidas = Array.isArray(r.preguntas) ? r.preguntas : [];
    const validas = recibidas
      .filter((p) => p && pedidas.has(p.tipo as TipoActividad))
      .map((p) => limpiarPregunta(p, randomUUID().slice(0, 8)))
      .filter((p) => preguntaValida(p as PreguntaActividad))
      .sort((a, b) => orden(a.tipo) - orden(b.tipo));
    if (!validas.length) {
      throw new PedirAlAgente('Las preguntas no tienen el formato pedido.', `Ninguna pregunta de \`${salida}\` tiene el formato pedido (cada una con su «tipo», sus «puntos» y sus campos). Vuelve a escribir el archivo con el JSON exacto.`);
    }
    const preguntas = repartirPuntos({ preguntas: validas, opciones: ex.opciones });
    await this.cambiarExamen(asig, id, (e) => {
      e.preguntas = preguntas;
      e.estado = 'listo';
      e.error = undefined;
    });
    const descartadas = recibidas.length - validas.length;
    return `Examen listo: ${preguntas.length} preguntas${descartadas ? ` (${descartadas} descartadas por formato)` : ''}. Revísalo en la pestaña «Exámenes» de la asignatura.`;
  }

  /** Reject incomplete adaptations before replacing the snapshot with a usable copy. */
  protected async processExamAdaptation(subjectId: string, exam: Examen, output: string): Promise<string> {
    const adaptation = exam.adaptation;
    if (!adaptation) throw new ErrorUsuario('No se encuentra el origen de la adaptación');
    if (adaptation.completedAt) return 'La adaptación ya se había incorporado';
    const result = await this.leerSalidaAsig<{ preguntas?: Partial<PreguntaExamen>[] } | null>(subjectId, output);
    const received = Array.isArray(result?.preguntas) ? result.preguntas : [];
    const reject = (): never => {
      throw new PedirAlAgente('La adaptación está incompleta o no conserva las preguntas.',
        `Reescribe \`${output}\`: incluye exactamente una pregunta completa y válida por cada id seleccionado (${adaptation.questionIds.join(', ')}), con el mismo tipo. Las abiertas necesitan solucion y rubrica. No añadas ni omitas preguntas.`);
    };
    if (received.length !== adaptation.questionIds.length || new Set(received.map((question) => question?.id)).size !== received.length) reject();
    const replacements = new Map<string, PreguntaExamen>();
    for (const raw of received) {
      const original = adaptation.originalQuestions.find((question) => question.id === raw?.id);
      if (!original || !adaptation.questionIds.includes(original.id) || raw.tipo !== original.tipo) return reject();
      let question: PreguntaExamen;
      try {
        question = limpiarPregunta({ ...raw, puntos: original.puntos, criterios: original.criterios, origen: original.origen, lineas: original.lineas }, original.id);
      } catch {
        return reject();
      }
      if (!preguntaValida(question) || (TIPOS_CON_RUBRICA.includes(question.tipo) && (!question.solucion || !question.rubrica?.length))) return reject();
      replacements.set(original.id, ajustarRubrica(question));
    }
    if (adaptation.questionIds.some((id) => !replacements.has(id))) reject();
    await this.cambiarExamen(subjectId, exam.id, (current) => {
      if (current.adaptation?.completedAt) return;
      current.preguntas = adaptation.originalQuestions.map((question) => replacements.get(question.id) ?? structuredClone(question));
      current.estado = 'listo';
      current.error = undefined;
      current.adaptation!.completedAt = new Date().toISOString();
    });
    return 'Versión adaptada lista. Revisa sus preguntas, solucionario y rúbrica antes de utilizarla.';
  }

  /** Resultado de una pregunta rehecha o nueva. */
  protected async postPreguntaExamen(t: Trabajo, datos: Record<string, unknown>): Promise<string> {
    const asig = t.asignatura;
    const id = String(datos.id);
    const salida = String(datos.salida);
    const preguntaId = datos.preguntaId ? String(datos.preguntaId) : undefined;
    const r = await this.leerSalidaAsig<{ pregunta?: Partial<PreguntaExamen> }>(asig, salida);
    const nueva = limpiarPregunta({ ...(r.pregunta ?? {}), tipo: datos.tipo as TipoActividad }, preguntaId ?? randomUUID().slice(0, 8));
    if (!preguntaValida(nueva as PreguntaActividad)) {
      throw new PedirAlAgente('La pregunta no tiene el formato pedido.', `La pregunta de \`${salida}\` no tiene el formato pedido para el tipo «${nueva.tipo}». Vuelve a escribir el archivo con el JSON exacto.`);
    }
    let encontrada = !preguntaId;
    await this.cambiarExamen(asig, id, (e) => {
      if (preguntaId) {
        const i = e.preguntas.findIndex((p) => p.id === preguntaId);
        if (i < 0) return;
        encontrada = true;
        e.preguntas[i] = ajustarRubrica({ ...nueva, puntos: e.preguntas[i].puntos });
      } else {
        if (!nueva.puntos) nueva.puntos = 1;
        // Junto a las de su tipo
        const despues = e.preguntas.findLastIndex((p) => orden(p.tipo) <= orden(nueva.tipo));
        e.preguntas.splice(despues + 1, 0, ajustarRubrica(nueva));
      }
      if (e.estado !== 'generando') e.estado = 'listo';
    });
    if (!encontrada) return 'La pregunta se ha eliminado mientras se rehacía';
    return preguntaId ? 'Pregunta rehecha' : `Pregunta añadida (${nueva.puntos} puntos). Revisa la puntuación total del examen.`;
  }

  /** Si el agente del examen falla o se cancela. */
  protected async alFallarExamen(t: Trabajo, datos: Record<string, unknown>) {
    const ultimo = t.eventos.filter((e) => e.tipo === 'error').at(-1)?.texto;
    await this.cambiarExamen(t.asignatura, String(datos.id), (e) => {
      e.estado = e.preguntas.length ? 'listo' : 'error';
      e.error = t.estado === 'cancelado' ? 'Cancelado' : ultimo ?? 'No se pudo generar';
    }).catch(() => {});
  }

  protected async alReintentarExamen(t: Trabajo, datos: Record<string, unknown>) {
    await this.cambiarExamen(t.asignatura, String(datos.id), (e) => {
      e.estado = 'generando';
      e.error = undefined;
    });
  }

  // ---------------------------------------------------------------------------
  // Edición a mano

  async editarPreguntaExamen(asig: string, id: string, preguntaId: string, cambios: Partial<PreguntaExamen>) {
    return this.cambiarExamen(asig, id, (e) => {
      const i = e.preguntas.findIndex((p) => p.id === preguntaId);
      if (i < 0) throw new ErrorUsuario('Pregunta no encontrada', 404);
      const previa = e.preguntas[i];
      const nueva = limpiarPregunta({ ...previa, ...cambios, tipo: previa.tipo }, previa.id);
      if (!preguntaValida(nueva as PreguntaActividad)) throw new ErrorUsuario(`Faltan datos de la pregunta (${nombreTipo(previa.tipo).toLowerCase()})`);
      e.preguntas[i] = ajustarRubrica(nueva);
    });
  }

  async eliminarPreguntaExamen(asig: string, id: string, preguntaId: string) {
    return this.cambiarExamen(asig, id, (e) => {
      e.preguntas = e.preguntas.filter((p) => p.id !== preguntaId);
    });
  }

  /** Nuevo orden de las preguntas (ids en orden; las que falten van al final). */
  async ordenarPreguntasExamen(asig: string, id: string, ids: string[]) {
    return this.cambiarExamen(asig, id, (e) => {
      const pos = new Map(ids.map((x, i) => [x, i]));
      e.preguntas = [...e.preguntas].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
    });
  }

  /** Reparte de nuevo la puntuación para que sume `total` (y lo guarda como total del examen). */
  async ajustarPuntuacion(asig: string, id: string, total?: number) {
    return this.cambiarExamen(asig, id, (e) => {
      if (total !== undefined) e.opciones.total = Math.min(1000, Math.max(1, redondear(Number(total) || e.opciones.total)));
      e.preguntas = repartirPuntos(e);
    });
  }
}
