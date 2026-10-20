import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ProgrammeResearchResult, ProgrammeResearchSource } from '../shared/programmeResearch';
import { isOfficialCurriculumUrl } from '../shared/curriculum';
import { fetchPublicResource, readResponseLimited } from './remoteResources';

const normalize = (text: string) => text.normalize('NFKC').replace(/[\u00ad\u200b]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
/** Literal matching is evidence of a quotation, never evidence that a rule applies to this teaching programme. */
export function sourceContainsExcerpt(source: string, excerpt: string): boolean {
  const text = normalize(source), parts = excerpt.split(/\.{3}|…/).map(normalize).filter(Boolean);
  if (!parts.length || parts.some(part => part.length < 15)) return false;
  let position = 0;
  for (const part of parts) { const found = text.indexOf(part, position); if (found < 0) return false; position = found + part.length; }
  return true;
}
export async function checkProgrammeResearchExcerpts(report: ProgrammeResearchResult, directory: string, fetcher = fetchPublicResource): Promise<Record<string, NonNullable<ProgrammeResearchSource['excerptCheck']>>> {
  const checks: Record<string, NonNullable<ProgrammeResearchSource['excerptCheck']>> = Object.create(null), pending = new Map<string, Promise<string>>();
  const getText = (url: string) => {
    if (!pending.has(url)) pending.set(url, (async () => {
      if (!isOfficialCurriculumUrl(url)) throw new Error('Not an admitted official source.');
      const hash = createHash('sha256').update(url).digest('hex').slice(0, 24), root = path.join(directory, '.agentes', 'public-programme-evidence');
      try {
        const metadata = JSON.parse(await fs.readFile(path.join(root, `${hash}.json`), 'utf8'));
        if (metadata.url === url && !metadata.truncated && !metadata.emptyPages && Date.now() - Date.parse(metadata.checkedAt) < 24 * 60 * 60_000) return await fs.readFile(path.join(root, `${hash}.txt`), 'utf8');
      } catch { /* No usable public PDF cache: HTML can still be checked independently. */ }
      const response = await fetcher(url, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
      const data = await readResponseLimited(response, 4 * 1024 * 1024);
      if (data.subarray(0, 5).toString() === '%PDF-') throw new Error('PDF text is not available in the public evidence cache.');
      return data.toString('utf8').replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
    })());
    return pending.get(url)!;
  };
  await Promise.all(report.sources.filter(source => source.kind === 'official' && source.excerpt).map(async source => {
    const checkedAt = new Date().toISOString();
    try { checks[source.id] = { status: sourceContainsExcerpt(await getText(source.url), source.excerpt!) ? 'matched' : 'notMatched', checkedAt }; }
    catch { checks[source.id] = { status: 'unavailable', checkedAt }; }
  }));
  return checks;
}
