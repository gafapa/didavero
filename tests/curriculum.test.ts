import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CurriculumStore, parseCurriculumDraft } from '../server/curriculumStore';
import { activeCurriculum, moveCurriculumElement, curriculumIssues, curriculumHierarchy, curriculumElementLabels, curriculumParentOptions, curriculumProfileFromContext, curriculumPromptText, isOfficialCurriculumUrl, removeCurriculumSource, type CurriculumDraft, type CurriculumElement } from '../shared/curriculum';
import { Almacen } from '../server/store';
import { Cola } from '../server/agents/cola';
import { Flujo } from '../server/flujo';
import { crearServidor } from '../server/index';
import { reviewCurriculumExtraction, CurriculumNeedsInformation } from '../server/curriculumExtractionReview';
import { curriculumExtractionTask } from '../server/curriculumExtraction';

async function temporary(context: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-curriculum-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function fixture(): CurriculumDraft {
  return {
    profile: { stage: 'eso', territory: 'Galicia', academicYear: '2026-2027', subject: 'Fictional subject', course: '1', scope: 'course', model: 'general', qualification: '', moduleCode: '' },
    sources: [{ id: 's1', title: 'Fictional norm for testing only', url: 'https://www.boe.es/fictional-fixture', origin: 'official', filename: '', publishedOn: '2026-01-01', applicableFrom: '2026-2027', notes: '', reviewed: true }],
    elements: [
      { id: 'competence1', kind: 'specificCompetence', code: '1', text: 'Fictional competence.', parentId: '', sourceId: 's1', locator: 'Fictional annex 1', excerpt: 'Fictional competence.', notes: '', reviewed: true },
      { id: 'criterion1', kind: 'assessmentCriterion', code: '1.1', text: 'Fictional criterion.', parentId: 'competence1', sourceId: 's1', locator: 'Fictional annex 2', excerpt: 'Fictional criterion.', notes: '', reviewed: true },
    ], links: [], completenessReviewed: true,
  };
}

test('moved curriculum order and parents survive reloading without changing the active version', async context => {
  const directory = await temporary(context), store = new CurriculumStore(directory), draft = fixture();
  draft.elements.push({ ...draft.elements[0], id: 'competence2', code: '2' }, { ...draft.elements[1], id: 'criterion2', code: '2.1', parentId: 'competence2' });
  await store.saveDraft(draft, 0);
  const activated = await store.activate(1), snapshot = structuredClone(activeCurriculum(activated));
  const reordered = moveCurriculumElement(draft, 'competence2', '', 'competence1');
  const moved = moveCurriculumElement(reordered, 'criterion2', 'competence1', 'criterion1');
  await store.saveDraft(moved, activated.revision);
  const reloaded = await new CurriculumStore(directory).read();
  assert.deepEqual(reloaded.draft!.elements.map(item => item.id), moved.elements.map(item => item.id));
  assert.equal(reloaded.draft!.elements.find(item => item.id === 'criterion2')!.parentId, 'competence1');
  assert.equal(reloaded.draft!.elements.find(item => item.id === 'criterion2')!.reviewed, false);
  assert.deepEqual(activeCurriculum(reloaded), snapshot);
  await assert.rejects(store.saveDraft(draft, activated.revision), { statusCode: 409 });
});

function auditedFixture(draft = fixture()) {
  const groups = new Map<string, { kind: string; parentId: string; sourceId: string; locator: string; expectedCount: number }>();
  for (const element of draft.elements) {
    const key = JSON.stringify([element.kind, element.parentId, element.sourceId]);
    const group = groups.get(key) ?? { kind: element.kind, parentId: element.parentId, sourceId: element.sourceId, locator: element.locator, expectedCount: 0 };
    group.expectedCount++; groups.set(key, group);
  }
  return { ...structuredClone(draft), resolvedModuleCode: '', audit: { status: 'complete', questions: [] as string[], inventory: [...groups.values()],
    content: { status: draft.elements.some((element) => element.kind === 'knowledge') ? 'published' : 'notPublished', sourceId: 's1', locator: 'Fictional annex',
      explanation: 'This fictional fixture deliberately contains no published knowledge section.' } } };
}

test('extraction review rejects missing source groups, omissions and invalid hierarchy before creating a draft', () => {
  assert.throws(() => reviewCurriculumExtraction(fixture(), fixture().profile), /inventario/);
  const draft = fixture();
  const content = (id: string, kind: CurriculumElement['kind'], parentId: string): CurriculumElement => ({ ...draft.elements[0], id, kind, parentId, code: '', text: `Fictional ${id}`, excerpt: `Fictional ${id}` });
  draft.elements.push(content('block', 'contentBlock', ''), content('k1', 'knowledge', 'block'), content('k2', 'knowledge', 'block'));
  const valid = auditedFixture(draft);
  assert.equal(reviewCurriculumExtraction(valid, draft.profile).elements.length, 5);
  const missing = structuredClone(valid); missing.elements = missing.elements.filter((element) => element.id !== 'k2');
  assert.throws(() => reviewCurriculumExtraction(missing, draft.profile), /espera 2/);
  const uninventoried = structuredClone(valid); uninventoried.audit.inventory = uninventoried.audit.inventory.filter((group) => group.kind !== 'knowledge');
  assert.throws(() => reviewCurriculumExtraction(uninventoried, draft.profile), /sin inventariar/);
  const duplicate = structuredClone(valid); duplicate.audit.inventory.push(duplicate.audit.inventory[0]);
  assert.throws(() => reviewCurriculumExtraction(duplicate, draft.profile), /grupos repetidos/);
  const invalid = structuredClone(valid); invalid.elements.find((element) => element.id === 'k1')!.parentId = 'competence1';
  assert.throws(() => reviewCurriculumExtraction(invalid, draft.profile), /Vincula el contenido/);
  const omittedContent = auditedFixture(); omittedContent.audit.content.status = 'published';
  assert.throws(() => reviewCurriculumExtraction(omittedContent, fixture().profile), /faltan sus bloques/);
  const unreviewed = auditedFixture(); unreviewed.sources[0].reviewed = false; unreviewed.elements.forEach((element) => { element.reviewed = false; });
  const result = reviewCurriculumExtraction(unreviewed, fixture().profile);
  assert.equal(result.completenessReviewed, false);
  assert.match(result.sources[0].notes, /Pendiente de contraste docente/);
});

test('extraction requests missing information instead of fabricating content and resolves only unknown module codes', () => {
  assert.throws(() => reviewCurriculumExtraction({ audit: { status: 'needsInformation', questions: ['Which qualification applies?'] } }, fixture().profile), CurriculumNeedsInformation);
  const draft = fixture();
  draft.profile = { ...draft.profile, model: 'vocational', qualification: 'Fictional qualification', moduleCode: '' };
  draft.elements[0].kind = 'learningOutcome';
  const input = { ...auditedFixture(draft), resolvedModuleCode: 'MP0000' };
  assert.equal(reviewCurriculumExtraction(input, draft.profile).profile.moduleCode, 'MP0000');
  assert.equal(reviewCurriculumExtraction(input, { ...draft.profile, moduleCode: 'MP0001' }).profile.moduleCode, 'MP0001');
  const task = curriculumExtractionTask(draft.profile, '.agentes/fixture.json');
  assert.match(task, /INVENTARIAR ANTES DE TRANSCRIBIR/);
  assert.match(task, /"kind":"learningOutcome"/);
  assert.match(task, /"audit":/);
  assert.match(task, /no traduzcas/i);
});

test('identified curriculum with pending applicability becomes an unreviewed draft without bypassing completeness checks', async (context) => {
  const input = { ...auditedFixture(), audit: { ...auditedFixture().audit, status: 'reviewRequired', questions: ['Confirm transitional applicability for the requested academic year.'] } };
  const reviewed = reviewCurriculumExtraction(input, fixture().profile);
  assert.equal(reviewed.elements.length, fixture().elements.length);
  assert.equal(reviewed.completenessReviewed, false);
  assert.ok(reviewed.elements.every((element) => !element.reviewed));
  assert.ok(reviewed.sources.every((source) => !source.reviewed));
  assert.match(reviewed.sources[0].notes, /Pendiente de verificar la aplicabilidad al curso 2026-2027/);
  assert.match(reviewed.sources[0].notes, /Confirm transitional applicability/);
  assert.throws(() => reviewCurriculumExtraction({ ...input, audit: { ...input.audit, questions: [] } }, fixture().profile), /aplicación temporal/);
  assert.throws(() => reviewCurriculumExtraction({ ...input, elements: [] }, fixture().profile));
  const missing = structuredClone(input); missing.elements.pop();
  assert.throws(() => reviewCurriculumExtraction(missing, fixture().profile), /criterios de evaluación/);
  const mismatch = structuredClone(input); mismatch.audit.inventory[0].expectedCount++;
  assert.throws(() => reviewCurriculumExtraction(mismatch, fixture().profile), /Inventario incompleto/);
  const directory = await temporary(context);
  const store = new CurriculumStore(directory);
  await store.acceptExtraction(reviewed, 0, 'pending-applicability');
  await assert.rejects(store.activate(1), /Revisa el currículo/);
  assert.equal((await store.read()).draft?.elements.length, 2);
  assert.equal((await store.read()).activeVersionId, undefined);
});

test('compact extraction restores repeated fields locally without weakening provenance checks', () => {
  const original = auditedFixture();
  original.elements[0].text = original.elements[0].excerpt = 'Fictional literal normative passage. '.repeat(100).trim();
  const compact = { ...original,
    sources: original.sources.map(({ origin, filename, notes, reviewed, ...source }) => source),
    elements: original.elements.map(({ excerpt, notes, reviewed, ...element }) => element),
  };
  const result = reviewCurriculumExtraction(compact, original.profile);
  assert.deepEqual(result.elements.map((element) => [element.id, element.text, element.excerpt, element.locator]),
    original.elements.map((element) => [element.id, element.text, element.excerpt, element.locator]));
  assert.equal(result.sources[0].origin, 'official');
  assert.equal(result.elements[0].reviewed, false);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(original).length * 0.7);
  const mismatched = { ...compact, elements: compact.elements.map((element, index) => ({ ...element, excerpt: index ? element.text : 'Different source text' })) };
  assert.throws(() => reviewCurriculumExtraction(mismatched, original.profile), /no coincide/);
  assert.throws(() => reviewCurriculumExtraction({ ...compact, audit: undefined }, original.profile), /inventario/);
  assert.throws(() => parseCurriculumDraft(compact), /Campo de currículo|Tipo de currículo/);
  assert.ok(curriculumExtractionTask(original.profile, '.agentes/result.json').length < 5200);
});

