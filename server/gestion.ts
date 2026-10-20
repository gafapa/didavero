import { ProgrammeProjects } from './programmeProjects';
import { withProgrammeDirectory } from './programmeLifecycle';
// Gestión de asignaturas y documentos: papelera (con restaurar), duplicar, copias de seguridad en .zip
// y reunir en una carpeta lo exportado de varios documentos.
import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import type { Asignatura, Documento, ElementoPapelera } from '../shared/tipos';
import { Almacen, ErrorUsuario, nombreLibre, reserveDirectory, slug } from './store';
import { extractSafeArchive, loadSafeArchive, readArchiveText } from './safeArchives';
import { writeFileAtomic } from './atomicFiles';

// ---------------------------------------------------------------------------
// Papelera: .papelera/<fecha>-<asignatura>, .papelera/<fecha>-<asignatura>--<documento> o
// .papelera/<fecha>-<asignatura>--examen--<examen>

const MARCA = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-(.+)$/;

const dirPapelera = (almacen: Almacen) => path.join(almacen.raiz, '.papelera');

function rutaEnPapelera(almacen: Almacen, id: string) {
  if (!id || id.includes('/') || id.includes('\\') || id.startsWith('.')) throw new ErrorUsuario('Elemento no válido');
  const ruta = path.join(dirPapelera(almacen), id);
  if (!existsSync(ruta)) throw new ErrorUsuario('Ya no está en la papelera', 404);
  return ruta;
}

