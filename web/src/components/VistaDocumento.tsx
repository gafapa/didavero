import { Suspense, lazy, memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpenText,
  Check,
  ChevronRight,
  Columns2,
  Copy,
  Download,
  Eye,
  FileText,
  History,
  Loader2,
  PencilLine,
  Plus,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { Documento, Permisos, Seccion } from '../../../shared/tipos';
import { permisosEfectivos } from '../../../shared/tipos';
import { loadSectionContents, type SectionContentCache } from '../lib/sectionContents';
import { EditorPermisos } from './EditorPermisos';
import { BotonAgente } from './flujo/comun';
import { api, urlDatos } from '../lib/api';
import { useEstado, useCampos } from '../lib/estado';
import { AreaTexto, Boton, BotonIcono, Campo, Entrada, Insignia, Vacio, confirmar, cx } from './ui';
import { GastoTokens } from './ContadorTokens';
// CodeMirror se carga al abrir el editor, no al arrancar la app
const Editor = lazy(() => import('./Editor').then((m) => ({ default: m.Editor })));
import { VistaPrevia } from './VistaPrevia';
import { GestorFuentes } from './GestorFuentes';
import { abreviar } from '../lib/formato';
import { ModalDuplicarDocumento } from './Gestion';
import { GaleriaRecursos } from './GaleriaRecursos';
import { HistorialSeccion } from './HistorialSeccion';
import { VistaPaso } from './flujo/VistaFlujo';
import { PASOS, useFlujoActual, useVistaDocumento } from './flujo/pasos';
import { ImportReviewModal } from './ImportNotes';

type Modo = 'editar' | 'dividido' | 'vista';
const TODO = '__todo__';

export function VistaDocumento({ asignatura, documento }: { asignatura: string; documento: string }) {
  const { asignaturas, seleccionar, avisar, cargarAsignaturas } = useCampos('asignaturas', 'seleccionar', 'avisar', 'cargarAsignaturas');
  const asig = asignaturas.find((a) => a.id === asignatura);
  const [doc, setDoc] = useState<Documento>();
  const [importOpen, setImportOpen] = useState(false);
  const flujo = useFlujoActual();
  const [vista, elegir] = useVistaDocumento();
  const irASeccion = useEstado((s) => s.irASeccion);

  // Desde el flujo se puede pedir abrir una sección concreta en el editor
  useEffect(() => {
    if (irASeccion) elegir('apuntes');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irASeccion]);

  useEffect(() => {
    let cancelado = false;
    const cargar = (intento = 0) =>
      api
        .documento(asignatura, documento)
        .then((d) => !cancelado && setDoc(d))
        .catch((e) => {
          if (cancelado) return;
          if (e.status === 404) {
            avisar(e.message, 'error');
            seleccionar({ asignatura });
          } else if (intento < 20) {
            setTimeout(() => cargar(intento + 1), 1000); // el servidor puede estar reiniciándose
          }
        });
    cargar();
    return () => {
      cancelado = true;
    };
  }, [asignatura, documento, avisar, seleccionar]);

  if (!doc || !asig || !flujo) return null;
  const destinatarios = doc.destinatarios.trim() || asig.destinatarios;
  const paso = PASOS.find((p) => p.id === vista);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-borde bg-panel px-5">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="truncate font-semibold">{doc.titulo}</span>
          <ChevronRight className="size-3.5 shrink-0 text-texto-3" />
          <span className="shrink-0 text-texto-2">{paso?.titulo ?? { apuntes: 'Apuntes', recursos: 'Imágenes', material: 'Fuentes', ficha: 'Ficha' }[vista as string]}</span>
          {destinatarios && (
            <Insignia color={doc.destinatarios.trim() ? 'acento' : 'neutro'} className="ml-2 max-w-80 truncate">
              <span className="truncate" title={`Destinatarios${doc.destinatarios.trim() ? ' propios de estos apuntes' : ' de la asignatura'}: ${destinatarios}`}>
                Para: {destinatarios}
              </span>
            </Insignia>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-4">
          {doc.importado && <Boton tam="sm" onClick={() => setImportOpen(true)}>Importación</Boton>}
          <GastoTokens asignatura={asignatura} documento={documento} etiqueta="Tokens" className="text-[12px]" />
          {vista !== 'exportar' && (
            <Boton tam="sm" icono={<Download className="size-3.5" />} onClick={() => elegir('exportar')}>
              Exportar
            </Boton>
          )}
        </div>
      </header>
      <ImportReviewModal assignment={asignatura} document={importOpen ? { id: documento, title: doc.titulo } : undefined} onClose={() => setImportOpen(false)} />

      {paso && <VistaPaso id={paso.id} a={asignatura} d={documento} estado={flujo.estado} trabajos={flujo.trabajos} recargar={flujo.recargar} onIr={elegir} />}
      {vista === 'apuntes' && <Apuntes asignatura={asignatura} documento={documento} />}
      {vista === 'recursos' && <GaleriaRecursos a={asignatura} d={documento} />}
      {vista === 'ficha' && (
        <div className="flex-1 overflow-y-auto">
          <FichaDocumento
            doc={doc}
            destinatariosAsignatura={asig.destinatarios}
            permisosAsignatura={asig.permisos}
            onGuardado={(d) => {
              setDoc(d);
              cargarAsignaturas();
            }}
          />
        </div>
      )}
      {vista === 'material' && (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-10 py-8">
            <GestorFuentes
              asignatura={asignatura}
              documento={documento}
              descripcion="Fuentes de consulta de estos apuntes (opcional): apuntes del profesor, diapositivas, artículos, imágenes… Los agentes las leen para investigar y redactar, pero no aparecen en los apuntes. Si no aportas nada, investigarán por su cuenta."
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Editor y vista previa. Con memo, los mensajes de los agentes (que cambian el flujo) no lo redibujan. */
const Apuntes = memo(function Apuntes({ asignatura, documento }: { asignatura: string; documento: string }) {
  const { avisar, versiones, reconexion } = useCampos('avisar', 'versiones', 'reconexion');
  // La selección de la vista previa es de este documento: al salir de él, se olvida
  useEffect(() => () => useEstado.setState({ seleccionTexto: undefined }), [asignatura, documento]);
  const version = `${versiones[`${asignatura}/${documento}`] ?? 0}-${reconexion}`; // también al reconectar con el servidor
  const [secciones, setSecciones] = useState<Seccion[]>([]);
  const [activa, setActiva] = useState<string>();
  const [texto, setTexto] = useState('');
  const [estadoGuardado, setEstadoGuardado] = useState<'guardado' | 'pendiente' | 'guardando'>('guardado');
  const [conflicto, setConflicto] = useState<string>();
  const [verHistorial, setVerHistorial] = useState(false);
  const [modo, setModo] = useState<Modo>(() => (localStorage.getItem('modoEditor') as Modo) || 'dividido');
  const [completo, setCompleto] = useState<{ archivo: string; texto: string }[]>([]);
  const completeCache = useRef<{ scope: string; cache: SectionContentCache }>({ scope: '', cache: new Map() });
  const guardadoRef = useRef(''); // último contenido sincronizado con el disco
  const textoRef = useRef(texto);
  textoRef.current = texto;
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);
  const base = urlDatos(asignatura, 'documentos', documento);

  const cargarSecciones = useCallback(async () => {
    const lista = await api.secciones(asignatura, documento);
    setSecciones(lista);
    return lista;
  }, [asignatura, documento]);

  // Carga inicial (o la sección pedida desde el flujo)
  useEffect(() => {
    cargarSecciones().then((l) => {
      const pedida = useEstado.getState().irASeccion;
      useEstado.setState({ irASeccion: undefined });
      setActiva(pedida && l.some((s) => s.archivo === pedida) ? pedida : l[0]?.archivo ?? TODO);
    });
  }, [cargarSecciones]);
  const irASeccion = useEstado((s) => s.irASeccion);
  useEffect(() => {
    if (!irASeccion) return;
    useEstado.setState({ irASeccion: undefined });
    cargarSecciones().then(() => setActiva(irASeccion));
  }, [irASeccion, cargarSecciones]);

  useEffect(() => {
    useEstado.setState({ seccionActiva: activa && activa !== TODO ? activa : undefined });
    return () => useEstado.setState({ seccionActiva: undefined });
  }, [activa]);

  // Cargar la sección activa
  useEffect(() => {
    setConflicto(undefined);
    if (!activa || activa === TODO) return;
    api
      .leerSeccion(asignatura, documento, activa)
      .then(({ contenido }) => {
        guardadoRef.current = contenido;
        setTexto(contenido);
        setEstadoGuardado('guardado');
      })
      .catch(() => setActiva(TODO));
  }, [asignatura, documento, activa]);

  // Documento completo
  useEffect(() => {
    if (activa !== TODO) return;
    let current = true;
    const scope = `${asignatura}/${documento}/${reconexion}`;
    const previous = completeCache.current.scope === scope ? completeCache.current.cache : new Map();
    loadSectionContents(secciones, previous, filename => api.leerSeccion(asignatura, documento, filename)).then(result => {
      if (!current) return;
      completeCache.current = { scope, cache: result.cache }; setCompleto(result.contents);
    }).catch(error => { if (current) avisar(error.message, 'error'); });
    return () => { current = false; };
  }, [activa, secciones, asignatura, documento, reconexion, avisar]);

  // Cambios en disco (normalmente, un agente escribiendo)
  useEffect(() => {
    if (!version) return;
    cargarSecciones().then((lista) => {
      if (!activa || activa === TODO) return;
      if (!lista.some((s) => s.archivo === activa)) {
        setActiva(lista[0]?.archivo ?? TODO);
        return;
      }
      api.leerSeccion(asignatura, documento, activa).then(({ contenido }) => {
        if (contenido === guardadoRef.current) return;
        if (textoRef.current === guardadoRef.current) {
          guardadoRef.current = contenido;
          setTexto(contenido);
        } else {
          setConflicto(contenido); // hay cambios sin guardar: que decida el usuario
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const guardar = useCallback(
    async (contenido: string, archivo: string) => {
      setEstadoGuardado('guardando');
      // Reintentos: el servidor puede estar reiniciándose (p. ej. en el modo «app en vivo»)
      for (let intento = 0; ; intento++) {
        try {
          await api.guardarSeccion(asignatura, documento, archivo, contenido);
          guardadoRef.current = contenido;
          setEstadoGuardado('guardado');
          return;
        } catch (e) {
          const status = (e as { status?: number }).status;
          if (intento < 10 && (status === undefined || status >= 500)) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          setEstadoGuardado('pendiente');
          avisar(`No se pudo guardar: ${(e as Error).message}`, 'error');
          return;
        }
      }
    },
    [asignatura, documento, avisar],
  );

  const alCambiar = (v: string) => {
    setTexto(v);
    setEstadoGuardado('pendiente');
    clearTimeout(temporizador.current);
    const archivo = activa!;
    temporizador.current = setTimeout(() => guardar(v, archivo), 700);
  };

  /** Guarda de inmediato lo pendiente (antes de cambiar de sección o renumerar archivos). */
  const vaciarPendiente = async () => {
    clearTimeout(temporizador.current);
    if (activa && activa !== TODO && texto !== guardadoRef.current) await guardar(texto, activa);
  };

  /** Tras renumerar, el archivo activo puede haber cambiado de prefijo: se busca por su nombre base. */
  const reubicar = (lista: Seccion[]) => {
    if (!activa || activa === TODO) return;
    const nombre = activa.replace(/^\d+-/, '');
    setActiva(lista.find((s) => s.archivo.replace(/^\d+-/, '') === nombre)?.archivo ?? lista[0]?.archivo ?? TODO);
  };

  const abrir = async (archivo: string) => {
    if (archivo === activa) return;
    await vaciarPendiente();
    setActiva(archivo);
  };

  const nuevaSeccion = async () => {
    const s = await api.crearSeccion(asignatura, documento, 'Nueva sección');
    await cargarSecciones();
    abrir(s.archivo);
  };

  const mover = async (i: number, delta: number) => {
    const orden = secciones.map((s) => s.archivo);
    const j = i + delta;
    if (j < 0 || j >= orden.length) return;
    [orden[i], orden[j]] = [orden[j], orden[i]];
    await vaciarPendiente();
    const nueva = await api.ordenarSecciones(asignatura, documento, orden);
    setSecciones(nueva);
    reubicar(nueva);
  };

  const eliminar = async (s: Seccion) => {
    if (!(await confirmar(`¿Eliminar la sección «${s.titulo}»?`, { texto: 'No se puede deshacer.', boton: 'Mover a la papelera', peligro: true }))) return;
    await vaciarPendiente();
    await api.eliminarSeccion(asignatura, documento, s.archivo);
    const lista = await cargarSecciones();
    if (activa === s.archivo) setActiva(lista[0]?.archivo ?? TODO);
    else reubicar(lista);
  };

  const cambiarModo = (m: Modo) => {
    setModo(m);
    localStorage.setItem('modoEditor', m);
  };

  const total = secciones.reduce((n, s) => n + s.palabras, 0);

  return (
    <div className="flex min-h-0 flex-1">
      {/* Índice de secciones */}
      <div className="flex w-60 shrink-0 flex-col border-r border-borde bg-panel/60">
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-[11px] font-semibold tracking-wider text-texto-3 uppercase">Secciones</span>
          <BotonIcono titulo="Nueva sección" onClick={nuevaSeccion}>
            <Plus className="size-4" />
          </BotonIcono>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          <button
            onClick={() => abrir(TODO)}
            className={cx(
              'mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] cursor-pointer',
              activa === TODO ? 'bg-acento-suave text-acento-texto font-medium' : 'text-texto-2 hover:bg-panel-2',
            )}
          >
            <BookOpenText className="size-4" />
            Apuntes completos
          </button>
          {secciones.map((s, i) => (
            <div
              key={s.archivo}
              className={cx(
                'group flex items-center rounded-lg transition-colors',
                activa === s.archivo ? 'bg-acento-suave' : 'hover:bg-panel-2',
              )}
            >
              <button onClick={() => abrir(s.archivo)} className="flex min-w-0 flex-1 items-baseline gap-2 px-2.5 py-2 text-left cursor-pointer">
                <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-texto-3">{i + 1}</span>
                <span className="min-w-0">
                  <span className={cx('block truncate text-[13px]', activa === s.archivo ? 'text-acento-texto font-medium' : 'text-texto')}>{s.titulo}</span>
                  <span className="text-[11px] text-texto-3">{s.palabras} palabras</span>
                </span>
              </button>
              <div className="hidden shrink-0 items-center pr-1 group-hover:flex">
                <BotonIcono titulo="Subir" className="size-6" disabled={i === 0} onClick={() => mover(i, -1)}>
                  <ArrowUp className="size-3" />
                </BotonIcono>
                <BotonIcono titulo="Bajar" className="size-6" disabled={i === secciones.length - 1} onClick={() => mover(i, 1)}>
                  <ArrowDown className="size-3" />
                </BotonIcono>
                <BotonIcono titulo="Eliminar sección" className="size-6 hover:text-error" onClick={() => eliminar(s)}>
                  <Trash2 className="size-3" />
                </BotonIcono>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-borde px-4 py-2.5 text-[11.5px] text-texto-3">
          {secciones.length} secciones · {total.toLocaleString('es')} palabras
        </div>
      </div>

      {/* Editor / vista previa */}
      <div className="flex min-w-0 flex-1 flex-col">
        {activa === TODO ? (
          <div className="flex-1 overflow-y-auto bg-panel px-10 py-10">
            {secciones.length === 0 ? (
              <Vacio
                icono={<FileText className="size-6" />}
                titulo="Los apuntes están vacíos"
                texto="Crea la primera sección o pide a la IA (panel de la derecha) que proponga un índice y redacte los apuntes."
                accion={
                  <Boton variante="primario" icono={<Plus className="size-4" />} onClick={nuevaSeccion}>
                    Nueva sección
                  </Boton>
                }
              />
            ) : (
              <div className="space-y-8">
                {completo.map((p) => (
                  <VistaPrevia key={p.archivo} texto={p.texto} base={base} seccion={p.archivo} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-borde px-3">
              <div className="flex items-center gap-0.5 rounded-lg bg-panel-2 p-0.5">
                {(
                  [
                    ['editar', PencilLine, 'Editar'],
                    ['dividido', Columns2, 'Dividido'],
                    ['vista', Eye, 'Vista previa'],
                  ] as const
                ).map(([m, Icono, txt]) => (
                  <button
                    key={m}
                    title={txt}
                    onClick={() => cambiarModo(m)}
                    className={cx(
                      'flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] transition-colors cursor-pointer',
                      modo === m ? 'bg-panel text-texto shadow-sm' : 'text-texto-3 hover:text-texto',
                    )}
                  >
                    <Icono className="size-3.5" />
                    {txt}
                  </button>
                ))}
              </div>
              <button
                title="Versiones anteriores de esta sección (y el original, si se importó)"
                onClick={() => setVerHistorial(true)}
                className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-texto-3 transition-colors hover:bg-panel-2 hover:text-texto cursor-pointer"
              >
                <History className="size-3.5" />
                Historial
              </button>
              <span className="flex items-center gap-1.5 text-xs text-texto-3">
                {estadoGuardado === 'guardando' && <Loader2 className="size-3 animate-spin" />}
                {estadoGuardado === 'guardado' && <Check className="size-3 text-ok" />}
                {estadoGuardado === 'guardado' ? 'Guardado' : estadoGuardado === 'guardando' ? 'Guardando…' : 'Sin guardar'}
              </span>
            </div>
            {conflicto !== undefined && (
              <div className="flex items-center gap-3 border-b border-aviso/30 bg-aviso/10 px-4 py-2 text-[13px]">
                <TriangleAlert className="size-4 shrink-0 text-aviso" />
                <span className="flex-1">Un agente ha modificado esta sección mientras la editabas.</span>
                <Boton
                  tam="sm"
                  onClick={() => {
                    clearTimeout(temporizador.current);
                    guardadoRef.current = conflicto;
                    setTexto(conflicto);
                    setEstadoGuardado('guardado');
                    setConflicto(undefined);
                  }}
                >
                  Cargar su versión
                </Boton>
                <Boton
                  tam="sm"
                  variante="fantasma"
                  onClick={() => {
                    setConflicto(undefined);
                    guardar(texto, activa!);
                  }}
                >
                  Mantener la mía
                </Boton>
              </div>
            )}
            <div className="flex min-h-0 flex-1">
              {modo !== 'vista' && (
                <div className={cx('min-w-0 bg-panel', modo === 'dividido' ? 'w-1/2 border-r border-borde' : 'flex-1')}>
                  <Suspense>
                    <Editor key={activa} valor={texto} onCambio={alCambiar} />
                  </Suspense>
                </div>
              )}
              {modo !== 'editar' && (
                <div className={cx('min-w-0 overflow-y-auto bg-panel px-8 py-6', modo === 'dividido' ? 'w-1/2' : 'flex-1')}>
                  <VistaPrevia texto={texto} base={base} seccion={activa} />
                </div>
              )}
            </div>
            {activa && activa !== TODO && (
              <HistorialSeccion
                a={asignatura}
                d={documento}
                archivo={activa}
                titulo={secciones.find((s) => s.archivo === activa)?.titulo ?? activa}
                actual={texto}
                abierto={verHistorial}
                onCerrar={() => setVerHistorial(false)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------

const TOPES: [number, string][] = [
  [0, 'Sin tope'],
  [2_000_000, '2 M'],
  [5_000_000, '5 M'],
  [10_000_000, '10 M'],
  [20_000_000, '20 M'],
  [50_000_000, '50 M'],
];

function FichaDocumento({
  doc,
  destinatariosAsignatura,
  permisosAsignatura,
  onGuardado,
}: {
  doc: Documento;
  destinatariosAsignatura: string;
  permisosAsignatura?: Permisos;
  onGuardado: (d: Documento) => void;
}) {
  const { avisar, seleccionar, cargarAsignaturas } = useCampos('avisar', 'seleccionar', 'cargarAsignaturas');
  const inicial = { titulo: doc.titulo, objetivo: doc.objetivo, destinatarios: doc.destinatarios, extension: doc.extension, permisos: doc.permisos ?? {}, presupuesto: doc.presupuesto ?? 0 };
  const gastado = useEstado((s) => Object.values(s.tokens?.porAsignatura?.[doc.asignatura]?.documentos[doc.id] ?? {}).reduce((n, t) => n + t.entrada + t.salida, 0));
  const [f, setF] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const [duplicando, setDuplicando] = useState(false);
  const cambiado = JSON.stringify(f) !== JSON.stringify(inicial);

  const guardar = async () => {
    setGuardando(true);
    try {
      onGuardado(await api.guardarDocumento(doc.asignatura, doc.id, f));
      avisar('Apuntes guardados', 'ok');
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  const eliminar = async () => {
    const ok = await confirmar(`¿Eliminar «${doc.titulo}»?`, {
      texto: 'Se moverán los apuntes completos a la papelera. Puedes recuperarlos en Inicio → Papelera.',
      boton: 'Mover a la papelera',
      peligro: true,
    });
    if (!ok) return;
    await api.eliminarDocumento(doc.asignatura, doc.id);
    await cargarAsignaturas();
    seleccionar({ asignatura: doc.asignatura });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-10 py-8">
      <Campo etiqueta="Título">
        <Entrada value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} />
      </Campo>
      <Campo etiqueta="Objetivo" ayuda="Qué deben saber o saber hacer al terminar de estudiarlo.">
        <AreaTexto rows={3} value={f.objetivo} onChange={(e) => setF({ ...f, objetivo: e.target.value })} />
      </Campo>
      <Campo
        etiqueta="Destinatarios de estos apuntes"
        ayuda={
          destinatariosAsignatura
            ? `Vacío = los de la asignatura: «${destinatariosAsignatura}». Rellénalo solo si estos apuntes van dirigidos a otras personas.`
            : 'Vacío = los de la asignatura.'
        }
      >
        <AreaTexto rows={2} value={f.destinatarios} onChange={(e) => setF({ ...f, destinatarios: e.target.value })} placeholder={destinatariosAsignatura} />
      </Campo>
      <Campo etiqueta="Extensión orientativa">
        <Entrada value={f.extension} onChange={(e) => setF({ ...f, extension: e.target.value })} placeholder="10-15 páginas" />
      </Campo>
      <Campo etiqueta="Qué pueden usar los agentes" ayuda="Por defecto, lo mismo que la asignatura. Cambia solo lo que estos apuntes necesiten distinto.">
        <EditorPermisos valor={f.permisos} onCambio={(permisos) => setF({ ...f, permisos })} heredados={permisosEfectivos(permisosAsignatura)} />
      </Campo>
      <Campo
        etiqueta="Tope de tokens"
        ayuda={`Al llegar a él no se lanzan más agentes en estos apuntes (los que estén trabajando terminan). Lleva gastados ${abreviar(gastado)} (entrada + salida).`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {TOPES.map(([n, nombre]) => (
            <button
              key={n}
              type="button"
              onClick={() => setF({ ...f, presupuesto: n })}
              className={cx(
                'rounded-lg border px-2.5 py-1 text-[13px] transition-colors cursor-pointer',
                f.presupuesto === n ? 'border-acento bg-acento-suave text-acento-texto' : 'border-borde hover:bg-panel-2',
                n > 0 && n <= gastado && 'text-texto-3 line-through',
              )}
            >
              {nombre}
            </button>
          ))}
          {f.presupuesto > 0 && (
            <span className={cx('ml-1 text-[12.5px]', gastado >= f.presupuesto ? 'font-medium text-error' : gastado >= f.presupuesto * 0.8 ? 'text-aviso' : 'text-texto-3')}>
              {gastado >= f.presupuesto ? 'Alcanzado' : `Quedan ${abreviar(f.presupuesto - gastado)}`}
            </span>
          )}
        </div>
      </Campo>
      <div className="flex justify-end gap-2">
        {cambiado && (
          <Boton variante="fantasma" onClick={() => setF(inicial)}>
            Descartar
          </Boton>
        )}
        <Boton variante="primario" disabled={!cambiado} cargando={guardando} onClick={guardar}>
          Guardar cambios
        </Boton>
      </div>
      {doc.importado && (
        <div className="mt-10 flex flex-wrap items-center gap-3 rounded-xl border border-borde px-5 py-4">
          <div className="min-w-60 flex-1">
            <div className="text-sm font-medium">Apuntes de partida</div>
            <p className="mt-0.5 text-[12.5px] text-texto-3">
              Importados de «{doc.importado.archivo}» el {new Date(doc.importado.fecha).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })} ·{' '}
              {doc.importado.modo === 'conservador' ? 'mejorando sobre el texto' : doc.importado.modo === 'reestructurar' ? 'reorganizándolos' : 'rehaciéndolos'}
              {doc.importado.estiloOriginal && ' · se exportan con su estilo'}.
              {doc.importado.modo === 'conservador' && ' En el historial de cada sección puedes compararla con el original.'}
            </p>
          </div>
          <Boton tam="sm" icono={<FileText className="size-3.5" />} onClick={() => api.abrirOriginal(doc.asignatura, doc.id).catch((e) => avisar(e.message, 'error'))}>
            Abrir el original
          </Boton>
        </div>
      )}
      <div className="mt-6 rounded-xl border border-borde px-5 py-4">
        <div className="text-sm font-medium">Versiones adaptadas</div>
        <p className="mt-0.5 text-[12.5px] text-texto-3">
          Atención a la diversidad: crea una copia de los apuntes (con sus imágenes y su índice) y un redactor adapta cada sección. El original no cambia.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ['lectura-facil', 'Lectura fácil', 'Frases cortas, vocabulario sencillo, lo esencial (pautas UNE 153101 EX)'],
              ['refuerzo', 'Refuerzo', 'Lo básico paso a paso, más ejemplos guiados y preguntas de comprobación'],
              ['ampliacion', 'Ampliación', 'Más profundidad, conexiones y retos de mayor dificultad'],
            ] as const
          ).map(([tipo, nombre, ayuda]) => (
            <span key={tipo} title={ayuda}>
              <BotonAgente
                texto={nombre}
                variante="secundario"
                icono={<Copy className="size-4" />}
                onLanzar={async (ind) => {
                  const r = await api.crearVersion(doc.asignatura, doc.id, tipo, ind);
                  await cargarAsignaturas();
                  avisar(`Creado «${r.documento.titulo}»: los agentes están adaptando ${r.trabajos} secciones.`, 'ok');
                  seleccionar({ asignatura: doc.asignatura, documento: r.documento.id });
                }}
                ayudaIndicaciones="Por ejemplo: para alumnado de 1.º de ESO con dificultades lectoras; sin ejercicios de desarrollo…"
              />
            </span>
          ))}
        </div>
      </div>
      <div className="mt-6 flex items-center justify-between rounded-xl border border-borde px-5 py-4">
        <div>
          <div className="text-sm font-medium">Duplicar apuntes</div>
          <div className="text-xs text-texto-3">Una copia en esta asignatura o en otra, para adaptarla a otro grupo o nivel.</div>
        </div>
        <Boton tam="sm" icono={<Copy className="size-3.5" />} onClick={() => setDuplicando(true)}>
          Duplicar
        </Boton>
      </div>
      <div className="flex items-center justify-between rounded-xl border border-error/30 px-5 py-4">
        <div>
          <div className="text-sm font-medium">Eliminar apuntes</div>
          <div className="text-xs text-texto-3">Se mueve a la papelera (se puede restaurar desde la pantalla de inicio).</div>
        </div>
        <Boton tam="sm" icono={<Trash2 className="size-3.5" />} onClick={eliminar} className="text-error">
          Eliminar
        </Boton>
      </div>
      <ModalDuplicarDocumento asignatura={doc.asignatura} documento={duplicando ? doc.id : undefined} titulo={doc.titulo} onCerrar={() => setDuplicando(false)} />
    </div>
  );
}
