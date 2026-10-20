import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import type { EstadoFlujo, Trabajo } from '../../../shared/tipos';
import { bloqueAMarkdown } from '../../../shared/actividades';
import { api, urlDatos } from '../lib/api';
import { useCampos } from '../lib/estado';
import { Boton, Campo, Entrada, Modal } from './ui';
import { VistaPrevia } from './VistaPrevia';
import { isImportProcessing } from '../lib/import-status';

interface ImportedDocument { id: string; title: string; warnings?: string[] }
type ImportDestination = 'apuntes' | 'autoevaluacion' | 'revision';

function ImportReport({ assignment, document, onOpen, onProcessingChange, uploading = false }: { assignment: string; document: ImportedDocument; onOpen: (id: string, destination?: ImportDestination) => void; onProcessingChange: (id: string, processing: boolean) => void; uploading?: boolean }) {
  const [snapshot, setSnapshot] = useState<EstadoFlujo>();
  const [jobs, setJobs] = useState<Trabajo[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const { avisar } = useCampos('avisar');
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const [state, allJobs] = await Promise.all([api.flujo(assignment, document.id), api.trabajos()]);
        if (stopped) return;
        setSnapshot(state);
        const relevant = allJobs.filter(job => job.asignatura === assignment && job.documento === document.id && (job.paso === 'importacion' || job.paso === 'diagnostico')).sort((left, right) => right.creado - left.creado);
        setJobs(relevant.filter((job, index) => relevant.findIndex(other => other.paso === job.paso) === index));
        setLoaded(true);
        setError('');
      } catch (failure) {
        if (!stopped) setError((failure as Error).message);
      }
      if (!stopped) timer = setTimeout(refresh, 2000);
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [assignment, document.id]);
  const pending = jobs.filter(job => job.estado === 'en-cola' || job.estado === 'ejecutando');
  const processing = isImportProcessing(loaded, jobs);
  useEffect(() => { onProcessingChange(document.id, processing); }, [document.id, processing, onProcessingChange]);
  const failed = jobs.filter(job => job.estado === 'error' || job.estado === 'cancelado');
  return (
    <section className="space-y-3 border-t border-borde pt-4">
      <h3 className="text-sm font-semibold">{document.title}</h3>
      {error && <p role="alert" className="text-sm text-error">{error} Se volverá a intentar la consulta.</p>}
      {(!snapshot || pending.length > 0) && (
        <div role="status" className="flex items-center gap-2 text-sm text-texto-2">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          {pending.length ? pending.map(job => `${job.titulo}: ${job.estado === 'en-cola' ? 'en espera' : 'procesando'}`).join(' · ') : 'Consultando la importación…'}
        </div>
      )}
      {failed.map(job => (
        <div key={job.id} role="alert" className="space-y-2 text-sm text-error">
          <p>{job.titulo}: {job.resultado || (job.estado === 'cancelado' ? 'cancelado' : 'no se ha podido completar')}.</p>
          <Boton tam="sm" onClick={() => api.reintentar(job.id).then(updated => setJobs(previous => previous.map(item => item.id === updated.id ? updated : item))).catch(failure => avisar(failure.message, 'error'))}>Reintentar</Boton>
        </div>
      ))}
      {snapshot && (
        <>
          <p className="text-sm text-texto-2">{snapshot.secciones.length} {snapshot.secciones.length === 1 ? 'sección' : 'secciones'} de apuntes · {snapshot.actividades.length} {snapshot.actividades.length === 1 ? 'bloque' : 'bloques'} de ejercicios</p>
          {!!snapshot.actividades.length && <p className="text-[12.5px] text-texto-2">Los ejercicios están en Autoevaluación. Revisa el reparto y las soluciones antes de exportar.</p>}
          {document.warnings?.map((warning, index) => <p key={index} className="text-[12.5px] text-texto-2">{warning}</p>)}
          {!!snapshot.actividades.length && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium text-acento-texto">Revisar los ejercicios importados</summary>
              <div className="mt-3 space-y-4">
                {snapshot.actividades.filter(block => block.importedContent).map(block => <VistaPrevia key={block.id} texto={bloqueAMarkdown(block)} base={urlDatos(assignment, document.id)} />)}
              </div>
            </details>
          )}
          {snapshot.diagnostico && (
            <p className="text-sm text-texto-2">Diagnóstico listo: {snapshot.diagnostico.problemas.length} aspectos que puedes corregir en el punto 4, Revisión.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Boton tam="sm" onClick={() => onOpen(document.id)} disabled={uploading || processing}>Abrir apuntes</Boton>
            {!!snapshot.actividades.length && <Boton tam="sm" disabled={uploading || processing} onClick={() => onOpen(document.id, 'autoevaluacion')}>Ver ejercicios</Boton>}
            {snapshot.secciones.length > 0 && <Boton tam="sm" disabled={uploading || processing} onClick={() => onOpen(document.id, 'revision')}>Ir a Revisión</Boton>}
          </div>
        </>
      )}
    </section>
  );
}

