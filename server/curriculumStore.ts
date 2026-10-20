import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeFileAtomic } from './atomicFiles';
import { activeCurriculum, curriculumIssues, curriculumPromptText, emptyCurriculumState,
  CURRICULUM_KINDS, type CurriculumDraft, type CurriculumProfile, type CurriculumState } from '../shared/curriculum';

export class CurriculumError extends Error {
  get statusCode() { return this.status; }
  constructor(message: string, public status = 400) { super(message); }
}
const pending = new Map<string, Promise<unknown>>();
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CurriculumError('Formato de currículo no válido.');
  return value as Record<string, unknown>;
};
function string(value: unknown, max = 20000): string {
  if (typeof value !== 'string' || value.length > max) throw new CurriculumError('Campo de currículo no válido o demasiado largo.');
  return value.trim();
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new CurriculumError('Lista de currículo no válida o demasiado larga.');
  return value;
}
function id(value: unknown): string {
  const result = string(value, 80);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(result)) throw new CurriculumError('Identificador de currículo no válido.');
  return result;
}
function unique(values: { id: string }[]) {
  if (new Set(values.map((value) => value.id)).size !== values.length) throw new CurriculumError('Hay identificadores repetidos en el currículo.');
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new CurriculumError('Tipo de currículo no válido.');
  return value as T;
}

/** Validate every boundary, including model output and manually imported JSON. */
export function parseCurriculumDraft(value: unknown): CurriculumDraft {
  const input = record(value);
  const profile = record(input.profile);
  const parsedProfile: CurriculumProfile = {
    stage: string(profile.stage, 80), territory: string(profile.territory, 100), academicYear: string(profile.academicYear, 9),
    subject: string(profile.subject, 250), course: string(profile.course, 100),
    scope: choice(profile.scope, ['course', 'cycle', 'stage', 'module']), model: choice(profile.model, ['general', 'vocational']),
    qualification: string(profile.qualification, 250), moduleCode: string(profile.moduleCode, 80),
  };
  const sources = list(input.sources, 100).map((value) => {
    const source = record(value);
    return { id: id(source.id), title: string(source.title, 1000), url: string(source.url, 3000),
      origin: choice(source.origin, ['official', 'provided']), filename: string(source.filename, 250),
      publishedOn: string(source.publishedOn, 10), applicableFrom: string(source.applicableFrom, 100),
      notes: string(source.notes), reviewed: source.reviewed === true };
  });
  const elements = list(input.elements, 1500).map((value) => {
    const element = record(value);
    return { id: id(element.id), kind: choice(element.kind, Object.keys(CURRICULUM_KINDS) as (keyof typeof CURRICULUM_KINDS)[]),
      code: string(element.code, 100), text: string(element.text), parentId: string(element.parentId, 80),
      sourceId: string(element.sourceId, 80), locator: string(element.locator, 1000), excerpt: string(element.excerpt, 40000),
      notes: string(element.notes), reviewed: element.reviewed === true };
  });
  const links = list(input.links, 5000).map((value) => {
    const link = record(value);
    return { id: id(link.id), fromId: string(link.fromId, 80), toId: string(link.toId, 80),
      origin: choice(link.origin, ['official', 'teacher']), sourceId: string(link.sourceId, 80),
      locator: string(link.locator, 1000), notes: string(link.notes) };
  });
  unique(sources); unique(elements); unique(links);
  return { profile: parsedProfile, sources, elements, links, completenessReviewed: input.completenessReviewed === true };
}

export class CurriculumStore {
  private filename: string;
  constructor(directory: string) { this.filename = path.join(directory, 'curriculum', 'state.json'); }

