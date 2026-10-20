import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Cola } from '../server/agents/cola';
import { openCodeInvocation, openCodeTokens } from '../server/agents/opencode';
import { comprobarMotor } from '../server/agents/motores';
import { modeloDe } from '../server/agents/modelos';
import { crearServidor } from '../server/index';
import { Contador } from '../server/tokens';
import type { Ajustes, Trabajo } from '../shared/tipos';

const settings: Ajustes = { carpetaDatos: '.', maxSimultaneos: 1, motorPorDefecto: 'opencode', asistenteCompletado: true, agentes: {}, modoMotor: 'opencode' };

test('OpenCode keeps provider models and constrains tools without putting prompts on the command line', () => {
  const request = { agente: 'investigador', nombreAgente: 'Fixture', motor: 'opencode' as const, titulo: 'Fixture', asignatura: 'fixture', cwd: process.cwd(), modelo: 'provider/model#variant', sistema: 'Private fixture instructions', reanudar: 'ses_fixture', mcp: { comando: 'node', args: ['sources.cjs'], env: { FIXTURE: 'private' } } };
  const invocation = openCodeInvocation(request);
  assert.deepEqual(invocation.args, ['run', '--standalone', '--format', 'json', '--agent', 'apuntes', '--model', 'provider/model#variant', '--session', 'ses_fixture']);
  assert.equal(invocation.args.join(' ').includes('private'), false);
  const config = JSON.parse(invocation.env.OPENCODE_CONFIG_CONTENT!);
  assert.equal(config.agents.apuntes.system, request.sistema);
  assert.deepEqual(config.agents.apuntes.permissions[0], { action: '*', resource: '*', effect: 'deny' });
  assert.equal(config.agents.apuntes.permissions.some((rule: any) => rule.action === 'shell' || rule.action === 'subagent' || rule.action === 'websearch'), false);
  assert.deepEqual(config.mcp.servers.fuentes.command, ['node', 'sources.cjs']);
  assert.equal(config.mcp.servers.fuentes.codemode, false);
  assert.equal(invocation.env.OPENCODE_CONFIG_PROJECT_DISABLE, '1');
  assert.equal(modeloDe(settings, 'redactor', 'opencode').modelo, '');
  assert.equal(modeloDe({ ...settings, modelos: { opencode: { redactor: { modelo: request.modelo, esfuerzo: 'high' } } } }, 'redactor', 'opencode').esfuerzo, undefined);
});

test('OpenCode includes cached input and reasoning once, ignoring malformed counts', () => {
  assert.deepEqual(openCodeTokens({ input: 10, output: 4, reasoning: 2, cache: { read: 20, write: 3 } }), { entrada: 33, salida: 6, cache: 20 });
  assert.deepEqual(openCodeTokens({ input: NaN, output: -3, cache: { read: '20', write: Infinity } }), { entrada: 0, salida: 0, cache: 0 });
});

