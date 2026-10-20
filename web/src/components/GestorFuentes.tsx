import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, FolderOpen, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import type { Fuente } from '../../../shared/tipos';
import { api, urlDatos } from '../lib/api';
import { useCampos } from '../lib/estado';
import { Boton, BotonIcono, Campo, Entrada, Modal, confirmar, cx } from './ui';
import { BuscadorFuentes } from './BuscadorFuentes';
import { BuscadorIndice } from './BuscadorIndice';

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
type SourceIndex = Record<string, { fragmentos: number; paginas?: number; estado: string }>;
type SourceModal = 'add' | 'web' | 'search' | 'details';
function indexLabel(info?: SourceIndex[string]) {
  if (!info) return 'Pendiente de indexar';
  if (info.estado === 'indexado') return `${info.paginas ? `${info.paginas} págs. · ` : ''}Disponible para búsqueda`;
  return info.estado === 'sin-texto' ? 'Sin texto extraíble' : 'Sin índice de texto';
}

export function GestorFuentes({ asignatura, documento, descripcion }: { asignatura: string; documento?: string; descripcion: string }) {
  const { avisar, versiones, reconexion } = useCampos('avisar', 'versiones', 'reconexion');
  const [sources, setSources] = useState<Fuente[]>([]);
  const [index, setIndex] = useState<SourceIndex>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState('');
  const [modal, setModal] = useState<SourceModal>();
  const [selected, setSelected] = useState<Fuente>();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const renameInput = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const version = `${versiones[`${asignatura}/${documento ?? ''}`] ?? 0}-${reconexion}`;
  const base = documento ? [asignatura, 'documentos', documento, 'fuentes'] : [asignatura, 'fuentes'];
  const reload = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    const [sourceResult, indexResult] = await Promise.allSettled([api.fuentes(asignatura, documento), api.indiceFuentes(asignatura, documento)]);
    if (current !== request.current) return;
    if (sourceResult.status === 'fulfilled') { setSources(sourceResult.value); setLoadError(''); }
    else setLoadError(sourceResult.reason?.message || 'No se han podido cargar las fuentes. Vuelve a intentarlo.');
    setIndex(indexResult.status === 'fulfilled' ? Object.fromEntries(indexResult.value.map(item => [item.archivo, item])) : {});
    setLoading(false);
  }, [asignatura, documento]);
  useEffect(() => { void reload(); return () => { request.current++; }; }, [reload, version]);
  useEffect(() => { setModal(undefined); setSelected(undefined); setFilter(''); setSources([]); setIndex({}); }, [asignatura, documento]);
  useEffect(() => {
    if (modal === 'details' && !busy) (editing ? renameInput.current : editButton.current)?.focus();
  }, [modal, editing, busy]);
  const openModal = (next: SourceModal, source?: Fuente, edit = false) => {
    setError(''); setFiles([]); setSelected(source); setEditing(edit); setName(source?.nombre ?? ''); setModal(next);
  };
  const closeModal = async () => {
    if (busy) return;
    if ((files.length > 0 || (editing && name !== selected?.nombre)) && !(await confirmar('¿Cerrar sin guardar los cambios de la fuente?', { boton: 'Descartar cambios' }))) return;
    setModal(undefined);
  };
  const upload = async () => {
    if (!files.length || busy) return;
    setBusy(true); setError('');
    try {
      const result = await api.subirFuentes(asignatura, files, documento);
      await reload(); setFiles([]); setModal(undefined);
      avisar(result.guardados.length === 1 ? 'Fuente añadida' : `${result.guardados.length} fuentes añadidas`, 'ok');
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!selected || !name.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const updated = await api.renameSource(asignatura, selected.nombre, name.trim(), selected.modificado, documento);
      setSelected(updated); setName(updated.nombre); setEditing(false); await reload();
      avisar('Nombre de la fuente actualizado', 'ok');
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async (source: Fuente) => {
    if (busy || !(await confirmar(`¿Eliminar «${source.nombre}»? Se retirará de las fuentes disponibles para los agentes.`, { boton: 'Eliminar fuente', peligro: true }))) return;
    setBusy(true); setError('');
    try {
      await api.eliminarFuente(asignatura, source.nombre, documento);
      if (selected?.nombre === source.nombre) setModal(undefined);
      await reload(); avisar('Fuente eliminada', 'ok');
    } catch (failure) {
      const message = (failure as Error).message;
      if (modal) setError(message); else avisar(message, 'error');
    } finally { setBusy(false); }
  };
  const filtered = sources.filter(source => source.nombre.toLocaleLowerCase('es').includes(filter.trim().toLocaleLowerCase('es')));
  const canSearch = Object.values(index).some(info => info.estado === 'indexado');
  return <section className="space-y-5" aria-label="Fuentes de consulta">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1 space-y-1"><h2 className="text-lg font-semibold">Fuentes de consulta <span className="text-sm font-normal text-texto-3">({sources.length})</span></h2><p className="max-w-prose text-sm leading-relaxed text-texto-2">{descripcion}</p></div>
      <Boton variante="primario" className="min-h-11" icono={<Plus className="size-4" />} onClick={() => openModal('add')}>Añadir fuentes</Boton>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Entrada className="min-w-0 flex-1 basis-56" aria-label="Filtrar fuentes por nombre" placeholder="Filtrar por nombre…" value={filter} onChange={event => setFilter(event.target.value)} />
      {canSearch && <Boton className="min-h-11" icono={<Search className="size-4" />} onClick={() => openModal('search')}>Buscar en el material</Boton>}
      <Boton variante="fantasma" className="min-h-11" onClick={() => openModal('web')}>Buscar fuentes con IA</Boton>
    </div>
    {loadError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-error">{loadError}<Boton onClick={() => void reload()}>Reintentar</Boton></div>}
    <div aria-busy={loading}>
      {loading && sources.length === 0 ? <p role="status" className="py-8 text-center text-sm text-texto-2">Cargando fuentes…</p> : sources.length === 0 ? <div className="space-y-1 rounded-xl border border-dashed border-borde px-5 py-10 text-center"><p className="font-medium">Todavía no hay fuentes</p><p className="text-sm text-texto-2">Añade archivos de consulta o busca recursos con IA.</p></div> : filtered.length === 0 ? <p role="status" className="py-8 text-center text-sm text-texto-2">Ninguna fuente coincide con «{filter}».</p> : <ul className="divide-y divide-borde rounded-xl border border-borde bg-panel">
        {filtered.map(source => <li key={source.nombre} className="flex items-center gap-1 px-2 py-1 sm:gap-2 sm:px-4">
          <button type="button" className="flex min-h-16 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-2 py-3 text-left hover:bg-panel-2" onClick={() => openModal('details', source)}><FileText aria-hidden="true" className="size-5 shrink-0 text-texto-3" /><span className="min-w-0 space-y-1"><span className="block break-words text-sm font-medium">{source.nombre}</span><span className="block text-xs text-texto-2">{formatSize(source.tamano)} · {indexLabel(index[source.nombre])}</span></span></button>
          <BotonIcono titulo={`Editar ${source.nombre}`} className="size-11 shrink-0" disabled={busy} onClick={() => openModal('details', source, true)}><Pencil className="size-4" /></BotonIcono>
          <BotonIcono titulo={`Eliminar ${source.nombre}`} className="size-11 shrink-0" disabled={busy} onClick={() => void remove(source)}><Trash2 className="size-4" /></BotonIcono>
        </li>)}
      </ul>}
    </div>
    <Boton variante="fantasma" className="min-h-11" icono={<FolderOpen className="size-4" />} onClick={() => api.abrirCarpeta(asignatura, documento, 'fuentes').catch(failure => avisar(failure.message, 'error'))}>Abrir carpeta de fuentes</Boton>
    <Modal abierto={!!modal} onCerrar={() => void closeModal()} sinCerrar={busy} ancho={modal === 'web' || modal === 'search' ? 'max-w-3xl' : 'max-w-xl'}
      titulo={modal === 'add' ? 'Añadir fuentes' : modal === 'web' ? 'Buscar fuentes con IA' : modal === 'search' ? 'Buscar en el material' : editing ? 'Editar fuente' : 'Detalles de la fuente'}
      footer={modal === 'add' ? <div className="flex flex-wrap justify-end gap-2"><Boton disabled={busy} onClick={() => void closeModal()}>Cancelar</Boton><Boton variante="primario" cargando={busy} disabled={!files.length} onClick={() => void upload()}>Añadir {files.length > 1 ? `${files.length} archivos` : 'archivo'}</Boton></div>
        : modal === 'details' && selected ? <div className="flex flex-wrap items-center justify-between gap-2"><Boton variante="fantasma" disabled={busy} icono={<Trash2 className="size-4" />} onClick={() => void remove(selected)}>Eliminar</Boton><div className="flex flex-wrap gap-2"><Boton disabled={busy} onClick={() => void closeModal()}>Cerrar</Boton>{editing ? <Boton variante="primario" cargando={busy} disabled={!name.trim() || name.trim() === selected.nombre} onClick={() => void save()}>Guardar nombre</Boton> : <Boton ref={editButton} variante="primario" icono={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Editar nombre</Boton>}</div></div> : undefined}>
      <div className="space-y-5">
        {error && <p role="alert" className="text-sm text-error">{error}</p>}
        {modal === 'add' && <>
          <p className="text-sm leading-relaxed text-texto-2">Añade PDF, documentos, apuntes, diapositivas o imágenes. Puedes seleccionar varios archivos a la vez.</p>
          <div onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) setFiles([...event.dataTransfer.files]); }} className={cx('rounded-xl border-2 border-dashed px-5 py-8 text-center', dragging ? 'border-acento bg-acento-suave' : 'border-borde')}>
            <Upload aria-hidden="true" className="mx-auto mb-3 size-6 text-texto-3" /><p className="mb-3 text-sm text-texto-2">Arrastra aquí los archivos</p><Boton disabled={busy} onClick={() => input.current?.click()}>Elegir archivos</Boton><input ref={input} type="file" multiple hidden onChange={event => { setFiles([...(event.target.files ?? [])]); event.target.value = ''; }} />
          </div>
          {files.length > 0 && <div role="status"><p className="mb-2 text-sm font-medium">Archivos seleccionados ({files.length})</p><ul className="space-y-2">{files.map((file, position) => <li key={`${position}-${file.name}`} className="flex items-start justify-between gap-3 text-sm"><span className="min-w-0 break-words">{file.name}</span><span className="shrink-0 text-texto-2">{formatSize(file.size)}</span></li>)}</ul></div>}
        </>}
        {modal === 'web' && <BuscadorFuentes asignatura={asignatura} documento={documento} onAnadida={() => void reload()} />}
        {modal === 'search' && <BuscadorIndice asignatura={asignatura} documento={documento} />}
        {modal === 'details' && selected && <>
          {editing ? <Campo etiqueta="Nombre del archivo" ayuda="Conserva la extensión para mantener su formato."><Entrada ref={renameInput} value={name} maxLength={200} disabled={busy} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }} /></Campo> : <p className="break-words text-base font-medium">{selected.nombre}</p>}
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2"><div><dt className="text-texto-2">Tamaño</dt><dd className="mt-1">{formatSize(selected.tamano)}</dd></div><div><dt className="text-texto-2">Última modificación</dt><dd className="mt-1">{new Date(selected.modificado).toLocaleString('es')}</dd></div><div className="sm:col-span-2"><dt className="text-texto-2">Búsqueda en el material</dt><dd className="mt-1">{indexLabel(index[selected.nombre])}{index[selected.nombre]?.estado === 'indexado' ? ` · ${index[selected.nombre].fragmentos} ${index[selected.nombre].fragmentos === 1 ? 'fragmento' : 'fragmentos'}` : ''}</dd></div></dl>
          <a href={urlDatos(...base, selected.nombre)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-acento-texto underline underline-offset-4"><ExternalLink className="size-4" />Abrir archivo original<span className="sr-only"> (en una pestaña nueva)</span></a>
        </>}
      </div>
    </Modal>
  </section>;
}
