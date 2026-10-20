import { withProgrammeDirectory } from './programmeLifecycle';
import { programmeReferenceElements } from '../shared/programmeUnits';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from './atomicFiles';
import { CurriculumError, type CurriculumStore } from './curriculumStore';
import { programmeIssues, PROGRAMME_SECTIONS, type ProgrammeState, type TeachingProgramme, type ProgrammePurpose } from '../shared/teachingProgramme';
import type { CurriculumVersion } from '../shared/curriculum';
import { ProgrammeResearchStore, parseProgrammeResearch } from './programmeResearchStore';
import { programmeSectionDefinitions } from '../shared/teachingProgramme';
import { parseProgrammePresentation } from '../shared/programmePresentation';

const pending = new Map<string, Promise<unknown>>();
export function parseProgrammePurpose(value: unknown): ProgrammePurpose {
  if (value === undefined) return 'classroom';
  if (value !== 'classroom' && value !== 'opposition') throw new CurriculumError('Finalidad de programación no válida.');
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CurriculumError('Formato de programación no válido.');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 30000): string {
  if (typeof value !== 'string' || value.length > max) throw new CurriculumError('Texto de programación no válido o demasiado largo.');
  return value.trim();
}
function hours(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10000) throw new CurriculumError('Las horas deben ser un número entre 0 y 10000.');
  return value;
}
export function parseProgramme(value: unknown, curriculum: CurriculumVersion): TeachingProgramme {
  const input = object(value), sections = object(input.sections);
  if (input.curriculumVersionId !== curriculum.id) throw new CurriculumError('La programación debe conservar la versión de currículo de partida.');
  if (!Array.isArray(input.units) || input.units.length > 200) throw new CurriculumError('Lista de unidades no válida.');
  const references = (value: unknown, kinds: string[]) => {
    if (!Array.isArray(value) || value.length > 5000 || value.some(id => typeof id !== 'string' || !curriculum.elements.some(element => element.id === id && kinds.includes(element.kind)))) throw new CurriculumError('Hay referencias ajenas al currículo de esta programación.');
    return [...new Set(value)] as string[];
  };
  const units = input.units.map(value => {
    const unit = object(value), id = text(unit.id, 80);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(id)) throw new CurriculumError('Identificador de unidad no válido.');
    const sessions = (value: unknown) => { if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10000) throw new CurriculumError('Sesiones no válidas.'); return Number(value); };
    const result = { id, title: text(unit.title, 500), hours: hours(unit.hours), period: text(unit.period, 200),
      criterionIds: references(unit.criterionIds, ['assessmentCriterion']), contentIds: references(unit.contentIds, ['knowledge', 'contentBlock']),
      activities: text(unit.activities), evidence: text(unit.evidence),
      ...(unit.referentIds !== undefined ? { referentIds: references(unit.referentIds, ['learningOutcome', 'specificCompetence']) } : {}),
      ...(unit.learningSituation !== undefined ? { learningSituation: text(unit.learningSituation) } : {}),
      ...(unit.sessions !== undefined ? { sessions: sessions(unit.sessions) } : {}) };
    if (unit.activityPlan === undefined) return result;
    if (!Array.isArray(unit.activityPlan) || unit.activityPlan.length > 200) throw new CurriculumError('Lista de actividades no válida.');
    const allowed = new Set(programmeReferenceElements(curriculum, result).map(element => element.id));
    const activityPlan = unit.activityPlan.map(value => {
      const activity = object(value), activityId = text(activity.id, 80);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(activityId)) throw new CurriculumError('Identificador de actividad no válido.');
      const parsed = { id: activityId, title: text(activity.title, 500), hours: hours(activity.hours),
        description: text(activity.description), objectives: text(activity.objectives), evidence: text(activity.evidence), instrument: text(activity.instrument), resources: text(activity.resources),
        referentIds: references(activity.referentIds, ['learningOutcome', 'specificCompetence']), criterionIds: references(activity.criterionIds, ['assessmentCriterion']), contentIds: references(activity.contentIds, ['contentBlock', 'knowledge']),
        ...(activity.sessions !== undefined ? { sessions: sessions(activity.sessions) } : {}) };
      if ([...parsed.referentIds, ...parsed.criterionIds, ...parsed.contentIds].some(id => !allowed.has(id))) throw new CurriculumError('Vincula primero a la unidad los elementos curriculares de sus actividades.');
      return parsed;
    });
    if (new Set(activityPlan.map(activity => activity.id)).size !== activityPlan.length) throw new CurriculumError('Hay actividades repetidas en una unidad.');
    return { ...result, activityPlan };
  });
  if (new Set(units.map(unit => unit.id)).size !== units.length) throw new CurriculumError('Hay unidades repetidas.');
  const parseSections = (value: unknown): NonNullable<TeachingProgramme['researchedSections']> | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 300) throw new CurriculumError('Lista de apartados no válida.');
    const result = value.map(value => {
      const item = object(value), id = text(item.id, 80), title = text(item.title, 500);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(id) || !title || typeof item.mandatory !== 'boolean' || !Array.isArray(item.sourceIds) || item.sourceIds.length > 30 || item.sourceIds.some(value => typeof value !== 'string' || value.length > 80)) throw new CurriculumError('Apartado investigado no válido.');
      return { id, title, description: text(item.description, 10000), mandatory: item.mandatory, sourceIds: item.sourceIds as string[], text: text(item.text) };
    });
    return result;
  };
  const researchedSections = parseSections(input.researchedSections), archivedSections = parseSections(input.archivedSections);
  if (researchedSections && new Set(researchedSections.map(item => item.id)).size !== researchedSections.length) throw new CurriculumError('Hay apartados repetidos.');
  if (input.researchRevision !== undefined && (!Number.isSafeInteger(input.researchRevision) || Number(input.researchRevision) < 0)) throw new CurriculumError('Revisión de estructura no válida.');
  let presentation;
  try { if (input.presentation !== undefined) presentation = parseProgrammePresentation(input.presentation); }
  catch (error) { throw new CurriculumError((error as Error).message); }
  return { purpose: parseProgrammePurpose(input.purpose), title: text(input.title, 500), curriculumVersionId: curriculum.id, totalHours: hours(input.totalHours), units,
    ...(presentation ? { presentation } : {}),
    sections: Object.fromEntries(Object.keys(PROGRAMME_SECTIONS).map(key => [key, text(sections[key])])) as TeachingProgramme['sections'],
    ...(researchedSections ? { researchedSections } : {}), ...(archivedSections ? { archivedSections } : {}), ...(input.researchRevision !== undefined ? { researchRevision: Number(input.researchRevision) } : {}) };
}

