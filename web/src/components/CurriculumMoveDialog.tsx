import { useState } from 'react';
import { CURRICULUM_KINDS, curriculumBranchIds, curriculumParentOptions, type CurriculumDraft, type CurriculumElement } from '../../../shared/curriculum';
import { Boton, Campo, Modal } from './ui';

type Props = { element: CurriculumElement; draft: CurriculumDraft; labels: Map<string, string>; disabled: boolean; onMove: (parentId: string, beforeId: string) => void; onClose: () => void };
const selectClass = 'min-h-11 w-full min-w-0 rounded-xl border border-borde bg-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-acento';

export function CurriculumMoveDialog({ element, draft, labels, disabled, onMove, onClose }: Props) {
  const siblings = draft.elements.filter(item => item.parentId === element.parentId);
  const initialBefore = siblings[siblings.findIndex(item => item.id === element.id) + 1]?.id ?? '';
  const [parentId, setParentId] = useState(element.parentId);
  const [beforeId, setBeforeId] = useState(initialBefore);
  const [error, setError] = useState('');
  const branchIds = curriculumBranchIds(draft.elements, element.id);
  const parents = curriculumParentOptions(element, draft.elements, draft.profile.model);
  const destinations = draft.elements.filter(item => item.parentId === parentId && !branchIds.has(item.id));
  const canBeRoot = !['assessmentCriterion', 'knowledge', 'descriptor'].includes(element.kind);
  const label = (item: CurriculumElement) => `${labels.get(item.id) || CURRICULUM_KINDS[item.kind]} · ${item.text.slice(0, 100) || 'Sin texto'}`;
  const unchanged = parentId === element.parentId && beforeId === initialBefore;
  return <Modal abierto onCerrar={onClose} titulo="Mover elemento" ancho="max-w-xl" footer={<div className="flex flex-wrap justify-end gap-2"><Boton className="min-h-11" onClick={onClose}>Cancelar</Boton><Boton variante="primario" className="min-h-11" disabled={disabled || unchanged} onClick={() => { try { onMove(parentId, beforeId); } catch (failure) { setError((failure as Error).message); } }}>Mover en el borrador</Boton></div>}>
    <div className="min-w-0 space-y-5">
      <p className="break-words text-sm font-medium">{label(element)}</p>
      <p className="text-sm leading-relaxed text-texto-2">{branchIds.size > 1 ? `Se moverán este elemento y sus ${branchIds.size - 1} descendientes, incluidos los ocultos por la búsqueda.` : 'Se cambiará la ubicación de este elemento.'} Los textos, códigos y referencias se conservan.</p>
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
      <Campo etiqueta="Elemento superior" ayuda="Solo se muestran destinos compatibles fuera de la rama que estás moviendo."><select disabled={disabled} className={selectClass} value={parentId} onChange={event => { setParentId(event.target.value); setBeforeId(''); setError(''); }}>
        {(canBeRoot || !element.parentId) && <option value="">Nivel principal</option>}
        {element.parentId && !parents.some(item => item.id === element.parentId) && <option value={element.parentId}>Ubicación actual (pendiente de revisar)</option>}
        {parents.map(item => <option key={item.id} value={item.id}>{label(item)}</option>)}
      </select></Campo>
      <Campo etiqueta="Posición"><select disabled={disabled} className={selectClass} value={beforeId} onChange={event => setBeforeId(event.target.value)}><option value="">Al final</option>{destinations.map(item => <option key={item.id} value={item.id}>Antes de {label(item)}</option>)}</select></Campo>
      <p className="text-xs leading-relaxed text-texto-3">El movimiento quedará sin guardar. La versión activa se conserva hasta que guardes y actives el borrador. Si cambias el elemento superior, tendrás que aceptar de nuevo el elemento movido.</p>
    </div>
  </Modal>;
}
