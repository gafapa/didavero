import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Sparkles, Trash2 } from 'lucide-react';
import { CURRICULUM_KINDS, curriculumElementLabels, type CurriculumVersion } from '../../../shared/curriculum';
import type { TeachingUnit, TeachingActivity, ProgrammeUnitProposal } from '../../../shared/teachingProgramme';
import { programmeReferenceElements, programmeUnitLabels, withActivityPlan } from '../../../shared/programmeUnits';
import { AreaTexto, Boton, Campo, Entrada, Modal } from './ui';

type Selection = { referentIds?: string[]; criterionIds: string[]; contentIds: string[] };

function CurriculumPicker({ value, curriculum, allowed, pinned, onChange }: { value: Selection; curriculum: CurriculumVersion; allowed?: Set<string>; pinned?: Set<string>; onChange: (change: Partial<Selection>) => void }) {
  const [query, setQuery] = useState('');
  const labels = programmeUnitLabels(curriculum), codes = curriculumElementLabels(curriculum.elements);
  const groups = [
    [labels.referents, 'referentIds', ['learningOutcome', 'specificCompetence']],
    [labels.criteria, 'criterionIds', ['assessmentCriterion']],
    [labels.blocks, 'contentIds', ['contentBlock']],
    [labels.contents, 'contentIds', ['knowledge']],
  ] as const;
  const related = programmeReferenceElements(curriculum, value);
  const official = curriculum.links.filter(link => link.origin === 'official' && related.some(element => element.id === link.fromId))
    .map(link => curriculum.elements.find(element => element.id === link.toId)).filter(element => element && ['keyCompetence', 'descriptor'].includes(element.kind));
  return <div className="space-y-3">
    <Campo etiqueta="Buscar en el currículo"><Entrada value={query} onChange={event => setQuery(event.target.value)} placeholder="Código o texto" /></Campo>
    {groups.map(([label, field, kinds]) => {
      const selected = value[field] ?? [];
      const elements = curriculum.elements.filter(element => (kinds as readonly string[]).includes(element.kind) && (!allowed || allowed.has(element.id)) && `${codes.get(element.id)} ${element.text}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      return <details key={label} className="rounded-lg border border-borde px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">{label} · {related.filter(element => (kinds as readonly string[]).includes(element.kind)).length} vinculados</summary>
        <fieldset className="mt-3 max-h-60 space-y-3 overflow-y-auto pr-1"><legend className="sr-only">{label}</legend>
          {elements.length ? elements.map(element => <label key={element.id} className="flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" className="mt-1 shrink-0" checked={selected.includes(element.id) || related.some(item => item.id === element.id)} disabled={pinned?.has(element.id) || (!selected.includes(element.id) && related.some(item => item.id === element.id))} onChange={event => onChange({ [field]: event.target.checked ? [...selected, element.id] : selected.filter(id => id !== element.id) })} /><span>
            {element.parentId && <span className="block text-xs text-texto-3">{codes.get(element.parentId)} · {curriculum.elements.find(parent => parent.id === element.parentId)?.text}</span>}
            <strong>{codes.get(element.id)}{codes.get(element.id) ? ' · ' : ''}</strong>{element.text}
          </span></label>) : <p className="text-sm text-texto-3">{allowed ? 'Selecciona primero estos elementos en la unidad, o cambia la búsqueda.' : 'No hay elementos de este tipo para esta búsqueda.'}</p>}
        </fieldset>
      </details>;
    })}
    {related.some(element => ['learningOutcome', 'specificCompetence', 'contentBlock'].includes(element.kind)) && <p className="text-xs text-texto-2">Referentes y bloques vinculados, incluidos los de los criterios y contenidos elegidos: {related.filter(element => ['learningOutcome', 'specificCompetence', 'contentBlock'].includes(element.kind)).map(element => codes.get(element.id) || element.text).join(' · ')}.</p>}
    {!!official.length && <p className="text-xs text-texto-2">Relaciones oficiales disponibles: {official.map(element => `${element!.code} (${CURRICULUM_KINDS[element!.kind]})`).join(' · ')}.</p>}
    <p className="text-xs text-texto-3">Las casillas son decisiones de esta programación. El currículo oficial se conserva. Los referentes y bloques superiores se vinculan automáticamente desde sus criterios y contenidos. Para quitar un elemento usado por una actividad, retíralo antes de esa actividad.</p>
  </div>;
}

export function ProgrammeUnitEditor({ unit, curriculum, onChange, onHelp, onClose, onRemove, onMove, first, last, busy }: {
  unit: TeachingUnit; curriculum: CurriculumVersion; onChange: (unit: TeachingUnit) => void;
  onHelp: () => void; onClose: () => void; onRemove: () => void; onMove: (direction: number) => void; first: boolean; last: boolean; busy: boolean;
}) {
  const [activityId, setActivityId] = useState('');
  const labels = programmeUnitLabels(curriculum), activities = unit.activityPlan ?? [];
  const activity = activities.find(item => item.id === activityId);
  const change = (update: Partial<TeachingUnit>) => onChange({ ...unit, ...update });
  const changeActivity = (update: Partial<TeachingActivity>) => onChange(withActivityPlan(unit, activities.map(item => item.id === activityId ? { ...item, ...update } : item)));
  const moveActivity = (direction: number) => {
    const index = activities.findIndex(item => item.id === activityId), next = [...activities];
    if (index + direction < 0 || index + direction >= next.length) return;
    [next[index], next[index + direction]] = [next[index + direction], next[index]]; change({ activityPlan: next });
  };
  const scope = new Set(programmeReferenceElements(curriculum, unit).map(element => element.id));
  return <div className="space-y-4 pb-5">
    <div className="flex justify-end"><Boton tam="sm" icono={<Sparkles className="size-4" />} disabled={busy} onClick={onHelp}>Ayuda con IA para esta unidad</Boton></div>
    <Campo etiqueta="Título de la unidad"><Entrada value={unit.title} onChange={event => change({ title: event.target.value })} /></Campo>
    <div className="grid gap-3 sm:grid-cols-3"><Campo etiqueta="Horas de la unidad"><Entrada type="number" min="0" max="10000" step="0.5" value={unit.hours || ''} onChange={event => change({ hours: Number(event.target.value) })} /></Campo>
      <Campo etiqueta="Sesiones (opcional)"><Entrada type="number" min="0" max="10000" step="1" value={unit.sessions ?? ''} onChange={event => change({ sessions: event.target.value === '' ? undefined : Number(event.target.value) })} /></Campo>
      <Campo etiqueta="Período / evaluación"><Entrada value={unit.period} onChange={event => change({ period: event.target.value })} /></Campo></div>
    <Campo etiqueta={labels.situation}><AreaTexto rows={3} value={unit.learningSituation ?? ''} onChange={event => change({ learningSituation: event.target.value })} placeholder={labels.vocational ? 'Encargo, problema profesional o producto que se elaborará…' : 'Contexto, reto y producto o actuación final…'} /></Campo>
    <details><summary className="cursor-pointer text-sm font-medium">Vinculación curricular de la unidad</summary><div className="mt-3"><CurriculumPicker value={unit} curriculum={curriculum} pinned={new Set(activities.flatMap(activity => [...activity.referentIds, ...activity.criterionIds, ...activity.contentIds]))} onChange={update => change(update)} /></div></details>
    <section aria-label="Actividades de la unidad" className="space-y-3 border-t border-borde pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Actividades de la unidad</h4><Boton tam="sm" icono={<Plus className="size-4" />} onClick={() => {
        const next: TeachingActivity = { id: crypto.randomUUID(), title: 'Nueva actividad', hours: 0, description: '', objectives: '', evidence: '', instrument: '', resources: '', referentIds: [], criterionIds: [], contentIds: [] };
        change({ activityPlan: [...activities, next] }); setActivityId(next.id);
      }}>Añadir actividad</Boton></div>
      {activities.length ? <ol className="divide-y divide-borde">{activities.map((item, index) => <li key={item.id}><button className="flex w-full items-start justify-between gap-3 rounded p-3 text-left hover:bg-panel-2 cursor-pointer" onClick={() => setActivityId(item.id)}><span className="min-w-0 break-words"><span className="font-medium">{index + 1}. {item.title}</span><span className="mt-1 block text-xs text-texto-2">{item.criterionIds.length} {item.criterionIds.length === 1 ? 'criterio' : 'criterios'} · {item.contentIds.length} {item.contentIds.length === 1 ? 'contenido' : 'contenidos'}{item.sessions !== undefined ? ` · ${item.sessions} sesiones` : ''}</span></span><span className="shrink-0 text-sm">{item.hours} h</span></button></li>)}</ol> : <p className="text-sm text-texto-2">Define las actividades y vincula cada una con el currículo de la unidad, o pide una propuesta con IA.</p>}
      {!!activities.length && <p className="text-xs text-texto-2">{activities.reduce((sum, item) => sum + item.hours, 0)} / {unit.hours} h distribuidas en actividades. Horas y sesiones se planifican por separado.</p>}
    </section>
    {(unit.activities.trim() || unit.evidence.trim()) && <details><summary className="cursor-pointer text-sm font-medium">Textos generales y anteriores de la unidad</summary><div className="mt-3 space-y-3"><Campo etiqueta="Descripción general de actividades"><AreaTexto rows={3} value={unit.activities} onChange={event => change({ activities: event.target.value })} /></Campo><Campo etiqueta="Evidencias generales"><AreaTexto rows={3} value={unit.evidence} onChange={event => change({ evidence: event.target.value })} /></Campo></div></details>}
    <div className="flex flex-wrap gap-2"><Boton tam="sm" icono={<ArrowUp className="size-4" />} disabled={first} onClick={() => onMove(-1)}>Subir unidad</Boton><Boton tam="sm" icono={<ArrowDown className="size-4" />} disabled={last} onClick={() => onMove(1)}>Bajar unidad</Boton><Boton tam="sm" icono={<Trash2 className="size-4" />} onClick={onRemove}>Quitar unidad</Boton><Boton tam="sm" variante="primario" className="ml-auto" onClick={onClose}>Listo</Boton></div>
    <p className="text-xs text-texto-3">Los cambios quedan en el borrador. Guarda la programación al terminar.</p>
    <Modal abierto={!!activity} onCerrar={() => setActivityId('')} titulo="Editar actividad" ancho="max-w-3xl">{activity && <div className="space-y-4 pb-5">
      <Campo etiqueta="Título de la actividad"><Entrada value={activity.title} onChange={event => changeActivity({ title: event.target.value })} /></Campo>
      <div className="grid gap-3 sm:grid-cols-2"><Campo etiqueta="Horas de la actividad"><Entrada type="number" min="0" max="10000" step="0.5" value={activity.hours || ''} onChange={event => changeActivity({ hours: Number(event.target.value) })} /></Campo><Campo etiqueta="Sesiones de la actividad (opcional)"><Entrada type="number" min="0" max="10000" step="1" value={activity.sessions ?? ''} onChange={event => changeActivity({ sessions: event.target.value === '' ? undefined : Number(event.target.value) })} /></Campo></div>
      <Campo etiqueta="Tareas del alumnado y del docente"><AreaTexto rows={4} value={activity.description} onChange={event => changeActivity({ description: event.target.value })} /></Campo>
      <Campo etiqueta="Objetivos didácticos de la actividad"><AreaTexto rows={2} value={activity.objectives} onChange={event => changeActivity({ objectives: event.target.value })} /></Campo>
      <Campo etiqueta="Producto / evidencia observable"><AreaTexto rows={2} value={activity.evidence} onChange={event => changeActivity({ evidence: event.target.value })} /></Campo>
      <Campo etiqueta="Instrumento de evaluación"><Entrada value={activity.instrument} onChange={event => changeActivity({ instrument: event.target.value })} placeholder="Rúbrica, lista de cotejo, prueba práctica…" /></Campo>
      <Campo etiqueta="Recursos y materiales"><AreaTexto rows={2} value={activity.resources} onChange={event => changeActivity({ resources: event.target.value })} /></Campo>
      <details><summary className="cursor-pointer text-sm font-medium">Vinculación curricular de la actividad</summary><div className="mt-3"><CurriculumPicker key={activity.id} value={activity} curriculum={curriculum} allowed={scope} onChange={changeActivity} /></div></details>
      <div className="flex flex-wrap gap-2"><Boton tam="sm" disabled={activities[0]?.id === activity.id} onClick={() => moveActivity(-1)}>Subir actividad</Boton><Boton tam="sm" disabled={activities.at(-1)?.id === activity.id} onClick={() => moveActivity(1)}>Bajar actividad</Boton><Boton tam="sm" onClick={() => { change({ activityPlan: activities.filter(item => item.id !== activity.id) }); setActivityId(''); }}>Quitar actividad</Boton><Boton tam="sm" variante="primario" className="ml-auto" onClick={() => setActivityId('')}>Listo</Boton></div>
    </div>}</Modal>
  </div>;
}

export function ProgrammeUnitHelp({ unit, proposal, curriculum, running, busy, dirty, revision, error, onGenerate, onApply }: {
  unit?: TeachingUnit; proposal?: ProgrammeUnitProposal; curriculum: CurriculumVersion; running: boolean; busy: boolean; dirty: boolean; revision: number; error: string;
  onGenerate: (instructions: string) => void; onApply: (proposal: ProgrammeUnitProposal) => void;
}) {
  const [instructions, setInstructions] = useState('');
  const matching = proposal && proposal.unitId === unit?.id ? proposal : undefined;
  const stale = matching && matching.expectedRevision !== revision;
  return <div className="space-y-4 pb-5">
    <p className="text-sm text-texto-2">{unit ? `Desarrolla «${unit.title}»: actividades, evidencias y vínculos con el currículo. Conserva sus horas y sesiones y las demás unidades.` : 'Propón la secuencia de unidades y sus actividades, distribuyendo las horas del curso y vinculando el currículo.'} Se reutilizan el currículo y la investigación guardados.</p>
    <Campo etiqueta="Indicaciones para la ayuda con IA (opcional)"><AreaTexto rows={3} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="Tipo de tareas, recursos, necesidades del grupo…" /></Campo>
    <Boton variante="primario" icono={<Sparkles className="size-4" />} disabled={running || busy} onClick={() => onGenerate(instructions)}>{running ? 'Elaborando propuesta…' : unit ? 'Proponer actividades y vínculos' : 'Proponer unidades y actividades'}</Boton>
    <p className="text-xs text-texto-3">Se guardará el borrador antes de pedir ayuda. La propuesta queda separada hasta que pulses Aplicar propuesta.</p>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    {matching && <section aria-label="Propuesta de unidades y actividades" className="space-y-3 border-t border-borde pt-4">
      <h4 className="font-semibold">Propuesta para revisar</h4>
      {matching.units.map(item => <details key={item.id} className="rounded-lg border border-borde p-3" open={matching.units.length === 1}><summary className="cursor-pointer text-sm font-medium">{item.title} · {item.hours} h · {item.activityPlan?.length ?? 0} {item.activityPlan?.length === 1 ? 'actividad' : 'actividades'}</summary><div className="mt-3 space-y-3 text-sm"><p>{item.period}{item.sessions !== undefined ? ` · ${item.sessions} sesiones` : ''}</p><p>{item.learningSituation}</p>{item.evidence && <p>Evidencias de la unidad: {item.evidence}</p>}{item.activities && <p className="whitespace-pre-wrap">Descripción general de actividades: {item.activities}</p>}<p>{programmeReferenceElements(curriculum, item).map(element => element.code || element.text).join(' · ')}</p>{item.activityPlan?.map(activity => <div key={activity.id} className="border-t border-borde pt-3"><p className="font-medium">{activity.title} · {activity.hours} h{activity.sessions !== undefined ? ` · ${activity.sessions} sesiones` : ''}</p><p className="whitespace-pre-wrap">{activity.description}</p><p className="mt-1">Objetivos: {activity.objectives}</p><p className="mt-1">Evidencia: {activity.evidence} · Instrumento: {activity.instrument}</p><p className="mt-1">Recursos: {activity.resources}</p><p className="mt-1 text-xs text-texto-2">{programmeReferenceElements(curriculum, activity).map(element => `${element.code}: ${element.text}`).join(' · ')}</p></div>)}</div></details>)}
      {matching.applied ? <p role="status" className="text-sm text-ok">Propuesta ya aplicada. Puedes editarla en las unidades.</p> : <>
        {(stale || dirty) && <p role="status" className="text-sm text-aviso">Hay cambios posteriores o sin guardar. Pide una propuesta nueva para conservarlos.</p>}
        <Boton variante="primario" disabled={busy || running || dirty || !!stale} onClick={() => onApply(matching)}>Aplicar propuesta</Boton>
        <p className="text-xs text-texto-3">{unit ? 'Sustituye solo la unidad seleccionada.' : 'Sustituye la secuencia de unidades del borrador.'} Los apartados y la copia revisada se conservan.</p>
      </>}
    </section>}
  </div>;
}
