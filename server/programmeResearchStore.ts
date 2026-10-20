import { withProgrammeDirectory } from './programmeLifecycle';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from './atomicFiles';
import { CurriculumError } from './curriculumStore';
import { isOfficialCurriculumUrl, type CurriculumProfile } from '../shared/curriculum';
import type { ProgrammeResearchResult, ProgrammeResearchSource, ProgrammeResearchState } from '../shared/programmeResearch';
import type { ProgrammePurpose } from '../shared/teachingProgramme';

const pending = new Map<string, Promise<unknown>>();
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CurriculumError('Formato de investigación no válido.');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 10000): string {
  if (typeof value !== 'string' || value.length > max) throw new CurriculumError('Texto de investigación no válido o demasiado largo.');
  return value.trim();
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new CurriculumError('Lista de investigación no válida o demasiado larga.');
  return value;
}
function id(value: unknown): string {
  const result = text(value, 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(result)) throw new CurriculumError('Identificador de investigación no válido.');
  return result;
}
function unique(items: { id: string }[]) {
  if (new Set(items.map(item => item.id)).size !== items.length) throw new CurriculumError('Identificadores de investigación repetidos.');
}
export function parseProgrammeResearch(value: unknown): ProgrammeResearchResult {
  const input = record(value);
  if (!['ready', 'needsInformation'].includes(String(input.status))) throw new CurriculumError('Estado de investigación no válido.');
  const sources = list(input.sources, 30).map(value => {
    const source = record(value), url = text(source.url, 3000), kind = source.kind;
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new CurriculumError('Enlace de investigación no válido.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new CurriculumError('Enlace de investigación no válido.');
    if (kind !== 'official' && kind !== 'example') throw new CurriculumError('Tipo de fuente no válido.');
    if (kind === 'official' && !isOfficialCurriculumUrl(url)) throw new CurriculumError('Los requisitos necesitan fuentes en dominios oficiales admitidos.');
    const title = text(source.title, 1000), locator = text(source.locator, 2000);
    if (!title || !locator) throw new CurriculumError('Identifica el título y la localización de cada fuente.');
    return { id: id(source.id), title, url, kind: kind as 'official' | 'example', locator, publishedOn: text(source.publishedOn, 100), ...(source.excerpt === undefined ? {} : { excerpt: text(source.excerpt, 2000) }) };
  });
  unique(sources);
  const references = (value: unknown, mandatory: boolean) => {
    const result = [...new Set(list(value, 30).map(id))];
    if (result.some(ref => !sources.some(source => source.id === ref))) throw new CurriculumError('Referencia de investigación no encontrada.');
    if (mandatory && !result.some(ref => sources.some(source => source.id === ref && source.kind === 'official'))) throw new CurriculumError('Cada requisito debe citar al menos una fuente oficial.');
    return result;
  };
  const outline = list(input.outline, 60).map(value => {
    const item = record(value);
    if (typeof item.mandatory !== 'boolean') throw new CurriculumError('Indica si cada apartado es requisito o propuesta.');
    const title = text(item.title, 500), description = text(item.description);
    if (!title || !description) throw new CurriculumError('Completa los apartados de la estructura.');
    return { id: id(item.id), title, description, mandatory: item.mandatory, sourceIds: references(item.sourceIds, item.mandatory) };
  });
  unique(outline);
  const requirements = list(input.requirements, 100).map(value => {
    const item = record(value), description = text(item.text);
    if (!description) throw new CurriculumError('Requisito vacío.');
    return { text: description, sourceIds: references(item.sourceIds, true) };
  });
  const questions = list(input.questions, 30).map(value => text(value, 2000));
  if (questions.some(question => !question)) throw new CurriculumError('Cuestión pendiente vacía.');
  if (input.status === 'needsInformation' && !questions.length) throw new CurriculumError('Indica qué información falta para completar la investigación.');
  if (input.status === 'ready' && (!outline.length || !sources.some(source => source.kind === 'official') || questions.length)) throw new CurriculumError('Una investigación completa necesita estructura, fuentes oficiales y ninguna cuestión pendiente.');
  const summary = text(input.summary, 15000);
  if (!summary) throw new CurriculumError('Resume el resultado de la investigación.');
  return { status: input.status as ProgrammeResearchResult['status'], summary, contextSummary: text(input.contextSummary, 15000), outline, requirements, sources, questions };
}

export class ProgrammeResearchStore {
  constructor(public filename: string, private target: { curriculumVersionId: string; purpose: ProgrammePurpose; profile: CurriculumProfile; contextFingerprint: string }) {}
  async read(): Promise<ProgrammeResearchState> {
    try {
      const state = JSON.parse(await fs.readFile(this.filename, 'utf8')) as ProgrammeResearchState;
      if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.appliedJobs) || state.appliedJobs.some(value => typeof value !== 'string')) throw new Error('schema');
      if (state.result !== undefined) {
        parseProgrammeResearch(state.result);
        if (state.result.curriculumVersionId !== this.target.curriculumVersionId || state.result.purpose !== this.target.purpose || JSON.stringify(state.result.profile) !== JSON.stringify(this.target.profile) || typeof state.result.researchedAt !== 'string' || typeof state.result.contextFingerprint !== 'string') throw new Error('target');
      }
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, revision: 0, appliedJobs: [] };
      throw new CurriculumError('No se puede leer la investigación. Conserva sus archivos y recupera una copia válida.', 500);
    }
  }
  accept(value: unknown, expectedRevision: number, jobId: string, sourceChecks: Record<string, NonNullable<ProgrammeResearchSource['excerptCheck']>> = {}) {
    const key = path.resolve(this.filename);
    const operation = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(() => withProgrammeDirectory(path.dirname(key), async () => {
      const state = await this.read();
      if (state.appliedJobs.includes(jobId)) return state;
      if (!Number.isSafeInteger(expectedRevision) || state.revision !== expectedRevision) throw new CurriculumError('La investigación ha cambiado. Se conserva el resultado del trabajo para revisarlo.', 409);
      state.result = { ...parseProgrammeResearch(value), ...structuredClone(this.target), researchedAt: new Date().toISOString() };
      state.result.sources = state.result.sources.map(source => sourceChecks[source.id] ? { ...source, excerptCheck: structuredClone(sourceChecks[source.id]) } : source);
      state.revision++; state.appliedJobs.push(jobId);
      await fs.mkdir(path.dirname(key), { recursive: true });
      await writeFileAtomic(key, JSON.stringify(state, null, 2) + '\n');
      return state;
    }));
    pending.set(key, operation);
    void operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => {});
    return operation;
  }
}
