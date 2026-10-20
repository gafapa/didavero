import { ENGINE_NAMES } from '../../../shared/engines';
import { useEffect, useState } from 'react';
import { ChevronRight, FileText, FolderOpen, Moon, Plus, Settings, Sun } from 'lucide-react';
import { useCampos } from '../lib/estado';
import { api } from '../lib/api';
import { BotonIcono, cx } from './ui';
import { ModalNuevaAsignatura, ModalNuevoDocumento } from './Modales';
import { ModalAjustes } from './ModalAjustes';
import { NavegacionDocumento } from './flujo/NavegacionDocumento';
import { ContadorTokensPie } from './ContadorTokens';
import { Logo } from './Logo';
import { useHayFlujo } from './flujo/pasos';

export function BarraLateral() {
  const { asignaturas, seleccion, seleccionar } = useCampos('asignaturas', 'seleccion', 'seleccionar');
  const [plegadas, setPlegadas] = useState<Record<string, boolean>>({});
  const [nuevaAsig, setNuevaAsig] = useState(false);
  const [nuevoDocEn, setNuevoDocEn] = useState<string>();
  const [ajustes, setAjustes] = useState(false);
  const [enVivo, setEnVivo] = useState(false);
  const flujo = useHayFlujo();
  useEffect(() => {
    api.version().then((v) => setEnVivo(v.version === 'en vivo')).catch(() => {});
  }, []);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-borde bg-panel">
      <button
        onClick={() => seleccionar({})}
        className="flex items-center gap-2.5 px-4 pt-4 pb-3 text-left cursor-pointer"
        title="Inicio"
      >
        <Logo className="size-8 shrink-0" />
        <div>
          <div className="flex items-center gap-1.5 font-titulo text-[17px] font-bold tracking-tight leading-tight">
            Didavero
            {enVivo && (
              <span
                title="Modo en vivo: los cambios en el código se aplican al guardar."
                className="rounded bg-ok/15 px-1.5 py-px text-[10px] font-semibold tracking-wide text-ok uppercase"
              >
                en vivo
              </span>
            )}
          </div>
          <div className="text-[11.5px] text-texto-3 leading-tight">Apuntes con agentes de IA</div>
        </div>
      </button>

      {flujo ? (
        <NavegacionDocumento />
      ) : (
      <>
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-[11px] font-semibold tracking-wider text-texto-3 uppercase">Asignaturas</span>
        <BotonIcono titulo="Nueva asignatura" onClick={() => setNuevaAsig(true)}>
          <Plus className="size-4" />
        </BotonIcono>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {asignaturas.length === 0 && (
          <button
            onClick={() => setNuevaAsig(true)}
            className="mx-2 mt-2 w-[calc(100%-1rem)] rounded-lg border border-dashed border-borde px-3 py-4 text-center text-[13px] text-texto-3 hover:border-acento hover:text-acento-texto cursor-pointer"
          >
            Crea tu primera asignatura
          </button>
        )}
        {asignaturas.map((a) => {
          const abierta = !plegadas[a.id];
          const activa = seleccion.asignatura === a.id && !seleccion.documento;
          return (
            <div key={a.id} className="mt-0.5">
              <div
                className={cx(
                  'group flex items-center gap-1 rounded-lg pr-1 transition-colors',
                  activa ? 'bg-acento-suave' : 'hover:bg-panel-2',
                )}
              >
                <button
                  className="flex size-7 items-center justify-center text-texto-3 cursor-pointer"
                  onClick={() => setPlegadas({ ...plegadas, [a.id]: abierta })}
                  aria-label={abierta ? 'Plegar' : 'Desplegar'}
                >
                  <ChevronRight className={cx('size-3.5 transition-transform', abierta && 'rotate-90')} />
                </button>
                <button
                  className={cx('flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left cursor-pointer', activa && 'text-acento-texto font-medium')}
                  onClick={() => seleccionar({ asignatura: a.id })}
                >
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: a.color }} />
                  <span className="min-w-0" title={[a.nombre, a.nivel].filter(Boolean).join(' · ')}>
                    <span className="block truncate">{a.nombre}</span>
                    {a.nivel && <span className="block truncate text-[11px] leading-tight font-normal text-texto-3">{a.nivel}</span>}
                  </span>
                </button>
                <BotonIcono
                  titulo="Nuevos apuntes"
                  className="size-6 opacity-0 group-hover:opacity-100 focus:opacity-100"
                  onClick={() => setNuevoDocEn(a.id)}
                >
                  <Plus className="size-3.5" />
                </BotonIcono>
              </div>
              {abierta && (
                <div className="ml-5 border-l border-borde pl-2">
                  {a.documentos.map((d) => {
                    const sel = seleccion.asignatura === a.id && seleccion.documento === d.id;
                    return (
                      <button
                        key={d.id}
                        onClick={() => seleccionar({ asignatura: a.id, documento: d.id })}
                        className={cx(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px] transition-colors cursor-pointer',
                          sel ? 'bg-acento-suave text-acento-texto font-medium' : 'text-texto-2 hover:bg-panel-2 hover:text-texto',
                        )}
                      >
                        <FileText className="size-3.5 shrink-0 opacity-70" />
                        <span className="truncate">{d.titulo}</span>
                      </button>
                    );
                  })}
                  {a.documentos.length === 0 && (
                    <button
                      onClick={() => setNuevoDocEn(a.id)}
                      className="px-2 py-1.5 text-[12.5px] text-texto-3 hover:text-acento-texto cursor-pointer"
                    >
                      + Añadir apuntes
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      </>
      )}

      <PieBarra onAjustes={() => setAjustes(true)} />

      <ModalNuevaAsignatura abierto={nuevaAsig} onCerrar={() => setNuevaAsig(false)} />
      <ModalNuevoDocumento asignatura={nuevoDocEn} onCerrar={() => setNuevoDocEn(undefined)} />
      <ModalAjustes abierto={ajustes} onCerrar={() => setAjustes(false)} />
    </aside>
  );
}

function PieBarra({ onAjustes }: { onAjustes: () => void }) {
  const { uso, motores, conectado, actualizacion } = useCampos('uso', 'motores', 'conectado', 'actualizacion');
  const [oscuro, setOscuro] = useState(() => document.documentElement.classList.contains('dark'));
  const cambiarTema = () => {
    const v = !oscuro;
    setOscuro(v);
    document.documentElement.classList.toggle('dark', v);
    try {
      localStorage.setItem('tema', v ? 'oscuro' : 'claro');
    } catch {}
  };
  const pct = uso?.cincoHoras !== undefined ? Math.round(uso.cincoHoras * 100) : undefined;
  const reinicio = uso?.reinicio ? new Date(uso.reinicio * 1000).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }) : '';
  const claudeEnabled = motores?.some((engine) => engine.motor === 'claude' && engine.instalado && engine.sesion);
  const codexEnabled = motores?.some((engine) => engine.motor === 'codex' && engine.instalado && engine.sesion);

  return (
    <div className="border-t border-borde px-4 py-3 space-y-3">
      {actualizacion?.estado === 'descargada' && (
        <button
          onClick={() => api.instalarActualizacion()}
          className="w-full rounded-lg bg-acento-suave px-3 py-2 text-left text-[12.5px] text-acento-texto hover:bg-acento hover:text-white cursor-pointer"
        >
          <b>Versión {actualizacion.version} lista.</b> Pulsa para reiniciar y actualizar.
        </button>
      )}
      {(claudeEnabled || codexEnabled) && (
      <div className="space-y-2.5 rounded-xl border border-borde bg-fondo p-3">
      {claudeEnabled && pct !== undefined && (
        <div title={`Uso de la suscripción de Claude en la ventana de 5 horas${reinicio ? ` · se reinicia a las ${reinicio}` : ''}`}>
          <div className="mb-1 flex justify-between text-[11.5px] text-texto-3">
            <span className="font-medium text-texto-2">Uso de Claude (5 h)</span>
            <span className={cx('font-mono', pct >= 80 && 'text-aviso font-medium')}>{pct} %</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
            <div
              className={cx('h-full rounded-full transition-all', pct >= 80 ? 'bg-aviso' : 'bg-acento')}
              style={{ width: `${Math.max(2, pct)}%` }}
            />
          </div>
          {reinicio && <div className="mt-1 text-[11px] text-texto-3">Se renueva a las {reinicio}</div>}
        </div>
      )}
      {claudeEnabled && pct === undefined && (
        <div className="text-[11.5px] text-texto-3" role="status" title="El uso se actualizará cuando Claude comunique los límites durante una tarea.">
          Uso de Claude: sin datos de uso
        </div>
      )}
      {codexEnabled && uso?.codex?.windows.map((window, index) => {
        const duration = window.durationMinutes;
        const period = duration === 10080 ? 'semana' : duration && duration % 60 === 0 ? `${duration / 60} h` : duration ? `${duration} min` : 'ventana';
        const percentage = Math.round(window.usedPercent);
        const reset = window.resetsAt ? new Date(window.resetsAt * 1000).toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        const label = `Uso de Codex (${period})`;
        return (
          <div key={index} title={`${label}${reset ? ` · se reinicia el ${reset}` : ''}`}>
            <div className="mb-1 flex justify-between text-[11.5px] text-texto-3">
              <span className="font-medium text-texto-2">{label}</span>
              <span className={cx('font-mono', percentage >= 80 && 'text-aviso font-medium')}>{percentage} %</span>
            </div>
            <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} className="h-1.5 overflow-hidden rounded-full bg-panel-2">
              <div className={cx('h-full rounded-full transition-all', percentage >= 80 ? 'bg-aviso' : 'bg-acento')} style={{ width: `${percentage}%` }} />
            </div>
          </div>
        );
      })}
      {codexEnabled && !uso?.codex?.windows.length && (
        <div className="text-[11.5px] text-texto-3" role="status">
          Uso de Codex: {uso?.codex?.unavailable ? 'no disponible' : 'consultando…'}
        </div>
      )}
      </div>
      )}
      <ContadorTokensPie />
      <div className="flex items-center gap-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-texto-3">
          {!conectado && <span className="text-error">Sin conexión</span>}
          {conectado &&
            motores?.map((m) => (
              <span key={m.motor} className="flex items-center gap-1.5" title={m.version ?? 'No instalado'}>
                <span className={cx('size-1.5 rounded-full', m.instalado && m.sesion ? 'bg-ok' : m.instalado ? 'bg-aviso' : 'bg-texto-3/50')} />
                {ENGINE_NAMES[m.motor]}
              </span>
            ))}
        </div>
        <BotonIcono titulo="Abrir carpeta de datos" onClick={() => api.abrirCarpeta()}>
          <FolderOpen className="size-4" />
        </BotonIcono>
        <BotonIcono titulo={oscuro ? 'Tema claro' : 'Tema oscuro'} onClick={cambiarTema}>
          {oscuro ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </BotonIcono>
        <BotonIcono titulo="Ajustes" onClick={onAjustes}>
          <Settings className="size-4" />
        </BotonIcono>
      </div>
    </div>
  );
}
