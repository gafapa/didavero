import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Almacen } from '../server/store';
import { Historial } from '../server/historial';
import { crearServidor } from '../server/index';
import { hasTrustedUpdatePublisher } from '../electron/updatePolicy';
import { acquireInstanceLock } from '../server/instanceLock';

test('invalid section PUT bodies cannot erase content, while explicit empty strings remain valid edits', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-review-http-'));
  const server = await crearServidor({ archivoAjustes: path.join(directory, 'settings.json'), carpetaDatosPorDefecto: path.join(directory, 'data'), codexUsageReader: async () => ({ windows: [], updatedAt: 0, unavailable: true }) });
  context.after(async () => { await server.cerrar(); await fs.rm(directory, { recursive: true, force: true }); });
  const storage = new Almacen(path.join(directory, 'data'));
  const subject = await storage.crearAsignatura({ nombre: 'Fictional subject' });
  const document = await storage.crearDocumento(subject.id, { titulo: 'Fictional notes' });
  const section = await storage.crearSeccion(subject.id, document.id, 'Preserved section');
  const original = await storage.leerSeccion(subject.id, document.id, section.archivo);
  const route = `${server.url}/api/asignaturas/${subject.id}/documentos/${document.id}/secciones/${section.archivo}`;
  for (const body of [{}, null, [], { contenido: null }, { contenido: false }, { contenido: 123 }, { contenido: {} }]) {
    const response = await fetch(route, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
    assert.equal(await storage.leerSeccion(subject.id, document.id, section.archivo), original);
  }
  const history = new Historial(() => storage.raiz), dir = storage.dirDocumento(subject.id, document.id);
  await history.guardar(dir, section.archivo, 'Legitimate historical content.');
  const version = (await history.listar(dir, section.archivo))[0];
  assert.equal((await fetch(route + '/historial')).status, 200);
  for (const malicious of ['../escape.md', '..\\escape.md', '../../asignatura.json', '.hidden.md', 'bad:stream.md']) {
    for (const suffix of ['/historial', '/historial/' + version.id, '/historial/' + version.id + '/restaurar']) {
      const response = await fetch(route.replace(section.archivo, encodeURIComponent(malicious)) + suffix, { method: suffix.endsWith('/restaurar') ? 'POST' : 'GET' });
      assert.ok([400, 404].includes(response.status));
      assert.equal(await storage.leerSeccion(subject.id, document.id, section.archivo), original);
    }
    await assert.rejects(history.leer(dir, malicious, version.id));
  }
  assert.equal((await fetch(route, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"contenido":""}' })).status, 200);
  assert.equal(await storage.leerSeccion(subject.id, document.id, section.archivo), '');
  await fs.writeFile(path.join(dir, 'documento.json'), '{broken');
  const failure = await fetch(`${server.url}/api/asignaturas/${subject.id}/documentos/${document.id}`);
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), { error: 'Error interno del servidor' });
});

test('metadata updates serialize across store instances without losing unrelated fields', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-review-storage-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = new Almacen(root), second = new Almacen(root); await first.iniciar();
  const subject = await first.crearAsignatura({ nombre: 'Fictional subject' });
  const document = await first.crearDocumento(subject.id, { titulo: 'Fictional notes' });
  await Promise.all([first.actualizarAsignatura(subject.id, { nombre: 'Updated name' }), second.actualizarAsignatura(subject.id, { estilo: 'Updated style' })]);
  const updatedSubject = await first.obtenerAsignatura(subject.id);
  assert.equal(updatedSubject.nombre, 'Updated name'); assert.equal(updatedSubject.estilo, 'Updated style');
  await Promise.all([first.actualizarDocumento(subject.id, document.id, { titulo: 'Updated title' }), second.actualizarDocumento(subject.id, document.id, { objetivo: 'Updated objective' })]);
  const updatedDocument = await first.obtenerDocumento(subject.id, document.id);
  assert.equal(updatedDocument.titulo, 'Updated title'); assert.equal(updatedDocument.objetivo, 'Updated objective');
});

