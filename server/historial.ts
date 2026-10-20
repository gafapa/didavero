// Historial de versiones de las secciones. Cada vez que un archivo de secciones/ cambia (lo escriba
// un agente, el editor o una sugerencia aceptada) se guarda el texto que tenía antes, agrupando las
// ráfagas de cambios: un agente que edita diez veces seguidas deja una sola versión, la de antes de
// empezar. Las versiones van en .historial/<sección>/ dentro de la carpeta del documento.
//
// El texto importado (unos apuntes existentes) se guarda aparte, en original/secciones/, para
// poder comparar en todo momento con lo que había al principio.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { VersionSeccion } from '../shared/tipos';
import { nombreSeguro } from './store';

/** Cambios separados por menos de esto son la misma edición. */
const VENTANA_MS = 3 * 60_000;
const MAX_VERSIONES = 40;

/** Nombre estable de una sección: sin el prefijo numérico, que cambia al reordenar. */
export const claveSeccion = (archivo: string) => archivo.replace(/^\d+-/, '').replace(/\.md$/, '');

const palabras = (t: string) => t.split(/\s+/).filter(Boolean).length;

export class Historial {
  private ultimo = new Map<string, string>(); // ruta de la sección → último texto conocido
  private ultimoCambio = new Map<string, number>();

  constructor(private raiz: () => string) {}

  dirVersiones(dirDoc: string, archivo: string) {
    return path.join(dirDoc, '.historial', nombreSeguro(claveSeccion(nombreSeguro(archivo))));
  }

  rutaOriginal(dirDoc: string, archivo: string) {
    return path.join(dirDoc, 'original', 'secciones', `${nombreSeguro(claveSeccion(nombreSeguro(archivo)))}.md`);
  }

  /** Lee el texto actual de todas las secciones para saber qué había antes del primer cambio. */
  async cebar() {
    this.ultimo.clear();
    const raiz = this.raiz();
    for (const asig of await fs.readdir(raiz).catch(() => [] as string[])) {
      if (asig.startsWith('.')) continue;
      const dirDocs = path.join(raiz, asig, 'documentos');
      for (const doc of await fs.readdir(dirDocs).catch(() => [] as string[])) {
        const dirSec = path.join(dirDocs, doc, 'secciones');
        for (const f of await fs.readdir(dirSec).catch(() => [] as string[])) {
          if (!f.endsWith('.md')) continue;
          const ruta = path.join(dirSec, f);
          this.ultimo.set(ruta, await fs.readFile(ruta, 'utf8').catch(() => ''));
        }
      }
    }
  }

  /** Aviso del vigilante de archivos (ruta relativa a la carpeta de datos, con «/»). */
  async alCambiar(rel: string) {
    const m = rel.match(/^([^/]+)\/documentos\/([^/]+)\/secciones\/([^/]+\.md)$/);
    if (!m) return;
    const ruta = path.join(this.raiz(), ...rel.split('/'));
    const dirDoc = path.join(this.raiz(), m[1], 'documentos', m[2]);
    const nuevo = existsSync(ruta) ? await fs.readFile(ruta, 'utf8').catch(() => null) : null;
    const anterior = this.ultimo.get(ruta);
    const ahora = Date.now();
    const enRafaga = ahora - (this.ultimoCambio.get(ruta) ?? 0) < VENTANA_MS;
    if (nuevo === null) this.ultimo.delete(ruta);
    else this.ultimo.set(ruta, nuevo);
    if (anterior === undefined || anterior === nuevo) return;
    this.ultimoCambio.set(ruta, ahora);
    // Al reordenar, las secciones solo cambian de prefijo: no es un borrado
    if (nuevo === null) {
      const hermanas = await fs.readdir(path.dirname(ruta)).catch(() => [] as string[]);
      if (hermanas.some((f) => f.endsWith('.md') && claveSeccion(f) === claveSeccion(m[3]))) return;
    }
    // Una sección borrada se guarda siempre (para poder recuperarla); un cambio, al empezar la ráfaga
    if (anterior.trim() && (nuevo === null || !enRafaga)) await this.guardar(dirDoc, m[3], anterior);
  }

  /** Guarda un texto como versión de la sección (si no es igual que la última guardada). */
  async guardar(dirDoc: string, archivo: string, texto: string) {
    const dir = this.dirVersiones(dirDoc, archivo);
    await fs.mkdir(dir, { recursive: true });
    const existentes = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).sort();
    const ultima = existentes[existentes.length - 1];
    if (ultima && (await fs.readFile(path.join(dir, ultima), 'utf8').catch(() => '')) === texto) return;
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.writeFile(path.join(dir, `${id}.md`), texto, 'utf8');
    for (const viejo of existentes.slice(0, Math.max(0, existentes.length + 1 - MAX_VERSIONES))) {
      await fs.rm(path.join(dir, viejo), { force: true });
    }
  }

  /** Versiones de una sección, de la más reciente a la más antigua, y el original importado. */
  async listar(dirDoc: string, archivo: string): Promise<VersionSeccion[]> {
    const dir = this.dirVersiones(dirDoc, archivo);
    const res: VersionSeccion[] = [];
    for (const f of (await fs.readdir(dir).catch(() => [] as string[])).filter((x) => x.endsWith('.md')).sort().reverse()) {
      const id = f.replace(/\.md$/, '');
      const texto = await fs.readFile(path.join(dir, f), 'utf8').catch(() => '');
      // 2026-10-10T10-43-40-123Z → ISO
      const fecha = id.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, '$1:$2:$3.$4Z');
      res.push({ id, fecha, palabras: palabras(texto) });
    }
    const original = this.rutaOriginal(dirDoc, archivo);
    if (existsSync(original)) {
      const st = await fs.stat(original);
      res.push({ id: 'original', fecha: st.mtime.toISOString(), palabras: palabras(await fs.readFile(original, 'utf8')) });
    }
    return res;
  }

  async leer(dirDoc: string, archivo: string, id: string): Promise<string> {
    if (id === 'original') return fs.readFile(this.rutaOriginal(dirDoc, archivo), 'utf8');
    if (!/^[\dTZ-]+$/.test(id)) throw new Error('Versión no válida');
    return fs.readFile(path.join(this.dirVersiones(dirDoc, archivo), `${id}.md`), 'utf8');
  }
}
