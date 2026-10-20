import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCurriculumTree } from '../web/src/lib/curriculumTree';
import type { CurriculumElement } from '../shared/curriculum';
import { curriculumBranchIds, curriculumBranchReviews, curriculumDropDestination, moveCurriculumElement, removeCurriculumElement, reviewCurriculumBranch, type CurriculumDraft } from '../shared/curriculum';

const element = (id: string, kind: CurriculumElement['kind'], parentId = '', text = id): CurriculumElement => ({ id, kind, parentId, text, code: id, sourceId: '', locator: '', excerpt: '', notes: '', reviewed: false });

test('curriculum branches preserve exact parents, sibling order and independent criterion/content hierarchies', () => {
  const elements = [element('ra1', 'learningOutcome'), element('ca1', 'assessmentCriterion', 'ra1'), element('ca2', 'assessmentCriterion', 'ra1'), element('block', 'contentBlock'), element('subblock', 'contentBlock', 'block'), element('content', 'knowledge', 'subblock')];
  const before = structuredClone(elements), tree = buildCurriculumTree(elements);
  assert.deepEqual(tree.roots.map(node => node.element.id), ['ra1', 'block']);
  assert.deepEqual(tree.roots[0].children.map(node => node.element.id), ['ca1', 'ca2']);
  assert.equal(tree.roots[1].children[0].children[0].element.id, 'content');
  assert.equal(tree.roots[1].descendantCount, 2);
  assert.deepEqual([...tree.branchIds], ['ra1', 'block', 'subblock']);
  assert.deepEqual(elements, before);
});

test('a matching leaf reveals its ancestors, while no match and invalid draft parents remain safe', () => {
  const elements = [element('ce1', 'specificCompetence'), element('ca1', 'assessmentCriterion', 'ce1', 'Unique searchable criterion'), element('ce2', 'specificCompetence'), element('ca2', 'assessmentCriterion', 'ce2')];
  const filtered = buildCurriculumTree(elements, 'searchable');
  assert.equal(filtered.count, 2); assert.equal(filtered.roots[0].element.id, 'ce1'); assert.equal(filtered.roots[0].children[0].element.id, 'ca1');
  assert.equal(buildCurriculumTree(elements, 'missing').count, 0);
  const invalid = buildCurriculumTree([element('orphan', 'knowledge', 'absent'), element('a', 'contentBlock', 'b'), element('b', 'contentBlock', 'a')]);
  assert.equal(invalid.count, 3); assert.equal(invalid.roots[0].element.id, 'orphan'); assert.equal(invalid.roots[1].children[0].element.id, 'b');
});

function editableFixture(): CurriculumDraft {
  return { profile: { stage: 'eso', territory: 'Galicia', academicYear: '2026-2027', subject: 'Fictional subject', course: '1', scope: 'course', model: 'general', qualification: '', moduleCode: '' }, sources: [], completenessReviewed: true,
    elements: [element('ce1', 'specificCompetence'), element('ca1', 'assessmentCriterion', 'ce1'), element('ca2', 'assessmentCriterion', 'ce1'), element('block', 'contentBlock'), element('subblock', 'contentBlock', 'block'), element('content', 'knowledge', 'subblock')],
    links: [{ id: 'removed-link', fromId: 'ca1', toId: 'content', origin: 'teacher', sourceId: '', locator: '', notes: '' }, { id: 'kept-link', fromId: 'ca2', toId: 'block', origin: 'teacher', sourceId: '', locator: '', notes: '' }] };
}

test('any curriculum leaf or complete branch can be removed with affected links and without changing its snapshot', () => {
  const draft = editableFixture(), original = structuredClone(draft);
  const leaf = removeCurriculumElement(draft, 'ca1');
  assert.equal(leaf.elements.length, 5); assert.deepEqual(leaf.links.map(link => link.id), ['kept-link']);
  const branch = removeCurriculumElement(draft, 'block');
  assert.deepEqual(branch.elements.map(item => item.id), ['ce1', 'ca1', 'ca2']); assert.deepEqual(branch.links, []);
  assert.equal(branch.completenessReviewed, false); assert.deepEqual(draft, original);
  assert.throws(() => removeCurriculumElement(draft, 'missing'), /ya no existe/);
  const cycle = { ...draft, elements: [element('a', 'contentBlock', 'b'), element('b', 'contentBlock', 'a')] };
  assert.equal(removeCurriculumElement(cycle, 'a').elements.length, 0);
});

test('branch acceptance includes every descendant, reports partial review and leaves unrelated branches untouched', () => {
  const draft = editableFixture(), original = structuredClone(draft);
  const partial = reviewCurriculumBranch(draft, 'ca1', true);
  assert.deepEqual(curriculumBranchReviews(partial.elements).get('ce1'), { total: 3, reviewed: 1 });
  const accepted = reviewCurriculumBranch(partial, 'ce1', true);
  assert.deepEqual(curriculumBranchReviews(accepted.elements).get('ce1'), { total: 3, reviewed: 3 });
  assert.equal(accepted.elements.find(item => item.id === 'content')!.reviewed, false);
  assert.equal(reviewCurriculumBranch(accepted, 'ce1', false).elements.some(item => item.reviewed), false);
  assert.deepEqual([...curriculumBranchIds(draft.elements, 'block')].sort(), ['block', 'content', 'subblock']);
  assert.equal(accepted.completenessReviewed, false); assert.deepEqual(accepted.links, original.links); assert.deepEqual(draft, original);
  assert.deepEqual(buildCurriculumTree(accepted.elements, 'ca1').roots[0].children.map(node => node.element.id), ['ca1']);
  assert.equal(accepted.elements.find(item => item.id === 'ca2')!.reviewed, true, 'Search must not limit the accepted branch.');
});