async function leerJson<T>(archivo: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(archivo, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export async function listarPapelera(almacen: Almacen): Promise<ElementoPapelera[]> {
  const dir = dirPapelera(almacen);
  if (!existsSync(dir)) return [];
  const res: ElementoPapelera[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const m = e.isDirectory() && e.name.match(MARCA);
    if (!m) continue;
    const eliminado = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
    const ruta = path.join(dir, e.name);
    const asig = await leerJson<Asignatura>(path.join(ruta, 'asignatura.json'));
    if (asig) {
      res.push({ id: e.name, tipo: 'asignatura', titulo: asig.nombre, asignatura: m[6], eliminado });
      continue;
    }
    const asignatura = m[6].split('--')[0];
    const nombreAsignatura = async () => (await leerJson<Asignatura>(path.join(almacen.raiz, asignatura, 'asignatura.json')))?.nombre;
    if (m[6].split('--')[1] === 'programacion') {
      const programme = await leerJson<{ id: string; title: string; initialPurpose?: string }>(path.join(ruta, 'project.json'));
      if (programme && typeof programme.title === 'string' && programme.id === m[6].split('--').slice(2).join('--')) {
        const state = await leerJson<{ draft?: { title?: string } }>(path.join(ruta, programme.initialPurpose === 'opposition' ? 'opposition.json' : 'state.json'));
        res.push({ id: e.name, tipo: 'programacion', titulo: state?.draft?.title || programme.title, asignatura, nombreAsignatura: await nombreAsignatura(), eliminado });
      }
      continue;
    }
    const examen = await leerJson<{ titulo: string }>(path.join(ruta, 'examen.json'));
    if (examen) {
      res.push({ id: e.name, tipo: 'examen', titulo: examen.titulo, asignatura, nombreAsignatura: await nombreAsignatura(), eliminado });
      continue;
    }
    const doc = await leerJson<Documento>(path.join(ruta, 'documento.json'));
    if (!doc) continue;
    res.push({ id: e.name, tipo: 'documento', titulo: doc.titulo, asignatura, nombreAsignatura: await nombreAsignatura(), eliminado });
  }
  return res.sort((a, b) => b.eliminado.localeCompare(a.eliminado));
}

/** Devuelve un elemento de la papelera a su sitio (con otro nombre de carpeta si ya está ocupado). */
export async function restaurarDePapelera(almacen: Almacen, id: string): Promise<{ asignatura: string; documento?: string }> {
  const origen = rutaEnPapelera(almacen, id);
  const elemento = (await listarPapelera(almacen)).find((e) => e.id === id);
  if (!elemento) throw new ErrorUsuario('No se reconoce este elemento de la papelera');
  if (elemento.tipo === 'asignatura') {
    const nuevo = await nombreLibre(almacen.raiz, elemento.asignatura);
    await fs.rename(origen, path.join(almacen.raiz, nuevo));
    return { asignatura: nuevo };
  }
  if (!existsSync(path.join(almacen.raiz, elemento.asignatura, 'asignatura.json'))) {
    throw new ErrorUsuario(
      elemento.tipo === 'examen'
        ? 'Su asignatura ya no existe: restaura antes la asignatura.'
        : 'Su asignatura ya no existe: restaura antes la asignatura (o duplica el documento en otra cuando esté restaurado).',
    );
  }
  if (elemento.tipo === 'programacion') {
    const project = await leerJson<{ id: string }>(path.join(origen, 'project.json'));
    if (!project) throw new ErrorUsuario('No se puede leer la programación de la papelera.');
    const projects = new ProgrammeProjects(almacen.dirAsignatura(elemento.asignatura), almacen.curriculum(elemento.asignatura));
    const destination = projects.projectDirectory(project.id);
    await withProgrammeDirectory(destination, async () => {
      if (existsSync(destination)) throw new ErrorUsuario('Ya existe una programación con ese identificador. Se conserva la copia de la papelera.', 409);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.rename(origen, destination);
    }, false);
    return { asignatura: elemento.asignatura };
  }
  if (elemento.tipo === 'examen') {
    const base = almacen.dirExamenes(elemento.asignatura);
    await fs.mkdir(base, { recursive: true });
    const nuevo = await nombreLibre(base, id.match(MARCA)![6].split('--').slice(2).join('--') || slug(elemento.titulo));
    await fs.rename(origen, path.join(base, nuevo));
    return { asignatura: elemento.asignatura };
  }
  const base = path.join(almacen.dirAsignatura(elemento.asignatura), 'documentos');
  await fs.mkdir(base, { recursive: true });
  const nuevo = await nombreLibre(base, id.match(MARCA)![6].split('--').slice(1).join('--') || slug(elemento.titulo));
  await fs.rename(origen, path.join(base, nuevo));
  return { asignatura: elemento.asignatura, documento: nuevo };
}

/** Borra definitivamente un elemento de la papelera, o toda ella. */
export async function borrarDePapelera(almacen: Almacen, id?: string) {
  if (id) await fs.rm(rutaEnPapelera(almacen, id), { recursive: true, force: true });
  else await fs.rm(dirPapelera(almacen), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Duplicar

/** Lo que no se copia al duplicar: trabajo interno de los agentes, historial y lo ya exportado. */
const NO_DUPLICAR = new Set(['.agentes', '.historial', 'exportados', '.indice', '.texto']);

const filtro = (raiz: string, excluir: Set<string>) => (origen: string) =>
  !path
    .relative(raiz, origen)
    .split(path.sep)
    .some((p) => excluir.has(p));

export async function duplicarDocumento(almacen: Almacen, asig: string, doc: string, op: { titulo?: string; destino?: string }): Promise<Documento> {
  const original = await almacen.obtenerDocumento(asig, doc);
  const destino = op.destino || asig;
  await almacen.obtenerAsignatura(destino); // que exista
  const titulo = op.titulo?.trim() || (destino === asig ? `${original.titulo} (copia)` : original.titulo);
  const base = path.join(almacen.dirAsignatura(destino), 'documentos');
  await fs.mkdir(base, { recursive: true });
  const id = await reserveDirectory(base, slug(titulo));
  const origen = almacen.dirDocumento(asig, doc);
  const dir = path.join(base, id);
  await fs.cp(origen, dir, { recursive: true, filter: filtro(origen, NO_DUPLICAR) });
  await fs.mkdir(path.join(dir, 'exportados'), { recursive: true });
  const ahora = new Date().toISOString();
  const nuevo: Documento = { ...original, id, asignatura: destino, titulo, creado: ahora, actualizado: ahora };
  await fs.writeFile(path.join(dir, 'documento.json'), JSON.stringify(nuevo, null, 2) + '\n', 'utf8');
  return nuevo;
}

export async function duplicarAsignatura(almacen: Almacen, asig: string, nombre?: string): Promise<string> {
  const original = await almacen.obtenerAsignatura(asig);
  const nuevoNombre = nombre?.trim() || `${original.nombre} (copia)`;
  const id = await reserveDirectory(almacen.raiz, slug(nuevoNombre));
  const origen = almacen.dirAsignatura(asig);
  const dir = path.join(almacen.raiz, id);
  await fs.cp(origen, dir, { recursive: true, filter: filtro(origen, NO_DUPLICAR) });
  const ahora = new Date().toISOString();
  const datos = (await leerJson<Asignatura>(path.join(dir, 'asignatura.json')))!;
  await fs.writeFile(path.join(dir, 'asignatura.json'), JSON.stringify({ ...datos, id, nombre: nuevoNombre, creado: ahora, actualizado: ahora }, null, 2) + '\n', 'utf8');
  // Los documentos copiados empiezan su vida ahora
  const docs = path.join(dir, 'documentos');
  if (existsSync(docs)) {
    for (const d of await fs.readdir(docs)) {
      const archivo = path.join(docs, d, 'documento.json');
      const doc = await leerJson<Documento>(archivo);
      if (doc) await fs.writeFile(archivo, JSON.stringify({ ...doc, asignatura: id, creado: ahora, actualizado: ahora }, null, 2) + '\n', 'utf8');
    }
  }
  return id;
}

// ---------------------------------------------------------------------------
// Copias de seguridad: un .zip con una carpeta por asignatura y un manifiesto

const MANIFIESTO = 'apuntes-ia.json';
/** Lo que no hace falta guardar: se regenera solo. */
const NO_COPIAR = new Set(['.agentes', '.indice', '.texto']);

async function anadirCarpeta(zip: JSZip, dir: string, prefijo: string) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (NO_COPIAR.has(e.name) || e.name.startsWith('.tmp-')) continue;
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) await anadirCarpeta(zip, ruta, `${prefijo}${e.name}/`);
    else if (e.isFile()) {
      // Los grandes, como flujo (no caben todos en memoria); los pequeños, leídos (un flujo abierto
      // por archivo agotaría los descriptores con miles de imágenes)
      const { size } = await fs.stat(ruta);
      zip.file(`${prefijo}${e.name}`, size > 4 * 1024 * 1024 ? createReadStream(ruta) : await fs.readFile(ruta));
    }
  }
}

/** Copia de seguridad de unas asignaturas (o de todas). Devuelve el zip como flujo de datos. */
export async function crearCopia(almacen: Almacen, asignaturas: string[] | undefined, version: string) {
  const ids = asignaturas?.length ? asignaturas : (await almacen.listarAsignaturas()).map((a) => a.id);
  if (!ids.length) throw new ErrorUsuario('No hay asignaturas que copiar');
  const zip = new JSZip();
  zip.file(MANIFIESTO, JSON.stringify({ app: 'Didavero', version, fecha: new Date().toISOString(), asignaturas: ids }, null, 2));
  for (const id of ids) {
    await almacen.obtenerAsignatura(id); // que exista
    await anadirCarpeta(zip, almacen.dirAsignatura(id), `${id}/`);
  }
  return zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/**
 * Restaura una copia de seguridad: cada asignatura del .zip se añade como nueva (si ya existe una con
 * el mismo nombre de carpeta, la restaurada se guarda aparte y se indica en su nombre).
 */
export async function restaurarCopia(almacen: Almacen, archivo: string): Promise<{ id: string; nombre: string }[]> {
  const zip = await loadSafeArchive(archivo);
  const nombres = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  // Raíces: carpetas de primer nivel con asignatura.json (o el zip entero, si la tiene en la raíz)
  const raices = nombres.filter((n) => /^[^/]+\/asignatura\.json$/.test(n)).map((n) => n.slice(0, n.indexOf('/') + 1));
  if (!raices.length && nombres.includes('asignatura.json')) raices.push('');
  if (!raices.length) throw new ErrorUsuario('El .zip no contiene ninguna asignatura de Didavero');
  // Validate every subject before publishing any of them.
  const plans: { root: string; data: Asignatura; base: string }[] = [];
  for (const root of raices) {
    let data: Asignatura;
    try { data = JSON.parse(await readArchiveText(zip.file(`${root}asignatura.json`)!, 1024 * 1024)); }
    catch { throw new ErrorUsuario('La copia contiene una asignatura con datos dañados'); }
    if (!data || typeof data.nombre !== 'string' || !data.nombre.trim()) throw new ErrorUsuario('La copia contiene una asignatura sin nombre válido');
    for (const filename of nombres.filter(name => name.startsWith(root) && /^documentos\/[^/]+\/documento\.json$/.test(name.slice(root.length)))) {
      let document: Documento;
      try { document = JSON.parse(await readArchiveText(zip.file(filename)!, 1024 * 1024)); }
      catch { throw new ErrorUsuario('La copia contiene un documento con datos dañados'); }
      if (!document || typeof document.titulo !== 'string' || !document.titulo.trim()) throw new ErrorUsuario('La copia contiene un documento sin título válido');
    }
    plans.push({ root, data, base: slug(root.replace(/\/$/, '') || data.nombre) });
  }
  const staging = await fs.mkdtemp(path.join(almacen.raiz, '.restore-'));
  const claimed: string[] = [];
  let committed = false;
  try {
    await extractSafeArchive(zip, staging);
    const result: { id: string; nombre: string }[] = [];
    for (const plan of plans) {
      const source = path.join(staging, plan.root);
      // Subject metadata is published last, after all payload files have been copied.
      await fs.rm(path.join(source, 'asignatura.json'));
      const occupied = existsSync(path.join(almacen.raiz, plan.base));
      const id = await reserveDirectory(almacen.raiz, plan.base);
      const destination = path.join(almacen.raiz, id);
      claimed.push(destination);
      for (const entry of await fs.readdir(source)) {
        if (entry === MANIFIESTO) continue;
        await fs.cp(path.join(source, entry), path.join(destination, entry), { recursive: true, force: false, errorOnExist: true });
      }
      const documentsDirectory = path.join(destination, 'documentos');
      if (existsSync(documentsDirectory)) for (const entry of await fs.readdir(documentsDirectory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const metadata = path.join(documentsDirectory, entry.name, 'documento.json');
        if (!existsSync(metadata)) continue;
        const document = JSON.parse(await fs.readFile(metadata, 'utf8')) as Documento;
        await writeFileAtomic(metadata, JSON.stringify({ ...document, id: entry.name, asignatura: id }, null, 2) + '\n');
      }
      const nombre = occupied ? `${plan.data.nombre} (restaurada)` : plan.data.nombre;
      result.push({ id, nombre });
    }
    for (const [index, subject] of result.entries()) await writeFileAtomic(path.join(almacen.raiz, subject.id, 'asignatura.json'), JSON.stringify({ ...plans[index].data, id: subject.id, nombre: subject.nombre }, null, 2) + '\n');
    committed = true;
    return result;
  } finally {
    if (!committed) for (const destination of claimed) {
      const relative = path.relative(path.resolve(almacen.raiz), path.resolve(destination));
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe restoration rollback path');
      await fs.rm(destination, { recursive: true, force: true });
    }
    await fs.rm(staging, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Exportar varios documentos

/** Copia lo exportado de varios documentos a una carpeta de la asignatura (exportados/<fecha>). */
export async function reunirExportados(almacen: Almacen, asig: string, archivos: { documento: string; nombre: string }[]): Promise<string> {
  const a = await almacen.obtenerAsignatura(asig);
  const fecha = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
  const dir = path.join(almacen.dirAsignatura(asig), 'exportados', `${a.nombre.replace(/[\\/:*?"<>|]/g, '_')} ${fecha}`);
  await fs.mkdir(dir, { recursive: true });
  for (const f of archivos) {
    const origen = almacen.rutaExportado(asig, f.documento, f.nombre);
    if (!existsSync(origen)) continue;
    const ext = path.extname(f.nombre);
    let nombre = f.nombre;
    for (let i = 2; existsSync(path.join(dir, nombre)); i++) nombre = `${path.basename(f.nombre, ext)}-${i}${ext}`;
    await fs.copyFile(origen, path.join(dir, nombre));
  }
  return dir;
}
