import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SerialTasks } from '../web/src/lib/serialTasks';
import { flushPendingEdits, registerPendingEdits } from '../web/src/lib/pendingEdits';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('slow writes cannot overwrite later edits and export waits for every queued snapshot', async () => {
  const queue = new SerialTasks(), gate = deferred();
  let stored = '', exported = '';
  const first = queue.run(async () => { await gate.promise; stored = 'First edit'; });
  const exportRequest = queue.flush().then(() => { exported = stored; });
  const second = queue.run(async () => { stored = 'Latest edit'; });
  assert.equal(queue.pending, 2);
  gate.resolve();
  await Promise.all([first, second, exportRequest]);
  assert.equal(stored, 'Latest edit'); assert.equal(exported, 'Latest edit');
  assert.equal(queue.pending, 0);
});

test('failed writes block export and navigation until an explicit successful retry', async () => {
  const queue = new SerialTasks();
  await assert.rejects(queue.run(async () => { throw new Error('Save failed'); }), /Save failed/);
  await assert.rejects(queue.flush(), /Save failed/);
  assert.equal(queue.pending, 0);
  let saved = false;
  await queue.run(async () => { saved = true; });
  await queue.flush(); assert.equal(saved, true);
});

test('leaving a note editor flushes its debounce and export refuses a failed save', async () => {
  const gate = deferred(), scope = 'fictional-subject/fictional-notes';
  let saved = false, succeed = false;
  const leave = registerPendingEdits(scope, async () => { await gate.promise; saved = succeed; return saved; });
  leave();
  const failedExport = assert.rejects(flushPendingEdits(scope), /No se han guardado/);
  gate.resolve(); await failedExport; assert.equal(saved, false);
  succeed = true; await flushPendingEdits(scope); assert.equal(saved, true);
  leave(); await Promise.resolve();
  await flushPendingEdits(scope);
});
