// Exámenes de la asignatura: se preparan a partir de sus documentos (todos o algunas secciones),
// de sus fuentes y de archivos subidos solo para el examen (apuntes propios, el libro, un PDF…).
// Cada examen da tres textos: el enunciado para el alumnado, el solucionario y la rúbrica de
// corrección. Se generan aquí, igual para la vista previa y para la exportación.
import {
  DIFICULTADES,
  LETRAS,
  TIPOS_ACTIVIDAD,
  barajar,
  partesPregunta,
  respuestaPregunta,
  type Dificultad,
  type PreguntaActividad,
  type TipoActividad,
} from './actividades';

/** Preguntas que se corrigen con rúbrica (las demás, con la clave de corrección). */
export const TIPOS_CON_RUBRICA: TipoActividad[] = ['abierta', 'desarrollo', 'ejercicio', 'esquema', 'redaccion', 'caso', 'datos', 'comentario'];

export interface NivelRubrica {
  nivel: string; // «Excelente», «Adecuado»…
  descripcion: string;
  puntos: number;
}

export interface CriterioRubrica {
  criterio: string;
  puntos: number; // máximo del criterio (el de su mejor nivel)
  niveles: NivelRubrica[];
}

export interface PreguntaExamen extends PreguntaActividad {
  id: string;
  tipo: TipoActividad;
  puntos: number;
  /** Resolución completa para el solucionario (en las cerradas basta la explicación). */
  solucion?: string;
  rubrica?: CriterioRubrica[];
  /** Errores frecuentes y cuánto restan. */
  errores?: string[];
  /** Criterios de evaluación del currículo que evalúa (su numeración, p. ej. «1.2» o «RA2.b»). */
  criterios?: string[];
  /** De dónde sale: documento o archivo. */
  origen?: string;
  /** Líneas de espacio para responder en papel (si falta, las de su tipo). */
  lineas?: number;
}

export interface OpcionesExamen {
  /** Documentos de la asignatura; sin secciones, el documento entero. */
  documentos: { id: string; secciones: string[] }[];
  /** Fuentes de la asignatura que se usan (además de los archivos subidos al examen, que se usan todos). */
  fuentesAsignatura: string[];
  tipos: Partial<Record<TipoActividad, number>>;
  dificultad: Dificultad;
  /** Puntuación total del examen. */
  total: number;
  /** Duración en minutos. */
  duracion?: number;
  /** En las de tipo test, cada error resta (un tercio del valor de la pregunta con cuatro opciones). */
  penalizar?: boolean;
  /** Instrucciones para el alumnado que van en la cabecera del examen. */
  instrucciones?: string;
  /** Indicaciones para la IA. */
  indicaciones?: string;
  // En papel
  /** Include answer space below each question only when explicitly enabled. */
  espacio?: boolean;
  /** Tabla de calificación por partes en la cabecera (por defecto, sí). */
  tablaNotas?: boolean;
  /** Hoja de respuestas para las preguntas de test y de verdadero o falso. */
  hojaRespuestas?: boolean;
  /** Exportar también el modelo B (las mismas preguntas y opciones en otro orden). */
  modeloB?: boolean;
  /** Optatividad: en las partes de este tipo, cuántas preguntas hay que responder. */
  elegir?: Partial<Record<TipoActividad, number>>;
}

export const EXAM_ADAPTATIONS = [
  { id: 'easy-reading', name: 'Lectura fácil', description: 'Enunciados breves y claros, con la misma dificultad, contenidos y puntuación.' },
  { id: 'supported', name: 'Con apoyos', description: 'Instrucciones por pasos y ayudas de formato, sin revelar las respuestas ni cambiar lo que se evalúa.' },
  { id: 'extension', name: 'Ampliación', description: 'Más profundidad y razonamiento sobre los mismos contenidos, conservando la puntuación.' },
] as const;

export type ExamAdaptationKind = (typeof EXAM_ADAPTATIONS)[number]['id'];

export interface ExamAdaptationRequest {
  kind: ExamAdaptationKind;
  questionIds: string[];
  instructions?: string;
}

