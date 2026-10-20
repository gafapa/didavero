import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  Download,
  FileCheck2,
  FileText,
  FolderOpen,
  GraduationCap,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Scale,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { AsignaturaDetalle, Exportado, Fuente, Seccion, Trabajo } from '../../../shared/tipos';
import { ARCHIVO_AUTOEVALUACION } from '../../../shared/tipos';
import { DIFICULTADES, LETRAS, TIPOS_ACTIVIDAD, type TipoActividad } from '../../../shared/actividades';
import {
  MAX_PREGUNTAS_EXAMEN,
  EXAM_ADAPTATIONS,
  TIPOS_CON_RUBRICA,
  examenAMarkdown,
  fmtPuntos,
  maximoTipoExamen,
  nombreTipo,
  respuestaBreve,
  resumenExamen,
  rubricaAMarkdown,
  solucionarioAMarkdown,
  conOptatividad,
  lineasDe,
  modeloB,
  partesExamen,
  totalExamen,
  valorParte,
  tiposExamen,
  type CriterioRubrica,
  type Examen,
  type OpcionesExamen,
  type PreguntaExamen,
  type ExamAdaptationKind,
} from '../../../shared/examenes';
import { api, urlDatos, type FuenteExamen } from '../lib/api';
import { useCampos } from '../lib/estado';
import { renderizar } from '../lib/markdown';
import { AreaTexto, Boton, Entrada, Insignia, Modal, Vacio, confirmar, cx } from './ui';
import { VistaPrevia } from './VistaPrevia';
import { ExamAdaptationComparison } from './ExamAdaptationComparison';
import { SelectorTipos } from './SelectorTipos';
import { ActividadAgente, fechaCorta } from './flujo/comun';

const activo = (t: Trabajo) => t.estado === 'ejecutando' || t.estado === 'en-cola';

/** Trabajos de los agentes en exámenes de esta asignatura. */
function useTrabajosExamen(a: string) {
  const { trabajos } = useCampos('trabajos');
  return useMemo(() => Object.values(trabajos).filter((t) => t.asignatura === a && t.paso === 'examen' && activo(t)), [trabajos, a]);
}

/** Exámenes de la asignatura, con su solucionario y su rúbrica, a partir de sus documentos o de otros archivos. */
export function PestanaExamenes({ a, onCount }: { a: AsignaturaDetalle; onCount?: (count: number) => void }) {
  const { avisar, versiones, reconexion } = useCampos('avisar', 'versiones', 'reconexion');
  const version = `${versiones[`${a.id}/`] ?? 0}-${reconexion}`;
  const [examenes, setExamenes] = useState<Examen[]>();
  const [abierto, setAbierto] = useState<string>();
  const [nuevo, setNuevo] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const enCurso = useTrabajosExamen(a.id);

  const loadExams = useCallback(async () => {
    const result = await api.examenes(a.id);
    setExamenes(result); onCount?.(result.length);
  }, [a.id, onCount]);

  useEffect(() => {
    void loadExams().catch((e) => avisar(e.message, 'error'));
  }, [loadExams, version, avisar]);

  async function deleteExam(exam: Examen) {
    if (deletingId || !await confirmar(`¿Eliminar «${exam.titulo}»?`, {
      texto: 'Se moverá el examen completo a la papelera, con sus preguntas, solucionario, rúbrica y archivos. Puedes recuperarlo en Inicio → Papelera.',
      boton: 'Mover a la papelera', peligro: true,
    })) return;
    setDeletingId(exam.id);
    try { await api.eliminarExamen(a.id, exam.id); await loadExams(); avisar('Examen movido a la papelera.', 'ok'); }
    catch (error) { avisar((error as Error).message, 'error'); }
    finally { setDeletingId(''); }
  }

  if (abierto) return <EditorExamen key={abierto} a={a} id={abierto} onVolver={() => { setAbierto(undefined); void loadExams().catch(error => avisar(error.message, 'error')); }} onOpenExam={setAbierto} />;
  if (!examenes) return null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-texto-2">
        Exámenes con su solucionario y su rúbrica de corrección. Se preparan a partir de los apuntes de la asignatura (enteros o algunas secciones), de sus
        fuentes o de otros archivos que subas solo para el examen: tus apuntes, el libro, exámenes de otros años…
      </p>
      {!examenes.length ? (
        <Vacio
          icono={<GraduationCap className="size-6" />}
          titulo="Sin exámenes todavía"
          texto="Elige el material y los tipos de pregunta; la IA prepara el examen, el solucionario y la rúbrica, y luego los revisas y exportas."
          accion={
            <Boton variante="primario" icono={<Plus className="size-4" />} onClick={() => setNuevo(true)}>
              Nuevo examen
            </Boton>
          }
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {examenes.map((ex) => {
            const trabajando = ex.estado === 'generando' || enCurso.some((t) => t.ref === ex.id || t.ref?.startsWith(`${ex.id}/`));
            return (
              <div key={ex.id} className="rounded-xl border border-borde bg-panel shadow-suave transition-colors hover:border-acento/50">
              <button
                onClick={() => setAbierto(ex.id)}
                disabled={deletingId === ex.id}
                className="w-full rounded-xl p-4 text-left cursor-pointer disabled:cursor-wait"
              >
                <GraduationCap className="mb-3 size-5 text-acento-texto" />
                <div className="font-medium leading-snug">{ex.titulo}</div>
                {ex.adaptation && <p className="mt-1 text-xs text-acento-texto">{EXAM_ADAPTATIONS.find((variant) => variant.id === ex.adaptation!.kind)?.name} · Versión adaptada</p>}
                <p className="mt-1 text-[13px] text-texto-2">
                  {ex.preguntas.length ? `${ex.preguntas.length} preguntas · ${fmtPuntos(totalExamen(ex))} puntos` : resumenExamen(ex.opciones) || 'Sin preguntas'}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-texto-3">
                  <span>Actualizado {new Date(ex.actualizado).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</span>
                  {trabajando ? (
                    <span className="flex items-center gap-1 text-acento-texto">
                      <Loader2 className="size-3 animate-spin" /> Generando
                    </span>
                  ) : ex.estado === 'error' ? (
                    <Insignia color="error">error</Insignia>
                  ) : !ex.preguntas.length ? (
                    <Insignia>borrador</Insignia>
                  ) : null}
                </div>
              </button>
              <div className="flex justify-end px-3 pb-3"><Boton tam="sm" variante="fantasma" icono={<Trash2 className="size-3.5" />} aria-label={`Eliminar examen ${ex.titulo}`} title={trabajando ? 'Espera a que termine el agente o cancélalo antes de eliminar.' : undefined} disabled={!!deletingId || trabajando} cargando={deletingId === ex.id} onClick={() => void deleteExam(ex)}>Eliminar</Boton></div>
              </div>
            );
          })}
          <button
            onClick={() => setNuevo(true)}
            className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-borde text-texto-3 transition-colors hover:border-acento hover:text-acento-texto cursor-pointer"
          >
            <Plus className="size-5" />
            Nuevo examen
          </button>
        </div>
      )}
      {nuevo && (
        <ModalNuevoExamen
          onCerrar={() => setNuevo(false)}
          onCrear={async (titulo) => {
            const ex = await api.crearExamen(a.id, titulo);
            setNuevo(false);
            setAbierto(ex.id);
          }}
        />
      )}
    </div>
  );
}

