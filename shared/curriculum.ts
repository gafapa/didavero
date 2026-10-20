// Structured curricula are independent of generated teaching materials.
export const CURRICULUM_KINDS = {
  objective: 'Objetivo', keyCompetence: 'Competencia clave', descriptor: 'Descriptor operativo',
  specificCompetence: 'Competencia específica', learningOutcome: 'Resultado de aprendizaje',
  assessmentCriterion: 'Criterio de evaluación', contentBlock: 'Bloque de contenidos / saberes', knowledge: 'Contenido / saber',
} as const;
export type CurriculumKind = keyof typeof CURRICULUM_KINDS;

export const CURRICULUM_TERRITORIES = ['Estatal', 'Andalucía', 'Aragón', 'Principado de Asturias', 'Illes Balears', 'Canarias', 'Cantabria',
  'Castilla-La Mancha', 'Castilla y León', 'Cataluña', 'Comunitat Valenciana', 'Extremadura', 'Galicia',
  'Comunidad de Madrid', 'Región de Murcia', 'Comunidad Foral de Navarra', 'País Vasco', 'La Rioja', 'Ceuta', 'Melilla'];

export interface CurriculumProfile {
  stage: string;
  territory: string;
  academicYear: string;
  subject: string;
  course: string;
  scope: 'course' | 'cycle' | 'stage' | 'module';
  model: 'general' | 'vocational';
  qualification: string;
  moduleCode: string;
}

/** New searches inherit subject identity; saved versions keep their original snapshots. */
export function curriculumProfileFromContext(profile: CurriculumProfile, context: CurriculumProfile): CurriculumProfile {
  let course = context.course;
  if (profile.scope === 'cycle' && context.stage === 'primaria' && /^[1-6]$/.test(context.course)) {
    course = `${Math.ceil(Number(context.course) / 2)}.º ciclo de Primaria`;
  } else if (profile.scope === 'stage') course = 'Etapa completa';
  return { ...profile, stage: context.stage, territory: context.territory, subject: context.subject,
    course, qualification: context.qualification };
}
export interface CurriculumSource {
  id: string;
  title: string;
  url: string;
  origin: 'official' | 'provided';
  filename: string;
  publishedOn: string;
  applicableFrom: string;
  notes: string;
  reviewed: boolean;
}
export interface CurriculumElement {
  id: string;
  kind: CurriculumKind;
  code: string;
  text: string;
  parentId: string;
  sourceId: string;
  locator: string;
  excerpt: string;
  notes: string;
  reviewed: boolean;
}
export interface CurriculumLink {
  id: string;
  fromId: string;
  toId: string;
  origin: 'official' | 'teacher';
  sourceId: string;
  locator: string;
  notes: string;
}
export interface CurriculumDraft {
  profile: CurriculumProfile;
  sources: CurriculumSource[];
  elements: CurriculumElement[];
  links: CurriculumLink[];
  completenessReviewed: boolean;
}
export interface CurriculumVersion extends CurriculumDraft {
  id: string;
  activatedAt: string;
  reviewMethod?: 'individual' | 'global';
}
export interface CurriculumState {
  schemaVersion: 1;
  revision: number;
  draft?: CurriculumDraft;
  activeVersionId?: string;
  versions: CurriculumVersion[];
  appliedJobs: string[];
}
export interface CurriculumResponse {
  state: CurriculumState;
  suggestedProfile: CurriculumProfile;
}
export interface CurriculumIssue { message: string; elementId?: string }

/** Descendant closure follows actual parent IDs, including hidden search results and cyclic drafts. */
function curriculumChildren(elements: CurriculumElement[]) {
  const children = new Map<string, string[]>();
  for (const element of elements) { const siblings = children.get(element.parentId) ?? []; siblings.push(element.id); children.set(element.parentId, siblings); }
  return children;
}
function descendantIds(children: Map<string, string[]>, elementId: string) {
  const ids = new Set<string>(), pending = [elementId];
  while (pending.length) {
    const id = pending.pop()!;
    if (ids.has(id)) continue;
    ids.add(id); pending.push(...children.get(id) ?? []);
  }
  return ids;
}

export function curriculumBranchIds(elements: CurriculumElement[], elementId: string): Set<string> {
  if (!elements.some(element => element.id === elementId)) throw new Error('El elemento ya no existe en el currículo.');
  return descendantIds(curriculumChildren(elements), elementId);
}

