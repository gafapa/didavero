// Cola de agentes con un motor falso (tests/motor-falso.mjs): reintentos, límite de uso e inactividad.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Cola, limiteEnTexto, PedirAlAgente } from '../server/agents/cola';
import type { Trabajo } from '../shared/tipos';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apuntes-cola-'));
let cola: Cola;

before(() => {
  process.env.APUNTES_MOTOR_CLAUDE = path.join(import.meta.dirname, process.platform === 'win32' ? 'motor-falso.cmd' : 'motor-falso.sh');
  process.env.FALSO_DIR = dir;
  cola = new Cola(2, path.join(dir, 'trabajos'));
  cola.tiempos = { inactividad: 1500, esperaSinHora: 2000, margenLimite: 200 };
});

after(async () => {
  cola.detenerTodo();
  cola.reanudarCola();
  await cola.flush();
  // El proceso cancelado tarda un poco en soltar la carpeta (en Windows no se puede borrar mientras)
  for (let i = 0; i < 40; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
});

function encolar(prompt: string): Trabajo {
  return cola.encolar({ agente: 'prueba', nombreAgente: 'Prueba', motor: 'claude', titulo: prompt, asignatura: 'a', prompt, cwd: dir });
}

async function esperar(cond: () => boolean, ms = 20000) {
  const fin = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fin) throw new Error('Tiempo agotado esperando la condición');
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('un trabajo que termina bien', async () => {
  const t = encolar('MODO:OK uno');
  await esperar(() => t.estado === 'ok');
  assert.equal(t.resultado, 'Hecho');
  assert.ok(t.sesion);
});

test('post-processing errors replace a successful model message while preserving it in the event history', async () => {
  const previous = cola.manejadores;
  cola.manejadores = { alTerminar: async () => { throw new Error('Specific validation failure'); }, alFallar: () => {} };
  try {
    const job = cola.encolar({ agente: 'prueba', nombreAgente: 'Fixture', motor: 'claude', titulo: 'Post-processing fixture', asignatura: 'a', prompt: 'MODO:OK validation', cwd: dir, post: { tipo: 'programme-research', datos: {} } });
    await esperar(() => job.estado === 'error');
    assert.equal(job.resultado, 'Specific validation failure');
    assert.ok(job.eventos.some(event => event.tipo === 'texto' && event.texto.includes('Hecho')));
  } finally { cola.manejadores = previous; }
});

test('curriculum and programme corrections stop after one automatic retry while other tasks keep their limit', async () => {
  const previousHandlers = cola.manejadores;
  let completions = 0;
  cola.manejadores = {
    alTerminar: async () => { completions++; throw new PedirAlAgente('Invalid fixture', 'MODO:OK repair-fixture'); },
    alFallar: async () => {},
  };
  try {
    const curriculum = cola.encolar({ agente: 'curriculo', nombreAgente: 'Curriculum fixture', motor: 'claude', titulo: 'Retry fixture', asignatura: 'a', prompt: 'MODO:OK curriculum-fixture', cwd: dir, post: { tipo: 'curriculo' } });
    await esperar(() => curriculum.estado === 'error');
    assert.equal(completions, 2);
    assert.equal(curriculum.eventos.filter((event) => /Se lo pido de nuevo/.test(event.texto)).length, 1);
    completions = 0;
    const programme = cola.encolar({ agente: 'arquitecto', nombreAgente: 'Programme fixture', motor: 'claude', titulo: 'Missing output fixture', asignatura: 'a', paso: 'programacion', prompt: 'MODO:OK programme-fixture', cwd: dir, post: { tipo: 'programme-generate' } });
    await esperar(() => programme.estado === 'error');
    assert.equal(completions, 2);
    assert.equal(programme.eventos.filter((event) => /Se lo pido de nuevo/.test(event.texto)).length, 1);
    completions = 0;
    const other = cola.encolar({ agente: 'prueba', nombreAgente: 'Other fixture', motor: 'claude', titulo: 'Retry fixture', asignatura: 'a', prompt: 'MODO:OK other-fixture', cwd: dir, post: { tipo: 'prueba' } });
    await esperar(() => other.estado === 'error');
    assert.equal(completions, 3);
  } finally { cola.manejadores = previousHandlers; }
});

test('reintentar desde el principio un trabajo fallido', async () => {
  const t = encolar('MODO:FALLA dos');
  await esperar(() => t.estado === 'error');
  await cola.reintentar(t.id);
  assert.equal(t.estado === 'en-cola' || t.estado === 'ejecutando', true);
  await esperar(() => t.estado === 'ok');
  assert.ok(t.eventos.some((e) => e.texto === 'Reintento desde el principio'));
});

test('queued jobs recheck mutable limits before launching the next process', async () => {
  const previous = cola.manejadores, capacity = cola.maxSimultaneos;
  let spent = 0, checks = 0;
  cola.maxSimultaneos = 1;
  cola.manejadores = { antesDeEjecutar: async () => { checks++; if (spent >= 10) throw Error('Fixture budget exhausted'); }, alTerminar: async () => { spent = 10; }, alFallar: async () => {} };
  try {
    const first = cola.encolar({ agente: 'prueba', nombreAgente: 'Fixture', motor: 'claude', titulo: 'First budget fixture', asignatura: 'a', prompt: 'MODO:OK budget-first', cwd: dir, post: { tipo: 'prueba' } });
    const second = encolar('MODO:OK budget-second');
    await esperar(() => first.estado === 'ok' && second.estado === 'error');
    assert.equal(checks, 2); assert.equal(second.resultado, 'Fixture budget exhausted');
    assert.ok(!second.eventos.some(event => event.texto.startsWith('Conectado')));
  } finally { cola.manejadores = previous; cola.maxSimultaneos = capacity; }
});

test('queue restart resumes a persisted interrupted session without killing reused live PIDs', async () => {
  const directory = path.join(dir, 'restart-fixture'), previous = new Cola(1, directory);
  const job = previous.encolar({ agente: 'prueba', nombreAgente: 'Fixture', motor: 'claude', titulo: 'Restart fixture', asignatura: 'a', prompt: 'MODO:OK restart-fixture', cwd: dir });
  await esperar(() => job.estado === 'ok'); await previous.flush();
  const filename = path.join(directory, job.id + '.json'), stored = JSON.parse(fs.readFileSync(filename, 'utf8'));
  stored.trabajo.estado = 'ejecutando'; delete stored.trabajo.fin; delete stored.pid;
  fs.writeFileSync(filename, JSON.stringify(stored));
  const restarted = new Cola(1, directory);
  try {
    await restarted.cargar(); await esperar(() => restarted.obtener(job.id)?.estado === 'ok');
    assert.ok(restarted.obtener(job.id)?.eventos.some(event => event.texto === 'Continúo.'));
    await restarted.flush();
    const live = JSON.parse(fs.readFileSync(filename, 'utf8'));
    live.trabajo.estado = 'ejecutando'; delete live.trabajo.fin; live.pid = process.pid;
    fs.writeFileSync(filename, JSON.stringify(live));
    const reused = new Cola(1, directory);
    await reused.cargar();
    assert.equal(reused.obtener(job.id)?.estado, 'error');
    assert.match(reused.obtener(job.id)!.resultado!, /identidad/);
    process.kill(process.pid, 0);
    await reused.flush();
  } finally { restarted.detenerTodo(); await restarted.flush(); }
});

test('límite de uso: el motor se pausa y los trabajos siguen solos al renovarse', async () => {
  const t = encolar('MODO:LIMITE tres');
  await esperar(() => !!cola.uso.pausas?.claude);
  assert.equal(t.estado, 'en-cola');
  assert.ok(t.eventos.some((e) => /límite de uso/.test(e.texto)));
  // Lo que se encola mientras tanto también espera
  const otro = encolar('MODO:OK cuatro');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(otro.estado, 'en-cola');
  await esperar(() => t.estado === 'ok' && otro.estado === 'ok');
  assert.equal(cola.uso.pausas?.claude, undefined);
  // Continuó su conversación (no empezó de cero)
  assert.ok(t.eventos.some((e) => e.texto === 'Continúo.'));
});

test('aviso de inactividad y «seguir esperando»', async () => {
  const t = encolar('MODO:CUELGA cinco');
  await esperar(() => !!t.inactivo);
  cola.seguirEsperando(t.id);
  assert.equal(t.inactivo, undefined);
  cola.cancelar(t.id);
  assert.equal(t.estado, 'cancelado');
});

test('mensajes de límite de uso de Claude y Codex', () => {
  const ahora = new Date('2026-10-11T14:00:00');
  const hora = (s: string) => {
    const h = limiteEnTexto(s, ahora)?.hasta;
    return h ? new Date(h).toTimeString().slice(0, 5) : limiteEnTexto(s, ahora);
  };
  assert.equal(hora('Claude AI usage limit reached|1791464400'), new Date(1791464400_000).toTimeString().slice(0, 5));
  assert.equal(hora("You've hit your limit · resets 5pm (Europe/Madrid)"), '17:00');
  assert.equal(hora("You've hit your usage limit. Upgrade to Pro or try again at 3:05 PM."), '15:05');
  assert.equal(hora("You've hit your usage limit. Try again in 2 hours 5 minutes."), '16:05');
  assert.equal(hora('Weekly limit reached · resets Oct 13, 10am'), '10:00');
  assert.equal(hora('rate limit exceeded (429)'), '14:02');
  assert.equal(limiteEnTexto('Error: file not found'), undefined);
});

test('Clearing finished jobs preserves running and queued work, and removes persisted terminal records', async () => {
  const previousCapacity = cola.maxSimultaneos;
  cola.maxSimultaneos = 1;
  const running = encolar('MODO:CUELGA cleanup-running');
  await esperar(() => running.estado === 'ejecutando');
  const waiting = encolar('MODO:OK cleanup-waiting');
  const finished = cola.listar().filter(job => job.estado !== 'en-cola' && job.estado !== 'ejecutando');
  assert.ok(finished.length);
  const removed = cola.limpiar();
  assert.deepEqual(new Set(removed), new Set(finished.map(job => job.id)));
  assert.equal(cola.obtener(running.id), running);
  assert.equal(cola.obtener(waiting.id), waiting);
  assert.equal(waiting.estado, 'en-cola');
  await esperar(() => finished.every(job => !fs.existsSync(path.join(dir, 'trabajos', `${job.id}.json`))));
  // A delayed save must not resurrect a removed record.
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.ok(finished.every(job => !fs.existsSync(path.join(dir, 'trabajos', `${job.id}.json`))));
  cola.cancelar(waiting.id);
  cola.cancelar(running.id);
  cola.maxSimultaneos = previousCapacity;
});
