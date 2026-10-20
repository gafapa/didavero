import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkProgrammeResearchExcerpts, sourceContainsExcerpt } from '../server/programmeSourceChecks';
import { ProgrammeResearchStore } from '../server/programmeResearchStore';
import type { ProgrammeResearchResult } from '../shared/programmeResearch';

const report: ProgrammeResearchResult = { status: 'ready', summary: 'Fixture research.', contextSummary: '', outline: [{ id: 'context', title: 'Context', description: 'Test description.', mandatory: true, sourceIds: ['source'] }], requirements: [], sources: [{ id: 'source', title: 'Public fixture', url: 'https://www.boe.es/fixture', kind: 'official', publishedOn: '', locator: 'Article 1', excerpt: 'The programme shall include assessment criteria.' }], questions: [] };
test('literal checks distinguish original text, elisions, paraphrases and too-short or reordered quotes', () => {
  const source = 'The programme shall include assessment criteria. It also explains teaching methods and resources.';
  assert.equal(sourceContainsExcerpt(source, 'The programme shall include assessment criteria.'), true);
  assert.equal(sourceContainsExcerpt(source, 'The programme shall include…teaching methods and resources.'), true);
  assert.equal(sourceContainsExcerpt(source, 'Assessment criteria must always be included.'), false);
  assert.equal(sourceContainsExcerpt(source, 'teaching methods and resources.…The programme shall include'), false);
  assert.equal(sourceContainsExcerpt(source, 'the'), false);
});
test('server checks are independent of model annotations and retain explicit retrieval failures', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-source-check-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const checks = await checkProgrammeResearchExcerpts(report, directory, async () => new Response('<p>The programme shall include <strong>assessment criteria.</strong></p>'));
  assert.equal(checks.source.status, 'matched');
  const mismatched = await checkProgrammeResearchExcerpts(report, directory, async () => new Response('This page discusses a different requirement.'));
  assert.equal(mismatched.source.status, 'notMatched');
  const unavailable = await checkProgrammeResearchExcerpts(report, directory, async () => { throw new Error('Unavailable'); });
  assert.equal(unavailable.source.status, 'unavailable');
  const target = { curriculumVersionId: 'version', purpose: 'classroom' as const, profile: { stage: 'eso', territory: 'Galicia', academicYear: '2026-2027', subject: 'Fixture', course: '1', scope: 'course' as const, model: 'general' as const, qualification: '', moduleCode: '' }, contextFingerprint: '' };
  const store = new ProgrammeResearchStore(path.join(directory, 'research.json'), target);
  const forged = { ...report, sources: [{ ...report.sources[0], excerptCheck: { status: 'matched', checkedAt: 'model-invented' } }] };
  const first = await store.accept(forged, 0, 'first');
  assert.equal(first.result!.sources[0].excerptCheck, undefined);
  const second = await store.accept(forged, 1, 'second', mismatched);
  assert.equal(second.result!.sources[0].excerptCheck!.status, 'notMatched');
  assert.deepEqual((await store.read()).result!.sources[0].excerptCheck, mismatched.source);
});
