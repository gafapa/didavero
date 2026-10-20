/** Opt-in live qualification; never reads teacher context or modifies the configured workspace. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crearServidor } from '../server/index';
import { Almacen } from '../server/store';
import { activeCurriculum } from '../shared/curriculum';
import { applyProgrammeResearch, programmeIssues } from '../shared/teachingProgramme';
import type { Trabajo } from '../shared/tipos';
import { ProgrammeProjects } from '../server/programmeProjects';
import { createHash } from 'node:crypto';
if (!process.argv.includes('--run-live')) throw new Error('Pass --run-live to authorize actual model calls.');
const argument = (name: string, fallback: string) => process.argv.find(value => value.startsWith(name + '='))?.slice(name.length + 1) || fallback;
const output = path.resolve(argument('--output', 'output/programme-live-validation-2026-10-19'));
const engine = argument('--engine', 'claude'), model = argument('--model', 'sonnet');
const cases = argument('--cases', 'fp,primary,eso,bachillerato').split(',');
const receiptFilename = path.join(output, argument('--receipt', 'live-receipt.json'));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-live-programmes-')), root = path.join(directory, 'data');
const storage = new Almacen(root); await storage.iniciar();
const settings = path.join(directory, 'settings.json');
await fs.writeFile(settings, JSON.stringify({ carpetaDatos: root, maxSimultaneos: 1, asistenteCompletado: true, motorPorDefecto: engine,
 modelos: { [engine]: { investigador: { modelo: model, esfuerzo: 'medium' }, arquitecto: { modelo: model, esfuerzo: 'medium' } } },
 agentes: { investigador: { motor: engine, modelo: model, esfuerzo: 'medium' }, arquitecto: { motor: engine, modelo: model, esfuerzo: 'medium' } } }));
const server = await crearServidor({ archivoAjustes: settings, carpetaDatosPorDefecto: root, dirTrabajos: path.join(directory, 'jobs'),
 dirBin: path.resolve('resources-bin', process.platform === 'win32' ? 'win' : 'linux'), codexUsageReader: async () => ({ windows: [], updatedAt: 0, unavailable: true }) });
await fs.mkdir(output, { recursive: true });
const receipt: any = { startedAt: new Date().toISOString(), engine, model, directory, server: server.url, cases: [] };
const persist = () => fs.writeFile(receiptFilename, JSON.stringify(receipt, null, 2));
const request = async (method: string, suffix: string, body?: unknown) => {
 const response = await fetch(server.url + suffix, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body === undefined ? undefined : JSON.stringify(body) });
 const result = await response.json(); if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(result)}`); return result;
};
async function finished(job: Trabajo, entry: any, phase: string) {
 const started = Date.now(); let lastProgress = 0;
 while (Date.now() - started < 15 * 60_000) {
  const current = await request('GET', `/api/trabajos/${job.id}`);
  const value: Trabajo = current.trabajo ?? current;
  if (!['en-cola', 'ejecutando'].includes(value.estado)) {
   entry[phase] = value; entry[phase + 'Model'] = value.eventos?.find(event => event.texto.startsWith('Conectado ('))?.texto; await persist();
   console.log(JSON.stringify({ case: entry.key, phase, state: value.estado, result: value.resultado, tokens: value.tokens }));
   if (value.estado !== 'ok') throw new Error(value.resultado || 'Live job failed'); return value;
  }
  if (Date.now() - lastProgress > 30000) { console.log(JSON.stringify({ case: entry.key, phase, elapsedSeconds: Math.round((Date.now()-started)/1000), last: value.eventos?.at(-1)?.texto?.slice(0, 160) })); lastProgress = Date.now(); }
  await new Promise(resolve => setTimeout(resolve, 1500));
 }
 throw new Error('Live job exceeded 15 minutes; no automatic regeneration was requested.');
}
try {
 for (const key of cases) {
  const entry: any = { key }; receipt.cases.push(entry); await persist();
  try {
   const fixture = JSON.parse(await fs.readFile(path.join(output, 'fixtures', key + '.json'), 'utf8'));
   const subject = await storage.crearAsignatura({ nombre: `Validation ${key}`, etapa: fixture.curriculum.profile.stage, curso: fixture.curriculum.profile.course, idioma: 'Castellano' });
   const curricula = storage.curriculum(subject.id); await curricula.saveDraft(fixture.curriculum, 0); const curriculum = activeCurriculum(await curricula.activate(1))!;
   const collection = `/api/asignaturas/${subject.id}/programaciones`;
   const purpose = key === 'opposition' ? 'opposition' : 'classroom';
   const project = await request('POST', collection, { title: `Validación ${fixture.curriculum.profile.subject}`, purpose });
   const base = `${collection}/${project.id}?purpose=${purpose}`, route = (suffix: string) => `${collection}/${project.id}/${suffix}?purpose=${purpose}`;
   let response = await request('GET', base), programme = response.state.draft;
   programme.totalHours = fixture.hours;
   if (fixture.presentation) programme.presentation = fixture.presentation;
   programme.sections.context = 'Contexto ficticio para validación: grupo de 24 estudiantes, ritmos diversos, recursos digitales compartidos y aprendizaje cooperativo. No hay datos personales ni un centro real. Las horas son una decisión de esta prueba, no un horario normativo verificado.';
   programme.sections.requirements = 'La programación debe distinguir los requisitos documentados de las decisiones docentes. Los porcentajes, mínimos y calendario concretos quedan como propuestas pendientes de acuerdo del centro.';
   if (fixture.selectionRequirements) programme.sections.selectionRequirements = fixture.selectionRequirements;
   await request('PUT', base, { programme, expectedRevision: response.state.revision });
   entry.subjectId = subject.id; entry.projectId = project.id; entry.curriculumCount = curriculum.elements.length; await persist();
   const reuse = argument('--reuse-research', '');
   if (reuse && key === 'fp') {
    const fingerprint = createHash('sha256').update(JSON.stringify({ subjectContext: '', audience: '', programmeContext: programme.sections.context, teacherRequirements: programme.sections.requirements, selectionRequirements: '' })).digest('hex');
    await (await new ProgrammeProjects(storage.dirAsignatura(subject.id), curricula).research(project.id, purpose, fingerprint)).accept(JSON.parse(await fs.readFile(reuse, 'utf8')), 0, 'reused-real-research');
    entry.reusedResearch = path.resolve(reuse);
   } else await finished(await request('POST', route('investigar'), {}), entry, 'researchJob');
   response = await request('GET', base);
   await fs.writeFile(path.join(output, `${key}-research.json`), JSON.stringify(response.research, null, 2));
   programme = applyProgrammeResearch(response.state.draft, response.research.result, response.research.revision);
   const saved = await request('PUT', base, { programme, expectedRevision: response.state.revision });
   await finished(await request('POST', route('generar'), { expectedRevision: saved.revision, instructions: 'Redacta una programación operativa y concreta, sin texto de relleno. Desarrolla actividades estructuradas con referencias exactas. No inventes la convocatoria ni acuerdos del centro. Mantén explícitas las cuestiones pendientes de investigación. No uses marcadores de texto por completar como redacción final.' }), entry, 'generationJob');
   response = await request('GET', base);
   entry.issues = programmeIssues(response.state.draft, curriculum); entry.units = response.state.draft.units.length; entry.activities = response.state.draft.units.reduce((count: number, unit: any) => count + (unit.activityPlan?.length || 0), 0);
   entry.researchStatus = response.research.result.status; entry.questions = response.research.result.questions;
   await fs.writeFile(path.join(output, `${key}-programme.json`), JSON.stringify(response, null, 2));
   for (const format of ['md', 'pdf', 'docx', 'odt']) {
    const exported = await fetch(server.url + route('exportar') + '&format=' + format);
    if (!exported.ok) throw new Error(`Export ${format}: ${await exported.text()}`);
    await fs.writeFile(path.join(output, `${key}-programme.${format}`), Buffer.from(await exported.arrayBuffer()));
   }
   entry.completedAt = new Date().toISOString(); console.log(JSON.stringify({ case: key, issues: entry.issues, units: entry.units, activities: entry.activities }));
  } catch (error) { entry.error = String(error); console.log(JSON.stringify({ case: key, error: entry.error })); }
  await persist();
 }
} finally { receipt.finishedAt = new Date().toISOString(); await persist(); await server.cerrar(); }
