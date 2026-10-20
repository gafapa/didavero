import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crearServidor } from '../server/index';
import { Almacen } from '../server/store';

test('source CRUD preserves file content, scope and search references, rejecting collisions and stale or invalid edits', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-source-crud-'));
  const server = await crearServidor({ archivoAjustes: path.join(directory, 'settings.json'), carpetaDatosPorDefecto: path.join(directory, 'data'), codexUsageReader: async () => ({ windows: [], updatedAt: 0, unavailable: true }) });
  context.after(async () => { await server.cerrar(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 }); });
  const storage = new Almacen(path.join(directory, 'data'));
  const subject = await storage.crearAsignatura({ nombre: 'Fictional source manager' });
  const document = await storage.crearDocumento(subject.id, { titulo: 'Fictional notes' });
  for (const documentId of [undefined, document.id]) {
    const route = `${server.url}/api/asignaturas/${subject.id}${documentId ? `/documentos/${documentId}` : ''}/fuentes`;
    const sourceDirectory = storage.dirFuentes(subject.id, documentId);
    const upload = new FormData();
    upload.append('archivo', new Blob(['# Photosynthesis\nPhotosynthesis FICTIONAL_SOURCE_CONTENT.']), 'original.md');
    assert.equal((await fetch(route, { method: 'POST', body: upload })).status, 200);
    const sources = await (await fetch(route)).json() as { nombre: string; modificado: string }[];
    const source = sources.find(item => item.nombre === 'original.md')!;
    assert.ok(source);
    const update = (name: unknown, expectedModified: unknown = source.modificado, filename = 'original.md') => fetch(`${route}/${filename}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, expectedModified }) });
    for (const name of [null, 4, '', '../escape.md', '.hidden.md', 'CON.md', 'trailing.md.', 'wrong.txt']) assert.equal((await update(name)).status, 400);
    assert.equal((await update('renamed.md', 'stale')).status, 409);
    await fs.writeFile(path.join(sourceDirectory, 'occupied.md'), 'PRESERVE_EXISTING_SOURCE');
    assert.equal((await update('occupied.md')).status, 409);
    assert.equal(await fs.readFile(path.join(sourceDirectory, 'occupied.md'), 'utf8'), 'PRESERVE_EXISTING_SOURCE');
    const results = await Promise.all([update('renamed.md'), update('other.md')]);
    assert.equal(results.filter(result => result.ok).length, 1);
    const renamed = await results.find(result => result.ok)!.json() as { nombre: string; modificado: string };
    assert.equal(await fs.readFile(path.join(sourceDirectory, renamed.nombre), 'utf8'), '# Photosynthesis\nPhotosynthesis FICTIONAL_SOURCE_CONTENT.');
    await assert.rejects(fs.stat(path.join(sourceDirectory, 'original.md')), { code: 'ENOENT' });
    assert.equal((await update(renamed.nombre, renamed.modificado, renamed.nombre)).status, 200);
    const indexRoute = route.replace(/\/fuentes$/, '/fuentes-indice');
    const index = await (await fetch(indexRoute)).json() as { archivo: string }[];
    assert.ok(index.some(item => item.archivo === renamed.nombre));
    assert.equal(index.some(item => item.archivo === 'original.md'), false);
    const malformed = await fetch(`${route}/${renamed.nombre}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(malformed.status, 400);
    assert.equal((await fetch(`${route}/${renamed.nombre}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual((await (await fetch(route)).json() as { nombre: string }[]).map(item => item.nombre), ['occupied.md']);
    assert.equal(await fs.readFile(path.join(sourceDirectory, 'occupied.md'), 'utf8'), 'PRESERVE_EXISTING_SOURCE');
    await fetch(indexRoute);
  }
});
