import { programmeReferenceElements, programmeUnitLabels, unitPlanningIssues } from './programmeUnits';
import { curriculumElementLabels, type CurriculumVersion, type CurriculumElement } from './curriculum';
import type { ProgrammeResearch, ProgrammeResearchOutline, ProgrammeResearchState } from './programmeResearch';
import type { ProgrammePresentation } from './programmePresentation';

export const PROGRAMME_SECTIONS = {
  context: 'Contextualización del grupo y del centro',
  methodology: 'Metodología y organización',
  evaluation: 'Evaluación y calificación',
  recovery: 'Recuperación y refuerzo',
  inclusion: 'Atención a la diversidad',
  resources: 'Recursos y materiales',
  monitoring: 'Seguimiento y revisión de la programación',
  requirements: 'Normativa autonómica y requisitos del centro',
  learningSituations: 'Situaciones de aprendizaje y enfoque competencial',
  familyCommunication: 'Acción tutorial y comunicación con las familias',
  workplaceLearning: 'Formación en empresa y coordinación con el centro',
  coordination: 'Coordinación del módulo y del ciclo',
  selectionRequirements: 'Convocatoria, especialidad y requisitos de presentación',
} as const;
export const PROGRAMME_PURPOSES = { classroom: 'Uso docente en el centro', opposition: 'Oposiciones' } as const;
export const PROGRAMME_STAGE_LABELS: Record<string, string> = { primaria: 'Primaria', eso: 'ESO', bachillerato: 'Bachillerato', 'fp-basica': 'FP de grado básico', 'fp-medio': 'FP de grado medio', 'fp-superior': 'FP de grado superior' };
export type ProgrammePurpose = keyof typeof PROGRAMME_PURPOSES;
export type ProgrammeSection = keyof typeof PROGRAMME_SECTIONS;
export interface TeachingActivity {
  id: string; title: string; hours: number; sessions?: number;
  description: string; objectives: string; evidence: string; instrument: string; resources: string;
  referentIds: string[]; criterionIds: string[]; contentIds: string[];
}
export interface TeachingUnit {
  id: string; title: string; hours: number; period: string;
  criterionIds: string[]; contentIds: string[];
  activities: string; evidence: string;
  referentIds?: string[]; learningSituation?: string; sessions?: number;
  activityPlan?: TeachingActivity[];
}
export interface ProgrammeUnitProposal {
  jobId: string; expectedRevision: number; curriculumVersionId: string; purpose: ProgrammePurpose;
  unitId?: string; units: TeachingUnit[]; createdAt: string; applied?: boolean;
}
export interface TeachingProgramme {
  purpose: ProgrammePurpose;
  title: string; curriculumVersionId: string; totalHours: number;
  sections: Record<ProgrammeSection, string>; units: TeachingUnit[];
  researchRevision?: number;
  researchedSections?: (ProgrammeResearchOutline & { text: string })[];
  archivedSections?: (ProgrammeResearchOutline & { text: string })[];
  presentation?: ProgrammePresentation;
}
export interface ProgrammeState {
  schemaVersion: 1; revision: number; draft?: TeachingProgramme;
  reviewed?: { programme: TeachingProgramme; reviewedAt: string; research?: ProgrammeResearch };
  appliedJobs: string[];
}
export interface ProgrammeResponse { state: ProgrammeState; project: ProgrammeProject; curriculum?: CurriculumVersion; activeVersionId?: string; research: ProgrammeResearchState; researchContextFingerprint: string; unitProposal?: ProgrammeUnitProposal }
export interface ProgrammeProject {
  id: string; title: string; initialPurpose: ProgrammePurpose; curriculumVersionId: string; createdAt: string;
}
export interface ProgrammeProjectSummary extends ProgrammeProject { unitCount: number; totalHours: number; reviewed: boolean }
export interface CreateProgrammeRequest { title: string; purpose: ProgrammePurpose; totalHours?: number; context?: string; requirements?: string; selectionRequirements?: string }
export type ProgrammeExportFormat = 'md' | 'docx' | 'odt' | 'pdf';

