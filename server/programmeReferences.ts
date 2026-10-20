import type { CurriculumVersion } from '../shared/curriculum';

/** Prompts qualify IDs with their immutable version. Accept that exact spelling, never another version or a guessed code. */
export function normalizeProgrammeReferences(value: unknown, curriculum: CurriculumVersion): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.units)) return value;
  const aliases = new Map(curriculum.elements.map(element => [`${curriculum.id}/${element.id}`, element.id]));
  const normalize = (value: unknown): unknown => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const entity = { ...value } as Record<string, unknown>;
    for (const field of ['referentIds', 'criterionIds', 'contentIds']) if (Array.isArray(entity[field])) entity[field] = entity[field].map(id => typeof id === 'string' ? aliases.get(id) ?? id : id);
    for (const field of ['objectives', 'resources']) {
      const items = entity[field];
      if (Array.isArray(items) && items.length > 0 && items.length <= 200 && items.every(item => typeof item === 'string' && item.trim().length > 0)) entity[field] = items.map(item => `- ${item}`).join('\n');
    }
    return entity;
  };
  return { ...input, units: input.units.map(value => {
    const unit = normalize(value) as Record<string, unknown> | null;
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)) return unit;
    return { ...unit, ...(Array.isArray(unit.activityPlan) ? { activityPlan: unit.activityPlan.map(normalize) } : {}) };
  }) };
}