export function curriculumBranchReviews(elements: CurriculumElement[]): Map<string, { total: number; reviewed: number }> {
  const children = curriculumChildren(elements), reviewedIds = new Set(elements.filter(element => element.reviewed).map(element => element.id));
  return new Map(elements.map(element => {
    const ids = descendantIds(children, element.id);
    return [element.id, { total: ids.size, reviewed: [...ids].filter(id => reviewedIds.has(id)).length }];
  }));
}

export function removeCurriculumElement(draft: CurriculumDraft, elementId: string): CurriculumDraft {
  const ids = curriculumBranchIds(draft.elements, elementId);
  return { ...draft, completenessReviewed: false, elements: draft.elements.filter(element => !ids.has(element.id)), links: draft.links.filter(link => !ids.has(link.fromId) && !ids.has(link.toId)) };
}

/** Per-branch acceptance never changes literal text, provenance, IDs or the active snapshot. */
export function reviewCurriculumBranch(draft: CurriculumDraft, elementId: string, reviewed: boolean): CurriculumDraft {
  const ids = curriculumBranchIds(draft.elements, elementId);
  return { ...draft, completenessReviewed: false, elements: draft.elements.map(element => ids.has(element.id) ? { ...element, reviewed } : element) };
}

/** Remove a source without deleting curriculum content or retaining dangling source IDs. */
export function removeCurriculumSource(draft: CurriculumDraft, sourceId: string, replacementId = ''): CurriculumDraft {
  if (!draft.sources.some((source) => source.id === sourceId)) throw new Error('La fuente ya no existe en el borrador.');
  if (replacementId === sourceId || (replacementId && !draft.sources.some((source) => source.id === replacementId))) {
    throw new Error('Selecciona otra fuente válida o deja las referencias pendientes.');
  }
  return { ...draft, completenessReviewed: false,
    sources: draft.sources.filter((source) => source.id !== sourceId).map((source) =>
      source.id === replacementId ? { ...source, reviewed: false } : source),
    elements: draft.elements.map((element) => element.sourceId === sourceId
      ? { ...element, sourceId: replacementId, reviewed: false } : element),
    links: draft.links.map((link) => link.sourceId === sourceId ? { ...link, sourceId: replacementId } : link),
  };
}

export function curriculumParentKinds(kind: CurriculumKind, model: CurriculumProfile['model']): CurriculumKind[] {
  if (kind === 'assessmentCriterion') return [model === 'vocational' ? 'learningOutcome' : 'specificCompetence'];
  if (kind === 'knowledge' || kind === 'contentBlock') return ['contentBlock'];
  if (kind === 'descriptor') return ['keyCompetence'];
  return [];
}

export function curriculumParentOptions(element: CurriculumElement, elements: CurriculumElement[], model: CurriculumProfile['model']): CurriculumElement[] {
  const allowed = curriculumParentKinds(element.kind, model);
  const byId = new Map(elements.map((item) => [item.id, item]));
  return elements.filter((candidate) => {
    if (!allowed.includes(candidate.kind)) return false;
    const visited = new Set<string>();
    let current: CurriculumElement | undefined = candidate;
    while (current && !visited.has(current.id)) {
      if (current.id === element.id) return false;
      visited.add(current.id); current = byId.get(current.parentId);
    }
    return true;
  });
}

/** Resolve a drop against the full curriculum, never just the search-visible rows. */
export function curriculumDropDestination(elements: CurriculumElement[], model: CurriculumProfile['model'], sourceId: string, targetId: string, placement: 'before' | 'inside' | 'after'): { parentId: string; beforeId: string } | undefined {
  const source = elements.find(item => item.id === sourceId), target = elements.find(item => item.id === targetId);
  if (!source || !target) return;
  const branch = curriculumBranchIds(elements, sourceId);
  if (branch.has(targetId)) return;
  const parentId = placement === 'inside' ? targetId : target.parentId;
  if (parentId !== source.parentId) {
    if (parentId ? !curriculumParentOptions(source, elements, model).some(item => item.id === parentId)
      : ['assessmentCriterion', 'knowledge', 'descriptor'].includes(source.kind)) return;
  }
  const siblings = elements.filter(item => item.parentId === parentId && !branch.has(item.id));
  const beforeId = placement === 'before' ? targetId : placement === 'after' ? siblings[siblings.findIndex(item => item.id === targetId) + 1]?.id ?? '' : '';
  const currentSiblings = elements.filter(item => item.parentId === source.parentId);
  const currentBefore = currentSiblings[currentSiblings.findIndex(item => item.id === sourceId) + 1]?.id ?? '';
  if (parentId === source.parentId && beforeId === currentBefore) return;
  return { parentId, beforeId };
}

