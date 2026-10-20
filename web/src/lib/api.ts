import type {
  Esfuerzo,
  ModoMejora,
  VersionSeccion,
  ModelosDisponibles,
  PerfilGasto,
  HerramientasChat,
  SeleccionTexto,
  MezclaVisuales,
  BusquedaImagenes,
  ResultadoImagen,
  ImagenFallida,
  Ajustes,
  ContadorTokens,
  EstadoFlujo,
  Exportado,
  Indice,
  InfoAgente,
  OpcionesExportacion,
  PropuestaVisual,
  Recurso,
  ResultadoBusqueda,
  TipoBusqueda,
  TipoRevision,
  Asignatura,
  AsignaturaDetalle,
  Documento,
  EstadoMotor,
  Fuente,
  Motor,
  Seccion,
  Trabajo,
  UsoSuscripcion,
  ElementoPapelera,
} from '../../../shared/tipos';
import type { BloqueActividad, OpcionesActividad, TipoActividad } from '../../../shared/actividades';
import type { CurriculumDraft, CurriculumProfile, CurriculumResponse, CurriculumState } from '../../../shared/curriculum';
import type { CreateProgrammeRequest, ProgrammeExportFormat, ProgrammeProject, ProgrammeProjectSummary, ProgrammePurpose, ProgrammeResponse, ProgrammeState, TeachingProgramme } from '../../../shared/teachingProgramme';
import type { Examen, OpcionesExamen, PreguntaExamen, ExamAdaptationRequest } from '../../../shared/examenes';

async function pedir<T>(metodo: string, url: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    headers: cuerpo !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((datos as { error?: string }).error ?? `Error ${r.status}`), { status: r.status });
  return datos as T;
}

const e = encodeURIComponent;
const asig = (a: string) => `/api/asignaturas/${e(a)}`;
const doc = (a: string, d: string) => `${asig(a)}/documentos/${e(d)}`;
const exa = (a: string, id: string) => `${asig(a)}/examenes/${e(id)}`;

/** Archivo subido a un examen, con el estado de su texto (si se ha podido leer). */
export interface FuenteExamen {
  nombre: string;
  tamano: number;
  estado?: 'indexado' | 'sin-texto' | 'no-admitido';
  paginas?: number;
}

/** Molécula de un bloque ```molecula (estructura tomada de PubChem). */
export interface Molecula {
  consulta: string;
  smiles: string;
  nombre?: string;
  iupac?: string;
  formula?: string;
  cid?: number;
  verificada: boolean;
}

export type AsignaturaResumen = Asignatura & { documentos: Documento[] };

