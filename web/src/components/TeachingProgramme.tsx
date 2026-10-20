import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Download, Eye, Plus, Save, Search, Sparkles, Trash2 } from 'lucide-react';
import DOMPurify from 'dompurify';
import { PROGRAMME_PURPOSES, PROGRAMME_STAGE_LABELS, PROGRAMME_SECTIONS, emptyProgramme, programmeIssues, programmeMarkdown, applyProgrammeResearch, type ProgrammeExportFormat, type CreateProgrammeRequest, type ProgrammeProjectSummary, type ProgrammePurpose, type ProgrammeResponse, type TeachingProgramme, type TeachingUnit } from '../../../shared/teachingProgramme';
import { activeCurriculum, type CurriculumVersion } from '../../../shared/curriculum';
import { api } from '../lib/api';
import { useCampos } from '../lib/estado';
import { renderizar } from '../lib/markdown';
import { AreaTexto, Boton, Campo, Entrada, Modal, Vacio, confirmar } from './ui';
import { ProgrammeResearchPanel } from './ProgrammeResearchPanel';
import { ProgrammeUnitEditor, ProgrammeUnitHelp } from './ProgrammeUnitEditor';
import { ProgrammeSections, ProgrammePlanningInputs } from './ProgrammeSections';
import { ProgrammePresentationEditor } from './ProgrammePresentationEditor';

