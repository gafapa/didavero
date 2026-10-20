import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { activeCurriculum, type CurriculumDraft, type CurriculumVersion } from '../shared/curriculum';
import { emptyProgramme, applyProgrammeResearch, programmeMarkdown, programmeIssues, type TeachingUnit, type TeachingActivity } from '../shared/teachingProgramme';
import { programmeReferenceElements, programmeUnitLabels, unitPlanningIssues, withActivityPlan } from '../shared/programmeUnits';
import { parseProgramme } from '../server/teachingProgrammeStore';
import { parseUnitProposal } from '../server/programmeUnitHelp';
import { Almacen } from '../server/store';
import { Flujo } from '../server/flujo';
import { Cola } from '../server/agents/cola';
import { crearServidor } from '../server/index';
import { normalizeProgrammeReferences } from '../server/programmeReferences';

function curriculumFixture(stage = 'fp-medio'): CurriculumDraft {
  const vocational = stage.startsWith('fp-');
  const element = (id: string, kind: CurriculumVersion['elements'][number]['kind'], code: string, parentId = '') => ({ id, kind, code, text: `Synthetic ${id}`, parentId, sourceId: 'source', locator: 'Synthetic fixture', excerpt: `Synthetic ${id}`, notes: '', reviewed: true });
  return { profile: { stage, territory: 'Galicia', academicYear: '2026-2027', subject: 'Synthetic planning subject', course: '1', scope: vocational ? 'module' : 'course', model: vocational ? 'vocational' : 'general', qualification: vocational ? 'Synthetic qualification' : '', moduleCode: vocational ? 'MP0001' : '' },
    sources: [{ id: 'source', title: 'Synthetic source', url: 'https://www.boe.es/fictional', origin: 'official', filename: '', publishedOn: '', applicableFrom: '', notes: '', reviewed: true }],
    elements: [element('r1', vocational ? 'learningOutcome' : 'specificCompetence', vocational ? 'RA1' : 'CE1'), element('ca1', 'assessmentCriterion', 'CA1.1', 'r1'), element('bc1', 'contentBlock', 'BC1'), element('c1', 'knowledge', 'C1.1', 'bc1'), element('r2', vocational ? 'learningOutcome' : 'specificCompetence', vocational ? 'RA2' : 'CE2'), element('ca2', 'assessmentCriterion', 'CA2.1', 'r2'), element('bc2', 'contentBlock', 'BC2'), element('c2', 'knowledge', 'C2.1', 'bc2')], links: [], completenessReviewed: true };
}
const activity = (): TeachingActivity => ({ id: 'a1', title: 'Synthetic activity', hours: 6, sessions: 2, description: 'Teacher demonstrates; learners build and justify a product.', objectives: 'Produce a fictional document.', evidence: 'An observable synthetic product.', instrument: 'Synthetic checklist.', resources: 'Synthetic classroom resources.', referentIds: [], criterionIds: ['ca1'], contentIds: ['c1'] });
const unit = (): TeachingUnit => ({ id: 'u1', title: 'Synthetic unit', hours: 6, sessions: 2, period: 'First term', referentIds: [], criterionIds: ['ca1'], contentIds: ['c1'], activities: 'Retain authored legacy text.', evidence: '', learningSituation: 'A fictional professional challenge and product.', activityPlan: [activity()] });
const research = { status: 'ready' as const, summary: 'Synthetic structure', contextSummary: '', outline: [{ id: 'method', title: 'Synthetic section', description: 'Synthetic guidance', mandatory: false, sourceIds: ['s1'] }], requirements: [], sources: [{ id: 's1', title: 'Synthetic official guidance', url: 'https://www.boe.es/fictional', kind: 'official' as const, publishedOn: '', locator: 'Synthetic fixture' }], questions: [] };

