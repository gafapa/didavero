// Índice local de las fuentes (RAG): extrae el texto de cada archivo, lo trocea en fragmentos
// con su página y lo indexa con BM25 (MiniSearch). Así los agentes pueden pedir solo los
// fragmentos relevantes en lugar de leer documentos enteros, que es lo que más tokens gasta.
//
// Caché por archivo en «fuentes/.indice/<archivo>.json»; solo se vuelve a procesar un archivo
// si cambia. Lo usan el servidor (indexar y buscar) y el servidor MCP de los agentes (buscar).
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import MiniSearch from 'minisearch';
import { writeFileAtomic } from './atomicFiles';

export interface Fragmento {
  archivo: string;
  pagina?: number; // en PDF
  titulo?: string; // último encabezado (en Markdown)
  texto: string;
}

export interface ResultadoRag extends Fragmento {
  carpeta: string; // «asignatura» o «documento»
  puntuacion: number;
}

export interface InfoIndice {
  archivo: string;
  fragmentos: number;
  paginas?: number;
  estado: 'indexado' | 'sin-texto' | 'no-admitido';
}

const VERSION = 3;
const TAM_FRAGMENTO = 1100;
const TEXTO_EXTRAIDO = /\.(docx|odt|pptx|epub|rtf|html?|xlsx)$/i; // se leen de .texto/ (Pandoc)

// ---------------------------------------------------------------------------
// Normalización para el español: sin tildes, sin palabras vacías y raíz sencilla

const VACIAS = new Set(
  (
    'a al algo ante antes aquel aquella aqui asi aun bajo bien cada como con contra cual cuales cuando de del desde donde dos el ella ellas ellos en ' +
    'entre era eran es esa esas ese eso esos esta estan estas este esto estos fue fueron ha han hasta hay la las le les lo los mas me mi mucho muy ' +
    'nada ni no nos o otra otras otro otros para pero poco por porque que quien se sea segun ser si sin sobre son su sus tambien tan tanto te tiene ' +
    'tienen todo todos tras tu un una unas uno unos y ya the of and to in is are for on with as by an or be this that from at'
  ).split(' '),
);

function raiz(p: string): string {
  if (p.length > 5 && p.endsWith('es')) return p.slice(0, -2);
  if (p.length > 4 && p.endsWith('s')) return p.slice(0, -1);
  return p;
}

export function terminos(texto: string): string[] {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9ñ]+/)
    .filter((p) => p.length > 1 && !VACIAS.has(p))
    .map(raiz);
}

const opcionesIndice = {
  fields: ['texto', 'titulo', 'archivo'],
  storeFields: ['archivo', 'pagina', 'titulo', 'texto', 'carpeta'],
  // Se normaliza el texto entero de una vez y no palabra a palabra (indexa casi el doble de rápido)
  tokenize: terminos,
  processTerm: (t: string) => t,
  searchOptions: { boost: { titulo: 2, archivo: 1.5 }, fuzzy: 0.15, prefix: true, combineWith: 'OR' as const },
};

// ---------------------------------------------------------------------------
// Extracción de texto

// import() oculto al empaquetador: pdfjs es un módulo ESM y el proceso principal es CommonJS
const importar = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

export async function textoPdf(ruta: string): Promise<{ pagina: number; texto: string }[]> {
  const pdfjs = await importar('pdfjs-dist/legacy/build/pdf.mjs');
  const datos = new Uint8Array(await fs.readFile(ruta));
  const tarea = pdfjs.getDocument({ data: datos, useSystemFonts: true, disableFontFace: true, verbosity: 0 });
  const doc = await tarea.promise;
  const paginas: { pagina: number; texto: string }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const c = await p.getTextContent();
    const texto = c.items
      .map((it: { str?: string; hasEOL?: boolean }) => (it.str ?? '') + (it.hasEOL ? '\n' : ' '))
      .join('')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    paginas.push({ pagina: i, texto });
  }
  await tarea.destroy();
  return paginas;
}

