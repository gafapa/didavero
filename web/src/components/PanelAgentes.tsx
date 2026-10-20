import { ENGINE_IDS, ENGINE_NAMES } from '../../../shared/engines';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, Clock, Crosshair, Image as IconoImagen, RotateCcw, TextSelect, X, ChevronDown, CircleStop, Eraser, Globe, FileEdit, Landmark, Library, Loader2, PanelRightClose, PanelRightOpen, Search, Send, Wrench } from 'lucide-react';
import type { EventoTrabajo, HerramientasChat, Motor, Trabajo } from '../../../shared/tipos';
import { api } from '../lib/api';
import { useEstado, useCampos } from '../lib/estado';
import { renderizar } from '../lib/markdown';
import { usePermisos } from '../lib/permisos';
import { PASOS, VISTAS_DOCUMENTO, useVistaDocumento } from './flujo/pasos';
import { Boton, BotonIcono, Insignia, cx } from './ui';
import { Estrella } from './Logo';
import { ParTokens } from './ContadorTokens';

/** Herramientas que se pueden activar para una petición desde el panel. */
const HERRAMIENTAS: { id: keyof HerramientasChat; nombre: string; corto: string; ayuda: string; icono: typeof Globe; porDefecto: boolean }[] = [
  { id: 'web', nombre: 'Buscar en la web', corto: 'Web', ayuda: 'Puede buscar y consultar páginas web', icono: Globe, porDefecto: true },
  {
    id: 'imagenes',
    nombre: 'Imágenes de museos y bibliotecas',
    corto: 'Imágenes',
    ayuda: 'Busca imágenes con licencia libre (Europeana, Met, Commons…) y las inserta con su crédito',
    icono: Landmark,
    porDefecto: false,
  },
  { id: 'fuentes', nombre: 'Buscar en tus fuentes', corto: 'Fuentes', ayuda: 'Consulta el material que has aportado (si está indexado)', icono: Library, porDefecto: true },
];

function leerHerramientas(): Required<HerramientasChat> {
  const base = Object.fromEntries(HERRAMIENTAS.map((h) => [h.id, h.porDefecto])) as Required<HerramientasChat>;
  try {
    return { ...base, ...JSON.parse(localStorage.getItem('herramientasChat') ?? '{}') };
  } catch {
    return base;
  }
}