test('OpenCode streams, resumes sessions, counts steps once and propagates failures through the queue', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apuntes-opencode-test-'));
  const driver = path.join(directory, 'engine.cjs');
  fs.writeFileSync(driver, `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    if (args.includes('--version')) { console.log('opencode v2.0.32'); process.exit(0); }
    if (args[0] === 'models') { console.log('local/fixture'); process.exit(0); }
    const prompt = fs.readFileSync(0, 'utf8');
    if (prompt === 'WAIT') { setInterval(() => {}, 1000); return; }
    const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);
    if (config.agents.apuntes.system !== 'Fixture system') process.exit(4);
    const resumed = args.includes('--session');
    const emit = value => console.log(JSON.stringify({ sessionID: 'ses_fixture', ...value }));
    emit({ type: 'step_start', part: { id: 'start' } });
    emit({ type: 'tool_use', part: { tool: 'read', state: { input: { filePath: 'fixture.txt' } } } });
    const step = { type: 'step_finish', part: { id: 'step1', tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 20, write: 3 } } } };
    emit(step); emit(step);
    emit({ type: 'text', part: { text: resumed ? 'Resumed fixture' : 'Completed fixture' } });
    if (prompt === 'ERROR') { emit({ type: 'error', error: { type: 'provider.failure', message: 'Fixture failure' } }); process.exitCode = 1; }
  `);
  const executable = path.join(directory, process.platform === 'win32' ? 'engine.cmd' : 'engine.sh');
  fs.writeFileSync(executable, process.platform === 'win32' ? `@echo off\r\n"${process.execPath}" "${driver}" %*\r\n` : `#!/bin/sh\nexec '${process.execPath}' '${driver}' "$@"\n`, { mode: 0o700 });
  const previous = process.env.APUNTES_MOTOR_OPENCODE;
  process.env.APUNTES_MOTOR_OPENCODE = executable;
  const queue = new Cola(1, path.join(directory, 'jobs'));
  context.after(async () => { queue.detenerTodo(); await queue.flush(); if (previous === undefined) delete process.env.APUNTES_MOTOR_OPENCODE; else process.env.APUNTES_MOTOR_OPENCODE = previous; await new Promise((resolve) => setTimeout(resolve, 500)); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.equal((await comprobarMotor('opencode')).sesion, true);
  const enqueue = (prompt: string, reanudar?: string) => queue.encolar({ agente: 'fixture', nombreAgente: 'Fixture', motor: 'opencode', titulo: 'Fixture', asignatura: 'fixture', cwd: directory, sistema: 'Fixture system', prompt, reanudar });
  const finished = async (job: Trabajo) => {
    const deadline = Date.now() + 10_000;
    while (job.estado === 'ejecutando' || job.estado === 'en-cola') { assert.ok(Date.now() < deadline, 'Queue timed out'); await new Promise((resolve) => setTimeout(resolve, 50)); }
    return job;
  };
  const first = await finished(enqueue('OK'));
  assert.equal(first.estado, 'ok');
  assert.equal(first.sesion, 'ses_fixture');
  assert.equal(first.resultado, 'Completed fixture');
  assert.deepEqual(first.tokens, { entrada: 33, salida: 6, cache: 20 });
  assert.equal(first.eventos.some((event) => event.tipo === 'herramienta'), true);
  assert.equal((await finished(enqueue('RESUME', first.sesion))).resultado, 'Resumed fixture');
  const failed = await finished(enqueue('ERROR'));
  assert.equal(failed.estado, 'error');
  assert.equal(failed.eventos.some((event) => event.texto === 'Fixture failure'), true);
  const waiting = enqueue('WAIT');
  await new Promise((resolve) => setTimeout(resolve, 200));
  queue.cancelar(waiting.id);
  assert.equal(waiting.estado, 'cancelado');

  const server = await crearServidor({ archivoAjustes: path.join(directory, 'settings.json'), carpetaDatosPorDefecto: path.join(directory, 'data'), dirTrabajos: path.join(directory, 'server-jobs'), codexUsageReader: async () => ({ windows: [], updatedAt: 0, unavailable: true }) });
  try {
    const response = await fetch(`${server.url}/api/ajustes`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...settings, carpetaDatos: path.join(directory, 'data'), agentes: { redactor: { motor: 'opencode' } }, modelos: { opencode: { redactor: { modelo: 'local/fixture#variant' }, calidad: { modelo: '' } } } }) });
    const saved = await response.json() as any;
    assert.equal(saved.modoMotor, 'opencode');
    assert.equal(saved.agentes.redactor.motor, 'opencode');
    assert.equal(saved.modelos.opencode.redactor.modelo, 'local/fixture#variant');
    assert.equal(saved.modelos.opencode.calidad.modelo, '');
    const models = await (await fetch(`${server.url}/api/modelos`)).json() as any;
    assert.equal(models.opencode.some((model: any) => model.id === 'local/fixture'), true);
    const profile = await (await fetch(`${server.url}/api/ajustes/perfil/ahorro`, { method: 'POST' })).json() as any;
    assert.equal(profile.modelos.opencode.redactor.modelo, 'local/fixture#variant');
    assert.equal((await fetch(`${server.url}/api/motores/invalid/comandos`)).status, 400);
    const durable = JSON.parse(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8'));
    assert.equal(durable.modelos.opencode.redactor.modelo, 'local/fixture#variant');
  } finally { await server.cerrar(); }
});

test('legacy token counters retain history when OpenCode starts recording usage', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'apuntes-engine-tokens-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'tokens.json');
  fs.writeFileSync(file, JSON.stringify({ desde: '2026-01-01', total: { claude: { entrada: 100, salida: 20, cache: 40 } }, hoy: { fecha: new Date().toLocaleDateString('sv'), porMotor: {} } }));
  const counter = new Contador(file);
  counter.sumar('opencode', { entrada: 3, salida: 2, cache: 1 }, 'fixture', 'document');
  await counter.flush();
  const restored = new Contador(file).leer();
  assert.equal(restored.total.claude.entrada, 100);
  assert.equal(restored.total.opencode.entrada, 3);
  assert.equal(restored.porAsignatura?.fixture.documentos.document.opencode.salida, 2);
});