  async read(): Promise<CurriculumState> {
    try {
      const state = JSON.parse(await fs.readFile(this.filename, 'utf8')) as CurriculumState;
      if (state.schemaVersion !== 1 || !Number.isInteger(state.revision) || state.revision < 0 || !Array.isArray(state.versions) || !Array.isArray(state.appliedJobs)) throw new Error('schema');
      if (state.draft) parseCurriculumDraft(state.draft);
      for (const version of state.versions) {
        id(version.id);
        if (!version.activatedAt) throw new Error('version');
        parseCurriculumDraft(version);
        if (curriculumIssues(version).length) throw new Error('Invalid active snapshot');
      }
      unique(state.versions);
      if (state.activeVersionId && !activeCurriculum(state)) throw new Error('active version');
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyCurriculumState();
      throw new CurriculumError('No se puede leer el currículo estructurado. Conserva los archivos y recupera una copia válida.', 500);
    }
  }

  async promptText(): Promise<string> {
    const active = activeCurriculum(await this.read());
    return active ? curriculumPromptText(active) : '';
  }

  private update(expectedRevision: number, change: (state: CurriculumState) => void | false, jobId?: string): Promise<CurriculumState> {
    const key = path.resolve(this.filename);
    const operation = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const state = await this.read();
      if (jobId && state.appliedJobs.includes(jobId)) return state;
      if (!Number.isInteger(expectedRevision) || state.revision !== expectedRevision) throw new CurriculumError('El currículo ha cambiado. Recarga antes de guardar; tus cambios no se han sobrescrito.', 409);
      if (change(state) === false) return state;
      state.revision++;
      await fs.mkdir(path.dirname(this.filename), { recursive: true });
      await writeFileAtomic(this.filename, JSON.stringify(state, null, 2) + '\n');
      return state;
    });
    pending.set(key, operation);
    void operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => {});
    return operation;
  }

  saveDraft(value: unknown, expectedRevision: number) {
    const draft = parseCurriculumDraft(value);
    return this.update(expectedRevision, (state) => { state.draft = draft; });
  }

  async acceptExtraction(value: unknown, expectedRevision: number, jobId: string) {
    const current = await this.read();
    if (current.appliedJobs.includes(jobId)) return current;
    const draft = parseCurriculumDraft(value);
    draft.completenessReviewed = false;
    draft.elements.forEach((element) => { element.reviewed = false; });
    draft.sources.forEach((source) => { source.reviewed = false; });
    return this.update(expectedRevision, (state) => {
      if (state.appliedJobs.includes(jobId)) return false;
      state.draft = draft;
      state.appliedJobs.push(jobId);
    }, jobId);
  }

  activate(expectedRevision: number, review?: { draft: unknown; confirmed: unknown }) {
    return this.update(expectedRevision, (state) => {
      if (review && review.confirmed !== true) throw new CurriculumError('Confirma la revisión global del currículo antes de activarlo.');
      const draft = review ? parseCurriculumDraft(review.draft) : state.draft;
      if (!draft) throw new CurriculumError('No hay borrador para activar.');
      if (review) {
        draft.completenessReviewed = true;
        draft.sources.forEach((source) => { source.reviewed = true; });
        draft.elements.forEach((element) => { element.reviewed = true; });
      }
      const issues = curriculumIssues(draft);
      if (issues.length) throw new CurriculumError(`Revisa el currículo antes de activarlo: ${issues.slice(0, 5).map((issue) => issue.message).join(' ')}`);
      const version = { ...structuredClone(draft), id: randomUUID(), activatedAt: new Date().toISOString(), reviewMethod: review ? 'global' as const : 'individual' as const };
      state.versions.push(version);
      state.activeVersionId = version.id;
      delete state.draft;
    });
  }

  restoreDraft(versionId: string, expectedRevision: number) {
    return this.update(expectedRevision, (state) => {
      const version = state.versions.find((item) => item.id === versionId);
      if (!version) throw new CurriculumError('Versión de currículo no encontrada.', 404);
      state.draft = parseCurriculumDraft(version);
    });
  }

  discardDraft(expectedRevision: number) {
    return this.update(expectedRevision, (state) => { delete state.draft; });
  }

}
