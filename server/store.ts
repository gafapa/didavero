// Almacenamiento en disco: una carpeta por asignatura y una subcarpeta por documento.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Asignatura, AsignaturaDetalle, Documento, Exportado, Fuente, Permisos, Recurso, Seccion } from '../shared/tipos';
import { PERMISOS } from '../shared/tipos';
import type { Examen } from '../shared/examenes';
import { writeFileAtomic } from './atomicFiles';
import { CurriculumStore } from './curriculumStore';
import { withStorageLock } from './storageLock';
import { commitSectionOrder, recoverSectionOrder } from './sectionOrder';

const COLORES = ['#7c5cff', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#8b5cf6'];

export class ErrorUsuario extends Error {
  constructor(msg: string, public status = 400) {
    super(msg);
  }
}

export function slug(texto: string): string {
  const s = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || 'sin-titulo';
}

/** Valida que un nombre sea un único componente de ruta seguro. */
export function nombreSeguro(nombre: string): string {
  if (!nombre || nombre.startsWith('.') || /[\\/:*?"<>|]/.test(nombre) || nombre.length > 200) {
    throw new ErrorUsuario(`Nombre no válido: ${nombre}`);
  }
  return nombre;
}

async function leerJson<T>(archivo: string): Promise<T> {
  return JSON.parse(await fs.readFile(archivo, 'utf8')) as T;
}

async function escribirJson(archivo: string, datos: unknown) {
  await writeFileAtomic(archivo, JSON.stringify(datos, null, 2) + '\n');
}

async function leerTexto(archivo: string): Promise<string> {
  try {
    return await fs.readFile(archivo, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export async function nombreLibre(dir: string, base: string): Promise<string> {
  let nombre = base;
  for (let i = 2; existsSync(path.join(dir, nombre)); i++) nombre = `${base}-${i}`;
  return nombre;
}

/** Claim a unique directory atomically, including concurrent requests with the same title. */
export async function reserveDirectory(directory: string, base: string): Promise<string> {
  nombreSeguro(base);
  await fs.mkdir(directory, { recursive: true });
  for (let index = 1; index <= 10000; index++) {
    const name = index === 1 ? base : `${base}-${index}`;
    try { await fs.mkdir(path.join(directory, name)); return name; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  throw new ErrorUsuario('No se ha podido reservar un nombre libre');
}

function ahora() {
  return new Date().toISOString();
}

export class Almacen {
  private sectionSummaries = new Map<string, { stamp: string; summary: Seccion }>();
  constructor(public raiz: string) {}

  async iniciar() {
    await fs.mkdir(this.raiz, { recursive: true });
  }

  dirAsignatura(id: string) {
    return path.join(this.raiz, nombreSeguro(id));
  }

  dirDocumento(asig: string, doc: string) {
    return path.join(this.dirAsignatura(asig), 'documentos', nombreSeguro(doc));
  }

  // ---------- Asignaturas ----------

  async listarAsignaturas(): Promise<(Asignatura & { documentos: Documento[] })[]> {
    const entradas = await fs.readdir(this.raiz, { withFileTypes: true });
    const res: (Asignatura & { documentos: Documento[] })[] = [];
    for (const e of entradas) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const archivo = path.join(this.raiz, e.name, 'asignatura.json');
      if (!existsSync(archivo)) continue;
      const a = await leerJson<Asignatura>(archivo);
      res.push({ ...a, id: e.name, documentos: await this.listarDocumentos(e.name) });
    }
    return res.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  async obtenerAsignatura(id: string): Promise<AsignaturaDetalle> {
    const dir = this.dirAsignatura(id);
    const archivo = path.join(dir, 'asignatura.json');
    if (!existsSync(archivo)) throw new ErrorUsuario('La asignatura no existe', 404);
    const a = await leerJson<Asignatura>(archivo);
    return {
      ...a,
      id,
      contexto: await leerTexto(path.join(dir, 'contexto.md')),
      documentos: await this.listarDocumentos(id),
    };
  }

  async crearAsignatura(datos: Partial<AsignaturaDetalle>): Promise<AsignaturaDetalle> {
    const nombre = typeof datos.nombre === 'string' ? datos.nombre.trim() : '';
    if (!nombre) throw new ErrorUsuario('La asignatura necesita un nombre');
    const id = await reserveDirectory(this.raiz, slug(nombre));
    const dir = path.join(this.raiz, id);
    await fs.mkdir(path.join(dir, 'fuentes'), { recursive: true });
    await fs.mkdir(path.join(dir, 'documentos'), { recursive: true });
    const n = (await fs.readdir(this.raiz)).length;
    const a: Asignatura = {
      id,
      nombre,
      nivel: datos.nivel ?? '',
      etapa: datos.etapa,
      curso: datos.curso,
      modalidad: datos.modalidad,
      familia: datos.familia,
      titulo: datos.titulo,
      destinatarios: datos.destinatarios ?? '',
      idioma: datos.idioma || 'Castellano',
      estilo: datos.estilo ?? '',
      color: datos.color || COLORES[n % COLORES.length],
      creado: ahora(),
      actualizado: ahora(),
    };
    await escribirJson(path.join(dir, 'asignatura.json'), a);
    await fs.writeFile(path.join(dir, 'contexto.md'), datos.contexto ?? '', 'utf8');
    await fs.writeFile(path.join(dir, 'glosario.md'), '# Glosario\n', 'utf8');
    return this.obtenerAsignatura(id);
  }

  async actualizarAsignatura(id: string, datos: Partial<AsignaturaDetalle>): Promise<AsignaturaDetalle> {
    return withStorageLock(path.join(this.dirAsignatura(id), 'asignatura.json'), async () => {
    const dir = this.dirAsignatura(id);
    const actual = await leerJson<Asignatura>(path.join(dir, 'asignatura.json'));
    const campos = ['nombre', 'nivel', 'destinatarios', 'idioma', 'estilo', 'color', 'etapa', 'curso', 'modalidad', 'familia', 'titulo', 'comunidad'] as const;
    const nuevo: Asignatura = { ...actual, id, actualizado: ahora() };
    for (const c of campos) if (typeof datos[c] === 'string') nuevo[c] = datos[c]!;
    if (datos.permisos && typeof datos.permisos === 'object') nuevo.permisos = limpiarPermisos(datos.permisos);
    await escribirJson(path.join(dir, 'asignatura.json'), nuevo);
    if (typeof datos.contexto === 'string') {
      await writeFileAtomic(path.join(dir, 'contexto.md'), datos.contexto);
    }
    return this.obtenerAsignatura(id);
    });
  }

  /** No borra: mueve a la papelera dentro de la carpeta de datos. */
  async eliminarAsignatura(id: string) {
    await this.aPapelera(this.dirAsignatura(id), id);
  }

  private async aPapelera(origen: string, nombre: string) {
    const papelera = path.join(this.raiz, '.papelera');
    await fs.mkdir(papelera, { recursive: true });
    const marca = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.rename(origen, path.join(papelera, `${marca}-${nombre}`));
  }

  // ---------- Documentos ----------

  async listarDocumentos(asig: string): Promise<Documento[]> {
    const dir = path.join(this.dirAsignatura(asig), 'documentos');
    if (!existsSync(dir)) return [];
    const res: Documento[] = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const archivo = path.join(dir, e.name, 'documento.json');
      if (!e.isDirectory() || !existsSync(archivo)) continue;
      res.push({ ...(await leerJson<Documento>(archivo)), id: e.name, asignatura: asig });
    }
    return res.sort((a, b) => a.creado.localeCompare(b.creado));
  }

  async obtenerDocumento(asig: string, id: string): Promise<Documento> {
    const archivo = path.join(this.dirDocumento(asig, id), 'documento.json');
    if (!existsSync(archivo)) throw new ErrorUsuario('El documento no existe', 404);
    return { ...(await leerJson<Documento>(archivo)), id, asignatura: asig };
  }

  async crearDocumento(asig: string, datos: Partial<Documento>): Promise<Documento> {
    await this.obtenerAsignatura(asig);
    const titulo = typeof datos.titulo === 'string' ? datos.titulo.trim() : '';
    if (!titulo) throw new ErrorUsuario('El documento necesita un título');
    const base = path.join(this.dirAsignatura(asig), 'documentos');
    await fs.mkdir(base, { recursive: true });
    const id = await reserveDirectory(base, slug(titulo));
    const dir = path.join(base, id);
    for (const sub of ['secciones', 'fuentes', 'recursos', 'exportados']) {
      await fs.mkdir(path.join(dir, sub), { recursive: true });
    }
    const doc: Documento = {
      id,
      asignatura: asig,
      titulo,
      objetivo: datos.objetivo ?? '',
      destinatarios: datos.destinatarios ?? '',
      extension: datos.extension ?? '',
      ...(datos.permisos ? { permisos: limpiarPermisos(datos.permisos) } : {}),
      ...(datos.importado ? { importado: datos.importado } : {}),
      creado: ahora(),
      actualizado: ahora(),
    };
    await escribirJson(path.join(dir, 'documento.json'), doc);
    return doc;
  }

  async actualizarDocumento(asig: string, id: string, datos: Partial<Documento>): Promise<Documento> {
    return withStorageLock(path.join(this.dirDocumento(asig, id), 'documento.json'), async () => {
    const actual = await this.obtenerDocumento(asig, id);
    const campos = ['titulo', 'objetivo', 'destinatarios', 'extension'] as const;
    const nuevo: Documento = { ...actual, actualizado: ahora() };
    for (const c of campos) if (typeof datos[c] === 'string') nuevo[c] = datos[c]!;
    if (datos.permisos && typeof datos.permisos === 'object') nuevo.permisos = limpiarPermisos(datos.permisos);
    // Tope de tokens: un número positivo; 0 o null lo quita
    if (typeof datos.presupuesto === 'number' && datos.presupuesto > 0) nuevo.presupuesto = Math.round(datos.presupuesto);
    else if ('presupuesto' in datos) delete nuevo.presupuesto;
    await escribirJson(path.join(this.dirDocumento(asig, id), 'documento.json'), nuevo);
    return nuevo;
    });
  }

  async eliminarDocumento(asig: string, id: string) {
    await this.aPapelera(this.dirDocumento(asig, id), `${asig}--${id}`);
  }

  // ---------- Secciones ----------

  private dirSecciones(asig: string, doc: string) {
    return path.join(this.dirDocumento(asig, doc), 'secciones');
  }

  async listarSecciones(asig: string, doc: string): Promise<Seccion[]> {
    return withStorageLock(this.dirSecciones(asig, doc), async () => {
      await fs.mkdir(this.dirSecciones(asig, doc), { recursive: true });
      await recoverSectionOrder(this.dirSecciones(asig, doc));
      return this.listSectionsUnlocked(asig, doc);
    });
  }

  private async listSectionsUnlocked(asig: string, doc: string): Promise<Seccion[]> {
    const dir = this.dirSecciones(asig, doc);
    await fs.mkdir(dir, { recursive: true });
    const archivos = (await fs.readdir(dir)).filter((f) => !f.startsWith('.') && f.endsWith('.md')).sort();
    const summaries = new Array<Seccion>(archivos.length);
    let next = 0;
    // Bound disk concurrency and keep the original sorted order.
    await Promise.all(Array.from({ length: Math.min(8, archivos.length) }, async () => {
      while (next < archivos.length) {
        const index = next++;
        summaries[index] = await this.sectionSummary(path.join(dir, archivos[index]), archivos[index]);
      }
    }));
    return summaries;
  }

  private async sectionSummary(filename: string, name: string): Promise<Seccion> {
    let stamp = '';
    try {
      const stats = await fs.stat(filename);
      stamp = `${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}:${stats.ino}`;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const cached = this.sectionSummaries.get(filename);
    if (stamp && cached?.stamp === stamp) return { ...cached.summary };
    const text = await leerTexto(filename);
    const heading = text.match(/^#{1,3}\s+(.+)$/m);
    const summary = { archivo: name, revision: stamp, titulo: heading ? heading[1].trim() : name.replace(/^\d+-/, '').replace(/\.md$/, '').replace(/-/g, ' '), palabras: text.split(/\s+/).filter(Boolean).length };
    this.sectionSummaries.delete(filename);
    if (stamp) this.sectionSummaries.set(filename, { stamp, summary });
    if (this.sectionSummaries.size > 1024) this.sectionSummaries.delete(this.sectionSummaries.keys().next().value!);
    return { ...summary };
  }

  async leerSeccion(asig: string, doc: string, archivo: string): Promise<string> {
    return withStorageLock(this.dirSecciones(asig, doc), async () => {
      nombreSeguro(archivo);
      await recoverSectionOrder(this.dirSecciones(asig, doc));
      return fs.readFile(path.join(this.dirSecciones(asig, doc), archivo), 'utf8');
    });
  }

  async guardarSeccion(asig: string, doc: string, archivo: string, contenido: string) {
    return withStorageLock(this.dirSecciones(asig, doc), async () => {
    await recoverSectionOrder(this.dirSecciones(asig, doc));
    const filename = path.join(this.dirSecciones(asig, doc), nombreSeguro(archivo));
    await writeFileAtomic(filename, contenido);
    this.sectionSummaries.delete(filename);
    });
  }

  async crearSeccion(asig: string, doc: string, titulo: string): Promise<Seccion> {
    return withStorageLock(this.dirSecciones(asig, doc), async () => {
    await recoverSectionOrder(this.dirSecciones(asig, doc));
    const t = titulo.trim() || 'Nueva sección';
    const existentes = await this.listSectionsUnlocked(asig, doc);
    const num = String(Math.max(0, ...existentes.map(section => Number(section.archivo.match(/^\d+/)?.[0]) || 0)) + 1).padStart(2, '0');
    const archivo = `${num}-${slug(t)}.md`;
    await writeFileAtomic(path.join(this.dirSecciones(asig, doc), archivo), `# ${t}\n\n`);
    return { archivo, titulo: t, palabras: 0 };
    });
  }

  async eliminarSeccion(asig: string, doc: string, archivo: string) {
    return withStorageLock(this.dirSecciones(asig, doc), async () => {
    await recoverSectionOrder(this.dirSecciones(asig, doc));
    const dir = this.dirSecciones(asig, doc);
    await fs.rm(path.join(dir, nombreSeguro(archivo)));
    await commitSectionOrder(dir, (await this.listSectionsUnlocked(asig, doc)).map((s) => s.archivo));
    });
  }

  /** Renombra las secciones con prefijo numérico según el orden indicado. */
  async renumerar(asig: string, doc: string, orden: string[]): Promise<Seccion[]> {
    return withStorageLock(this.dirSecciones(asig, doc), async () => {
    const dir = this.dirSecciones(asig, doc);
    await recoverSectionOrder(dir);
    const actuales = new Set((await fs.readdir(dir)).filter((f) => !f.startsWith('.') && f.endsWith('.md')));
    if (new Set(orden).size !== orden.length || orden.length !== actuales.size || orden.some((a) => !actuales.has(nombreSeguro(a)))) {
      throw new ErrorUsuario('El orden no coincide con las secciones existentes');
    }
    await commitSectionOrder(dir, orden);
    return this.listSectionsUnlocked(asig, doc);
    });
  }

  // ---------- Fuentes (material aportado) ----------

  dirFuentes(asig: string, doc?: string) {
    return doc ? path.join(this.dirDocumento(asig, doc), 'fuentes') : path.join(this.dirAsignatura(asig), 'fuentes');
  }

  async listarFuentes(asig: string, doc?: string): Promise<Fuente[]> {
    const dir = this.dirFuentes(asig, doc);
    await fs.mkdir(dir, { recursive: true });
    const res: Fuente[] = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const st = await fs.stat(path.join(dir, e.name));
      res.push({ nombre: e.name, tamano: st.size, modificado: st.mtime.toISOString() });
    }
    return res.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  async rutaNuevaFuente(asig: string, nombre: string, doc?: string): Promise<string> {
    const dir = this.dirFuentes(asig, doc);
    await fs.mkdir(dir, { recursive: true });
    const limpio = path.basename(nombre).replace(/[\\/:*?"<>|]/g, '_');
    const ext = path.extname(limpio);
    let final = limpio;
    for (let i = 2; existsSync(path.join(dir, final)); i++) final = `${path.basename(limpio, ext)} (${i})${ext}`;
    return path.join(dir, final);
  }

  async eliminarFuente(asig: string, nombre: string, doc?: string) {
    const directory = this.dirFuentes(asig, doc);
    await withStorageLock(directory, () => fs.rm(path.join(directory, nombreSeguro(nombre))));
  }

  async renameSource(subjectId: string, filename: string, newName: string, expectedModified: string, documentId?: string): Promise<Fuente> {
    const directory = this.dirFuentes(subjectId, documentId);
    nombreSeguro(filename);
    nombreSeguro(newName);
    if (newName !== newName.trim() || /[. ]$/.test(newName) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(newName)) throw new ErrorUsuario('El nombre del archivo no es válido.');
    if (path.extname(filename).toLowerCase() !== path.extname(newName).toLowerCase()) throw new ErrorUsuario('Conserva la extensión del archivo.');
    return withStorageLock(directory, async () => {
      const original = path.join(directory, filename), target = path.join(directory, newName);
      const stat = await fs.lstat(original).catch(error => {
        if (error.code === 'ENOENT') throw new ErrorUsuario('La fuente ya no existe. Recarga la lista.', 404);
        throw error;
      });
      if (!stat.isFile()) throw new ErrorUsuario('La fuente no es un archivo válido.');
      if (stat.mtime.toISOString() !== expectedModified) throw new ErrorUsuario('La fuente ha cambiado. Recarga sus datos antes de editarla.', 409);
      if (filename !== newName) {
        try { await fs.copyFile(original, target, constants.COPYFILE_EXCL); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ErrorUsuario('Ya existe una fuente con ese nombre.', 409);
          throw error;
        }
        // Keep the original if copying fails; never replace another source.
        await fs.unlink(original);
      }
      const updated = await fs.stat(target);
      return { nombre: newName, tamano: updated.size, modificado: updated.mtime.toISOString() };
    });
  }

  // ---------- Archivos auxiliares del documento ----------

  /** Archivos de la raíz del documento que se pueden leer y editar desde la interfaz. */
  static ARCHIVOS_EDITABLES = ['investigacion.md'];

  async leerJsonDoc<T>(asig: string, doc: string, nombre: string, defecto: T): Promise<T> {
    try {
      return await leerJson<T>(path.join(this.dirDocumento(asig, doc), nombreSeguro(nombre)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defecto;
      if (error instanceof SyntaxError) throw new ErrorUsuario(`El archivo ${nombre} está dañado; recupéralo desde una copia de seguridad`, 409);
      throw error;
    }
  }

  /** Escritura atómica (archivo temporal + renombrado) para no dejar JSON a medias. */
  async escribirJsonDoc(asig: string, doc: string, nombre: string, datos: unknown) {
    const destino = path.join(this.dirDocumento(asig, doc), nombreSeguro(nombre));
    await escribirJson(destino, datos);
  }

  async leerArchivoDoc(asig: string, doc: string, nombre: string): Promise<string> {
    return leerTexto(path.join(this.dirDocumento(asig, doc), nombreSeguro(nombre)));
  }

  async guardarArchivoDoc(asig: string, doc: string, nombre: string, contenido: string) {
    if (!Almacen.ARCHIVOS_EDITABLES.includes(nombre)) throw new ErrorUsuario('Archivo no editable');
    await writeFileAtomic(path.join(this.dirDocumento(asig, doc), nombre), contenido);
  }

  async infoArchivoDoc(asig: string, doc: string, nombre: string) {
    try {
      const st = await fs.stat(path.join(this.dirDocumento(asig, doc), nombreSeguro(nombre)));
      return { modificado: st.mtime.toISOString(), tamano: st.size };
    } catch {
      return undefined;
    }
  }

  /** Texto de todas las secciones, en orden. */
  async textoCompleto(asig: string, doc: string): Promise<{ archivo: string; texto: string }[]> {
    const secciones = await this.listarSecciones(asig, doc);
    return Promise.all(secciones.map(async (s) => ({ archivo: s.archivo, texto: await this.leerSeccion(asig, doc, s.archivo) })));
  }

  async listarRecursos(asig: string, doc: string): Promise<Recurso[]> {
    const dir = path.join(this.dirDocumento(asig, doc), 'recursos');
    await fs.mkdir(dir, { recursive: true });
    const textos = (await this.textoCompleto(asig, doc)).map((t) => t.texto).join('\n');
    const res: Recurso[] = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name.startsWith('.')) continue;
      const st = await fs.stat(path.join(dir, e.name));
      res.push({ nombre: e.name, tamano: st.size, modificado: st.mtime.toISOString(), usado: textos.includes(`recursos/${e.name}`) });
    }
    return res.sort((a, b) => b.modificado.localeCompare(a.modificado));
  }

  async eliminarRecurso(asig: string, doc: string, nombre: string) {
    await fs.rm(path.join(this.dirDocumento(asig, doc), 'recursos', nombreSeguro(nombre)));
  }

  async listarExportados(asig: string, doc: string): Promise<Exportado[]> {
    const dir = path.join(this.dirDocumento(asig, doc), 'exportados');
    await fs.mkdir(dir, { recursive: true });
    const res: Exportado[] = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      const st = await fs.stat(path.join(dir, e.name));
      res.push({ nombre: e.name, formato: path.extname(e.name).slice(1), tamano: st.size, modificado: st.mtime.toISOString() });
    }
    return res.sort((a, b) => b.modificado.localeCompare(a.modificado));
  }

  rutaExportado(asig: string, doc: string, nombre: string) {
    return path.join(this.dirDocumento(asig, doc), 'exportados', nombreSeguro(nombre));
  }

  // ---------- Exámenes de la asignatura (examenes/<id>/: examen.json, fuentes/ y exportados/) ----------

  dirExamenes(asig: string) {
    return path.join(this.dirAsignatura(asig), 'examenes');
  }

  dirExamen(asig: string, id: string) {
    return path.join(this.dirExamenes(asig), nombreSeguro(id));
  }

  async listarExamenes(asig: string): Promise<Examen[]> {
    const dir = this.dirExamenes(asig);
    if (!existsSync(dir)) return [];
    const res: Examen[] = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      try {
        res.push({ ...(await leerJson<Examen>(path.join(dir, e.name, 'examen.json'))), id: e.name });
      } catch {}
    }
    return res.sort((a, b) => b.actualizado.localeCompare(a.actualizado));
  }

  async leerExamen(asig: string, id: string): Promise<Examen> {
    try {
      return { ...(await leerJson<Examen>(path.join(this.dirExamen(asig, id), 'examen.json'))), id };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ErrorUsuario('Examen no encontrado', 404);
      throw error;
    }
  }

  async guardarExamen(asig: string, examen: Examen) {
    await fs.mkdir(this.dirExamen(asig, examen.id), { recursive: true });
    await escribirJson(path.join(this.dirExamen(asig, examen.id), 'examen.json'), examen);
  }

  /** Carpeta nueva (con un nombre libre) para un examen. */
  async reservarExamen(asig: string, titulo: string): Promise<string> {
    return reserveDirectory(this.dirExamenes(asig), slug(titulo));
  }

  async eliminarExamen(asig: string, id: string) {
    await this.aPapelera(this.dirExamen(asig, id), `${asig}--examen--${id}`);
  }

  // ---------- Glosario y plantillas de la asignatura ----------

  async leerGlosario(asig: string) {
    return leerTexto(path.join(this.dirAsignatura(asig), 'glosario.md'));
  }

  async guardarGlosario(asig: string, texto: string) {
    await fs.writeFile(path.join(this.dirAsignatura(asig), 'glosario.md'), texto, 'utf8');
  }

  curriculum(asig: string) {
    return new CurriculumStore(this.dirAsignatura(asig));
  }

  /** Material-generation agents receive only the activated structured curriculum. */
  async curriculumPrompt(asig: string) {
    return this.curriculum(asig).promptText();
  }

  /** Plantilla de Word/LibreOffice propia de la asignatura (plantilla.docx / plantilla.odt). */
  rutaPlantilla(asig: string, formato: 'docx' | 'odt') {
    return path.join(this.dirAsignatura(asig), `plantilla.${formato}`);
  }

  async plantillas(asig: string) {
    return {
      docx: existsSync(this.rutaPlantilla(asig, 'docx')),
      odt: existsSync(this.rutaPlantilla(asig, 'odt')),
    };
  }
}

/** Solo los permisos conocidos y con valor sí/no (lo que falta se hereda o está permitido). */
function limpiarPermisos(p: Permisos): Permisos {
  const r: Permisos = {};
  for (const { id } of PERMISOS) if (typeof p[id] === 'boolean') r[id] = p[id];
  return r;
}
