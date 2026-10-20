import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Almacen } from '../server/store';
import { Cola } from '../server/agents/cola';
import { Flujo } from '../server/flujo';
import { ProgrammeProjects } from '../server/programmeProjects';
import { listarPapelera, restaurarDePapelera } from '../server/gestion';
import { crearServidor } from '../server/index';
import type { CurriculumDraft } from '../shared/curriculum';
import { emptyProgramme } from '../shared/teachingProgramme';

async function fixture(context: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-programme-delete-'));
  const storage = new Almacen(path.join(directory, 'data')); await storage.iniciar();
  const subject = await storage.crearAsignatura({ nombre: 'Synthetic programme deletion' });
  const draft: CurriculumDraft = { profile: { stage: 'eso', territory: 'Galicia', academicYear: '2026-2027', subject: subject.nombre, course: '1', scope: 'course', model: 'general', qualification: '', moduleCode: '' },
    sources: [{ id: 's', title: 'Synthetic source', url: 'https://www.boe.es/fictional', origin: 'official', filename: '', publishedOn: '', applicableFrom: '', notes: '', reviewed: true }],
    elements: [{ id: 'ce', kind: 'specificCompetence', code: 'CE1', text: 'Synthetic competence', parentId: '', sourceId: 's', locator: 'Fixture', excerpt: 'Synthetic competence', notes: '', reviewed: true }, { id: 'ca', kind: 'assessmentCriterion', code: 'CA1.1', text: 'Synthetic criterion', parentId: 'ce', sourceId: 's', locator: 'Fixture', excerpt: 'Synthetic criterion', notes: '', reviewed: true }], links: [], completenessReviewed: true };
  const curricula = storage.curriculum(subject.id); await curricula.saveDraft(draft, 0); await curricula.activate(1);
  const projects = new ProgrammeProjects(storage.dirAsignatura(subject.id), curricula);
  const project = await projects.create({ title: 'Programme to delete', purpose: 'classroom', totalHours: 6, context: '', requirements: '', selectionRequirements: '' });
  const other = await projects.create({ title: 'Programme to preserve', purpose: 'classroom', totalHours: 0, context: '', requirements: '', selectionRequirements: '' });
  const queue = new Cola(1, path.join(directory, 'jobs'));
  const workflow = new Flujo({ almacen: () => storage, cola: queue, ajustes: () => ({ carpetaDatos: storage.raiz, maxSimultaneos: 1, motorPorDefecto: 'claude', asistenteCompletado: true, agentes: {} }), motoresListos: () => new Set() });
  context.after(async () => { queue.detenerTodo(); await queue.flush(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, storage, subject, projects, project, other, queue, workflow };
}

test('deletion moves the complete programme to trash and restores both purposes byte-for-byte', async context => {
  const { storage, subject, projects, project, other, workflow } = await fixture(context);
  const store = await projects.store(project.id), state = await store.read();
  const curriculum = await store.curriculum(project.curriculumVersionId);
  const opposition = await projects.store(project.id, 'opposition');
  await opposition.save({ ...emptyProgramme(curriculum, 'opposition'), title: 'Opposition copy' }, 0);
  const projectDirectory = projects.projectDirectory(project.id);
  await fs.writeFile(path.join(projectDirectory, 'research-classroom.json'), '{"preserve":"research"}');
  await fs.writeFile(path.join(projectDirectory, 'unit-proposal-classroom.json'), '{"preserve":"proposal"}');
  const names = ['project.json', 'state.json', 'opposition.json', 'research-classroom.json', 'unit-proposal-classroom.json'];
  const before = await Promise.all(names.map(name => fs.readFile(path.join(projectDirectory, name), 'utf8')));
  const curriculumBytes = await fs.readFile(storage.curriculum(subject.id).filename, 'utf8');
  await workflow.deleteProgramme(subject.id, project.id);
  assert.deepEqual((await projects.list()).map(item => item.id), [other.id]);
  await assert.rejects(projects.get(project.id), /no encontrada/);
  const trash = await listarPapelera(storage);
  assert.equal(trash.length, 1); assert.equal(trash[0].tipo, 'programacion');
  assert.equal(trash[0].titulo, project.title);
  assert.deepEqual(await restaurarDePapelera(storage, trash[0].id), { asignatura: subject.id });
  assert.deepEqual(await Promise.all(names.map(name => fs.readFile(path.join(projectDirectory, name), 'utf8'))), before);
  assert.equal((await (await projects.store(project.id)).read()).revision, state.revision);
  assert.equal(await fs.readFile(storage.curriculum(subject.id).filename, 'utf8'), curriculumBytes);
  assert.equal((await listarPapelera(storage)).length, 0);
});

test('deletion rejects queued or running jobs for either purpose and for research', async context => {
  const { workflow, queue, subject, project, projects } = await fixture(context);
  const originalList = queue.listar.bind(queue);
  try {
    for (const ref of [`${project.id}:classroom`, `${project.id}:opposition`, `research:${project.id}:classroom`, `research:${project.id}:opposition`]) {
      for (const estado of ['en-cola', 'ejecutando']) {
        queue.listar = () => [{ asignatura: subject.id, paso: 'programacion', ref, estado }] as any;
        await assert.rejects(workflow.deleteProgramme(subject.id, project.id), /trabajos/);
        assert.equal((await projects.get(project.id)).id, project.id);
      }
    }
  } finally { queue.listar = originalList; }
});

test('delayed draft, research and proposal writes cannot recreate a deleted programme', async context => {
  const { workflow, subject, project, projects } = await fixture(context);
  const store = await projects.store(project.id), state = await store.read();
  const research = await projects.research(project.id);
  const proposals = await workflow.programmeUnitHelpStore(subject.id, project.id, 'classroom');
  await workflow.deleteProgramme(subject.id, project.id);
  await assert.rejects(store.save(state.draft, state.revision), /papelera/);
  await assert.rejects(research.accept({}, 0, 'late-research'), /papelera/);
  await assert.rejects(proposals.write({ jobId: 'late', expectedRevision: 1, curriculumVersionId: project.curriculumVersionId, purpose: 'classroom', units: [], createdAt: '' }), /papelera/);
  await assert.rejects(fs.access(projects.projectDirectory(project.id)), { code: 'ENOENT' });
});

test('concurrent save/delete preserves the accepted revision in trash and restore never overwrites a collision', async context => {
  const { storage, workflow, subject, project, projects } = await fixture(context);
  const store = await projects.store(project.id), state = await store.read();
  const results = await Promise.allSettled([store.save({ ...state.draft, title: 'Concurrent edit' }, state.revision), workflow.deleteProgramme(subject.id, project.id)]);
  assert.equal(results[1].status, 'fulfilled');
  await assert.rejects(fs.access(projects.projectDirectory(project.id)), { code: 'ENOENT' });
  const [entry] = await listarPapelera(storage);
  const saved = JSON.parse(await fs.readFile(path.join(storage.raiz, '.papelera', entry.id, 'state.json'), 'utf8'));
  assert.equal(saved.draft.title, results[0].status === 'fulfilled' ? 'Concurrent edit' : state.draft!.title);
  await fs.mkdir(projects.projectDirectory(project.id));
  await fs.writeFile(path.join(projects.projectDirectory(project.id), 'collision.txt'), 'Do not overwrite');
  await assert.rejects(restaurarDePapelera(storage, entry.id), /Ya existe/);
  assert.equal(await fs.readFile(path.join(projects.projectDirectory(project.id), 'collision.txt'), 'utf8'), 'Do not overwrite');
  assert.equal((await listarPapelera(storage)).length, 1);
});

test('HTTP deletion refreshes counts, reports missing IDs and restores through the existing trash API', async context => {
  const { directory, storage, subject, project, other } = await fixture(context);
  const server = await crearServidor({ archivoAjustes: path.join(directory, 'settings.json'), carpetaDatosPorDefecto: storage.raiz, dirTrabajos: path.join(directory, 'http-jobs'), codexUsageReader: async () => ({ windows: [], updatedAt: 0, unavailable: true }) });
  const base = `${server.url}/api/asignaturas/${subject.id}/programaciones`;
  try {
    assert.equal((await fetch(`${base}/${project.id}`, { method: 'DELETE' })).status, 200);
    assert.deepEqual(((await (await fetch(base)).json()) as any[]).map(item => item.id), [other.id]);
    assert.equal((await fetch(`${base}/${project.id}`, { method: 'DELETE' })).status, 404);
    assert.equal((await fetch(`${base}/invalid%2Fpath`, { method: 'DELETE' })).status, 400);
    const [entry] = await (await fetch(`${server.url}/api/papelera`)).json() as any[];
    assert.equal(entry.tipo, 'programacion');
    assert.equal((await fetch(`${server.url}/api/papelera/${encodeURIComponent(entry.id)}/restaurar`, { method: 'POST' })).status, 200);
    assert.equal(((await (await fetch(base)).json()) as any[]).length, 2);
    assert.equal((await fetch(`${base}/${project.id}`)).status, 200);
  } finally { await server.cerrar(); }
});
