import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Landmark, Pencil, Plus, Save, Trash2, Upload } from 'lucide-react';
import { CURRICULUM_KINDS, activeCurriculum, curriculumIssues, curriculumElementLabels, curriculumProfileFromContext, removeCurriculumSource,
  curriculumBranchIds, moveCurriculumElement, removeCurriculumElement, reviewCurriculumBranch, type CurriculumDraft, type CurriculumElement, type CurriculumProfile,
  type CurriculumResponse, type CurriculumSource, type CurriculumState } from '../../../shared/curriculum';
import { ETAPAS } from '../../../shared/catalogo/educacion';
import { api } from '../lib/api';
import { useCampos } from '../lib/estado';
import { Boton, Campo, Entrada, Insignia, Modal, confirmar, cx } from './ui';
import { ActividadAgente, BotonAgente } from './flujo/comun';
import { CurriculumTree } from './CurriculumTree';
import { CurriculumElementDialog } from './CurriculumElementDialog';
import { CurriculumMoveDialog } from './CurriculumMoveDialog';
import { CurriculumSourceDialog } from './CurriculumSourceDialog';

type Props = { a: string; comunidad?: string; onContext: () => void };
type View = 'elements' | 'sources' | 'versions';
const selectClass = 'min-h-11 w-full rounded-xl border border-borde bg-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-acento';
const newDraft = (profile: CurriculumProfile): CurriculumDraft => ({ profile, sources: [], elements: [], links: [], completenessReviewed: false });

export function StructuredCurriculum(props: Props) { return <CurriculumEditor key={props.a} {...props} />; }