async function setup(context: TestContext, sourceTools = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-programme-units-'));
  const storage = new Almacen(path.join(directory, 'data')); await storage.iniciar();
  const subject = await storage.crearAsignatura({ nombre: 'Synthetic programme units', etapa: 'fp-medio', curso: '1', comunidad: 'Galicia' });
  const curricula = storage.curriculum(subject.id); await curricula.saveDraft(curriculumFixture(), 0); const curriculum = activeCurriculum(await curricula.activate(1))!;
  const queue = new Cola(1, path.join(directory, 'jobs'));
  const workflow = new Flujo({ almacen: () => storage, cola: queue, ajustes: () => ({ carpetaDatos: storage.raiz, maxSimultaneos: 1, motorPorDefecto: 'claude', asistenteCompletado: true, agentes: {} }), motoresListos: () => new Set(), ...(sourceTools ? { mcpFuentes: { comando: 'node', args: ['synthetic-source-server'] } } : {}) });
  context.after(async () => { queue.detenerTodo(); await queue.flush(); await fs.rm(directory, { recursive: true, force: true }); });
  const project = await workflow.programmeProjects(subject.id).create({ title: 'Synthetic programme', purpose: 'classroom', totalHours: 12, context: 'Synthetic context', requirements: '', selectionRequirements: '' });
  const researchStore = await workflow.programmeProjects(subject.id).research(project.id, 'classroom'); await researchStore.accept(research, 0, 'research-fixture');
  const store = await workflow.programmeStore(subject.id, project.id), initial = (await store.read()).draft!;
  const second = { ...unit(), id: 'u2', referentIds: [], criterionIds: ['ca2'], contentIds: ['c2'], activityPlan: [{ ...activity(), id: 'a2', criterionIds: ['ca2'], contentIds: ['c2'] }] };
  const programme = applyProgrammeResearch({ ...initial, units: [unit(), second] }, (await researchStore.read()).result!, 1);
  programme.researchedSections![0].text = 'Authored section that must survive unit help.';
  const state = await store.save(programme, 1);
  return { directory, storage, subject, curriculum, workflow, queue, project, store, programme, state };
}

