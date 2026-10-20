import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseProgrammeResearch, ProgrammeResearchStore } from '../server/programmeResearchStore';
import { programmeResearchTask } from '../server/programmeResearchTask';
import { programmeResearchPrompt, type ProgrammeResearchResult } from '../shared/programmeResearch';
import { applyProgrammeResearch, emptyProgramme, programmeIssues, programmeMarkdown } from '../shared/teachingProgramme';
import { activeCurriculum, type CurriculumDraft } from '../shared/curriculum';
import { Almacen } from '../server/store';
import { Flujo } from '../server/flujo';
import { Cola } from '../server/agents/cola';
import { PedirAlAgente } from '../server/agents/cola';
import { crearServidor } from '../server/index';

const profile = { stage: 'eso', territory: 'Galicia', academicYear: '2026-2027', subject: 'Synthetic research subject', course: '1', scope: 'course' as const, model: 'general' as const, qualification: '', moduleCode: '' };
const result: ProgrammeResearchResult = {
  status: 'ready', summary: 'Synthetic structure for the exact fictional profile.', contextSummary: 'Adapt the structure to cooperative work and limited classroom resources.',
  outline: [{ id: 'evaluation', title: 'Synthetic evaluation section', description: 'Describe synthetic evidence and instruments.', mandatory: true, sourceIds: ['s1'] }],
  requirements: [{ text: 'Synthetic requirement used only in tests.', sourceIds: ['s1'] }],
  sources: [{ id: 's1', title: 'Fictional official source', url: 'https://www.boe.es/fictional-research', kind: 'official', publishedOn: '2026', locator: 'Fictional article' }], questions: [],
};
async function temporary(context: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-programme-research-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true })); return directory;
}
async function setup(directory: string) {
  const storage = new Almacen(path.join(directory, 'data')); await storage.iniciar();
  const subject = await storage.crearAsignatura({ nombre: profile.subject, etapa: 'eso', curso: '1', comunidad: 'Galicia', contexto: 'Cooperative work and limited classroom resources.', destinatarios: 'Fictional secondary group', estilo: 'PRIVATE_STYLE_NOT_FOR_RESEARCH' });
  await storage.crearDocumento(subject.id, { titulo: 'PRIVATE_DOCUMENT_NOT_FOR_RESEARCH' });
  const draft: CurriculumDraft = { profile, sources: [{ id: 's1', title: 'Fictional source', url: 'https://www.boe.es/fictional', origin: 'official', filename: '', publishedOn: '', applicableFrom: '', notes: '', reviewed: true }], elements: [
    { id: 'ce1', kind: 'specificCompetence', code: 'CE1', text: 'Fictional competence', parentId: '', sourceId: 's1', locator: 'Fixture', excerpt: 'Fictional competence', notes: '', reviewed: true },
    { id: 'ca1', kind: 'assessmentCriterion', code: 'CA1', text: 'Fictional criterion', parentId: 'ce1', sourceId: 's1', locator: 'Fixture', excerpt: 'Fictional criterion', notes: '', reviewed: true },
  ], links: [], completenessReviewed: true };
  await storage.curriculum(subject.id).saveDraft(draft, 0);
  const curriculum = activeCurriculum(await storage.curriculum(subject.id).activate(1))!;
  const queue = new Cola(1, path.join(directory, 'jobs'));
  const workflow = new Flujo({ almacen: () => storage, cola: queue, ajustes: () => ({ carpetaDatos: storage.raiz, maxSimultaneos: 1, motorPorDefecto: 'claude', asistenteCompletado: true, agentes: {} }), motoresListos: () => new Set() });
  const project = await workflow.programmeProjects(subject.id).create({ title: 'PRIVATE_PROJECT_NOT_FOR_RESEARCH', purpose: 'classroom', totalHours: 12, context: 'A project-based fictional group.', requirements: '', selectionRequirements: '' });
  return { workflow, storage, subject, project, curriculum, queue };
}