test('binary argument parsing accepts the npm separator before a Windows target', async () => {
  try {
    const result = await promisify(execFile)(process.execPath, ['scripts/fetch-bin.mjs', '--', 'win', '--check']);
    assert.match(result.stdout, /SHA-256 verified/);
  } catch (error) {
    const failure = error as { stderr: string };
    assert.match(failure.stderr, /cached .* binary has no valid integrity manifest/);
    assert.doesNotMatch(failure.stderr, /Unsupported binary platform/);
  }
});

test('unsigned, disabled-verification and unsupported updater configurations fail closed', () => {
  for (const config of [undefined, {}, { publisherName: '' }, { publisherName: [] }, { publisherName: ['Trusted', null] }, { publisherName: 'Trusted', verifyUpdateCodeSignature: false }]) assert.equal(hasTrustedUpdatePublisher('win32', config), false);
  assert.equal(hasTrustedUpdatePublisher('win32', { publisherName: ['Trusted previous publisher', 'Trusted new publisher'] }), true);
  assert.equal(hasTrustedUpdatePublisher('linux', { publisherName: 'Trusted' }), false);
  assert.equal(hasTrustedUpdatePublisher('darwin', { publisherName: 'Trusted' }), false);
});

test('instance leases ignore stale PID records, reject simultaneous owners and release for restart', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-instance-lock-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'servidor.pid'), String(process.pid));
  const release = await acquireInstanceLock(directory); context.after(release);
  await assert.rejects(acquireInstanceLock(directory), /ya está abierta/);
  await release();
  const restarted = await acquireInstanceLock(directory); await restarted();
});

test('concurrent section creation and interrupted reorders preserve every text', async context => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-section-recovery-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const storage = new Almacen(root); await storage.iniciar();
  const subject = await storage.crearAsignatura({ nombre: 'Fictional subject' });
  const document = await storage.crearDocumento(subject.id, { titulo: 'Concurrent notes' });
  const sections = await Promise.all(Array.from({ length: 12 }, () => storage.crearSeccion(subject.id, document.id, 'Same heading')));
  assert.equal(new Set(sections.map(section => section.archivo)).size, 12);
  assert.equal((await storage.listarSecciones(subject.id, document.id)).length, 12);
  for (const phase of ['staging', 'publishing'] as const) {
    const notes = await storage.crearDocumento(subject.id, { titulo: phase });
    const a = await storage.crearSeccion(subject.id, notes.id, 'Alpha'), b = await storage.crearSeccion(subject.id, notes.id, 'Beta');
    const dir = path.join(storage.dirDocumento(subject.id, notes.id), 'secciones');
    const entries = [{ original: b.archivo, temporary: '.order-test-0', target: '01-beta.md' }, { original: a.archivo, temporary: '.order-test-1', target: '02-alpha.md' }];
    await fs.rename(path.join(dir, b.archivo), path.join(dir, entries[0].temporary));
    if (phase === 'publishing') {
      await fs.rename(path.join(dir, a.archivo), path.join(dir, entries[1].temporary));
      await fs.rename(path.join(dir, entries[0].temporary), path.join(dir, entries[0].target));
    }
    await fs.writeFile(path.join(dir, '.section-order.json'), JSON.stringify({ phase, entries }));
    const restarted = new Almacen(root), restored = await restarted.listarSecciones(subject.id, notes.id);
    assert.deepEqual(restored.map(section => section.archivo), ['01-beta.md', '02-alpha.md']);
    assert.match(await restarted.leerSeccion(subject.id, notes.id, '01-beta.md'), /Beta/);
    assert.match(await restarted.leerSeccion(subject.id, notes.id, '02-alpha.md'), /Alpha/);
    await assert.rejects(restarted.renumerar(subject.id, notes.id, ['01-beta.md', '01-beta.md']), /orden/);
    await fs.writeFile(path.join(dir, '.tmp-0-01-beta.md'), '# Surviving legacy text');
    await fs.writeFile(path.join(dir, '.unrelated.md'), '# Hidden unrelated text');
    const legacy = await restarted.listarSecciones(subject.id, notes.id);
    assert.equal(legacy.length, 3); assert.ok(legacy.every(section => !section.archivo.startsWith('.')));
    assert.ok((await Promise.all(legacy.map(section => restarted.leerSeccion(subject.id, notes.id, section.archivo)))).includes('# Surviving legacy text'));
    assert.equal((await restarted.renumerar(subject.id, notes.id, legacy.map(section => section.archivo).reverse())).length, 3);
  }
});
