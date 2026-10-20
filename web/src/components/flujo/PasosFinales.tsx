import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Atom,
  ChartLine,
  Map as MapIcon,
  Check,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  ImagePlus,
  Loader2,
  Network,
  RefreshCw,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import type { EstadoFlujo, ImagenFallida, MezclaVisuales, OpcionesExportacion, PropuestaVisual, TipoVisual, Trabajo } from '../../../../shared/tipos';
import { api, urlDatos } from '../../lib/api';
import { VistaPrevia } from '../VistaPrevia';
import { useEstado, useCampos } from '../../lib/estado';
import { exportarDocumento } from '../../lib/exportacion';
import { AreaTexto, Boton, Entrada, Insignia, cx } from '../ui';
import { ActividadAgente, BotonAgente, Paso, fechaCorta, trabajosDe } from './comun';
import { irASeccion } from './PasosEscritura';
import { usePermisos } from '../../lib/permisos';

interface Props {
  a: string;
  d: string;
  estado: EstadoFlujo;
  trabajos: Trabajo[];
  recargar: () => void;
}

const TIPOS: { id: TipoVisual; nombre: string; icono: typeof Network; ayuda: string }[] = [
  { id: 'diagrama', nombre: 'Diagrama', icono: Network, ayuda: 'Esquema dibujado con Mermaid' },
  { id: 'grafica', nombre: 'Gráfica', icono: ChartLine, ayuda: 'Funciones, datos, climogramas, pirámides de población' },
  { id: 'mapa', nombre: 'Mapa', icono: MapIcon, ayuda: 'Político, físico, de datos o histórico, con rutas y símbolos (también mudo)' },
  { id: 'molecula', nombre: 'Molécula', icono: Atom, ayuda: 'Fórmula estructural dibujada con los datos de PubChem' },
  { id: 'imagen-web', nombre: 'Imagen web', icono: Globe, ayuda: 'Imagen real con licencia libre' },
  { id: 'imagen-ia', nombre: 'Imagen IA', icono: Sparkles, ayuda: 'Generada con Codex' },
];

