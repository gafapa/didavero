import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CurriculumStore } from '../server/curriculumStore';
import { TeachingProgrammeStore, parseProgramme } from '../server/teachingProgrammeStore';
import { emptyProgramme, programmeIssues, programmeMarkdown, PROGRAMME_SECTIONS } from '../shared/teachingProgramme';
import type { ProgrammeResearchResult } from '../shared/programmeResearch';
import { activeCurriculum, type CurriculumDraft } from '../shared/curriculum';
import { Almacen } from '../server/store';
import { Cola } from '../server/agents/cola';
import { Flujo } from '../server/flujo';
import { crearServidor } from '../server/index';
import { ProgrammeProjects } from '../server/programmeProjects';
import { exportProgramme } from '../server/exportProgramme';
import { existsSync } from 'node:fs';
import JSZip from 'jszip';

const fixture: CurriculumDraft = {
  profile: { stage: 'eso', territory: 'Galicia', academicYear: '2026-2027', subject: 'Synthetic programme subject', course: '1', scope: 'course', model: 'general', qualification: '', moduleCode: '' },
  sources: [{ id: 'source', title: 'Synthetic source', url: 'https://www.boe.es/fictional', origin: 'official', filename: '', publishedOn: '', applicableFrom: '', notes: 'Synthetic unresolved applicability note.', reviewed: true }],
  elements: [
    { id: 'competence', kind: 'specificCompetence', code: 'CE1', text: 'Synthetic competence', parentId: '', sourceId: 'source', locator: 'Fixture', excerpt: 'Synthetic competence', notes: '', reviewed: true },
    { id: 'criterion', kind: 'assessmentCriterion', code: 'CA1', text: 'Synthetic criterion', parentId: 'competence', sourceId: 'source', locator: 'Fixture', excerpt: 'Synthetic criterion', notes: '', reviewed: true },
  ], links: [], completenessReviewed: true,
};
const researchResult: ProgrammeResearchResult = { status: 'ready', summary: 'Synthetic researched outline', contextSummary: '',
  outline: [{ id: 'teachingPlan', title: 'Synthetic teaching section', description: 'Synthetic researched instructions', mandatory: true, sourceIds: ['s1'] }],
  requirements: [], sources: [{ id: 's1', title: 'Synthetic research source', url: 'https://www.boe.es/fictional', kind: 'official', publishedOn: '', locator: 'Synthetic article' }], questions: [] };