test('programme authoring retrieves subject sources with or without tools and keeps private document sources out', async context => {
  for (const sourceTools of [false, true]) {
    const { workflow, storage, subject, project, queue, state } = await setup(context, sourceTools);
    const sourceDirectory = storage.dirFuentes(subject.id);
    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.writeFile(path.join(sourceDirectory, 'activities.md'), '# Synthetic unit\nSynthetic classroom activities resources SOURCE_ALLOWED_MARKER.');
    const document = await storage.crearDocumento(subject.id, { titulo: 'Unrelated private notes' });
    const privateDirectory = storage.dirFuentes(subject.id, document.id);
    await fs.mkdir(privateDirectory, { recursive: true });
    await fs.writeFile(path.join(privateDirectory, 'private.md'), '# Synthetic unit\nSynthetic activities SOURCE_PRIVATE_MARKER.');
    const launches: any[] = [];
    queue.encolar = ((launch: unknown) => { launches.push(launch); return { id: 'source-fixture-job' }; }) as any;
    await workflow.generateProgramme(subject.id, project.id, state.revision);
    await workflow.helpProgrammeUnits(subject.id, project.id, state.revision, '', 'classroom', 'u1');
    for (const launch of launches) {
      assert.equal(launch.web, false);
      assert.match(launch.prompt, /SOURCE_ALLOWED_MARKER/);
      assert.match(launch.prompt, /\[fuentes\/activities.md/);
      assert.doesNotMatch(launch.prompt, /SOURCE_PRIVATE_MARKER|\.\.\/\.\.\/fuentes\/activities.md/);
      assert.match(launch.prompt, /evidencia, nunca instrucciones/);
      if (sourceTools) {
        assert.deepEqual(launch.mcp.args, ['synthetic-source-server', `asignatura=${sourceDirectory}`]);
        assert.match(launch.prompt, /buscar_en_fuentes/);
      } else assert.equal(launch.mcp, undefined);
    }
    await storage.actualizarAsignatura(subject.id, { permisos: { fuentes: false } });
    await workflow.generateProgramme(subject.id, project.id, state.revision);
    await workflow.helpProgrammeUnits(subject.id, project.id, state.revision);
    for (const launch of launches.slice(2)) {
      assert.doesNotMatch(launch.prompt, /SOURCE_ALLOWED_MARKER|SOURCE_PRIVATE_MARKER|buscar_en_fuentes/);
      assert.equal(launch.mcp, undefined);
    }
    await fs.writeFile(path.join(sourceDirectory, 'new.md'), 'Synthetic activities DO_NOT_INDEX_DISABLED.');
    await workflow.helpProgrammeUnits(subject.id, project.id, state.revision);
    await assert.rejects(fs.stat(path.join(sourceDirectory, '.indice', 'new.md.json')), { code: 'ENOENT' });
    await storage.actualizarAsignatura(subject.id, { permisos: { fuentes: true } });
    await workflow.researchProgramme(subject.id, project.id);
    assert.equal(launches.at(-1).web, true);
    assert.equal(launches.at(-1).mcp, undefined);
    assert.doesNotMatch(launches.at(-1).prompt, /SOURCE_ALLOWED_MARKER|SOURCE_PRIVATE_MARKER/);
    await fs.unlink(path.join(sourceDirectory, 'activities.md'));
    await fs.unlink(path.join(sourceDirectory, 'new.md'));
    await workflow.generateProgramme(subject.id, project.id, state.revision);
    assert.equal(launches.at(-1).mcp, undefined);
    assert.doesNotMatch(launches.at(-1).prompt, /SOURCE_ALLOWED_MARKER|DO_NOT_INDEX_DISABLED/);
  }
});

test('stage-aware planning retains exact curriculum IDs and keeps RA/criteria separate from BC/content', () => {
  for (const stage of ['primaria', 'eso', 'bachillerato', 'fp-basica', 'fp-medio', 'fp-superior']) {
    const curriculum = { ...curriculumFixture(stage), id: 'version-fixture', activatedAt: '' };
    const programme = { ...emptyProgramme(curriculum), totalHours: 6, units: [unit()] };
    const parsed = parseProgramme(programme, curriculum);
    assert.deepEqual(parsed.units[0], programme.units[0]);
    assert.deepEqual(programmeReferenceElements(curriculum, unit()).map(element => element.id), ['r1', 'ca1', 'bc1', 'c1']);
    assert.equal(programmeUnitLabels(curriculum).vocational, stage.startsWith('fp-'));
    const markdown = programmeMarkdown(programme, curriculum);
    assert.match(markdown, /Synthetic ca1 \[ca1\]/);
    assert.match(markdown, /Synthetic bc1 \[bc1\]/);
    assert.match(markdown, /Synthetic checklist/);
    assert.equal(markdown.includes('Synthetic ca2'), false);
    assert.match(markdown, stage.startsWith('fp-') ? /Resultados de aprendizaje/ : /Competencias específicas/);
  }
});

test('AI proposals accept exact version-qualified references from prompts and reject other versions or guessed codes', () => {
  const curriculum = { ...curriculumFixture(), id: 'captured-version', activatedAt: '' }, programme = { ...emptyProgramme(curriculum), totalHours: 6, units: [unit()] };
  const qualified = structuredClone(programme);
  for (const entity of [qualified.units[0], ...qualified.units[0].activityPlan!]) for (const field of ['referentIds', 'criterionIds', 'contentIds'] as const) entity[field] = entity[field]!.map(id => `${curriculum.id}/${id}`);
  assert.deepEqual(parseProgramme(normalizeProgrammeReferences(qualified, curriculum), curriculum), programme);
  assert.deepEqual(parseUnitProposal({ units: qualified.units }, programme, curriculum), programme.units);
  const foreign = structuredClone(qualified); foreign.units[0].criterionIds = ['another-version/ca1'];
  assert.throws(() => parseProgramme(normalizeProgrammeReferences(foreign, curriculum), curriculum), /referencias/);
  const guessed = structuredClone(qualified); guessed.units[0].criterionIds = ['CA1'];
  assert.throws(() => parseProgramme(normalizeProgrammeReferences(guessed, curriculum), curriculum), /referencias/);
  assert.deepEqual(qualified.units[0].criterionIds, ['captured-version/ca1']);
  const listText = structuredClone(qualified) as any;
  listText.units[0].activityPlan[0].objectives = ['First objective.', 'Second objective.'];
  listText.units[0].activityPlan[0].resources = ['First resource.', 'Second resource.'];
  const parsed = parseProgramme(normalizeProgrammeReferences(listText, curriculum), curriculum);
  assert.equal(parsed.units[0].activityPlan![0].objectives, '- First objective.\n- Second objective.');
  assert.equal(parsed.units[0].activityPlan![0].resources, '- First resource.\n- Second resource.');
  listText.units[0].activityPlan[0].resources = ['A resource.', 42];
  assert.throws(() => parseProgramme(normalizeProgrammeReferences(listText, curriculum), curriculum), /Texto/);
});

test('activity validation rejects foreign IDs, wrong kinds, escaped scope, duplicate IDs and invalid sessions', () => {
  const curriculum = { ...curriculumFixture(), id: 'version', activatedAt: '' }, programme = { ...emptyProgramme(curriculum), units: [unit()] };
  for (const patch of [{ criterionIds: ['foreign'] }, { criterionIds: ['r1'] }, { criterionIds: ['ca2'] }, { contentIds: ['c2'] }, { sessions: -1 }, { sessions: 0.5 }]) {
    assert.throws(() => parseProgramme({ ...programme, units: [{ ...unit(), activityPlan: [{ ...activity(), ...patch }] }] }, curriculum));
  }
  assert.throws(() => parseProgramme({ ...programme, units: [{ ...unit(), activityPlan: [activity(), activity()] }] }, curriculum), /repetidas/);
  const expanded = withActivityPlan(unit(), [{ ...activity(), criterionIds: ['ca2'], contentIds: ['c2'] }]);
  assert.deepEqual(expanded.criterionIds, ['ca1', 'ca2']);
  assert.doesNotThrow(() => parseProgramme({ ...programme, units: [expanded] }, curriculum));
  assert.match(unitPlanningIssues({ ...unit(), activityPlan: [{ ...activity(), hours: 3, sessions: 1, criterionIds: [] }] }, curriculum).join(' '), /criterios.*horas|criterios|sesiones/);
});

test('competence context uses official descriptor links and the captured model for general Basic VET domains', () => {
  const curriculum = { ...curriculumFixture('primaria'), id: 'version', activatedAt: '' };
  const template = curriculum.elements[0];
  curriculum.elements.push({ ...template, id: 'descriptor', code: 'CCL1', kind: 'descriptor' }, { ...template, id: 'key', code: 'CCL', kind: 'keyCompetence' }, { ...template, id: 'teacher-descriptor', kind: 'descriptor' });
  curriculum.links = [
    { id: 'official1', fromId: 'r1', toId: 'descriptor', origin: 'official', sourceId: 'source', locator: 'Synthetic fixture', notes: '' },
    { id: 'official2', fromId: 'descriptor', toId: 'key', origin: 'official', sourceId: 'source', locator: 'Synthetic fixture', notes: '' },
    { id: 'teacher', fromId: 'r1', toId: 'teacher-descriptor', origin: 'teacher', sourceId: '', locator: '', notes: '' },
  ];
  const references = programmeReferenceElements(curriculum, unit()).map(element => element.id);
  assert.ok(references.includes('descriptor') && references.includes('key'));
  assert.equal(references.includes('teacher-descriptor'), false);
  assert.equal(programmeUnitLabels({ ...curriculum, profile: { ...curriculum.profile, stage: 'fp-basica' } }).vocational, false);
});

test('unit AI help creates a reviewable proposal, applies only its target once and preserves reviewed/authored copies', async context => {
  const { storage, subject, curriculum, workflow, project, store, programme } = await setup(context);
  assert.deepEqual(programmeIssues(programme, curriculum), []);
  const reviewed = await store.save(programme, 2, { confirmed: true });
  let launch: any;
  (workflow as any).lanzar = async (value: unknown) => { launch = value; return { id: 'unit-help-job' }; };
  await workflow.helpProgrammeUnits(subject.id, project.id, reviewed.revision, 'Synthetic preference', 'classroom', 'u1');
  assert.equal(launch.agente, 'arquitecto'); assert.equal(launch.web, false); assert.equal(launch.fuentes, true);
  assert.match(launch.tarea, /RA → CA y BC → C/);
  assert.equal(launch.tarea.includes('Synthetic ca2'), false, 'Single-unit help only includes its selected curriculum');
  assert.match(launch.tarea, /sesión equivale a una hora/);
  const proposed = { ...unit(), title: 'Proposed title', activityPlan: [{ ...activity(), description: 'Proposed synthetic activity' }] };
  const output = path.resolve(storage.dirAsignatura(subject.id), launch.post.datos.output);
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify({ units: [proposed] }));
  const job = { id: 'unit-help-job', asignatura: subject.id } as any;
  await (workflow as any).acceptProgrammeUnits(job, launch.post.datos);
  assert.deepEqual((await store.read()).draft, programme, 'Accepting a proposal never rewrites authored data');
  const applied = await workflow.applyProgrammeUnits(subject.id, project.id, 'classroom', job.id, reviewed.revision);
  assert.equal(applied.draft!.units[0].title, 'Proposed title');
  assert.deepEqual(applied.draft!.units[1], programme.units[1]);
  assert.deepEqual(applied.draft!.researchedSections, programme.researchedSections);
  assert.deepEqual(applied.reviewed, reviewed.reviewed);
  assert.equal((await workflow.applyProgrammeUnits(subject.id, project.id, 'classroom', job.id, reviewed.revision)).revision, applied.revision);
  assert.throws(() => parseUnitProposal({ units: [{ ...proposed, hours: 7 }] }, programme, curriculum, 'u1'), /horas/);
  assert.throws(() => parseUnitProposal({ units: [{ ...proposed, criterionIds: [], activityPlan: [] }] }, programme, curriculum, 'u1'), /conservar/);
  await assert.rejects(workflow.applyProgrammeUnits(subject.id, project.id, 'opposition', job.id, 0), /propuesta/);
});

