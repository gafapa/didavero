import { useState } from 'react';
import { Archive, BookOpen, Plus, Trash2 } from 'lucide-react';
import type { Documento, Trabajo } from '../../../shared/tipos';
import { api, type AsignaturaResumen } from '../lib/api';
import { useEstado, useCampos } from '../lib/estado';
import { Boton, Vacio } from './ui';
import { ModalNuevaAsignatura } from './Modales';
import { BotonRestaurarCopia, ModalPapelera } from './Gestion';
import { GastoTokens } from './ContadorTokens';
import { activo } from './flujo/comun';

/** Fondo y texto de las iniciales con el color de la asignatura (legibles en claro y en oscuro). */
const tinta = (color: string) => ({
  background: `color-mix(in srgb, ${color} 16%, transparent)`,
  color: `color-mix(in srgb, ${color} 55%, var(--texto))`,
});

const iniciales = (nombre: string) => {
  const letras = nombre.replace(/[^\p{L}\s]/gu, '').trim();
  return (letras.slice(0, 1).toUpperCase() + letras.slice(1, 2)).trim() || '·';
};

const relativo = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
function haceTiempo(iso: string) {
  const min = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (Math.abs(min) < 60) return relativo.format(min, 'minute');
  const horas = Math.round(min / 60);
  if (Math.abs(horas) < 24) return relativo.format(horas, 'hour');
  return relativo.format(Math.round(horas / 24), 'day');
}

export function VistaInicio() {
  const { asignaturas, seleccionar } = useCampos('asignaturas', 'seleccionar');
  const trabajos = useEstado((s) => s.trabajos);
  const [nueva, setNueva] = useState(false);
  const [papelera, setPapelera] = useState(false);
  const hoy = new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });

  // Los tres documentos tocados más recientemente
  const recientes = asignaturas
    .flatMap((a) => a.documentos.map((d) => ({ a, d })))
    .sort((x, y) => Date.parse(y.d.actualizado) - Date.parse(x.d.actualizado))
    .slice(0, 3);
  const enMarcha = Object.values(trabajos).filter(activo);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-10 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-texto-3 first-letter:uppercase">{hoy}</p>
            <h1 className="mt-0.5 text-[34px] leading-tight font-bold tracking-tight">Tus asignaturas</h1>
          </div>
          <Boton variante="primario" icono={<Plus className="size-4" />} onClick={() => setNueva(true)}>
            Nueva asignatura
          </Boton>
        </div>

        {asignaturas.length === 0 ? (
          <Vacio
            icono={<BookOpen className="size-6" />}
            titulo="Aún no tienes asignaturas"
            texto="Cada asignatura guarda su contexto y sus destinatarios; dentro creas los apuntes y pides a los agentes que trabajen en ellos."
            accion={
              <div className="flex flex-wrap justify-center gap-2">
                <Boton variante="primario" icono={<Plus className="size-4" />} onClick={() => setNueva(true)}>
                  Nueva asignatura
                </Boton>
                <BotonRestaurarCopia variante="secundario" />
              </div>
            }
          />
        ) : (
          <>
            {recientes.length > 0 && (
              <section aria-labelledby="seguir" className="mt-9">
                <h2 id="seguir" className="text-lg font-bold">
                  Seguir donde lo dejaste
                </h2>
                <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5">
                  {recientes.map(({ a, d }) => (
                    <TarjetaReciente
                      key={`${a.id}/${d.id}`}
                      a={a}
                      d={d}
                      trabajando={enMarcha.filter((t) => t.asignatura === a.id && t.documento === d.id)}
                      onAbrir={() => seleccionar({ asignatura: a.id, documento: d.id })}
                    />
                  ))}
                </div>
              </section>
            )}

            <section aria-labelledby="todas" className="mt-10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="todas" className="text-lg font-bold">
                  Todas
                </h2>
                <div className="flex flex-wrap gap-1">
                  <Boton
                    tam="sm"
                    variante="fantasma"
                    icono={<Archive className="size-3.5" />}
                    title="Un .zip con todas las asignaturas, sus apuntes y sus fuentes, para guardarlo aparte o llevarlo a otro equipo"
                    onClick={() => api.descargarCopia()}
                  >
                    Copia de seguridad de todo
                  </Boton>
                  <BotonRestaurarCopia variante="fantasma" />
                  <Boton tam="sm" variante="fantasma" icono={<Trash2 className="size-3.5" />} onClick={() => setPapelera(true)}>
                    Papelera
                  </Boton>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3.5">
                {asignaturas.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => seleccionar({ asignatura: a.id })}
                    className="flex flex-col gap-4 rounded-2xl border border-borde bg-panel p-5 text-left transition-all hover:-translate-y-0.5 hover:border-acento/50 hover:shadow-suave cursor-pointer"
                  >
                    <span className="flex size-11 items-center justify-center rounded-xl font-titulo text-[17px] font-extrabold" style={tinta(a.color)}>
                      {iniciales(a.nombre)}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-titulo text-[17px] font-bold tracking-tight">{a.nombre}</span>
                      <span className="block truncate text-[13.5px] text-texto-3">{a.nivel || 'Sin nivel indicado'}</span>
                      {a.destinatarios && <span className="mt-2 line-clamp-2 block text-[13px] text-texto-2">{a.destinatarios}</span>}
                    </span>
                    <span className="mt-auto flex items-center justify-between gap-2 border-t border-borde pt-3 text-[13px] text-texto-2">
                      <span>{a.documentos.length === 1 ? '1 apunte' : `${a.documentos.length} apuntes`}</span>
                      <GastoTokens asignatura={a.id} className="font-mono text-[12px]" />
                    </span>
                  </button>
                ))}
                <button
                  onClick={() => setNueva(true)}
                  className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-borde font-semibold text-texto-2 transition-colors hover:border-acento hover:text-acento-texto cursor-pointer"
                >
                  <Plus className="size-5" />
                  Nueva asignatura
                </button>
              </div>
            </section>
          </>
        )}
      </div>
      <ModalNuevaAsignatura abierto={nueva} onCerrar={() => setNueva(false)} />
      <ModalPapelera abierto={papelera} onCerrar={() => setPapelera(false)} />
    </div>
  );
}

function TarjetaReciente({ a, d, trabajando, onAbrir }: { a: AsignaturaResumen; d: Documento; trabajando: Trabajo[]; onAbrir: () => void }) {
  return (
    <button
      onClick={onAbrir}
      className="flex flex-col gap-3 rounded-2xl border border-borde bg-panel px-5 py-4 text-left shadow-suave transition-all hover:-translate-y-0.5 hover:border-acento/50 cursor-pointer"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate font-titulo text-[17px] font-bold tracking-tight">{d.titulo}</span>
          <span className="flex items-center gap-1.5 text-[13px] text-texto-3">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: a.color }} />
            <span className="truncate">{a.nombre}</span>
          </span>
        </span>
        {trabajando.length > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-acento-suave px-2.5 py-0.5 text-[12px] font-semibold text-acento-texto">
            <span className="size-1.5 animate-pulse rounded-full bg-acento" />
            {trabajando.length === 1 ? '1 agente' : `${trabajando.length} agentes`}
          </span>
        )}
      </span>
      <span className="text-[13px] text-texto-2">
        {d.importado ? 'Apuntes importados · ' : ''}Último cambio {haceTiempo(d.actualizado)}
      </span>
    </button>
  );
}
