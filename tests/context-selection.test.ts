import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSectionReference } from '../server/contextSelection';
import { selectExamAdaptationContext } from '../server/examContext';
import { Almacen } from '../server/store';
import { Cola } from '../server/agents/cola';
import { FlujoBase } from '../server/fases/base';
import { AGENTES, construirPrompt } from '../server/agents/agentes';
import { indexar } from '../server/rag';
import type { PreguntaExamen } from '../shared/examenes';

test('bounded section context keeps exact bodies and an explicit exhaustive deferred manifest', async () => {
  const files: Record<string, string> = { '01.md': '# Small\nExact exception: never 42.', '02.md': '# Long\n' + 'x'.repeat(200), '03.md': '# Tail\nDo not omit this file.' };
  const reads: string[] = [];
  const result = await buildSectionReference(['01.md', '02.md', '03.md', '01.md'], async (filename) => {
    reads.push(filename);
    return files[filename];
  }, 80);
  assert.deepEqual(reads, ['01.md', '02.md', '03.md']);
  assert.ok(result.includes(files['01.md']));
  assert.ok(result.includes(files['03.md']));
  assert.ok(!result.includes(files['02.md']));
  assert.match(result, /secciones\/02.md: PENDIENTE/);
  assert.match(result, /secciones\/03.md: incluida completa/);
  await assert.rejects(buildSectionReference(['missing.md'], async () => { throw new Error('Missing source'); }), /Missing source/);
});

test('adaptation context preserves shared material and immutable selected rubrics without unrelated grading prose', () => {
  const questions: PreguntaExamen[] = [
    { id: 'q1', tipo: 'datos', puntos: 4, enunciado: 'Use the table for both questions.', material: '| x | 42 |',
      solucion: 'UNRELATED_SOLUTION', explicacion: 'UNRELATED_EXPLANATION', errores: ['UNRELATED_ERROR'],
      rubrica: [{ criterio: 'UNRELATED_RUBRIC', puntos: 4, niveles: [] }] },
    { id: 'q2', tipo: 'desarrollo', puntos: 6, enunciado: 'Explain the data in question 1.', solucion: 'EXACT_SELECTED_SOLUTION',
      rubrica: [{ criterio: 'Preserve selected rubric', puntos: 6, niveles: [] }] },
  ];
  const before = structuredClone(questions);
  const packet = selectExamAdaptationContext(questions, ['q2']);
  assert.deepEqual(packet.selectedQuestions, [questions[1]]);
  assert.equal(packet.referenceQuestions[0].material, questions[0].material);
  assert.equal(packet.referenceQuestions[0].enunciado, questions[0].enunciado);
  assert.doesNotMatch(JSON.stringify(packet), /UNRELATED_/);
  assert.deepEqual(questions, before);
  for (const ids of [[], ['q2', 'q2'], ['missing']]) assert.throws(() => selectExamAdaptationContext(questions, ids));
});

test('real launches use scoped sources, selected file reads, compact role prompts and explicit no-hit fallback', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-context-policy-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Almacen(path.join(directory, 'data'));
  await store.iniciar();
  const subject = await store.crearAsignatura({ nombre: 'Synthetic context policy' });
  const document = await store.crearDocumento(subject.id, { titulo: 'Synthetic notes' });
  const selected = await store.crearSeccion(subject.id, document.id, 'Selected');
  await store.guardarSeccion(subject.id, document.id, selected.archivo, '# Selected\nEXACT_SELECTED_INPUT');
  await store.crearSeccion(subject.id, document.id, 'Unrelated');
  // This old broad-read path must never be used for an explicit selection.
  store.textoCompleto = async () => { throw new Error('Unnecessary whole-document read'); };
  const queue = new Cola(1, path.join(directory, 'jobs'));
  const launches: any[] = [];
  queue.encolar = ((launch: unknown) => { launches.push(launch); return launch; }) as any;
  const flow = new FlujoBase({ almacen: () => store, cola: queue,
    ajustes: () => ({ carpetaDatos: store.raiz, maxSimultaneos: 1, motorPorDefecto: 'claude', asistenteCompletado: true, agentes: {} }),
    motoresListos: () => new Set(),
  });
  const scoped = path.join(directory, 'scoped');
  await fs.mkdir(scoped);
  await fs.writeFile(path.join(scoped, 'scope.md'), '# DHCP\nDHCP SCOPE_ALLOWED_MARKER reservation.');
  await indexar(scoped);
  await fs.mkdir(store.dirFuentes(subject.id), { recursive: true });
  await fs.writeFile(path.join(store.dirFuentes(subject.id), 'excluded.md'), '# DHCP\nDHCP SCOPE_EXCLUDED_MARKER reservation.');
  await indexar(store.dirFuentes(subject.id));
  const launch = { agente: 'diagnostico', asignatura: subject.id, documento: document.id, titulo: 'Synthetic', tarea: 'Read selected files.', paso: 'diagnostico',
    carpetas: { scoped }, incluir: { secciones: [selected.archivo], consulta: 'DHCP' } };
  await (flow as any).lanzar(launch);
  assert.match(launches[0].prompt, /EXACT_SELECTED_INPUT/);
  assert.match(launches[0].prompt, /SCOPE_ALLOWED_MARKER/);
  assert.doesNotMatch(launches[0].prompt, /SCOPE_EXCLUDED_MARKER/);
  assert.doesNotMatch(launches[0].sistema, /```mapa|```grafica/);
  await (flow as any).lanzar({ ...launch, fuentes: false });
  assert.doesNotMatch(launches[1].prompt, /SCOPE_ALLOWED_MARKER|SCOPE_EXCLUDED_MARKER/);
  const dossier = '# Research\n' + 'EXACT_FALLBACK_EVIDENCE '.repeat(2000);
  await store.guardarArchivoDoc(subject.id, document.id, 'investigacion.md', dossier);
  const reference = await (flow as any).contenidoReferencia(subject.id, document.id, { dossier: true, consulta: 'zzzzzzzzzzzzzzzzzz' }, { folders: {}, allowSources: false });
  assert.match(reference, /sin coincidencias/);
  assert.match(reference, /EXACT_FALLBACK_EVIDENCE/);
  assert.match(reference, /PENDIENTE/);
});

