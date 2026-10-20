import { ENGINE_IDS } from '../../../shared/engines';
import { useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, Check, CircleMinus, FileOutput, Globe, KeyRound, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { useEstado, useCampos } from '../lib/estado';
import { Boton, Modal, cx } from './ui';
import { TarjetaMotor } from './TarjetaMotor';

type Requisitos = Awaited<ReturnType<typeof api.requisitos>>;

const INICIO = new URLSearchParams(location.search).get('inicio') ?? 'navegador';

/**
 * Pantalla de inicio con lo que necesita la app para funcionar (y su estado en este equipo). Se
 * muestra al abrir la app hasta que se marca «No volver a mostrar»; desde Ajustes se puede abrir.
 */
export function PantallaRequisitos() {
  const { ajustes, motores, cargarMotores, cargarAjustes, verRequisitos } = useCampos('ajustes', 'motores', 'cargarMotores', 'cargarAjustes', 'verRequisitos');
  // Solo al iniciar la app: Electron conserva sessionStorage entre arranques, así que se guarda el
  // identificador del arranque (?inicio=…, lo pone la ventana); recargar la ventana no la vuelve a mostrar
  const [cerrada, setCerrada] = useState(() => {
    try {
      return localStorage.getItem('requisitosVistos') === INICIO;
    } catch {
      return false;
    }
  });
  const [noMostrar, setNoMostrar] = useState(false);
  const [req, setReq] = useState<Requisitos>();
  const [comprobando, setComprobando] = useState(false);
  // Tras el asistente del primer arranque, al abrir la app (salvo que se haya ocultado), o desde Ajustes
  const abierta = !!verRequisitos || (!!ajustes?.asistenteCompletado && !ajustes.ocultarRequisitos && !cerrada);

  const comprobar = async () => {
    setComprobando(true);
    try {
      const [r] = await Promise.all([api.requisitos(), cargarMotores()]);
      setReq(r);
    } catch {
      // sin conexión con el servidor: se muestra lo que haya
    } finally {
      setComprobando(false);
    }
  };
  useEffect(() => {
    if (abierta) comprobar();
  }, [abierta]);
  useEffect(() => setNoMostrar(!!ajustes?.ocultarRequisitos), [ajustes?.ocultarRequisitos]);

  const cerrar = async () => {
    setCerrada(true);
    try {
      localStorage.setItem('requisitosVistos', INICIO);
    } catch {}
    useEstado.setState({ verRequisitos: false });
    if (noMostrar !== !!ajustes?.ocultarRequisitos) {
      await api.guardarAjustes({ ocultarRequisitos: noMostrar }).catch(() => {});
      await cargarAjustes();
    }
  };

  const listos = motores?.filter((m) => m.instalado && m.sesion) ?? [];

  return (
    <Modal abierto={abierta} onCerrar={cerrar} ancho="max-w-2xl" titulo="Qué necesita Didavero" descripcion="Lo imprescindible para que funcione y lo que activa funciones concretas. Se comprueba en este equipo.">
      <div className="space-y-5">
        <section>
          <h3 className="mb-1 text-sm font-semibold">Imprescindible</h3>
          <p className="mb-2 text-[12.5px] text-texto-2">
            Al menos un asistente de IA instalado y con la sesión iniciada. Claude y Codex usan tu cuenta. OpenCode usa el proveedor o modelo local que configures.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(ENGINE_IDS).map((m) => {
              const e = motores?.find((x) => x.motor === m);
              return e ? <TarjetaMotor key={m} estado={e} /> : null;
            })}
          </div>
          {motores && !listos.length && (
            <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-error">
              <AlertCircle className="size-3.5" /> Ninguno está listo todavía: sin un motor listo, los agentes no pueden trabajar.
            </p>
          )}
          {listos.length === 1 && listos[0].motor === 'claude' && (
            <p className="mt-2 text-[12px] text-texto-3">Con Codex, además, se pueden generar imágenes con IA (opcional).</p>
          )}
        </section>

        <section className="space-y-1.5">
          <h3 className="text-sm font-semibold">Para funciones concretas</h3>
          <Fila
            icono={<Globe className="size-4" />}
            titulo="Conexión a internet"
            estado={req ? (req.conexion ? 'ok' : 'falta') : undefined}
            texto="Para que los agentes trabajen y para buscar en la web, en museos y bibliotecas, en PubChem (moléculas), en ARASAAC (pictogramas) y el currículo en el BOE."
          />
          <Fila
            icono={<FileOutput className="size-4" />}
            titulo="Exportar a Word, LibreOffice y PDF"
            estado={req ? (req.exportacion ? 'ok' : 'falta') : undefined}
            texto={req?.exportacion ? 'Incluido con la app (Pandoc y Typst). Para abrir los archivos, Word o LibreOffice.' : 'No se encuentran Pandoc o Typst: reinstala la aplicación.'}
          />
          <Fila
            icono={<KeyRound className="size-4" />}
            titulo="Claves de colecciones de imágenes (opcional)"
            estado={req ? (req.claves.europeana ? 'ok' : 'opcional') : undefined}
            texto={`Europeana (fondos españoles de bibliotecas y archivos): ${req?.claves.europeana ? 'configurada' : 'sin clave'}. Smithsonian: ${req?.claves.smithsonian ? 'configurada' : 'sin clave'}. Son gratuitas y se añaden en Ajustes; sin ellas, el resto de colecciones funciona igual.`}
          />
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borde pt-4">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-texto-2">
            <input type="checkbox" className="accent-[var(--acento)]" checked={noMostrar} onChange={(e) => setNoMostrar(e.target.checked)} />
            No volver a mostrar al abrir la app
          </label>
          <div className="flex gap-2">
            <Boton icono={<RefreshCw className={cx('size-4', comprobando && 'animate-spin')} />} onClick={comprobar} disabled={comprobando}>
              Comprobar de nuevo
            </Boton>
            <Boton variante="primario" onClick={cerrar}>
              Empezar
            </Boton>
          </div>
        </div>
        <p className="text-[11.5px] text-texto-3">Puedes volver a ver esta pantalla en Ajustes › General.</p>
      </div>
    </Modal>
  );
}

function Fila({ icono, titulo, texto, estado }: { icono: ReactNode; titulo: string; texto: string; estado?: 'ok' | 'falta' | 'opcional' }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-borde px-3 py-2.5">
      <span className="mt-0.5 text-texto-3">{icono}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium">{titulo}</div>
        <div className="text-[12.5px] text-texto-2">{texto}</div>
      </div>
      <span className="mt-0.5 shrink-0">
        {estado === 'ok' ? (
          <Check className="size-4 text-ok" />
        ) : estado === 'falta' ? (
          <AlertCircle className="size-4 text-error" />
        ) : estado === 'opcional' ? (
          <CircleMinus className="size-4 text-texto-3" />
        ) : (
          <RefreshCw className="size-4 animate-spin text-texto-3" />
        )}
      </span>
    </div>
  );
}