export function emptyProgramme(curriculum: CurriculumVersion, purpose: ProgrammePurpose = 'classroom'): TeachingProgramme {
  return { purpose, title: `Programación didáctica · ${curriculum.profile.subject}`, curriculumVersionId: curriculum.id,
    totalHours: 0, sections: Object.fromEntries(Object.keys(PROGRAMME_SECTIONS).map(key => [key, ''])) as TeachingProgramme['sections'], units: [], researchRevision: 0, researchedSections: [], archivedSections: [] };
}

/** Apply the researched outline verbatim; retain authored text across refreshed research. */
export function applyProgrammeResearch(programme: TeachingProgramme, research: ProgrammeResearch, revision: number): TeachingProgramme {
  if (research.curriculumVersionId !== programme.curriculumVersionId || research.purpose !== programme.purpose) throw new Error('La investigación no corresponde a esta programación.');
  if (programme.researchRevision === revision) return programme;
  if (!research.outline.length) return programme;
  const previous = programme.researchedSections ?? [], archived = [...(programme.archivedSections ?? [])];
  const used = new Set<string>();
  const normalize = (title: string) => title.normalize('NFC').trim().toLocaleLowerCase();
  const researchedSections = research.outline.map(item => {
    const sameTitle = previous.filter(section => normalize(section.title) === normalize(item.title) && !used.has(section.id));
    const existing = previous.find(section => section.id === item.id && !used.has(section.id)) ?? (sameTitle.length === 1 ? sameTitle[0] : undefined);
    if (existing) used.add(existing.id);
    const legacy = Object.hasOwn(PROGRAMME_SECTIONS, item.id) ? programme.sections[item.id as ProgrammeSection] : '';
    return { ...structuredClone(item), text: existing?.text ?? legacy ?? '' };
  });
  for (const section of previous) if (!used.has(section.id) && section.text.trim()) archived.push(structuredClone(section));
  // Preserve legacy prose not represented in the researched outline, without inventing new headings.
  for (const [key, label] of Object.entries(PROGRAMME_SECTIONS)) {
    if (['context', 'requirements', 'selectionRequirements'].includes(key)) continue;
    const content = programme.sections[key as ProgrammeSection];
    if (content?.trim() && !research.outline.some(item => item.id === key) && !archived.some(item => item.id === `legacy-${key}`)) archived.push({ id: `legacy-${key}`, title: label, description: 'Texto anterior sin asignar a la estructura investigada.', mandatory: false, sourceIds: [], text: content });
  }
  return { ...programme, researchRevision: revision, researchedSections, archivedSections: archived };
}

export function programmeSectionDefinitions(programme: TeachingProgramme): ProgrammeResearchOutline[] {
  return (programme.researchedSections ?? []).map(({ id, title, description, mandatory, sourceIds }) => ({ id, title, description, mandatory, sourceIds }));
}

/** Advisory checks never mutate the source curriculum or claim statutory compliance. */
export function programmeIssues(programme: TeachingProgramme, curriculum: CurriculumVersion): string[] {
  const issues: string[] = [];
  if (!programme.title.trim()) issues.push('Escribe un título para la programación.');
  if (programme.presentation?.minUnits && programme.units.length < programme.presentation.minUnits) issues.push(`La presentación configurada requiere al menos ${programme.presentation.minUnits} unidades; hay ${programme.units.length}.`);
  if (!programme.units.length) issues.push('Añade al menos una unidad didáctica.');
  const hours = programme.units.reduce((sum, unit) => sum + unit.hours, 0);
  if (!programme.totalHours) issues.push('Indica las horas totales del curso.');
  else if (Math.abs(hours - programme.totalHours) > 0.01) issues.push(`Las unidades suman ${hours} h de ${programme.totalHours} h previstas.`);
  if (programme.units.some(unit => !unit.title.trim() || !unit.hours || !unit.period.trim() || (!unit.activities.trim() && !unit.activityPlan?.length) || (!unit.evidence.trim() && !unit.activityPlan?.some(activity => activity.evidence.trim())) || !unit.criterionIds.length)) issues.push('Completa el título, horas, período, actividades, evidencias y criterios de todas las unidades.');
  for (const [index, unit] of programme.units.entries()) for (const issue of unitPlanningIssues(unit, curriculum)) issues.push(`Unidad ${index + 1}: ${issue}`);
  const covered = new Set(programme.units.flatMap(unit => unit.criterionIds));
  const missing = curriculum.elements.filter(element => element.kind === 'assessmentCriterion' && !covered.has(element.id));
  if (missing.length) issues.push(`${missing.length} criterios de evaluación sin vincular a unidades.`);
  const coveredKnowledge = new Set(programme.units.flatMap(unit => unit.contentIds));
  const missingKnowledge = curriculum.elements.filter(element => element.kind === 'knowledge' && !coveredKnowledge.has(element.id));
  if (missingKnowledge.length) issues.push(`${missingKnowledge.length} contenidos o saberes sin vincular a unidades.`);
  if (!programme.researchedSections?.length) issues.push('Investiga la estructura antes de elaborar y revisar la programación.');
  for (const section of programme.researchedSections ?? []) if (!section.text.trim()) issues.push(`Completa: ${section.title}.`);
  return issues;
}