test('compact prompts preserve custom instructions and output contracts while authoring keeps graphical syntax', () => {
  const context = { asignatura: { nombre: 'Synthetic', contexto: '', idioma: 'español' } as any };
  const custom = 'CUSTOM_ROLE_REQUIREMENT';
  const task = 'Write only result.json with {"facts":[]}.';
  const compact = construirPrompt(custom, context, task, 'CUSTOM_USER_REQUIREMENT', 'structured');
  const full = construirPrompt(custom, context, task);
  assert.match(compact.sistema, /CUSTOM_ROLE_REQUIREMENT/);
  assert.match(compact.sistema, /calcular/);
  assert.match(compact.prompt, /CUSTOM_USER_REQUIREMENT/);
  assert.ok(compact.prompt.includes(task));
  assert.ok(compact.sistema.length < full.sistema.length / 2);
  assert.match(full.sistema, /```mapa/);
  assert.match(full.sistema, /custom-style/);
  const curriculum = construirPrompt(AGENTES.curriculo.instrucciones, context, task, undefined, 'curriculum');
  assert.match(curriculum.sistema, /No traduzcas el texto normativo/);
});

test('long curriculum references retain the exact captured version and expose tail content through stable paths', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-curriculum-context-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Almacen(path.join(directory, 'data'));
  await store.iniciar();
  const subject = await store.crearAsignatura({ nombre: 'Synthetic curriculum context' });
  const document = await store.crearDocumento(subject.id, { titulo: 'Synthetic document' });
  const flow = new FlujoBase({ almacen: () => store, cola: new Cola(1, path.join(directory, 'jobs')),
    ajustes: () => ({ carpetaDatos: store.raiz, maxSimultaneos: 1, motorPorDefecto: 'claude', asistenteCompletado: true, agentes: {} }),
    motoresListos: () => new Set(),
  });
  const original = '# Version A\n\n' + 'Exact criterion; never invent its exception.\n\n'.repeat(30) + 'EXACT_TAIL_CRITERION';
  store.curriculumPrompt = async () => original;
  const [first, duplicate] = await Promise.all([
    (flow as any).curriculumReference(subject.id, document.id, 120),
    (flow as any).curriculumReference(subject.id, document.id, 120),
  ]);
  assert.equal(first, duplicate);
  assert.match(first, /PENDIENTE/);
  assert.doesNotMatch(first, /EXACT_TAIL_CRITERION/);
  const relative = /`([^`]+\.md)`/.exec(first)![1];
  const snapshot = path.resolve(store.dirDocumento(subject.id, document.id), relative);
  assert.equal(await fs.readFile(snapshot, 'utf8'), original);
  const subjectReference = await (flow as any).curriculumReference(subject.id, undefined, 120);
  const subjectRelative = /`([^`]+\.md)`/.exec(subjectReference)![1];
  assert.equal(path.resolve(store.dirAsignatura(subject.id), subjectRelative), snapshot);
  store.curriculumPrompt = async () => original.replace('Version A', 'Version B');
  const second = await (flow as any).curriculumReference(subject.id, document.id, 120);
  assert.notEqual(second, first);
  assert.equal(await fs.readFile(snapshot, 'utf8'), original);
  store.curriculumPrompt = async () => 'Short exact curriculum';
  assert.equal(await (flow as any).curriculumReference(subject.id, document.id, 120), 'Short exact curriculum');
});
