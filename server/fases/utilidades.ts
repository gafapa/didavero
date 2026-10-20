// Tipos y funciones auxiliares del flujo de trabajo de un documento.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Ajustes, Apartado, Esfuerzo, Indice, Motor, PasoFlujo, Profundidad, TipoVisual } from '../../shared/tipos';
import { type Permisos } from '../../shared/tipos';
import { Almacen } from '../store';
import type { Cola, Postproceso } from '../agents/cola';
import type { Moleculas } from '../moleculas';
import { ESFUERZOS } from '../agents/modelos';

export interface Dependencias {
  almacen: () => Almacen;
  cola: Cola;
  ajustes: () => Ajustes;
  motoresListos: () => Set<Motor>;
  dirBin?: string;
  mcpFuentes?: { comando: string; args: string[]; env?: Record<string, string> };
  moleculas?: Moleculas;
  /** Tokens (entrada + salida) gastados ya en un documento, para su tope. */
  gastoDocumento?: (asig: string, doc: string) => number;
}

export interface Lanzamiento {
  /** Exclude private teaching context from public web research. */
  publicContext?: boolean;
  agente: string;
  asignatura: string;
  documento?: string;
  titulo: string;
  tarea: string;
  indicaciones?: string;
  paso: PasoFlujo;
  seccion?: string;
  ref?: string;
  motor?: Motor; // forzar motor
  seccionActiva?: string;
  web?: boolean; // sobrescribe si el agente puede buscar en la web
  imagenes?: boolean; // herramienta de búsqueda de imágenes en museos y bibliotecas
  guardarImagenes?: boolean; // y la de descargarlas a recursos/ (para peticiones libres)
  fuentes?: boolean; // false: sin la búsqueda en las fuentes aunque estén indexadas
  carpetas?: Record<string, string>; // carpetas de fuentes para la búsqueda (por defecto, las del documento y la asignatura)
  esfuerzo?: Esfuerzo; // sobrescribe el esfuerzo del agente para esta tarea
  /** Contenido que se incluye en el mensaje para que el agente no tenga que leerlo (ahorra tokens). */
  incluir?: { dossier?: boolean; secciones?: string[]; glosario?: boolean; consulta?: string };
  post?: Postproceso;
}

export const INDICE_VACIO: Indice = { profundidad: 1, entradas: [], notas: '', aprobado: false, actualizado: '' };

export const profundidadValida = (p: unknown): Profundidad => (p === 2 || p === 3 ? p : 1);

/** Normaliza el árbol de apartados (de la IA o del usuario) hasta la profundidad indicada. */
export function limpiarApartados(lista: unknown, niveles: number): Apartado[] {
  if (niveles <= 0 || !Array.isArray(lista)) return [];
  return lista
    .map((x) => (typeof x === 'string' ? { titulo: x } : (x as Partial<Apartado>)))
    .filter((x) => x && String(x.titulo ?? '').trim())
    .map((x) => ({
      id: x.id || randomUUID().slice(0, 8),
      titulo: String(x.titulo).trim(),
      apartados: limpiarApartados(x.apartados, niveles - 1),
    }));
}

/** Estructura de apartados como lista de encabezados Markdown, para el redactor. */
export function estructuraMarkdown(apartados: Apartado[], nivel = 2): string[] {
  return apartados.flatMap((a) => [`${'  '.repeat(nivel - 2)}- ${'#'.repeat(nivel)} ${a.titulo}`, ...estructuraMarkdown(a.apartados, nivel + 1)]);
}



/**
 * Sustituye en el texto la imagen enlazada a `ruta` (y su línea «*Fuente: …*» o la nota en cursiva
 * entre paréntesis que la acompañe) por `bloque`. Undefined si la imagen no está en el texto.
 */
export function sustituirImagen(texto: string, ruta: string, bloque: string): { texto: string; encontrado: boolean } | undefined {
  const lineas = texto.split('\n');
  const i = lineas.findIndex((l) => /^\s*!\[[^\]]*\]\(([^)\s]+)\)/.test(l) && l.includes(`](${ruta})`));
  if (i < 0) return undefined;
  let fin = i + 1;
  let j = i + 1;
  while (j < lineas.length && !lineas[j].trim()) j++;
  if (/^\s*(\*(Fuente:[^*]+|\([^*]+\))\*|(Tomado|Adaptado) de .+)\s*$/.test(lineas[j] ?? '')) fin = j + 1;
  lineas.splice(i, fin - i, bloque);
  return { texto: lineas.join('\n'), encontrado: true };
}