export interface ExamAdaptation extends ExamAdaptationRequest {
  sourceExamId: string;
  sourceTitle: string;
  sourceUpdatedAt: string;
  /** Immutable snapshot used to validate and merge the generated questions. */
  originalQuestions: PreguntaExamen[];
  completedAt?: string;
}

export interface Examen {
  id: string;
  titulo: string;
  opciones: OpcionesExamen;
  estado: 'borrador' | 'generando' | 'listo' | 'error';
  error?: string;
  adaptation?: ExamAdaptation;
  preguntas: PreguntaExamen[];
  creado: string;
  actualizado: string;
}

export const OPCIONES_EXAMEN: OpcionesExamen = {
  documentos: [],
  fuentesAsignatura: [],
  tipos: { test: 10, corta: 4, desarrollo: 2, ejercicio: 2 },
  dificultad: 'media',
  total: 10,
  duracion: 55,
};

export const MAX_PREGUNTAS_EXAMEN = 60;

/** Máximo de preguntas de cada tipo en un examen. */
export const maximoTipoExamen = (t: TipoActividad) =>
  ['emparejar', 'ordenar', 'clasificar', 'banco', 'tabla'].includes(t) ? 5 : ['caso', 'datos', 'comentario', 'redaccion'].includes(t) ? 6 : TIPOS_CON_RUBRICA.includes(t) ? 12 : 30;

export const nombreTipo = (t: TipoActividad) => TIPOS_ACTIVIDAD.find((x) => x.id === t)?.nombre ?? t;
export const nombreDificultad = (d: Dificultad) => DIFICULTADES.find((x) => x.id === d)?.nombre ?? d;

/** Tipos pedidos y su cantidad, en el orden de la lista de tipos. */
export function tiposExamen(op: Pick<OpcionesExamen, 'tipos'>): [TipoActividad, number][] {
  return TIPOS_ACTIVIDAD.map((t) => [t.id, Math.max(0, Math.round(Number(op.tipos?.[t.id]) || 0))] as [TipoActividad, number]).filter(([, n]) => n > 0);
}

// ---------------------------------------------------------------------------
// Partes y puntuación

/** Redondeo a cuartos de punto (0,25), sin restos de coma flotante. */
export const redondear = (n: number) => Math.round(n * 4) / 4;

/** 1.5 → «1,5»; 2 → «2». */
export const fmtPuntos = (n: number) => String(redondear(n)).replace('.', ',');

export const textoPuntos = (n: number) => `${fmtPuntos(n)} ${redondear(n) === 1 ? 'punto' : 'puntos'}`;

export const sumaPuntos = (preguntas: { puntos: number }[]) => redondear(preguntas.reduce((a, p) => a + (Number(p.puntos) || 0), 0));

/** Una parte del examen: preguntas seguidas del mismo tipo (y cuántas hay que responder). */
export interface ParteExamen {
  tipo: TipoActividad;
  preguntas: { p: PreguntaExamen; n: number }[];
  /** Cuántas se responden (menos que las que hay: parte con optatividad). */
  elegir: number;
}

type ConPreguntas = Pick<Examen, 'preguntas' | 'opciones'>;

export function partesExamen(ex: ConPreguntas): ParteExamen[] {
  const res: ParteExamen[] = [];
  ex.preguntas.forEach((p, i) => {
    const ultima = res.at(-1);
    if (ultima?.tipo === p.tipo) ultima.preguntas.push({ p, n: i + 1 });
    else res.push({ tipo: p.tipo, preguntas: [{ p, n: i + 1 }], elegir: 0 });
  });
  for (const parte of res) {
    const pedidas = Math.round(Number(ex.opciones.elegir?.[parte.tipo]) || 0);
    parte.elegir = pedidas > 0 ? Math.min(pedidas, parte.preguntas.length) : parte.preguntas.length;
  }
  return res;
}

export const conOptatividad = (parte: ParteExamen) => parte.elegir < parte.preguntas.length;

