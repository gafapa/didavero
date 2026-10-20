import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Almacen } from '../server/store';
import { Cola, PedirAlAgente } from '../server/agents/cola';
import { Flujo } from '../server/flujo';

test('diagnosis persists zero or few evidenced problems and still rejects malformed results', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-evidence-contract-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new Almacen(path.join(directory, 'data')); await store.iniciar();
  const subject = await store.crearAsignatura({ nombre: 'Synthetic evidence policy' });
  const document = await store.crearDocumento(subject.id, { titulo: 'Synthetic notes' });
  const section = await store.crearSeccion(subject.id, document.id, 'Synthetic lesson');
  await store.guardarSeccion(subject.id, document.id, section.archivo, '# Synthetic lesson\n' + 'Fictional content for a bounded diagnostic evaluation. '.repeat(20));
  const flow = new Flujo({ almacen: () => store, cola: new Cola(1, path.join(directory, 'jobs')),
    ajustes: () => ({ carpetaDatos: store.raiz, maxSimultaneos: 1, motorPorDefecto: 'claude', asistenteCompletado: true, agentes: {} }),
    motoresListos: () => new Set(),
  });
  let launch: any;
  (flow as any).lanzar = async (input: unknown) => { launch = input; return { id: 'synthetic-job' }; };
  await flow.diagnosticar(subject.id, document.id);
  assert.match(launch.tarea, /si no hay problemas comprobables, deja la lista vacía/);
  assert.doesNotMatch(launch.tarea, /Entre 5 y 25/);
  const filename = path.join(store.dirDocumento(subject.id, document.id), launch.post.datos.salida);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const processResult = () => (flow as any).postDiagnostico({ asignatura: subject.id, documento: document.id }, launch.post.datos);
  for (const problems of [[], [{ area: 'contenido', seccion: section.archivo, descripcion: 'A specific fictional omission with evidence.', gravedad: 'baja' }]]) {
    await fs.writeFile(filename, JSON.stringify({ resumen: 'Synthetic bounded review.', puntosFuertes: ['Preserve the exact supplied explanation.'], problemas: problems, recomendacion: 'conservador', motivoRecomendacion: 'No unsupported changes.' }));
    await processResult();
    const saved = await store.leerJsonDoc<any>(subject.id, document.id, 'diagnostico.json', null);
    assert.equal(saved.problemas.length, problems.length);
    assert.equal(saved.recomendacion, 'conservador');
    assert.deepEqual(saved.puntosFuertes, ['Preserve the exact supplied explanation.']);
  }
  await fs.writeFile(filename, JSON.stringify({ resumen: 'Malformed result', problemas: null }));
  await assert.rejects(processResult(), PedirAlAgente);
  assert.equal((await store.leerJsonDoc<any>(subject.id, document.id, 'diagnostico.json', null)).problemas.length, 1);
});
