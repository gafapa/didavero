import { withProgrammeDirectory } from './programmeLifecycle';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { activeCurriculum } from '../shared/curriculum';
import { emptyProgramme, type CreateProgrammeRequest, type ProgrammeProject, type ProgrammeProjectSummary, type ProgrammePurpose } from '../shared/teachingProgramme';
import { CurriculumError, type CurriculumStore } from './curriculumStore';
import { TeachingProgrammeStore, parseProgramme, parseProgrammePurpose } from './teachingProgrammeStore';
import { writeFileAtomic } from './atomicFiles';
import { ProgrammeResearchStore } from './programmeResearchStore';

export class ProgrammeProjects {
  constructor(private directory: string, private curricula: CurriculumStore) {}
  projectDirectory(id: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/.test(id)) throw new CurriculumError('Identificador de programación no válido.');
    return path.join(this.directory, 'programaciones', id);
  }
  async get(id: string): Promise<ProgrammeProject> {
    try {
      const project = JSON.parse(await fs.readFile(path.join(this.projectDirectory(id), 'project.json'), 'utf8')) as ProgrammeProject;
      if (project.id !== id || typeof project.title !== 'string' || !project.title || typeof project.curriculumVersionId !== 'string' || typeof project.createdAt !== 'string') throw new Error('schema');
      parseProgrammePurpose(project.initialPurpose);
      return project;
    } catch (error) {
      if (error instanceof CurriculumError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CurriculumError('Programación no encontrada.', 404);
      throw new CurriculumError('No se puede leer la programación. Conserva sus archivos y recupera una copia válida.', 500);
    }
  }
  async store(id: string, purpose: ProgrammePurpose = 'classroom') {
    const project = await this.get(id);
    return new TeachingProgrammeStore(path.join(this.projectDirectory(id), purpose === 'opposition' ? 'opposition.json' : 'state.json'), this.curricula, purpose, project.curriculumVersionId);
  }
  async research(id: string, purpose: ProgrammePurpose = 'classroom', contextFingerprint = '') {
    const project = await this.get(id), store = await this.store(id, purpose);
    const curriculum = await store.curriculum(project.curriculumVersionId);
    return new ProgrammeResearchStore(path.join(this.projectDirectory(id), `research-${purpose}.json`), { curriculumVersionId: curriculum.id, purpose, profile: curriculum.profile, contextFingerprint });
  }
  async list(): Promise<ProgrammeProjectSummary[]> {
    const root = path.join(this.directory, 'programaciones');
    let entries;
    try { entries = await fs.readdir(root, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const projects: ProgrammeProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const project = await this.get(entry.name), state = await (await this.store(project.id, project.initialPurpose)).read();
      const programme = state.draft ?? state.reviewed?.programme;
      projects.push({ ...project, title: programme?.title || project.title, unitCount: programme?.units.length ?? 0,
        totalHours: programme?.totalHours ?? 0, reviewed: !!state.reviewed });
    }
    return projects.sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  }
  async moveToTrash(id: string, trashDirectory: string, subjectId: string) {
    const directory = this.projectDirectory(id);
    return withProgrammeDirectory(directory, async () => {
      await this.get(id);
      await fs.mkdir(trashDirectory, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.rename(directory, path.join(trashDirectory, `${timestamp}-${subjectId}--programacion--${id}`));
    });
  }
  async create(input: CreateProgrammeRequest) {
    const curriculum = activeCurriculum(await this.curricula.read());
    if (!curriculum) throw new CurriculumError('Activa el currículo antes de crear una programación.');
    if (typeof input?.title !== 'string' || !input.title.trim()) throw new CurriculumError('Escribe un nombre para la programación.');
    const purpose = parseProgrammePurpose(input.purpose), programme = emptyProgramme(curriculum, purpose);
    programme.title = input.title; programme.totalHours = input.totalHours === undefined ? 0 : input.totalHours;
    programme.sections.context = input.context ?? '';
    programme.sections.requirements = input.requirements ?? '';
    programme.sections.selectionRequirements = input.selectionRequirements ?? '';
    const parsed = parseProgramme(programme, curriculum);
    const project: ProgrammeProject = { id: randomUUID(), title: parsed.title, initialPurpose: purpose, curriculumVersionId: curriculum.id, createdAt: new Date().toISOString() };
    const destination = this.projectDirectory(project.id);
    const directory = path.join(path.dirname(destination), `.creating-${project.id}`);
    await fs.mkdir(directory, { recursive: true });
    await writeFileAtomic(path.join(directory, 'project.json'), JSON.stringify(project, null, 2) + '\n');
    await new TeachingProgrammeStore(path.join(directory, purpose === 'opposition' ? 'opposition.json' : 'state.json'), this.curricula, purpose, curriculum.id).save(parsed, 0);
    await withProgrammeDirectory(destination, () => fs.rename(directory, destination), false);
    return project;
  }
}