test('moving branches preserves descendants, references and immutable source data while changing sibling order', () => {
  const draft = editableFixture();
  draft.elements = draft.elements.map(item => ({ ...item, reviewed: true }));
  const original = structuredClone(draft);
  const reordered = moveCurriculumElement(draft, 'block', '', 'ce1');
  const tree = buildCurriculumTree(reordered.elements);
  assert.deepEqual(tree.roots.map(node => node.element.id), ['block', 'ce1']);
  assert.equal(tree.roots[0].children[0].children[0].element.id, 'content');
  assert.equal(reordered.elements.every(item => item.reviewed), true, 'Reordering preserves individual acceptance.');
  assert.deepEqual(reordered.links, draft.links);
  assert.deepEqual(reordered.sources, draft.sources);
  assert.equal(reordered.completenessReviewed, false);
  const reversed = moveCurriculumElement(draft, 'ca2', 'ce1', 'ca1');
  assert.deepEqual(buildCurriculumTree(reversed.elements).roots[0].children.map(node => node.element.id), ['ca2', 'ca1']);
  assert.deepEqual(buildCurriculumTree(moveCurriculumElement(reversed, 'ca2', 'ce1').elements).roots[0].children.map(node => node.element.id), ['ca1', 'ca2']);
  assert.deepEqual(draft, original);
  assert.equal(moveCurriculumElement(draft, 'ca1', 'ce1', 'ca2'), draft, 'An unchanged position is a no-op.');
});

test('drag destinations distinguish row edges from nesting and preserve the full hidden branch', () => {
  const draft = editableFixture();
  draft.elements.push(element('other', 'specificCompetence'), element('other-criterion', 'assessmentCriterion', 'other'));
  assert.deepEqual(curriculumDropDestination(draft.elements, 'general', 'block', 'ce1', 'before'), { parentId: '', beforeId: 'ce1' });
  assert.deepEqual(curriculumDropDestination(draft.elements, 'general', 'ce1', 'block', 'after'), { parentId: '', beforeId: 'other' });
  assert.deepEqual(curriculumDropDestination(draft.elements, 'general', 'ca1', 'other', 'inside'), { parentId: 'other', beforeId: '' });
  const destination = curriculumDropDestination(draft.elements, 'general', 'block', 'other', 'after')!;
  const moved = moveCurriculumElement(draft, 'block', destination.parentId, destination.beforeId);
  assert.deepEqual([...curriculumBranchIds(moved.elements, 'block')].sort(), ['block', 'content', 'subblock']);
  assert.equal(buildCurriculumTree(moved.elements).roots.at(-1)!.element.id, 'block');
  for (const [source, target, position] of [['block', 'subblock', 'inside'], ['ca1', 'block', 'inside'], ['ca1', 'block', 'before'], ['ce1', 'ca1', 'after'], ['content', 'other', 'inside'], ['ca1', 'ca2', 'before'], ['missing', 'block', 'inside'], ['block', 'missing', 'after']] as const) assert.equal(curriculumDropDestination(draft.elements, 'general', source, target, position), undefined);
  const vocational = { ...draft, elements: draft.elements.map(item => item.kind === 'specificCompetence' ? { ...item, kind: 'learningOutcome' as const } : item) };
  assert.deepEqual(curriculumDropDestination(vocational.elements, 'vocational', 'ca1', 'other', 'inside'), { parentId: 'other', beforeId: '' });
  assert.equal(curriculumDropDestination(vocational.elements, 'general', 'ca1', 'other', 'inside'), undefined);
});

test('reparenting is stage-aware and rejects cycles, incompatible parents and invalid sibling targets', () => {
  for (const model of ['general', 'vocational'] as const) {
    const draft = editableFixture();
    draft.profile.model = model;
    draft.elements[0].kind = model === 'vocational' ? 'learningOutcome' : 'specificCompetence';
    draft.elements.push(element('other', draft.elements[0].kind), element('new-block', 'contentBlock'));
    draft.elements = draft.elements.map(item => ({ ...item, reviewed: true }));
    const original = structuredClone(draft);
    const moved = moveCurriculumElement(draft, 'ca1', 'other');
    assert.equal(moved.elements.find(item => item.id === 'ca1')!.parentId, 'other');
    assert.equal(moved.elements.find(item => item.id === 'ca1')!.reviewed, false);
    assert.equal(moved.elements.find(item => item.id === 'ca2')!.reviewed, true);
    const branch = moveCurriculumElement(draft, 'subblock', 'new-block');
    assert.equal(branch.elements.find(item => item.id === 'content')!.parentId, 'subblock');
    assert.equal(branch.elements.find(item => item.id === 'content')!.reviewed, true);
    assert.deepEqual(branch.elements.map(item => item.id).sort(), draft.elements.map(item => item.id).sort());
    for (const [id, parent, before] of [['block', 'subblock', ''], ['subblock', 'subblock', ''], ['ca1', 'block', ''], ['content', 'other', ''], ['ca1', '', ''], ['ca1', 'missing', ''], ['ca1', 'other', 'ca2'], ['ca1', 'other', 'ca1'], ['missing', '', '']]) {
      assert.throws(() => moveCurriculumElement(draft, id, parent, before));
    }
    assert.deepEqual(draft, original);
  }
  const descriptorDraft = editableFixture();
  descriptorDraft.elements.push(element('key', 'keyCompetence'), element('descriptor', 'descriptor'));
  assert.equal(moveCurriculumElement(descriptorDraft, 'descriptor', 'key').elements.find(item => item.id === 'descriptor')!.parentId, 'key');
  assert.throws(() => moveCurriculumElement(descriptorDraft, 'descriptor', 'block'));
});