test('unnumbered content gets local outline labels without changing official codes or snapshots', () => {
  const draft = fixture();
  const create = (id: string, kind: CurriculumElement['kind'], parentId = '', code = ''): CurriculumElement =>
    ({ ...draft.elements[0], id, kind, parentId, code, text: id, excerpt: id });
  draft.elements.push(create('b1', 'contentBlock', '', 'BC1'), create('k1', 'knowledge', 'b1'),
    create('b11', 'contentBlock', 'b1'), create('k11', 'knowledge', 'b11'), create('b2', 'contentBlock'), create('k2', 'knowledge', 'b2', 'Official-K'));
  const snapshot = JSON.stringify(draft);
  const labels = curriculumElementLabels(draft.elements);
  assert.deepEqual(['b1', 'k1', 'b11', 'k11', 'b2', 'k2'].map((id) => labels.get(id)), ['BC1', '1.1', '1.2', '1.2.1', '2', 'Official-K']);
  assert.equal(JSON.stringify(draft), snapshot);
  assert.deepEqual(curriculumHierarchy(draft.elements, '1.2.1').map((row) => row.element.id), ['b1', 'b11', 'k11']);
  const rendered = curriculumPromptText({ ...draft, id: 'v1', activatedAt: '2026-10-17' });
  assert.match(rendered, /Contenido \/ saber 1\.2\.1/);
  assert.match(rendered, /numeración local de organización/);
});

