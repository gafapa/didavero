import { ExternalLink, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { CURRICULUM_KINDS, curriculumBranchIds, curriculumParentOptions, isOfficialCurriculumUrl, type CurriculumDraft, type CurriculumElement, type CurriculumKind } from '../../../shared/curriculum';
import { AreaTexto, Boton, Campo, Entrada, Insignia, Modal } from './ui';

type Props = {
  element: CurriculumElement; draft: CurriculumDraft; labels: Map<string, string>;
  editing: boolean; disabled: boolean; saving: boolean; dirty: boolean; error: string;
  onUpdate: (patch: Partial<CurriculumElement>) => void; onEdit: () => void;
  onAccept: () => void; onDelete: () => void; onSave: () => void; onClose: () => void;
  onAdd: (kind: CurriculumKind, parentId: string) => void; onNavigate: (id: string) => void;
};
const selectClass = 'min-h-11 w-full min-w-0 rounded-xl border border-borde bg-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-acento';
const disclosureClass = 'min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-acento';

export function CurriculumElementDialog({ element, draft, labels, editing, disabled, saving, dirty, error, onUpdate, onEdit, onAccept, onDelete, onSave, onClose, onAdd, onNavigate }: Props) {
  const parent = draft.elements.find(item => item.id === element.parentId), source = draft.sources.find(item => item.id === element.sourceId);
  const children = draft.elements.filter(item => item.parentId === element.id);
  const branch = curriculumBranchIds(draft.elements, element.id);
  const reviewedCount = draft.elements.filter(item => branch.has(item.id) && item.reviewed).length;
  const parentOptions = curriculumParentOptions(element, draft.elements, draft.profile.model);
  const parentLabel = element.kind === 'assessmentCriterion' ? draft.profile.model === 'vocational' ? 'Resultado de aprendizaje' : 'Competencia específica' : element.kind === 'descriptor' ? 'Competencia clave' : 'Bloque de contenidos o saberes superior';
  const hasParentControl = ['assessmentCriterion', 'knowledge', 'contentBlock', 'descriptor'].includes(element.kind) || !!element.parentId;
  const canAddCriterion = ['learningOutcome', 'specificCompetence'].includes(element.kind), canAddContent = element.kind === 'contentBlock';
  const name = labels.get(element.id) || CURRICULUM_KINDS[element.kind];

  return <Modal abierto titulo={name} descripcion={`${CURRICULUM_KINDS[element.kind]} · ${editing ? 'Borrador editable' : 'Versión activa'}`} ancho="max-w-3xl" sinCerrar={saving} onCerrar={onClose}
    footer={<div className="space-y-3">
      <p className="text-xs text-texto-3" role="status">{dirty ? 'Hay cambios sin guardar. Guardar y cerrar conserva todos los cambios pendientes del currículo.' : editing ? 'Borrador guardado. La versión activa se conserva hasta que lo actives.' : 'La versión activa se conserva. Las modificaciones se preparan en un borrador.'}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Boton variante="fantasma" className="min-h-11 text-error" disabled={disabled} icono={<Trash2 aria-hidden="true" className="size-4" />} onClick={onDelete}>Eliminar elemento</Boton>
        <div className="flex flex-wrap gap-2">
          <Boton className="min-h-11" disabled={disabled || reviewedCount === branch.size} onClick={onAccept}>{branch.size > 1 ? `Aceptar rama (${branch.size})` : 'Aceptar elemento'}</Boton>
          <Boton variante="primario" className="min-h-11" disabled={saving || (dirty && disabled)} cargando={saving} icono={dirty ? <Save aria-hidden="true" className="size-4" /> : undefined} onClick={dirty ? onSave : onClose}>{dirty ? 'Guardar y cerrar' : 'Cerrar'}</Boton>
        </div>
      </div>
    </div>}>
    <div className="min-w-0 space-y-5">
      {error && <p role="alert" className="rounded-lg border border-error/40 p-3 text-sm text-error">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2"><Insignia color={element.reviewed ? 'ok' : 'aviso'}>{element.reviewed ? 'Elemento aceptado' : 'Pendiente de aceptar'}</Insignia>{branch.size > 1 && <span className="text-xs text-texto-2">Rama: {reviewedCount} de {branch.size} aceptados</span>}</div>
        {!editing && <Boton className="min-h-11" disabled={disabled} icono={<Pencil aria-hidden="true" className="size-4" />} onClick={onEdit}>Editar en borrador</Boton>}
      </div>
      {parent && <p className="break-words text-sm text-texto-2">Depende de <span className="font-medium text-texto">{labels.get(parent.id)} · {CURRICULUM_KINDS[parent.kind]}</span><span className="mt-1 block line-clamp-2 text-xs">{parent.text}</span></p>}
      <section aria-label="Texto normativo" className="space-y-2">
        {editing ? <Campo etiqueta="Texto normativo literal"><AreaTexto disabled={disabled} rows={5} className="min-h-36 text-sm leading-relaxed" value={element.text} onChange={event => onUpdate({ text: event.target.value })} /></Campo>
          : <><h3 className="text-sm font-semibold">Texto normativo literal</h3><p className="max-w-prose whitespace-pre-wrap break-words text-base leading-relaxed">{element.text || 'Sin texto. Puedes completarlo en un borrador.'}</p></>}
      </section>
      <label className="flex min-h-11 items-start gap-3 text-sm text-texto-2"><input className="mt-1 size-4 shrink-0 accent-acento" type="checkbox" disabled={disabled} checked={element.reviewed} onChange={event => onUpdate({ reviewed: event.target.checked })} /><span>He contrastado este elemento con la fuente.<span className="mt-1 block text-xs text-texto-3">Para incluir sus descendientes, usa la aceptación de la rama.</span></span></label>
      <div className="divide-y divide-borde border-y border-borde">
        {editing && <details><summary className={disclosureClass}>Identificación y jerarquía</summary><fieldset disabled={disabled} className="space-y-3 pb-4">
          <div className="grid gap-3 sm:grid-cols-2"><Campo etiqueta="Tipo"><select className={selectClass} value={element.kind} onChange={event => onUpdate({ kind: event.target.value as CurriculumKind, parentId: '' })}>{Object.entries(CURRICULUM_KINDS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></Campo>
            <Campo etiqueta="Código original" ayuda="Déjalo vacío si la norma no publica un código."><Entrada value={element.code} onChange={event => onUpdate({ code: event.target.value })} /></Campo></div>
          {hasParentControl && <Campo etiqueta={parentLabel}><select className={selectClass} value={element.parentId} onChange={event => onUpdate({ parentId: event.target.value })}><option value="">{element.kind === 'contentBlock' ? 'Bloque principal' : 'Selecciona su elemento superior'}</option>{parentOptions.map(item => <option key={item.id} value={item.id}>{labels.get(item.id)} · {item.text.slice(0, 90)}</option>)}</select></Campo>}
        </fieldset></details>}
        <details><summary className={disclosureClass}>Fuente y contraste{!source ? ' · sin fuente asignada' : ''}</summary><div className="space-y-3 pb-4">
          {editing ? <fieldset disabled={disabled} className="space-y-3"><Campo etiqueta="Fuente"><select className={selectClass} value={element.sourceId} onChange={event => onUpdate({ sourceId: event.target.value })}><option value="">Sin seleccionar</option>{draft.sources.map(item => <option key={item.id} value={item.id}>{item.title || 'Fuente sin título'}</option>)}</select></Campo>
            <Campo etiqueta="Localización en la norma"><Entrada placeholder="Anexo, materia, ciclo/curso, página o apartado" value={element.locator} onChange={event => onUpdate({ locator: event.target.value })} /></Campo>
            <Campo etiqueta="Fragmento original para contrastar"><AreaTexto rows={3} value={element.excerpt} onChange={event => onUpdate({ excerpt: event.target.value })} /></Campo></fieldset>
            : <><p className="break-words text-sm font-medium">{source?.title || 'Sin fuente asignada'}</p><p className="whitespace-pre-wrap break-words text-sm text-texto-2">{element.locator || 'Sin localización indicada.'}</p>{element.excerpt && <blockquote className="whitespace-pre-wrap break-words border-l border-borde pl-3 text-sm leading-relaxed text-texto-2">{element.excerpt}</blockquote>}</>}
          {source && isOfficialCurriculumUrl(source.url) && <a className="inline-flex min-h-11 items-center gap-2 text-sm text-acento-texto underline" href={source.url} target="_blank" rel="noreferrer">Abrir publicación oficial<ExternalLink aria-hidden="true" className="size-3.5" /></a>}
        </div></details>
        <details><summary className={disclosureClass}>Notas del docente{element.notes.trim() ? ' · con anotaciones' : ''}</summary><div className="space-y-2 pb-4"><p className="text-xs text-texto-3">Estas notas se conservan separadas del texto normativo.</p>{editing ? <Campo etiqueta="Concreción o notas del docente"><AreaTexto disabled={disabled} rows={3} value={element.notes} onChange={event => onUpdate({ notes: event.target.value })} /></Campo> : <p className="whitespace-pre-wrap break-words text-sm text-texto-2">{element.notes || 'Sin notas añadidas.'}</p>}</div></details>
        {(children.length > 0 || (editing && (canAddCriterion || canAddContent))) && <details><summary className={disclosureClass}>Elementos dependientes ({children.length})</summary><div className="space-y-3 pb-4">
          {!!children.length && <ul className="divide-y divide-borde">{children.map(child => <li key={child.id}><button type="button" className="min-h-11 w-full rounded-lg py-2 text-left text-sm hover:bg-panel-2 focus-visible:outline-2 focus-visible:outline-acento" onClick={() => onNavigate(child.id)}><span className="font-medium text-acento-texto">{labels.get(child.id)} · {CURRICULUM_KINDS[child.kind]}</span><span className="mt-1 block line-clamp-2 break-words text-texto-2">{child.text || 'Sin texto'}</span></button></li>)}</ul>}
          {editing && <div className="flex flex-wrap gap-2">{canAddCriterion && <Boton className="min-h-11" disabled={disabled} icono={<Plus aria-hidden="true" className="size-4" />} onClick={() => onAdd('assessmentCriterion', element.id)}>Añadir criterio de evaluación</Boton>}{canAddContent && <><Boton className="min-h-11" disabled={disabled} onClick={() => onAdd('knowledge', element.id)}>Añadir contenido</Boton><Boton className="min-h-11" disabled={disabled} onClick={() => onAdd('contentBlock', element.id)}>Añadir subbloque</Boton></>}</div>}
        </div></details>}
      </div>
    </div>
  </Modal>;
}
