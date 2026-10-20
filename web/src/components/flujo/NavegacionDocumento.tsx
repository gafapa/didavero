import { ArrowLeft, Check } from 'lucide-react';
import { useEstado, useCampos } from '../../lib/estado';
import { abreviar } from '../../lib/formato';
import { cx } from '../ui';
import { Estrella } from '../Logo';
import { PASOS, VISTAS_DOCUMENTO, estadoPaso, useFlujoActual, useVistaDocumento, type IdVista } from './pasos';

/** Barra lateral dentro de un documento: las vistas del documento y las fases del flujo. */
export function NavegacionDocumento() {
  const f = useFlujoActual()!;
  const { asignaturas, seleccionar } = useCampos('asignaturas', 'seleccionar');
  const gasto = useEstado((s) => s.tokens?.porAsignatura?.[f.a]?.documentos[f.d]);
  const [vista, elegir] = useVistaDocumento();
  const asig = asignaturas.find((a) => a.id === f.a);
  const doc = asig?.documentos.find((d) => d.id === f.d);
  const secciones = f.estado?.secciones.length ?? 0;
  const imagenes = f.estado?.visuales.filter((v) => v.estado === 'insertada').length ?? 0;
  const gastado = Object.values(gasto ?? {}).reduce((n, t) => n + t.entrada + t.salida, 0);
  const tope = doc?.presupuesto;

  const Elemento = ({ id, children, activo }: { id: IdVista; children: React.ReactNode; activo: boolean }) => (
    <button
      onClick={() => elegir(id)}
      aria-current={activo ? 'page' : undefined}
      className={cx(
        'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] transition-colors cursor-pointer',
        activo ? 'bg-acento-suave font-semibold text-texto' : 'text-texto-2 hover:bg-panel-2 hover:text-texto',
      )}
    >
      {children}
    </button>
  );

  return (
    <nav className="flex flex-1 flex-col overflow-y-auto px-2 pb-3">
      <button
        onClick={() => seleccionar({ asignatura: f.a })}
        className="mx-2 mt-2 flex items-center gap-1.5 text-[12.5px] font-medium text-texto-2 hover:text-acento-texto cursor-pointer"
      >
        <ArrowLeft className="size-3.5" />
        <span className="size-2 shrink-0 rounded-[2px]" style={{ background: asig?.color }} />
        <span className="truncate">{asig?.nombre ?? 'Asignatura'}</span>
      </button>
      <div className="mx-2 mt-2 font-titulo text-[20px] leading-tight font-bold tracking-tight">{doc?.titulo ?? ''}</div>
      {(gastado > 0 || tope) && (
        <div className="mx-2 mt-2.5" title="Tokens gastados en estos apuntes (entrada + salida)">
          {tope ? (
            <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-panel-2">
              <div className={cx('h-full rounded-full', gastado >= tope ? 'bg-error' : 'bg-acento')} style={{ width: `${Math.min(100, Math.max(2, (gastado / tope) * 100))}%` }} />
            </div>
          ) : null}
          <span className="font-mono text-[11.5px] text-texto-3">
            {abreviar(gastado)}
            {tope ? ` de ${abreviar(tope)}` : ''} tokens
          </span>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-0.5">
        {VISTAS_DOCUMENTO.map((v) => (
          <Elemento key={v.id} id={v.id} activo={vista === v.id}>
            <v.icono className="size-4 shrink-0" />
            <span className="flex-1">{v.titulo}</span>
            {v.id === 'apuntes' && secciones > 0 && <span className="text-[11.5px] font-normal text-texto-3">{secciones} secc.</span>}
            {v.id === 'recursos' && imagenes > 0 && <span className="text-[11.5px] font-normal text-texto-3">{imagenes}</span>}
          </Elemento>
        ))}
      </div>

      <div className="mt-5 px-2.5 pb-1.5 text-[11.5px] font-bold tracking-wider text-texto-3 uppercase">Fases</div>
      <ol className="flex flex-col gap-0.5">
        {PASOS.map((p, i) => {
          const e = estadoPaso(p.id, f.estado, f.trabajos);
          const sel = vista === p.id;
          const nota = e.aviso ?? (p.opcional && !e.hecho ? 'opcional' : undefined);
          return (
            <li key={p.id}>
              <Elemento id={p.id} activo={sel}>
                <span
                  className={cx(
                    'flex size-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                    e.trabajando
                      ? 'bg-acento text-white'
                      : e.hecho
                        ? 'bg-ok/15 text-ok'
                        : sel
                          ? 'border-[1.5px] border-acento text-acento-texto'
                          : 'border-[1.5px] border-borde text-texto-3',
                  )}
                >
                  {e.trabajando ? <Estrella className="size-3 animate-pulse" /> : e.hecho ? <Check className="size-3" strokeWidth={3.2} /> : i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{p.titulo}</span>
                {nota && (
                  <span
                    className={cx(
                      'shrink-0 text-[11.5px] font-normal',
                      e.trabajando ? 'font-mono text-acento-texto' : e.aviso && !e.hecho ? 'text-aviso' : 'text-texto-3',
                    )}
                  >
                    {nota}
                  </span>
                )}
              </Elemento>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