test('removing the first or last source preserves content and requires provenance review', async (context) => {
  const draft = fixture();
  draft.sources.push({ ...draft.sources[0], id: 's2', title: 'Second fictional norm' });
  draft.links.push({ id: 'l1', fromId: 'competence1', toId: 'criterion1', sourceId: 's1', origin: 'official', locator: 'Fictional link location', notes: 'Original link notes' });
  const snapshot = JSON.stringify(draft);
  const detached = removeCurriculumSource(draft, 's1');
  assert.deepEqual(detached.sources.map((source) => source.id), ['s2']);
  assert.ok(detached.elements.every((element) => !element.sourceId && !element.reviewed));
  assert.equal(detached.links[0].sourceId, '');
  assert.deepEqual(detached.elements.map(({ sourceId, reviewed, ...element }) => element), draft.elements.map(({ sourceId, reviewed, ...element }) => element));
  assert.equal(detached.links[0].notes, draft.links[0].notes);
  assert.equal(detached.completenessReviewed, false);
  assert.ok(curriculumIssues(detached).some((issue) => /fuente/.test(issue.message)));
  assert.equal(JSON.stringify(draft), snapshot);

  const reassigned = removeCurriculumSource(draft, 's1', 's2');
  assert.ok(reassigned.elements.every((element) => element.sourceId === 's2' && !element.reviewed));
  assert.equal(reassigned.links[0].sourceId, 's2');
  assert.equal(reassigned.sources[0].reviewed, false);
  assert.ok(curriculumIssues(reassigned).length > 0);
  reassigned.completenessReviewed = true;
  reassigned.sources.forEach((source) => { source.reviewed = true; });
  reassigned.elements.forEach((element) => { element.reviewed = true; });
  assert.deepEqual(curriculumIssues(reassigned), []);
  assert.throws(() => removeCurriculumSource(draft, 's1', 's1'), /otra fuente válida/);
  assert.throws(() => removeCurriculumSource(draft, 's1', 'missing'), /otra fuente válida/);
  assert.throws(() => removeCurriculumSource(draft, 'missing'), /ya no existe/);
  assert.deepEqual(removeCurriculumSource(fixture(), 's1').sources, []);

  const directory = await temporary(context);
  const store = new CurriculumStore(directory);
  await store.saveDraft(draft, 0);
  const activated = await store.activate(1);
  const version = JSON.stringify(activeCurriculum(activated));
  const saved = await store.saveDraft(detached, 2);
  assert.equal(saved.draft!.sources[0].id, 's2');
  assert.equal(JSON.stringify(activeCurriculum(saved)), version);
  await assert.rejects(store.activate(3), /Revisa el currículo/);
  assert.equal(JSON.stringify(activeCurriculum(await store.read())), version);
});

