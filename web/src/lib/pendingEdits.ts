import { SerialTasks } from './serialTasks';

const editors = new Map<string, () => Promise<boolean>>();
const queues = new Map<string, SerialTasks>();

/** Reopening an editor shares its outstanding writes with the previous mount. */
export function documentSaveTasks(scope: string) {
  let queue = queues.get(scope);
  if (!queue) { queue = new SerialTasks(); queues.set(scope, queue); }
  return queue;
}

/** Flush debounced edits on departure and retain failed saves for an export retry. */
export function registerPendingEdits(scope: string, flush: () => Promise<boolean>) {
  editors.set(scope, flush);
  return () => {
    void flush().then(saved => {
      if (saved && editors.get(scope) === flush) editors.delete(scope);
    }).catch(() => {});
  };
}

export async function flushPendingEdits(scope: string) {
  let flush: (() => Promise<boolean>) | undefined;
  do {
    flush = editors.get(scope);
    if (flush && !await flush()) throw new Error('No se han guardado los últimos cambios. Vuelve al editor y reintenta el guardado antes de exportar.');
  } while (editors.get(scope) && flush !== editors.get(scope));
}