/** Lo que vale una parte: con optatividad, las `elegir` preguntas de más valor. */
export function valorParte(parte: ParteExamen): number {
  const puntos = parte.preguntas.map(({ p }) => Number(p.puntos) || 0).sort((a, b) => b - a);
  return sumaPuntos(puntos.slice(0, parte.elegir).map((x) => ({ puntos: x })));
}

/** Puntuación máxima que se puede sacar en el examen. */
export const totalExamen = (ex: ConPreguntas) => redondear(partesExamen(ex).reduce((a, parte) => a + valorParte(parte), 0));

/**
 * Reparte `total` entre las preguntas en proporción a sus puntos (o a partes iguales si no tienen),
 * en cuartos de punto y de modo que la suma sea exacta.
 */
export function ajustarPuntos<T extends { puntos: number }>(preguntas: T[], total: number): T[] {
  if (!preguntas.length) return preguntas;
  const pesos = preguntas.map((p) => (Number(p.puntos) > 0 ? Number(p.puntos) : 0));
  const suma = pesos.reduce((a, b) => a + b, 0);
  const base = suma > 0 ? pesos : preguntas.map(() => 1);
  const sumaBase = suma > 0 ? suma : preguntas.length;
  // En cuartos: se reparte por restos mayores para que la suma cuadre
  const cuartos = Math.round(total * 4);
  const exactos = base.map((w) => (w / sumaBase) * cuartos);
  const enteros = exactos.map(Math.floor);
  let resto = cuartos - enteros.reduce((a, b) => a + b, 0);
  const orden = exactos.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r);
  for (const { i } of orden) {
    if (resto <= 0) break;
    enteros[i]++;
    resto--;
  }
  return preguntas.map((p, i) => ({ ...p, puntos: enteros[i] / 4 }));
}

/**
 * Puntos de cada pregunta para que el examen valga `total`: en proporción a los que tienen y, en las
 * partes con optatividad, todas las preguntas con el mismo valor (cuenta solo lo que se responde).
 */
export function repartirPuntos(ex: ConPreguntas, total = ex.opciones.total): PreguntaExamen[] {
  const partes = partesExamen(ex);
  const media = (parte: ParteExamen) => {
    const con = parte.preguntas.map(({ p }) => Number(p.puntos) || 0).filter((x) => x > 0);
    return con.length ? con.reduce((a, b) => a + b, 0) / con.length : 1;
  };
  const unidades = partes.flatMap((parte, k) =>
    conOptatividad(parte) ? [{ k, id: '', puntos: parte.elegir * media(parte) }] : parte.preguntas.map(({ p }) => ({ k, id: p.id, puntos: Number(p.puntos) || 0 })),
  );
  const nuevos = new Map<string, number>();
  for (const u of ajustarPuntos(unidades, total)) {
    if (u.id) nuevos.set(u.id, u.puntos);
    else for (const { p } of partes[u.k].preguntas) nuevos.set(p.id, redondear(u.puntos / partes[u.k].elegir));
  }
  const res = ex.preguntas.map((p) => ({ ...p, puntos: nuevos.get(p.id) ?? p.puntos }));
  // Lo que no cuadre al redondear las partes con optatividad, en la obligatoria de más valor
  const diferencia = redondear(total - totalExamen({ ...ex, preguntas: res }));
  if (diferencia) {
    const obligatorias = new Set(partes.filter((x) => !conOptatividad(x)).flatMap((x) => x.preguntas.map(({ p }) => p.id)));
    const mayor = res.filter((p) => obligatorias.has(p.id)).sort((a, b) => b.puntos - a.puntos)[0];
    if (mayor) mayor.puntos = Math.max(0, redondear(mayor.puntos + diferencia));
  }
  return res.map(ajustarRubrica);
}

