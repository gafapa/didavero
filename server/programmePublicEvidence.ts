import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { CurriculumVersion } from '../shared/curriculum';
import { isOfficialCurriculumUrl } from '../shared/curriculum';
import { fetchPublicResource, readResponseLimited } from './remoteResources';
import { textoPdf } from './rag';
import { writeFileAtomic } from './atomicFiles';

interface EvidenceEntry { url: string; title: string; localText?: string; localPdf?: string; checkedAt: string; status: 'available' | 'unavailable'; detail?: string }
type Fetcher = typeof fetchPublicResource;

/** Public-only PDF evidence gives CLI agents searchable text when their web reader cannot open a PDF. */
export async function programmePublicEvidence(directory: string, curriculum: CurriculumVersion, fetcher: Fetcher = fetchPublicResource): Promise<EvidenceEntry[]> {
  const root = path.join(directory, '.agentes', 'public-programme-evidence');
  const sources = curriculum.sources.filter(source => source.origin === 'official' && /\.pdf(?:[?#]|$)|webfm_send\/|_ext=PDF/i.test(source.url));
  // Discover the current manual rather than pinning a manual version in application code.
  if (curriculum.profile.territory === 'Galicia') {
    try {
      const response = await fetcher('https://www.edu.xunta.gal/proens/PaxinaInicio.action', { signal: AbortSignal.timeout(12000) });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
      const html = (await readResponseLimited(response, 1024 * 1024)).toString('utf8');
      for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        const caption = match[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
        const relevant = curriculum.profile.model === 'vocational' ? /manual.*programaci.*formaci.n\s+profesional/i.test(caption) : /manual.*elaboraci.*programaci.ns\s+did.cticas/i.test(caption);
        if (relevant) sources.unshift({ id: 'public-manual', title: caption.trim(), url: new URL(match[1].replaceAll('&amp;', '&'), 'https://www.edu.xunta.gal/proens/PaxinaInicio.action').href, origin: 'official', filename: '', publishedOn: '', applicableFrom: '', notes: '', reviewed: false });
      }
    } catch { /* The model still has web access and receives any available curriculum documents. */ }
  }
  const selected = [...new Map(sources.filter(source => isOfficialCurriculumUrl(source.url)).map(source => [source.url, source])).values()].slice(0, 4);
  if (!selected.length) return [];
  await fs.mkdir(root, { recursive: true });
  const entries: EvidenceEntry[] = [];
  await Promise.all(selected.map(async source => {
    const hash = createHash('sha256').update(source.url).digest('hex').slice(0, 24), filename = path.join(root, `${hash}.txt`), metadata = path.join(root, `${hash}.json`);
    try {
      const cached = JSON.parse(await fs.readFile(metadata, 'utf8'));
      if (cached.url === source.url && Date.now() - Date.parse(cached.checkedAt) < 24 * 60 * 60_000 && (await fs.stat(filename)).size > 0) {
        entries.push({ url: source.url, title: source.title, localText: path.relative(directory, filename).replaceAll('\\', '/'), localPdf: path.relative(directory, path.join(root, `${hash}.pdf`)).replaceAll('\\', '/'), checkedAt: cached.checkedAt, status: 'available', ...(cached.truncated || cached.emptyPages ? { detail: 'Extracción parcial o con páginas sin texto; consulta visualmente las páginas del PDF.' } : {}) }); return;
      }
    } catch { /* Derived caches can be rebuilt; teacher content is never read here. */ }
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetcher(source.url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
      const bytes = await readResponseLimited(response, 8 * 1024 * 1024);
      if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('La fuente no devolvió un PDF.');
      const pdf = path.join(root, `${hash}.pdf`); await writeFileAtomic(pdf, bytes);
      const pages = await textoPdf(pdf);
      const text = pages.map(page => `[Página ${page.pagina}]\n${page.texto}`).join('\n\n');
      if (!pages.length) throw new Error('El PDF no contiene páginas legibles.');
      const emptyPages = pages.filter(page => page.texto.trim().length < 40).length;
      const truncated = text.length > 400000;
      await writeFileAtomic(filename, `URL: ${source.url}\nConsulta: ${checkedAt}\n${emptyPages ? `EXTRACCIÓN PARCIAL: ${emptyPages} de ${pages.length} páginas sin texto suficiente; consulta visualmente esas páginas del PDF.\n` : ''}${truncated ? 'EXTRACCIÓN PARCIAL: se conservan los primeros 400000 caracteres.\n' : ''}\n${text.slice(0, 400000)}`);
      await writeFileAtomic(metadata, JSON.stringify({ url: source.url, checkedAt, sha256: createHash('sha256').update(bytes).digest('hex'), truncated, emptyPages }, null, 2));
      entries.push({ url: source.url, title: source.title, localText: path.relative(directory, filename).replaceAll('\\', '/'), localPdf: path.relative(directory, pdf).replaceAll('\\', '/'), checkedAt, status: 'available', ...(truncated || emptyPages ? { detail: 'Extracción parcial o con páginas sin texto; consulta visualmente las páginas del PDF.' } : {}) });
    } catch (error) { entries.push({ url: source.url, title: source.title, checkedAt, status: 'unavailable', detail: String((error as Error).message).slice(0, 300) }); }
  }));
  return entries;
}