test('late proposals and concurrent applies cannot replace newer teaching edits', async context => {
  const { workflow, subject, project, store, storage, programme } = await setup(context);
  let launch: any;
  (workflow as any).lanzar = async (value: unknown) => { launch = value; return { id: 'late-job' }; };
  await workflow.helpProgrammeUnits(subject.id, project.id, 2, '', 'classroom', 'u1');
  await store.save({ ...programme, title: 'Newer teacher edit' }, 2);
  const output = path.resolve(storage.dirAsignatura(subject.id), launch.post.datos.output);
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify({ units: [unit()] }));
  await (workflow as any).acceptProgrammeUnits({ id: 'late-job', asignatura: subject.id }, launch.post.datos);
  await assert.rejects(workflow.applyProgrammeUnits(subject.id, project.id, 'classroom', 'late-job', 3), /cambió/);
  assert.equal((await store.read()).draft!.title, 'Newer teacher edit');
  const proposalStore = await workflow.programmeUnitHelpStore(subject.id, project.id, 'classroom');
  await proposalStore.write({ jobId: 'concurrent', expectedRevision: 3, curriculumVersionId: programme.curriculumVersionId, purpose: 'classroom', unitId: 'u1', units: [unit()], createdAt: '' });
  const results = await Promise.allSettled([workflow.applyProgrammeUnits(subject.id, project.id, 'classroom', 'concurrent', 3), workflow.applyProgrammeUnits(subject.id, project.id, 'classroom', 'concurrent', 3)]);
  assert.ok(results.some(result => result.status === 'fulfilled'));
  assert.equal((await store.read()).revision, 4);
});