export class TeachingProgrammeStore {
  constructor(public filename: string, private curricula: CurriculumStore, private purpose: ProgrammePurpose = 'classroom', private initialVersionId?: string) {}
  async curriculum(versionId: string) {
    const version = (await this.curricula.read()).versions.find(item => item.id === versionId);
    if (!version) throw new CurriculumError('No se encuentra la versión de currículo de esta programación.');
    return version;
  }
  async read(): Promise<ProgrammeState> {
    try {
      const state = JSON.parse(await fs.readFile(this.filename, 'utf8')) as ProgrammeState;
      if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.appliedJobs) || state.appliedJobs.some(id => typeof id !== 'string')) throw new Error('schema');
      if (state.reviewed !== undefined && (!state.reviewed || typeof state.reviewed !== 'object' || Array.isArray(state.reviewed))) throw new Error('review');
      for (const programme of [state.draft, state.reviewed?.programme]) if (programme !== undefined) {
        if (parseProgramme(programme, await this.curriculum(programme.curriculumVersionId)).purpose !== this.purpose) throw new Error('purpose');
      }
      if (state.reviewed && (!state.reviewed.programme || typeof state.reviewed.reviewedAt !== 'string')) throw new Error('review');
      if (state.reviewed?.research !== undefined) {
        const report = state.reviewed.research;
        parseProgrammeResearch(report);
        const curriculum = await this.curriculum(state.reviewed.programme.curriculumVersionId);
        if (report.curriculumVersionId !== curriculum.id || report.purpose !== this.purpose || JSON.stringify(report.profile) !== JSON.stringify(curriculum.profile) || typeof report.researchedAt !== 'string' || typeof report.contextFingerprint !== 'string') throw new Error('research');
        if (JSON.stringify(report.outline) !== JSON.stringify(programmeSectionDefinitions(state.reviewed.programme))) throw new Error('outline');
      }
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, revision: 0, appliedJobs: [] };
      throw new CurriculumError('No se puede leer la programación. Conserva el archivo y recupera una copia válida.', 500);
    }
  }
  save(value: unknown, expectedRevision: number, options: { confirmed?: unknown; jobId?: string } = {}) {
    const key = path.resolve(this.filename);
    const operation = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(() => withProgrammeDirectory(path.dirname(key), async () => {
      const state = await this.read();
      if (options.jobId && state.appliedJobs.includes(options.jobId)) return state;
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== state.revision) throw new CurriculumError('La programación ha cambiado. Recarga antes de guardar; tus cambios se conservan en esta pantalla.', 409);
      const input = object(value);
      const curriculum = await this.curriculum(text(input.curriculumVersionId, 80));
      const existing = state.draft ?? state.reviewed?.programme;
      if (!existing && (this.initialVersionId ?? (await this.curricula.read()).activeVersionId) !== curriculum.id) throw new CurriculumError('Crea la programación a partir del currículo de partida.');
      if (existing && existing.curriculumVersionId !== curriculum.id) throw new CurriculumError('No cambies la versión de currículo de una programación existente.');
      const programme = parseProgramme(value, curriculum);
      if (programme.purpose !== this.purpose) throw new CurriculumError('Esta programación pertenece a otra finalidad.');
      if (options.confirmed !== undefined) {
        if (options.confirmed !== true) throw new CurriculumError('Confirma la revisión de la programación.');
        const issues = programmeIssues(programme, curriculum);
        if (issues.length) throw new CurriculumError(issues.join(' '));
        state.reviewed = { programme: structuredClone(programme), reviewedAt: new Date().toISOString() };
        if (path.basename(path.dirname(path.dirname(key))) === 'programaciones') {
          const report = await new ProgrammeResearchStore(path.join(path.dirname(key), `research-${this.purpose}.json`), {
            curriculumVersionId: curriculum.id, purpose: this.purpose, profile: curriculum.profile, contextFingerprint: '',
          }).read();
          if (!report.result || report.revision !== programme.researchRevision || JSON.stringify(report.result.outline) !== JSON.stringify(programmeSectionDefinitions(programme))) throw new CurriculumError('La estructura investigada ha cambiado. Recarga los apartados antes de marcar la programación como revisada.', 409);
          state.reviewed.research = structuredClone(report.result);
        }
      }
      state.draft = programme;
      if (options.jobId) state.appliedJobs.push(options.jobId);
      state.revision++;
      await fs.mkdir(path.dirname(key), { recursive: true });
      await writeFileAtomic(key, JSON.stringify(state, null, 2) + '\n');
      return state;
    }));
    pending.set(key, operation);
    void operation.finally(() => { if (pending.get(key) === operation) pending.delete(key); }).catch(() => {});
    return operation;
  }
}
