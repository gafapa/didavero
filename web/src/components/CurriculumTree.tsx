import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { ChevronRight, GripVertical } from 'lucide-react';
import { CURRICULUM_KINDS, curriculumBranchReviews, curriculumDropDestination, curriculumElementLabels, type CurriculumElement, type CurriculumProfile } from '../../../shared/curriculum';
import { buildCurriculumTree, type CurriculumTreeNode } from '../lib/curriculumTree';
import { Boton, cx } from './ui';

type DropPlacement = 'before' | 'inside' | 'after';
type DropTarget = { id: string; placement: DropPlacement };
type DragHandlers = { sourceId: string; target?: DropTarget; start: (event: DragEvent<HTMLElement>, id: string) => void; over: (event: DragEvent<HTMLElement>, id: string) => void; leave: (event: DragEvent<HTMLElement>) => void; drop: (event: DragEvent<HTMLElement>, id: string) => void; end: () => void };

type Props = { model: CurriculumProfile['model']; onRelocate: (elementId: string, parentId: string, beforeId: string) => void; elements: CurriculumElement[]; query: string; disabled: boolean; onReview: (elementId: string, reviewed: boolean) => void; onOpen: (elementId: string) => void; onMove: (elementId: string) => void };

export function CurriculumTree({ elements, query, disabled, onReview, onOpen, onMove, model, onRelocate }: Props) {
  const tree = useMemo(() => buildCurriculumTree(elements, query), [elements, query]);
  const labels = useMemo(() => curriculumElementLabels(elements), [elements]);
  const reviews = useMemo(() => curriculumBranchReviews(elements), [elements]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [searchState, setSearchState] = useState<{ query: string; collapsed: Set<string> }>({ query: '', collapsed: new Set() });
  const [sourceId, setSourceId] = useState('');
  const [dropTarget, setDropTarget] = useState<DropTarget>();
  const draggedId = useRef('');
  const expandTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoverId = useRef('');
  const search = query.trim();
  function clearHover() { clearTimeout(expandTimer.current); hoverId.current = ''; }
  function endDrag() { draggedId.current = ''; setSourceId(''); setDropTarget(undefined); clearHover(); }
  useEffect(() => { if (disabled) endDrag(); }, [disabled]);
  useEffect(() => () => clearTimeout(expandTimer.current), []);
  function reveal(id: string) {
    setExpandedIds(previous => new Set([...previous, id]));
    setSearchState(previous => ({ ...previous, collapsed: new Set([...previous.collapsed].filter(item => item !== id)) }));
  }
  function destination(event: DragEvent<HTMLElement>, id: string) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / bounds.height;
    const placement: DropPlacement = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
    const move = !disabled && draggedId.current ? curriculumDropDestination(elements, model, draggedId.current, id, placement) : undefined;
    return { placement, move };
  }
  const drag: DragHandlers = {
    sourceId, target: dropTarget,
    start(event, id) {
      if (disabled) { event.preventDefault(); return; }
      event.stopPropagation(); draggedId.current = id; setSourceId(id);
      event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', labels.get(id) || id);
    },
    over(event, id) {
      if (!draggedId.current) return;
      event.stopPropagation();
      const { placement, move } = destination(event, id);
      event.dataTransfer.dropEffect = move ? 'move' : 'none';
      if (!move) { setDropTarget(undefined); clearHover(); return; }
      event.preventDefault();
      setDropTarget(previous => previous?.id === id && previous.placement === placement ? previous : { id, placement });
      if (placement === 'inside' && hoverId.current !== id) {
        clearHover(); hoverId.current = id;
        expandTimer.current = setTimeout(() => reveal(id), 650);
      } else if (placement !== 'inside') clearHover();
    },
    leave(event) {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setDropTarget(undefined); clearHover();
    },
    drop(event, id) {
      if (!draggedId.current) return;
      event.preventDefault(); event.stopPropagation();
      const { move } = destination(event, id), movingId = draggedId.current;
      endDrag();
      if (move) { onRelocate(movingId, move.parentId, move.beforeId); if (move.parentId) reveal(move.parentId); }
    },
    end: endDrag,
  };
  useEffect(() => { setSearchState({ query: search, collapsed: new Set() }); }, [search]);
  const searchCollapsed = searchState.query === search ? searchState.collapsed : new Set<string>();
  const isExpanded = (id: string) => search ? !searchCollapsed.has(id) : expandedIds.has(id);
  function toggle(id: string) {
    if (search) {
      const collapsed = new Set(searchCollapsed);
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      setSearchState({ query: search, collapsed });
    } else setExpandedIds(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function expandAll(expand: boolean) {
    if (search) setSearchState({ query: search, collapsed: expand ? new Set() : new Set(tree.branchIds) });
    else setExpandedIds(expand ? new Set(tree.branchIds) : new Set());
  }

  const targetLabel = dropTarget ? labels.get(dropTarget.id) || CURRICULUM_KINDS[elements.find(item => item.id === dropTarget.id)!.kind] : '';
  return <section aria-label="Árbol del currículo" className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <p role="status" className="text-xs text-texto-3">{search ? `${tree.count} de ${elements.length} elementos · con sus elementos superiores` : `${elements.length} elementos · despliega una rama para ver sus dependientes`}</p>
      <div className="flex flex-wrap gap-1"><Boton tam="sm" variante="fantasma" className="min-h-11" disabled={!tree.branchIds.size} onClick={() => expandAll(true)}>Desplegar todo</Boton><Boton tam="sm" variante="fantasma" className="min-h-11" disabled={!tree.branchIds.size} onClick={() => expandAll(false)}>Plegar todo</Boton></div>
    </div>
    <p role="status" aria-live="polite" className="min-h-10 text-sm font-medium text-acento-texto">{dropTarget ? `Soltar ${dropTarget.placement === 'before' ? 'antes de' : dropTarget.placement === 'after' ? 'después de' : 'dentro de'} ${targetLabel}` : sourceId ? 'Arrastra a un destino compatible. Suelta arriba o abajo para ordenar, o en el centro para cambiar de elemento superior.' : 'Arrastra el asa de puntos para mover, o púlsala para elegir el destino con teclado.'}</p>
    {tree.roots.length ? <ul role="list" aria-label="Elementos curriculares" className="rounded-xl border border-borde bg-panel p-1 sm:p-2">
      {tree.roots.map(node => <CurriculumBranch key={node.element.id} node={node} labels={labels} reviews={reviews} disabled={disabled} onReview={onReview} searching={!!search} isExpanded={isExpanded} onToggle={toggle} onOpen={onOpen} onMove={onMove} drag={drag} />)}
    </ul> : <p className="rounded-xl border border-borde p-4 text-sm text-texto-2">{elements.length ? 'No hay coincidencias.' : 'Busca el currículo oficial, importa un archivo JSON o añade elementos al borrador.'}</p>}
    {!!tree.roots.length && <p className="text-xs text-texto-3">La flecha despliega la rama; el texto abre sus detalles. Las casillas aceptan o desmarcan el elemento y todos sus descendientes, incluidos los ocultos por la búsqueda. La aceptación parcial se muestra con un guion. Arrastra el asa de puntos para mover: arriba o abajo de otra fila para ordenar, o en su centro para cambiar el elemento superior. También puedes pulsar el asa para abrir Mover con teclado.</p>}
  </section>;
}

type BranchProps = { node: CurriculumTreeNode; labels: Map<string, string>; reviews: Map<string, { total: number; reviewed: number }>; disabled: boolean; onReview: Props['onReview']; searching: boolean; isExpanded: (id: string) => boolean; onToggle: (id: string) => void; onOpen: (id: string) => void; onMove: Props['onMove']; drag: DragHandlers };
function CurriculumBranch({ node, labels, reviews, disabled, onReview, searching, isExpanded, onToggle, onOpen, onMove, drag }: BranchProps) {
  const childrenId = useId(), { element, children } = node, hasChildren = children.length > 0, expanded = hasChildren && isExpanded(element.id);
  const label = labels.get(element.id), name = `${label ? `${label} · ` : ''}${CURRICULUM_KINDS[element.kind]}`;
  return <li className="min-w-0">
    <div onDragOver={event => drag.over(event, element.id)} onDragLeave={drag.leave} onDrop={event => drag.drop(event, element.id)} className={cx('relative flex min-w-0 items-start rounded-lg hover:bg-panel-2 focus-within:bg-panel-2', drag.sourceId === element.id && 'opacity-50', drag.target?.id === element.id && drag.target.placement === 'inside' && 'bg-acento-suave ring-2 ring-inset ring-acento')}>
      {drag.target?.id === element.id && drag.target.placement !== 'inside' && <span aria-hidden="true" className={cx('pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-acento', drag.target.placement === 'before' ? 'top-0' : 'bottom-0')} />}
      {hasChildren ? <button type="button" aria-label={`${expanded ? 'Plegar' : 'Desplegar'} ${name}`} aria-expanded={expanded} aria-controls={expanded ? childrenId : undefined} onClick={() => onToggle(element.id)} className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-lg text-texto-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-acento">
        <ChevronRight aria-hidden="true" className={cx('size-4 transition-transform motion-reduce:transition-none', expanded && 'rotate-90')} />
      </button> : <span aria-hidden="true" className="w-11 shrink-0" />}
      <button type="button" aria-haspopup="dialog" onClick={() => onOpen(element.id)} className="min-h-11 min-w-0 flex-1 rounded-lg py-2 pr-2 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-acento">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {label && <span className="break-words text-sm font-semibold text-acento-texto">{label}</span>}
          <span className="text-xs text-texto-2">{CURRICULUM_KINDS[element.kind]}</span>
          {hasChildren && <span className="text-xs tabular-nums text-texto-3">· {node.descendantCount} {searching ? node.descendantCount === 1 ? 'visible' : 'visibles' : node.descendantCount === 1 ? 'elemento' : 'elementos'}</span>}
        </span>
        <span className="mt-1 block line-clamp-2 break-words text-sm leading-relaxed text-texto-2">{element.text || 'Sin texto'}</span>
      </button>
      <button type="button" aria-label={`Mover ${name}`} title="Arrastra para mover o pulsa para elegir el destino" aria-haspopup="dialog" draggable={!disabled} onDragStart={event => drag.start(event, element.id)} onDragEnd={drag.end} disabled={disabled} onClick={() => onMove(element.id)} className="flex min-h-11 w-11 shrink-0 cursor-grab active:cursor-grabbing items-center justify-center rounded-lg text-texto-2 hover:text-acento-texto focus-visible:outline-2 focus-visible:outline-acento disabled:opacity-40"><GripVertical aria-hidden="true" className="size-4" /></button>
      <BranchAcceptance name={name} state={reviews.get(element.id)!} disabled={disabled} onChange={reviewed => onReview(element.id, reviewed)} />
    </div>
    {expanded && <ul role="list" id={childrenId} className="mb-2 ml-4 min-w-0 border-l border-borde pl-1 sm:ml-6 sm:pl-2">{children.map(child => <CurriculumBranch key={child.element.id} node={child} labels={labels} reviews={reviews} disabled={disabled} onReview={onReview} searching={searching} isExpanded={isExpanded} onToggle={onToggle} onOpen={onOpen} onMove={onMove} drag={drag} />)}</ul>}
  </li>;
}

function BranchAcceptance({ name, state, disabled, onChange }: { name: string; state: { total: number; reviewed: number }; disabled: boolean; onChange: (reviewed: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null), mixed = state.reviewed > 0 && state.reviewed < state.total;
  useEffect(() => { if (input.current) input.current.indeterminate = mixed; }, [mixed]);
  const label = `Aceptar ${name}${state.total > 1 ? ` y sus ${state.total - 1} descendientes` : ''}`;
  return <label className="flex min-h-11 w-11 shrink-0 items-center justify-center rounded-lg cursor-pointer focus-within:outline-2 focus-within:outline-acento" title={`${state.reviewed} de ${state.total} aceptados`}>
    <input ref={input} type="checkbox" aria-label={label} checked={state.reviewed === state.total} disabled={disabled} onChange={event => onChange(event.target.checked)} className="size-4 cursor-pointer accent-acento disabled:cursor-not-allowed" />
  </label>;
}
