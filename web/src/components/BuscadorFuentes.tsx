import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Check, ExternalLink, FileText, Globe, Loader2, Plus, Search, Video, X } from 'lucide-react';
import type { ResultadoBusqueda, TipoBusqueda } from '../../../shared/tipos';
import { api } from '../lib/api';
import { useCampos } from '../lib/estado';
import { Boton, Entrada, Insignia, cx } from './ui';
import { ActividadAgente } from './flujo/comun';

const TIPOS: { id: TipoBusqueda; nombre: string }[] = [
  { id: 'cualquiera', nombre: 'Cualquiera' },
  { id: 'academico', nombre: 'Académicas' },
  { id: 'educativo', nombre: 'Educativas' },
  { id: 'video', nombre: 'Vídeos' },
];

const ICONOS: Record<ResultadoBusqueda['tipo'], typeof Globe> = { pdf: FileText, web: Globe, video: Video, articulo: FileText, libro: BookOpen };

/** Buscador de fuentes con IA: propone recursos fiables y los descarga a la carpeta de fuentes. */
export function BuscadorFuentes({ asignatura, documento, onAnadida }: { asignatura: string; documento?: string; onAnadida: () => void }) {
  const { avisar, versiones, reconexion, trabajos } = useCampos('avisar', 'versiones', 'reconexion', 'trabajos');
  const [consulta, setConsulta] = useState('');
  const [tipo, setTipo] = useState<TipoBusqueda>('cualquiera');
  const [resultados, setResultados] = useState<ResultadoBusqueda[]>([]);
  const [ocupados, setOcupados] = useState<Set<string>>(new Set());
  const [lanzando, setLanzando] = useState(false);
  const version = `${versiones[`${asignatura}/${documento ?? ''}`] ?? 0}-${reconexion}`; // también al reconectar con el servidor
  const activos = Object.values(trabajos).filter(
    (t) => t.paso === 'fuentes' && t.asignatura === asignatura && (t.documento ?? '') === (documento ?? '') && (t.estado === 'ejecutando' || t.estado === 'en-cola'),
  );
  const firmaActivos = activos.map((t) => t.id).join();

  const cargar = useCallback(() => {
    api.busqueda(asignatura, documento).then(setResultados).catch(() => {});
  }, [asignatura, documento]);
  useEffect(cargar, [cargar, version, firmaActivos]);

  const buscar = async () => {
    if (!consulta.trim()) return;
    setLanzando(true);
    try {
      await api.buscarFuentes(asignatura, consulta, tipo, documento);
      setConsulta('');
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setLanzando(false);
    }
  };

  const accion = async (r: ResultadoBusqueda, que: 'anadir' | 'descartar') => {
    setOcupados((s) => new Set(s).add(r.id));
    try {
      if (que === 'anadir') {
        const n = await api.anadirFuente(asignatura, r.id, documento);
        avisar(`Añadida: ${n.archivo}`, 'ok');
        onAnadida();
      } else {
        await api.descartarResultado(asignatura, r.id, documento);
      }
      cargar();
    } catch (e) {
      avisar((e as Error).message, 'error');
      cargar();
    } finally {
      setOcupados((s) => {
        const n = new Set(s);
        n.delete(r.id);
        return n;
      });
    }
  };

  const propuestas = resultados.filter((r) => r.estado === 'propuesta');
  const anadidas = resultados.filter((r) => r.estado === 'anadida').length;

  return (
    <div className="rounded-xl border border-borde bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Search className="size-4 text-acento-texto" />
        <span className="text-sm font-semibold">Buscar fuentes</span>
        <span className="text-[12px] text-texto-3">Un agente busca en la web recursos fiables; tú eliges cuáles añadir.</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Entrada
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && buscar()}
          placeholder="Qué necesitas: «plantas C4 y CAM, nivel Bachillerato»"
          aria-label="Qué fuentes necesitas buscar"
          className="min-w-0 flex-1 basis-48"
        />
        <Boton variante="primario" icono={<Search className="size-4" />} cargando={lanzando} disabled={!consulta.trim() || activos.length > 0} onClick={buscar}>
          Buscar
        </Boton>
      </div>
      <div className="mt-2 flex gap-0.5 rounded-lg bg-panel-2 p-0.5 w-fit">
        {TIPOS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTipo(t.id)}
            className={cx(
              'rounded-md px-2.5 py-0.5 text-[12px] font-medium cursor-pointer',
              tipo === t.id ? 'bg-panel text-texto shadow-sm' : 'text-texto-3 hover:text-texto',
            )}
          >
            {t.nombre}
          </button>
        ))}
      </div>

      {activos.map((t) => (
        <div key={t.id} className="mt-3">
          <ActividadAgente t={t} />
        </div>
      ))}

      {propuestas.length > 0 && (
        <ul className="mt-3 space-y-2">
          {propuestas.map((r) => {
            const Icono = ICONOS[r.tipo] ?? Globe;
            const ocupado = ocupados.has(r.id);
            let dominio = '';
            try {
              dominio = new URL(r.url).hostname.replace(/^www\./, '');
            } catch {}
            return (
              <li key={r.id} className="aparecer rounded-lg border border-borde bg-fondo/40 p-3">
                <div className="flex items-start gap-2.5">
                  <Icono className="mt-0.5 size-4 shrink-0 text-acento-texto" />
                  <div className="min-w-0 flex-1">
                    <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium hover:text-acento-texto">
                      {r.titulo}
                      <ExternalLink className="size-3 shrink-0 text-texto-3" />
                    </a>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-texto-3">
                      <span>{[r.autor, dominio].filter(Boolean).join(' · ')}</span>
                      <Insignia className="uppercase">{r.tipo}</Insignia>
                      {r.idioma && <span>{r.idioma}</span>}
                      {r.licencia && <span>{r.licencia}</span>}
                    </div>
                    {r.descripcion && <p className="mt-1 text-[12.5px] text-texto-2">{r.descripcion}</p>}
                    {r.fiabilidad && <p className="mt-0.5 text-[11.5px] text-texto-3">Fiable porque: {r.fiabilidad}</p>}
                    {r.error && <p className="mt-1 text-[12px] text-error">{r.error}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <Boton tam="sm" icono={ocupado ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} disabled={ocupado} onClick={() => accion(r, 'anadir')}>
                      Añadir
                    </Boton>
                    <Boton tam="sm" variante="fantasma" icono={<X className="size-3.5" />} disabled={ocupado} onClick={() => accion(r, 'descartar')}>
                      Descartar
                    </Boton>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {(anadidas > 0 || resultados.some((r) => r.estado === 'descartada')) && (
        <div className="mt-2 flex items-center justify-between text-[12px] text-texto-3">
          <span className="flex items-center gap-1">
            <Check className="size-3.5 text-ok" /> {anadidas} añadida{anadidas === 1 ? '' : 's'} desde el buscador
          </span>
          <button className="hover:text-acento-texto cursor-pointer" onClick={() => api.limpiarBusqueda(asignatura, documento).then(cargar)}>
            Limpiar resultados
          </button>
        </div>
      )}
    </div>
  );
}
