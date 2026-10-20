import fs from 'node:fs/promises';
import path from 'node:path';
import { CurriculumError } from './curriculumStore';

const operations = new Map<string, Promise<unknown>>();

/** Serialize project writes and moves so delayed requests cannot recreate deleted projects. */
export function withProgrammeDirectory<T>(directory: string, operation: () => Promise<T>, requireExisting = true): Promise<T> {
  const key = path.resolve(directory);
  const next = (operations.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (requireExisting && path.basename(path.dirname(key)) === 'programaciones') {
      try { await fs.access(path.join(key, 'project.json')); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CurriculumError('La programación ya no existe o está en la papelera.', 404);
        throw error;
      }
    }
    return operation();
  });
  operations.set(key, next);
  void next.finally(() => { if (operations.get(key) === next) operations.delete(key); }).catch(() => {});
  return next;
}
