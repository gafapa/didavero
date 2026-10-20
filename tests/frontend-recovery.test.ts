import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeJobEvents, mergeJobSnapshot, reconnectDelay } from '../web/src/lib/jobEvents';
import { loadSectionContents } from '../web/src/lib/sectionContents';
import type { Trabajo } from '../shared/tipos';

test('job snapshot reconciliation retains early frames and bounded deduplicated history', () => {
  const initial = { t: 1, tipo: 'texto' as const, texto: 'Initial text' }, live = { t: 2, tipo: 'texto' as const, texto: 'Live text' };
  const snapshot = { id: 'job', estado: 'ejecutando', eventos: [initial] } as Trabajo;
  const current = { ...snapshot, estado: 'ok' as const, eventos: [initial, live] };
  assert.deepEqual(mergeJobSnapshot([snapshot], { job: current }).job.eventos, [initial, live]);
  assert.equal(mergeJobSnapshot([snapshot], { job: current }).job.estado, 'ok');
  assert.equal(mergeJobSnapshot([{ ...snapshot, estado: 'ok' }], { job: { ...snapshot, eventos: [live] } }).job.estado, 'ok');
  assert.equal(mergeJobEvents(Array.from({ length: 500 }, (_, t) => ({ ...initial, t }))).length, 400);
  assert.ok(reconnectDelay(3, 0.5) > reconnectDelay(0, 0.5));
  assert.equal(reconnectDelay(50, 0.5), 30000);
  const special = mergeJobSnapshot([], Object.fromEntries([['__proto__', { ...snapshot, id: '__proto__' }]]));
  assert.equal(Object.getPrototypeOf(special), null); assert.equal(special.__proto__.id, '__proto__');
});

test('complete notes reload only changed section revisions and remove deleted files', async () => {
  const sections = Array.from({ length: 20 }, (_, index) => ({ archivo: `${index}.md`, revision: 'first', titulo: 'Fixture', palabras: 1 }));
  const reads: string[] = [];
  const read = async (filename: string) => { reads.push(filename); return { contenido: '# ' + filename }; };
  const first = await loadSectionContents(sections, new Map(), read);
  assert.equal(reads.length, 20); reads.length = 0;
  const changed = sections.slice(1).map((section, index) => index === 2 ? { ...section, revision: 'changed' } : section);
  const second = await loadSectionContents(changed, first.cache, read);
  assert.deepEqual(reads, [changed[2].archivo]); assert.equal(second.contents.length, 19); assert.equal(second.cache.has('0.md'), false);
});
