import { curriculumHierarchy, type CurriculumElement } from '../../../shared/curriculum';

export interface CurriculumTreeNode {
  element: CurriculumElement;
  children: CurriculumTreeNode[];
  descendantCount: number;
}

/** Build a finite forest from the editable outline, including orphaned and cyclic draft elements. */
export function buildCurriculumTree(elements: CurriculumElement[], query = '') {
  const roots: CurriculumTreeNode[] = [], ancestors: CurriculumTreeNode[] = [], nodes: CurriculumTreeNode[] = [];
  for (const { element, depth } of curriculumHierarchy(elements, query)) {
    const node: CurriculumTreeNode = { element, children: [], descendantCount: 0 };
    ancestors.length = Math.min(ancestors.length, depth);
    const parent = ancestors.at(-1);
    if (parent) parent.children.push(node); else roots.push(node);
    ancestors.push(node); nodes.push(node);
  }
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    node.descendantCount = node.children.reduce((count, child) => count + child.descendantCount + 1, 0);
  }
  return { roots, branchIds: new Set(nodes.filter(node => node.children.length).map(node => node.element.id)), count: nodes.length };
}