export function TeachingProgrammeTab({ subjectId, onCurriculum, onCount }: { subjectId: string; onCurriculum: () => void; onCount: (count: number) => void }) {
  const [projects, setProjects] = useState<ProgrammeProjectSummary[]>();
  const [selected, setSelected] = useState<{ id: string; purpose: ProgrammePurpose }>();
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const { avisar: notify } = useCampos('avisar');
  const [curriculum, setCurriculum] = useState<CurriculumVersion>();
  const [input, setInput] = useState<Pick<CreateProgrammeRequest, 'title' | 'purpose'>>({ title: '', purpose: 'classroom' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function loadProjects() {
    try { const result = await api.programmes(subjectId); setProjects(result); onCount(result.length); setError(''); }
    catch (failure) { setError((failure as Error).message); }
  }
  useEffect(() => { void loadProjects(); }, [subjectId]);
  async function startCreation() {
    setBusy(true); setError('');
    try { const result = await api.structuredCurriculum(subjectId); setCurriculum(activeCurriculum(result.state)); setInput({ title: '', purpose: 'classroom' }); setCreating(true); }
    catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  async function deleteProject(project: ProgrammeProjectSummary) {
    if (!await confirmar(`¿Eliminar «${project.title}»?`, { texto: 'Se moverá la programación completa a la papelera, con las versiones de uso docente y oposiciones, sus investigaciones y copias revisadas. Puedes recuperarla en Inicio → Papelera.', boton: 'Mover a la papelera', peligro: true })) return;
    setDeletingId(project.id); setError('');
    try { await api.deleteProgramme(subjectId, project.id); await loadProjects(); notify('Programación movida a la papelera.', 'ok'); }
    catch (failure) { setError((failure as Error).message); }
    finally { setDeletingId(''); }
  }
  if (selected) return <div className="space-y-5"><Boton variante="fantasma" icono={<ArrowLeft className="size-4" />} onClick={() => { setSelected(undefined); void loadProjects(); }}>Volver a programaciones</Boton><ProgrammeWorkspace key={selected.id} subjectId={subjectId} projectId={selected.id} initialPurpose={selected.purpose} onCurriculum={onCurriculum} /></div>;
  return <div className="space-y-4">
    {error && <p role="alert" className="text-sm text-error">{error}<button className="ml-2 underline cursor-pointer" onClick={() => void loadProjects()}>Reintentar</button></p>}
    {!projects ? <p role="status" className="text-sm text-texto-2">Cargando programaciones…</p> : projects.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">{projects.map(project => <div key={project.id} className="rounded-xl border border-borde bg-panel hover:border-acento/50"><button className="w-full rounded-xl p-4 text-left cursor-pointer disabled:cursor-wait" disabled={deletingId === project.id} onClick={() => setSelected({ id: project.id, purpose: project.initialPurpose })}><BookOpen className="mb-3 size-5 text-acento-texto" /><span className="block font-medium break-words">{project.title}</span><span className="mt-1 block text-sm text-texto-2">{PROGRAMME_PURPOSES[project.initialPurpose]}</span><span className="mt-3 block text-xs text-texto-3">{project.unitCount} {project.unitCount === 1 ? 'unidad' : 'unidades'} · {project.totalHours || '—'} h{project.reviewed ? ' · Con copia revisada' : ' · Borrador'}</span></button><div className="flex justify-end px-3 pb-3"><Boton tam="sm" variante="fantasma" icono={<Trash2 className="size-3.5" />} aria-label={`Eliminar programación ${project.title}`} disabled={!!deletingId || busy} cargando={deletingId === project.id} onClick={() => void deleteProject(project)}>Eliminar</Boton></div></div>)}<button className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-borde p-4 text-texto-2 hover:border-acento hover:text-acento-texto cursor-pointer" disabled={busy} onClick={() => void startCreation()}><Plus className="size-5" />Nueva programación</button></div> : <Vacio icono={<BookOpen className="size-6" />} titulo="Sin programaciones todavía" texto="Crea varias programaciones para distintos grupos o enfoques. Cada una puede tener una versión de uso docente y otra para oposiciones." accion={<Boton variante="primario" cargando={busy} icono={<Plus className="size-4" />} onClick={() => void startCreation()}>Nueva programación</Boton>} />}
    <Modal abierto={creating} onCerrar={() => setCreating(false)} titulo="Nueva programación" ancho="max-w-lg" sinCerrar={busy}>
      {curriculum ? <form className="space-y-4 pb-5" onSubmit={event => { event.preventDefault(); setBusy(true); setError(''); void api.createProgramme(subjectId, { ...input, totalHours: 0, context: '', requirements: '', selectionRequirements: '' }).then(async project => { setCreating(false); await loadProjects(); setSelected({ id: project.id, purpose: project.initialPurpose }); }).catch(failure => setError((failure as Error).message)).finally(() => setBusy(false)); }}>
        <p className="text-sm text-texto-2">{curriculum.profile.subject} · {curriculum.profile.territory} · {curriculum.profile.academicYear}. Se usará el currículo activo.</p>
        <Campo etiqueta="Título"><Entrada required maxLength={500} value={input.title} onChange={event => setInput({ ...input, title: event.target.value })} placeholder="Por ejemplo: Ofimática · Grupo A" /></Campo>
        <fieldset><legend className="mb-2 text-sm font-medium">Modalidad</legend><div className="flex flex-wrap gap-3">{Object.entries(PROGRAMME_PURPOSES).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" name="new-programme-purpose" checked={input.purpose === key} onChange={() => setInput({ ...input, purpose: key as ProgrammePurpose })} />{label}</label>)}</div></fieldset>
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        <div className="flex justify-end gap-2"><Boton type="button" disabled={busy} onClick={() => setCreating(false)}>Cancelar</Boton><Boton type="submit" variante="primario" cargando={busy} disabled={!input.title.trim()}>Crear programación</Boton></div>
      </form> : <div className="space-y-4 pb-5"><p className="text-sm text-texto-2">Activa un currículo antes de crear una programación.</p><Boton variante="primario" onClick={onCurriculum}>Ir al currículo</Boton></div>}
    </Modal>
  </div>;
}

function ProgrammeWorkspace({ subjectId, projectId, initialPurpose, onCurriculum }: { subjectId: string; projectId: string; initialPurpose: ProgrammePurpose; onCurriculum: () => void }) {
  const [purpose, setPurpose] = useState<ProgrammePurpose>(initialPurpose);
  return <div className="space-y-5"><fieldset><legend className="mb-2 text-sm font-medium">Versión de la programación</legend><div className="flex flex-wrap gap-3">{Object.entries(PROGRAMME_PURPOSES).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" name="programme-purpose" checked={purpose === key} onChange={() => setPurpose(key as ProgrammePurpose)} />{label}</label>)}</div></fieldset><ProgrammeEditor key={`${projectId}:${purpose}`} subjectId={subjectId} projectId={projectId} purpose={purpose} onCurriculum={onCurriculum} /></div>;
}

function ProgrammeEditor({ subjectId, projectId, purpose, onCurriculum }: { subjectId: string; projectId: string; purpose: ProgrammePurpose; onCurriculum: () => void }) {
  const { trabajos: jobs, avisar: notify } = useCampos('trabajos', 'avisar');
  const [response, setResponse] = useState<ProgrammeResponse>();
  const [draft, setDraft] = useState<TeachingProgramme>();
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const draftRef = useRef<TeachingProgramme | undefined>(undefined);
  const revisionRef = useRef(0);
  const editVersion = useRef(0);
  const loadSequence = useRef(0);
  const busyRef = useRef(false);
  const [exportFormat, setExportFormat] = useState<ProgrammeExportFormat>('docx');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unitId, setUnitId] = useState('');
  const [preview, setPreview] = useState(false);
  const [generate, setGenerate] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [helpTarget, setHelpTarget] = useState<string | null>(null);
  const recoveryKey = `programme-unsaved:${subjectId}:${projectId}:${purpose}`;
  const jobRef = `${projectId}:${purpose}`;
  const researchRef = `research:${jobRef}`;
  const signature = Object.values(jobs).filter(job => job.asignatura === subjectId && job.paso === 'programacion' && [jobRef, researchRef].includes(job.ref || '')).map(job => `${job.id}:${job.estado}`).join(',');
  const running = Object.values(jobs).some(job => job.asignatura === subjectId && job.paso === 'programacion' && job.ref === jobRef && ['en-cola', 'ejecutando'].includes(job.estado));
  const researching = Object.values(jobs).some(job => job.asignatura === subjectId && job.paso === 'programacion' && job.ref === researchRef && ['en-cola', 'ejecutando'].includes(job.estado));

  async function load(discardLocal = false) {
    const sequence = ++loadSequence.current, version = editVersion.current;
    try {
      const result = await api.programme(subjectId, projectId, purpose);
      if (sequence !== loadSequence.current) return;
      if (dirtyRef.current && (!discardLocal || version !== editVersion.current)) {
        setResponse(current => current ? { ...current, unitProposal: result.unitProposal, research: result.research, researchContextFingerprint: result.researchContextFingerprint } : current);
        if (result.research.result && draftRef.current) change(applyProgrammeResearch(draftRef.current, result.research.result, result.research.revision));
        if (result.state.revision !== revisionRef.current) setError('Hay una versión nueva guardada. Exporta tus cambios locales antes de recargar.');
        return;
      }
      setResponse(result); setRevision(result.state.revision); revisionRef.current = result.state.revision;
      let programme = result.state.draft ?? (result.curriculum ? emptyProgramme(result.curriculum, purpose) : undefined);
      if (programme && !result.state.draft) programme.title = result.project.title;
      if (!discardLocal) {
        try {
          const saved = sessionStorage.getItem(recoveryKey);
          if (saved) {
            const recovered = JSON.parse(saved) as { programme: TeachingProgramme; revision: number };
            if (recovered.programme?.curriculumVersionId === result.curriculum?.id && recovered.programme.purpose === purpose) {
              const value = recovered.programme;
              if (!Number.isSafeInteger(recovered.revision) || recovered.revision < 0 || typeof value.title !== 'string' || !Array.isArray(value.units) || !value.sections || Object.keys(PROGRAMME_SECTIONS).some(key => typeof value.sections[key as keyof typeof PROGRAMME_SECTIONS] !== 'string') || !Number.isFinite(value.totalHours) || value.units.some(unit => !unit || typeof unit.id !== 'string' || !Array.isArray(unit.criterionIds) || !Array.isArray(unit.contentIds))) throw new Error('recovery');
              programme = value; setRevision(recovered.revision); revisionRef.current = recovered.revision; dirtyRef.current = true; setDirty(true);
              if (recovered.revision !== result.state.revision) setError('Hay cambios locales recuperados y una versión más reciente en disco. Exporta tus cambios antes de recargar.');
            }
          }
        } catch { setError('No se pudieron recuperar los cambios locales. El borrador guardado sigue disponible.'); }
      }
      if (programme && result.research.result) {
        const updated = applyProgrammeResearch(programme, result.research.result, result.research.revision);
        if (updated !== programme) { dirtyRef.current = true; setDirty(true); }
        programme = updated;
      }
      setDraft(programme); draftRef.current = programme;
      if (discardLocal) { const adopted = !!programme && programme.researchRevision !== result.state.draft?.researchRevision; dirtyRef.current = adopted; setDirty(adopted); sessionStorage.removeItem(recoveryKey); setError(''); }
    } catch (failure) { setError((failure as Error).message); }
  }
  useEffect(() => { void load(); return () => { loadSequence.current++; }; }, [subjectId, signature]);
  useEffect(() => {
    if (!dirty || !draft) return;
    try { sessionStorage.setItem(recoveryKey, JSON.stringify({ programme: draft, revision })); }
    catch { setError('No se pueden conservar cambios entre pestañas. Guarda la programación antes de salir.'); }
  }, [draft, dirty, revision, recoveryKey]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function change(next: TeachingProgramme) {
    draftRef.current = next; editVersion.current++; setDraft(next); dirtyRef.current = true; setDirty(true);
    try { sessionStorage.setItem(recoveryKey, JSON.stringify({ programme: next, revision: revisionRef.current })); }
    catch { setError('No se pueden conservar los cambios locales. Guarda antes de salir.'); }
  }
  async function save(confirmed?: boolean) {
    const captured = draftRef.current, version = editVersion.current;
    if (!captured) return;
    loadSequence.current++;
    const state = await api.saveProgramme(subjectId, projectId, captured, revisionRef.current, confirmed);
    loadSequence.current++;
    setResponse(current => current ? { ...current, state, researchContextFingerprint: (['context', 'requirements', 'selectionRequirements'] as const).every(key => current.state.draft?.sections[key] === captured.sections[key]) ? current.researchContextFingerprint : '' } : current);
    revisionRef.current = state.revision; setRevision(state.revision);
    if (version === editVersion.current) {
      draftRef.current = state.draft; setDraft(state.draft); dirtyRef.current = false; setDirty(false); sessionStorage.removeItem(recoveryKey); setError('');
    } else {
      try { sessionStorage.setItem(recoveryKey, JSON.stringify({ programme: draftRef.current, revision: state.revision })); }
      catch { setError('Guarda los nuevos cambios antes de salir.'); }
      notify('La versión enviada se ha guardado. Hay cambios posteriores pendientes de guardar.', 'info');
    }
    return state;
  }
  async function act(action: () => Promise<unknown>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); } catch (failure) { setError((failure as Error).message); } finally { busyRef.current = false; setBusy(false); }
  }
  const curriculum = response?.curriculum;
  const issues = useMemo(() => draft && curriculum ? programmeIssues(draft, curriculum) : [], [draft, curriculum]);
  const markdown = useMemo(() => draft && curriculum ? programmeMarkdown(draft, curriculum, response?.research.revision === draft.researchRevision ? response.research.result : undefined) : '', [draft, curriculum, response?.research]);
  async function download(reviewed = false) {
    const programme = reviewed ? response?.state.reviewed?.programme : draft;
    if (!programme || !curriculum) return;
    await api.exportProgramme(subjectId, projectId, programme, exportFormat, reviewed);
  }
  const unit = draft?.units.find(item => item.id === unitId);
  function changeUnit(changes: Partial<TeachingUnit>) { if (draft && unit) change({ ...draft, units: draft.units.map(item => item.id === unit.id ? { ...item, ...changes } : item) }); }
  function moveUnit(delta: number) {
    if (!draft || !unit) return;
    const units = [...draft.units], index = units.findIndex(item => item.id === unit.id), target = index + delta;
    if (target < 0 || target >= units.length) return;
    [units[index], units[target]] = [units[target], units[index]]; change({ ...draft, units });
  }
  if (!response) return <div role="status" className="text-sm text-texto-2">{error || 'Cargando programación…'}{error && <Boton onClick={() => void load()}>Reintentar</Boton>}</div>;
  if (!curriculum || !draft) return <Vacio icono={<BookOpen className="size-6" />} titulo="Tu programación empieza en el currículo" texto="Activa un currículo para distribuir sus criterios y contenidos en unidades didácticas." accion={<Boton variante="primario" onClick={onCurriculum}>Ir al currículo</Boton>} />;
  const total = draft.units.reduce((sum, item) => sum + item.hours, 0);
  const criteria = curriculum.elements.filter(element => element.kind === 'assessmentCriterion');
  const covered = new Set(draft.units.flatMap(item => item.criterionIds));
  const coveredContent = new Set(draft.units.flatMap(item => item.contentIds));
  const missingKnowledge = curriculum.elements.filter(element => element.kind === 'knowledge' && !coveredContent.has(element.id));
  const lastJob = Object.values(jobs).filter(job => job.asignatura === subjectId && job.paso === 'programacion' && job.ref === jobRef).sort((first, second) => first.creado - second.creado).at(-1);
  const lastResearchJob = Object.values(jobs).filter(job => job.asignatura === subjectId && job.paso === 'programacion' && job.ref === researchRef).sort((first, second) => first.creado - second.creado).at(-1);
  const research = response.research.result;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Programación didáctica</h2><p className="mt-1 text-sm text-texto-2">{curriculum.profile.academicYear} · {curriculum.profile.territory} · {PROGRAMME_STAGE_LABELS[curriculum.profile.stage] || curriculum.profile.stage}</p><p className="mt-1 text-xs text-texto-3">Cada versión conserva su borrador y su copia revisada.</p></div>
      <div className="flex flex-wrap gap-2">
        <Boton icono={<Save className="size-4" />} disabled={busy || running} onClick={() => void act(async () => { await save(); if (!dirtyRef.current) notify('Programación guardada', 'ok'); })}>{dirty ? 'Guardar cambios' : 'Guardar'}</Boton>
        <Boton variante={research ? 'secundario' : 'primario'} icono={<Search className="size-4" />} disabled={busy || running || researching} onClick={() => void act(async () => {
          if (dirty) await save();
          if (dirtyRef.current) throw new Error('Hay cambios nuevos sin guardar. Guárdalos antes de investigar.');
          await api.researchProgramme(subjectId, projectId, purpose);
          notify('Investigando estructura, normativa autonómica y adaptación al contexto. Sigue el trabajo en el panel de agentes.', 'info');
        })}>{researching ? 'Investigando…' : research ? 'Volver a investigar' : 'Investigar'}</Boton>
        <Boton variante={research ? 'primario' : 'secundario'} icono={<Sparkles className="size-4" />} disabled={busy || running || researching || !research?.outline.length} onClick={() => setGenerate(true)}>{running ? 'Elaborando propuesta…' : 'Proponer con IA'}</Boton>
      </div>
    </div>
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    {response.activeVersionId !== curriculum.id && <p className="text-sm text-aviso">Esta programación conserva una versión anterior del currículo. Sus referencias no se han cambiado.</p>}
    {lastJob?.estado === 'error' && <p role="status" className="text-sm text-error">La última propuesta no se pudo incorporar. Tu programación guardada se conserva. Consulta el trabajo en el panel de agentes.</p>}
    {lastResearchJob?.estado === 'error' && <p role="status" className="text-sm text-error">La última investigación no se pudo incorporar. Se conserva el informe anterior, si lo había. Consulta el trabajo en el panel de agentes.</p>}
    {!research && <p className="rounded-xl border border-borde bg-panel p-4 text-sm text-texto-2">Añade, si lo necesitas, el contexto del grupo y los requisitos de tu centro o convocatoria. Pulsa Investigar para obtener los apartados; después podrás redactarlos o pedir una propuesta con IA.</p>}
    <ProgrammePlanningInputs programme={draft} onChange={change} />
    <ProgrammeResearchPanel result={research} contextChanged={!!research && (research.contextFingerprint !== response.researchContextFingerprint || (dirty && (['context', 'requirements', 'selectionRequirements'] as const).some(key => response.state.draft?.sections[key] !== draft.sections[key])))} />
    <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
      <Campo etiqueta="Título"><Entrada value={draft.title} onChange={event => change({ ...draft, title: event.target.value })} /></Campo>
      <Campo etiqueta="Horas del curso"><Entrada type="number" min="0" max="10000" step="0.5" value={draft.totalHours || ''} placeholder="Por definir" onChange={event => change({ ...draft, totalHours: Number(event.target.value) })} /></Campo>
    </div>
    <section aria-labelledby="programme-units-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 id="programme-units-heading" className="font-semibold">Unidades didácticas</h3><div className="flex flex-wrap gap-2"><Boton tam="sm" icono={<Sparkles className="size-4" />} disabled={busy || running || !research?.outline.length} onClick={() => setHelpTarget('')}>Ayuda con IA: unidades y actividades</Boton><Boton tam="sm" icono={<Plus className="size-4" />} onClick={() => {
        const next: TeachingUnit = { id: crypto.randomUUID(), title: 'Nueva unidad', hours: 0, period: '', criterionIds: [], contentIds: [], activities: '', evidence: '', referentIds: [], learningSituation: '', activityPlan: [] };
        change({ ...draft, units: [...draft.units, next] }); setUnitId(next.id);
      }}>Añadir unidad</Boton></div></div>
      <p className="mb-3 text-sm text-texto-2 tabular-nums">{draft.units.length} {draft.units.length === 1 ? 'unidad' : 'unidades'} · {total} / {draft.totalHours || '—'} h · {covered.size} / {criteria.length} criterios vinculados</p>
      {draft.units.length ? <ol className="divide-y divide-borde rounded-xl border border-borde">{draft.units.map((item, index) => <li key={item.id}><button className="flex w-full items-start gap-3 p-4 text-left hover:bg-panel-2 cursor-pointer" onClick={() => { setUnitId(item.id); }}><span className="text-texto-3 tabular-nums">{index + 1}.</span><span className="min-w-0 flex-1"><span className="block font-medium break-words">{item.title}</span><span className="mt-1 block text-sm text-texto-2">{item.period || 'Período pendiente'} · {item.criterionIds.length} {item.criterionIds.length === 1 ? 'criterio' : 'criterios'} · {item.activityPlan?.length ?? 0} {item.activityPlan?.length === 1 ? 'actividad' : 'actividades'}</span></span><span className="shrink-0 text-sm tabular-nums">{item.hours} h</span></button></li>)}</ol> : <p className="rounded-xl border border-dashed border-borde p-6 text-sm text-texto-2">Añade una unidad o solicita una propuesta con las horas y el contexto del grupo.</p>}
    </section>
    {response.unitProposal && !response.unitProposal.applied && <p className="text-sm text-acento-texto">Hay una propuesta de unidades y actividades para revisar. <button className="underline cursor-pointer" onClick={() => setHelpTarget(response.unitProposal!.unitId ?? '')}>Ver propuesta de IA</button></p>}
    <ProgrammeSections programme={draft} onChange={change} />
    <details className="rounded-xl border border-borde p-4"><summary className="cursor-pointer text-sm font-medium">{issues.length ? `${issues.length} aspectos pendientes` : 'Horas y cobertura completas'}</summary><ul className="mt-3 space-y-2 text-sm text-texto-2">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>{criteria.some(item => !covered.has(item.id)) && <details className="mt-3"><summary className="cursor-pointer text-sm">Ver criterios sin vincular</summary><ul className="mt-2 space-y-2 text-sm text-texto-2">{criteria.filter(item => !covered.has(item.id)).map(item => <li key={item.id}>{item.code}: {item.text}</li>)}</ul></details>}{!!missingKnowledge.length && <details className="mt-3"><summary className="cursor-pointer text-sm">Ver contenidos o saberes sin vincular</summary><ul className="mt-2 space-y-2 text-sm text-texto-2">{missingKnowledge.map(item => <li key={item.id}>{item.code}: {item.text}</li>)}</ul></details>}</details>
    <div className="flex flex-wrap items-center gap-2 border-t border-borde pt-4">
      <Boton icono={<Eye className="size-4" />} onClick={() => setPreview(true)}>Vista previa</Boton>
      <ProgrammePresentationEditor programme={draft} onChange={change} disabled={busy || running} />
      <label className="flex items-center gap-2 text-sm">Formato<select aria-label="Formato de exportación" className="rounded-lg border border-borde bg-panel p-2" value={exportFormat} onChange={event => setExportFormat(event.target.value as ProgrammeExportFormat)}><option value="docx">Word (.docx)</option><option value="pdf">PDF</option><option value="odt">LibreOffice (.odt)</option><option value="md">Markdown (.md)</option></select></label>
      <Boton icono={<Download className="size-4" />} disabled={busy} onClick={() => void act(() => download())}>Exportar</Boton>
      <Boton disabled={busy || running || !!issues.length} onClick={() => void act(async () => {
        if (await confirmar('¿Marcar la programación como revisada?', { texto: 'Confirma que has revisado las decisiones didácticas y su adecuación al grupo y al centro.', boton: 'Guardar y marcar revisada' })) { await save(true); notify('Programación revisada guardada', 'ok'); }
      })}>Marcar como revisada</Boton>
      <Boton variante="fantasma" disabled={busy} onClick={() => void act(async () => {
        if (!dirty || await confirmar('¿Recargar la programación guardada?', { texto: 'Se descartarán los cambios locales sin guardar. Puedes exportarlos antes.', boton: 'Recargar' })) await load(true);
      })}>Recargar</Boton>
    </div>
    {response.state.reviewed && <p className="text-xs text-texto-2">Última revisión: {new Date(response.state.reviewed.reviewedAt).toLocaleDateString('es')} · <button className="underline cursor-pointer" disabled={busy} onClick={() => void act(() => download(true))}>Descargar copia revisada</button> en el formato seleccionado. Los cambios posteriores permanecen en el borrador.</p>}
    <Modal abierto={!!unit} onCerrar={() => setUnitId('')} titulo="Editar unidad didáctica" ancho="max-w-3xl">{unit && <ProgrammeUnitEditor key={unit.id} unit={unit} curriculum={curriculum} onChange={changeUnit}
      onHelp={() => setHelpTarget(unit.id)} onClose={() => setUnitId('')} busy={busy || running || !research?.outline.length}
      first={draft.units[0]?.id === unit.id} last={draft.units.at(-1)?.id === unit.id} onMove={moveUnit}
      onRemove={() => { change({ ...draft, units: draft.units.filter(item => item.id !== unit.id) }); setUnitId(''); }} />}</Modal>
    <Modal abierto={helpTarget !== null} onCerrar={() => setHelpTarget(null)} titulo={helpTarget ? 'Ayuda con IA para la unidad' : 'Ayuda con IA: unidades y actividades'} ancho="max-w-3xl" sinCerrar={busy}>
      <ProgrammeUnitHelp key={helpTarget ?? 'closed'} unit={helpTarget ? draft.units.find(item => item.id === helpTarget) : undefined} proposal={response.unitProposal} curriculum={curriculum} revision={revision} dirty={dirty} error={error} running={running} busy={busy}
        onGenerate={instructions => void act(async () => { const state = dirty ? await save() : response.state; if (!state) return; if (dirtyRef.current) throw new Error('Guarda los nuevos cambios antes de pedir la propuesta.'); await api.helpProgrammeUnits(subjectId, projectId, state.revision, instructions, purpose, helpTarget || undefined); notify('Propuesta en elaboración. Se guardará por separado para que la revises.', 'info'); })}
        onApply={proposal => void act(async () => { await api.applyProgrammeUnits(subjectId, projectId, purpose, proposal.jobId, revision); await load(true); notify('Propuesta aplicada al borrador. La copia revisada se conserva.', 'ok'); })} />
    </Modal>
    <Modal abierto={generate} onCerrar={() => setGenerate(false)} titulo="Proponer programación con IA" ancho="max-w-2xl" sinCerrar={busy}><div className="space-y-4 pb-5"><p className="text-sm text-texto-2">Se guardarán tus datos de partida y se elaborará una propuesta con el currículo vinculado. La propuesta sustituirá el borrador; la última copia revisada se conserva.</p><p className="text-sm text-texto-2">La petición usa el contexto de la asignatura y esta programación. Evita datos personales del alumnado. No se vuelven a investigar las fuentes del currículo.</p><Campo etiqueta="Indicaciones para esta propuesta (opcional)"><AreaTexto rows={4} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="Distribución de evaluaciones, recursos disponibles, metodología…" /></Campo>{!draft.totalHours && <p role="alert" className="text-sm text-error">Indica primero las horas del curso en la programación.</p>}{error && <p role="alert" className="text-sm text-error">{error}</p>}<Boton variante="primario" cargando={busy} disabled={!draft.totalHours || running} onClick={() => void act(async () => { const state = await save(); if (state) { if (dirtyRef.current) throw new Error('Guarda los nuevos cambios antes de generar.'); await api.generateProgramme(subjectId, projectId, state.revision, instructions, purpose); setGenerate(false); notify('Propuesta en elaboración. Puedes seguir el trabajo en el panel de agentes.', 'info'); } })}>Guardar y generar propuesta</Boton></div></Modal>
    <Modal abierto={preview} onCerrar={() => setPreview(false)} titulo="Vista previa de la programación" ancho="max-w-4xl"><div className="apunte pb-6" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(renderizar(markdown)) }} /></Modal>
  </div>;
}
