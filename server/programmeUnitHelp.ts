import { withProgrammeDirectory } from './programmeLifecycle';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CurriculumVersion } from '../shared/curriculum';
import type { ProgrammeUnitProposal, TeachingProgramme } from '../shared/teachingProgramme';
import { parseProgramme } from './teachingProgrammeStore';
import { writeFileAtomic } from './atomicFiles';
import { ErrorUsuario } from './store';
import { normalizeProgrammeReferences } from './programmeReferences';

export function parseUnitProposal(value: unknown, programme: TeachingProgramme, curriculum: CurriculumVersion, unitId?: string): ProgrammeUnitProposal['units'] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as any).units)) throw new ErrorUsuario('La propuesta debe contener una lista de unidades.');
  const units = parseProgramme(normalizeProgrammeReferences({ ...programme, units: (value as any).units }, curriculum), curriculum).units;
  if (unitId) {
    const original = programme.units.find(unit => unit.id === unitId);
    if (!original || units.length !== 1 || units[0].id !== unitId) throw new ErrorUsuario('La ayuda debe conservar la unidad seleccionada.');
    if (units[0].hours !== original.hours || units[0].sessions !== original.sessions) throw new ErrorUsuario('La propuesta debe conservar las horas y sesiones de la unidad.');
    for (const field of ['referentIds', 'criterionIds', 'contentIds'] as const) if ((original[field] ?? []).some(id => !(units[0][field] ?? []).includes(id))) throw new ErrorUsuario('La propuesta debe conservar los elementos curriculares elegidos en la unidad.');
    if (units[0].activities !== original.activities) throw new ErrorUsuario('La propuesta debe conservar el texto anterior de actividades.');
  } else if (!units.length || Math.abs(units.reduce((sum, unit) => sum + unit.hours, 0) - programme.totalHours) > 0.01) throw new ErrorUsuario('Las unidades propuestas deben repartir las horas del curso.');
  if (units.some(unit => !unit.activityPlan?.length)) throw new ErrorUsuario('La propuesta necesita actividades estructuradas en cada unidad.');
  return units;
}

/** Keep the latest AI proposal separate from authored and reviewed programme copies. */
export class ProgrammeUnitHelpStore {
  constructor(private filename: string, private validate?: (proposal: ProgrammeUnitProposal) => Promise<void>) {}
  async read(): Promise<ProgrammeUnitProposal | undefined> {
    try {
      const stat = await fs.stat(this.filename);
      if (stat.size > 2 * 1024 * 1024) throw new Error('size');
      const value = JSON.parse(await fs.readFile(this.filename, 'utf8')) as ProgrammeUnitProposal;
      if (!value || typeof value.jobId !== 'string' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 || !Array.isArray(value.units) || typeof value.createdAt !== 'string' || typeof value.curriculumVersionId !== 'string' || !['classroom', 'opposition'].includes(value.purpose) || (value.unitId !== undefined && typeof value.unitId !== 'string')) throw new Error('schema');
      await this.validate?.(value);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new ErrorUsuario('No se puede leer la propuesta de unidades. El archivo se conserva.', 409);
    }
  }
  async write(proposal: ProgrammeUnitProposal) {
    return withProgrammeDirectory(path.dirname(this.filename), async () => {
    await fs.mkdir(path.dirname(this.filename), { recursive: true });
    const serialized = JSON.stringify(proposal, null, 2) + '\n';
    if (Buffer.byteLength(serialized, 'utf8') > 2 * 1024 * 1024) throw new ErrorUsuario('La propuesta supera los 2 MB.');
    await writeFileAtomic(this.filename, serialized);
    });
  }
}