/** Move an entire branch without changing its identifiers, text, sources or links. */
export function moveCurriculumElement(draft: CurriculumDraft, elementId: string, parentId: string, beforeId = ''): CurriculumDraft {
  const element = draft.elements.find(item => item.id === elementId);
  if (!element) throw new Error('El elemento ya no existe en el currículo.');
  const branchIds = curriculumBranchIds(draft.elements, elementId);
  if (branchIds.has(parentId)) throw new Error('No puedes mover un elemento dentro de su propia rama.');
  if (parentId && !draft.elements.some(item => item.id === parentId)) throw new Error('El elemento superior ya no existe.');
  if (parentId !== element.parentId) {
    if (parentId ? !curriculumParentOptions(element, draft.elements, draft.profile.model).some(item => item.id === parentId)
      : ['assessmentCriterion', 'knowledge', 'descriptor'].includes(element.kind)) throw new Error('El destino no es compatible con este tipo de elemento.');
  }
  const remaining = draft.elements.filter(item => !branchIds.has(item.id));
  const siblings = remaining.filter(item => item.parentId === parentId);
  if (beforeId && !siblings.some(item => item.id === beforeId)) throw new Error('La posición seleccionada ya no es válida.');
  let position: number;
  if (beforeId) position = remaining.findIndex(item => item.id === beforeId);
  else if (siblings.length) {
    const lastBranch = curriculumBranchIds(remaining, siblings.at(-1)!.id);
    position = remaining.reduce((last, item, index) => lastBranch.has(item.id) ? index + 1 : last, 0);
  } else position = parentId ? remaining.findIndex(item => item.id === parentId) + 1 : remaining.length;
  const moved = parentId === element.parentId ? element : { ...element, parentId, reviewed: false };
  const branch = [moved, ...draft.elements.filter(item => branchIds.has(item.id) && item.id !== elementId)];
  const elements = [...remaining.slice(0, position), ...branch, ...remaining.slice(position)];
  if (elements.every((item, index) => item === draft.elements[index])) return draft;
  return { ...draft, elements, completenessReviewed: false };
}

/** Preserve sibling order and show matching descendants with their ancestors. Invalid drafts remain editable. */
export function curriculumHierarchy(elements: CurriculumElement[], query = ''): { element: CurriculumElement; depth: number }[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const visible = new Set<string>();
  const search = query.trim().toLocaleLowerCase();
  const labels = search ? curriculumElementLabels(elements) : undefined;
  for (const element of elements) {
    if (search && !`${labels?.get(element.id) ?? element.code} ${element.text} ${CURRICULUM_KINDS[element.kind]}`.toLocaleLowerCase().includes(search)) continue;
    let current: CurriculumElement | undefined = element;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id); visible.add(current.id); current = byId.get(current.parentId);
    }
  }
  const children = new Map<string, CurriculumElement[]>();
  for (const element of elements) {
    const parent = byId.has(element.parentId) ? element.parentId : '';
    children.set(parent, [...(children.get(parent) ?? []), element]);
  }
  const result: { element: CurriculumElement; depth: number }[] = [];
  const visited = new Set<string>();
  const visit = (root: CurriculumElement) => {
    const stack = [{ element: root, depth: 0 }];
    while (stack.length) {
      const row = stack.pop()!;
      if (visited.has(row.element.id)) continue;
      visited.add(row.element.id);
      if (visible.has(row.element.id)) result.push(row);
      for (const child of [...(children.get(row.element.id) ?? [])].reverse()) stack.push({ element: child, depth: row.depth + 1 });
    }
  };
  for (const root of children.get('') ?? []) visit(root);
  for (const element of elements) if (!visited.has(element.id)) visit(element);
  return result;
}