function ModalNuevoExamen({ onCerrar, onCrear }: { onCerrar: () => void; onCrear: (titulo: string) => Promise<void> }) {
  const { avisar } = useCampos('avisar');
  const [titulo, setTitulo] = useState('');
  const [creando, setCreando] = useState(false);
  const crear = async () => {
    setCreando(true);
    try {
      await onCrear(titulo.trim() || 'Examen');
    } catch (e) {
      avisar((e as Error).message, 'error');
      setCreando(false);
    }
  };
  return (
    <Modal abierto onCerrar={onCerrar} titulo="Nuevo examen" descripcion="Ponle un nombre; después eliges el material y las preguntas.">
      <div className="space-y-4">
        <Entrada
          autoFocus
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Por ejemplo: Examen de la 1.ª evaluación, Recuperación del tema 3…"
          onKeyDown={(e) => e.key === 'Enter' && crear()}
        />
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton variante="primario" icono={<Plus className="size-4" />} cargando={creando} onClick={crear}>
            Crear
          </Boton>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Editor de un examen

type Apartado = 'preparar' | 'preguntas' | 'vista';

function EditorExamen({ a, id, onVolver, onOpenExam }: { a: AsignaturaDetalle; id: string; onVolver: () => void; onOpenExam: (id: string) => void }) {
  const { avisar, versiones, reconexion } = useCampos('avisar', 'versiones', 'reconexion');
  const version = `${versiones[`${a.id}/`] ?? 0}-${reconexion}`;
  const [ex, setEx] = useState<Examen>();
  const [apartado, setApartado] = useState<Apartado>();
  const trabajos = useTrabajosExamen(a.id).filter((t) => t.ref === id || t.ref?.startsWith(`${id}/`));
  const generando = ex?.estado === 'generando' || trabajos.some((t) => t.ref === id);

  const cargar = useCallback(() => {
    api
      .examen(a.id, id)
      .then(setEx)
      .catch((e) => {
        avisar(e.message, 'error');
        if ((e as { status?: number }).status === 404) onVolver();
      });
  }, [a.id, id, avisar, onVolver]);
  useEffect(cargar, [cargar, version]);

  // Al abrirlo: si ya tiene preguntas, a ellas; si no, a prepararlo. Al terminar de generarse, a las preguntas
  const antes = useRef<string>(undefined);
  useEffect(() => {
    if (!ex) return;
    if (!apartado) setApartado(ex.preguntas.length ? 'preguntas' : 'preparar');
    else if (antes.current === 'generando' && ex.estado === 'listo') setApartado('preguntas');
    antes.current = ex.estado;
  }, [ex, apartado]);

  if (!ex || !apartado) return null;

  const eliminar = async () => {
    if (!(await confirmar(`¿Eliminar «${ex.titulo}»?`, { texto: 'Se moverá el examen completo a la papelera. Puedes recuperarlo en Inicio → Papelera.', boton: 'Mover a la papelera', peligro: true }))) return;
    try {
      await api.eliminarExamen(a.id, id);
      onVolver();
    } catch (e) {
      avisar((e as Error).message, 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button className="flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] text-texto-2 hover:bg-panel-2 hover:text-texto cursor-pointer" onClick={onVolver}>
          <ArrowLeft className="size-4" /> Exámenes
        </button>
        <TituloEditable
          valor={ex.titulo}
          onGuardar={async (titulo) => setEx(await api.guardarExamen(a.id, id, { titulo }))}
        />
        <button className="rounded-lg p-1.5 text-texto-3 hover:text-error cursor-pointer" title="Eliminar el examen" aria-label="Eliminar el examen" onClick={eliminar}>
          <Trash2 className="size-4" />
        </button>
      </div>

      {ex.adaptation && (
        <Tarjeta titulo={EXAM_ADAPTATIONS.find((variant) => variant.id === ex.adaptation!.kind)?.name ?? 'Versión adaptada'} ayuda="Copia independiente: revisa los enunciados, las respuestas y la rúbrica antes de utilizarla.">
          <p className="text-sm text-texto-2">Basada en «{ex.adaptation.sourceTitle}». Preguntas seleccionadas para adaptar: {ex.adaptation.questionIds.length}.</p>
          <Boton variante="fantasma" onClick={() => onOpenExam(ex.adaptation!.sourceExamId)}>Abrir examen de origen</Boton>
          <ExamAdaptationComparison subjectId={a.id} exam={ex} />
        </Tarjeta>
      )}

      <div className="flex gap-0.5 rounded-lg bg-panel-2 p-0.5">
        {(
          [
            ['preparar', '1. Material y preguntas'],
            ['preguntas', `2. Revisar${ex.preguntas.length ? ` (${ex.preguntas.length})` : ''}`],
            ['vista', '3. Vista previa y exportar'],
          ] as [Apartado, string][]
        ).map(([k, txt]) => (
          <button
            key={k}
            disabled={k !== 'preparar' && !ex.preguntas.length}
            onClick={() => setApartado(k)}
            className={cx(
              'flex-1 rounded-md px-3 py-1.5 text-[13px] cursor-pointer disabled:cursor-default disabled:opacity-40',
              apartado === k ? 'bg-panel font-medium text-texto shadow-sm' : 'text-texto-2 hover:text-texto',
            )}
          >
            {txt}
          </button>
        ))}
      </div>

      {trabajos.map((t) => (
        <ActividadAgente key={t.id} t={t} />
      ))}
      {ex.error && !generando && (
        <p className="flex items-start gap-1.5 rounded-xl border border-error/30 px-3 py-2 text-[12.5px] text-error">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {ex.error}
        </p>
      )}

      {apartado === 'preparar' && (ex.adaptation
        ? <p role="status" className="text-sm text-texto-2">{generando ? 'Generando la adaptación. Al terminar podrás revisar y editar sus preguntas.' : 'Esta copia conserva el material y la puntuación del examen de origen. Revisa sus preguntas o abre el examen de origen para crear otra versión.'}</p>
        : <Preparar a={a} ex={ex} generando={generando} onCambio={setEx} />)}
      {apartado === 'preguntas' && <Revisar a={a.id} ex={ex} trabajos={trabajos} onCambio={setEx} />}
      {apartado === 'vista' && <VistaYExportar a={a.id} ex={ex} onCambio={setEx} onOpenExam={onOpenExam} />}
    </div>
  );
}

function TituloEditable({ valor, onGuardar }: { valor: string; onGuardar: (v: string) => Promise<void> }) {
  const [texto, setTexto] = useState(valor);
  useEffect(() => setTexto(valor), [valor]);
  return (
    <input
      value={texto}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => texto.trim() && texto.trim() !== valor && onGuardar(texto.trim()).catch(() => setTexto(valor))}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-semibold outline-none hover:border-borde focus:border-acento"
      aria-label="Título del examen"
    />
  );
}

// ---------------------------------------------------------------------------
// 1. Material y preguntas

function Preparar({ a, ex, generando, onCambio }: { a: AsignaturaDetalle; ex: Examen; generando: boolean; onCambio: (ex: Examen) => void }) {
  const { avisar } = useCampos('avisar');
  const [op, setOp] = useState<OpcionesExamen>(ex.opciones);
  const [lanzando, setLanzando] = useState(false);
  // Se guarda solo, poco después de cada cambio
  const guardado = useRef(JSON.stringify(ex.opciones));
  useEffect(() => {
    const json = JSON.stringify(op);
    if (json === guardado.current) return;
    const t = setTimeout(() => {
      guardado.current = json;
      api.guardarExamen(a.id, ex.id, { opciones: op }).then(onCambio).catch((e) => avisar(e.message, 'error'));
    }, 600);
    return () => clearTimeout(t);
  }, [op, a.id, ex.id, avisar, onCambio]);

  const cambiar = (c: Partial<OpcionesExamen>) => setOp((o) => ({ ...o, ...c }));
  const total = tiposExamen(op).reduce((n, [, c]) => n + c, 0);

  const generar = async () => {
    if (ex.preguntas.length && !(await confirmar('¿Volver a generar el examen?', { texto: 'Se sustituirán todas las preguntas actuales, también las que hayas editado.', boton: 'Generar de nuevo' }))) return;
    setLanzando(true);
    try {
      guardado.current = JSON.stringify(op);
      await api.generarExamen(a.id, ex.id, op);
      onCambio({ ...ex, opciones: op, estado: 'generando', error: undefined });
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setLanzando(false);
    }
  };

  return (
    <div className="space-y-4">
      <Tarjeta titulo="Material" ayuda="Las preguntas salen solo de lo que elijas aquí.">
        <ElegirDocumentos a={a} valor={op.documentos} onCambio={(documentos) => cambiar({ documentos })} />
        <ElegirFuentes a={a.id} valor={op.fuentesAsignatura} onCambio={(fuentesAsignatura) => cambiar({ fuentesAsignatura })} />
        <ArchivosExamen a={a.id} id={ex.id} />
      </Tarjeta>

      <Tarjeta titulo="Preguntas" ayuda={`${total} preguntas${total > MAX_PREGUNTAS_EXAMEN ? ` (como máximo ${MAX_PREGUNTAS_EXAMEN})` : ''}`}>
        <SelectorTipos
          valor={op.tipos}
          onCambio={(tipos) => cambiar({ tipos })}
          maximo={maximoTipoExamen}
          nota={(t) => (TIPOS_CON_RUBRICA.includes(t) ? 'con rúbrica' : undefined)}
        />
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <div className="text-[12.5px] font-medium text-texto-2">Dificultad</div>
            <div className="mt-1.5 flex flex-wrap gap-0.5 rounded-lg bg-panel-2 p-0.5">
              {DIFICULTADES.map((x) => (
                <button
                  key={x.id}
                  onClick={() => cambiar({ dificultad: x.id })}
                  className={cx('rounded-md px-2 py-1 text-[12px] cursor-pointer', op.dificultad === x.id ? 'bg-panel text-texto shadow-sm' : 'text-texto-3 hover:text-texto')}
                >
                  {x.nombre}
                </button>
              ))}
            </div>
          </div>
          <label className="w-32 text-[12.5px] font-medium text-texto-2">
            Puntuación total
            <Entrada type="number" min={1} step={0.5} className="mt-1" value={op.total} onChange={(e) => cambiar({ total: Number(e.target.value) || 10 })} />
          </label>
          <label className="w-32 text-[12.5px] font-medium text-texto-2">
            Duración (minutos)
            <Entrada type="number" min={0} step={5} className="mt-1" value={op.duracion ?? ''} onChange={(e) => cambiar({ duracion: Number(e.target.value) || undefined })} />
          </label>
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-[13px]">
            <input type="checkbox" className="accent-[var(--acento)]" checked={!!op.penalizar} onChange={(e) => cambiar({ penalizar: e.target.checked })} />
            Los errores en el test restan
          </label>
        </div>
        <label className="block text-[12.5px] font-medium text-texto-2">
          Instrucciones para el alumnado (opcional)
          <AreaTexto
            rows={2}
            className="mt-1 text-[13px]"
            value={op.instrucciones ?? ''}
            onChange={(e) => cambiar({ instrucciones: e.target.value })}
            placeholder="Van en la cabecera del examen. Por ejemplo: Responde con bolígrafo azul o negro. Se permite calculadora no programable."
          />
        </label>
        <label className="block text-[12.5px] font-medium text-texto-2">
          Indicaciones para la IA (opcional)
          <AreaTexto
            rows={2}
            className="mt-1 text-[13px]"
            value={op.indicaciones ?? ''}
            onChange={(e) => cambiar({ indicaciones: e.target.value })}
            placeholder="Por ejemplo: estilo PAU, más peso a los temas 3 y 4, ejercicios con datos del laboratorio, sin preguntas de memoria pura…"
          />
        </label>
      </Tarjeta>

      <div className="flex items-center justify-end gap-3">
        {ex.preguntas.length > 0 && !generando && <span className="text-[12.5px] text-texto-3">Ya tiene {ex.preguntas.length} preguntas: generarlo de nuevo las sustituye.</span>}
        <Boton variante="primario" icono={<Sparkles className="size-4" />} cargando={lanzando} disabled={generando || !total || total > MAX_PREGUNTAS_EXAMEN} onClick={generar}>
          {generando ? 'Generando…' : ex.preguntas.length ? 'Generar de nuevo' : 'Generar el examen'}
        </Boton>
      </div>
    </div>
  );
}

function Tarjeta({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-borde bg-panel px-5 py-4">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[14px] font-semibold">{titulo}</h3>
        {ayuda && <span className="text-[12px] text-texto-3">{ayuda}</span>}
      </div>
      {children}
    </section>
  );
}

/** Documentos de la asignatura (y, de cada uno, todas sus secciones o algunas). */
function ElegirDocumentos({ a, valor, onCambio }: { a: AsignaturaDetalle; valor: OpcionesExamen['documentos']; onCambio: (v: OpcionesExamen['documentos']) => void }) {
  const [abierto, setAbierto] = useState<string>();
  const [secciones, setSecciones] = useState<Record<string, Seccion[]>>({});
  useEffect(() => {
    if (abierto && !secciones[abierto]) api.secciones(a.id, abierto).then((l) => setSecciones((s) => ({ ...s, [abierto]: l.filter((x) => !ARCHIVO_AUTOEVALUACION.test(x.archivo) && x.palabras > 40) }))).catch(() => {});
  }, [abierto, a.id, secciones]);
  if (!a.documentos.length) return <p className="text-[12.5px] text-texto-3">La asignatura no tiene apuntes: sube abajo los archivos sobre los que preguntar.</p>;
  const elegido = (d: string) => valor.find((x) => x.id === d);
  const poner = (d: string, sel?: string[]) => onCambio(sel === undefined ? valor.filter((x) => x.id !== d) : [...valor.filter((x) => x.id !== d), { id: d, secciones: sel }]);
  return (
    <div>
      <div className="mb-1 text-[12.5px] font-medium text-texto-2">Apuntes de la asignatura</div>
      <div className="divide-y divide-borde rounded-lg border border-borde">
        {a.documentos.map((d) => {
          const e = elegido(d.id);
          const lista = secciones[d.id];
          return (
            <div key={d.id}>
              <div className="flex items-center gap-2 px-3 py-1.5">
                <input type="checkbox" className="size-4 accent-[var(--acento)] cursor-pointer" checked={!!e} onChange={(ev) => poner(d.id, ev.target.checked ? [] : undefined)} aria-label={d.titulo} />
                <FileText className="size-3.5 shrink-0 text-texto-3" />
                <span className="min-w-0 flex-1 truncate text-[13px]">{d.titulo}</span>
                {e && <span className="text-[12px] text-texto-3">{e.secciones.length ? `${e.secciones.length} secciones` : 'entero'}</span>}
                <button className="rounded p-1 text-texto-3 hover:text-texto cursor-pointer" title="Elegir secciones" aria-label="Elegir secciones" onClick={() => setAbierto(abierto === d.id ? undefined : d.id)}>
                  <ChevronDown className={cx('size-3.5 transition-transform', abierto === d.id && 'rotate-180')} />
                </button>
              </div>
              {abierto === d.id && (
                <div className="space-y-0.5 border-t border-borde bg-panel-2/40 px-9 py-2">
                  {!lista ? (
                    <Loader2 className="size-3.5 animate-spin text-texto-3" />
                  ) : !lista.length ? (
                    <p className="text-[12px] text-texto-3">Todavía no tiene secciones redactadas.</p>
                  ) : (
                    lista.map((s) => {
                      const todas = !!e && !e.secciones.length;
                      return (
                        <label key={s.archivo} className="flex cursor-pointer items-center gap-2 text-[12.5px]">
                          <input
                            type="checkbox"
                            className="accent-[var(--acento)]"
                            checked={todas || !!e?.secciones.includes(s.archivo)}
                            onChange={(ev) => {
                              const n = new Set(todas ? lista.map((x) => x.archivo) : (e?.secciones ?? []));
                              if (ev.target.checked) n.add(s.archivo);
                              else n.delete(s.archivo);
                              poner(d.id, !n.size ? undefined : n.size === lista.length ? [] : [...n]);
                            }}
                          />
                          <span className="truncate">{s.titulo}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Fuentes de la asignatura que se usan en el examen. */
function ElegirFuentes({ a, valor, onCambio }: { a: string; valor: string[]; onCambio: (v: string[]) => void }) {
  const [fuentes, setFuentes] = useState<Fuente[]>([]);
  useEffect(() => {
    api.fuentes(a).then(setFuentes).catch(() => {});
  }, [a]);
  if (!fuentes.length) return null;
  return (
    <div>
      <div className="mb-1 text-[12.5px] font-medium text-texto-2">Fuentes de la asignatura</div>
      <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-borde px-3 py-2">
        {fuentes.map((f) => (
          <label key={f.nombre} className="flex cursor-pointer items-center gap-2 text-[12.5px]">
            <input
              type="checkbox"
              className="accent-[var(--acento)]"
              checked={valor.includes(f.nombre)}
              onChange={(e) => onCambio(e.target.checked ? [...valor, f.nombre] : valor.filter((x) => x !== f.nombre))}
            />
            <span className="truncate">{f.nombre}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function tamano(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}

/** Archivos subidos solo para este examen: documentos que no se han hecho con la aplicación. */
function ArchivosExamen({ a, id }: { a: string; id: string }) {
  const { avisar } = useCampos('avisar');
  const [archivos, setArchivos] = useState<FuenteExamen[]>();
  const [arrastrando, setArrastrando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const cargar = useCallback(() => {
    api.fuentesExamen(a, id).then(setArchivos).catch(() => {});
  }, [a, id]);
  useEffect(cargar, [cargar]);

  const subir = async (lista: File[]) => {
    if (!lista.length) return;
    setSubiendo(true);
    try {
      const r = await api.subirFuentesExamen(a, id, lista);
      avisar(r.guardados.length === 1 ? 'Archivo añadido al examen' : `${r.guardados.length} archivos añadidos al examen`, 'ok');
      cargar();
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setSubiendo(false);
    }
  };
  const quitar = async (f: FuenteExamen) => {
    if (!(await confirmar(`¿Quitar «${f.nombre}» del examen?`, { boton: 'Quitar', peligro: true }))) return;
    await api.eliminarFuenteExamen(a, id, f.nombre).catch((e) => avisar(e.message, 'error'));
    cargar();
  };

  return (
    <div>
      <div className="mb-1 text-[12.5px] font-medium text-texto-2">Otros archivos, solo para este examen</div>
      <div
        role="button"
        tabIndex={0}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          subir([...e.dataTransfer.files]);
        }}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        className={cx(
          'flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-3 text-[12.5px] transition-colors',
          arrastrando ? 'border-acento bg-acento-suave text-acento-texto' : 'border-borde text-texto-3 hover:border-acento hover:text-acento-texto',
        )}
      >
        {subiendo ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        Arrastra o elige apuntes, temas del libro, exámenes anteriores… (PDF, Word, LibreOffice, PowerPoint, Markdown, texto o imágenes)
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          subir([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      {!!archivos?.length && (
        <div className="mt-2 divide-y divide-borde rounded-lg border border-borde">
          {archivos.map((f) => (
            <div key={f.nombre} className="flex items-center gap-2 px-3 py-1.5 text-[12.5px]">
              <FileText className="size-3.5 shrink-0 text-acento-texto" />
              <span className="min-w-0 flex-1 truncate">{f.nombre}</span>
              <span className="text-[11.5px] text-texto-3">
                {f.estado === 'indexado'
                  ? `texto leído${f.paginas ? ` · ${f.paginas} págs.` : ''}`
                  : f.estado === 'sin-texto' || f.estado === 'no-admitido'
                    ? 'sin texto: la IA lo abrirá directamente'
                    : 'leyendo…'}{' '}
                · {tamano(f.tamano)}
              </span>
              <button className="rounded p-1 text-texto-3 hover:text-error cursor-pointer" title="Quitar del examen" aria-label="Quitar del examen" onClick={() => quitar(f)}>
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Revisar las preguntas

function Revisar({ a, ex, trabajos, onCambio }: { a: string; ex: Examen; trabajos: Trabajo[]; onCambio: (ex: Examen) => void }) {
  const { avisar } = useCampos('avisar');
  const [editando, setEditando] = useState<PreguntaExamen>();
  const [rehaciendo, setRehaciendo] = useState<PreguntaExamen>();
  const [nueva, setNueva] = useState(false);
  const total = totalExamen(ex);
  const cuadra = total === ex.opciones.total;
  const partes = partesExamen(ex);
  // Optatividad de una parte: se guarda y se reparte la puntuación (cuenta solo lo que se responde)
  const elegir = async (tipo: TipoActividad, n: number) => {
    try {
      await api.guardarExamen(a, ex.id, { opciones: { elegir: { ...ex.opciones.elegir, [tipo]: n } } });
      onCambio(await api.ajustarPuntuacion(a, ex.id));
    } catch (e) {
      avisar((e as Error).message, 'error');
    }
  };
  const hacer = (p: Promise<Examen>) => p.then(onCambio).catch((e) => avisar((e as Error).message, 'error'));
  const mover = (i: number, d: number) => {
    const ids = ex.preguntas.map((p) => p.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    hacer(api.ordenarPreguntasExamen(a, ex.id, ids));
  };

  return (
    <div className="space-y-3">
      <div className={cx('flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5', cuadra ? 'border-borde' : 'border-aviso/50 bg-aviso/5')}>
        <Scale className={cx('size-4', cuadra ? 'text-texto-3' : 'text-aviso')} />
        <span className="flex-1 text-[13px]">
          {ex.preguntas.length} preguntas · <strong>{fmtPuntos(total)}</strong> de {fmtPuntos(ex.opciones.total)} puntos
          {!cuadra && <span className="text-texto-2"> — la suma no coincide con la puntuación total</span>}
        </span>
        {!cuadra && (
          <Boton tam="sm" onClick={() => hacer(api.ajustarPuntuacion(a, ex.id))}>
            Repartir para que sume {fmtPuntos(ex.opciones.total)}
          </Boton>
        )}
        <Boton tam="sm" variante="fantasma" icono={<Plus className="size-3.5" />} onClick={() => setNueva(true)}>
          Añadir pregunta
        </Boton>
      </div>

      {partes.map((parte, k) => (
        <div key={k} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 px-1 pt-2">
            <span className="text-[13px] font-semibold">
              {partes.length > 1 ? `Parte ${k + 1}. ` : ''}
              {nombreTipo(parte.tipo)}
            </span>
            <span className="text-[12px] text-texto-3">
              {fmtPuntos(valorParte(parte))} puntos{conOptatividad(parte) ? ` · se responden ${parte.elegir} de ${parte.preguntas.length}` : ''}
            </span>
            {parte.preguntas.length > 1 && (
              <label className="ml-auto flex items-center gap-1.5 text-[12px] text-texto-2" title="Optatividad: el alumnado elige qué preguntas de esta parte responde">
                Hay que responder
                <select
                  value={parte.elegir}
                  onChange={(e) => elegir(parte.tipo, Number(e.target.value) >= parte.preguntas.length ? 0 : Number(e.target.value))}
                  className="h-7 rounded-md border border-borde bg-panel px-1.5 text-[12px] outline-none focus:border-acento cursor-pointer"
                >
                  {Array.from({ length: parte.preguntas.length }, (_, i) => parte.preguntas.length - i).map((n) => (
                    <option key={n} value={n}>
                      {n === parte.preguntas.length ? 'todas' : `${n} de ${parte.preguntas.length}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {parte.preguntas.map(({ p, n }) => {
            const i = n - 1;
            return (
              <TarjetaPregunta
                key={p.id}
                p={p}
                n={n}
                trabajo={trabajos.find((t) => t.ref === `${ex.id}/${p.id}`)}
                primera={i === 0}
                ultima={i === ex.preguntas.length - 1}
                onMover={(d) => mover(i, d)}
                onPuntos={(puntos) => hacer(api.editarPreguntaExamen(a, ex.id, p.id, { puntos }))}
                onEditar={() => setEditando(p)}
                onRehacer={() => setRehaciendo(p)}
                onEliminar={async () => {
                  if (await confirmar(`¿Quitar la pregunta ${n}?`, { boton: 'Quitar', peligro: true })) hacer(api.eliminarPreguntaExamen(a, ex.id, p.id));
                }}
              />
            );
          })}
        </div>
      ))}
      {trabajos
        .filter((t) => t.ref === `${ex.id}/nueva`)
        .map((t) => (
          <ActividadAgente key={t.id} t={t} />
        ))}

      {editando && (
        <EditorPregunta
          p={editando}
          onCerrar={() => setEditando(undefined)}
          onGuardar={async (cambios) => {
            onCambio(await api.editarPreguntaExamen(a, ex.id, editando.id, cambios));
            setEditando(undefined);
          }}
        />
      )}
      {rehaciendo && (
        <ModalIndicaciones
          titulo={`Rehacer la pregunta ${ex.preguntas.indexOf(rehaciendo) + 1}`}
          descripcion="La IA escribe otra pregunta del mismo tipo y con los mismos puntos que la sustituye."
          ayuda="Qué cambiar (opcional): más difícil, sobre otro apartado, con datos reales, más corta…"
          boton="Rehacer"
          onCerrar={() => setRehaciendo(undefined)}
          onEnviar={async (indicaciones) => {
            await api.rehacerPreguntaExamen(a, ex.id, rehaciendo.id, indicaciones);
            setRehaciendo(undefined);
          }}
        />
      )}
      {nueva && (
        <ModalIndicaciones
          titulo="Añadir una pregunta"
          descripcion="La IA la prepara a partir del mismo material, sin repetir lo que ya pregunta el examen."
          ayuda="Sobre qué (opcional): un apartado concreto, un tipo de ejercicio…"
          boton="Añadir"
          conTipo
          onCerrar={() => setNueva(false)}
          onEnviar={async (indicaciones, tipo) => {
            await api.nuevaPreguntaExamen(a, ex.id, tipo!, indicaciones);
            setNueva(false);
          }}
        />
      )}
    </div>
  );
}

/** Markdown de una pregunta con su respuesta y, en las abiertas, su rúbrica. */
function detallePregunta(p: PreguntaExamen): string {
  const lineas: string[] = [];
  const correcta = (i: number) => (p.tipo === 'multiple' ? !!p.correctas?.includes(i) : i === p.correcta);
  if ((p.tipo === 'test' || p.tipo === 'multiple') && p.opciones?.length) lineas.push(...p.opciones.map((o, i) => `- **${LETRAS[i]})** ${o}${correcta(i) ? ' ✔' : ''}`), '');
  if (p.tipo === 'emparejar' && p.pares?.length) lineas.push(...p.pares.map((x) => `- ${x[0]} → ${x[1]}`), '');
  if (p.tipo === 'ordenar' && p.elementos?.length) lineas.push('**Orden correcto:**', '', ...p.elementos.map((x, i) => `${i + 1}. ${x}`), '');
  if (p.tipo === 'clasificar' && p.categorias?.length) lineas.push(...p.categorias.map((c) => `- **${c.nombre}:** ${c.elementos.join(', ')}`), '');
  const breve = respuestaBreve(p);
  if (breve && !['test', 'multiple', 'emparejar', 'ordenar', 'clasificar'].includes(p.tipo)) lineas.push(`**${TIPOS_CON_RUBRICA.includes(p.tipo) ? 'Resultado' : 'Respuesta'}:** ${breve}`, '');
  if (p.solucion) lineas.push(p.solucion, '');
  if (p.explicacion && p.explicacion !== p.solucion) lineas.push(`*${p.explicacion}*`, '');
  if (p.rubrica?.length) {
    lineas.push('**Rúbrica**', '', ...p.rubrica.map((c) => `- **${c.criterio}** (${fmtPuntos(c.puntos)} p): ${c.niveles.map((x) => `*${x.nivel}* ${fmtPuntos(x.puntos)}`).join(' · ')}`), '');
  }
  if (p.errores?.length) lineas.push('**Errores frecuentes:** ' + p.errores.join('; '), '');
  const meta = [p.criterios?.length ? `Criterios: ${p.criterios.join(', ')}` : '', p.origen ? `De: ${p.origen}` : ''].filter(Boolean).join(' · ');
  if (meta) lineas.push(`*${meta}*`);
  return lineas.join('\n');
}

function TarjetaPregunta({
  p,
  n,
  trabajo,
  primera,
  ultima,
  onMover,
  onPuntos,
  onEditar,
  onRehacer,
  onEliminar,
}: {
  p: PreguntaExamen;
  n: number;
  trabajo?: Trabajo;
  primera: boolean;
  ultima: boolean;
  onMover: (d: number) => void;
  onPuntos: (puntos: number) => void;
  onEditar: () => void;
  onRehacer: () => void;
  onEliminar: () => void;
}) {
  const [abierta, setAbierta] = useState(false);
  const [puntos, setPuntos] = useState(String(p.puntos));
  useEffect(() => setPuntos(String(p.puntos)), [p.puntos]);
  const enunciado = useMemo(
    () => renderizar([p.material?.trim() && (p.tipo === 'comentario' ? p.material.trim().replace(/^/gm, '> ') : p.material.trim()), p.enunciado || nombreTipo(p.tipo)].filter(Boolean).join('\n\n')),
    [p.material, p.enunciado, p.tipo],
  );
  const detalle = useMemo(() => (abierta ? renderizar(detallePregunta(p)) : ''), [abierta, p]);
  const ocupada = !!trabajo;
  return (
    <div className={cx('rounded-xl border bg-panel', ocupada ? 'border-acento/50' : 'border-borde')}>
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
          <span className="text-[13px] font-semibold tabular-nums">{n}</span>
          <button className="rounded text-texto-3 hover:text-texto cursor-pointer disabled:opacity-30" disabled={primera} onClick={() => onMover(-1)} title="Subir">
            <ArrowUp className="size-3.5" />
          </button>
          <button className="rounded text-texto-3 hover:text-texto cursor-pointer disabled:opacity-30" disabled={ultima} onClick={() => onMover(1)} title="Bajar">
            <ArrowDown className="size-3.5" />
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Insignia color={TIPOS_CON_RUBRICA.includes(p.tipo) ? 'acento' : 'neutro'}>{nombreTipo(p.tipo)}</Insignia>
            {p.criterios?.map((c) => (
              <span key={c} className="rounded bg-panel-2 px-1.5 text-[11px] text-texto-3">
                {c}
              </span>
            ))}
          </div>
          <div className="apunte !text-[13.5px] !leading-snug [&_p]:my-1" dangerouslySetInnerHTML={{ __html: enunciado }} />
          <button className="mt-1 flex items-center gap-1 text-[12px] text-acento-texto hover:underline cursor-pointer" onClick={() => setAbierta(!abierta)}>
            <ChevronDown className={cx('size-3.5 transition-transform', abierta && 'rotate-180')} />
            {abierta ? 'Ocultar' : TIPOS_CON_RUBRICA.includes(p.tipo) ? 'Solución y rúbrica' : 'Respuesta'}
          </button>
          {abierta && <div className="apunte mt-2 rounded-lg bg-panel-2/50 px-3 py-2 !text-[12.5px] !leading-snug [&_p]:my-1" dangerouslySetInnerHTML={{ __html: detalle }} />}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <label className="flex items-center gap-1 text-[12px] text-texto-3">
            <input
              type="number"
              min={0}
              step={0.25}
              value={puntos}
              onChange={(e) => setPuntos(e.target.value)}
              onBlur={() => Number(puntos) !== p.puntos && onPuntos(Math.max(0, Number(puntos) || 0))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="h-7 w-16 rounded-md border border-borde bg-panel px-1.5 text-right text-[13px] text-texto outline-none focus:border-acento"
              aria-label={`Puntos de la pregunta ${n}`}
            />
            p
          </label>
          <div className="flex items-center">
            <button className="rounded p-1 text-texto-3 hover:text-texto cursor-pointer disabled:opacity-40" title="Editar a mano" aria-label="Editar a mano" disabled={ocupada} onClick={onEditar}>
              <Pencil className="size-3.5" />
            </button>
            <button className="rounded p-1 text-texto-3 hover:text-texto cursor-pointer disabled:opacity-40" title="Rehacer con IA" aria-label="Rehacer con IA" disabled={ocupada} onClick={onRehacer}>
              <RotateCcw className="size-3.5" />
            </button>
            <button className="rounded p-1 text-texto-3 hover:text-error cursor-pointer disabled:opacity-40" title="Quitar" aria-label="Quitar" disabled={ocupada} onClick={onEliminar}>
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
      {trabajo && (
        <div className="border-t border-borde px-4 py-2">
          <ActividadAgente t={trabajo} />
        </div>
      )}
    </div>
  );
}

function ModalIndicaciones({
  titulo,
  descripcion,
  ayuda,
  boton,
  conTipo,
  onCerrar,
  onEnviar,
}: {
  titulo: string;
  descripcion: string;
  ayuda: string;
  boton: string;
  conTipo?: boolean;
  onCerrar: () => void;
  onEnviar: (indicaciones: string | undefined, tipo?: TipoActividad) => Promise<void>;
}) {
  const { avisar } = useCampos('avisar');
  const [indicaciones, setIndicaciones] = useState('');
  const [tipo, setTipo] = useState<TipoActividad>('desarrollo');
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    setEnviando(true);
    try {
      await onEnviar(indicaciones.trim() || undefined, conTipo ? tipo : undefined);
    } catch (e) {
      avisar((e as Error).message, 'error');
      setEnviando(false);
    }
  };
  return (
    <Modal abierto onCerrar={onCerrar} titulo={titulo} descripcion={descripcion}>
      <div className="space-y-3">
        {conTipo && (
          <div className="flex flex-wrap gap-1">
            {TIPOS_ACTIVIDAD.map((t) => (
              <button
                key={t.id}
                onClick={() => setTipo(t.id)}
                className={cx('rounded-lg border px-2.5 py-1 text-[12.5px] cursor-pointer', tipo === t.id ? 'border-acento bg-acento-suave font-medium' : 'border-borde text-texto-2 hover:text-texto')}
              >
                {t.nombre}
              </button>
            ))}
          </div>
        )}
        <AreaTexto autoFocus rows={3} className="text-[13px]" placeholder={ayuda} value={indicaciones} onChange={(e) => setIndicaciones(e.target.value)} />
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton variante="primario" icono={<Sparkles className="size-4" />} cargando={enviando} onClick={enviar}>
            {boton}
          </Boton>
        </div>
      </div>
    </Modal>
  );
}

/** Edición a mano de una pregunta: enunciado, respuesta, solución, puntos y rúbrica. */
function EditorPregunta({ p, onCerrar, onGuardar }: { p: PreguntaExamen; onCerrar: () => void; onGuardar: (cambios: Partial<PreguntaExamen>) => Promise<void> }) {
  const { avisar } = useCampos('avisar');
  const [q, setQ] = useState<PreguntaExamen>(() => structuredClone(p));
  const [guardando, setGuardando] = useState(false);
  const poner = (c: Partial<PreguntaExamen>) => setQ((x) => ({ ...x, ...c }));
  const lineas = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);
  const abierta = TIPOS_CON_RUBRICA.includes(q.tipo);
  const guardar = async () => {
    setGuardando(true);
    try {
      await onGuardar({
        ...q,
        elementos: q.elementos?.map((x) => x.trim()).filter(Boolean),
        categorias: q.categorias?.map((c) => ({ nombre: c.nombre.trim(), elementos: c.elementos.map((x) => x.trim()).filter(Boolean) })),
      });
    } catch (e) {
      avisar((e as Error).message, 'error');
      setGuardando(false);
    }
  };
  const etiqueta = 'block text-[12.5px] font-medium text-texto-2';
  return (
    <Modal abierto onCerrar={onCerrar} titulo={`Editar la pregunta (${nombreTipo(q.tipo).toLowerCase()})`} ancho="max-w-3xl">
      <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <div className="flex gap-3">
          <label className={cx(etiqueta, 'flex-1')}>
            Enunciado {(q.tipo === 'huecos' || q.tipo === 'banco') && <span className="font-normal text-texto-3">(marca {q.tipo === 'banco' ? 'cada hueco' : 'el hueco'} con ___)</span>}
            <AreaTexto rows={3} className="mt-1 text-[13px]" value={q.enunciado} onChange={(e) => poner({ enunciado: e.target.value })} />
          </label>
          <label className={cx(etiqueta, 'w-24 shrink-0')}>
            Puntos
            <Entrada type="number" min={0} step={0.25} className="mt-1" value={q.puntos} onChange={(e) => poner({ puntos: Number(e.target.value) || 0 })} />
          </label>
        </div>
        {(q.tipo === 'comentario' || q.tipo === 'datos' || q.tipo === 'tabla') && (
          <label className={etiqueta}>
            {q.tipo === 'comentario' ? 'Texto que se comenta' : q.tipo === 'tabla' ? 'Tabla (Markdown), con las casillas vacías marcadas con ___' : 'Datos o tabla (Markdown)'}
            <AreaTexto rows={5} className="mt-1 font-mono text-[12.5px]" value={q.material ?? ''} onChange={(e) => poner({ material: e.target.value })} />
          </label>
        )}
        {(q.tipo === 'test' || q.tipo === 'multiple') && (
          <div className="space-y-1">
            <div className={etiqueta}>Opciones ({q.tipo === 'multiple' ? 'marca todas las correctas' : 'marca la correcta'})</div>
            {(q.opciones ?? []).map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                {q.tipo === 'multiple' ? (
                  <input
                    type="checkbox"
                    className="accent-[var(--acento)]"
                    checked={!!q.correctas?.includes(i)}
                    onChange={(e) => poner({ correctas: e.target.checked ? [...(q.correctas ?? []), i] : (q.correctas ?? []).filter((c) => c !== i) })}
                    aria-label={`Opción ${LETRAS[i]} correcta`}
                  />
                ) : (
                  <input type="radio" name="correcta" className="accent-[var(--acento)]" checked={q.correcta === i} onChange={() => poner({ correcta: i })} aria-label={`Opción ${LETRAS[i]} correcta`} />
                )}
                <span className="w-4 text-[13px] text-texto-3">{LETRAS[i]})</span>
                <div className="min-w-0 flex-1">
                  <Entrada value={o} onChange={(e) => poner({ opciones: q.opciones!.map((x, k) => (k === i ? e.target.value : x)) })} />
                </div>
              </div>
            ))}
          </div>
        )}
        {(q.tipo === 'vf' || q.tipo === 'vfjustificada') && (
          <div className="flex gap-4 text-[13px]">
            {[true, false].map((v) => (
              <label key={String(v)} className="flex cursor-pointer items-center gap-1.5">
                <input type="radio" name="vf" className="accent-[var(--acento)]" checked={q.correcta === v} onChange={() => poner({ correcta: v })} />
                {v ? 'Verdadero' : 'Falso'}
              </label>
            ))}
          </div>
        )}
        {q.tipo === 'ordenar' && (
          <label className={etiqueta}>
            Elementos <span className="font-normal text-texto-3">(uno por línea, en el orden correcto: en el examen salen desordenados)</span>
            <AreaTexto rows={5} className="mt-1 text-[13px]" value={(q.elementos ?? []).join('\n')} onChange={(e) => poner({ elementos: e.target.value.split('\n') })} />
          </label>
        )}
        {q.tipo === 'clasificar' && (
          <div className="space-y-1.5">
            <div className={etiqueta}>Categorías y sus elementos <span className="font-normal text-texto-3">(separados por comas)</span></div>
            {(q.categorias ?? []).map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-44 shrink-0">
                  <Entrada value={c.nombre} placeholder="Categoría" onChange={(e) => poner({ categorias: q.categorias!.map((x, k) => (k === i ? { ...x, nombre: e.target.value } : x)) })} />
                </div>
                <div className="min-w-0 flex-1">
                  <Entrada
                    value={c.elementos.join(', ')}
                    onChange={(e) => poner({ categorias: q.categorias!.map((x, k) => (k === i ? { ...x, elementos: e.target.value.split(',').map((y) => y.trimStart()) } : x)) })}
                  />
                </div>
                <button className="rounded p-1 text-texto-3 hover:text-error cursor-pointer" onClick={() => poner({ categorias: q.categorias!.filter((_, k) => k !== i) })} aria-label="Quitar categoría">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            <Boton tam="sm" variante="fantasma" icono={<Plus className="size-3.5" />} onClick={() => poner({ categorias: [...(q.categorias ?? []), { nombre: '', elementos: [] }] })}>
              Categoría
            </Boton>
          </div>
        )}
        {q.tipo === 'numerica' && (
          <div className="flex flex-wrap gap-3">
            {(
              [
                ['valor', 'Resultado', 'any'],
                ['tolerancia', 'Margen admitido (±)', 'any'],
              ] as const
            ).map(([campo, nombre, paso]) => (
              <label key={campo} className={cx(etiqueta, 'w-40')}>
                {nombre}
                <Entrada type="number" step={paso} className="mt-1" value={q[campo] ?? ''} onChange={(e) => poner({ [campo]: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </label>
            ))}
            <label className={cx(etiqueta, 'w-40')}>
              Unidades
              <Entrada className="mt-1" value={q.unidades ?? ''} onChange={(e) => poner({ unidades: e.target.value })} />
            </label>
          </div>
        )}
        {q.tipo === 'banco' && (
          <label className={etiqueta}>
            Palabras de más <span className="font-normal text-texto-3">(una por línea; se mezclan con las de los huecos)</span>
            <AreaTexto rows={2} className="mt-1 text-[13px]" value={(q.opciones ?? []).join('\n')} onChange={(e) => poner({ opciones: lineas(e.target.value) })} />
          </label>
        )}
        {(q.tipo === 'corta' || q.tipo === 'huecos' || q.tipo === 'ejercicio' || q.tipo === 'error' || q.tipo === 'banco' || q.tipo === 'tabla') && (
          <label className={etiqueta}>
            {q.tipo === 'ejercicio'
              ? 'Resultado'
              : q.tipo === 'error'
                ? 'Versión corregida'
                : q.tipo === 'banco'
                  ? 'Palabra de cada hueco, en orden'
                  : q.tipo === 'tabla'
                    ? 'Contenido de cada casilla vacía, en orden'
                    : 'Respuestas aceptadas'}{' '}
            <span className="font-normal text-texto-3">(una por línea)</span>
            <AreaTexto rows={2} className="mt-1 text-[13px]" value={(q.respuestas ?? []).join('\n')} onChange={(e) => poner({ respuestas: lineas(e.target.value) })} />
          </label>
        )}
        {q.tipo === 'emparejar' && (
          <div className="space-y-1">
            <div className={etiqueta}>Parejas</div>
            {(q.pares ?? []).map((par, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Entrada value={par[0]} onChange={(e) => poner({ pares: q.pares!.map((x, k) => (k === i ? [e.target.value, x[1]] : x)) })} />
                </div>
                <span className="text-texto-3">→</span>
                <div className="min-w-0 flex-1">
                  <Entrada value={par[1]} onChange={(e) => poner({ pares: q.pares!.map((x, k) => (k === i ? [x[0], e.target.value] : x)) })} />
                </div>
                <button className="rounded p-1 text-texto-3 hover:text-error cursor-pointer" onClick={() => poner({ pares: q.pares!.filter((_, k) => k !== i) })} aria-label="Quitar pareja">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            <Boton tam="sm" variante="fantasma" icono={<Plus className="size-3.5" />} onClick={() => poner({ pares: [...(q.pares ?? []), ['', '']] })}>
              Pareja
            </Boton>
          </div>
        )}
        {abierta && (
          <label className={etiqueta}>
            {q.tipo === 'ejercicio' ? 'Resolución paso a paso' : 'Respuesta modelo'}
            <AreaTexto rows={5} className="mt-1 font-mono text-[12.5px]" value={q.solucion ?? ''} onChange={(e) => poner({ solucion: e.target.value })} />
          </label>
        )}
        <label className={etiqueta}>
          {q.tipo === 'vfjustificada' ? 'Justificación modelo' : q.tipo === 'definicion' ? 'Definición modelo' : q.tipo === 'error' ? 'Cuál es el error' : 'Explicación'}{' '}
          {abierta && <span className="font-normal text-texto-3">(opcional)</span>}
          <AreaTexto rows={2} className="mt-1 text-[13px]" value={q.explicacion ?? ''} onChange={(e) => poner({ explicacion: e.target.value })} />
        </label>
        {abierta && <EditorRubrica rubrica={q.rubrica ?? []} puntos={q.puntos} onCambio={(rubrica) => poner({ rubrica })} />}
        {abierta && (
          <label className={etiqueta}>
            Errores frecuentes <span className="font-normal text-texto-3">(uno por línea, con lo que restan)</span>
            <AreaTexto rows={2} className="mt-1 text-[13px]" value={(q.errores ?? []).join('\n')} onChange={(e) => poner({ errores: lineas(e.target.value) })} />
          </label>
        )}
        <label className={cx(etiqueta, 'w-64')}>
          Espacio para responder en papel <span className="font-normal text-texto-3">(líneas)</span>
          <Entrada
            type="number"
            min={0}
            max={40}
            className="mt-1"
            value={q.lineas ?? lineasDe(q)}
            onChange={(e) => poner({ lineas: e.target.value === '' ? undefined : Math.max(0, Math.min(40, Number(e.target.value) || 0)) })}
          />
        </label>
        <label className={etiqueta}>
          Criterios de evaluación <span className="font-normal text-texto-3">(separados por comas)</span>
          <Entrada
            className="mt-1"
            value={(q.criterios ?? []).join(', ')}
            onChange={(e) => poner({ criterios: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
          />
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Boton onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" icono={<FileCheck2 className="size-4" />} cargando={guardando} onClick={guardar}>
          Guardar
        </Boton>
      </div>
    </Modal>
  );
}

const NIVELES = ['Excelente', 'Adecuado', 'Insuficiente', 'No lo hace'];

function EditorRubrica({ rubrica, puntos, onCambio }: { rubrica: CriterioRubrica[]; puntos: number; onCambio: (r: CriterioRubrica[]) => void }) {
  const suma = rubrica.reduce((n, c) => n + (Number(c.puntos) || 0), 0);
  const cambiar = (i: number, c: Partial<CriterioRubrica>) => onCambio(rubrica.map((x, k) => (k === i ? { ...x, ...c } : x)));
  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2 text-[12.5px] font-medium text-texto-2">
        Rúbrica
        <span className={cx('font-normal', Math.abs(suma - puntos) < 0.001 ? 'text-texto-3' : 'text-aviso')}>
          (los criterios suman {fmtPuntos(suma)} de {fmtPuntos(puntos)} p; al guardar se ajustan a los puntos de la pregunta)
        </span>
      </div>
      {rubrica.map((c, i) => (
        <div key={i} className="space-y-1.5 rounded-lg border border-borde p-2.5">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Entrada className="font-medium" value={c.criterio} placeholder="Criterio" onChange={(e) => cambiar(i, { criterio: e.target.value })} />
            </div>
            <div className="w-20 shrink-0">
              <Entrada type="number" min={0} step={0.25} value={c.puntos} onChange={(e) => cambiar(i, { puntos: Number(e.target.value) || 0 })} aria-label="Puntos del criterio" />
            </div>
            <button className="rounded p-1 text-texto-3 hover:text-error cursor-pointer" onClick={() => onCambio(rubrica.filter((_, k) => k !== i))} aria-label="Quitar criterio">
              <Trash2 className="size-3.5" />
            </button>
          </div>
          {c.niveles.map((nv, k) => (
            <div key={k} className="flex items-start gap-2 pl-3">
              <div className="w-28 shrink-0">
                <Entrada className="text-[12.5px]" value={nv.nivel} onChange={(e) => cambiar(i, { niveles: c.niveles.map((x, j) => (j === k ? { ...x, nivel: e.target.value } : x)) })} aria-label="Nivel" />
              </div>
              <div className="min-w-0 flex-1">
                <AreaTexto rows={2} className="text-[12.5px]" value={nv.descripcion} onChange={(e) => cambiar(i, { niveles: c.niveles.map((x, j) => (j === k ? { ...x, descripcion: e.target.value } : x)) })} aria-label="Descripción del nivel" />
              </div>
              <div className="w-20 shrink-0">
                <Entrada
                  type="number"
                  min={0}
                  step={0.25}
                  className="text-[12.5px]"
                  value={nv.puntos}
                  onChange={(e) => cambiar(i, { niveles: c.niveles.map((x, j) => (j === k ? { ...x, puntos: Number(e.target.value) || 0 } : x)) })}
                  aria-label="Puntos del nivel"
                />
              </div>
            </div>
          ))}
        </div>
      ))}
      <Boton
        tam="sm"
        variante="fantasma"
        icono={<Plus className="size-3.5" />}
        onClick={() => onCambio([...rubrica, { criterio: '', puntos: 1, niveles: NIVELES.map((nivel, k) => ({ nivel, descripcion: '', puntos: [1, 0.5, 0.25, 0][k] })) }])}
      >
        Criterio
      </Boton>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Vista previa y exportación

type Vista = 'examen' | 'solucionario' | 'rubrica';

function ExamAdaptations({ subjectId, exam, onOpenExam }: { subjectId: string; exam: Examen; onOpenExam: (id: string) => void }) {
  const { avisar, versiones, reconexion } = useCampos('avisar', 'versiones', 'reconexion');
  const [showDialog, setShowDialog] = useState(false);
  const [kind, setKind] = useState<ExamAdaptationKind>('easy-reading');
  const [questionIds, setQuestionIds] = useState<string[]>([]);
  const [instructions, setInstructions] = useState('');
  const [creating, setCreating] = useState(false);
  const [copies, setCopies] = useState<Examen[]>([]);
  const jobs = useTrabajosExamen(subjectId);
  const busy = exam.estado === 'generando' || jobs.some((job) => job.ref === exam.id || job.ref?.startsWith(`${exam.id}/`));
  const version = `${versiones[`${subjectId}/`] ?? 0}-${reconexion}`;
  useEffect(() => {
    let current = true;
    api.examenes(subjectId).then((items) => {
      if (current) setCopies(items.filter((item) => item.adaptation?.sourceExamId === exam.id));
    }).catch((error) => avisar(error.message, 'error'));
    return () => { current = false; };
  }, [subjectId, exam.id, version, avisar]);
  const createAdaptation = async () => {
    setCreating(true);
    try {
      const copy = await api.adaptExam(subjectId, exam.id, { kind, questionIds, instructions });
      setShowDialog(false);
      if (copy.estado === 'error') avisar(copy.error ?? 'No se pudo generar la adaptación', 'error');
      else avisar(copy.estado === 'listo' ? 'Versión adaptada lista para revisar.' : 'Copia creada. La adaptación se está generando.', 'ok');
      onOpenExam(copy.id);
    } catch (error) {
      avisar((error as Error).message, 'error');
    } finally {
      setCreating(false);
    }
  };
  return (
    <Tarjeta titulo="Versiones adaptadas" ayuda="Crea una copia editable con su propio solucionario, rúbrica y exportación. Revisa el resultado antes de usarlo.">
      <p className="text-[13px] text-texto-2">Lectura fácil, con apoyos o ampliación. Puedes adaptar todas las preguntas o elegir algunas; las demás se conservan.</p>
      <Boton icono={<Sparkles className="size-4" />} disabled={busy || !exam.preguntas.length} onClick={() => {
        setQuestionIds(exam.preguntas.map((question) => question.id));
        setShowDialog(true);
      }}>Crear versión adaptada</Boton>
      {copies.length > 0 && <ul className="divide-y divide-borde">
        {copies.map((copy) => <li key={copy.id}>
          <button className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 py-2 text-left text-sm text-acento-texto cursor-pointer focus-visible:outline-2 focus-visible:outline-acento" onClick={() => onOpenExam(copy.id)}>
            <span>{copy.titulo}</span>
            <span className="text-xs text-texto-3">{copy.estado === 'generando' ? 'Generando…' : copy.error ? 'Revisar error' : 'Abrir y revisar'}</span>
          </button>
        </li>)}
      </ul>}
      {showDialog && <Modal abierto sinCerrar={creating} onCerrar={() => { if (!creating) setShowDialog(false); }} titulo="Crear versión adaptada" descripcion="Elige la adaptación y las preguntas. Se conservarán el orden, los tipos y los puntos en una copia independiente.">
        <div className="space-y-5">
          <fieldset className="space-y-2" disabled={creating}>
            <legend className="mb-2 text-sm font-medium">Tipo de adaptación</legend>
            {EXAM_ADAPTATIONS.map((variant) => <label key={variant.id} className={cx('flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3', kind === variant.id ? 'border-acento bg-acento-suave/50' : 'border-borde')}>
              <input type="radio" name="exam-adaptation-kind" value={variant.id} checked={kind === variant.id} onChange={() => setKind(variant.id)} className="mt-1 size-4 accent-[var(--acento)]" />
              <span><span className="block text-sm font-medium">{variant.name}</span><span className="block text-xs text-texto-2">{variant.description}</span></span>
            </label>)}
          </fieldset>
          <fieldset disabled={creating}>
            <legend className="mb-2 text-sm font-medium">Preguntas que se adaptarán ({questionIds.length} de {exam.preguntas.length})</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={questionIds.length === exam.preguntas.length} onChange={(event) => setQuestionIds(event.target.checked ? exam.preguntas.map((question) => question.id) : [])} className="size-4 accent-[var(--acento)]" />Seleccionar todas
            </label>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-borde px-3">
              {exam.preguntas.map((question, index) => <label key={question.id} className="flex min-h-11 cursor-pointer items-start gap-2 py-2 text-sm">
                <input type="checkbox" checked={questionIds.includes(question.id)} onChange={(event) => setQuestionIds((ids) => event.target.checked ? [...ids, question.id] : ids.filter((id) => id !== question.id))} className="mt-1 size-4 shrink-0 accent-[var(--acento)]" />
                <span>{index + 1}. {question.enunciado} <span className="text-xs text-texto-3">({fmtPuntos(question.puntos)} p)</span></span>
              </label>)}
            </div>
          </fieldset>
          <label className="block text-sm font-medium">Indicaciones adicionales <span className="font-normal text-texto-3">(opcional)</span>
            <AreaTexto className="mt-1" rows={3} maxLength={3000} disabled={creating} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Por ejemplo: una instrucción por frase; apoyos para organizar la respuesta. No incluyas datos personales del alumnado." />
          </label>
          <p className="text-xs text-texto-2">La IA preparará también las respuestas y la rúbrica de las preguntas adaptadas. La copia conservará la puntuación y las opciones de impresión.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Boton disabled={creating} onClick={() => setShowDialog(false)}>Cancelar</Boton>
            <Boton variante="primario" cargando={creating} disabled={creating || !questionIds.length} onClick={createAdaptation}>Crear y generar copia</Boton>
          </div>
        </div>
      </Modal>}
    </Tarjeta>
  );
}

function VistaYExportar({ a, ex, onCambio, onOpenExam }: { a: string; ex: Examen; onCambio: (ex: Examen) => void; onOpenExam: (id: string) => void }) {
  const { avisar } = useCampos('avisar');
  const [vista, setVista] = useState<Vista>('examen');
  const [modelo, setModelo] = useState<'A' | 'B'>('A');
  const [exportando, setExportando] = useState<string>();
  const [exportados, setExportados] = useState<Exportado[]>([]);
  const mostrado = useMemo(() => (ex.opciones.modeloB && modelo === 'B' ? modeloB(ex) : ex), [ex, modelo]);
  const texto = useMemo(
    () => (vista === 'examen' ? examenAMarkdown(mostrado) : vista === 'solucionario' ? solucionarioAMarkdown(mostrado) : rubricaAMarkdown(mostrado)),
    [vista, mostrado],
  );
  const op = ex.opciones;
  const opcion = (cambios: Partial<OpcionesExamen>) => api.guardarExamen(a, ex.id, { opciones: cambios }).then(onCambio).catch((e) => avisar((e as Error).message, 'error'));
  const conHoja = ex.preguntas.some((p) => p.tipo === 'test' || p.tipo === 'multiple' || p.tipo === 'vf');
  const cargar = useCallback(() => {
    api.exportadosExamen(a, ex.id).then(setExportados).catch(() => {});
  }, [a, ex.id]);
  useEffect(cargar, [cargar]);

  const exportar = async (formato: 'pdf' | 'docx' | 'odt' | 'moodle') => {
    setExportando(formato);
    try {
      if (formato === 'moodle') {
        const r = await api.exportarExamenMoodle(a, ex.id);
        avisar(`Exportado para Moodle: ${r.nombre}. En Moodle: Banco de preguntas › Importar › Formato GIFT.`, 'ok');
      } else {
        const r = await api.exportarExamen(a, ex.id, formato);
        avisar(`Exportados: ${r.map((x) => x.nombre).join(', ')}`, 'ok');
      }
      cargar();
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setExportando(undefined);
    }
  };

  return (
    <div className="space-y-4">
      <ExamAdaptations subjectId={a} exam={ex} onOpenExam={onOpenExam} />
      <Tarjeta titulo="Opciones de vista previa y exportación" ayuda="Se guardan para este examen y se aplican a la vista previa, PDF, Word y LibreOffice">
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['espacio', 'Incluir espacio para responder', 'Opcional: añade líneas o recuadros bajo las preguntas. La cantidad se ajusta al editar cada pregunta.', op.espacio === true, (v: boolean) => opcion({ espacio: v })],
              ['tablaNotas', 'Tabla de calificación', 'En la cabecera, con la puntuación máxima de cada parte y una casilla para la nota', op.tablaNotas !== false, (v: boolean) => opcion({ tablaNotas: v })],
              ['hojaRespuestas', 'Hoja de respuestas', conHoja ? 'Al final, para marcar con una X las de test y verdadero o falso' : 'Para las de test y verdadero o falso (este examen no tiene)', !!op.hojaRespuestas, (v: boolean) => opcion({ hojaRespuestas: v })],
              ['modeloB', 'Modelo B', 'Las mismas preguntas y opciones en otro orden, con su solucionario y su rúbrica', !!op.modeloB, (v: boolean) => opcion({ modeloB: v })],
            ] as const
          ).map(([id, nombre, ayuda, activo, cambiar]) => (
            <label key={id} className={cx('flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2', activo ? 'border-acento/50 bg-acento-suave/50' : 'border-borde')}>
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--acento)]" checked={activo} disabled={id === 'hojaRespuestas' && !conHoja} onChange={(e) => cambiar(e.target.checked)} />
              <span>
                <span className="block text-[13px] font-medium">{nombre}</span>
                <span className="block text-[11.5px] text-texto-3">{ayuda}</span>
              </span>
            </label>
          ))}
        </div>
      </Tarjeta>

      <Tarjeta titulo="Exportar" ayuda={op.modeloB ? 'Seis archivos: examen, solucionario y rúbrica de los modelos A y B' : 'Tres archivos: el examen, el solucionario y la rúbrica de corrección'}>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['pdf', 'PDF'],
              ['docx', 'Word'],
              ['odt', 'LibreOffice'],
            ] as const
          ).map(([f, nombre]) => (
            <Boton key={f} icono={<Download className="size-4" />} cargando={exportando === f} disabled={!!exportando} onClick={() => exportar(f)}>
              {nombre}
            </Boton>
          ))}
          <Boton
            variante="fantasma"
            icono={<Download className="size-4" />}
            cargando={exportando === 'moodle'}
            disabled={!!exportando}
            title="Las preguntas en formato GIFT, para el banco de preguntas de Moodle (Aules, EducaMadrid…)"
            onClick={() => exportar('moodle')}
          >
            Moodle
          </Boton>
          <Boton variante="fantasma" icono={<FolderOpen className="size-4" />} onClick={() => api.abrirCarpetaExamen(a, ex.id).catch((e) => avisar(e.message, 'error'))}>
            Abrir la carpeta
          </Boton>
        </div>
        {!!exportados.length && (
          <div className="divide-y divide-borde rounded-lg border border-borde">
            {exportados.map((f) => (
              <button
                key={f.nombre}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-panel-2 cursor-pointer"
                onClick={() => api.abrirExportadoExamen(a, ex.id, f.nombre).catch((e) => avisar(e.message, 'error'))}
              >
                <FileText className="size-3.5 text-acento-texto" />
                <span className="min-w-0 flex-1 truncate">{f.nombre}</span>
                <span className="text-[11.5px] text-texto-3">{fechaCorta(f.modificado)}</span>
              </button>
            ))}
          </div>
        )}
        <p className="text-[12px] text-texto-3">Word y LibreOffice usan la plantilla de la asignatura (pestaña «Plantillas»), si la tiene.</p>
      </Tarjeta>

      <div className="flex gap-1 border-b border-borde">
        {(
          [
            ['examen', 'Examen'],
            ['solucionario', 'Solucionario'],
            ['rubrica', 'Rúbrica de corrección'],
          ] as [Vista, string][]
        ).map(([k, txt]) => (
          <button
            key={k}
            onClick={() => setVista(k)}
            className={cx(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors cursor-pointer',
              vista === k ? 'border-acento text-acento-texto' : 'border-transparent text-texto-2 hover:text-texto',
            )}
          >
            {txt}
          </button>
        ))}
      </div>
      {op.modeloB && (
        <div className="inline-flex gap-0.5 rounded-lg bg-panel-2 p-0.5">
          {(['A', 'B'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setModelo(m)}
              className={cx('rounded-md px-3 py-1 text-[12.5px] cursor-pointer', modelo === m ? 'bg-panel font-medium text-texto shadow-sm' : 'text-texto-3 hover:text-texto')}
            >
              Modelo {m}
            </button>
          ))}
        </div>
      )}
      <div className="rounded-xl border border-borde bg-panel px-8 py-6">
        <h1 className="mb-4 text-xl font-semibold">
          {vista === 'examen' ? mostrado.titulo : vista === 'solucionario' ? `Solucionario: ${mostrado.titulo}` : `Rúbrica de corrección: ${mostrado.titulo}`}
        </h1>
        <VistaPrevia texto={texto} base={urlDatos(a, 'examenes', ex.id)} />
      </div>
    </div>
  );
}