/** La rúbrica de una pregunta, con sus criterios sumando los puntos de la pregunta (y cada nivel, a escala). */
export function ajustarRubrica(p: PreguntaExamen): PreguntaExamen {
  if (!p.rubrica?.length) return p;
  const criterios = p.rubrica.map((c) => ({ ...c, puntos: Math.max(0, Number(c.puntos) || Math.max(0, ...c.niveles.map((n) => Number(n.puntos) || 0))) }));
  const ajustados = ajustarPuntos(criterios, p.puntos);
  return {
    ...p,
    rubrica: ajustados.map((c, i) => {
      const antes = criterios[i].puntos;
      const escala = antes > 0 ? c.puntos / antes : 0;
      return { ...c, niveles: c.niveles.map((n) => ({ ...n, puntos: redondear(Math.min(c.puntos, Math.max(0, (Number(n.puntos) || 0) * escala))) })) };
    }),
  };
}

// ---------------------------------------------------------------------------
// Modelo B: las mismas preguntas en otro orden dentro de cada parte, y las opciones del test desordenadas

export function modeloB(ex: Examen): Examen {
  const preguntas = partesExamen(ex).flatMap((parte, k) =>
    barajar(
      parte.preguntas.map(({ p }) => p),
      `${ex.id}-B-${k}`,
    ).map((p) => {
      // Otro id: cambia también el orden de lo que se desordena (relacionar, ordenar, clasificar)
      const q: PreguntaExamen = { ...p, id: `${p.id}-b` };
      if ((p.tipo === 'test' || p.tipo === 'multiple') && p.opciones?.length) {
        const orden = barajar(
          p.opciones.map((_, i) => i),
          `${p.id}-b`,
        );
        q.opciones = orden.map((i) => p.opciones![i]);
        if (typeof p.correcta === 'number') q.correcta = orden.indexOf(p.correcta);
        if (p.correctas) q.correctas = p.correctas.map((c) => orden.indexOf(c));
      }
      return q;
    }),
  );
  return { ...ex, titulo: `${ex.titulo} (modelo B)`, preguntas };
}

// ---------------------------------------------------------------------------
// Markdown

/** Para qué se genera el texto: vista previa o el formato de exportación (cambia el espacio para responder). */
export interface Destino {
  formato: 'vista' | 'pdf' | 'docx' | 'odt';
  /** Salto de página en ese formato. */
  salto?: string;
}