/** Local outline numbers never overwrite normative codes or persisted snapshots. */
export function curriculumElementLabels(elements: CurriculumElement[]): Map<string, string> {
  const labels = new Map<string, string>();
  const paths = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const { element } of curriculumHierarchy(elements)) {
    let path = '';
    if (element.kind === 'contentBlock' || element.kind === 'knowledge') {
      const parentPath = paths.get(element.parentId);
      const group = parentPath ? element.parentId : '';
      const number = (counts.get(group) ?? 0) + 1;
      counts.set(group, number);
      path = parentPath ? `${parentPath}.${number}` : String(number);
      paths.set(element.id, path);
    }
    labels.set(element.id, element.code || path);
  }
  return labels;
}

export const emptyCurriculumState = (): CurriculumState => ({ schemaVersion: 1, revision: 0, versions: [], appliedJobs: [] });
export const activeCurriculum = (state: CurriculumState) => state.versions.find((version) => version.id === state.activeVersionId);

const OFFICIAL_DOMAINS = ['boe.es', 'inap.es', 'lex.gal', 'xunta.gal', 'juntadeandalucia.es', 'aragon.es', 'asturias.es', 'educastur.es',
  'caib.es', 'gobiernodecanarias.org', 'cantabria.es', 'educantabria.es', 'jccm.es', 'jcyl.es', 'gencat.cat',
  'gva.es', 'juntaex.es', 'educarex.es', 'comunidad.madrid', 'bocm.es', 'carm.es', 'borm.es', 'navarra.es',
  'euskadi.eus', 'larioja.org', 'educacionfpydeportes.gob.es', 'educacionyfp.gob.es'];
export function isOfficialCurriculumUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      OFFICIAL_DOMAINS.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}

const normalize = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim();

/** Human review is required: structural validity alone cannot prove complete extraction. */
export function curriculumIssues(draft: CurriculumDraft, options: { requireReview?: boolean } = {}): CurriculumIssue[] {
  const issues: CurriculumIssue[] = [];
  const add = (message: string, elementId?: string) => issues.push({ message, elementId });
  if (!draft.profile.stage || !draft.profile.subject || !draft.profile.territory || !/^\d{4}-\d{4}$/.test(draft.profile.academicYear) ||
    Number(draft.profile.academicYear.slice(5)) !== Number(draft.profile.academicYear.slice(0, 4)) + 1) add('Completa la enseñanza, territorio, asignatura y curso académico (por ejemplo, 2026-2027).');
  if (!draft.profile.course) add('Indica el curso o ciclo al que corresponde el currículo.');
  if (draft.profile.model === 'vocational' && (!draft.profile.qualification || !draft.profile.moduleCode)) add('En un módulo profesional, indica el título y el código del módulo.');
  if (options.requireReview !== false && !draft.completenessReviewed) add('Confirma que has comprobado la integridad de la extracción con la norma, incluidas sus modificaciones.');
  if (!draft.elements.length) add('El currículo no tiene elementos.');
  if (!draft.elements.some((element) => element.kind === 'assessmentCriterion')) add('Faltan criterios de evaluación.');
  const sources = new Map(draft.sources.map((source) => [source.id, source]));
  const elements = new Map(draft.elements.map((element) => [element.id, element]));
  for (const source of draft.sources) {
    if (!source.title || (options.requireReview !== false && !source.reviewed)) add(`Revisa la fuente «${source.title || source.id}».`);
    if (source.origin === 'official' && !isOfficialCurriculumUrl(source.url)) add(`La fuente «${source.title || source.id}» necesita un enlace HTTPS a un dominio oficial admitido.`);
    if (source.origin === 'provided' && !source.filename) add(`Identifica el documento aportado de «${source.title || source.id}».`);
  }
  const codes = new Set<string>();
  for (const element of draft.elements) {
    const label = element.code || element.id;
    if ((!element.code && !['knowledge', 'contentBlock'].includes(element.kind)) || !element.text.trim()) add(`Completa el texto y, si corresponde, el código de «${label}».`, element.id);
    const key = `${element.kind}/${element.parentId}/${element.code}`;
    if (element.code && codes.has(key)) add(`Código duplicado: «${label}».`, element.id);
    if (element.code) codes.add(key);
    if (!sources.has(element.sourceId) || !element.locator || !element.excerpt.trim()) add(`Añade fuente, localización y fragmento original de «${label}».`, element.id);
    else if (!normalize(element.excerpt).includes(normalize(element.text))) add(`El texto de «${label}» no coincide con su fragmento original.`, element.id);
    if (options.requireReview !== false && !element.reviewed) add(`Revisa el elemento «${label}».`, element.id);
    if (element.kind === 'assessmentCriterion') {
      const expected = draft.profile.model === 'vocational' ? 'learningOutcome' : 'specificCompetence';
      if (elements.get(element.parentId)?.kind !== expected) add(`Vincula el criterio «${label}» a su ${expected === 'learningOutcome' ? 'resultado de aprendizaje' : 'competencia específica'}.`, element.id);
    }
    if (element.kind === 'knowledge' && elements.get(element.parentId)?.kind !== 'contentBlock') add(`Vincula el contenido «${label}» a su bloque de contenidos o saberes.`, element.id);
    if (element.kind === 'contentBlock' && !draft.elements.some((child) => child.parentId === element.id && ['knowledge', 'contentBlock'].includes(child.kind))) add(`El bloque «${label}» no tiene contenidos ni subbloques.`, element.id);
    if (['learningOutcome', 'specificCompetence'].includes(element.kind) && !draft.elements.some((child) => child.parentId === element.id && child.kind === 'assessmentCriterion')) add(`El elemento «${label}» no tiene criterios de evaluación.`, element.id);
    const parentElement = elements.get(element.parentId);
    if (parentElement && !curriculumParentKinds(element.kind, draft.profile.model).includes(parentElement.kind)) add(`El tipo de elemento superior de «${label}» no corresponde a su jerarquía.`, element.id);
    if (element.parentId && !elements.has(element.parentId)) add(`El elemento «${label}» tiene un padre inexistente.`, element.id);
    const seen = new Set([element.id]);
    let parent = element.parentId;
    while (parent && elements.has(parent)) {
      if (seen.has(parent)) { add(`Relación circular en «${label}».`, element.id); break; }
      seen.add(parent);
      parent = elements.get(parent)!.parentId;
    }
  }
  for (const link of draft.links) {
    if (!elements.has(link.fromId) || !elements.has(link.toId) || link.fromId === link.toId) add(`Revisa los extremos de la relación «${link.id}».`);
    if (link.origin === 'official' && (!sources.has(link.sourceId) || !link.locator)) add(`La relación oficial «${link.id}» necesita fuente y localización.`);
  }
  return issues;
}

