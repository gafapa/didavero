import path from 'node:path';

const pending = new Map<string, Promise<unknown>>();
/** Serialize an entire read/modify/write operation across store instances in this process. */
export function withStorageLock<T>(resource: string, action: () => Promise<T>): Promise<T> {
  const key = path.resolve(resource);
  const operation = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
  pending.set(key, operation);
  void operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => {});
  return operation;
}