test('full-sequence help reuses the full curriculum and only replaces units after explicit application', async context => {
  const { workflow, subject, project, store, storage, programme, curriculum } = await setup(context);
  let launch: any;
  (workflow as any).lanzar = async (value: unknown) => { launch = value; return { id: 'sequence-job' }; };
  await workflow.helpProgrammeUnits(subject.id, project.id, 2);
  assert.match(launch.tarea, /Synthetic ca2/);
  assert.match(launch.tarea, /exactamente 12 horas/);
  assert.equal(launch.post.datos.unitId, undefined);
  assert.throws(() => parseUnitProposal({ units: [unit()] }, programme, curriculum), /horas del curso/);
  const units = programme.units.map(item => ({ ...item, title: `Proposed ${item.title}` }));
  const output = path.resolve(storage.dirAsignatura(subject.id), launch.post.datos.output);
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify({ units }));
  await (workflow as any).acceptProgrammeUnits({ id: 'sequence-job', asignatura: subject.id }, launch.post.datos);
  assert.deepEqual((await store.read()).draft, programme);
  const applied = await workflow.applyProgrammeUnits(subject.id, project.id, 'classroom', 'sequence-job', 2);
  assert.deepEqual(applied.draft!.units, units);
  assert.deepEqual(applied.draft!.sections, programme.sections);
  assert.deepEqual(applied.draft!.researchedSections, programme.researchedSections);
});