test('research accepts useful partial findings but rejects invented mandatory provenance and unsafe sources', () => {
  assert.deepEqual(parseProgrammeResearch(result), result);
  const partial = { ...result, status: 'needsInformation', questions: ['Which exact selection call applies?'] };
  assert.equal(parseProgrammeResearch(partial).status, 'needsInformation');
  assert.throws(() => parseProgrammeResearch({ ...result, questions: partial.questions }), /completa/);
  assert.throws(() => parseProgrammeResearch({ ...result, status: 'needsInformation' }), /información falta/);
  assert.throws(() => parseProgrammeResearch({ ...result, sources: [{ ...result.sources[0], kind: 'example' }] }), /fuente oficial/);
  assert.throws(() => parseProgrammeResearch({ ...result, outline: [{ ...result.outline[0], sourceIds: ['missing'] }] }), /no encontrada/);
  assert.throws(() => parseProgrammeResearch({ ...result, sources: [{ ...result.sources[0], url: 'javascript:alert(1)' }] }), /Enlace/);
  assert.throws(() => parseProgrammeResearch({ ...result, sources: [{ ...result.sources[0], url: 'https://unofficial.example/fake' }] }), /oficiales/);
});
test('research retains literal source excerpts and accepts INAP without allowing hostname lookalikes', () => {
  const withEvidence = { ...result, sources: [{ ...result.sources[0], url: 'https://laadministracionaldia.inap.es/noticia.asp?id=1131642', excerpt: 'Short literal evidence.' }] };
  assert.equal(parseProgrammeResearch(withEvidence).sources[0].excerpt, 'Short literal evidence.');
  assert.equal(parseProgrammeResearch({ ...withEvidence, sources: [{ ...withEvidence.sources[0], url: 'https://www.lex.gal/es/legislacion' }] }).sources[0].kind, 'official');
  assert.throws(() => parseProgrammeResearch({ ...withEvidence, sources: [{ ...withEvidence.sources[0], url: 'https://lex.gal.example.com/article' }] }), /oficiales/);
  assert.throws(() => parseProgrammeResearch({ ...withEvidence, sources: [{ ...withEvidence.sources[0], url: 'https://inap.es.example.com/article' }] }), /oficiales/);
  assert.throws(() => parseProgrammeResearch({ ...withEvidence, sources: [{ ...withEvidence.sources[0], excerpt: 'x'.repeat(2001) }] }), /demasiado largo/);
});

