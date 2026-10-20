import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { defaultProgrammePresentation, parseProgrammePresentation } from '../shared/programmePresentation';
import { emptyProgramme, programmeIssues, programmeMarkdown } from '../shared/teachingProgramme';
import type { CurriculumVersion } from '../shared/curriculum';
import { parseProgramme } from '../server/teachingProgrammeStore';
import { Almacen } from '../server/store';
import { exportProgramme } from '../server/exportProgramme';

const curriculum: CurriculumVersion = { id: 'fixture', activatedAt: '2026-10-19', profile: { stage: 'eso', territory: 'Galicia', academicYear: '2026-2027', subject: 'Fixture', course: '1', scope: 'course', model: 'general', qualification: '', moduleCode: '' }, elements: [], sources: [], links: [], completenessReviewed: true };
test('presentation is opt-in, bounded and preserves legacy drafts without accepting executable font values', () => {
  const programme = emptyProgramme(curriculum), presentation = defaultProgrammePresentation();
  assert.equal(parseProgramme(programme, curriculum).presentation, undefined);
  assert.deepEqual(parseProgramme({ ...programme, presentation }, curriculum).presentation, presentation);
  for (const invalid of [{ fontFamily: 'Arial"; read("private")' }, { lineSpacing: NaN }, { fontSizePt: 100 }, { maxPages: 0 }, { minUnits: 1.5 }, { marginsCm: { ...presentation.marginsCm, left: -1 } }, { includeAppendices: 'false' }]) assert.throws(() => parseProgrammePresentation({ ...presentation, ...invalid }));
  assert.match(programmeIssues({ ...programme, presentation: { ...presentation, minUnits: 15 } }, curriculum).join(' '), /al menos 15/);
});
test('body-only export excludes evidence appendices without removing stored context or archived writing', () => {
  const programme = emptyProgramme(curriculum);
  programme.researchedSections = [{ id: 'section', title: 'Authored section', description: '', mandatory: false, sourceIds: [], text: 'Body content.' }];
  programme.archivedSections = [{ id: 'old', title: 'Old section', description: '', mandatory: false, sourceIds: [], text: 'Archived writing.' }];
  programme.sections.context = 'Captured teacher context.';
  const original = structuredClone(programme);
  const text = programmeMarkdown({ ...programme, presentation: { ...defaultProgrammePresentation(), includeAppendices: false } }, curriculum);
  assert.match(text, /Body content/); assert.doesNotMatch(text, /Archived writing|Captured teacher context/);
  assert.deepEqual(programme, original);
});