test('unit help HTTP endpoints return proposals and reject malformed or stale requests without launching real AI', async context => {
  const { directory, subject, project, programme } = await setup(context);
  const server = await crearServidor({ archivoAjustes: path.join(directory, 'http-settings.json'), carpetaDatosPorDefecto: path.join(directory, 'data'), dirTrabajos: path.join(directory, 'http-jobs'), codexUsageReader: async () => ({ windows: [], updatedAt: 0, unavailable: true }) });
  try {
    const base = `${server.url}/api/asignaturas/${subject.id}/programaciones/${project.id}`;
    const post = (suffix: string, body: unknown) => fetch(base + suffix, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post('/ayuda-unidades', { expectedRevision: 0 })).status, 409);
    assert.equal((await post('/ayuda-unidades', { expectedRevision: 2, unitId: 12 })).status, 400);
    const response = await (await fetch(base)).json() as any; assert.equal(response.state.draft.units[0].activityPlan[0].criterionIds[0], 'ca1');
    const proposalPath = path.join(directory, 'data', subject.id, 'programaciones', project.id, 'unit-proposal-classroom.json');
    await fs.writeFile(proposalPath, JSON.stringify({ jobId: 'http-proposal', expectedRevision: 2, curriculumVersionId: programme.curriculumVersionId, purpose: 'classroom', unitId: 'u1', units: [unit()], createdAt: '' }));
    assert.equal(((await (await fetch(base)).json()) as any).unitProposal.jobId, 'http-proposal');
    assert.equal((await post('/ayuda-unidades/aplicar', { jobId: 'http-proposal', expectedRevision: 2 })).status, 200);
    assert.equal(((await (await fetch(base)).json()) as any).unitProposal.applied, true);
    assert.equal((await post('/ayuda-unidades/aplicar', { jobId: 'unknown', expectedRevision: 3 })).status, 400);
    const damaged = JSON.stringify({ jobId: 'damaged', expectedRevision: 3, curriculumVersionId: programme.curriculumVersionId, purpose: 'classroom', units: [{ ...unit(), activityPlan: 'corrupt' }], createdAt: '' });
    await fs.writeFile(proposalPath, damaged);
    assert.equal((await fetch(base)).status, 409);
    assert.equal(await fs.readFile(proposalPath, 'utf8'), damaged);
  } finally { await server.cerrar(); }
});