export function ImportReviewModal({ assignment, document, onClose }: { assignment: string; document?: ImportedDocument; onClose: () => void }) {
  const { seleccionar, elegirVista } = useCampos('seleccionar', 'elegirVista');
  const [processingByDocument, setProcessingByDocument] = useState<Record<string, boolean>>({});
  const onProcessingChange = useCallback((id: string, processing: boolean) => {
    setProcessingByDocument(previous => previous[id] === processing ? previous : { ...previous, [id]: processing });
  }, []);
  useEffect(() => { setProcessingByDocument({}); }, [document?.id]);
  const processing = !!document && processingByDocument[document.id] !== false;
  const openDocument = (id: string, destination: ImportDestination = 'apuntes') => {
    elegirVista(`${assignment}/${id}`, destination);
    seleccionar({ asignatura: assignment, documento: id });
    onClose();
  };
  return (
    <Modal abierto={!!document} onCerrar={onClose} sinCerrar={processing} titulo="Importación de apuntes" ancho="max-w-2xl" descripcion="Transcripción, ejercicios y diagnóstico del archivo original.">
      {document && <ImportReport key={`${assignment}/${document.id}`} assignment={assignment} document={document} onOpen={openDocument} onProcessingChange={onProcessingChange} />}
      <div className="mt-4 flex justify-end"><Boton onClick={onClose}>{processing ? 'Continuar en segundo plano' : 'Cerrar'}</Boton></div>
    </Modal>
  );
}

