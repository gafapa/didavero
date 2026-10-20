import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Almacen } from '../server/store';
import { Cola, PedirAlAgente } from '../server/agents/cola';
import { Flujo } from '../server/flujo';
import { EXAM_ADAPTATIONS, examenAMarkdown, solucionarioAMarkdown, rubricaAMarkdown, totalExamen, type PreguntaExamen } from '../shared/examenes';
import { exportarExamen, exportarExamenMoodle } from '../server/exportarExamen';

test('all exam adaptations preserve snapshots, selection, scores and independent exports', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-adaptations-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Almacen(path.join(directory, 'data'));
  await store.iniciar();
  const subject = await store.crearAsignatura({ nombre: 'Synthetic biology' });
  const queue = new Cola(1, path.join(directory, 'jobs'));
  const flow = new Flujo({ almacen: () => store, cola: queue,
    ajustes: () => ({ carpetaDatos: store.raiz, maxSimultaneos: 1, motorPorDefecto: 'claude', asistenteCompletado: true, agentes: {} }),
    motoresListos: () => new Set(),
  });
  const launches: any[] = [];
  (flow as any).lanzar = async (launch: unknown) => { launches.push(launch); return { id: `job-${launches.length}` }; };
  const source = await flow.crearExamen(subject.id, { titulo: 'Synthetic exam', opciones: { espacio: true, modeloB: true, elegir: { desarrollo: 1 } } });
  const questions: PreguntaExamen[] = [
    { id: 'q1', tipo: 'test', puntos: 2, enunciado: 'Which organelle makes ATP?', opciones: ['Ribosome', 'Mitochondrion'], correcta: 1, explicacion: 'Cellular respiration.' },
    { id: 'q2', tipo: 'desarrollo', puntos: 8, enunciado: 'Explain cellular respiration.', solucion: 'Cells release energy and make ATP.', criterios: ['1.2'], origen: 'Synthetic source', lineas: 12,
      rubrica: [{ criterio: 'ATP production', puntos: 8, niveles: [{ nivel: 'Excellent', descripcion: 'Explains ATP production', puntos: 8 }, { nivel: 'None', descripcion: 'No answer', puntos: 0 }] }] },
  ];
  source.preguntas = questions;
  source.estado = 'listo';
  await store.guardarExamen(subject.id, source);
  const sourceFile = await flow.rutaFuenteExamen(subject.id, source.id, 'synthetic.md');
  await fs.writeFile(sourceFile, '# Synthetic source\nCells produce ATP.');
  const snapshot = await fs.readFile(path.join(store.dirExamen(subject.id, source.id), 'examen.json'), 'utf8');

  for (const variant of EXAM_ADAPTATIONS) {
    const copy = await flow.adaptExam(subject.id, source.id, { kind: variant.id, questionIds: ['q2'], instructions: 'Keep the language English.' });
    assert.notEqual(copy.id, source.id);
    assert.equal(copy.estado, 'generando');
    assert.deepEqual(copy.preguntas, []);
    assert.equal(copy.adaptation?.sourceExamId, source.id);
    assert.equal(copy.adaptation?.sourceUpdatedAt, source.actualizado);
    assert.deepEqual(copy.opciones, source.opciones);
    assert.equal(await fs.readFile(path.join(store.dirExamen(subject.id, copy.id), 'fuentes/synthetic.md'), 'utf8'), '# Synthetic source\nCells produce ATP.');
    const launch = launches.at(-1);
    assert.match(launch.tarea, new RegExp(variant.name));
    assert.match(launch.tarea, /Keep the language English/);
    assert.ok(launch.tarea.includes(questions[1].solucion!));
    assert.ok(launch.tarea.includes(questions[0].enunciado));
    assert.ok(!launch.tarea.includes(questions[0].explicacion!));
    assert.ok(launch.tarea.includes(`examenes/${copy.id}/examen.json`));
    const output = path.join(store.dirAsignatura(subject.id), launch.post.datos.salida);
    await fs.mkdir(path.dirname(output), { recursive: true });
    const writeResult = (items: unknown[]) => fs.writeFile(output, JSON.stringify({ preguntas: items }));
    const processResult = () => (flow as any).postExamen({ asignatura: subject.id }, launch.post.datos);

    for (const malformed of [null, [], 'not an exam', { preguntas: null }, { preguntas: [42] }, { preguntas: [{ ...questions[1], rubrica: 42 }] }]) {
      await fs.writeFile(output, JSON.stringify(malformed));
      await assert.rejects(processResult(), PedirAlAgente, JSON.stringify(malformed));
      assert.deepEqual((await flow.examen(subject.id, copy.id)).preguntas, []);
    }

    for (const invalid of [[], [questions[0]], [questions[1], questions[1]], [{ ...questions[1], tipo: 'test' }], [{ ...questions[1], rubrica: [] }], [null]]) {
      await writeResult(invalid);
      await assert.rejects(processResult(), PedirAlAgente);
      assert.deepEqual((await flow.examen(subject.id, copy.id)).preguntas, []);
    }
    const adapted = { ...questions[1], enunciado: `Adapted ${variant.id}: explain how cells obtain energy.`, puntos: 99, criterios: ['wrong'], lineas: 40, solucion: 'Adapted answer: cells produce ATP through respiration.' };
    await writeResult([adapted]);
    await processResult();
    const ready = await flow.examen(subject.id, copy.id);
    assert.equal(ready.estado, 'listo');
    assert.ok(ready.adaptation?.completedAt);
    assert.deepEqual(ready.preguntas[0], questions[0]);
    assert.equal(ready.preguntas[1].id, 'q2');
    assert.equal(ready.preguntas[1].puntos, 8);
    assert.equal(ready.preguntas[1].lineas, 12);
    assert.deepEqual(ready.preguntas[1].criterios, ['1.2']);
    assert.equal(totalExamen(ready), totalExamen(source));
    assert.equal(ready.preguntas[1].rubrica![0].puntos, 8);
    assert.match(examenAMarkdown(ready), new RegExp(`Adapted ${variant.id}`));
    assert.doesNotMatch(examenAMarkdown(ready), /Adapted answer/);
    assert.match(solucionarioAMarkdown(ready), /Adapted answer/);
    assert.match(rubricaAMarkdown(ready), /ATP production/);
    await flow.editarPreguntaExamen(subject.id, copy.id, 'q2', { enunciado: 'Teacher edit' });
    await processResult();
    assert.equal((await flow.examen(subject.id, copy.id)).preguntas[1].enunciado, 'Teacher edit');
    const gift = await exportarExamenMoodle(store, subject.id, ready);
    assert.match(await fs.readFile(path.join(store.dirExamen(subject.id, copy.id), 'exportados', gift.nombre), 'utf8'), /Adapted/);
    assert.equal(await fs.readFile(path.join(store.dirExamen(subject.id, source.id), 'examen.json'), 'utf8'), snapshot);
  }

  for (const questionIds of [[], ['missing'], ['q1', 'q1']]) {
    await assert.rejects(flow.adaptExam(subject.id, source.id, { kind: 'easy-reading', questionIds }), /Selecciona preguntas válidas/);
  }
  await assert.rejects(flow.adaptExam(subject.id, source.id, { kind: 'invalid' as any, questionIds: ['q1'] }), /Tipo de adaptación/);
  const pending = await flow.adaptExam(subject.id, source.id, { kind: 'extension', questionIds: ['q2'] });
  const pendingLaunch = launches.at(-1);
  await flow.editarPreguntaExamen(subject.id, source.id, 'q1', { enunciado: 'Later source edit' });
  await (flow as any).alFallarExamen({ asignatura: subject.id, estado: 'cancelado', eventos: [] }, pendingLaunch.post.datos);
  assert.equal((await flow.examen(subject.id, pending.id)).estado, 'error');
  await (flow as any).alReintentarExamen({ asignatura: subject.id }, pendingLaunch.post.datos);
  assert.equal((await flow.examen(subject.id, pending.id)).estado, 'generando');
  await fs.writeFile(path.join(store.dirAsignatura(subject.id), pendingLaunch.post.datos.salida), JSON.stringify({ preguntas: [questions[1]] }));
  await (flow as any).postExamen({ asignatura: subject.id }, pendingLaunch.post.datos);
  assert.deepEqual((await flow.examen(subject.id, pending.id)).preguntas[0], questions[0]);
  assert.equal((await flow.examen(subject.id, source.id)).preguntas[0].enunciado, 'Later source edit');
  (flow as any).lanzar = async () => { throw new Error('Synthetic launch failure'); };
  const failed = await flow.adaptExam(subject.id, source.id, { kind: 'supported', questionIds: ['q1'] });
  assert.equal(failed.estado, 'error');
  assert.match(failed.error!, /Synthetic launch failure/);
  assert.deepEqual(failed.preguntas, []);
  await assert.rejects(exportarExamen(store, '', subject.id, failed, 'docx'), /todavía no tiene preguntas/);
  await assert.rejects(exportarExamenMoodle(store, subject.id, failed), /todavía no tiene preguntas/);
  await assert.rejects(flow.generarExamen(subject.id, failed.id), /Crea otra versión/);
});