export function PasoVisuales({ a, d, estado, trabajos, recargar }: Props) {
  const { motores, avisar } = useCampos('motores', 'avisar');
  const conCodex = !!motores?.find((m) => m.motor === 'codex' && m.instalado && m.sesion);
  const director = trabajosDe(trabajos, 'visuales', (t) => t.ref === 'director');
  const propuestas = estado.visuales.filter((p) => p.estado !== 'descartada' && p.estado !== 'insertada');
  const insertadas = estado.visuales.filter((p) => p.estado === 'insertada');
  const titulos = useMemo(() => new Map(estado.secciones.map((s) => [s.archivo, s.titulo])), [estado.secciones]);
  const listas = propuestas.filter((p) => p.estado === 'propuesta' || p.estado === 'error');
  const [mezcla, setMezcla] = useState<MezclaVisuales>(() => {
    try {
      return (localStorage.getItem('mezclaVisuales') as MezclaVisuales) || 'equilibrado';
    } catch {
      return 'equilibrado';
    }
  });
  const elegirMezcla = (m: MezclaVisuales) => {
    setMezcla(m);
    try {
      localStorage.setItem('mezclaVisuales', m);
    } catch {}
  };

  const generarTodas = async () => {
    for (const p of listas) {
      await api.generarVisual(a, d, p.id).catch((e) => avisar(e.message, 'error'));
    }
    recargar();
  };

  return (
    <Paso
      numero={5}
      titulo="Imágenes, esquemas y diagramas"
      opcional
      hecho={insertadas.length > 0 && propuestas.length === 0}
      trabajando={director.length > 0 || propuestas.some((p) => p.estado === 'generando')}
      descripcion="Genera los visuales y revísalos aquí. Solo se incorporan a los apuntes cuando pulses Aceptar."
      acciones={
        <BotonAgente
          texto="Buscar dónde hacen falta"
          variante={propuestas.length ? 'secundario' : 'primario'}
          icono={<ImagePlus className="size-4" />}
          disabled={director.length > 0 || !estado.secciones.length}
          onLanzar={(ind) => api.proponerVisuales(a, d, undefined, ind, mezcla)}
          estimacion={[['director-visual', 1]]}
          ayudaIndicaciones="Por ejemplo: nada de imágenes IA, fotos de los equipos reales, como mucho 5 visuales…"
        />
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-texto-2">
          <span>Qué debe proponer el director visual:</span>
          <div className="flex gap-0.5 rounded-lg bg-panel-2 p-0.5">
            {(
              [
                ['imagenes', 'Más imágenes', 'Sobre todo imágenes reales; diagramas solo para procesos'],
                ['equilibrado', 'Equilibrado', 'Imágenes para lo que se puede ver, diagramas para lo abstracto'],
                ['esquemas', 'Más esquemas', 'Sobre todo diagramas; imágenes solo cuando haya que ver algo real'],
              ] as [MezclaVisuales, string, string][]
            ).map(([id, texto, ayuda]) => (
              <button
                key={id}
                title={ayuda}
                onClick={() => elegirMezcla(id)}
                className={cx(
                  'whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] transition-colors cursor-pointer',
                  mezcla === id ? 'bg-panel text-texto shadow-sm' : 'text-texto-3 hover:text-texto',
                )}
              >
                {texto}
              </button>
            ))}
          </div>
        </div>
        {director.map((t) => (
          <ActividadAgente key={t.id} t={t} />
        ))}
        {listas.length > 1 && (
          <div className="flex items-center">
            <span className="text-sm font-medium">{propuestas.length} propuestas</span>
            <Boton tam="sm" className="ml-auto" icono={<Wand2 className="size-3.5" />} onClick={generarTodas}>
              Generar todas
            </Boton>
          </div>
        )}
        {propuestas.map((p) => (
          <TarjetaPropuesta
            key={p.id}
            a={a}
            d={d}
            p={p}
            seccion={titulos.get(p.seccion) ?? p.seccion}
            conCodex={conCodex}
            trabajo={trabajos.find((t) => t.ref === p.id && (t.estado === 'ejecutando' || t.estado === 'en-cola'))}
            recargar={recargar}
          />
        ))}
        {insertadas.length > 0 && (
          <div className="text-[12.5px] text-texto-3">
            <div className="mb-1 font-medium text-texto-2">Insertados ({insertadas.length})</div>
            {insertadas.map((p) => (
              <button
                key={p.id}
                onClick={() => irASeccion(p.seccion)}
                className="flex w-full items-center gap-2 py-0.5 text-left hover:text-acento-texto cursor-pointer"
              >
                <Check className="size-3.5 text-ok" />
                <span className="truncate">{p.titulo}</span>
                <span className="shrink-0">· {titulos.get(p.seccion)}</span>
              </button>
            ))}
            <button className="mt-1 hover:text-acento-texto cursor-pointer" onClick={() => api.limpiarVisuales(a, d).then(recargar)}>
              Limpiar historial
            </button>
          </div>
        )}
        <AvisoImagenes a={a} d={d} estado={estado} soloFaltan />
        {!propuestas.length && !insertadas.length && !director.length && (
          <p className="text-[13px] text-texto-3">Las imágenes insertadas se pueden ver y gestionar en la pestaña Imágenes.</p>
        )}
      </div>
    </Paso>
  );
}

function TarjetaPropuesta({
  a,
  d,
  p,
  seccion,
  conCodex,
  trabajo,
  recargar,
}: {
  a: string;
  d: string;
  p: PropuestaVisual;
  seccion: string;
  conCodex: boolean;
  trabajo?: Trabajo;
  recargar: () => void;
}) {
  const { avisar } = useCampos('avisar');
  const permisos = usePermisos(a, d);
  const tipoPermitido: Record<TipoVisual, boolean> = {
    diagrama: permisos.diagramas,
    grafica: permisos.diagramas,
    mapa: permisos.diagramas,
    molecula: permisos.moleculas,
    'imagen-web': permisos.imagenesWeb,
    'imagen-ia': permisos.imagenesIA,
  };
  const [titulo, setTitulo] = useState(p.titulo);
  const [descripcion, setDescripcion] = useState(p.descripcion);
  const [molecula, setMolecula] = useState(p.molecula ?? '');
  const generando = p.estado === 'generando';
  const ready = p.estado === 'generada' && !!p.markdown;
  const [busy, setBusy] = useState(false);

  const guardar = (cambios: Partial<PropuestaVisual>) =>
    api.editarPropuesta(a, d, p.id, cambios).then(recargar).catch((e) => avisar(e.message, 'error'));

  const generar = async () => {
    setBusy(true);
    try {
      if (titulo !== p.titulo || descripcion !== p.descripcion || molecula !== (p.molecula ?? '')) {
        await api.editarPropuesta(a, d, p.id, { titulo, descripcion, molecula });
      }
      await api.generarVisual(a, d, p.id);
      recargar();
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      await api.approveVisual(a, d, p.id);
      recargar();
      avisar('Visual aceptado e incorporado al documento', 'ok');
    } catch (error) {
      avisar((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx('aparecer rounded-lg border bg-fondo/40 p-3', generando ? 'border-acento/40' : 'border-borde')}>
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <button onClick={() => irASeccion(p.seccion)} className="min-w-0 flex-1 basis-40 truncate text-left text-[12px] text-texto-3 hover:text-acento-texto cursor-pointer">
          {seccion}
        </button>
        <div className="ml-auto flex max-w-full flex-wrap gap-0.5 rounded-lg bg-panel-2 p-0.5">
          {TIPOS.map((t) => {
            const deshabilitado = generando || busy || ready || (t.id === 'imagen-ia' && !conCodex) || !tipoPermitido[t.id];
            return (
              <button
                key={t.id}
                disabled={deshabilitado}
                title={!tipoPermitido[t.id] ? 'No permitido en la ficha de la asignatura o del documento' : t.id === 'imagen-ia' && !conCodex ? 'Necesita Codex' : t.ayuda}
                onClick={() => guardar({ tipo: t.id })}
                className={cx(
                  'flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[11.5px] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                  p.tipo === t.id ? 'bg-panel text-texto shadow-sm' : 'text-texto-3 hover:text-texto',
                )}
              >
                <t.icono className="size-3" />
                {t.nombre}
              </button>
            );
          })}
        </div>
      </div>
      <Entrada
        className="mb-1.5 h-8 text-[13px] font-medium"
        value={titulo}
        disabled={generando || busy || ready}
        onChange={(e) => setTitulo(e.target.value)}
        onBlur={() => titulo !== p.titulo && guardar({ titulo })}
      />
      <AreaTexto
        rows={2}
        className="text-[12.5px]"
        value={descripcion}
        disabled={generando || busy || ready}
        onChange={(e) => setDescripcion(e.target.value)}
        onBlur={() => descripcion !== p.descripcion && guardar({ descripcion })}
      />
      {p.tipo === 'molecula' && (
        <Entrada
          className="mt-1.5 h-8 font-mono text-[12.5px]"
          placeholder="Molécula: nombre en inglés (p. ej. aspirin) o SMILES; si lo dejas vacío, lo decide el agente"
          value={molecula}
          disabled={generando || busy || ready}
          onChange={(e) => setMolecula(e.target.value)}
          onBlur={() => molecula !== (p.molecula ?? '') && guardar({ molecula })}
        />
      )}
      {p.estado === 'error' && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-error">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          {p.error ?? 'No se pudo generar'}. Puedes reintentarlo o responder al agente en el panel de la derecha.
        </p>
      )}
      {ready && (
        <section className="mt-3 rounded-lg border border-borde bg-panel p-4" aria-label={`Vista previa: ${p.titulo}`}>
          <p className="mb-3 text-[12.5px] text-texto-2" role="status">Pendiente de aceptación. Este visual aún no está en los apuntes.</p>
          <VistaPrevia texto={p.markdown!} base={urlDatos(a, 'documentos', d)} />
        </section>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
        {trabajo && (
          <span className="mr-auto flex items-center gap-1.5 text-[12px] text-acento-texto">
            <Loader2 className="size-3.5 animate-spin" />
            {trabajo.estado === 'en-cola' ? 'En cola…' : `${trabajo.nombreAgente} trabajando…`}
          </span>
        )}
        <Boton tam="sm" variante="fantasma" icono={<X className="size-3.5" />} disabled={generando || busy} onClick={() => guardar({ estado: 'descartada' })}>
          Descartar
        </Boton>
        {ready && (
          <Boton tam="sm" variante="fantasma" disabled={busy} onClick={() => guardar({ estado: 'propuesta' })}>Editar propuesta</Boton>
        )}
        <Boton tam="sm" icono={<Wand2 className="size-3.5" />} disabled={generando || busy} onClick={generar}>
          {p.estado === 'error' ? 'Reintentar' : ready ? 'Volver a generar' : 'Generar'}
        </Boton>
        {ready && (
          <Boton tam="sm" variante="primario" icono={<Check className="size-3.5" />} cargando={busy} disabled={busy} onClick={approve}>Aceptar</Boton>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

const FORMATOS: { id: OpcionesExportacion['formato']; nombre: string; detalle: string }[] = [
  { id: 'docx', nombre: 'Word', detalle: '.docx' },
  { id: 'odt', nombre: 'LibreOffice', detalle: '.odt' },
  { id: 'pdf', nombre: 'PDF', detalle: 'listo para imprimir' },
  { id: 'md', nombre: 'Markdown', detalle: '.md con imágenes (.zip)' },
];

/**
 * Imágenes que han fallado (enlaces rotos o descargas fallidas), con un botón que reintenta la
 * descarga y, si no se puede, busca una alternativa. `soloFaltan` omite los visuales con error,
 * que el paso de visuales ya muestra en sus tarjetas.
 */
function AvisoImagenes({ a, d, estado, soloFaltan }: { a: string; d: string; estado?: EstadoFlujo; soloFaltan?: boolean }) {
  const { avisar } = useCampos('avisar');
  const [lista, setLista] = useState<ImagenFallida[]>([]);
  const [reparando, setReparando] = useState(false);
  const firma = estado ? `${estado.secciones.map((s) => `${s.archivo}:${s.palabras}`).join('|')}#${estado.visuales.map((v) => v.id + v.estado).join('|')}` : '';
  useEffect(() => {
    api.imagenesQueFaltan(a, d).then(setLista).catch(() => {});
  }, [a, d, firma]);
  const fallidas = soloFaltan ? lista.filter((f) => f.motivo === 'falta') : lista;
  if (!fallidas.length) return null;
  const enCurso = fallidas.filter((f) => f.reparando).length;
  const reparar = async () => {
    setReparando(true);
    try {
      const r = await api.repararImagenes(a, d);
      avisar(r.mensaje, 'ok');
      setLista(await api.imagenesQueFaltan(a, d));
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setReparando(false);
    }
  };
  return (
    <div className="flex items-start gap-3 rounded-lg border border-aviso/40 bg-aviso/10 px-3 py-2 text-[12.5px]">
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-aviso" />
      <div className="min-w-0 flex-1">
        {fallidas.length === 1 ? 'Una imagen ha fallado' : `${fallidas.length} imágenes han fallado`}
        {fallidas.some((f) => f.motivo === 'falta') && '; las que faltan se exportarán como «Imagen pendiente»'}:
        <ul className="mt-1 list-disc pl-4 text-texto-2">
          {fallidas.map((f) => (
            <li key={(f.visual ?? '') + f.seccion + (f.ruta ?? '')}>
              {f.alt || f.ruta}{' '}
              <span className="text-texto-3">
                ({f.reparando ? 'buscando alternativa…' : f.motivo === 'falta' ? `falta ${f.ruta}` : f.error || 'no se pudo obtener'}, en{' '}
                {f.seccion.replace(/\.md$/, '')})
              </span>
            </li>
          ))}
        </ul>
      </div>
      {enCurso < fallidas.length && (
        <Boton tam="sm" icono={<RefreshCw className="size-3.5" />} cargando={reparando} onClick={reparar}>
          Reintentar o buscar otra
        </Boton>
      )}
    </div>
  );
}

export function PanelExportar({ a, d, estado, recargar }: { a: string; d: string; estado?: EstadoFlujo; recargar: () => void }) {
  const { avisar } = useCampos('avisar');
  const [op, setOp] = useState<OpcionesExportacion>(() => {
    try {
      return { formato: 'pdf', portada: true, indice: true, numerar: true, autoevaluacion: true, saltoSeccion: false, pies: true, ...JSON.parse(localStorage.getItem('opcionesExportar') ?? '{}') };
    } catch {
      return { formato: 'pdf', portada: true, indice: true, numerar: true, autoevaluacion: true, saltoSeccion: false, pies: true };
    }
  });
  const [exportando, setExportando] = useState(false);
  const trabajos = useEstado((s) => s.trabajos);
  const anadiendoPies = Object.values(trabajos).some(
    (t) => t.asignatura === a && t.documento === d && t.ref === 'pies' && (t.estado === 'ejecutando' || t.estado === 'en-cola'),
  );
  const [sinPie, setSinPie] = useState<{ seccion: string; tipo: string; muestra: string }[]>([]);
  const firmaSecciones = estado?.secciones.map((s) => `${s.archivo}:${s.palabras}`).join('|');
  useEffect(() => {
    api.sinPie(a, d).then(setSinPie).catch(() => {});
  }, [a, d, firmaSecciones, anadiendoPies]);
  const cambiar = (c: Partial<OpcionesExportacion>) => {
    const n = { ...op, ...c };
    setOp(n);
    try {
      localStorage.setItem('opcionesExportar', JSON.stringify(n));
    } catch {}
  };

  const exportar = async () => {
    setExportando(true);
    try {
      const r = await exportarDocumento(a, d, op);
      avisar(`Exportado: ${r.nombre}`, 'ok');
      recargar();
      await api.abrirExportado(a, d, r.nombre);
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setExportando(false);
    }
  };

  const opciones: [keyof OpcionesExportacion, string][] = [
    ['portada', 'Portada'],
    ['indice', 'Índice'],
    ['numerar', 'Numerar apartados'],
    ['saltoSeccion', 'Cada sección en página nueva'],
    ['pies', 'Pies de figura y tabla'],
    ...(estado?.autoevaluacion ? ([['autoevaluacion', 'Incluir autoevaluación']] as [keyof OpcionesExportacion, string][]) : []),
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FORMATOS.map((f) => (
          <button
            key={f.id}
            onClick={() => cambiar({ formato: f.id })}
            className={cx(
              'rounded-xl border px-4 py-3 text-left transition-colors cursor-pointer',
              op.formato === f.id ? 'border-acento bg-acento-suave' : 'border-borde hover:bg-panel-2',
            )}
          >
            <FileText className={cx('mb-1.5 size-5', op.formato === f.id ? 'text-acento-texto' : 'text-texto-3')} />
            <div className="text-sm font-semibold">{f.nombre}</div>
            <div className="text-[12px] text-texto-3">{f.detalle}</div>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {opciones.map(([clave, texto]) => (
          <label key={clave} className="flex cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" className="accent-[var(--acento)]" checked={!!op[clave]} onChange={(e) => cambiar({ [clave]: e.target.checked })} />
            {texto}
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        Soluciones de los ejercicios
        <select
          value={op.soluciones ?? 'texto'}
          onChange={(e) => cambiar({ soluciones: e.target.value as OpcionesExportacion['soluciones'] })}
          className="h-8 rounded-lg border border-borde bg-panel px-2 text-[13px] outline-none focus:border-acento cursor-pointer"
          title="Las soluciones van en bloques «::: solucion» tras cada ejercicio"
        >
          <option value="texto">En el texto, tras cada ejercicio</option>
          <option value="final">En un solucionario al final</option>
          <option value="ninguna">Sin soluciones (versión para el alumnado)</option>
        </select>
      </label>
      <div className="flex items-center gap-2">
        <Boton variante="primario" icono={<Download className="size-4" />} cargando={exportando} disabled={!estado?.secciones.length} onClick={exportar}>
          {exportando ? 'Exportando…' : `Exportar a ${FORMATOS.find((f) => f.id === op.formato)!.nombre}`}
        </Boton>
        <Boton variante="fantasma" icono={<FolderOpen className="size-4" />} onClick={() => api.abrirCarpeta(a, d, 'exportados')}>
          Carpeta
        </Boton>
      </div>
      {op.pies !== false && sinPie.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-aviso/40 bg-aviso/10 px-3 py-2 text-[12.5px]">
          <AlertCircle className="size-4 shrink-0 text-aviso" />
          <span className="flex-1">
            {sinPie.length === 1 ? 'Un elemento no tiene' : `${sinPie.length} elementos no tienen`} pie (
            {[...new Set(sinPie.map((x) => x.tipo))].join(', ')}). Se exportarán con un pie genérico numerado.
          </span>
          <Boton
            tam="sm"
            cargando={anadiendoPies}
            onClick={() => api.anadirPies(a, d).catch((e) => avisar(e.message, 'error'))}
          >
            {anadiendoPies ? 'Añadiendo…' : 'Añadir pies con IA'}
          </Boton>
        </div>
      )}
      <AvisoImagenes a={a} d={d} estado={estado} />
      {op.formato !== 'pdf' && (
        <p className="text-[12px] text-texto-3">Para usar tus propios estilos de {op.formato === 'docx' ? 'Word' : 'LibreOffice'}, sube una plantilla en la ficha de la asignatura.</p>
      )}
      {!!estado?.exportados.length && (
        <div className="divide-y divide-borde rounded-lg border border-borde">
          {estado.exportados.map((x) => (
            <button
              key={x.nombre}
              onClick={() => api.abrirExportado(a, d, x.nombre).catch((e) => avisar(e.message, 'error'))}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-panel-2 cursor-pointer"
            >
              <Insignia color="acento" className="uppercase">
                {x.formato}
              </Insignia>
              <span className="min-w-0 flex-1 truncate">{x.nombre}</span>
              <span className="text-[12px] text-texto-3">{fechaCorta(x.modificado)}</span>
              <ExternalLink className="size-3.5 text-texto-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PasoExportar({ a, d, estado, recargar }: Props) {
  return (
    <Paso
      numero={7}
      titulo="Exportar"
      hecho={estado.exportados.length > 0}
      descripcion="Une las secciones y exporta los apuntes. Los diagramas se convierten en imágenes."
    >
      <PanelExportar a={a} d={d} estado={estado} recargar={recargar} />
    </Paso>
  );
}