/** Export literal curriculum references alongside the teacher's planning decisions. */
export function programmeMarkdown(programme: TeachingProgramme, curriculum: CurriculumVersion, research?: ProgrammeResearch): string {
  const includeAppendices = programme.presentation?.includeAppendices !== false;
  const compact = programme.presentation?.compactReferences === true, labels = curriculumElementLabels(curriculum.elements);
  const referenceLabel = (element: CurriculumElement) => {
    const parts: string[] = [], seen = new Set<string>(); let current: CurriculumElement | undefined = element;
    while (current && !seen.has(current.id)) { seen.add(current.id); parts.unshift(labels.get(current.id) || current.id); current = curriculum.elements.find(item => item.id === current!.parentId); }
    return parts.join(' › ');
  };
  const lines = [`# ${programme.title}`, '', `${curriculum.profile.subject} · ${curriculum.profile.course} · ${curriculum.profile.academicYear} · ${curriculum.profile.territory}`, '', `Finalidad: ${PROGRAMME_PURPOSES[programme.purpose]}`, '',
    `Horas previstas: ${programme.totalHours || 'Pendientes'}`, '', `Versión del currículo: ${curriculum.id}`, '', '## Apartados de la programación', ''];
  for (const section of programme.researchedSections ?? []) lines.push(`### ${section.title}`, '', section.text || 'Pendiente de completar.', '');
  if (!programme.researchedSections?.length) lines.push('Estructura pendiente de investigación.', '');
  const archived = [...(programme.archivedSections ?? [])];
  for (const [key, label] of Object.entries(PROGRAMME_SECTIONS)) {
    if (programme.researchedSections !== undefined && ['context', 'requirements', 'selectionRequirements'].includes(key)) continue;
    const content = programme.sections[key as ProgrammeSection];
    if (content?.trim() && !programme.researchedSections?.some(item => item.id === key) && !archived.some(item => item.id === `legacy-${key}`)) archived.push({ id: `legacy-${key}`, title: label, description: '', mandatory: false, sourceIds: [], text: content });
  }
  if (includeAppendices && archived.length) {
    lines.push('## Textos anteriores sin asignar', '');
    for (const section of archived) lines.push(`### ${section.title}`, '', section.text, '');
  }
  lines.push('## Unidades didácticas', '');
  programme.units.forEach((unit, index) => {
    lines.push(`### ${index + 1}. ${unit.title}`, '', `${unit.hours} h · ${unit.period || 'Período pendiente'}`, '');
    if (unit.sessions !== undefined) lines.push(`Sesiones previstas: ${unit.sessions}`, '');
    if (unit.activities.trim()) lines.push('#### Descripción general de actividades', '', unit.activities, '');
    if (unit.evidence.trim()) lines.push('#### Evidencias e instrumentos de la unidad', '', unit.evidence, '');
    if (unit.learningSituation?.trim()) lines.push(`#### ${programmeUnitLabels(curriculum).situation}`, '', unit.learningSituation, '');
    const referents = programmeReferenceElements(curriculum, unit).filter(element => element.kind === 'learningOutcome' || element.kind === 'specificCompetence');
    if (referents.length) lines.push(`#### ${programmeUnitLabels(curriculum).referents}`, '', ...referents.map(element => compact ? `- ${referenceLabel(element)}` : `- ${element.code}: ${element.text} [${element.id}]`), '');
    for (const [label, ids] of [['Criterios de evaluación', unit.criterionIds], ['Contenidos / saberes', unit.contentIds]] as const) {
      lines.push(`#### ${label}`, '');
      for (const id of ids) {
        const element = curriculum.elements.find(item => item.id === id);
        if (element) {
          if (compact) { lines.push(`- ${referenceLabel(element)}`); continue; }
          const parent = curriculum.elements.find(item => item.id === element.parentId);
          if (parent) lines.push(`- Referente: ${parent.code ? `${parent.code}: ` : ''}${parent.text} [${parent.id}]`);
          lines.push(`- ${element.code ? `${element.code}: ` : ''}${element.text} [${element.id}] — ${element.locator}`);
        }
      }
      lines.push('');
    }
    if (unit.activityPlan?.length) {
      lines.push('#### Secuencia de actividades y vinculación curricular', '');
      unit.activityPlan.forEach((activity, index) => {
        lines.push(`##### ${index + 1}. ${activity.title}`, '', `${activity.hours} h${activity.sessions !== undefined ? ` · ${activity.sessions} sesiones` : ''}`, '', activity.description,
          '', `Objetivos didácticos: ${activity.objectives}`, '', `Evidencia: ${activity.evidence}`, '', `Instrumento: ${activity.instrument}`, '', `Recursos: ${activity.resources}`, '');
        for (const element of programmeReferenceElements(curriculum, activity)) lines.push(compact ? `- ${referenceLabel(element)}` : `- ${element.code ? `${element.code}: ` : ''}${element.text} [${element.id}] — ${element.locator}`);
        lines.push('');
      });
    }
  });
  if (!includeAppendices) return lines.join('\n');
  if (compact) {
    const selected = new Set(programme.units.flatMap(unit => programmeReferenceElements(curriculum, unit).map(element => element.id)));
    lines.push('## Referentes curriculares completos', '', 'Los códigos se conservan del currículo. Los contenidos sin código usan numeración local de organización.', '');
    for (const element of curriculum.elements.filter(element => selected.has(element.id))) lines.push(`- ${referenceLabel(element)}: ${element.text} [${element.id}] — ${element.locator}`, '');
  }
  const inputs = (['context', 'requirements', 'selectionRequirements'] as const).filter(key => programme.sections[key]?.trim());
  if (inputs.length && programme.researchedSections !== undefined) {
    lines.push('## Datos de partida aportados por el docente', '');
    for (const key of inputs) lines.push(`### ${PROGRAMME_SECTIONS[key]}`, '', programme.sections[key], '');
  }
  lines.push('## Fuentes del currículo', '');
  for (const source of curriculum.sources) lines.push(`- ${source.title}${source.url ? ` (${source.url})` : ''}${source.notes ? ` — ${source.notes}` : ''}`);
  if (research && research.curriculumVersionId === programme.curriculumVersionId && research.purpose === programme.purpose && JSON.stringify(research.outline) === JSON.stringify(programmeSectionDefinitions(programme))) {
    lines.push('', '## Investigación de estructura y requisitos', '', `Consultada: ${research.researchedAt} · ${research.status === 'ready' ? 'Informe completo' : 'Con cuestiones pendientes'}`, '', research.summary, '');
    if (research.contextSummary) lines.push('### Adaptación al contexto', '', research.contextSummary, '');
    if (research.requirements.length) lines.push('### Requisitos documentados', '', ...research.requirements.map(item => `- ${item.text} [${item.sourceIds.join(', ')}]`), '');
    lines.push('### Fuentes de la investigación', '', ...research.sources.map(source => `- [${source.id}] ${source.title} (${source.url}) — ${source.locator}${source.publishedOn ? ` · ${source.publishedOn}` : ''}`), '');
    for (const source of research.sources) if (source.excerpt) lines.push(`Fragmento aportado para contrastar [${source.id}]:`, '', source.excerpt, '');
    if (research.questions.length) lines.push('### Cuestiones pendientes', '', ...research.questions.map(question => `- ${question}`), '');
    lines.push('La revisión docente no sustituye la comprobación de la aplicabilidad normativa ni de los acuerdos del centro.', '');
  }
  const issues = programmeIssues(programme, curriculum);
  if (issues.length) lines.push('', '## Pendiente de revisión', '', ...issues.map(issue => `- ${issue}`));
  return lines.join('\n') + '\n';
}
