import { useEffect, useState } from 'react';
import { Download, ExternalLink, Landmark, Search } from 'lucide-react';
import type { BusquedaImagenes, ResultadoImagen, Seccion } from '../../../shared/tipos';
import { api } from '../lib/api';
import { useCampos } from '../lib/estado';
import { Boton, Entrada, Insignia, cx } from './ui';
import { Visor } from './Visor';

/** Las miniaturas pasan por la app: algunos museos no dejan cargarlas directamente desde otra web. */
const miniaturaPorApp = (url: string) => `/api/imagenes-web/miniatura?url=${encodeURIComponent(url)}`;

/**
 * Búsqueda de imágenes con licencia libre en museos, bibliotecas y archivos (Europeana con los
 * fondos españoles, Met, Art Institute of Chicago, Cleveland, Wellcome, Smithsonian, Commons…).
 * Cada imagen se puede guardar en los recursos del documento o insertar al final de una sección.
 */
export function BuscadorImagenes({ a, d, onGuardada }: { a: string; d: string; onGuardada: () => void }) {
  const { avisar, ajustes } = useCampos('avisar', 'ajustes');
  const [texto, setTexto] = useState('');
  const [ingles, setIngles] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState<BusquedaImagenes>();
  const [secciones, setSecciones] = useState<Seccion[]>([]);
  const [guardando, setGuardando] = useState<string>();
  const [ampliada, setAmpliada] = useState<string>();

  useEffect(() => {
    api.secciones(a, d).then(setSecciones).catch(() => {});
  }, [a, d]);

  const buscar = async () => {
    if (!texto.trim() && !ingles.trim()) return;
    setBuscando(true);
    try {
      // Los museos catalogan en inglés; Commons y Europeana tienen mucho en español
      setResultado(await api.buscarImagenes(ingles.trim() || texto.trim(), texto.trim() || undefined));
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setBuscando(false);
    }
  };

  const guardar = async (r: ResultadoImagen, seccion?: string) => {
    setGuardando(r.id);
    try {
      const g = await api.guardarImagenWeb(a, d, r, seccion);
      if (seccion) avisar(`Insertada al final de «${secciones.find((s) => s.archivo === seccion)?.titulo ?? seccion}»`, 'ok');
      else {
        await navigator.clipboard.writeText(g.markdown).catch(() => {});
        avisar('Guardada en las imágenes de los apuntes. El Markdown con su pie y su crédito está copiado: pégalo donde quieras.', 'ok');
      }
      onGuardada();
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setGuardando(undefined);
    }
  };

  const sinClave = resultado?.fuentes.filter((f) => f.error === 'sin clave').map((f) => f.nombre) ?? [];
  const fallidas = resultado?.fuentes.filter((f) => f.error && f.error !== 'sin clave').map((f) => f.nombre) ?? [];

  return (
    <div className="mb-6 rounded-xl border border-borde bg-panel p-4">
      <div className="mb-3 flex items-center gap-2">
        <Landmark className="size-4 text-acento-texto" />
        <h3 className="text-sm font-semibold">Buscar en museos, bibliotecas y archivos</h3>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          buscar();
        }}
      >
        <Entrada className="min-w-56 flex-[2]" placeholder="Qué buscar, p. ej. batalla de Lepanto" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <Entrada
          className="min-w-44 flex-1"
          placeholder="En inglés (mejor para museos)"
          title="Los museos catalogan en inglés. Si lo dejas vacío, se usa el texto de la izquierda."
          value={ingles}
          onChange={(e) => setIngles(e.target.value)}
        />
        <Boton type="submit" variante="primario" icono={<Search className="size-4" />} cargando={buscando}>
          Buscar
        </Boton>
      </form>
      <p className="mt-2 text-[12px] text-texto-3">
        Solo imágenes de dominio público o con licencia CC0, CC BY o CC BY-SA. Al insertarlas se añade su crédito (autor, obra, institución y licencia).
        {!ajustes?.claves?.europeana && ' Para incluir los fondos españoles de Europeana (Hispana, bibliotecas y archivos), añade su clave gratuita en Ajustes.'}
      </p>

      {resultado && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-texto-3">
            <span className="font-medium text-texto-2">{resultado.resultados.length} imágenes</span>
            {resultado.fuentes
              .filter((f) => f.n)
              .map((f) => (
                <span key={f.fuente}>
                  {f.nombre}: {f.n}
                </span>
              ))}
            {sinClave.length > 0 && <span>Sin clave: {sinClave.join(', ')}</span>}
            {fallidas.length > 0 && <span className="text-aviso">No responden: {fallidas.join(', ')}</span>}
          </div>
          {resultado.resultados.length === 0 ? (
            <p className="py-6 text-center text-sm text-texto-3">Nada con licencia libre. Prueba otros términos, sobre todo en inglés.</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
              {resultado.resultados.map((r) => (
                <div key={r.id} className="flex flex-col overflow-hidden rounded-lg border border-borde bg-fondo/40">
                  <button className="block aspect-[4/3] w-full overflow-hidden bg-panel-2 cursor-zoom-in" onClick={() => setAmpliada(miniaturaPorApp(r.miniatura))}>
                    <img src={miniaturaPorApp(r.miniatura)} alt={r.titulo} loading="lazy" className="size-full object-contain" />
                  </button>
                  <div className="flex flex-1 flex-col gap-1 p-2.5">
                    <div className="line-clamp-2 text-[12.5px] font-medium leading-snug" title={r.titulo}>
                      {r.titulo}
                    </div>
                    <div className="line-clamp-1 text-[11.5px] text-texto-3" title={[r.autor, r.fecha].filter(Boolean).join(', ')}>
                      {[r.autor, r.fecha].filter(Boolean).join(', ') || '—'}
                    </div>
                    <div className="flex items-center gap-1.5 text-[11.5px] text-texto-3">
                      <span className="min-w-0 flex-1 truncate" title={r.institucion}>
                        {r.institucion}
                      </span>
                      <Insignia color={r.licencia.startsWith('CC BY') ? 'neutro' : 'ok'}>{r.licencia}</Insignia>
                    </div>
                    <div className="mt-auto flex items-center gap-1 pt-1">
                      <select
                        className={cx('h-7 min-w-0 flex-1 rounded-md border border-borde bg-panel px-1.5 text-[12px]', guardando === r.id && 'opacity-50')}
                        value=""
                        disabled={!!guardando}
                        onChange={(e) => e.target.value && guardar(r, e.target.value)}
                        title="Insertar al final de una sección, con su pie y su crédito"
                      >
                        <option value="">Insertar en…</option>
                        {secciones.map((s) => (
                          <option key={s.archivo} value={s.archivo}>
                            {s.titulo}
                          </option>
                        ))}
                      </select>
                      <button
                        className="flex size-7 items-center justify-center rounded-md text-texto-3 hover:bg-panel-2 hover:text-texto cursor-pointer disabled:opacity-40"
                        title="Guardar en las imágenes de los apuntes y copiar el Markdown"
                        disabled={!!guardando}
                        onClick={() => guardar(r)}
                      >
                        <Download className="size-3.5" />
                      </button>
                      <a
                        className="flex size-7 items-center justify-center rounded-md text-texto-3 hover:bg-panel-2 hover:text-texto"
                        href={r.pagina}
                        target="_blank"
                        rel="noreferrer"
                        title="Ver la ficha en la web de la institución"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <Visor contenido={ampliada ? { tipo: 'imagen', src: ampliada } : undefined} onCerrar={() => setAmpliada(undefined)} />
    </div>
  );
}