test('research storage is atomic, idempotent, purpose-scoped and rejects stale or damaged state', async context => {
  const directory = await temporary(context), filename = path.join(directory, 'research.json');
  const target = { curriculumVersionId: 'version1', purpose: 'classroom' as const, profile, contextFingerprint: 'captured-context' };
  const first = new ProgrammeResearchStore(filename, target), second = new ProgrammeResearchStore(filename, target);
  const outcomes = await Promise.allSettled([first.accept(result, 0, 'job1'), second.accept({ ...result, summary: 'Competing result' }, 0, 'job2')]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  const state = await first.read(), acceptedJob = state.appliedJobs[0];
  assert.deepEqual(await first.accept(null, 0, acceptedJob), state);
  await assert.rejects(first.accept(result, 0, 'late'), { statusCode: 409 });
  assert.deepEqual(await first.read(), state);
  assert.equal(state.result!.contextFingerprint, target.contextFingerprint);
  const wrongPurpose = new ProgrammeResearchStore(filename, { ...target, purpose: 'opposition' });
  await assert.rejects(wrongPurpose.read(), { statusCode: 500 });
  await fs.writeFile(filename, '{damaged');
  await assert.rejects(first.accept(result, 1, 'new'), { statusCode: 500 });
  assert.equal(await fs.readFile(filename, 'utf8'), '{damaged');
});
test('research launch includes autonomous community, stage, subject and planning context without unrelated private files', async context => {
  const { workflow, queue, subject, project, curriculum } = await setup(await temporary(context));
  let launch: any;
  (queue as any).encolar = (value: unknown) => { launch = value; return { id: 'synthetic-research-job' }; };
  const opposition = emptyProgramme(curriculum, 'opposition'); opposition.title = 'PRIVATE_OPPOSITION_TITLE';
  opposition.sections.context = 'Synthetic opposition teaching scenario';
  opposition.sections.selectionRequirements = 'Synthetic exact selection call and specialty';
  await (await workflow.programmeStore(subject.id, project.id, 'opposition')).save(opposition, 0);
  await workflow.researchProgramme(subject.id, project.id, 'opposition');
  assert.equal(launch.web, true); assert.equal(launch.agente, 'investigador');
  assert.match(launch.prompt, /Galicia/); assert.match(launch.prompt, /2026-2027/); assert.match(launch.prompt, /"stage":"eso"/);
  assert.match(launch.prompt, /Cooperative work and limited classroom resources/);
  assert.match(launch.prompt, /Fictional secondary group/);
  assert.match(launch.prompt, /Synthetic opposition teaching scenario/);
  assert.match(launch.prompt, /Synthetic exact selection call and specialty/);
  assert.doesNotMatch(launch.prompt, /PRIVATE_STYLE_NOT_FOR_RESEARCH|PRIVATE_DOCUMENT_NOT_FOR_RESEARCH|PRIVATE_PROJECT_NOT_FOR_RESEARCH/);
  assert.match(launch.prompt, /NUNCA incluyas nombres/);
  assert.equal(launch.mcp, undefined);
  for (const stage of ['primaria', 'eso', 'bachillerato', 'fp-basica', 'fp-medio', 'fp-superior']) {
    const prompt = programmeResearchTask({ ...curriculum, profile: { ...curriculum.profile, stage, territory: 'Canarias', subject: 'Synthetic exact module', moduleCode: 'MP-SYNTHETIC' } }, 'opposition', 'output.json', 'Synthetic teaching context');
    assert.match(prompt, new RegExp(`"stage":"${stage}"`)); assert.match(prompt, /Canarias/); assert.match(prompt, /MP-SYNTHETIC/);
  }
});
test('post-processing preserves teaching edits and researched guidance is reused when generating', async context => {
  const { workflow, storage, subject, project, curriculum } = await setup(await temporary(context));
  let launch: any;
  (workflow as any).lanzar = async (value: unknown) => { launch = value; return { id: 'synthetic-job' }; };
  await workflow.researchProgramme(subject.id, project.id);
  const researchLaunch = launch, output = path.join(storage.dirAsignatura(subject.id), researchLaunch.post.datos.output);
  assert.ok(researchLaunch.tarea.includes(output), 'The model receives the exact absolute output path.');
  await assert.rejects((workflow as any).acceptProgrammeResearch({ id: 'missing-result', asignatura: subject.id }, researchLaunch.post.datos), (error: unknown) => error instanceof PedirAlAgente && error.paraAgente.includes(output) && error.paraAgente.includes('No repitas'));
  await assert.rejects((workflow as any).readProgrammeOutput({ asignatura: subject.id }, '../outside.json'), /Ruta de resultado/);
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(result));
  const programmeStore = await workflow.programmeStore(subject.id, project.id), oldState = await programmeStore.read();
  const draft = { ...oldState.draft!, title: 'Teacher edit during research' };
  await programmeStore.save(draft, oldState.revision);
  const job = { id: 'synthetic-job', asignatura: subject.id };
  await (workflow as any).acceptProgrammeResearch(job, researchLaunch.post.datos);
  assert.equal((await programmeStore.read()).draft!.title, draft.title);
  await (workflow as any).acceptProgrammeResearch(job, researchLaunch.post.datos);
  const researchStore = await workflow.programmeProjects(subject.id).research(project.id), researchState = await researchStore.read();
  assert.equal(researchState.revision, 1);
  assert.equal((await (await workflow.programmeProjects(subject.id).research(project.id, 'opposition')).read()).result, undefined);
  await workflow.generateProgramme(subject.id, project.id, 2);
  assert.match(launch.tarea, /Synthetic structure for the exact fictional profile/);
  assert.match(launch.tarea, /ADAPTACIÓN AL CONTEXTO/); assert.equal(launch.web, false);
  const currentContext = await workflow.programmePlanningContext(subject.id, project.id, 'classroom');
  assert.equal(researchState.result!.contextFingerprint, currentContext.fingerprint);
  const changed = emptyProgramme(curriculum); changed.title = draft.title; changed.totalHours = 12; changed.sections.context = 'A changed teaching context';
  await programmeStore.save(changed, 2);
  assert.notEqual((await workflow.programmePlanningContext(subject.id, project.id, 'classroom')).fingerprint, researchState.result!.contextFingerprint);
  assert.match(programmeResearchPrompt(researchState.result!), /Fictional official source/);
  await storage.actualizarAsignatura(subject.id, { permisos: { busquedaWeb: false } as any });
  await assert.rejects(workflow.researchProgramme(subject.id, project.id), /Activa la búsqueda web/);
});

