import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFileAtomic } from './atomicFiles';

type Entry = { original: string; temporary: string; target: string };
type Journal = { phase: 'staging' | 'publishing'; entries: Entry[] };
const journalName = '.section-order.json';
const safe = (name: unknown): name is string => typeof name === 'string' && !!name && name !== '.' && name !== '..' && !/[\\/:*?"<>|]/.test(name);
async function exists(filename: string) { try { await fs.stat(filename); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }

/** Complete a durable rename journal before exposing the section directory again. Call under its storage lock. */
export async function recoverSectionOrder(directory: string) {
  const filename = path.join(directory, journalName);
  let journal: Journal | undefined;
  try { journal = JSON.parse(await fs.readFile(filename, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (journal) {
    if (!['staging', 'publishing'].includes(journal.phase) || !Array.isArray(journal.entries) || journal.entries.some(entry => !safe(entry.original) || entry.original.startsWith('.') || !safe(entry.target) || entry.target.startsWith('.') || !safe(entry.temporary) || !entry.temporary.startsWith('.order-'))
      || ['original', 'temporary', 'target'].some(key => new Set(journal!.entries.map(entry => entry[key as keyof Entry].toLowerCase())).size !== journal!.entries.length)) throw new Error('Invalid section order recovery journal; original files were retained.');
    if (journal.phase === 'staging') {
      for (const entry of journal.entries) {
        const original = path.join(directory, entry.original), temporary = path.join(directory, entry.temporary);
        if (await exists(temporary)) { if (await exists(original)) throw new Error('Conflicting section recovery files; both were retained.'); }
        else await fs.rename(original, temporary);
      }
      journal.phase = 'publishing'; await writeFileAtomic(filename, JSON.stringify(journal));
    }
    for (const entry of journal.entries) {
      const temporary = path.join(directory, entry.temporary), target = path.join(directory, entry.target);
      if (await exists(temporary)) {
        if (await exists(target)) throw new Error('Conflicting section recovery destination; original files were retained.');
        await fs.rename(temporary, target);
      } else if (!await exists(target)) throw new Error('Missing section recovery file; the journal was retained.');
    }
    await fs.unlink(filename);
  }
  // Older versions left the only surviving text in these hidden Markdown files. Never discard them.
  for (const name of await fs.readdir(directory)) {
    const match = name.match(/^\.tmp-\d+-(\d+-.+\.md)$/);
    if (!match) continue;
    let target = match[1], suffix = 1;
    while (await exists(path.join(directory, target))) target = `recovered-${suffix++}-${match[1]}`;
    await fs.copyFile(path.join(directory, name), path.join(directory, target), 1);
    await fs.unlink(path.join(directory, name));
  }
}

export async function commitSectionOrder(directory: string, order: string[]) {
  const transaction = randomUUID();
  const journal: Journal = { phase: 'staging', entries: order.map((original, index) => ({ original, temporary: `.order-${transaction}-${index}`, target: `${String(index + 1).padStart(2, '0')}-${original.replace(/^\d+-/, '')}` })) };
  await writeFileAtomic(path.join(directory, journalName), JSON.stringify(journal));
  await recoverSectionOrder(directory);
}
