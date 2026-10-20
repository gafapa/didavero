import { CURRICULUM_KINDS, curriculumIssues, type CurriculumProfile } from '../shared/curriculum';
import { parseCurriculumDraft } from './curriculumStore';

export class CurriculumNeedsInformation extends Error {}

/** Reconcile a source inventory with the extraction. Counts do not establish legal validity. */
export function reviewCurriculumExtraction(value: unknown, profile: CurriculumProfile) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('El resultado debe ser un objeto JSON.');
  const input = value as Record<string, any>;
  const audit = input.audit;
  if (audit?.status === 'needsInformation') {
    const questions = Array.isArray(audit.questions) ? audit.questions.filter((question: unknown) => typeof question === 'string' && question.trim()).slice(0, 5) : [];
    if (!questions.length) throw new Error('Indica qué información falta en audit.questions.');
    throw new CurriculumNeedsInformation(`No se ha incorporado ningún currículo. Falta información: ${questions.join(' ').slice(0, 3000)}`);
  }
  if (!['complete', 'reviewRequired'].includes(audit?.status) || !Array.isArray(audit.inventory) || !audit.inventory.length || audit.inventory.length > 5000) throw new Error('Falta el inventario de contraste (audit.status e audit.inventory).');
  const pendingApplicability = audit.status === 'reviewRequired';
  const applicabilityQuestions = Array.isArray(audit.questions)
    ? audit.questions.filter((question: unknown) => typeof question === 'string' && question.trim()).slice(0, 5) as string[] : [];
  if (pendingApplicability && !applicabilityQuestions.length) throw new Error('Indica qué comprobaciones de aplicación temporal faltan en audit.questions.');
  const resolvedProfile = { ...profile };
  if (profile.model === 'vocational' && !profile.moduleCode && typeof input.resolvedModuleCode === 'string') resolvedProfile.moduleCode = input.resolvedModuleCode.trim();
  // Expand extraction output only; manual imports retain the strict full schema.
  const draft = parseCurriculumDraft({ ...input, profile: resolvedProfile, completenessReviewed: false,
    sources: Array.isArray(input.sources) ? input.sources.map((source: any) => ({
      origin: 'official', filename: '', notes: '', reviewed: false, ...source,
    })) : input.sources,
    elements: Array.isArray(input.elements) ? input.elements.map((element: any) => ({
      notes: '', reviewed: false, ...element,
      excerpt: element && Object.hasOwn(element, 'excerpt') ? element.excerpt : element?.text,
    })) : input.elements,
  });
  if (pendingApplicability) draft.elements.forEach((element) => { element.reviewed = false; });
  const issues = curriculumIssues(draft, { requireReview: false });
  if (issues.length) throw new Error(issues.slice(0, 12).map((issue) => issue.message).join('\n'));
  for (const source of draft.sources) {
    if (source.origin !== 'official') throw new Error('La extracción automática solo puede usar publicaciones oficiales.');
    const publication = Date.parse(source.publishedOn);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(source.publishedOn) || !Number.isFinite(publication) || new Date(publication).toISOString().slice(0, 10) !== source.publishedOn || !source.applicableFrom.trim()) throw new Error(`Faltan la fecha de publicación o la aplicación temporal válidas de «${source.title}».`);
    if (pendingApplicability) {
      source.notes = [source.notes, `Pendiente de verificar la aplicabilidad al curso ${profile.academicYear}: ${applicabilityQuestions.join(' ')}`].filter(Boolean).join('\n');
      source.reviewed = false;
    }
  }
  const keyFor = (kind: string, parentId: string, sourceId: string) => JSON.stringify([kind, parentId, sourceId]);
  const counts = new Map<string, number>();
  for (const element of draft.elements) {
    const key = keyFor(element.kind, element.parentId, element.sourceId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const checked = new Set<string>();
  for (const group of audit.inventory) {
    if (!group || !Object.hasOwn(CURRICULUM_KINDS, group.kind) || typeof group.parentId !== 'string' ||
      !draft.sources.some((source) => source.id === group.sourceId) || typeof group.locator !== 'string' || !group.locator.trim() ||
      !Number.isInteger(group.expectedCount) || group.expectedCount < 0 || group.expectedCount > 1500) throw new Error('Una entrada del inventario no tiene tipo, padre, fuente, localización o recuento válido.');
    if (group.parentId && !draft.elements.some((element) => element.id === group.parentId)) throw new Error(`Padre inexistente en el inventario: ${group.parentId}.`);
    const key = keyFor(group.kind, group.parentId, group.sourceId);
    if (checked.has(key)) throw new Error('Hay grupos repetidos en el inventario.');
    checked.add(key);
    const actual = counts.get(key) ?? 0;
    if (actual !== group.expectedCount) throw new Error(`Inventario incompleto: ${group.kind}, padre «${group.parentId || 'raíz'}»: el inventario espera ${group.expectedCount}, el JSON contiene ${actual}.`);
  }
  for (const key of counts.keys()) if (!checked.has(key)) throw new Error(`Hay elementos sin inventariar: ${key}.`);
  const content = audit.content;
  if (!content || !['published', 'notPublished'].includes(content.status) || !draft.sources.some((source) => source.id === content.sourceId) || typeof content.locator !== 'string' || !content.locator.trim()) throw new Error('Indica dónde se publican los bloques y contenidos en audit.content.');
  const hasBlocks = draft.elements.some((element) => element.kind === 'contentBlock');
  const hasContent = draft.elements.some((element) => element.kind === 'knowledge');
  if (content.status === 'published' && (!hasBlocks || !hasContent)) throw new Error('La fuente publica contenidos: faltan sus bloques o contenidos individuales.');
  if (content.status === 'notPublished') {
    if (hasBlocks || hasContent || typeof content.explanation !== 'string' || content.explanation.trim().length < 30) throw new Error('Justifica con la fuente por qué no se publican contenidos; no los inventes.');
    const source = draft.sources.find((source) => source.id === content.sourceId)!;
    source.notes += `\nPendiente de contraste docente: el agente declara que la norma no publica bloques/contenidos. ${content.locator}. ${content.explanation.trim()}`;
  }
  return draft;
}
