import type { CurriculumElement, CurriculumVersion } from './curriculum';
import type { TeachingActivity, TeachingUnit } from './teachingProgramme';

export function programmeUnitLabels(curriculum: CurriculumVersion) {
  const vocational = curriculum.profile.model === 'vocational';
  return { vocational,
    referents: vocational ? 'Resultados de aprendizaje (RA)' : 'Competencias específicas',
    criteria: vocational ? 'Criterios de evaluación (CA / CE)' : 'Criterios de evaluación',
    blocks: vocational ? 'Bloques de contenidos (BC)' : 'Bloques de saberes / contenidos',
    contents: vocational ? 'Contenidos (C)' : 'Saberes básicos / contenidos',
    situation: vocational ? 'Situación profesional / producto' : 'Situación de aprendizaje: contexto, reto y producto',
  };
}

/** Show only known ancestors; a teaching assignment never becomes an official curriculum link. */
export function programmeReferenceElements(curriculum: CurriculumVersion, selection: { referentIds?: string[]; criterionIds: string[]; contentIds: string[] }): CurriculumElement[] {
  const selected = new Set([...(selection.referentIds ?? []), ...selection.criterionIds, ...selection.contentIds]);
  const byId = new Map(curriculum.elements.map(element => [element.id, element]));
  for (const id of [...selected]) {
    let element = byId.get(id);
    const visited = new Set<string>();
    while (element?.parentId && !visited.has(element.parentId)) {
      visited.add(element.parentId); selected.add(element.parentId); element = byId.get(element.parentId);
    }
  }
  for (const id of selected) {
    for (const link of curriculum.links) if (link.origin === 'official' && link.fromId === id) {
      const target = byId.get(link.toId);
      if (target && ['descriptor', 'keyCompetence'].includes(target.kind)) selected.add(target.id);
    }
  }
  return curriculum.elements.filter(element => selected.has(element.id));
}

/** Retain explicitly selected unit references when an activity adds further curriculum targets. */
export function withActivityPlan(unit: TeachingUnit, activities: TeachingActivity[]): TeachingUnit {
  const merge = (field: 'referentIds' | 'criterionIds' | 'contentIds') => [...new Set([...(unit[field] ?? []), ...activities.flatMap(activity => activity[field])])];
  return { ...unit, activityPlan: activities, referentIds: merge('referentIds'), criterionIds: merge('criterionIds'), contentIds: merge('contentIds') };
}

export function unitPlanningIssues(unit: TeachingUnit, curriculum: CurriculumVersion): string[] {
  const issues: string[] = [], activities = unit.activityPlan;
  if (activities !== undefined) {
    if (!activities.length) issues.push('Añade actividades con su vinculación curricular.');
    if (activities.some(activity => !activity.title.trim() || !activity.description.trim() || !activity.evidence.trim() || !activity.instrument.trim() || !activity.criterionIds.length)) issues.push('Completa las actividades, sus criterios, evidencias e instrumentos.');
    const hours = activities.reduce((sum, activity) => sum + activity.hours, 0);
    if (unit.hours && Math.abs(hours - unit.hours) > 0.01) issues.push(`Las actividades suman ${hours} h de ${unit.hours} h de la unidad.`);
    if (unit.sessions !== undefined && activities.reduce((sum, activity) => sum + (activity.sessions ?? 0), 0) !== unit.sessions) issues.push('Distribuye las sesiones de la unidad entre sus actividades.');
    const assigned = new Set(activities.flatMap(activity => activity.criterionIds));
    if (unit.criterionIds.some(id => !assigned.has(id))) issues.push('Hay criterios de la unidad sin actividad vinculada.');
    const content = new Set(activities.flatMap(activity => programmeReferenceElements(curriculum, activity).filter(element => element.kind === 'knowledge' || element.kind === 'contentBlock').map(element => element.id)));
    if (unit.contentIds.some(id => !content.has(id))) issues.push('Hay contenidos de la unidad sin actividad vinculada.');
    if (!unit.contentIds.length && curriculum.elements.some(element => element.kind === 'knowledge')) issues.push('Vincula contenidos o saberes del currículo a la unidad y a sus actividades.');
  }
  return issues;
}

export function programmeUnitInstructions(curriculum: CurriculumVersion): string {
  return `${curriculum.profile.model === 'vocational'
    ? 'FP: unidades de trabajo con RA (learningOutcome), CA/CE (assessmentCriterion), BC (contentBlock) y C (knowledge). RA → CA y BC → C son ramas distintas. No presupongas correspondencia RA1=BC1 ni inventes relaciones oficiales. En grado básico usa el modelo del módulo/ámbito incluido: los ámbitos generales pueden tener competencias específicas.'
    : 'Primaria, ESO y Bachillerato: unidades con situaciones de aprendizaje contextualizadas, reto/producto, competencias específicas, criterios y saberes básicos/contenidos. En Primaria atiende al ciclo y enfoque globalizado; en ESO y Bachillerato a la materia y nivel. Solo muestra competencias clave y descriptores cuando consten sus relaciones oficiales, nunca las inventes.'}
Cada unidad tiene id, title, hours, period, referentIds, criterionIds, contentIds, learningSituation, activities (texto anterior, conservarlo), evidence y activityPlan. sessions es opcional y solo se conserva si estaba indicada; no supongas que una sesión equivale a una hora.
Cada actividad de activityPlan tiene id único dentro de su unidad, title, hours, description, objectives, evidence, instrument, resources, referentIds, criterionIds y contentIds; sessions es opcional. description, objectives, evidence, instrument y resources son CADENAS DE TEXTO, no arrays; si necesitas una lista, escríbela dentro de la cadena con saltos de línea. Desarrolla tareas concretas, objetivos didácticos, producto/evidencia observable e instrumento de evaluación. Reparte las horas de cada unidad entre actividades y sus sesiones cuando se hayan indicado. Los IDs curriculares son literales del currículo capturado: referentIds solo RA o competencias específicas; criterionIds solo criterios; contentIds solo BC o contenidos/saberes. Incluye todos los IDs de las actividades en la selección de su unidad; cada criterio y contenido de la unidad debe trabajarse en alguna actividad. Un criterio puede aparecer en varias unidades o actividades; eso no duplica automáticamente su peso de calificación.
Son decisiones didácticas propuestas, no cambios del currículo ni relaciones oficiales nuevas. No inventes ponderaciones, mínimos de logro, normas de evaluación, horas/sesiones legales ni reparto centro/empresa. Reutiliza la investigación territorial disponible y deja pendientes los acuerdos no aportados.`;
}
