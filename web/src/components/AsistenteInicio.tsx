import { useEffect, useId, useState } from 'react';
import { ArrowRight, FolderOpen, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { useCampos } from '../lib/estado';
import { Boton, cx } from './ui';
import { TarjetaMotor } from './TarjetaMotor';
import { Logo } from './Logo';

const PASOS = [
  { titulo: 'Te damos la bienvenida', nombre: 'Bienvenida' },
  { titulo: 'Conecta tus asistentes de IA', nombre: 'Asistentes de IA' },
  { titulo: 'Todo listo', nombre: 'Tu carpeta de apuntes' },
];

/** Asistente de primer arranque, a pantalla completa: comprueba Claude Code y Codex y explica cómo funciona la app. */
export function AsistenteInicio() {
  const { ajustes, motores, cargarMotores, cargarAjustes } = useCampos('ajustes', 'motores', 'cargarMotores', 'cargarAjustes');
  const [paso, setPaso] = useState(0);
  const [comprobando, setComprobando] = useState(false);
  const idTitulo = useId();
  const abierto = ajustes !== undefined && !ajustes.asistenteCompletado;

  const comprobar = async () => {
    setComprobando(true);
    try {
      await cargarMotores();
    } finally {
      setComprobando(false);
    }
  };

  // Mientras está en el paso de motores, vuelve a comprobar cada pocos segundos
  // (el usuario puede estar instalando o iniciando sesión en la terminal)
  useEffect(() => {
    if (!abierto || paso !== 1) return;
    const i = setInterval(() => cargarMotores().catch(() => {}), 5000);
    return () => clearInterval(i);
  }, [abierto, paso, cargarMotores]);

  const listos = motores?.filter((m) => m.instalado && m.sesion) ?? [];

  const terminar = async () => {
    await api.guardarAjustes({
      asistenteCompletado: true,
      motorPorDefecto: listos.some((m) => m.motor === 'claude') ? 'claude' : listos[0]?.motor ?? 'claude',
    });
    await cargarAjustes();
  };

  const ir = (n: number) => {
    setPaso(n);
    if (n === 1) comprobar();
  };

  if (!abierto) return null;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby={idTitulo} className="aparecer fixed inset-0 z-50 flex flex-wrap overflow-y-auto bg-fondo">
      <aside className="relative flex min-h-64 flex-[1_1_400px] flex-col lg:max-w-[600px] justify-between gap-10 overflow-hidden bg-acento px-[clamp(28px,4vw,56px)] py-12 text-white">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="pointer-events-none absolute -right-28 -bottom-24 size-[420px] opacity-[0.12]">
          <path d="M12 1c1 7 4 10 11 11-7 1-10 4-11 11-1-7-4-10-11-11 7-1 10-4 11-11Z" fill="currentColor" />
        </svg>
        <div className="relative flex items-center gap-3 font-titulo text-[22px] font-bold tracking-tight">
          <Logo invertido className="size-10" />
          Didavero
        </div>
        <div className="relative space-y-4">
          <p className="text-[15px] font-semibold text-white/85">Primer arranque · paso {paso + 1} de 3</p>
          <h1 id={idTitulo} className="text-[clamp(34px,3.6vw,50px)] leading-[1.04] font-bold tracking-tight">
            {PASOS[paso].titulo}
          </h1>
        </div>
        <nav aria-label="Pasos" className="relative">
          <ol className="space-y-1.5">
            {PASOS.map((p, i) => (
              <li key={p.nombre}>
                <button
                  type="button"
                  onClick={() => ir(i)}
                  disabled={i > paso}
                  aria-current={i === paso ? 'step' : undefined}
                  className={cx(
                    'flex min-h-12 w-full items-center gap-3.5 rounded-xl px-3 text-left font-semibold transition-colors cursor-pointer disabled:cursor-default',
                    i === paso ? 'bg-white/15' : i < paso ? 'hover:bg-white/10' : 'opacity-80',
                  )}
                >
                  <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-white/70 font-mono text-[13px]">{i + 1}</span>
                  {p.nombre}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </aside>

      <main className="flex min-w-0 flex-[2_1_560px] flex-col justify-center px-[clamp(24px,5vw,88px)] py-14">
        <div className="mx-auto w-full max-w-[620px] space-y-7">
          {paso === 0 && (
            <>
              <p className="text-[20px] leading-normal text-texto-2">
                Crea apuntes con un equipo de agentes de IA que investigan, redactan, revisan e ilustran en paralelo.
              </p>
              <ol className="space-y-3">
                {[
                  ['Crea una asignatura', 'Con su nivel, destinatarios y contexto.'],
                  ['Añade documentos de apuntes', 'Uno por tema o unidad. Aporta tu material o deja que los agentes investiguen.'],
                  ['Trabaja con los agentes', 'Pídeles el índice, la redacción, la revisión o los diagramas, y mira lo que hacen en directo.'],
                ].map(([t, d], i) => (
                  <li key={t} className="flex gap-4 rounded-2xl border border-borde bg-panel px-5 py-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-acento-suave font-bold text-acento-texto">{i + 1}</span>
                    <span>
                      <span className="block text-[16px] font-semibold">{t}</span>
                      <span className="text-texto-2">{d}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="flex justify-end">
                <Boton variante="primario" autoFocus onClick={() => ir(1)}>
                  Empezar
                  <ArrowRight className="size-4" />
                </Boton>
              </div>
            </>
          )}

          {paso === 1 && (
            <>
              <p className="text-[18px] leading-normal text-texto-2">
                La app usa Claude Code, Codex u OpenCode instalados en este equipo. Claude y Codex usan tu cuenta; OpenCode, el proveedor o modelo local que configures.
              </p>
              <div className="space-y-3">
                {motores ? (
                  motores.map((m) => <TarjetaMotor key={m.motor} estado={m} />)
                ) : (
                  <div className="py-8 text-center text-texto-3">Comprobando…</div>
                )}
              </div>
              <p className="flex items-center gap-2.5 text-[13.5px] text-texto-3">
                <span className="size-2 shrink-0 animate-pulse rounded-full bg-ok" />
                Se comprueba solo cada pocos segundos. Basta con un motor listo; las imágenes generadas con IA necesitan Codex.
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Boton variante="fantasma" icono={<RefreshCw className={comprobando ? 'size-4 animate-spin' : 'size-4'} />} onClick={comprobar}>
                  Volver a comprobar
                </Boton>
                <div className="flex gap-2">
                  {listos.length === 0 && (
                    <Boton variante="fantasma" onClick={() => setPaso(2)}>
                      Lo haré después
                    </Boton>
                  )}
                  <Boton variante="primario" disabled={listos.length === 0} onClick={() => setPaso(2)}>
                    Continuar
                    <ArrowRight className="size-4" />
                  </Boton>
                </div>
              </div>
            </>
          )}

          {paso === 2 && (
            <>
              <p className="text-[18px] leading-normal text-texto-2">
                Tus apuntes se guardan como archivos normales en tu equipo, así que puedes abrirlos, copiarlos o llevártelos cuando quieras.
              </p>
              <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-borde bg-panel px-5 py-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-acento-suave text-acento-texto">
                  <FolderOpen className="size-5" />
                </span>
                <span className="min-w-0 flex-[1_1_240px]">
                  <span className="block font-semibold">Carpeta de datos</span>
                  <span className="block font-mono text-[13px] break-all text-texto-2">{ajustes?.carpetaDatos}</span>
                </span>
                <Boton onClick={() => api.abrirCarpeta()}>Abrir carpeta</Boton>
              </div>
              <p className="text-texto-2">
                Puedes cambiar la carpeta, el número de agentes simultáneos y el motor por defecto en <b>Ajustes</b>, abajo a la izquierda.
                También puedes volver a ver esta pantalla desde allí.
              </p>
              <div className="flex justify-between gap-2">
                <Boton variante="fantasma" onClick={() => setPaso(1)}>
                  Atrás
                </Boton>
                <Boton variante="primario" autoFocus onClick={terminar}>
                  Empezar a crear apuntes
                </Boton>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