test('compact references retain complete traceability once in the appendix and detect missing knowledge', () => {
  const version = { ...curriculum, elements: [{ id: 'ce', kind: 'specificCompetence' as const, code: 'CE1', text: 'Competence literal.', parentId: '', sourceId: '', locator: '', excerpt: '', notes: '', reviewed: true }, { id: 'criterion', kind: 'assessmentCriterion' as const, code: '1.1', text: 'Criterion literal.', parentId: 'ce', sourceId: '', locator: '', excerpt: '', notes: '', reviewed: true }, { id: 'knowledge', kind: 'knowledge' as const, code: 'A.1', text: 'Knowledge literal.', parentId: '', sourceId: '', locator: '', excerpt: '', notes: '', reviewed: true }] };
  const programme = emptyProgramme(version);
  programme.units = [{ id: 'unit', title: 'Unit', hours: 1, period: 'First term', criterionIds: ['criterion'], contentIds: [], activities: 'A task.', evidence: 'A rubric.' }];
  assert.match(programmeIssues(programme, version).join(' '), /1 contenidos o saberes/);
  programme.units[0].contentIds = ['knowledge'];
  programme.presentation = { ...defaultProgrammePresentation(), compactReferences: true };
  const text = programmeMarkdown(programme, version);
  assert.match(text, /CE1 › 1.1/); assert.equal(text.split('Criterion literal.').length - 1, 1); assert.match(text, /Knowledge literal/);
  programme.presentation.includeAppendices = false;
  assert.doesNotMatch(programmeMarkdown(programme, version), /Criterion literal|Knowledge literal/);
});
const dirBin = path.resolve('resources-bin', process.platform === 'win32' ? 'win' : 'linux');
test('explicit presentation reaches real PDF, Word and ODT, and page limits are checked after PDF layout', { skip: !existsSync(path.join(dirBin, process.platform === 'win32' ? 'pandoc.exe' : 'pandoc')) }, async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-presentation-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const storage = new Almacen(path.join(directory, 'data')); await storage.iniciar();
  const subject = await storage.crearAsignatura({ nombre: 'Presentation fixture' });
  const programme = emptyProgramme(curriculum);
  programme.title = 'Uniform presentation';
  programme.presentation = { ...defaultProgrammePresentation(), lineSpacing: 2, maxPages: 60, includeAppendices: false };
  programme.researchedSections = [{ id: 'section', title: 'Section', description: '', mandatory: false, sourceIds: [], text: 'A test paragraph with enough words to wrap on a page and demonstrate the requested font and double line spacing. '.repeat(30) }];
  const word = await exportProgramme(storage, subject.id, programme, curriculum, 'docx', { dirBin });
  const wordZip = await JSZip.loadAsync(word.content), styles = await wordZip.file('word/styles.xml')!.async('string'), document = await wordZip.file('word/document.xml')!.async('string');
  assert.match(styles, /w:ascii="Arial"/); assert.match(styles, /w:line="480"/); assert.match(styles, /w:sz w:val="24"/);
  assert.match(document, /w:top="1417"/);
  const odt = await exportProgramme(storage, subject.id, programme, curriculum, 'odt', { dirBin }), odtZip = await JSZip.loadAsync(odt.content);
  const odtStyles = await odtZip.file('styles.xml')!.async('string');
  assert.match(odtStyles, /fo:font-family="Arial"/); assert.match(odtStyles, /fo:line-height="200%"/); assert.match(odtStyles, /fo:margin-left="2.5cm"/);
  const pdf = await exportProgramme(storage, subject.id, programme, curriculum, 'pdf', { dirBin });
  assert.equal(pdf.content.subarray(0, 5).toString(), '%PDF-');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const documentTask = pdfjs.getDocument({ data: new Uint8Array(pdf.content), useSystemFonts: true, disableFontFace: true, verbosity: 0 });
  const rendered = await documentTask.promise;
  try {
    const page = await rendered.getPage(1), content = await page.getTextContent();
    const items = content.items.filter((item: any) => item.str?.trim()) as { str: string; transform: number[] }[];
    assert.ok(items.length > 5); assert.ok(items.every(item => Math.abs(Math.abs(item.transform[0]) - 12) < 0.01), 'All rendered headings and body text must keep the chosen size.');
    const firstLine = items.findIndex(item => item.str.startsWith('A test paragraph'));
    assert.ok(firstLine >= 0);
    const nextLine = items.slice(firstLine + 1).find(item => Math.abs(items[firstLine].transform[5] - item.transform[5]) > 1);
    const distance = Math.abs(items[firstLine].transform[5] - nextLine!.transform[5]);
    assert.ok(Math.abs(distance - 24) < 0.01, `Double spacing must survive actual PDF layout (observed ${distance} pt).`);
  } finally { await documentTask.destroy(); }
  programme.presentation.includeTableOfContents = true;
  programme.researchedSections.unshift({ id: 'index', title: 'Índice', description: '', mandatory: false, sourceIds: [], text: 'OBSOLETE_INDEX_PLACEHOLDER' });
  const indexedPdf = await exportProgramme(storage, subject.id, programme, curriculum, 'pdf', { dirBin });
  const indexedTask = pdfjs.getDocument({ data: new Uint8Array(indexedPdf.content), verbosity: 0 });
  try {
    const indexedDocument = await indexedTask.promise;
    const text = (await Promise.all(Array.from({ length: indexedDocument.numPages }, async (_, index) => (await (await indexedDocument.getPage(index + 1)).getTextContent()).items.map((item: any) => item.str || '').join(' ')))).join(' ');
    assert.match(text, /Índice/); assert.match(text, /Section/); assert.doesNotMatch(text, /OBSOLETE_INDEX_PLACEHOLDER/);
    assert.equal(programme.researchedSections[0].text, 'OBSOLETE_INDEX_PLACEHOLDER');
  } finally { await indexedTask.destroy(); }
  programme.presentation.maxPages = 1;
  programme.researchedSections[0].text = 'Explicit paragraph for a long programme. '.repeat(3000);
  await assert.rejects(exportProgramme(storage, subject.id, programme, curriculum, 'pdf', { dirBin }), /supera el límite configurado de 1/);
});