export const api = {
  programmes: (a: string) => pedir<ProgrammeProjectSummary[]>('GET', `${asig(a)}/programaciones`),
  researchProgramme: (a: string, id: string, purpose: ProgrammePurpose) => pedir<Trabajo>('POST', `${asig(a)}/programaciones/${e(id)}/investigar?purpose=${purpose}`, {}),
  deleteProgramme: (a: string, id: string) => pedir<{ ok: true }>('DELETE', `${asig(a)}/programaciones/${e(id)}`),
  createProgramme: (a: string, input: CreateProgrammeRequest) => pedir<ProgrammeProject>('POST', `${asig(a)}/programaciones`, input),
  programme: (a: string, id: string, purpose: ProgrammePurpose = 'classroom') => pedir<ProgrammeResponse>('GET', `${asig(a)}/programaciones/${e(id)}?purpose=${purpose}`),
  saveProgramme: (a: string, id: string, programme: TeachingProgramme, expectedRevision: number, confirmed?: boolean) => pedir<ProgrammeState>('PUT', `${asig(a)}/programaciones/${e(id)}?purpose=${programme.purpose}`, { programme, expectedRevision, confirmed }),
  exportProgramme: async (a: string, id: string, programme: TeachingProgramme, format: ProgrammeExportFormat, reviewed = false) => {
    const result = await fetch(`${asig(a)}/programaciones/${e(id)}/exportar?purpose=${programme.purpose}&format=${format}&reviewed=${reviewed}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ programme }),
    });
    if (!result.ok) throw new Error((await result.json().catch(() => ({}))).error ?? 'No se pudo exportar la programación.');
    const filename = /filename="([^"]+)"/.exec(result.headers.get('content-disposition') ?? '')?.[1] ?? `programacion.${format}`;
    const url = URL.createObjectURL(await result.blob());
    Object.assign(document.createElement('a'), { href: url, download: filename }).click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
  helpProgrammeUnits: (a: string, id: string, expectedRevision: number, instructions: string, purpose: ProgrammePurpose, unitId?: string) => pedir<Trabajo>('POST', `${asig(a)}/programaciones/${e(id)}/ayuda-unidades?purpose=${purpose}`, { expectedRevision, instructions, unitId }),
  applyProgrammeUnits: (a: string, id: string, purpose: ProgrammePurpose, jobId: string, expectedRevision: number) => pedir<ProgrammeState>('POST', `${asig(a)}/programaciones/${e(id)}/ayuda-unidades/aplicar?purpose=${purpose}`, { jobId, expectedRevision }),
  generateProgramme: (a: string, id: string, expectedRevision: number, instructions: string, purpose: ProgrammePurpose = 'classroom') => pedir<Trabajo>('POST', `${asig(a)}/programaciones/${e(id)}/generar?purpose=${purpose}`, { expectedRevision, instructions }),
  ajustes: () => pedir<Ajustes>('GET', '/api/ajustes'),
  guardarAjustes: (a: Partial<Ajustes>) => pedir<Ajustes>('PUT', '/api/ajustes', a),
  motores: () => pedir<EstadoMotor[]>('GET', '/api/motores'),
  accionMotor: (m: Motor, accion: 'instalar' | 'sesion') => pedir('POST', `/api/motores/${m}/${accion}`),
  comandosMotor: (m: Motor) => pedir<{ instalar: string; sesion: string }>('GET', `/api/motores/${m}/comandos`),
  abrirCarpeta: (asignatura?: string, documento?: string, sub?: string) =>
    pedir('POST', '/api/abrir-carpeta', { asignatura, documento, sub }),
  uso: () => pedir<UsoSuscripcion>('GET', '/api/uso'),
  tokens: () => pedir<ContadorTokens>('GET', '/api/tokens'),
  molecula: (q: string) => pedir<Molecula>('GET', `/api/molecula?q=${e(q)}`),
  buscarImagenes: (q: string, local?: string) =>
    pedir<BusquedaImagenes>('GET', `/api/imagenes-web?q=${e(q)}${local ? `&local=${e(local)}` : ''}`),
  guardarImagenWeb: (a: string, d: string, resultado: ResultadoImagen, seccion?: string) =>
    pedir<{ archivo: string; markdown: string }>('POST', `${doc(a, d)}/imagenes-web`, { resultado, seccion }),
  reiniciarTokens: () => pedir<ContadorTokens>('DELETE', '/api/tokens'),

  asignaturas: () => pedir<AsignaturaResumen[]>('GET', '/api/asignaturas'),
  asignatura: (a: string) => pedir<AsignaturaDetalle>('GET', asig(a)),
  crearAsignatura: (datos: Partial<AsignaturaDetalle>) => pedir<AsignaturaDetalle>('POST', '/api/asignaturas', datos),
  guardarAsignatura: (a: string, datos: Partial<AsignaturaDetalle>) => pedir<AsignaturaDetalle>('PUT', asig(a), datos),
  eliminarAsignatura: (a: string) => pedir('DELETE', asig(a)),

  documento: (a: string, d: string) => pedir<Documento>('GET', doc(a, d)),
  crearDocumento: (a: string, datos: Partial<Documento>) => pedir<Documento>('POST', `${asig(a)}/documentos`, datos),
  guardarDocumento: (a: string, d: string, datos: Partial<Documento>) => pedir<Documento>('PUT', doc(a, d), datos),
  eliminarDocumento: (a: string, d: string) => pedir('DELETE', doc(a, d)),

  secciones: (a: string, d: string) => pedir<Seccion[]>('GET', `${doc(a, d)}/secciones`),
  crearSeccion: (a: string, d: string, titulo: string) => pedir<Seccion>('POST', `${doc(a, d)}/secciones`, { titulo }),
  ordenarSecciones: (a: string, d: string, orden: string[]) => pedir<Seccion[]>('PUT', `${doc(a, d)}/secciones/orden`, { orden }),
  leerSeccion: (a: string, d: string, s: string) => pedir<{ contenido: string }>('GET', `${doc(a, d)}/secciones/${e(s)}`),
  guardarSeccion: (a: string, d: string, s: string, contenido: string) =>
    pedir('PUT', `${doc(a, d)}/secciones/${e(s)}`, { contenido }),
  eliminarSeccion: (a: string, d: string, s: string) => pedir('DELETE', `${doc(a, d)}/secciones/${e(s)}`),

  fuentes: (a: string, d?: string) => pedir<Fuente[]>('GET', `${d ? doc(a, d) : asig(a)}/fuentes`),
  renameSource: (subjectId: string, filename: string, name: string, expectedModified: string, documentId?: string) =>
    pedir<Fuente>('PUT', `${documentId ? doc(subjectId, documentId) : asig(subjectId)}/fuentes/${e(filename)}`, { name, expectedModified }),
  subirFuentes: async (a: string, archivos: File[], d?: string) => {
    const fd = new FormData();
    for (const f of archivos) fd.append('archivo', f, f.name);
    const r = await fetch(`${d ? doc(a, d) : asig(a)}/fuentes`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Error al subir');
    return (await r.json()) as { guardados: string[] };
  },
  eliminarFuente: (a: string, nombre: string, d?: string) => pedir('DELETE', `${d ? doc(a, d) : asig(a)}/fuentes/${e(nombre)}`),

  agentes: () => pedir<InfoAgente[]>('GET', '/api/agentes'),
  requisitos: () =>
    pedir<{ conexion: boolean; exportacion: boolean; claves: { europeana: boolean; smithsonian: boolean } }>('GET', '/api/requisitos'),
  modelos: () =>
    pedir<ModelosDisponibles & { predeterminados: Record<Motor, Record<string, { modelo: string; esfuerzo: Esfuerzo }>> }>('GET', '/api/modelos'),
  aplicarPerfil: (perfil: PerfilGasto) => pedir<Ajustes>('POST', `/api/ajustes/perfil/${perfil}`),
  version: () =>
    pedir<{ version: string; actualizacion?: { estado: 'disponible' | 'descargada'; version: string } }>('GET', '/api/version'),
  instalarActualizacion: () => pedir('POST', '/api/actualizacion/instalar'),

  // Flujo del documento
  flujo: (a: string, d: string) => pedir<EstadoFlujo>('GET', `${doc(a, d)}/flujo`),
  investigar: (a: string, d: string, indicaciones?: string, soloPreguntas = false) =>
    pedir<Trabajo>('POST', `${doc(a, d)}/flujo/investigar`, { indicaciones, soloPreguntas }),
  anadirPregunta: (a: string, d: string, texto: string) => pedir('POST', `${doc(a, d)}/flujo/preguntas`, { texto }),
  eliminarPregunta: (a: string, d: string, id: string) => pedir('DELETE', `${doc(a, d)}/flujo/preguntas/${e(id)}`),
  proponerIndice: (a: string, d: string, indicaciones?: string, profundidad?: number, soloApartados = false) =>
    pedir<Trabajo>('POST', `${doc(a, d)}/flujo/indice`, { indicaciones, profundidad, soloApartados }),
  guardarIndice: (a: string, d: string, indice: Indice) => pedir<Indice>('PUT', `${doc(a, d)}/flujo/indice`, indice),
  aprobarIndice: (a: string, d: string) => pedir<Indice>('POST', `${doc(a, d)}/flujo/indice/aprobar`),
  redactar: (a: string, d: string, archivos: string[], indicaciones?: string) =>
    pedir<Trabajo[]>('POST', `${doc(a, d)}/flujo/redactar`, { archivos, indicaciones }),
  revisar: (a: string, d: string, tipos: TipoRevision[], archivos?: string[], indicaciones?: string) =>
    pedir<Trabajo[]>('POST', `${doc(a, d)}/flujo/revisar`, { tipos, archivos, indicaciones }),
  decidirSugerencias: (a: string, d: string, ids: string[], decision: 'aceptar' | 'rechazar', propuesta?: string) =>
    pedir<{ aplicadas: number; fallidas: number }>('POST', `${doc(a, d)}/flujo/sugerencias/${decision}`, { ids, propuesta }),
  limpiarSugerencias: (a: string, d: string) => pedir('DELETE', `${doc(a, d)}/flujo/sugerencias`),
  diagnosticar: (a: string, d: string, indicaciones?: string) => pedir<Trabajo>('POST', `${doc(a, d)}/flujo/diagnostico`, { indicaciones }),
  abrirOriginal: (a: string, d: string) => pedir('POST', `${doc(a, d)}/original/abrir`),
  cambiarModo: (a: string, d: string, modo: ModoMejora) => pedir<Trabajo>('POST', `${doc(a, d)}/flujo/modo`, { modo }),
  /** Crea un documento a partir de unos apuntes existentes (Word, LibreOffice, Markdown o PDF). */
  importarApuntes: async (
    a: string,
    archivo: File,
    campos: { titulo?: string; modo: ModoMejora; estiloOriginal: boolean; diagnosticar: boolean; importOnly?: boolean },
  ) => {
    const fd = new FormData();
    // Los campos van antes que el archivo: el servidor los lee en orden
    for (const [k, v] of Object.entries(campos)) if (v !== undefined) fd.append(k, String(v));
    fd.append('archivo', archivo, archivo.name);
    const r = await fetch(`${asig(a)}/importar`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string; message?: string }).error ?? 'No se han podido importar los apuntes');
    return (await r.json()) as { documento: Documento; secciones: number; actividades: number; imagenes: number; trabajos: number; avisos: string[] };
  },
  // Duplicar, papelera, copias de seguridad y exportar varios documentos
  duplicarAsignatura: (a: string, nombre?: string) => pedir<AsignaturaDetalle>('POST', `${asig(a)}/duplicar`, { nombre }),
  duplicarDocumento: (a: string, d: string, datos: { titulo?: string; destino?: string }) => pedir<Documento>('POST', `${doc(a, d)}/duplicar`, datos),
  papelera: () => pedir<ElementoPapelera[]>('GET', '/api/papelera'),
  restaurarDePapelera: (id: string) => pedir<{ asignatura: string; documento?: string }>('POST', `/api/papelera/${e(id)}/restaurar`),
  borrarDePapelera: (id?: string) => pedir<ElementoPapelera[]>('DELETE', id ? `/api/papelera/${e(id)}` : '/api/papelera'),
  /** Descarga la copia de seguridad (en la app de escritorio, pregunta dónde guardarla). */
  descargarCopia: (asignaturas?: string[]) => {
    const enlace = Object.assign(document.createElement('a'), { href: `/api/copia${asignaturas?.length ? `?asignaturas=${asignaturas.map(e).join(',')}` : ''}`, download: '' });
    enlace.click();
  },
  restaurarCopia: async (archivo: File) => {
    const fd = new FormData();
    fd.append('copia', archivo, archivo.name);
    const r = await fetch('/api/copia', { method: 'POST', body: fd });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'No se ha podido restaurar la copia');
    return (await r.json()) as { id: string; nombre: string }[];
  },
  reunirExportados: (a: string, archivos: { documento: string; nombre: string }[]) => pedir<{ carpeta: string }>('POST', `${asig(a)}/exportados/reunir`, { archivos }),
  historial: (a: string, d: string, s: string) => pedir<VersionSeccion[]>('GET', `${doc(a, d)}/secciones/${e(s)}/historial`),
  versionSeccion: (a: string, d: string, s: string, id: string) =>
    pedir<{ contenido: string }>('GET', `${doc(a, d)}/secciones/${e(s)}/historial/${e(id)}`),
  restaurarVersion: (a: string, d: string, s: string, id: string) => pedir('POST', `${doc(a, d)}/secciones/${e(s)}/historial/${e(id)}/restaurar`),
  proponerVisuales: (a: string, d: string, archivos?: string[], indicaciones?: string, mezcla?: MezclaVisuales) =>
    pedir<Trabajo>('POST', `${doc(a, d)}/flujo/visuales`, { archivos, indicaciones, mezcla }),
  editarPropuesta: (a: string, d: string, id: string, cambios: Partial<PropuestaVisual>) =>
    pedir<PropuestaVisual>('PUT', `${doc(a, d)}/flujo/visuales/${e(id)}`, cambios),
  generarVisual: (a: string, d: string, id: string, indicaciones?: string) =>
    pedir<Trabajo>('POST', `${doc(a, d)}/flujo/visuales/${e(id)}/generar`, { indicaciones }),
  limpiarVisuales: (a: string, d: string) => pedir('DELETE', `${doc(a, d)}/flujo/visuales`),
  approveVisual: (a: string, d: string, id: string) => pedir<PropuestaVisual>('POST', `${doc(a, d)}/flujo/visuales/${e(id)}/aprobar`),
  generarActividad: (a: string, d: string, op: Partial<OpcionesActividad>) => pedir<BloqueActividad>('POST', `${doc(a, d)}/actividades`, op),
  rehacerActividad: (a: string, d: string, id: string, op: Partial<OpcionesActividad>) =>
    pedir<BloqueActividad>('POST', `${doc(a, d)}/actividades/${e(id)}/rehacer`, op),
  editarActividad: (a: string, d: string, id: string, cambios: { incluir?: boolean; titulo?: string }) =>
    pedir<BloqueActividad>('PUT', `${doc(a, d)}/actividades/${e(id)}`, cambios),
  eliminarActividad: (a: string, d: string, id: string) => pedir('DELETE', `${doc(a, d)}/actividades/${e(id)}`),
  leerArchivo: (a: string, d: string, nombre: string) => pedir<{ contenido: string }>('GET', `${doc(a, d)}/archivo/${e(nombre)}`),
  guardarArchivo: (a: string, d: string, nombre: string, contenido: string) => pedir('PUT', `${doc(a, d)}/archivo/${e(nombre)}`, { contenido }),

  recursos: (a: string, d: string) => pedir<Recurso[]>('GET', `${doc(a, d)}/recursos`),
  eliminarRecurso: (a: string, d: string, nombre: string) => pedir('DELETE', `${doc(a, d)}/recursos/${e(nombre)}`),

  exportar: (a: string, d: string, opciones: OpcionesExportacion, diagramas: Record<string, string>) =>
    pedir<Exportado>('POST', `${doc(a, d)}/exportar`, { opciones, diagramas }),
  crearVersion: (a: string, d: string, tipo: 'lectura-facil' | 'refuerzo' | 'ampliacion', indicaciones?: string) =>
    pedir<{ documento: Documento; trabajos: number }>('POST', `${doc(a, d)}/version`, { tipo, indicaciones }),
  exportarMoodle: (a: string, d: string, id: string) => pedir<Exportado>('POST', `${doc(a, d)}/actividades/${e(id)}/moodle`),
  abrirExportado: (a: string, d: string, nombre: string) => pedir('POST', `${doc(a, d)}/exportados/${e(nombre)}/abrir`),

  // Exámenes de la asignatura
  examenes: (a: string) => pedir<Examen[]>('GET', `${asig(a)}/examenes`),
  examen: (a: string, id: string) => pedir<Examen>('GET', exa(a, id)),
  crearExamen: (a: string, titulo: string) => pedir<Examen>('POST', `${asig(a)}/examenes`, { titulo }),
  guardarExamen: (a: string, id: string, datos: { titulo?: string; opciones?: Partial<OpcionesExamen> }) => pedir<Examen>('PUT', exa(a, id), datos),
  eliminarExamen: (a: string, id: string) => pedir('DELETE', exa(a, id)),
  generarExamen: (a: string, id: string, opciones?: Partial<OpcionesExamen>) => pedir<Trabajo>('POST', `${exa(a, id)}/generar`, { opciones }),
  adaptExam: (a: string, id: string, request: ExamAdaptationRequest) => pedir<Examen>('POST', `${exa(a, id)}/adaptations`, request),
  ajustarPuntuacion: (a: string, id: string, total?: number) => pedir<Examen>('POST', `${exa(a, id)}/puntuacion`, { total }),
  ordenarPreguntasExamen: (a: string, id: string, ids: string[]) => pedir<Examen>('POST', `${exa(a, id)}/orden`, { ids }),
  nuevaPreguntaExamen: (a: string, id: string, tipo: TipoActividad, indicaciones?: string) => pedir<Trabajo>('POST', `${exa(a, id)}/preguntas`, { tipo, indicaciones }),
  rehacerPreguntaExamen: (a: string, id: string, p: string, indicaciones?: string) => pedir<Trabajo>('POST', `${exa(a, id)}/preguntas/${e(p)}/rehacer`, { indicaciones }),
  editarPreguntaExamen: (a: string, id: string, p: string, cambios: Partial<PreguntaExamen>) => pedir<Examen>('PUT', `${exa(a, id)}/preguntas/${e(p)}`, cambios),
  eliminarPreguntaExamen: (a: string, id: string, p: string) => pedir<Examen>('DELETE', `${exa(a, id)}/preguntas/${e(p)}`),
  fuentesExamen: (a: string, id: string) => pedir<FuenteExamen[]>('GET', `${exa(a, id)}/fuentes`),
  subirFuentesExamen: async (a: string, id: string, archivos: File[]) => {
    const fd = new FormData();
    for (const f of archivos) fd.append('archivo', f, f.name);
    const r = await fetch(`${exa(a, id)}/fuentes`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Error al subir');
    return (await r.json()) as { guardados: string[] };
  },
  eliminarFuenteExamen: (a: string, id: string, nombre: string) => pedir('DELETE', `${exa(a, id)}/fuentes/${e(nombre)}`),
  exportadosExamen: (a: string, id: string) => pedir<Exportado[]>('GET', `${exa(a, id)}/exportados`),
  exportarExamen: (a: string, id: string, formato: 'pdf' | 'docx' | 'odt') => pedir<Exportado[]>('POST', `${exa(a, id)}/exportar`, { formato }),
  exportarExamenMoodle: (a: string, id: string) => pedir<Exportado>('POST', `${exa(a, id)}/moodle`),
  abrirExportadoExamen: (a: string, id: string, nombre: string) => pedir('POST', `${exa(a, id)}/exportados/${e(nombre)}/abrir`),
  abrirCarpetaExamen: (a: string, id: string) => pedir('POST', `${exa(a, id)}/carpeta`),

  glosario: (a: string) => pedir<{ contenido: string }>('GET', `${asig(a)}/glosario`),
  buscarCurriculo: (a: string, indicaciones?: string, options?: { profile: CurriculumProfile }) => pedir<Trabajo>('POST', `${asig(a)}/curriculo/buscar`, { indicaciones, ...options }),
  structuredCurriculum: (a: string) => pedir<CurriculumResponse>('GET', `${asig(a)}/curriculo`),
  saveCurriculumDraft: (a: string, draft: CurriculumDraft, expectedRevision: number) => pedir<CurriculumState>('PUT', `${asig(a)}/curriculo`, { draft, expectedRevision }),
  activateCurriculum: (a: string, expectedRevision: number, review?: { draft: CurriculumDraft; confirmed: boolean }) => pedir<CurriculumState>('POST', `${asig(a)}/curriculo/activar`, { expectedRevision, ...(review ? { review } : {}) }),
  discardCurriculumDraft: (a: string, expectedRevision: number) => pedir<CurriculumState>('DELETE', `${asig(a)}/curriculo`, { expectedRevision }),
  restoreCurriculumDraft: (a: string, versionId: string, expectedRevision: number) => pedir<CurriculumState>('POST', `${asig(a)}/curriculo/restaurar`, { versionId, expectedRevision }),
  guardarGlosario: (a: string, contenido: string) => pedir('PUT', `${asig(a)}/glosario`, { contenido }),
  actualizarGlosario: (a: string, indicaciones?: string) => pedir<Trabajo>('POST', `${asig(a)}/glosario/actualizar`, { indicaciones }),
  plantillas: (a: string) => pedir<{ docx: boolean; odt: boolean }>('GET', `${asig(a)}/plantillas`),
  subirPlantilla: async (a: string, archivo: File) => {
    const fd = new FormData();
    fd.append('plantilla', archivo, archivo.name);
    const r = await fetch(`${asig(a)}/plantillas`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'Error al subir');
    return (await r.json()) as { docx: boolean; odt: boolean };
  },
  /** Descarga el documento de base para crear una plantilla (se guarda donde elija el usuario). */
  descargarPlantillaBase: async (a: string, formato: 'docx' | 'odt') => {
    const r = await fetch(`${asig(a)}/plantillas/base/${formato}`);
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'No se pudo generar la plantilla');
    const nombre = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? `plantilla-base.${formato}`;
    const url = URL.createObjectURL(await r.blob());
    const enlace = Object.assign(document.createElement('a'), { href: url, download: nombre });
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
  eliminarPlantilla: (a: string, formato: 'docx' | 'odt') => pedir<{ docx: boolean; odt: boolean }>('DELETE', `${asig(a)}/plantillas/${formato}`),

  busqueda: (a: string, d?: string) => pedir<ResultadoBusqueda[]>('GET', `${d ? doc(a, d) : asig(a)}/busqueda-fuentes`),
  buscarFuentes: (a: string, consulta: string, tipo: TipoBusqueda, d?: string) =>
    pedir<Trabajo>('POST', `${d ? doc(a, d) : asig(a)}/busqueda-fuentes`, { consulta, tipo }),
  anadirFuente: (a: string, id: string, d?: string) => pedir<ResultadoBusqueda>('POST', `${d ? doc(a, d) : asig(a)}/busqueda-fuentes/${e(id)}/anadir`),
  descartarResultado: (a: string, id: string, d?: string) => pedir('POST', `${d ? doc(a, d) : asig(a)}/busqueda-fuentes/${e(id)}/descartar`),
  limpiarBusqueda: (a: string, d?: string) => pedir('DELETE', `${d ? doc(a, d) : asig(a)}/busqueda-fuentes`),

  indiceFuentes: (a: string, d?: string) =>
    pedir<{ archivo: string; fragmentos: number; paginas?: number; estado: 'indexado' | 'sin-texto' | 'no-admitido' }[]>('GET', `${d ? doc(a, d) : asig(a)}/fuentes-indice`),
  buscarEnFuentes: (a: string, consulta: string, d?: string) =>
    pedir<{ archivo: string; pagina?: number; titulo?: string; texto: string; carpeta: string; puntuacion: number }[]>(
      'POST',
      `${d ? doc(a, d) : asig(a)}/fuentes-indice/buscar`,
      { consulta },
    ),

  sinPie: (a: string, d: string) => pedir<{ seccion: string; tipo: string; muestra: string }[]>('GET', `${doc(a, d)}/pies`),
  imagenesQueFaltan: (a: string, d: string) => pedir<ImagenFallida[]>('GET', `${doc(a, d)}/imagenes-faltan`),
  repararImagenes: (a: string, d: string) => pedir<{ mensaje: string }>('POST', `${doc(a, d)}/imagenes-faltan`),
  anadirPies: (a: string, d: string) => pedir<Trabajo>('POST', `${doc(a, d)}/pies`),

  trabajos: () => pedir<Trabajo[]>('GET', '/api/trabajos'),
  trabajo: (id: string) => pedir<Trabajo>('GET', `/api/trabajos/${e(id)}`),
  lanzar: (datos: { motor?: Motor; tarea: string; asignatura: string; documento?: string; seccion?: string; herramientas?: HerramientasChat; seleccionTexto?: SeleccionTexto; ambito?: { vista: string; seccion?: string } }) =>
    pedir<Trabajo>('POST', '/api/trabajos', datos),
  responder: (id: string, texto: string) => pedir<Trabajo>('POST', `/api/trabajos/${e(id)}/responder`, { texto }),
  cancelar: (id: string) => pedir('POST', `/api/trabajos/${e(id)}/cancelar`),
  reintentar: (id: string) => pedir<Trabajo>('POST', `/api/trabajos/${e(id)}/reintentar`),
  seguirEsperando: (id: string) => pedir('POST', `/api/trabajos/${e(id)}/esperar`),
  reanudarCola: () => pedir<UsoSuscripcion>('POST', '/api/cola/reanudar'),
  limpiarTrabajos: () => pedir<Trabajo[]>('POST', '/api/trabajos/limpiar'),
};

/** URL pública de un archivo dentro de la carpeta de datos. */
export function urlDatos(...partes: string[]) {
  return '/datos/' + partes.map(e).join('/');
}