function CurriculumEditor({ a, comunidad, onContext }: Props) {
  const { avisar, versiones, reconexion, trabajos } = useCampos('avisar', 'versiones', 'reconexion', 'trabajos');
  const [response, setResponse] = useState<CurriculumResponse>();
  const [draft, setDraft] = useState<CurriculumDraft>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [baseRevision, setBaseRevision] = useState(0);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('elements');
  const [selectedId, setSelectedId] = useState('');
  const [movingId, setMovingId] = useState('');
  const [elementError, setElementError] = useState('');
  const [reviewRequest, setReviewRequest] = useState<{ draft: CurriculumDraft; revision: number }>();
  const [globalReviewConfirmed, setGlobalReviewConfirmed] = useState(false);
  const [activationError, setActivationError] = useState('');
  const [query, setQuery] = useState('');
  const [sourceEditor, setSourceEditor] = useState<CurriculumSource>();
  const [removingSourceId, setRemovingSourceId] = useState('');
  const [replacementSourceId, setReplacementSourceId] = useState('');
  const importInput = useRef<HTMLInputElement>(null);
  const recoveryKey = `curriculum-unsaved:${a}`;
  const activeJobs = Object.values(trabajos).filter((job) => job.asignatura === a && job.paso === 'curriculo' && ['en-cola', 'ejecutando'].includes(job.estado));
  const jobSignature = Object.values(trabajos).filter((job) => job.asignatura === a && job.paso === 'curriculo').map((job) => `${job.id}:${job.estado}`).join(',');
  const fileVersion = `${versiones[`${a}/`] ?? 0}-${reconexion}`;
  const editing = !!response?.state.draft || dirty;
  const load = useCallback(async () => {
    try {
      const result = await api.structuredCurriculum(a);
      setResponse(result);
      const active = activeCurriculum(result.state);
      let recovery: { revision: number; draft: CurriculumDraft } | undefined;
      try {
        const cached = JSON.parse(sessionStorage.getItem(recoveryKey) || 'null');
        if (cached && Number.isInteger(cached.revision) && cached.draft?.profile && Array.isArray(cached.draft.elements) && Array.isArray(cached.draft.sources) && Array.isArray(cached.draft.links)) recovery = cached;
      } catch { /* A corrupt browser cache must not replace server data. */ }
      setDraft(structuredClone(recovery?.draft ?? result.state.draft ?? active ?? newDraft(result.suggestedProfile)));
      setBaseRevision(recovery?.revision ?? result.state.revision);
      setDirty(!!recovery);
      setError(recovery ? 'Se han recuperado cambios sin guardar de esta pestaña. Si hay una versión más reciente, exporta tus cambios a JSON antes de recargar.' : '');
    } catch (failure) { setError((failure as Error).message); }
  }, [a, recoveryKey]);
  useEffect(() => { if (!dirty && !busy) void load(); }, [load, dirty, busy, fileVersion, jobSignature, comunidad]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (!dirty || !draft) return;
    try { sessionStorage.setItem(recoveryKey, JSON.stringify({ revision: baseRevision, draft })); }
    catch { setError('No se pudo guardar la recuperación local. Guarda el borrador o expórtalo a JSON antes de salir.'); }
  }, [dirty, draft, baseRevision, recoveryKey]);

  const change = (update: (current: CurriculumDraft) => CurriculumDraft) => {
    if (!draft) return;
    setDraft({ ...update(draft), completenessReviewed: false }); setDirty(true);
  };
  const applyState = (state: CurriculumState) => {
    try { sessionStorage.removeItem(recoveryKey); } catch { /* Server commits remain authoritative. */ }
    setResponse((current) => current && { ...current, state });
    setDraft(structuredClone(state.draft ?? activeCurriculum(state) ?? newDraft(response!.suggestedProfile)));
    setDirty(false);
    setBaseRevision(state.revision);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const reload = async () => {
    if (dirty && !(await confirmar('¿Descartar los cambios sin guardar y recargar el currículo?'))) return;
    try { sessionStorage.removeItem(recoveryKey); } catch { /* Reload can still recover server data. */ }
    await load();
  };

  if (!response || !draft) return <div role="status">{error || 'Cargando currículo…'}{error && <Boton onClick={() => void load()}>Reintentar</Boton>}</div>;
  const active = activeCurriculum(response.state);
  const issues = curriculumIssues(draft, { requireReview: false });
  const disabled = busy || activeJobs.length > 0;
  const savedDraftEmpty = !response.state.draft || (!response.state.draft.elements.length && !response.state.draft.sources.length && !response.state.draft.links.length);
  const canExtract = savedDraftEmpty && (!editing || (!draft.elements.length && !draft.sources.length && !draft.links.length));
  const searchProfile = curriculumProfileFromContext(draft.profile, response.suggestedProfile);
  const hasContent = !!(draft.elements.length || draft.sources.length || draft.links.length);
  const displayedProfile = hasContent ? draft.profile : searchProfile;
  const contextChanged = hasContent && (['stage', 'subject', 'territory', 'qualification'] as const).some((field) => draft.profile[field] !== searchProfile[field]) || hasContent && draft.profile.course !== searchProfile.course;
  const editContext = async () => {
    if (dirty && !(await confirmar('Tus cambios se conservarán en esta pestaña. ¿Abrir Contexto?'))) return;
    onContext();
  };
  const moving = draft.elements.find(element => element.id === movingId);
  const selected = draft.elements.find((element) => element.id === selectedId);
  const removingSource = draft.sources.find((source) => source.id === removingSourceId);
  const elementLabels = curriculumElementLabels(draft.elements);
  const addElement = (kind: CurriculumElement['kind'], parentId = '') => {
    setElementError('');
    const element: CurriculumElement = { id: crypto.randomUUID(), kind, code: '', text: '', parentId, sourceId: selected?.sourceId ?? '', locator: '', excerpt: '', notes: '', reviewed: false };
    change((current) => ({ ...current, elements: [...current.elements, element] })); setSelectedId(element.id); setQuery('');
  };
  const updateElement = (elementId: string, patch: Partial<CurriculumElement>) => change((current) => ({ ...current,
    elements: current.elements.map((element) => element.id === elementId ? { ...element, reviewed: false, ...patch } : element) }));
  const deleteElement = async (elementId: string) => {
    const ids = curriculumBranchIds(draft.elements, elementId);
    const links = draft.links.filter(link => ids.has(link.fromId) || ids.has(link.toId)).length;
    const name = elementLabels.get(elementId) || CURRICULUM_KINDS[draft.elements.find(element => element.id === elementId)!.kind];
    if (!await confirmar(`¿Eliminar ${name}?`, { texto: `Se eliminará este elemento${ids.size > 1 ? ` y sus ${ids.size - 1} descendientes` : ''}${links ? `, junto con ${links} ${links === 1 ? 'relación vinculada' : 'relaciones vinculadas'}` : ''}. El cambio quedará en el borrador hasta guardarlo. Las versiones activadas se conservan.`, boton: ids.size > 1 ? 'Eliminar rama' : 'Eliminar elemento', peligro: true })) return;
    change(current => removeCurriculumElement(current, elementId)); setSelectedId(''); setElementError('');
    avisar('Eliminado del borrador. Guarda los cambios para conservarlo.', 'ok');
  };
  const updateSource = (sourceId: string, patch: Partial<CurriculumSource>) => change((current) => ({ ...current,
    sources: current.sources.map((source) => source.id === sourceId ? { ...source, reviewed: false, ...patch } : source),
    elements: Object.keys(patch).every((key) => key === 'reviewed') ? current.elements : current.elements.map((element) => element.sourceId === sourceId ? { ...element, reviewed: false } : element) }));
  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'curriculum.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1"><p className="text-sm text-texto-2">Elementos curriculares organizados por jerarquía y con sus fuentes. Solo la versión activa se utiliza en apuntes y exámenes.</p>
        <div className="flex flex-wrap items-center gap-2"><Insignia color={active ? 'ok' : 'aviso'}>{active ? 'Versión activa revisada' : 'Sin versión estructurada activa'}</Insignia>
          {editing && <Insignia color="aviso">Borrador {dirty ? 'sin guardar' : 'guardado'}</Insignia>}</div></div>
    </div>
    {error && <p role="alert" className="rounded-xl border border-error/40 p-3 text-sm text-error">{error}</p>}
    <details className="space-y-3 border-b border-borde pb-3">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-acento">Configuración del currículo <span className="font-normal text-texto-2">· {displayedProfile.subject || 'Asignatura'}{displayedProfile.course ? ` · ${displayedProfile.course}` : ''}</span></summary>
    <section className="space-y-2" aria-label="Datos de la asignatura">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Datos de {hasContent ? 'esta versión del currículo' : 'Contexto'}</p><Boton disabled={busy} onClick={() => void editContext()}>Editar en Contexto</Boton></div>
      <p className="text-sm text-texto-2">{[ETAPAS.find((stage) => stage.id === displayedProfile.stage)?.nombre || 'Enseñanza sin configurar', displayedProfile.subject, displayedProfile.course ? `Curso o ciclo: ${displayedProfile.course}` : 'Curso sin configurar', displayedProfile.territory, displayedProfile.qualification].filter(Boolean).join(' · ')}</p>
      {!hasContent && <p className="text-xs text-texto-3">La enseñanza, asignatura, curso, comunidad y título se toman de Contexto.</p>}
      {contextChanged && <p role="status" className="text-sm text-texto-2">Contexto ha cambiado. Esta versión conserva sus datos originales; una nueva búsqueda utilizará los datos actuales de Contexto.</p>}
      {(!searchProfile.stage || !searchProfile.course) && <p className="text-sm text-texto-2">Completa la enseñanza y el curso en Contexto antes de buscar el currículo.</p>}
    </section>
    <fieldset disabled={disabled || (!editing && !!active)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Campo etiqueta="Curso académico"><Entrada placeholder="2026-2027" value={draft.profile.academicYear} onChange={(event) => change((current) => ({ ...current, profile: { ...current.profile, academicYear: event.target.value } }))} /></Campo>
      <Campo etiqueta="Ámbito de secuenciación"><select className={selectClass} value={draft.profile.scope} onChange={(event) => change((current) => ({ ...current, profile: curriculumProfileFromContext({ ...current.profile, scope: event.target.value as CurriculumProfile['scope'] }, response.suggestedProfile) }))}><option value="course">Curso</option><option value="cycle">Ciclo</option><option value="stage">Etapa</option><option value="module">Módulo</option></select></Campo>
      <Campo etiqueta="Modelo curricular" ayuda="Los ámbitos generales de FP Básica usan competencias; los módulos profesionales, RA."><select className={selectClass} value={draft.profile.model} onChange={(event) => change((current) => ({ ...current, profile: { ...current.profile, model: event.target.value as CurriculumProfile['model'] } }))}><option value="general">Competencias específicas y criterios</option><option value="vocational">Resultados de aprendizaje y criterios</option></select></Campo>
      {draft.profile.model === 'vocational' && <Campo etiqueta="Código del módulo"><Entrada value={draft.profile.moduleCode} onChange={(event) => change((current) => ({ ...current, profile: { ...current.profile, moduleCode: event.target.value } }))} /></Campo>}
    </fieldset>
    </details>
    <div className="flex flex-wrap gap-2">
      {!editing && <Boton icono={<Plus className="size-4" />} disabled={disabled} onClick={() => { setDraft(structuredClone(active ?? draft)); setDirty(true); }}>Crear borrador editable</Boton>}
      {canExtract && <BotonAgente texto="Buscar en fuentes oficiales" icono={<Landmark className="size-4" />} disabled={disabled || !searchProfile.stage || !searchProfile.course} onLanzar={async (instructions) => { const job = await api.buscarCurriculo(a, instructions, { profile: searchProfile }); sessionStorage.removeItem(recoveryKey); setDirty(false); return job; }} ayudaIndicaciones="Indica una norma o un enlace oficial. Se generará un borrador pendiente de revisión." />}
      {editing && <><Boton icono={<Save className="size-4" />} disabled={disabled || !dirty} onClick={() => void run(async () => { applyState(await api.saveCurriculumDraft(a, hasContent ? draft : { ...draft, profile: searchProfile }, baseRevision)); avisar('Borrador guardado', 'ok'); })}>Guardar borrador</Boton>
        <Boton variante="primario" disabled={disabled || !!issues.length} onClick={() => { setReviewRequest({ draft: structuredClone(draft), revision: baseRevision }); setGlobalReviewConfirmed(false); setActivationError(''); }}>Revisar y activar</Boton></>}
      <details className="basis-full">
        <summary className="w-fit min-h-11 cursor-pointer py-2 text-sm text-texto-2 focus-visible:outline-2 focus-visible:outline-acento">Más acciones</summary>
        <div className="flex flex-wrap gap-2 pb-2">
          <Boton icono={<Upload className="size-4" />} disabled={disabled} onClick={() => importInput.current?.click()}>Importar JSON</Boton>
          <Boton icono={<Download className="size-4" />} disabled={busy} onClick={exportJson}>Exportar JSON</Boton>
          <Boton disabled={busy} onClick={() => void reload()}>Recargar</Boton>
          {!editing && active && <Boton disabled={disabled} onClick={() => { setDraft(newDraft(searchProfile)); setDirty(true); setSelectedId(''); }}>Preparar nueva búsqueda</Boton>}
          {editing && <Boton disabled={disabled} onClick={() => void run(async () => { if (await confirmar('¿Descartar el borrador? La versión activa y el documento anterior se conservarán.')) { applyState(await api.discardCurriculumDraft(a, baseRevision)); } })}>Descartar borrador</Boton>}
        </div>
      </details>
      <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (file) void run(async () => {
          if (file.size > 2000000) throw new Error('El archivo supera los 2 MB.');
          if (editing && !(await confirmar('¿Sustituir el borrador por el archivo importado?'))) return;
          const input = JSON.parse(await file.text());
          const state = await api.saveCurriculumDraft(a, { ...input, profile: input.profile ?? draft.profile, completenessReviewed: false,
            elements: input.elements?.map((element: CurriculumElement) => ({ ...element, reviewed: false })),
            sources: input.sources?.map((source: CurriculumSource) => ({ ...source, reviewed: false })) }, baseRevision);
          applyState(state);
        });
      }} />
    </div>
    {activeJobs.map((job) => <ActividadAgente key={job.id} t={job} />)}
    <nav aria-label="Vistas del currículo" className="flex flex-wrap gap-1 border-b border-borde">
      {([['elements', `Elementos (${draft.elements.length})`], ['sources', `Fuentes (${draft.sources.length})`], ['versions', `Versiones (${response.state.versions.length})`]] as [View, string][]).map(([key, label]) =>
        <button key={key} aria-current={view === key ? 'page' : undefined} onClick={() => setView(key)} className={cx('min-h-11 border-b-2 px-3 text-sm focus-visible:outline-2 focus-visible:outline-acento', view === key ? 'border-acento text-acento-texto' : 'border-transparent text-texto-2')}>{label}</button>)}
    </nav>
    {view === 'elements' && <div className="space-y-3">
      <p className="text-sm text-texto-2">{draft.profile.model === 'vocational' ? 'Resultados de aprendizaje → criterios de evaluación.' : 'Competencias específicas → criterios de evaluación.'} Bloques de contenidos o saberes → contenidos. Despliega las ramas para recorrer cada jerarquía.</p>
      <p className="text-xs text-texto-3">Los bloques y contenidos sin código oficial reciben numeración de organización (1, 1.1, 1.2…). El código original de la norma se conserva.</p>
      <div className="flex flex-wrap gap-2"><Entrada aria-label="Buscar elementos curriculares" placeholder="Buscar por código, tipo o texto…" className="min-w-48 flex-1" value={query} onChange={(event) => setQuery(event.target.value)} />
        {editing && <Boton disabled={disabled} icono={<Plus className="size-4" />} onClick={() => { setElementError(''); addElement(draft.profile.model === 'vocational' ? 'learningOutcome' : 'specificCompetence'); }}>Añadir elemento</Boton>}</div>
      <CurriculumTree model={draft.profile.model} onRelocate={(elementId, parentId, beforeId) => {
        if (disabled) return;
        try { change(current => moveCurriculumElement(current, elementId, parentId, beforeId)); avisar('Elemento movido. Guarda el borrador para conservarlo.', 'ok'); }
        catch (failure) { avisar((failure as Error).message, 'error'); }
      }} elements={draft.elements} query={query} disabled={disabled} onReview={(elementId, reviewed) => change(current => reviewCurriculumBranch(current, elementId, reviewed))} onMove={setMovingId} onOpen={elementId => { setElementError(''); setSelectedId(elementId); }} />
    </div>}
    {moving && <CurriculumMoveDialog key={moving.id} element={moving} draft={draft} labels={elementLabels} disabled={disabled} onClose={() => setMovingId('')} onMove={(parentId, beforeId) => {
      if (disabled) return;
      change(current => moveCurriculumElement(current, moving.id, parentId, beforeId));
      setMovingId('');
      avisar('Elemento movido en el borrador. Guarda los cambios para conservarlo.', 'ok');
    }} />}
    {selected && <CurriculumElementDialog key={selected.id} element={selected} draft={draft} labels={elementLabels} editing={editing} disabled={disabled} saving={busy} dirty={dirty} error={elementError}
      onUpdate={patch => updateElement(selected.id, patch)} onEdit={() => change(current => structuredClone(current))}
      onAccept={() => change(current => reviewCurriculumBranch(current, selected.id, true))} onDelete={() => void deleteElement(selected.id)}
      onAdd={addElement} onNavigate={elementId => { setElementError(''); setSelectedId(elementId); }}
      onClose={() => { setSelectedId(''); setElementError(''); }}
      onSave={() => void run(async () => {
        setElementError('');
        try { applyState(await api.saveCurriculumDraft(a, draft, baseRevision)); setSelectedId(''); avisar('Borrador guardado', 'ok'); }
        catch (failure) { setElementError((failure as Error).message); throw failure; }
      })} />}
    {view === 'sources' && <div className="space-y-5">
      <p className="text-sm text-texto-2">Revisa el ámbito, la aplicación al curso académico y las modificaciones. Un enlace oficial por sí solo no demuestra que la extracción esté completa.</p>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Fuentes del currículo <span className="text-sm font-normal text-texto-2">({draft.sources.length})</span></h2><Boton variante="primario" className="min-h-11" disabled={disabled} icono={<Plus aria-hidden="true" className="size-4" />} onClick={() => setSourceEditor({ id: crypto.randomUUID(), title: '', url: '', origin: 'official', filename: '', publishedOn: '', applicableFrom: '', notes: '', reviewed: false })}>Añadir fuente</Boton></div>
      {draft.sources.length ? <ul aria-label="Fuentes del currículo" className="divide-y divide-borde rounded-xl border border-borde bg-panel">
        {draft.sources.map(source => <li key={source.id} className="flex flex-wrap items-center gap-3 p-4"><div className="min-w-0 flex-1 basis-56"><p className="break-words text-sm font-medium">{source.title || 'Fuente sin título'}</p><p className="mt-1 break-words text-xs text-texto-2">{source.origin === 'official' ? 'Publicación oficial' : 'Documento aportado'}{source.publishedOn ? ` · ${source.publishedOn}` : ''} · {draft.elements.filter(element => element.sourceId === source.id).length} elementos vinculados</p><p className="mt-1 text-xs text-texto-2">{source.reviewed ? 'Aceptada' : 'Pendiente de revisar'}</p></div><div className="flex flex-wrap gap-2"><Boton className="min-h-11" disabled={disabled} icono={<Pencil aria-hidden="true" className="size-4" />} aria-label={`Modificar ${source.title || 'fuente sin título'}`} onClick={() => setSourceEditor(structuredClone(source))}>Modificar</Boton><Boton variante="fantasma" className="min-h-11 text-error" disabled={disabled} icono={<Trash2 aria-hidden="true" className="size-4" />} aria-label={`Eliminar ${source.title || 'fuente sin título'}`} onClick={() => { if (!editing) change(current => structuredClone(current)); setRemovingSourceId(source.id); setReplacementSourceId(''); }}>Eliminar</Boton></div></li>)}
      </ul> : <p className="rounded-xl border border-dashed border-borde p-6 text-center text-sm text-texto-2">Todavía no hay fuentes. Añade la publicación o el documento normativo de referencia.</p>}
      {sourceEditor && <CurriculumSourceDialog key={sourceEditor.id} source={sourceEditor} creating={!draft.sources.some(source => source.id === sourceEditor.id)} disabled={disabled} onClose={() => setSourceEditor(undefined)} onApply={source => {
        if (disabled) return;
        const original = draft.sources.find(item => item.id === source.id);
        if (original) {
          const patch = Object.fromEntries(Object.entries(source).filter(([key, value]) => value !== original[key as keyof CurriculumSource])) as Partial<CurriculumSource>;
          updateSource(source.id, patch);
        } else change(current => ({ ...current, sources: [...current.sources, source] }));
        setSourceEditor(undefined); avisar('Fuente actualizada en el borrador. Guarda el currículo para conservarla.', 'ok');
      }} />}
      {removingSource && <Modal abierto titulo="Eliminar fuente del borrador" descripcion={removingSource.title || 'Fuente sin título'} onCerrar={() => setRemovingSourceId('')}>
        <div className="space-y-4">
          <p className="text-sm text-texto-2">Referencias vinculadas: {draft.elements.filter((element) => element.sourceId === removingSource.id).length} elementos y {draft.links.filter((link) => link.sourceId === removingSource.id).length} relaciones. Se conservarán los textos, las jerarquías y las relaciones.</p>
          <Campo etiqueta="Qué hacer con las referencias" ayuda="Si eliges otra fuente, contrasta las localizaciones y los fragmentos conservados con esa publicación.">
            <select className={selectClass} value={replacementSourceId} disabled={disabled} onChange={(event) => setReplacementSourceId(event.target.value)}>
              <option value="">Dejar sin fuente, pendientes de completar</option>
              {draft.sources.filter((source) => source.id !== removingSource.id).map((source) => <option key={source.id} value={source.id}>{source.title || 'Fuente sin título'}</option>)}
            </select>
          </Campo>
          <p className="text-sm text-texto-2">Los elementos afectados volverán a revisión. Tendrás que guardar el borrador para conservar este cambio. Las versiones activadas anteriores se mantienen.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Boton onClick={() => setRemovingSourceId('')}>Cancelar</Boton>
            <Boton variante="primario" disabled={disabled || !editing} onClick={() => {
              try {
                change((current) => removeCurriculumSource(current, removingSource.id, replacementSourceId));
                setRemovingSourceId(''); setError('');
                avisar('Fuente eliminada del borrador. Guarda los cambios y revisa las referencias afectadas.', 'ok');
              } catch (failure) { setError((failure as Error).message); }
            }}>Eliminar fuente y conservar contenidos</Boton>
          </div>
        </div>
      </Modal>}
    </div>}
    {view === 'versions' && <div className="space-y-3">
      {!response.state.versions.length && <p className="text-sm text-texto-2">Las versiones se crean al activar un borrador revisado.</p>}
      {[...response.state.versions].reverse().map((version) => <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-borde py-3"><div><p className="text-sm font-medium">{version.profile.subject} · {version.profile.territory} · {version.profile.academicYear}</p><p className="text-xs text-texto-3">{new Date(version.activatedAt).toLocaleString()} · {version.elements.length} elementos {version.reviewMethod === 'global' ? '· Revisión global' : ''} {version.id === response.state.activeVersionId ? '· Activa' : ''}</p></div>
        <Boton disabled={disabled} onClick={() => void run(async () => { if (editing && !(await confirmar('¿Sustituir el borrador por esta versión?'))) return; applyState(await api.restoreCurriculumDraft(a, version.id, baseRevision)); setView('elements'); })}>Copiar a borrador</Boton></div>)}
      {active && editing && <p className="text-sm text-texto-2">Respecto a la activa: {draft.elements.filter((element) => !active.elements.some((old) => old.id === element.id)).length} añadidos; {active.elements.filter((element) => !draft.elements.some((item) => item.id === element.id)).length} retirados; {draft.elements.filter((element) => { const old = active.elements.find((item) => item.id === element.id); return old && JSON.stringify(old) !== JSON.stringify(element); }).length} modificados.</p>}
    </div>}
    {editing && <section className="space-y-3 border-t border-borde pt-4" aria-label="Revisión del borrador">
      <p role="status" className="text-sm text-texto-2">{issues.length ? `${issues.length} datos que corregir antes de activar.` : 'Comprobaciones de estructura correctas. Puedes revisar y activar el conjunto sin marcar cada elemento.'}</p>
      {!!issues.length && <details open><summary className="min-h-11 cursor-pointer py-2 text-sm text-acento-texto">Ver datos pendientes</summary><ul className="list-disc space-y-1 pl-5 text-sm text-texto-2">{issues.slice(0, 50).map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>{issues.length > 50 && <p className="text-sm">Mostrando los primeros 50 avisos.</p>}</details>}
      <details><summary className="min-h-11 cursor-pointer py-2 text-sm text-texto-2">Seguimiento individual (opcional)</summary><p className="text-sm text-texto-2">{draft.elements.filter((element) => element.reviewed).length} de {draft.elements.length} elementos y {draft.sources.filter((source) => source.reviewed).length} de {draft.sources.length} fuentes marcados. Puedes seguir revisándolos uno a uno desde sus editores.</p></details>
    </section>}
    {reviewRequest && <Modal abierto titulo="Revisar y activar el currículo" descripcion={`${reviewRequest.draft.profile.subject} · ${reviewRequest.draft.profile.academicYear}`} ancho="max-w-2xl" sinCerrar={busy} onCerrar={() => setReviewRequest(undefined)}>
      <div className="space-y-4">
        <p className="text-sm text-texto-2">Activarás {reviewRequest.draft.elements.length} {reviewRequest.draft.elements.length === 1 ? 'elemento' : 'elementos'} y {reviewRequest.draft.sources.length} {reviewRequest.draft.sources.length === 1 ? 'fuente' : 'fuentes'} para usarlos en apuntes y exámenes. Los cambios del borrador se guardarán en el mismo paso.</p>
        {reviewRequest.draft.sources.some((source) => /pendiente|sin verificar|no acreditad/i.test(source.notes)) && <section className="space-y-2" aria-label="Observaciones de las fuentes">
          <p className="text-sm font-medium">Observaciones que debes contrastar</p>
          <div className="max-h-48 space-y-2 overflow-y-auto text-sm text-texto-2">{[...new Set(reviewRequest.draft.sources.flatMap((source) => source.notes.split('\n').filter((line) => /pendiente|sin verificar|no acreditad/i.test(line))))].map((notice, index) => <p key={index}>{notice}</p>)}</div>
          <Boton onClick={() => { setReviewRequest(undefined); setView('sources'); }}>Revisar fuentes</Boton>
        </section>}
        <label className="flex min-h-11 items-start gap-2 text-sm"><input className="mt-1" type="checkbox" disabled={busy} checked={globalReviewConfirmed} onChange={(event) => setGlobalReviewConfirmed(event.target.checked)} />He revisado el currículo completo, sus fuentes y su aplicación a este curso, incluidas las observaciones pendientes.</label>
        {activationError && <p role="alert" className="text-sm text-error">{activationError}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Boton disabled={busy} onClick={() => setReviewRequest(undefined)}>Volver al borrador</Boton>
          <Boton variante="primario" disabled={disabled || !globalReviewConfirmed} cargando={busy} onClick={() => void run(async () => {
            setActivationError('');
            try {
              applyState(await api.activateCurriculum(a, reviewRequest.revision, { draft: reviewRequest.draft, confirmed: true }));
              setReviewRequest(undefined); avisar('Currículo guardado y activado', 'ok');
            } catch (failure) { setActivationError((failure as Error).message); throw failure; }
          })}>Guardar y activar</Boton>
        </div>
      </div>
    </Modal>}
  </div>;
}