test('new searches inherit Context fields without changing saved profiles or curriculum-specific options', () => {
  const previous = fixture().profile;
  const context = { ...previous, stage: 'primaria', subject: 'Matemáticas', territory: 'Canarias', course: '3', qualification: '' };
  const inherited = curriculumProfileFromContext({ ...previous, scope: 'cycle', academicYear: '2027-2028' }, context);
  assert.equal(inherited.subject, 'Matemáticas');
  assert.equal(inherited.territory, 'Canarias');
  assert.equal(inherited.stage, 'primaria');
  assert.equal(inherited.course, '2.º ciclo de Primaria');
  assert.equal(inherited.academicYear, '2027-2028');
  assert.equal(previous.territory, 'Galicia');
  assert.equal(previous.course, '1');
});

test('activation requires provenance, matching quotations, review, complete profiles and valid parent relationships', () => {
  assert.deepEqual(curriculumIssues(fixture()), []);
  const draft = fixture();
  draft.elements[1].parentId = '';
  draft.elements[1].excerpt = 'Different text.';
  draft.elements[1].reviewed = false;
  draft.sources[0].url = 'https://boe.es.evil.invalid/';
  draft.completenessReviewed = false;
  assert.equal(curriculumIssues(draft).length, 6);
  assert.equal(isOfficialCurriculumUrl('https://www.boe.es/test'), true);
  assert.equal(isOfficialCurriculumUrl('https://user:password@www.boe.es/test'), false);
  assert.equal(isOfficialCurriculumUrl('javascript:alert(1)'), false);
  const duplicated = fixture();
  duplicated.elements.push({ ...duplicated.elements[1], id: 'different' });
  assert.ok(curriculumIssues(duplicated).some((issue) => /duplicado/.test(issue.message)));
  assert.throws(() => parseCurriculumDraft({ ...fixture(), sources: null }), /Lista/);
  assert.throws(() => parseCurriculumDraft({ ...fixture(), elements: [fixture().elements[0], fixture().elements[0]] }), /identificadores/);
  const cycle = fixture(); cycle.elements[0].parentId = 'criterion1';
  assert.ok(curriculumIssues(cycle).some((issue) => /circular/.test(issue.message)));
});