/** Render the activated version as context for material-generation agents. */
export function curriculumPromptText(version: CurriculumVersion): string {
  const labels = curriculumElementLabels(version.elements);
  const lines = [`# Currículo oficial: ${version.profile.subject}`, '',
    `Versión: ${version.id} · ${version.profile.territory} · ${version.profile.academicYear}`, '',
    'Referencias revisadas por el docente. La cobertura se comprueba mediante actividades y evidencias.',
    'Los números de bloques y contenidos sin código oficial son numeración local de organización.', ''];
  for (const source of version.sources) if (source.notes) lines.push(`Observaciones de aplicabilidad de ${source.title} (conservar sus límites): ${source.notes}`, '');
  for (const { element, depth } of curriculumHierarchy(version.elements)) {
    const source = version.sources.find((item) => item.id === element.sourceId);
    lines.push(`${'#'.repeat(Math.min(6, 2 + depth))} ${CURRICULUM_KINDS[element.kind]} ${labels.get(element.id)}`, `Identificador: ${version.id}/${element.id}`, '', element.text, '',
      `Fuente: ${source?.title ?? ''}${source?.url ? ` — ${source.url}` : ''}. ${element.locator}`, '');
    if (element.parentId) {
      const parent = version.elements.find((item) => item.id === element.parentId);
      lines.push(`Elemento superior: ${parent ? `${CURRICULUM_KINDS[parent.kind]} ${labels.get(parent.id)} (${version.id}/${parent.id})` : element.parentId}`, '');
    }
    if (element.notes) lines.push(`Concreción docente (no es texto normativo): ${element.notes}`, '');
  }
  if (version.links.length) lines.push('## Relaciones', '', ...version.links.map((link) =>
    `- ${link.fromId} → ${link.toId} (${link.origin === 'official' ? 'normativa' : 'propuesta docente'}): ${link.notes} ${link.locator}`));
  return lines.join('\n');
}