/** Texto de una celda de tabla (sin saltos ni barras que la rompan). */
const celda = (s: string) => String(s ?? '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();

const huecos = (s: string) => s.replace(/_{3,}/g, '\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_\\_');
const raya = (n: number) => '\\_'.repeat(n);

/** Líneas para responder de cada tipo (las de respuesta en el propio enunciado no llevan). */
const LINEAS: Partial<Record<TipoActividad, number>> = {
  corta: 2,
  error: 3,
  vfjustificada: 3,
  definicion: 4,
  numerica: 6,
  abierta: 6,
  esquema: 14,
  redaccion: 20,
  desarrollo: 15,
  ejercicio: 12,
  caso: 16,
  datos: 10,
  comentario: 14,
};
/** En estos, un recuadro para hacer cálculos en lugar de líneas. */
const RECUADRO: TipoActividad[] = ['numerica', 'ejercicio', 'esquema', 'datos', 'caso'];

export const lineasDe = (p: PreguntaExamen) => Math.max(0, Math.round(p.lineas ?? LINEAS[p.tipo] ?? 0));

function espacioRespuesta(p: PreguntaExamen, d: Destino): string[] {
  const n = lineasDe(p);
  if (!n) return [];
  const recuadro = RECUADRO.includes(p.tipo);
  switch (d.formato) {
    case 'pdf':
      return [
        '```{=typst}',
        recuadro
          ? `#rect(width: 100%, height: ${(n * 0.8).toFixed(1)}cm, stroke: 0.5pt + luma(165), radius: 3pt)`
          : `#block(width: 100%)[#for _ in range(${n}) { v(0.8cm, weak: false); line(length: 100%, stroke: 0.4pt + luma(175)) }]`,
        '```',
      ];
    case 'docx': {
      // Párrafos vacíos con borde entre ellos y debajo (Word junta los bordes de párrafos iguales)
      const borde = (lado: string) => `<w:${lado} w:val="single" w:sz="4" w:space="1" w:color="A6A6A6"/>`;
      const caja = recuadro ? borde('top') + borde('left') + borde('right') + borde('bottom') : borde('between') + borde('bottom');
      const parrafo = `<w:p><w:pPr><w:pBdr>${caja}</w:pBdr><w:spacing w:before="0" w:after="0" w:line="454" w:lineRule="exact"/></w:pPr></w:p>`;
      return ['```{=openxml}', parrafo.repeat(n), '```'];
    }
    case 'odt':
      return Array.from({ length: n }, () => [raya(70), '']).flat();
    default:
      return [`*(Espacio para responder: ${recuadro ? `un recuadro de ${n} líneas` : `${n} líneas`})*`];
  }
}

const ROTULO_PARTE: Record<TipoActividad, string> = {
  test: 'Preguntas tipo test',
  multiple: 'Preguntas de respuesta múltiple',
  numerica: 'Cálculos',
  banco: 'Completa el texto',
  tabla: 'Completa la tabla',
  esquema: 'Dibujos y esquemas',
  redaccion: 'Redacción',
  vf: 'Verdadero o falso',
  vfjustificada: 'Verdadero o falso justificado',
  corta: 'Preguntas de respuesta corta',
  huecos: 'Completa los huecos',
  emparejar: 'Relaciona',
  ordenar: 'Ordena',
  clasificar: 'Clasifica',
  error: 'Encuentra el error',
  definicion: 'Definiciones',
  abierta: 'Preguntas abiertas',
  desarrollo: 'Preguntas de desarrollo',
  ejercicio: 'Ejercicios',
  caso: 'Casos prácticos',
  datos: 'Análisis de datos',
  comentario: 'Comentario de texto',
};

const AVISO_PARTE: Partial<Record<TipoActividad, string>> = {
  test: 'Elige una sola respuesta en cada pregunta.',
  multiple: 'En cada pregunta puede haber varias respuestas correctas: márcalas todas.',
  vf: 'Indica si cada afirmación es verdadera (V) o falsa (F).',
  vfjustificada: 'Indica si cada afirmación es verdadera (V) o falsa (F) y justifica tu respuesta.',
  huecos: 'Escribe la palabra que falta en cada hueco.',
  numerica: 'Escribe el planteamiento y el resultado con sus unidades.',
  banco: 'Escribe junto a cada número la palabra que corresponde.',
  tabla: 'Escribe lo que falta en cada casilla numerada.',
  ordenar: 'Escribe las letras en el orden correcto.',
  clasificar: 'Escribe, junto a cada categoría, los números de los elementos que le corresponden.',
  error: 'Cada enunciado contiene un error: localízalo y corrígelo.',
};

/** Las que se responden en la hoja de respuestas (si se pide). */
const EN_HOJA: TipoActividad[] = ['test', 'multiple', 'vf'];

function rotuloParte(parte: ParteExamen, k: number, varias: boolean): string {
  const opcional = conOptatividad(parte) ? `responde a ${parte.elegir} de ${parte.preguntas.length} · ` : '';
  return `${varias ? `Parte ${k + 1}. ` : ''}${ROTULO_PARTE[parte.tipo]} (${opcional}${textoPuntos(valorParte(parte))})`;
}

/** Enunciado del examen para el alumnado, sin soluciones. */
export function examenAMarkdown(ex: Examen, d: Destino = { formato: 'vista' }): string {
  const op = ex.opciones;
  const partes = partesExamen(ex);
  const varias = partes.length > 1;
  const hoja = !!op.hojaRespuestas && ex.preguntas.some((p) => EN_HOJA.includes(p.tipo));
  const lineas: string[] = [
    `**Nombre y apellidos:** ${raya(46)}`,
    '',
    `**Curso y grupo:** ${raya(16)} **Fecha:** ${raya(16)}`,
    '',
    [op.duracion ? `**Duración:** ${op.duracion} minutos` : '', `**Puntuación total:** ${textoPuntos(totalExamen(ex))}`].filter(Boolean).join(' · '),
  ];
  // Tabla de calificación, por partes (o por preguntas si es una sola parte corta)
  if (op.tablaNotas !== false && ex.preguntas.length) {
    const columnas = varias
      ? partes.map((parte, k) => ({ titulo: `P${k + 1}`, puntos: valorParte(parte) }))
      : ex.preguntas.length <= 12
        ? ex.preguntas.map((p, i) => ({ titulo: String(i + 1), puntos: p.puntos }))
        : [];
    lineas.push(
      '',
      `| ${varias ? 'Parte' : 'Pregunta'} | ${columnas.map((c) => c.titulo).join(' | ')}${columnas.length ? ' | ' : ''}**Nota** |`,
      `|---|${columnas.map(() => ':-:').join('|')}${columnas.length ? '|' : ''}:-:|`,
      `| Máximo | ${columnas.map((c) => fmtPuntos(c.puntos)).join(' | ')}${columnas.length ? ' | ' : ''}${fmtPuntos(totalExamen(ex))} |`,
      `| Puntuación | ${columnas.map(() => ' ').join(' | ')}${columnas.length ? ' | ' : ''}  |`,
    );
  }
  const instrucciones = [
    ...(op.instrucciones?.trim() ? op.instrucciones.trim().split(/\r?\n/).filter((l) => l.trim()) : []),
    ...(hoja ? ['Responde las preguntas de test y de verdadero o falso en la hoja de respuestas del final.'] : []),
    ...(op.penalizar && ex.preguntas.some((p) => p.tipo === 'test') ? ['En las preguntas tipo test, cada respuesta incorrecta resta un tercio de su valor; las preguntas sin responder no restan.'] : []),
  ];
  if (instrucciones.length) lineas.push('', ...instrucciones.map((l) => `> ${l.replace(/^[-*]\s+/, '')}`));
  partes.forEach((parte, k) => {
    lineas.push('', `## ${rotuloParte(parte, k, varias)}`, '');
    const avisos = [conOptatividad(parte) ? `Responde solo a ${parte.elegir} de estas ${parte.preguntas.length} preguntas.` : '', AVISO_PARTE[parte.tipo] ?? ''].filter(Boolean);
    if (avisos.length) lineas.push(`*${avisos.join(' ')}*`, '');
    for (const { p, n } of parte.preguntas) {
      const { enunciado, resto } = partesPregunta(p, p.tipo, p.id);
      const espacio = op.espacio === true ? espacioRespuesta(p, d) : [];
      lineas.push(`**${n}.** *(${fmtPuntos(p.puntos)} p)* ${enunciado}`, ...(resto.length ? ['', ...resto] : []), ...(espacio.length ? ['', ...espacio] : []), '');
    }
  });
  if (hoja) lineas.push('', d.salto ?? '', '', ...hojaRespuestas(ex));
  return lineas.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Hoja de respuestas: una tabla para marcar con una X las de test y otra para las de verdadero o falso. */
function hojaRespuestas(ex: Examen): string[] {
  const conOpciones = ex.preguntas.map((p, i) => ({ p, n: i + 1 })).filter(({ p }) => (p.tipo === 'test' || p.tipo === 'multiple') && p.opciones?.length);
  const vf = ex.preguntas.map((p, i) => ({ p, n: i + 1 })).filter(({ p }) => p.tipo === 'vf');
  const lineas = ['## Hoja de respuestas', '', `**Nombre y apellidos:** ${raya(46)}`, '', '*Marca con una X la respuesta elegida. Si te equivocas, rodea la X y marca la nueva.*', ''];
  if (conOpciones.length) {
    const max = Math.max(...conOpciones.map(({ p }) => p.opciones!.length));
    const letras = [...LETRAS.slice(0, max)];
    lineas.push(`| Pregunta | ${letras.join(' | ')} |`, `|:-:|${letras.map(() => ':-:').join('|')}|`, ...conOpciones.map(({ p, n }) => `| ${n} | ${letras.map((_, i) => (i < p.opciones!.length ? ' ' : '—')).join(' | ')} |`), '');
  }
  if (vf.length) lineas.push('| Pregunta | V | F |', '|:-:|:-:|:-:|', ...vf.map(({ n }) => `| ${n} |   |   |`), '');
  return lineas;
}

/** Respuesta de una pregunta, en una línea (para la clave de corrección). */
export const respuestaBreve = (p: PreguntaExamen) => respuestaPregunta(p, p.tipo, p.id);

/** Solucionario: la respuesta de cada pregunta, explicada, y las resoluciones paso a paso. */
export function solucionarioAMarkdown(ex: Examen): string {
  const lineas: string[] = [];
  const partes = partesExamen(ex);
  partes.forEach((parte, k) => {
    lineas.push(`## ${rotuloParte(parte, k, partes.length > 1)}`, '');
    for (const { p, n } of parte.preguntas) {
      // Enunciado (sin opciones ni tablas, que ya están en el examen)
      const enunciado = p.tipo === 'huecos' ? huecos(p.enunciado) : p.enunciado || nombreTipo(p.tipo);
      lineas.push(`**${n}.** *(${fmtPuntos(p.puntos)} p)* ${enunciado}`, '');
      const breve = respuestaBreve(p);
      if (TIPOS_CON_RUBRICA.includes(p.tipo)) {
        if (breve) lineas.push(`**Resultado:** ${breve}`, '');
        const desarrollo = (p.solucion || p.explicacion || '').trim();
        if (desarrollo) lineas.push(desarrollo, '');
      } else {
        if (breve) lineas.push(`**Respuesta:** ${breve}`, '');
        const explicacion = (p.explicacion || p.solucion || '').trim();
        if (explicacion) lineas.push(explicacion, '');
      }
    }
  });
  return lineas.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Rúbrica de corrección: resumen de la puntuación, clave de las cerradas y rúbrica de las abiertas. */
export function rubricaAMarkdown(ex: Examen): string {
  const lineas: string[] = [];
  const conCriterios = ex.preguntas.some((p) => p.criterios?.length);
  lineas.push(
    '## Resumen de la puntuación',
    '',
    conCriterios ? '| Pregunta | Tipo | Puntos | Criterios de evaluación |' : '| Pregunta | Tipo | Puntos |',
    conCriterios ? '|---|---|---|---|' : '|---|---|---|',
    ...ex.preguntas.map((p, i) => `| ${i + 1} | ${nombreTipo(p.tipo)} | ${fmtPuntos(p.puntos)} |${conCriterios ? ` ${celda((p.criterios ?? []).join(', '))} |` : ''}`),
    `| **Total** | | **${fmtPuntos(totalExamen(ex))}** |${conCriterios ? ' |' : ''}`,
    '',
  );
  const partes = partesExamen(ex);
  for (const [k, parte] of partes.entries()) {
    if (conOptatividad(parte)) {
      const desde = parte.preguntas[0].n;
      const hasta = parte.preguntas.at(-1)!.n;
      lineas.push(
        `*${partes.length > 1 ? `Parte ${k + 1}` : 'Optatividad'} (preguntas ${desde}-${hasta}): se responden ${parte.elegir} de ${parte.preguntas.length}. Si se responden más, se corrigen solo las ${parte.elegir} primeras.*`,
        '',
      );
    }
  }
  const cerradas = ex.preguntas.map((p, i) => ({ p, n: i + 1 })).filter(({ p }) => !TIPOS_CON_RUBRICA.includes(p.tipo));
  if (cerradas.length) {
    lineas.push('## Clave de corrección', '');
    if (ex.opciones.penalizar && cerradas.some(({ p }) => p.tipo === 'test')) {
      lineas.push('*Tipo test: cada respuesta incorrecta resta un tercio del valor de la pregunta; sin responder, 0.*', '');
    }
    lineas.push('| Pregunta | Respuesta correcta | Puntos | Se acepta también |', '|---|---|---|---|');
    for (const { p, n } of cerradas) {
      const varias = ['corta', 'huecos', 'error'].includes(p.tipo) && (p.respuestas?.length ?? 0) > 1;
      let breve = varias ? p.respuestas![0] : respuestaBreve(p);
      // Las que se responden con una explicación: el resultado y, a continuación, lo que debe decir
      if (p.tipo === 'vfjustificada' || p.tipo === 'definicion' || p.tipo === 'error') {
        const modelo = (p.explicacion || p.solucion || '').trim();
        if (modelo) breve = breve ? `${breve}. ${modelo}` : modelo;
      }
      lineas.push(`| ${n} | ${celda(breve)} | ${fmtPuntos(p.puntos)} | ${celda(varias ? p.respuestas!.slice(1).join(' / ') : '')} |`);
    }
    lineas.push('');
    const notas: [TipoActividad, string][] = [
      ['multiple', 'Respuesta múltiple: cada opción correcta marcada suma su parte y cada incorrecta la resta (mínimo 0).'],
      ['numerica', 'Respuesta numérica: se acepta el resultado dentro del margen indicado; con el planteamiento correcto y un error de cálculo, la mitad; sin unidades o con unidades incorrectas, se resta una cuarta parte.'],
      ['banco', 'Texto con huecos: puntuación proporcional al número de huecos bien completados.'],
      ['tabla', 'Completar tabla: puntuación proporcional al número de casillas correctas.'],
      ['vfjustificada', 'V o F justificada: la mitad de la puntuación por acertar y la otra mitad por la justificación.'],
      ['emparejar', 'Relacionar: puntuación proporcional al número de parejas correctas.'],
      ['ordenar', 'Ordenar: la puntuación completa con el orden correcto; la mitad si solo hay un elemento fuera de sitio.'],
      ['clasificar', 'Clasificar: puntuación proporcional al número de elementos bien clasificados.'],
      ['error', 'Encuentra el error: la mitad por localizarlo y la mitad por corregirlo.'],
      ['definicion', 'Definiciones: la puntuación completa con una definición precisa; la mitad si es incompleta o imprecisa.'],
    ];
    for (const [t, nota] of notas) if (cerradas.some(({ p }) => p.tipo === t)) lineas.push(`*${nota}*`, '');
  }
  const abiertas = ex.preguntas.map((p, i) => ({ p, n: i + 1 })).filter(({ p }) => TIPOS_CON_RUBRICA.includes(p.tipo));
  if (abiertas.length) {
    lineas.push('## Rúbrica de las preguntas abiertas', '');
    for (const { p, n } of abiertas) {
      lineas.push(`### Pregunta ${n} (${textoPuntos(p.puntos)})`, '', `*${celda(p.enunciado).slice(0, 400)}*`, '');
      const rubrica = p.rubrica ?? [];
      if (rubrica.length) {
        // Columnas: los niveles del primer criterio (la IA usa los mismos en todos)
        const niveles = rubrica[0].niveles.map((x) => x.nivel);
        const iguales = rubrica.every((c) => c.niveles.length === niveles.length && c.niveles.every((x, i) => x.nivel === niveles[i]));
        if (iguales && niveles.length) {
          lineas.push(
            `| Criterio | ${niveles.map(celda).join(' | ')} |`,
            `|---|${niveles.map(() => '---').join('|')}|`,
            ...rubrica.map((c) => `| **${celda(c.criterio)}** (${fmtPuntos(c.puntos)} p) | ${c.niveles.map((x) => `${celda(x.descripcion)} **(${fmtPuntos(x.puntos)})**`).join(' | ')} |`),
          );
        } else {
          for (const c of rubrica) {
            lineas.push(`- **${c.criterio}** (${fmtPuntos(c.puntos)} p)`, ...c.niveles.map((x) => `    - *${x.nivel}* (${fmtPuntos(x.puntos)}): ${x.descripcion}`));
          }
        }
        lineas.push('');
      }
      if (p.errores?.length) lineas.push('**Errores frecuentes:**', '', ...p.errores.map((e) => `- ${e}`), '');
      if (p.criterios?.length) lineas.push(`**Criterios de evaluación:** ${p.criterios.join(', ')}`, '');
    }
  }
  return lineas.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** «10 tipo test · 2 desarrollo». */
export function resumenExamen(op: Pick<OpcionesExamen, 'tipos'>): string {
  return tiposExamen(op)
    .map(([t, n]) => `${n} ${nombreTipo(t).toLowerCase()}`)
    .join(' · ');
}