export function PanelAgentes() {
  const { seleccion, trabajos, ajustes, motores, seccionActiva, seleccionTexto, avisar } = useCampos('seleccion', 'trabajos', 'ajustes', 'motores', 'seccionActiva', 'seleccionTexto', 'avisar');
  const [abierto, setAbierto] = useState(() => localStorage.getItem('panelAgentes') !== 'cerrado');
  const [tarea, setTarea] = useState('');
  const [motor, setMotor] = useState<Motor>();
  const [enviando, setEnviando] = useState(false);
  const [clearingFinished, setClearingFinished] = useState(false);
  const [soloEste, setSoloEste] = useState(true);
  const [herramientas, setHerramientas] = useState(leerHerramientas);
  // El agente solo actúa sobre la pestaña abierta en la zona central (y, en Apuntes, sobre la sección abierta)
  const [vista] = useVistaDocumento();
  const ambito = seleccion.documento ? { vista, seccion: vista === 'apuntes' ? seccionActiva : undefined } : undefined;
  const nombreAmbito = !ambito
    ? undefined
    : seleccionTexto
      ? undefined
      : ambito.vista === 'apuntes'
        ? ambito.seccion
          ? `Sección «${ambito.seccion.replace(/^\d+-/, '').replace(/\.md$/, '').replace(/-/g, ' ')}»`
          : 'Documento completo'
        : ([...PASOS, ...VISTAS_DOCUMENTO].find((p) => p.id === ambito.vista)?.titulo ?? ambito.vista);
  // Lo que la ficha no permite no se puede activar
  const permisos = usePermisos(seleccion.asignatura, seleccion.documento);
  const permitida: Record<keyof HerramientasChat, boolean> = { web: permisos.busquedaWeb, imagenes: permisos.busquedaImagenes, fuentes: permisos.fuentes };
  const activa = (id: keyof HerramientasChat) => !!herramientas[id] && permitida[id];
  const [menuHerramientas, setMenuHerramientas] = useState(false);
  const cajaHerramientas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuHerramientas) return;
    const fuera = (e: MouseEvent) => !cajaHerramientas.current?.contains(e.target as Node) && setMenuHerramientas(false);
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [menuHerramientas]);
  const alternarHerramienta = (id: keyof HerramientasChat) => {
    const n = { ...herramientas, [id]: !herramientas[id] };
    setHerramientas(n);
    try {
      localStorage.setItem('herramientasChat', JSON.stringify(n));
    } catch {}
  };
  const motorElegido = motor ?? ajustes?.motorPorDefecto ?? 'claude';
  const disponible = (m: Motor) => motores?.find((x) => x.motor === m)?.instalado ?? true;

  const lista = useMemo(
    () =>
      Object.values(trabajos)
        .filter((t) =>
          soloEste ? t.asignatura === seleccion.asignatura && (t.documento ?? '') === (seleccion.documento ?? '') : true,
        )
        .sort((a, b) => b.creado - a.creado),
    [trabajos, seleccion, soloEste],
  );
  const enCurso = Object.values(trabajos).filter((t) => t.estado === 'ejecutando' || t.estado === 'en-cola').length;
  const clearFinished = async () => {
    if (clearingFinished) return;
    const candidates = new Set(Object.values(trabajos).filter(job => job.estado !== 'en-cola' && job.estado !== 'ejecutando').map(job => job.id));
    setClearingFinished(true);
    try {
      const remaining = new Set((await api.limpiarTrabajos()).map(job => job.id));
      useEstado.setState(state => ({ trabajos: Object.fromEntries(Object.entries(state.trabajos).filter(([id]) => !candidates.has(id) || remaining.has(id))) }));
    } catch (error) {
      avisar((error as Error).message, 'error');
    } finally { setClearingFinished(false); }
  };

  const alternar = () => {
    const v = !abierto;
    setAbierto(v);
    localStorage.setItem('panelAgentes', v ? 'abierto' : 'cerrado');
  };

  // «Pedir cambios» en una figura de la vista previa: abrir el panel y escribir directamente
  const campo = useRef<HTMLTextAreaElement>(null);
  const enfocarChat = useEstado((s) => s.enfocarChat);
  useEffect(() => {
    if (!enfocarChat) return;
    setAbierto(true);
    localStorage.setItem('panelAgentes', 'abierto');
    requestAnimationFrame(() => campo.current?.focus());
  }, [enfocarChat]);

  const enviar = async () => {
    if (!tarea.trim() || !seleccion.asignatura) return;
    setEnviando(true);
    try {
      await api.lanzar({
        motor: motorElegido,
        tarea,
        asignatura: seleccion.asignatura,
        documento: seleccion.documento,
        seccion: seleccionTexto?.seccion ?? seccionActiva,
        herramientas,
        seleccionTexto,
        ambito,
      });
      setTarea('');
      useEstado.setState({ seleccionTexto: undefined });
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setEnviando(false);
    }
  };

  if (!abierto) {
    return (
      <div className="flex w-12 shrink-0 flex-col items-center gap-2 border-l border-borde bg-panel py-3">
        <BotonIcono titulo="Mostrar agentes" onClick={alternar}>
          <PanelRightOpen className="size-4" />
        </BotonIcono>
        {enCurso > 0 && (
          <span className="flex size-6 items-center justify-center rounded-full bg-acento text-[11px] font-semibold text-white" title={`${enCurso} en curso`}>
            {enCurso}
          </span>
        )}
      </div>
    );
  }

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-borde bg-panel">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-borde px-4">
        <Estrella className="size-4 text-estrella" />
        <h2 className="text-[17px] font-bold">Agentes</h2>
        {enCurso > 0 && <Insignia color="acento">{enCurso} en curso</Insignia>}
        <div className="ml-auto flex items-center">
          <BotonIcono titulo="Quitar terminados" onClick={clearFinished} disabled={clearingFinished}>
            {clearingFinished ? <Loader2 className="size-4 animate-spin" /> : <Eraser className="size-4" />}
          </BotonIcono>
          <BotonIcono titulo="Ocultar panel" onClick={alternar}>
            <PanelRightClose className="size-4" />
          </BotonIcono>
        </div>
      </div>

      <AvisoLimite />

      {/* Petición */}
      <div className="border-b border-borde p-3">
        {nombreAmbito && (
          <div className="mb-2 flex items-center gap-1.5 text-[12px] text-texto-3" title="El agente solo puede trabajar sobre lo que tienes abierto en la zona central">
            <Crosshair className="size-3.5 shrink-0 text-acento-texto" />
            Actúa sobre: <span className="truncate font-medium text-texto-2">{nombreAmbito}</span>
          </div>
        )}
        {seleccionTexto && (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-acento/30 bg-acento-suave px-2.5 py-1.5 text-[12px]">
            {seleccionTexto.figura ? <IconoImagen className="mt-0.5 size-3.5 shrink-0 text-acento-texto" /> : <TextSelect className="mt-0.5 size-3.5 shrink-0 text-acento-texto" />}
            <div className="min-w-0 flex-1">
              <div className="font-medium text-acento-texto">{seleccionTexto.figura ? 'Solo sobre esta figura' : 'Solo sobre la selección'}</div>
              <div className="line-clamp-2 text-texto-2" title={seleccionTexto.fragmento}>
                {seleccionTexto.texto || seleccionTexto.fragmento}
              </div>
            </div>
            <button
              className="shrink-0 rounded p-0.5 text-texto-3 hover:text-texto cursor-pointer"
              title="Quitar la selección (Esc)"
              onClick={() => useEstado.setState({ seleccionTexto: undefined })}
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
        <div className="relative rounded-2xl border border-borde bg-fondo focus-within:border-acento focus-within:ring-3 focus-within:ring-acento/15">
          <textarea
            ref={campo}
            value={tarea}
            onChange={(e) => setTarea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                enviar();
              }
            }}
            rows={3}
            placeholder={
              seleccionTexto?.figura
                ? '¿Qué cambio en la figura? (p. ej. «busca una imagen más clara», «marca Madrid en el mapa», «añade la leyenda», «mejora el pie»)'
                : seleccionTexto
                  ? '¿Qué hago con la selección? (p. ej. «simplifícalo», «añade un ejemplo», «¿qué significa?»)'
                  : seleccion.documento
                    ? '¿Qué quieres que hagan los agentes con este documento? Selecciona texto en la vista previa, o pulsa «Pedir cambios» sobre una figura, para actuar solo sobre eso.'
                  : '¿Qué quieres que hagan los agentes en esta asignatura?'
            }
            className="block w-full resize-none bg-transparent px-3 pt-2.5 text-sm outline-none placeholder:text-texto-3"
          />
          <div className="flex items-center gap-2 px-2 pb-2">
            <div className="flex items-center gap-0.5 rounded-lg bg-panel-2 p-0.5">
              {(ENGINE_IDS).map((m) => (
                <button
                  key={m}
                  disabled={!disponible(m)}
                  onClick={() => setMotor(m)}
                  title={disponible(m) ? undefined : 'No instalado'}
                  className={cx(
                    'rounded-md px-2 py-0.5 text-[12px] font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                    motorElegido === m ? 'bg-panel text-texto shadow-sm' : 'text-texto-3 hover:text-texto',
                  )}
                >
                  {ENGINE_NAMES[m]}
                </button>
              ))}
            </div>
            <div ref={cajaHerramientas}>
              <button
                onClick={() => setMenuHerramientas(!menuHerramientas)}
                title="Herramientas que puede usar el agente en esta petición"
                className={cx(
                  'flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px] transition-colors cursor-pointer',
                  menuHerramientas ? 'bg-panel-2 text-texto' : 'text-texto-3 hover:bg-panel-2 hover:text-texto',
                )}
              >
                <Wrench className="size-3.5" />
                {HERRAMIENTAS.filter((h) => activa(h.id)).map((h) => (
                  <h.icono key={h.id} className="size-3.5 text-acento-texto" aria-label={h.corto} />
                ))}
              </button>
              {menuHerramientas && (
                <div className="aparecer absolute top-full right-0 left-0 z-30 mt-1.5 rounded-xl border border-borde bg-panel p-1.5 shadow-suave">
                  <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-texto-3 uppercase">Herramientas</div>
                  {HERRAMIENTAS.map((h) => (
                    <button
                      key={h.id}
                      disabled={!permitida[h.id]}
                      onClick={() => alternarHerramienta(h.id)}
                      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-panel-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                      <h.icono className={cx('mt-0.5 size-4 shrink-0', activa(h.id) ? 'text-acento-texto' : 'text-texto-3')} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px]">{h.nombre}</span>
                        <span className="block text-[11.5px] leading-snug text-texto-3">
                          {permitida[h.id] ? h.ayuda : 'Desactivada en la ficha de la asignatura o del documento'}
                        </span>
                      </span>
                      <span
                        className={cx(
                          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                          activa(h.id) ? 'border-acento bg-acento text-white' : 'border-borde',
                        )}
                      >
                        {activa(h.id) && <Check className="size-3" />}
                      </span>
                    </button>
                  ))}
                  <p className="px-2 pt-1 pb-0.5 text-[11px] leading-snug text-texto-3">Leer y editar los apuntes está siempre disponible. Cada herramienta añade algo de consumo de tokens.</p>
                </div>
              )}
            </div>
            <button
              onClick={enviar}
              disabled={!tarea.trim() || enviando}
              title="Enviar (Ctrl+Enter)"
              className="ml-auto flex size-9 items-center justify-center rounded-xl bg-acento text-white transition-colors hover:bg-acento-2 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
            >
              {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-[11.5px] font-bold tracking-wider text-texto-3 uppercase">Actividad</span>
        <button onClick={() => setSoloEste(!soloEste)} className="text-[11.5px] text-texto-3 hover:text-acento-texto cursor-pointer">
          {soloEste ? 'Ver todo' : `Solo ${seleccion.documento ? 'este documento' : 'esta asignatura'}`}
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-4">
        {lista.length === 0 && (
          <div className="flex flex-col items-center px-6 py-10 text-center text-[13px] text-texto-3">
            <Bot className="mb-2 size-8 opacity-50" />
            Aquí verás en directo lo que hace cada agente.
          </div>
        )}
        {lista.map((t) => (
          <TarjetaTrabajo key={t.id} t={t} />
        ))}
      </div>
    </aside>
  );
}

