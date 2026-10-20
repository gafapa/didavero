import { useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../lib/api';
import { Entrada } from './ui';

type Resultado = Awaited<ReturnType<typeof api.buscarEnFuentes>>[number];

/** Búsqueda en el índice de las fuentes: la misma que usan los agentes. */
export function BuscadorIndice({ asignatura, documento }: { asignatura: string; documento?: string }) {
  const [consulta, setConsulta] = useState('');
  const [resultados, setResultados] = useState<Resultado[]>();
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState('');

  const buscar = async () => {
    if (!consulta.trim()) return setResultados(undefined);
    setBuscando(true);
    setError('');
    try {
      setResultados(await api.buscarEnFuentes(asignatura, consulta, documento));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBuscando(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-texto-3" />
        <Entrada
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && buscar()}
          placeholder="Buscar dentro de tus fuentes (lo mismo que consultan los agentes)…"
          aria-label="Buscar texto en las fuentes"
          className="pl-9"
        />
      </div>
      {buscando && <p className="text-[12px] text-texto-3">Buscando…</p>}
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
      {resultados && !buscando && (
        <div className="space-y-2">
          {resultados.length === 0 && <p className="text-[12.5px] text-texto-3">Sin resultados.</p>}
          {resultados.map((r, i) => (
            <div key={i} className="rounded-lg border border-borde bg-fondo/40 px-3 py-2">
              <div className="mb-1 text-[11.5px] text-texto-3">
                <span className="font-medium text-texto-2">{r.archivo}</span>
                {r.pagina && ` · pág. ${r.pagina}`}
                {r.titulo && ` · ${r.titulo}`}
                {r.carpeta === 'asignatura' && documento && ' · de la asignatura'}
              </div>
              <p className="line-clamp-4 text-[12.5px] leading-relaxed whitespace-pre-line">{r.texto}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
