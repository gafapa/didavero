import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { programmePublicEvidence } from '../server/programmePublicEvidence';
import { createPdfWithImages } from './fixtures/pdf-with-images';
import type { CurriculumVersion } from '../shared/curriculum';

test('public evidence extracts cited PDF pages, discovers the current manual, caches locally and ignores private or unofficial sources', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-public-evidence-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const curriculum: CurriculumVersion = { id: 'fixture', activatedAt: '2026-10-19', profile: { stage: 'fp-basica', territory: 'Galicia', academicYear: '2026-2027', subject: 'Fixture', course: '1', scope: 'module', model: 'vocational', qualification: '', moduleCode: 'MP1' }, sources: [], elements: [], links: [], completenessReviewed: true };
  for (const [id, origin, url] of [['public', 'official', 'https://www.boe.es/fixture.pdf'], ['private', 'provided', 'https://www.boe.es/private.pdf'], ['unofficial', 'official', 'https://example.com/unofficial.pdf']] as const) curriculum.sources.push({ id, origin, url, title: id, filename: '', publishedOn: '', applicableFrom: '', notes: '', reviewed: false });
  const calls: string[] = [], pdf = createPdfWithImages();
  const fetcher = async (url: string) => {
    calls.push(url);
    return url.endsWith('PaxinaInicio.action') ? new Response('<a href="/new-manual.pdf">Manual de axuda para a elaboración de programacións de Formación profesional con PROENS</a>') : new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } });
  };
  const first = await programmePublicEvidence(directory, curriculum, fetcher);
  assert.equal(first.length, 2); assert.ok(first.every(entry => entry.status === 'available'));
  for (const entry of first) {
    const text = await fs.readFile(path.join(directory, entry.localText!), 'utf8');
    assert.match(text, /\[Página 1\]/); assert.match(text, /Fictional educational notes/); assert.ok(text.includes(entry.url));
  }
  const second = await programmePublicEvidence(directory, curriculum, fetcher);
  assert.equal(second.length, 2); assert.equal(calls.filter(url => url.endsWith('.pdf')).length, 2);
  assert.ok(!calls.some(url => /private|unofficial/.test(url)));
});

test('unreadable public documents remain explicit limitations rather than successful or invented evidence', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-public-failure-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const curriculum = { profile: { territory: 'Madrid' }, sources: [{ origin: 'official', title: 'Unavailable', url: 'https://www.boe.es/unavailable.pdf' }] } as CurriculumVersion;
  const result = await programmePublicEvidence(directory, curriculum, async () => new Response('Unavailable', { status: 503 }));
  assert.equal(result[0].status, 'unavailable'); assert.match(result[0].detail!, /503/); assert.equal(result[0].localText, undefined);
});