const NOMBRE_MOTOR: Record<Motor, string> = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode' };

function horaCorta(ms: number) {
  const d = new Date(ms);
  const hoy = d.toDateString() === new Date().toDateString();
  return d.toLocaleString('es', hoy ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Motores con el límite de uso de la suscripción agotado: sus agentes esperan y siguen solos. */
function AvisoLimite() {
  const { uso, trabajos, avisar } = useCampos('uso', 'trabajos', 'avisar');
  const pausas = Object.entries(uso?.pausas ?? {}).filter(([, hasta]) => hasta && hasta > Date.now()) as [Motor, number][];
  if (!pausas.length) return null;
  return (
    <div role="status" className="mx-3 mt-3 space-y-2.5 rounded-2xl bg-aviso/12 px-4 py-3 text-[13px]">
      {pausas.map(([m, hasta]) => {
        const esperando = Object.values(trabajos).filter((t) => t.motor === m && t.estado === 'en-cola').length;
        return (
          <div key={m} className="flex items-start gap-2">
            <Clock className="mt-0.5 size-4 shrink-0 text-aviso" />
            <div className="min-w-0 flex-1">
              <b>Límite de uso de {NOMBRE_MOTOR[m]} agotado.</b>{' '}
              {esperando ? `${esperando === 1 ? 'Un agente espera' : `${esperando} agentes esperan`} y seguirá${esperando === 1 ? '' : 'n'}` : 'Los agentes seguirán'} solos a las {horaCorta(hasta)}.
            </div>
          </div>
        );
      })}
      <Boton
        tam="sm"
        title="Por ejemplo, si has ampliado tu plan o comprado más uso"
        onClick={() => api.reanudarCola().catch((e) => avisar((e as Error).message, 'error'))}
      >
        Seguir ya, sin esperar
      </Boton>
    </div>
  );
}

/** Markdown de un mensaje del agente; solo se vuelve a convertir si cambia el texto. */
const TextoMarkdown = memo(function TextoMarkdown({ texto, className }: { texto: string; className: string }) {
  const html = useMemo(() => renderizar(texto), [texto]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});

function duracion(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** Tarjeta de un trabajo; con memo, cada mensaje de un agente solo redibuja la suya. */
const TarjetaTrabajo = memo(function TarjetaTrabajo({ t }: { t: Trabajo }) {
  const { uso, avisar } = useCampos('uso', 'avisar');
  const activo = t.estado === 'ejecutando' || t.estado === 'en-cola';
  const pausa = t.estado === 'en-cola' ? uso?.pausas?.[t.motor] : undefined;
  const reintentar = () => api.reintentar(t.id).catch((e) => avisar((e as Error).message, 'error'));
  const [abierto, setAbierto] = useState(activo);
  useEffect(() => {
    if (activo) setAbierto(true);
  }, [activo]);
  const [, refrescar] = useState(0);
  const finRef = useRef<HTMLDivElement>(null);

  // Cronómetro mientras se ejecuta
  useEffect(() => {
    if (t.estado !== 'ejecutando') return;
    const i = setInterval(() => refrescar((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, [t.estado]);

  // Si se abre un trabajo antiguo (sin eventos cargados), pedirlos al servidor
  useEffect(() => {
    if (abierto && t.eventos.length === 0 && !activo) {
      api.trabajo(t.id).then((c) => useEstado.setState((s) => ({ trabajos: { ...s.trabajos, [t.id]: c } }))).catch(() => {});
    }
  }, [abierto, t.id, t.eventos.length, activo]);

  useEffect(() => {
    if (abierto && activo) finRef.current?.scrollIntoView({ block: 'nearest' });
  }, [t.eventos.length, abierto, activo]);

  const tiempo = t.inicio ? duracion((t.fin ?? Date.now()) - t.inicio) : '';
  const herramientas = t.eventos.filter((e) => e.tipo === 'herramienta');
  const ultima = herramientas[herramientas.length - 1];

  return (
    <div className={cx('aparecer rounded-2xl border bg-panel transition-colors', activo ? 'border-acento/40' : 'border-borde')}>
      <button onClick={() => setAbierto(!abierto)} className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left cursor-pointer">
        <EstadoIcono estado={t.estado} />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[13.5px] leading-snug font-semibold">{t.titulo}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 whitespace-nowrap text-[11.5px] text-texto-3">
            <span>{t.nombreAgente}</span>·<span>{ENGINE_NAMES[t.motor]}</span>
            {tiempo && <>· <span className="tabular-nums">{tiempo}</span></>}
            {t.tokens && (
              <>
                · <ParTokens t={t.tokens} />
              </>
            )}
          </div>
          {pausa && pausa > Date.now() ? (
            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-aviso/12 px-2.5 py-0.5 text-[12px] font-semibold text-aviso">
              <Clock className="size-3" />
              En pausa hasta las {horaCorta(pausa)}
            </span>
          ) : (
            activo && ultima && !abierto && !t.inactivo && <div className="mt-1 truncate text-[11.5px] text-acento-texto">{ultima.texto}</div>
          )}
          {t.inactivo && t.estado === 'ejecutando' && !abierto && (
            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-aviso/12 px-2.5 py-0.5 text-[12px] font-semibold text-aviso">
              Sin señales desde las {horaCorta(t.inactivo)}
            </span>
          )}
        </div>
        {t.estado === 'error' && !abierto && <Insignia color="error">Ha fallado</Insignia>}
        <ChevronDown className={cx('mt-0.5 size-4 shrink-0 text-texto-3 transition-transform', abierto && 'rotate-180')} />
      </button>

      {abierto && (
        <div className="border-t border-borde px-3.5 py-3">
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {t.eventos.map((e, i) => (
              <FilaEvento key={i} e={e} resultado={t.resultado} />
            ))}
            <div ref={finRef} />
          </div>
          {t.resultado && (
            <TextoMarkdown texto={t.resultado} className="apunte mt-3 rounded-lg bg-panel-2 px-3 py-2 !text-[13px] !leading-relaxed" />
          )}
          {t.inactivo && t.estado === 'ejecutando' && (
            <div className="mt-3 rounded-xl bg-aviso/12 px-3 py-2.5 text-[12.5px]">
              <p>
                No da señales desde las {horaCorta(t.inactivo)}. Puede estar preparando una respuesta larga o haberse quedado bloqueado.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Boton tam="sm" variante="primario" onClick={() => api.seguirEsperando(t.id)}>
                  Seguir esperando
                </Boton>
                <Boton tam="sm" onClick={reintentar}>
                  Detener y empezar de nuevo
                </Boton>
              </div>
            </div>
          )}
          {!activo && t.sesion && <Responder id={t.id} />}
          {activo && (
            <button
              onClick={() => api.cancelar(t.id)}
              className="mt-2 flex items-center gap-1.5 text-[12px] text-texto-3 hover:text-error cursor-pointer"
            >
              <CircleStop className="size-3.5" />
              Detener
            </button>
          )}
          {(t.estado === 'error' || t.estado === 'cancelado') && (
            <Boton
              tam="sm"
              variante={t.estado === 'error' ? 'primario' : 'secundario'}
              onClick={reintentar}
              title="Vuelve a lanzar la tarea desde el principio, como una nueva"
              icono={<RotateCcw className="size-3.5" />}
              className="mt-3"
            >
              Reintentar desde el principio
            </Boton>
          )}
        </div>
      )}
    </div>
  );
});

function Responder({ id }: { id: string }) {
  const { avisar } = useCampos('avisar');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    if (!texto.trim()) return;
    setEnviando(true);
    try {
      await api.responder(id, texto);
      setTexto('');
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div className="mt-2.5 flex items-end gap-1.5 rounded-xl border border-borde bg-fondo p-1.5 focus-within:border-acento">
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            enviar();
          }
        }}
        rows={1}
        placeholder="Responder al agente…"
        className="field-sizing-content max-h-32 min-h-6 flex-1 resize-none bg-transparent px-1.5 py-0.5 text-[12.5px] outline-none placeholder:text-texto-3"
      />
      <button
        onClick={enviar}
        disabled={!texto.trim() || enviando}
        title="Enviar (Intro)"
        className="flex size-6 items-center justify-center rounded-md bg-acento text-white disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
      >
        {enviando ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
      </button>
    </div>
  );
}

/** Un evento del trabajo (los que ya estaban no se redibujan al llegar uno nuevo). */
const FilaEvento = memo(function FilaEvento({ e, resultado }: { e: EventoTrabajo; resultado?: string }) {
  if (e.tipo === 'usuario') {
    return <div className="my-2 ml-8 rounded-lg rounded-br-sm bg-acento px-3 py-1.5 text-[12.5px] whitespace-pre-wrap text-white">{e.texto}</div>;
  }
  if (e.tipo === 'texto') {
    return e.texto === resultado?.trim() ? null : <TextoMarkdown texto={e.texto} className="apunte !text-[12.5px] !leading-snug [&_p]:my-1" />;
  }
  return (
    <div className={cx('flex items-start gap-2 text-[12px]', e.tipo === 'error' ? 'text-error' : 'text-texto-2')}>
      <IconoEvento texto={e.texto} tipo={e.tipo} />
      <span className="min-w-0 break-words whitespace-pre-wrap">{e.texto}</span>
    </div>
  );
});

function EstadoIcono({ estado }: { estado: Trabajo['estado'] }) {
  const base = 'mt-0.5 size-4 shrink-0';
  if (estado === 'ejecutando') return <Loader2 className={cx(base, 'animate-spin text-acento-texto')} />;
  if (estado === 'en-cola') return <span className={cx(base, 'rounded-full border-2 border-dashed border-texto-3')} title="En cola" />;
  const color = estado === 'ok' ? 'bg-ok' : estado === 'error' ? 'bg-error' : 'bg-texto-3';
  return (
    <span className={cx(base, 'flex items-center justify-center')}>
      <span className={cx('size-2.5 rounded-full', color)} />
    </span>
  );
}

function IconoEvento({ texto, tipo }: { texto: string; tipo: string }) {
  const c = 'mt-0.5 size-3.5 shrink-0';
  if (tipo === 'estado') return <span className={cx(c, 'flex items-center justify-center')}><span className="size-1.5 rounded-full bg-texto-3" /></span>;
  if (/^Buscando en la web|^Consultando/.test(texto)) return <Globe className={cx(c, 'text-sky-500')} />;
  if (/^Buscando en tus fuentes|^Repasando la lista de fuentes/.test(texto)) return <Search className={cx(c, 'text-ok')} />;
  if (/^(Escribiendo|Editando|Modificando)/.test(texto)) return <FileEdit className={cx(c, 'text-acento-texto')} />;
  return <Wrench className={cx(c, 'text-texto-3')} />;
}