/** Trocea un texto en fragmentos de ~1.100 caracteres respetando párrafos (y anotando el encabezado). */
function trocear(texto: string, base: Omit<Fragmento, 'texto'>): Fragmento[] {
  const res: Fragmento[] = [];
  let actual = '';
  let titulo = base.titulo;
  let tituloFragmento = titulo;
  const cerrar = () => {
    const t = actual.trim();
    if (t.length > 40) res.push({ ...base, titulo: tituloFragmento, texto: t });
    actual = '';
    tituloFragmento = titulo;
  };
  for (const parrafo of texto.split(/\n\s*\n/)) {
    const h = parrafo.match(/^\s*#{1,6}\s+(.+)/);
    if (h) {
      cerrar();
      titulo = h[1].trim();
      tituloFragmento = titulo;
    }
    if (actual.length + parrafo.length > TAM_FRAGMENTO && actual) cerrar();
    // Párrafos enormes (PDF sin saltos): se cortan por frases
    if (parrafo.length > TAM_FRAGMENTO * 1.5) {
      for (const trozo of parrafo.match(new RegExp(`[\\s\\S]{1,${TAM_FRAGMENTO}}(?:[.!?](?=\\s)|$)`, 'g')) ?? [parrafo]) {
        actual += `${trozo} `;
        if (actual.length > TAM_FRAGMENTO) cerrar();
      }
    } else {
      actual += `${parrafo}\n\n`;
    }
  }
  cerrar();
  return res;
}

async function extraer(dirFuentes: string, archivo: string): Promise<{ fragmentos: Fragmento[]; paginas?: number; estado: InfoIndice['estado'] }> {
  const ruta = path.join(dirFuentes, archivo);
  if (/\.pdf$/i.test(archivo)) {
    const paginas = await textoPdf(ruta);
    const fragmentos = paginas.flatMap((p) => trocear(p.texto, { archivo, pagina: p.pagina }));
    return { fragmentos, paginas: paginas.length, estado: fragmentos.length ? 'indexado' : 'sin-texto' };
  }
  let texto: string | undefined;
  if (/\.(md|markdown|txt)$/i.test(archivo)) texto = await fs.readFile(ruta, 'utf8');
  else if (TEXTO_EXTRAIDO.test(archivo)) texto = await fs.readFile(path.join(dirFuentes, '.texto', `${archivo}.md`), 'utf8').catch(() => undefined);
  if (texto === undefined) return { fragmentos: [], estado: 'no-admitido' };
  const fragmentos = trocear(texto, { archivo });
  return { fragmentos, estado: fragmentos.length ? 'indexado' : 'sin-texto' };
}

// ---------------------------------------------------------------------------
// Índice por carpeta

interface Cache {
  version: number;
  mtime: number;
  tam: number;
  paginas?: number;
  estado: InfoIndice['estado'];
  fragmentos: Fragmento[];
  fallo?: boolean; // la extracción falló: se reintenta la próxima vez
}

const nombreCache = (archivo: string) => `${archivo}.json`;

/** Actualiza las cachés de una carpeta de fuentes. Devuelve el estado de cada archivo. */
const indexing = new Map<string, Promise<InfoIndice[]>>();
export function indexar(dirFuentes: string): Promise<InfoIndice[]> {
  const key = path.resolve(dirFuentes);
  let operation = indexing.get(key);
  if (!operation) {
    operation = indexFolder(key); indexing.set(key, operation);
    void operation.finally(() => { if (indexing.get(key) === operation) indexing.delete(key); }).catch(() => {});
  }
  return operation;
}

async function indexFolder(dirFuentes: string): Promise<InfoIndice[]> {
  if (!existsSync(dirFuentes)) return [];
  const dirIndice = path.join(dirFuentes, '.indice');
  await fs.mkdir(dirIndice, { recursive: true });
  const archivos = (await fs.readdir(dirFuentes, { withFileTypes: true })).filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name);
  const res: InfoIndice[] = [];
  for (const archivo of archivos) {
    let st;
    try { st = await fs.stat(path.join(dirFuentes, archivo)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const rutaCache = path.join(dirIndice, nombreCache(archivo));
    let cache: Cache | undefined;
    try {
      cache = JSON.parse(await fs.readFile(rutaCache, 'utf8'));
    } catch {}
    // Los textos extraídos con Pandoc pueden llegar después que el archivo
    const extraido = TEXTO_EXTRAIDO.test(archivo) ? path.join(dirFuentes, '.texto', `${archivo}.md`) : undefined;
    let extractedTime = 0;
    if (extraido) try { extractedTime = (await fs.stat(extraido)).mtimeMs; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const mtime = Math.max(st.mtimeMs, extractedTime);
    if (cache && (!Array.isArray(cache.fragmentos) || cache.fragmentos.some(fragment => !fragment || typeof fragment.texto !== 'string' || typeof fragment.archivo !== 'string'))) cache = undefined;
    if (!cache || cache.fallo || cache.version !== VERSION || cache.mtime !== mtime || cache.tam !== st.size) {
      try {
        const r = await extraer(dirFuentes, archivo);
        cache = { version: VERSION, mtime, tam: st.size, paginas: r.paginas, estado: r.estado, fragmentos: r.fragmentos };
      } catch (e) {
        console.warn(`No se pudo extraer el texto de ${archivo}:`, (e as Error).message);
        cache = { version: VERSION, mtime, tam: st.size, estado: 'sin-texto', fragmentos: [], fallo: true };
      }
      await writeFileAtomic(rutaCache, JSON.stringify(cache));
      invalidateSourceCache(dirFuentes);
    }
    res.push({ archivo, fragmentos: cache.fragmentos.length, paginas: cache.paginas, estado: cache.estado });
  }
  // Cachés de archivos que ya no existen
  const indexedFiles = new Set(res.map(info => info.archivo));
  for (const c of (await fs.readdir(dirIndice)).filter(name => !name.startsWith('.') && name.endsWith('.json'))) {
    if (!indexedFiles.has(c.replace(/\.json$/, ''))) {
      await fs.rm(path.join(dirIndice, c), { force: true });
      invalidateSourceCache(dirFuentes);
    }
  }
  return res;
}

async function leerCaches(dirFuentes: string): Promise<Fragmento[]> {
  const dirIndice = path.join(dirFuentes, '.indice');
  if (!existsSync(dirIndice)) return [];
  const res: Fragmento[] = [];
  for (const c of await fs.readdir(dirIndice)) {
    try {
      const cache: Cache = JSON.parse(await fs.readFile(path.join(dirIndice, c), 'utf8'));
      res.push(...cache.fragmentos);
    } catch {}
  }
  return res;
}

/** Firma de la carpeta de índice para saber si el índice en memoria sigue valiendo. */
async function firma(dirFuentes: string): Promise<string> {
  try {
    const directory = path.join(dirFuentes, '.indice');
    const files = (await fs.readdir(directory)).filter(name => name.endsWith('.json')).sort();
    const stamps = await Promise.all(files.map(async name => {
      try {
        const stats = await fs.stat(path.join(directory, name));
        return `${name}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}:${stats.ino}`;
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return `${name}:missing`; throw error; }
    }));
    return stamps.join('|');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

type Memoria = { firma: string; fragmentos: Fragmento[] };
const memoria = new Map<string, Memoria>();
const sourceLoads = new Map<string, Promise<Memoria>>();

function invalidateSourceCache(directory: string) {
  memoria.delete(directory);
  sourceLoads.delete(directory);
}

async function sourceMemory(directory: string): Promise<Memoria> {
  const stamp = await firma(directory);
  const cached = memoria.get(directory);
  if (cached?.firma === stamp) {
    memoria.delete(directory);
    memoria.set(directory, cached);
    return cached;
  }
  const pending = sourceLoads.get(directory);
  if (pending) return pending;
  const loading = leerCaches(directory).then(fragmentos => ({ firma: stamp, fragmentos }));
  sourceLoads.set(directory, loading);
  try {
    const result = await loading;
    // An invalidation during loading must not put old data back into the cache.
    if (sourceLoads.get(directory) === loading) {
      memoria.delete(directory);
      memoria.set(directory, result);
      if (memoria.size > 24) memoria.delete(memoria.keys().next().value!);
    }
    return result;
  } finally { if (sourceLoads.get(directory) === loading) sourceLoads.delete(directory); }
}

/** Fragmentos de cada carpeta, leídos de sus cachés solo si han cambiado. */
async function memoriasDe(carpetas: Record<string, string>): Promise<Memoria[]> {
  return Promise.all(Object.values(carpetas).map(sourceMemory));
}

async function fragmentosDe(carpetas: Record<string, string>) {
  const memorias = await memoriasDe(carpetas);
  const todos: (Fragmento & { carpeta: string; id: number })[] = [];
  Object.keys(carpetas).forEach((carpeta, n) => {
    for (const f of memorias[n].fragmentos) todos.push({ ...f, carpeta, id: todos.length });
  });
  return todos;
}

/**
 * Índices BM25 ya construidos, por conjunto de carpetas. Construirlo cuesta mucho más que buscar
 * (con ~1.500 páginas, un segundo frente a unos milisegundos) y los agentes buscan muchas veces
 * seguidas. Se rehace cuando cambia lo leído de alguna de las carpetas.
 */
const indices = new Map<string, { usadas: Memoria[]; indice: MiniSearch; total: number }>();

async function indiceDe(carpetas: Record<string, string>) {
  const clave = JSON.stringify(carpetas);
  const usadas = await memoriasDe(carpetas);
  let i = indices.get(clave);
  if (!i || i.usadas.some((m, n) => m !== usadas[n])) {
    const fragmentos = Object.keys(carpetas).flatMap((label, position) => usadas[position].fragmentos.map(fragment => ({ ...fragment, carpeta: label })));
    const indice = new MiniSearch(opcionesIndice);
    indice.addAll(fragmentos.map((fragment, id) => ({ ...fragment, id })));
    i = { usadas, indice, total: fragmentos.length };
  }
  indices.delete(clave);
  indices.set(clave, i); // el más reciente, al final
  if (indices.size > 6) indices.delete(indices.keys().next().value!);
  return i;
}

/** Busca en las fuentes indexadas. `carpetas`: etiqueta → carpeta de fuentes. */
export async function buscar(carpetas: Record<string, string>, consulta: string, max = 6, archivo?: string): Promise<ResultadoRag[]> {
  if (!consulta.trim()) return [];
  const { indice, total } = await indiceDe(carpetas);
  if (!total) return [];
  return indice.search(consulta, archivo ? { filter: (r) => r.archivo === archivo } : undefined).slice(0, max).map((r) => ({
    archivo: r.archivo,
    pagina: r.pagina,
    titulo: r.titulo,
    texto: r.texto,
    carpeta: r.carpeta,
    puntuacion: Math.round(r.score * 10) / 10,
  }));
}

/** Busca en un texto suelto (p. ej. el dossier) sin índice en disco. */
export function buscarEnTexto(texto: string, nombre: string, consulta: string, max = 8): Fragmento[] {
  const fragmentos = trocear(texto, { archivo: nombre }).map((f, id) => ({ ...f, id }));
  if (!fragmentos.length) return [];
  const indice = new MiniSearch(opcionesIndice);
  indice.addAll(fragmentos.map((f) => ({ ...f, carpeta: '' })));
  const elegidos = new Set(indice.search(consulta).slice(0, max).map((r) => r.id as number));
  return fragmentos.filter((f) => elegidos.has(f.id)); // en el orden original del texto
}

/** Texto de una página (PDF) o de un fragmento concreto. */
export async function leerPagina(carpetas: Record<string, string>, archivo: string, pagina?: number): Promise<string> {
  const fr = (await fragmentosDe(carpetas)).filter((f) => f.archivo === archivo && (pagina === undefined || f.pagina === pagina));
  return fr.map((f) => f.texto).join('\n\n');
}

export async function listar(carpetas: Record<string, string>) {
  const res: { carpeta: string; archivo: string; paginas?: number; fragmentos: number; inicio: string }[] = [];
  for (const [carpeta, dir] of Object.entries(carpetas)) {
    const dirIndice = path.join(dir, '.indice');
    if (!existsSync(dirIndice)) continue;
    for (const c of await fs.readdir(dirIndice)) {
      try {
        const cache: Cache = JSON.parse(await fs.readFile(path.join(dirIndice, c), 'utf8'));
        res.push({
          carpeta,
          archivo: c.replace(/\.json$/, ''),
          paginas: cache.paginas,
          fragmentos: cache.fragmentos.length,
          inicio: (cache.fragmentos[0]?.texto ?? '').slice(0, 200).replace(/\s+/g, ' '),
        });
      } catch {}
    }
  }
  return res;
}

/** ¿Hay algo indexado en estas carpetas? */
export async function hayIndice(carpetas: Record<string, string>) {
  return (await memoriasDe(carpetas)).some((m) => m.fragmentos.length > 0);
}

/** Fragmentos formateados para incluir en un prompt, con su referencia. */
export function formatear(resultados: (Fragmento & { carpeta?: string })[], options: { subjectLevel?: boolean } = {}): string {
  return resultados
    .map((r) => {
      const ref = [r.carpeta === 'asignatura' && !options.subjectLevel ? `../../fuentes/${r.archivo}` : `fuentes/${r.archivo}`, r.pagina && `pág. ${r.pagina}`, r.titulo && `«${r.titulo}»`]
        .filter(Boolean)
        .join(', ');
      return `[${ref}]\n${r.texto}`;
    })
    .join('\n\n---\n\n');
}