export function aplanarApartados(l: Apartado[]): string[] {
  return l.flatMap((a) => [a.titulo, ...aplanarApartados(a.apartados ?? [])]);
}

/** Respuesta a una pregunta dentro del dossier (apartado «### Pregunta: …»), si existe. */
export function respuestaEnDossier(dossier: string, pregunta: string): string | undefined {
  if (!dossier) return undefined;
  const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[¿?¡!.\s]+/g, ' ').trim().toLowerCase();
  const objetivo = norm(pregunta);
  const lineas = dossier.split(/\r?\n/);
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/^(#{2,4})\s*Pregunta:\s*(.+)$/i);
    if (!m || norm(m[2]) !== objetivo) continue;
    const nivel = m[1].length;
    const cuerpo: string[] = [];
    for (let j = i + 1; j < lineas.length; j++) {
      const h = lineas[j].match(/^(#{1,6})\s/);
      if (h && h[1].length <= nivel) break;
      cuerpo.push(lineas[j]);
    }
    const texto = cuerpo.join('\n').trim();
    return texto || undefined;
  }
  return undefined;
}


/** Lo que la ficha no permite, dicho al agente (el resto se controla quitándole la herramienta). */
export function textoRestricciones(p: Required<Permisos>): string {
  const no = [
    !p.diagramas && 'esquemas ni diagramas (bloques ```mermaid)',
    !p.moleculas && 'estructuras de moléculas (bloques ```molecula)',
    !p.imagenesWeb && !p.imagenesIA && 'imágenes',
    p.imagenesWeb !== p.imagenesIA && (p.imagenesWeb ? 'imágenes generadas con IA' : 'imágenes reales de internet, museos o bibliotecas'),
  ].filter(Boolean);
  return no.length ? `\n\n## Restricciones de esta asignatura\nNo incluyas ni propongas ${no.join(', ni ')}.` : '';
}

/** Tipos de visual que se pueden proponer o generar según la ficha (y si Codex está disponible). */
export function tiposVisualesPermitidos(p: Required<Permisos>, conCodex: boolean): TipoVisual[] {
  return [
    p.diagramas && 'diagrama',
    p.diagramas && 'grafica',
    p.diagramas && 'mapa',
    p.moleculas && 'molecula',
    p.imagenesWeb && 'imagen-web',
    p.imagenesIA && conCodex && 'imagen-ia',
  ].filter((t): t is TipoVisual => !!t);
}

/** El menor de dos niveles de esfuerzo. */
export function menorEsfuerzo(a: Esfuerzo, b: Esfuerzo): Esfuerzo {
  return ESFUERZOS.indexOf(a) <= ESFUERZOS.indexOf(b) ? a : b;
}

export type TipoVersion = 'lectura-facil' | 'refuerzo' | 'ampliacion';

/** Pautas de cada versión adaptada (atención a la diversidad). */
export const GUIAS_VERSION: Record<TipoVersion, { nombre: string; pautas: string }> = {
  'lectura-facil': {
    nombre: 'Lectura fácil',
    pautas: `- Sigue las pautas de lectura fácil (norma UNE 153101 EX): frases cortas, una idea por frase y un mensaje por párrafo.
- Vocabulario frecuente y concreto. Si un término técnico es imprescindible, explícalo con palabras sencillas la primera vez que aparece (puedes destacarlo en negrita).
- Voz activa, orden sujeto-verbo-complemento, sin dobles negaciones, metáforas, ironías ni frases hechas.
- Números en cifra; listas cuando haya varios elementos; ejemplos cotidianos.
- Quita lo accesorio (detalles, excepciones, curiosidades) y conserva lo esencial del objetivo de la sección.
- Mantén las imágenes y los esquemas: ayudan a entender.`,
  },
  refuerzo: {
    nombre: 'Refuerzo',
    pautas: `- Para alumnado que necesita afianzar lo básico: los mismos contenidos esenciales, explicados paso a paso y más despacio.
- Más ejemplos resueltos y guiados (de lo sencillo a lo complejo), con las dificultades habituales y cómo evitarlas.
- Al final de cada apartado, un recuadro «Recuerda» (cita en Markdown) con las ideas clave y 2-3 preguntas rápidas de comprobación con su solución en un bloque \`::: solucion\`.
- Reduce o quita lo que no sea esencial para el objetivo; no añadas contenidos nuevos.`,
  },
  ampliacion: {
    nombre: 'Ampliación',
    pautas: `- Para alumnado con alto rendimiento o interés: conserva todo el contenido y profundiza.
- Añade conexiones con otros temas y materias, aplicaciones reales, casos, matices y debates actuales.
- Añade al final de la sección un apartado «Para saber más» con 2-3 retos o problemas de mayor dificultad (con su solución en un bloque \`::: solucion\`) y alguna lectura o recurso fiable.
- No inventes datos ni referencias: si citas algo, que sea comprobable.`,
  },
};

export interface AmbitoChat {
  vista: string; // pestaña abierta en la zona central (paso del flujo, apuntes, recursos, material, ficha)
  seccion?: string; // sección abierta (en «apuntes»)
}

/** Qué puede tocar el agente según la pestaña abierta (rutas relativas a la carpeta del documento). */
export const AMBITOS: Record<string, { nombre: string; descripcion: string; permitidos: string[] }> = {
  apuntes: { nombre: 'Apuntes (documento completo)', descripcion: 'las secciones del documento (secciones/*.md).', permitidos: ['secciones/'] },
  redaccion: { nombre: 'Redacción', descripcion: 'las secciones del documento (secciones/*.md).', permitidos: ['secciones/'] },
  investigacion: { nombre: 'Investigación', descripcion: 'el dossier de investigación (investigacion.md) y sus preguntas (preguntas.json). No modifiques las secciones.', permitidos: ['investigacion.md', 'preguntas.json'] },
  indice: { nombre: 'Índice director', descripcion: 'el índice director (indice.json), manteniendo su formato. No modifiques las secciones.', permitidos: ['indice.json'] },
  revision: { nombre: 'Revisión', descripcion: 'las sugerencias de revisión (sugerencias.json). No modifiques las secciones: las aplica el usuario.', permitidos: ['sugerencias.json'] },
  visuales: { nombre: 'Visuales', descripcion: 'las propuestas de visuales (visuales.json) y las imágenes (recursos/). No modifiques las secciones.', permitidos: ['visuales.json', 'recursos/'] },
  autoevaluacion: { nombre: 'Autoevaluación', descripcion: 'los bloques de actividades (actividades.json), manteniendo su formato. No modifiques las secciones.', permitidos: ['actividades.json'] },
  exportar: { nombre: 'Exportar', descripcion: 'la exportación (formatos, opciones, archivos exportados).', permitidos: [] },
  recursos: { nombre: 'Imágenes', descripcion: 'las imágenes del documento (recursos/). No modifiques las secciones.', permitidos: ['recursos/'] },
  material: { nombre: 'Fuentes', descripcion: 'las fuentes del documento (fuentes/). No modifiques las secciones.', permitidos: ['fuentes/'] },
  ficha: { nombre: 'Ficha', descripcion: 'la ficha del documento (documento.json: título, objetivo, destinatarios y extensión). No modifiques las secciones.', permitidos: ['documento.json'] },
};

/** Contenido de los archivos de texto del documento (secciones y archivos de la raíz). */
export async function instantaneaDocumento(dir: string): Promise<Map<string, string>> {
  const r = new Map<string, string>();
  const leer = async (sub: string, filtro: RegExp) => {
    const nombres = await fs.readdir(path.join(dir, sub)).catch(() => [] as string[]);
    for (const n of nombres) {
      if (!filtro.test(n)) continue;
      const rel = sub ? `${sub}/${n}` : n;
      const texto = await fs.readFile(path.join(dir, rel), 'utf8').catch(() => undefined);
      if (texto !== undefined) r.set(rel, texto);
    }
  };
  await leer('', /\.(md|json)$/);
  await leer('secciones', /\.md$/);
  return r;
}