test('vocational modules use RA parents while general Basic VET areas use specific competences', () => {
  const draft = fixture();
  draft.profile = { ...draft.profile, stage: 'fp-basica' };
  assert.deepEqual(curriculumIssues(draft), []);
  draft.profile.model = 'vocational';
  draft.profile.scope = 'module';
  draft.profile.qualification = 'Fictional qualification'; draft.profile.moduleCode = 'MP0000';
  assert.ok(curriculumIssues(draft).some((issue) => /resultado de aprendizaje/.test(issue.message)));
  draft.elements[0].kind = 'learningOutcome';
  assert.deepEqual(curriculumIssues(draft), []);
  draft.links = [{ id: 'link1', fromId: 'competence1', toId: 'criterion1', origin: 'official', sourceId: '', locator: '', notes: '' }];
  assert.ok(curriculumIssues(draft).some((issue) => /relación oficial/.test(issue.message)));
  draft.links[0].origin = 'teacher';
  assert.deepEqual(curriculumIssues(draft), []);
});

test('RA criteria and content blocks form independent hierarchies with scoped codes and nested content', async (context) => {
  const draft = fixture();
  draft.profile = { ...draft.profile, model: 'vocational', stage: 'fp-medio', scope: 'module', qualification: 'Fictional qualification', moduleCode: 'MP0000' };
  draft.elements[0].kind = 'learningOutcome';
  const create = (id: string, kind: CurriculumElement['kind'], text: string, parentId = '', code = ''): CurriculumElement =>
    ({ ...draft.elements[0], id, kind, text, excerpt: text, parentId, code });
  const secondOutcome = create('ra2', 'learningOutcome', 'Second fictional outcome', '', '2');
  const secondCriterion = create('criterion2', 'assessmentCriterion', 'Second fictional criterion', 'ra2', draft.elements[1].code);
  const block = create('block1', 'contentBlock', 'Fictional content block');
  const content = create('content1', 'knowledge', 'First fictional content', 'block1');
  const subblock = create('subblock1', 'contentBlock', 'Fictional subblock', 'block1');
  const nestedContent = create('content2', 'knowledge', 'Nested fictional content', 'subblock1');
  draft.elements.push(secondCriterion, content, nestedContent, block, secondOutcome, subblock);
  assert.deepEqual(curriculumIssues(draft), []);
  assert.equal(parseCurriculumDraft(draft).elements.find((element) => element.id === 'block1')!.kind, 'contentBlock');
  assert.deepEqual(curriculumParentOptions(content, draft.elements, 'vocational').map((element) => element.id), ['block1', 'subblock1']);
  assert.deepEqual(curriculumParentOptions(block, draft.elements, 'vocational'), []);
  assert.deepEqual(curriculumParentOptions(secondCriterion, draft.elements, 'vocational').map((element) => element.id), ['competence1', 'ra2']);
  assert.deepEqual(curriculumHierarchy(draft.elements).map((row) => [row.element.id, row.depth]), [
    ['competence1', 0], ['criterion1', 1], ['block1', 0], ['content1', 1], ['subblock1', 1], ['content2', 2], ['ra2', 0], ['criterion2', 1],
  ]);
  assert.deepEqual(curriculumHierarchy(draft.elements, 'Nested fictional content').map((row) => row.element.id), ['block1', 'subblock1', 'content2']);
  const directory = await temporary(context);
  const store = new CurriculumStore(directory);
  await store.saveDraft(draft, 0);
  const activated = await store.activate(1);
  const text = curriculumPromptText(activeCurriculum(activated)!);
  assert.match(text, /### Criterio de evaluación/);
  assert.match(text, /#### Contenido \/ saber/);
  assert.match(text, /Elemento superior: Bloque de contenidos \/ saberes/);
  const invalid = structuredClone(draft);
  invalid.elements.find((element) => element.id === content.id)!.parentId = 'ra2';
  assert.ok(curriculumIssues(invalid).some((issue) => /Vincula el contenido/.test(issue.message)));
  invalid.elements.find((element) => element.id === block.id)!.parentId = 'ra2';
  assert.ok(curriculumIssues(invalid).some((issue) => /no corresponde a su jerarquía/.test(issue.message)));
});

test('only activated structured versions reach teaching flows; old files are ignored', async (context) => {
  const directory = await temporary(context);
  const store = new CurriculumStore(directory);
  await fs.writeFile(path.join(directory, 'curriculo.md'), '# Obsolete fictional curriculum\n');
  assert.equal(await store.promptText(), '');
  await store.acceptExtraction(fixture(), 0, 'job1');
  assert.equal(await store.promptText(), '');
  await assert.rejects(store.activate(1), /Revisa/);
  let state = await store.saveDraft(fixture(), 1);
  state = await store.activate(state.revision);
  const first = activeCurriculum(state)!;
  assert.match(await store.promptText(), /Fictional criterion/);
  assert.match(await store.promptText(), new RegExp(`${first.id}/criterion1`));
  assert.doesNotMatch(await store.promptText(), /Obsolete fictional/);
  const next = fixture(); next.elements[1].text = next.elements[1].excerpt = 'Updated fictional criterion.';
  state = await store.saveDraft(next, state.revision);
  assert.doesNotMatch(await store.promptText(), /Updated fictional/);
  state = await store.activate(state.revision);
  assert.equal(state.versions.length, 2);
  assert.equal(state.versions[0].elements[1].text, 'Fictional criterion.');
  state = await store.restoreDraft(first.id, state.revision);
  assert.equal(state.draft!.elements[1].text, 'Fictional criterion.');
  assert.match(await store.promptText(), /Updated fictional/);
  await store.discardDraft(state.revision);
  assert.equal((await store.read()).draft, undefined);
});

test('global review activates edited content atomically and retains structural and revision checks', async (context) => {
  const directory = await temporary(context);
  const store = new CurriculumStore(directory);
  await store.saveDraft(fixture(), 0);
  const initial = await store.activate(1);
  const original = structuredClone(initial.versions[0]);
  const draft = fixture();
  draft.completenessReviewed = false;
  draft.sources.forEach((source) => { source.reviewed = false; source.notes = 'Pendiente de verificar la aplicación temporal.'; });
  draft.elements.forEach((element) => { element.reviewed = false; });
  const saved = await store.saveDraft(draft, 2);
  for (const confirmed of [false, 'true', undefined]) {
    await assert.rejects(store.activate(3, { draft, confirmed }), /Confirma la revisión global/);
    assert.deepEqual(await store.read(), saved);
  }
  const broken = structuredClone(draft); broken.elements[1].sourceId = 'missing';
  await assert.rejects(store.activate(3, { draft: broken, confirmed: true }), /fuente/i);
  assert.deepEqual(await store.read(), saved);
  await assert.rejects(store.activate(2, { draft, confirmed: true }), /ha cambiado/);
  const edited = structuredClone(draft);
  edited.elements[1].text = edited.elements[1].excerpt = 'Unsaved fictional edit included in activation.';
  const activated = await store.activate(3, { draft: edited, confirmed: true });
  assert.equal(activated.revision, 4);
  assert.equal(activated.draft, undefined);
  assert.equal(activated.versions.length, 2);
  assert.deepEqual(activated.versions[0], original);
  const active = activeCurriculum(activated)!;
  assert.equal(active.reviewMethod, 'global');
  assert.equal(active.elements[1].text, edited.elements[1].text);
  assert.equal(active.completenessReviewed, true);
  assert.ok(active.elements.every((element) => element.reviewed));
  assert.ok(active.sources.every((source) => source.reviewed));
  assert.equal(active.sources[0].notes, draft.sources[0].notes);
  assert.equal(edited.elements[0].reviewed, false);
  assert.deepEqual(await store.read(), activated);
});

test('concurrent edits reject stale writes; duplicate extraction receipts are idempotent', async (context) => {
  const directory = await temporary(context);
  const first = new CurriculumStore(directory), second = new CurriculumStore(directory);
  const results = await Promise.allSettled([first.saveDraft(fixture(), 0), second.saveDraft(fixture(), 0)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.statusCode, 409);
  await assert.rejects(first.acceptExtraction(fixture(), 0, 'late'), { statusCode: 409 });
  assert.equal((await first.read()).draft!.completenessReviewed, true);
  const jobs = await Promise.all([first.acceptExtraction(fixture(), 1, 'job'), second.acceptExtraction(fixture(), 1, 'job')]);
  assert.equal(jobs[0].revision, jobs[1].revision);
  assert.equal((await first.read()).appliedJobs.filter((job) => job === 'job').length, 1);
  assert.equal((await first.read()).draft!.completenessReviewed, false);
  assert.ok((await first.read()).draft!.sources.every((source) => !source.reviewed));
  assert.ok((await first.read()).draft!.elements.every((element) => !element.reviewed));
});

test('damaged structured storage fails closed', async (context) => {
  const directory = await temporary(context);
  const store = new CurriculumStore(directory);
  await store.saveDraft(fixture(), 0);
  const filename = path.join(directory, 'curriculum', 'state.json');
  await fs.writeFile(filename, '{broken');
  await assert.rejects(store.promptText(), { statusCode: 500 });
  await assert.rejects(store.saveDraft(fixture(), 1), /No se puede leer/);
  assert.equal(await fs.readFile(filename, 'utf8'), '{broken');
});

test('curriculum agent writes a pending proposal, preserving the captured revision and profile', async (context) => {
  const directory = await temporary(context);
  const storage = new Almacen(path.join(directory, 'data')); await storage.iniciar();
  const subject = await storage.crearAsignatura({ nombre: 'Fictional subject', etapa: 'eso', curso: '1', comunidad: 'Galicia' });
  const queue = new Cola(1, path.join(directory, 'jobs'));
  const workflow = new Flujo({ almacen: () => storage, cola: queue, ajustes: () => ({ carpetaDatos: storage.raiz, maxSimultaneos: 1, motorPorDefecto: 'claude', asistenteCompletado: true, agentes: {} }), motoresListos: () => new Set() });
  let launch: any;
  (workflow as any).lanzar = async (value: unknown) => { launch = value; return { id: 'job-fixture' }; };
  await workflow.buscarCurriculo(subject.id, undefined, { profile: fixture().profile });
  assert.match(launch.tarea, /no fabriques/i);
  assert.equal(launch.fuentes, false);
  const output = path.join(storage.dirAsignatura(subject.id), launch.post.datos.output);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(fixture()));
  await assert.rejects((workflow as any).postStructuredCurriculum({ id: 'job-fixture', asignatura: subject.id }, launch.post.datos), /necesita correcciones/);
  assert.equal((await storage.curriculum(subject.id).read()).revision, 0);
  await fs.writeFile(output, JSON.stringify({ audit: { status: 'needsInformation', questions: ['Fictional missing plan?'] } }));
  await assert.rejects((workflow as any).postStructuredCurriculum({ id: 'job-fixture', asignatura: subject.id }, launch.post.datos), /Falta información/);
  assert.equal((await storage.curriculum(subject.id).read()).draft, undefined);
  await fs.writeFile(output, JSON.stringify({ ...auditedFixture(), profile: { subject: 'Untrusted model profile' } }));
  await (workflow as any).postStructuredCurriculum({ id: 'job-fixture', asignatura: subject.id }, launch.post.datos);
  const state = await storage.curriculum(subject.id).read();
  assert.equal(state.draft!.profile.subject, 'Fictional subject');
  assert.equal(state.draft!.elements[0].reviewed, false);
  assert.equal(await storage.curriculumPrompt(subject.id), '');
  await assert.rejects(workflow.buscarCurriculo(subject.id), /Ya hay un borrador/);
});

test('HTTP endpoints expose only structured curricula and enforce revisions and activation', async (context) => {
  const directory = await temporary(context);
  const server = await crearServidor({ archivoAjustes: path.join(directory, 'settings.json'), carpetaDatosPorDefecto: path.join(directory, 'data'), codexUsageReader: async () => ({ windows: [], updatedAt: 0, unavailable: true }) });
  try {
    const storage = new Almacen(path.join(directory, 'data'));
    const subject = await storage.crearAsignatura({ nombre: 'Fictional HTTP subject', etapa: 'eso', curso: '1' });
    const base = `${server.url}/api/asignaturas/${subject.id}/curriculo`;
    const request = (method: string, suffix: string, body?: unknown) => fetch(base + suffix, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const emptyResponse = await request('GET', '');
    const empty = await emptyResponse.json() as any;
    assert.equal(emptyResponse.status, 200, JSON.stringify(empty));
    assert.equal(empty.state.revision, 0);
    assert.equal(empty.suggestedProfile.subject, 'Fictional HTTP subject');
    assert.equal(Object.hasOwn(empty, 'contenido'), false);
    assert.equal(Object.hasOwn(empty, 'legacy'), false);
    assert.equal((await request('PUT', '', { draft: { sources: null }, expectedRevision: 0 })).status, 400);
    assert.equal((await request('PUT', '', { draft: fixture(), expectedRevision: 0 })).status, 200);
    assert.equal((await request('PUT', '', { draft: fixture(), expectedRevision: 0 })).status, 409);
    assert.equal((await request('POST', '/activar', { expectedRevision: 1 })).status, 200);
    const structured = await (await request('GET', '')).json() as any;
    assert.equal(structured.state.versions.length, 1);
    assert.equal((await request('PUT', '', { contenido: 'Obsolete text payload' })).status, 400);
    assert.equal((await request('GET', '/estructura')).status, 404);
    assert.equal((await request('POST', '/restaurar', { versionId: 'missing', expectedRevision: 2 })).status, 404);
    const pending = fixture(); pending.elements.forEach((element) => { element.reviewed = false; });
    pending.sources.forEach((source) => { source.reviewed = false; }); pending.completenessReviewed = false;
    assert.equal((await request('POST', '/activar', { expectedRevision: 2, review: { draft: pending, confirmed: 'true' } })).status, 400);
    assert.equal((await request('POST', '/activar', { expectedRevision: 2, review: { draft: pending, confirmed: true } })).status, 200);
    const globalState = await (await request('GET', '')).json() as any;
    assert.equal(globalState.state.revision, 3);
    assert.equal(globalState.state.versions.length, 2);
    assert.equal(globalState.state.versions[1].reviewMethod, 'global');
    assert.equal(globalState.state.draft, undefined);
    assert.equal((await request('POST', '/activar', { expectedRevision: 2, review: { draft: pending, confirmed: true } })).status, 409);
  } finally { await server.cerrar(); }
});

test('curriculum prompts exclude private subject context and indexed teaching sources', async (context) => {
  const directory = await temporary(context);
  const storage = new Almacen(path.join(directory, 'data')); await storage.iniciar();
  const subject = await storage.crearAsignatura({ nombre: 'Fictional public subject', etapa: 'eso', curso: '1', contexto: 'PRIVATE_CONTEXT_FIXTURE', destinatarios: 'PRIVATE_GROUP_FIXTURE', estilo: 'PRIVATE_STYLE_FIXTURE' });
  const queue = new Cola(1, path.join(directory, 'jobs'));
  let captured: any;
  (queue as any).encolar = (request: unknown) => { captured = request; return { id: 'fake-job' }; };
  const workflow = new Flujo({ almacen: () => storage, cola: queue, ajustes: () => ({ carpetaDatos: storage.raiz, maxSimultaneos: 1, motorPorDefecto: 'claude', asistenteCompletado: true, agentes: {} }), motoresListos: () => new Set() });
  await storage.curriculum(subject.id).saveDraft({ ...fixture(), elements: [], sources: [], links: [], completenessReviewed: false }, 0);
  await workflow.buscarCurriculo(subject.id, undefined, { profile: fixture().profile });
  assert.equal(captured.post.datos.expectedRevision, 1);
  assert.equal(captured.post.datos.profile.subject, subject.nombre);
  assert.equal(captured.post.datos.profile.territory, 'Estatal');
  await storage.actualizarAsignatura(subject.id, { comunidad: 'Canarias', curso: '2' });
  await workflow.buscarCurriculo(subject.id, undefined, { profile: fixture().profile });
  assert.equal(captured.post.datos.profile.territory, 'Canarias');
  assert.equal(captured.post.datos.profile.course, '2');
  assert.doesNotMatch(captured.prompt, /PRIVATE_CONTEXT_FIXTURE|PRIVATE_GROUP_FIXTURE|PRIVATE_STYLE_FIXTURE/);
  assert.doesNotMatch(captured.prompt, /Está indexado/);
  assert.match(captured.prompt, /No consultes los documentos, fuentes privadas/);
  assert.match(captured.sistema, /extraer datos normativos/);
  assert.doesNotMatch(captured.sistema, /Mermaid|\\ce\{|numerados/i);
});