async function temporary(context: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-programme-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true })); return directory;
}
async function setup(directory: string) {
  const curricula = new CurriculumStore(directory);
  await curricula.saveDraft(fixture, 0);
  const curriculum = activeCurriculum(await curricula.activate(1))!;
  const programme = emptyProgramme(curriculum);
  programme.totalHours = 12;
  programme.researchRevision = 1;
  programme.researchedSections = researchResult.outline.map(item => ({ ...item, text: 'Synthetic authored section' }));
  for (const key of Object.keys(PROGRAMME_SECTIONS)) programme.sections[key as keyof typeof PROGRAMME_SECTIONS] = 'Synthetic teacher decision';
  programme.units = [{ id: 'unit1', title: 'Synthetic unit', hours: 12, period: 'First term', criterionIds: ['criterion'], contentIds: [], activities: 'Build a synthetic example.', evidence: 'Observe the example using a rubric.' }];
  return { curricula, curriculum, programme, store: new TeachingProgrammeStore(path.join(directory, 'programacion', 'state.json'), curricula) };
}
test('programme validation rejects foreign references, malformed hours and duplicate units', async context => {
  const { programme, curriculum } = await setup(await temporary(context));
  assert.deepEqual(parseProgramme(programme, curriculum), programme);
  for (const hours of [-1, NaN, Infinity, '12', null]) assert.throws(() => parseProgramme({ ...programme, totalHours: hours }, curriculum), /horas/);
  assert.throws(() => parseProgramme({ ...programme, units: [programme.units[0], programme.units[0]] }, curriculum), /repetidas/);
  assert.throws(() => parseProgramme({ ...programme, units: [{ ...programme.units[0], criterionIds: ['competence'] }] }, curriculum), /referencias/);
  assert.throws(() => parseProgramme({ ...programme, units: [{ ...programme.units[0], contentIds: ['criterion'] }] }, curriculum), /referencias/);
  assert.throws(() => parseProgramme({ ...programme, curriculumVersionId: 'other' }, curriculum), /versión/);
});
test('review saves a protected snapshot; later drafts and stale writes cannot overwrite it', async context => {
  const { store, programme, curriculum, curricula } = await setup(await temporary(context));
  assert.deepEqual(programmeIssues(programme, curriculum), []);
  await assert.rejects(store.save(programme, 0, { confirmed: 'true' }), /Confirma/);
  const incomplete = { ...programme, totalHours: 15 };
  await assert.rejects(store.save(incomplete, 0, { confirmed: true }), /suman/);
  await store.save(programme, 0, { confirmed: true });
  programme.title = 'Edited after review';
  await store.save(programme, 1);
  const current = await store.read();
  assert.notEqual(current.reviewed!.programme.title, current.draft!.title);
  await assert.rejects(store.save({ ...programme, title: 'Stale edit' }, 1), { statusCode: 409 });
  assert.deepEqual(await store.read(), current);
  const other = new TeachingProgrammeStore(store.filename, curricula);
  // Stores sharing a file serialize competing read/modify/write operations.
  const outcomes = await Promise.allSettled([store.save(programme, 2), other.save({ ...programme, title: 'Competing edit' }, 2)]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await store.read()).revision, 3);
});
test('programme references remain pinned after a new curriculum is activated and exports preserve notes', async context => {
  const { store, curricula, programme, curriculum } = await setup(await temporary(context));
  await store.save(programme, 0);
  await curricula.saveDraft({ ...fixture, profile: { ...fixture.profile, academicYear: '2027-2028' } }, 2);
  const updated = activeCurriculum(await curricula.activate(3))!;
  assert.notEqual(updated.id, curriculum.id);
  assert.equal((await store.curriculum((await store.read()).draft!.curriculumVersionId)).profile.academicYear, '2026-2027');
  await assert.rejects(store.save({ ...programme, curriculumVersionId: updated.id }, 1), /No cambies/);
  const markdown = programmeMarkdown(programme, curriculum);
  assert.match(markdown, /Synthetic criterion \[criterion\]/);
  assert.match(markdown, /Synthetic unresolved applicability note/);
  assert.match(markdown, /2026-2027/);
  assert.match(programmeIssues({ ...programme, units: [] }, curriculum).join(' '), /criterios.*sin vincular/);
});
test('new programmes wait for researched sections and classroom/opposition drafts persist independently', async context => {
  const { store, curricula, curriculum, programme } = await setup(await temporary(context));
  const primary = { ...curriculum, profile: { ...curriculum.profile, stage: 'primaria' } };
  const vocational = { ...curriculum, profile: { ...curriculum.profile, stage: 'fp-basica', model: 'vocational' as const } };
  assert.deepEqual(emptyProgramme(primary).researchedSections, []);
  assert.deepEqual(emptyProgramme(curriculum).researchedSections, []);
  assert.deepEqual(emptyProgramme(vocational, 'opposition').researchedSections, []);
  await store.save(programme, 0);
  const oppositionStore = new TeachingProgrammeStore(path.join(path.dirname(store.filename), 'opposition.json'), curricula, 'opposition');
  const opposition = { ...programme, purpose: 'opposition' as const, title: 'Synthetic opposition programme' };
  await oppositionStore.save(opposition, 0);
  assert.equal((await store.read()).draft!.purpose, 'classroom');
  assert.equal((await oppositionStore.read()).draft!.title, opposition.title);
  await assert.rejects(store.save(opposition, 1), /otra finalidad/);
});
test('damaged programme storage fails closed without discarding its original bytes', async context => {
  const { store, programme } = await setup(await temporary(context));
  await store.save(programme, 0); await fs.writeFile(store.filename, '{damaged');
  await assert.rejects(store.read(), { statusCode: 500 });
  await assert.rejects(store.save(programme, 1), { statusCode: 500 });
  assert.equal(await fs.readFile(store.filename, 'utf8'), '{damaged');
});
test('programme generation uses one existing role, no web search, and rejects late or altered outputs', async context => {
  const directory = await temporary(context), storage = new Almacen(path.join(directory, 'data')); await storage.iniciar();
  const subject = await storage.crearAsignatura({ nombre: 'Synthetic programme subject', etapa: 'eso', curso: '1' });
  const { programme } = await setup(storage.dirAsignatura(subject.id));
  const queue = new Cola(1, path.join(directory, 'jobs'));
  const workflow = new Flujo({ almacen: () => storage, cola: queue, ajustes: () => ({ carpetaDatos: storage.raiz, maxSimultaneos: 1, motorPorDefecto: 'claude', asistenteCompletado: true, agentes: {} }), motoresListos: () => new Set() });
  let launch: any;
  (workflow as any).lanzar = async (value: unknown) => { launch = value; return { id: 'synthetic-job' }; };
  const project = await workflow.programmeProjects(subject.id).create({ title: programme.title, purpose: 'classroom', totalHours: 12, context: '', requirements: 'Synthetic rules', selectionRequirements: '' });
  const store = await workflow.programmeStore(subject.id, project.id);
  await store.save(programme, 1);
  await assert.rejects(workflow.generateProgramme(subject.id, project.id, 2), /Investiga primero/);
  await (await workflow.programmeProjects(subject.id).research(project.id)).accept(researchResult, 0, 'research-fixture');
  await workflow.generateProgramme(subject.id, project.id, 2);
  assert.equal(launch.agente, 'arquitecto'); assert.equal(launch.web, false); assert.equal(launch.fuentes, true);
  assert.match(launch.tarea, /Synthetic criterion/); assert.match(launch.tarea, /curriculumVersionId/);
  const filename = path.join(storage.dirAsignatura(subject.id), launch.post.datos.output);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, JSON.stringify({ ...programme, totalHours: 99 }));
  const job = { id: 'synthetic-job', asignatura: subject.id };
  await assert.rejects((workflow as any).acceptProgramme(job, launch.post.datos), /cambiado las horas/);
  const changedRequirements = structuredClone(programme);
  changedRequirements.sections.requirements = 'Unapproved replacement requirements';
  await fs.writeFile(filename, JSON.stringify(changedRequirements));
  await assert.rejects((workflow as any).acceptProgramme(job, launch.post.datos), /cambiado los requisitos/);
  for (const replacement of [{ ...programme, title: 'Invented title' }, { ...programme, sections: { ...programme.sections, context: 'Invented group' } }]) {
    await fs.writeFile(filename, JSON.stringify(replacement));
    await assert.rejects((workflow as any).acceptProgramme(job, launch.post.datos), /título o el contexto/);
  }
  assert.equal((await store.read()).revision, 2);
  const changedStructure = structuredClone(programme);
  changedStructure.researchedSections![0].title = 'A model-invented replacement heading';
  await fs.writeFile(filename, JSON.stringify(changedStructure));
  await assert.rejects((workflow as any).acceptProgramme(job, launch.post.datos), /cambiado los apartados/);
  await fs.writeFile(filename, JSON.stringify(programme));
  await (workflow as any).acceptProgramme(job, launch.post.datos);
  assert.equal((await store.read()).revision, 3);
  await (workflow as any).acceptProgramme(job, launch.post.datos);
  assert.equal((await store.read()).revision, 3);
  await assert.rejects((workflow as any).acceptProgramme({ ...job, id: 'late-job' }, launch.post.datos), { statusCode: 409 });
});
test('programme HTTP flow saves, reviews and exports while enforcing strict references and revisions', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-programme-http-')), root = path.join(directory, 'data');
  const server = await crearServidor({ archivoAjustes: path.join(directory, 'settings.json'), carpetaDatosPorDefecto: root, codexUsageReader: async () => ({ windows: [], updatedAt: 0, unavailable: true }) });
  context.after(async () => { await server.cerrar(); await fs.rm(directory, { recursive: true, force: true }); });
  const storage = new Almacen(root); await storage.iniciar();
  const subject = await storage.crearAsignatura({ nombre: 'Synthetic HTTP subject', etapa: 'eso', curso: '1' });
  const collection = `${server.url}/api/asignaturas/${subject.id}/programaciones`;
  let base = collection;
  const request = (method: string, suffix = '', body?: unknown) => fetch(base + suffix, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  assert.deepEqual(await (await request('GET')).json(), []);
  assert.equal((await request('POST', '', { title: 'Before curriculum', purpose: 'classroom', totalHours: 12 })).status, 400);
  const { programme } = await setup(storage.dirAsignatura(subject.id));
  const created = await request('POST', '', { title: programme.title, purpose: 'classroom', totalHours: 12, context: 'Synthetic group', requirements: 'Synthetic requirements', selectionRequirements: '' });
  assert.equal(created.status, 200);
  const project = await created.json() as any;
  const projects = new ProgrammeProjects(storage.dirAsignatura(subject.id), storage.curriculum(subject.id));
  await (await projects.research(project.id)).accept(researchResult, 0, 'research-fixture');
  base = `${collection}/${project.id}`;
  assert.equal((await request('PUT', '', { programme, expectedRevision: 1 })).status, 200);
  assert.equal((await request('PUT', '', { programme, expectedRevision: 0 })).status, 409);
  assert.equal((await request('PUT', '', { programme, expectedRevision: 2, confirmed: 'true' })).status, 400);
  assert.equal((await request('PUT', '', { programme, expectedRevision: 2, confirmed: true })).status, 200);
  const exported = await request('GET', '/exportar?reviewed=true');
  assert.equal(exported.status, 200); assert.match(exported.headers.get('content-disposition')!, /attachment/); assert.match(await exported.text(), /Synthetic criterion/);
  const loaded = await (await request('GET')).json() as any;
  assert.equal(loaded.state.revision, 3); assert.equal(loaded.curriculum.id, programme.curriculumVersionId);
  await (await projects.research(project.id)).accept({ ...researchResult, summary: 'Newer unreviewed research' }, 1, 'research-later');
  const reviewedExport = await request('GET', '/exportar?reviewed=true');
  const reviewedText = await reviewedExport.text();
  assert.match(reviewedText, /Synthetic researched outline/); assert.doesNotMatch(reviewedText, /Newer unreviewed research/);
  const staleExport = await request('GET', '/exportar');
  assert.doesNotMatch(await staleExport.text(), /Newer unreviewed research/);
  assert.equal((await (await request('GET', '?purpose=opposition')).json() as any).state.revision, 0);
  assert.equal((await request('PUT', '?purpose=opposition', { programme: { ...programme, purpose: 'opposition' }, expectedRevision: 0 })).status, 200);
  assert.equal((await (await request('GET')).json() as any).state.revision, 3);
  assert.equal((await request('GET', '?purpose=invalid')).status, 400);
  const another = await fetch(collection, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Second independent programme', purpose: 'opposition' }) });
  assert.equal(another.status, 200);
  const secondProject = await another.json() as any;
  assert.notEqual(secondProject.id, project.id);
  const list = await (await fetch(collection)).json() as any[];
  assert.equal(list.length, 2);
  assert.equal(list.find(item => item.id === secondProject.id).totalHours, 0);
  assert.equal((await (await request('GET')).json() as any).state.draft.totalHours, 12);
  assert.equal((await fetch(`${collection}/missing`)).status, 404);
  const unsaved = { ...programme, title: 'Unsaved export title' };
  const draftExport = await request('POST', '/exportar?format=md', { programme: unsaved });
  assert.equal(draftExport.status, 200); assert.match(await draftExport.text(), /Unsaved export title/);
  assert.equal((await (await request('GET')).json() as any).state.revision, 3);
  assert.equal((await request('GET', '/exportar?format=exe')).status, 400);
  assert.equal((await request('POST', '/exportar', { programme: { ...unsaved, curriculumVersionId: 'other' } })).status, 400);
});

test('review captures the exact researched outline and sources without changing historical copies', async context => {
  const directory = await temporary(context), { curricula, programme } = await setup(directory);
  const projects = new ProgrammeProjects(directory, curricula), project = await projects.create({ title: programme.title, purpose: 'classroom' });
  const store = await projects.store(project.id), research = await projects.research(project.id);
  await assert.rejects(store.save(programme, 1, { confirmed: true }), { statusCode: 409 });
  assert.equal((await store.read()).revision, 1);
  await research.accept(researchResult, 0, 'research-1');
  const reviewed = await store.save(programme, 1, { confirmed: true });
  assert.equal(reviewed.reviewed!.research!.summary, researchResult.summary);
  const copy = structuredClone(reviewed.reviewed);
  await research.accept({ ...researchResult, summary: 'Later research summary' }, 1, 'research-2');
  await store.save({ ...programme, title: 'Later draft' }, 2);
  assert.deepEqual((await store.read()).reviewed, copy);
  await assert.rejects(store.save(programme, 3, { confirmed: true }), { statusCode: 409 });
  const markdown = programmeMarkdown(copy!.programme, await store.curriculum(programme.curriculumVersionId), copy!.research);
  assert.match(markdown, /Synthetic researched outline/); assert.doesNotMatch(markdown, /Later research summary/);
});

test('programme exports render actual Word, LibreOffice and PDF files with isolated resources', { skip: !existsSync(path.resolve('resources-bin', process.platform === 'win32' ? 'win/pandoc.exe' : 'linux/pandoc')) }, async context => {
  const directory = await temporary(context), storage = new Almacen(path.join(directory, 'data')); await storage.iniciar();
  const subject = await storage.crearAsignatura({ nombre: 'Synthetic export subject', etapa: 'eso', curso: '1' });
  const { programme, curriculum } = await setup(storage.dirAsignatura(subject.id));
  programme.researchedSections![0].text = 'Synthetic authored section\n\n![Excluded image](http://127.0.0.1:1/private-image.png)\n\n![Local image](file:///C:/Windows/win.ini)\n\n```{=typst}\n#read("/private-file")\n```';
  const dirBin = path.resolve('resources-bin', process.platform === 'win32' ? 'win' : 'linux');
  const [word, libre, pdf] = await Promise.all((['docx', 'odt', 'pdf'] as const).map(format => exportProgramme(storage, subject.id, programme, curriculum, format, { dirBin })));
  const wordZip = await JSZip.loadAsync(word.content), libreZip = await JSZip.loadAsync(libre.content);
  assert.match(await wordZip.file('word/document.xml')!.async('string'), /Synthetic authored section/);
  assert.match(await libreZip.file('content.xml')!.async('string'), /Synthetic authored section/);
  assert.equal(pdf.content.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.content.length > 1000);
  assert.equal(Object.keys(wordZip.files).filter(name => name.startsWith('word/media/')).length, 0);
});