export function ImportNotesModal({ asignatura, onCerrar }: { asignatura?: string; onCerrar: () => void }) {
  const { asignaturas, cargarAsignaturas, seleccionar, elegirVista } = useCampos('asignaturas', 'cargarAsignaturas', 'seleccionar', 'elegirVista');
  const assignment = asignaturas.find(item => item.id === asignatura);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState('');
  const [originalStyle, setOriginalStyle] = useState(true);
  const [diagnose, setDiagnose] = useState(true);
  const [progress, setProgress] = useState('');
  const [documents, setDocuments] = useState<ImportedDocument[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [processingByDocument, setProcessingByDocument] = useState<Record<string, boolean>>({});
  const onProcessingChange = useCallback((id: string, processing: boolean) => {
    setProcessingByDocument(previous => previous[id] === processing ? previous : { ...previous, [id]: processing });
  }, []);
  const processing = !!progress || documents.some(document => processingByDocument[document.id] !== false);
  useEffect(() => {
    if (!asignatura) return;
    setFiles([]); setTitle(''); setDocuments([]); setErrors([]); setProgress(''); setProcessingByDocument({});
  }, [asignatura]);
  const extensions = files.map(file => file.name.split('.').pop()?.toLowerCase());
  const office = extensions.some(extension => extension === 'docx' || extension === 'odt');
  const importFiles = async (event: FormEvent) => {
    event.preventDefault();
    if (!asignatura || !files.length || progress) return;
    const failedFiles: File[] = [];
    const failures: string[] = [];
    setErrors([]);
    try {
      for (const [index, file] of files.entries()) {
        setProgress(`${index + 1} de ${files.length}: ${file.name}`);
        try {
          const result = await api.importarApuntes(asignatura, file, {
            titulo: files.length === 1 ? title.trim() || undefined : undefined,
            modo: 'conservador', importOnly: true, estiloOriginal: originalStyle, diagnosticar: diagnose,
          });
          setDocuments(previous => [...previous, { id: result.documento.id, title: result.documento.titulo, warnings: result.avisos }]);
        } catch (failure) {
          failedFiles.push(file);
          failures.push(`${file.name}: ${(failure as Error).message}`);
        }
      }
      setFiles(failedFiles);
      setErrors(failures);
      await cargarAsignaturas();
    } finally { setProgress(''); }
  };
  const openDocument = (id: string, destination: ImportDestination = 'apuntes') => {
    elegirVista(`${asignatura}/${id}`, destination);
    seleccionar({ asignatura, documento: id });
    onCerrar();
  };
  return (
    <Modal abierto={!!asignatura} onCerrar={onCerrar} sinCerrar={processing} ancho="max-w-2xl" titulo="Importar apuntes existentes" descripcion={assignment ? `Se guardan en ${assignment.nombre}. El archivo original se conserva.` : undefined}>
      {(!documents.length || files.length > 0) && (
        <form onSubmit={importFiles} className="space-y-4">
          <fieldset disabled={!!progress} className="space-y-4">
            <Campo etiqueta="Archivos" ayuda="Word, LibreOffice, Markdown, ZIP con imágenes o PDF. Cada archivo crea un conjunto de apuntes.">
              <div className="flex items-start gap-3 rounded-lg border border-dashed border-borde p-3">
                <FileUp aria-hidden="true" className="mt-1 size-5 shrink-0 text-acento-texto" />
                <input aria-label="Archivos de apuntes" type="file" multiple accept=".docx,.odt,.md,.markdown,.txt,.zip,.pdf" className="min-w-0 w-full text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-panel-2 file:px-3 file:py-2 file:text-texto" onChange={event => setFiles(Array.from(event.target.files ?? []))} />
              </div>
              {files.length > 0 && <ul className="mt-2 text-[12.5px] text-texto-2">{files.map((file, index) => <li key={index} className="break-words">{file.name}</li>)}</ul>}
            </Campo>
            {files.length <= 1 && <Campo etiqueta="Título" ayuda="Si lo dejas vacío, se usa el del archivo."><Entrada value={title} onChange={event => setTitle(event.target.value)} /></Campo>}
            <p className="text-sm text-texto-2">Las explicaciones se guardan como apuntes y los bloques identificados como ejercicios pasan a Autoevaluación, con sus soluciones si las tienen.</p>
            {extensions.includes('pdf') && <p className="text-[12.5px] text-texto-2">Las imágenes rasterizadas se extraen localmente. Un agente recupera la estructura y sitúa las imágenes en el texto; la transcripción se sigue en este modal.</p>}
            {office && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={originalStyle} onChange={event => setOriginalStyle(event.target.checked)} />Conservar el estilo original al exportar</label>}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={diagnose} onChange={event => setDiagnose(event.target.checked)} />Preparar el diagnóstico para el punto 4, Revisión</label>
          </fieldset>
          {errors.map((error, index) => <p key={index} role="alert" className="text-sm text-error">{error}</p>)}
          {progress && <p role="status" className="text-sm text-texto-2">Importando {progress}</p>}
          <div className="flex justify-end gap-2">
            <Boton type="button" onClick={onCerrar} disabled={!!progress}>{processing && !progress ? 'Continuar en segundo plano' : 'Cerrar'}</Boton>
            <Boton type="submit" variante="primario" cargando={!!progress} disabled={!files.length}>{errors.length ? 'Reintentar archivos pendientes' : 'Importar'}</Boton>
          </div>
        </form>
      )}
      {documents.map(document => <ImportReport key={document.id} assignment={asignatura!} document={document} onOpen={openDocument} onProcessingChange={onProcessingChange} uploading={processing} />)}
      {!!documents.length && !progress && !files.length && <div className="mt-4 flex justify-end"><Boton onClick={onCerrar}>{processing ? 'Continuar en segundo plano' : 'Cerrar'}</Boton></div>}
    </Modal>
  );
}