test('researched headings and order drive authoring, completeness checks and export without a preset index', async context => {
  const { curriculum } = await setup(await temporary(context));
  const original = emptyProgramme(curriculum);
  assert.deepEqual(original.researchedSections, []);
  assert.doesNotMatch(programmeMarkdown(original, curriculum), /### Metodología y organización/);
  const research = { ...result, outline: [
    { id: 'customB', title: 'Second topic comes first', description: 'Specific researched instructions B', mandatory: false, sourceIds: [] },
    { id: 'customA', title: 'First topic comes second', description: 'Specific researched instructions A', mandatory: true, sourceIds: ['s1'] },
  ], researchedAt: '2026-10-19T00:00:00Z', curriculumVersionId: curriculum.id, purpose: 'classroom' as const, profile: curriculum.profile, contextFingerprint: 'fixture' };
  const adopted = applyProgrammeResearch(original, research, 1);
  assert.deepEqual(adopted.researchedSections?.map(item => item.id), ['customB', 'customA']);
  assert.equal(original.researchedSections?.length, 0);
  assert.match(programmeIssues(adopted, curriculum).join('\n'), /Completa: Second topic comes first/);
  adopted.researchedSections![0].text = 'Teacher-authored B';
  adopted.researchedSections![1].text = 'Teacher-authored A';
  const markdown = programmeMarkdown(adopted, curriculum);
  assert.ok(markdown.indexOf('### Second topic comes first') < markdown.indexOf('### First topic comes second'));
  assert.match(markdown, /Teacher-authored B/);
  assert.doesNotMatch(markdown, /### Metodología y organización/);
  assert.equal(applyProgrammeResearch(adopted, research, 1), adopted);
  const refreshed = applyProgrammeResearch(adopted, { ...research, outline: [research.outline[1], { id: 'newC', title: 'A genuinely new topic', description: 'New scope', mandatory: false, sourceIds: [] }] }, 2);
  assert.deepEqual(refreshed.researchedSections?.map(item => item.id), ['customA', 'newC']);
  assert.equal(refreshed.researchedSections![0].text, 'Teacher-authored A');
  assert.equal(refreshed.archivedSections![0].text, 'Teacher-authored B');
  assert.match(programmeMarkdown(refreshed, curriculum), /Textos anteriores sin asignar/);
  assert.match(programmeMarkdown(refreshed, curriculum), /Teacher-authored B/);
  const legacy = { ...original, researchedSections: undefined, researchRevision: undefined };
  legacy.sections.methodology = 'Existing legacy prose';
  assert.match(programmeMarkdown(legacy, curriculum), /Existing legacy prose/);
  const migrated = applyProgrammeResearch(legacy, research, 1);
  assert.ok(migrated.archivedSections?.some(item => item.text === 'Existing legacy prose'));
  assert.throws(() => applyProgrammeResearch(original, { ...research, purpose: 'opposition' }, 1), /no corresponde/);
});
test('HTTP programme responses expose independently persisted research and enforce web permissions', async context => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-research-http-'));
  const server = await crearServidor({ archivoAjustes: path.join(directory, 'settings.json'), carpetaDatosPorDefecto: path.join(directory, 'data'), codexUsageReader: async () => ({ windows: [], updatedAt: 0, unavailable: true }) });
  context.after(async () => { await server.cerrar(); await fs.rm(directory, { recursive: true, force: true }); });
  const { workflow, storage, subject, project } = await setup(directory);
  const store = await workflow.programmeProjects(subject.id).research(project.id, 'classroom', (await workflow.programmePlanningContext(subject.id, project.id, 'classroom')).fingerprint);
  await store.accept(result, 0, 'fixture');
  const base = `${server.url}/api/asignaturas/${subject.id}/programaciones/${project.id}`;
  const response = await (await fetch(base)).json() as any;
  assert.equal(response.research.result.profile.territory, 'Galicia');
  assert.equal(response.research.result.contextFingerprint, response.researchContextFingerprint);
  assert.equal((await (await fetch(base + '?purpose=opposition')).json() as any).research.result, undefined);
  await storage.actualizarAsignatura(subject.id, { permisos: { busquedaWeb: false } as any });
  assert.equal((await fetch(base + '/investigar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
});
