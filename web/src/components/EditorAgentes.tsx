// Agentes de la aplicación (como en Lumen): con qué motor trabajan (Claude Code, Codex o ambos) y qué
// modelo y esfuerzo usa cada uno. Es un ajuste global que se guarda al cambiarlo y se aplica a la
// siguiente llamada de cada agente, en todas las asignaturas.
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, ChevronDown, Loader2, RotateCcw } from 'lucide-react';
import type { Ajustes, Esfuerzo, InfoAgente, ModelosDisponibles, Motor, PerfilGasto } from '../../../shared/tipos';
import { api } from '../lib/api';
import { useEstado, useCampos } from '../lib/estado';
import { abreviar } from '../lib/formato';
import { AreaTexto, cx } from './ui';

type Modelos = ModelosDisponibles & { predeterminados: Record<Motor, Record<string, { modelo: string; esfuerzo?: Esfuerzo }>> };
type Config = Pick<Ajustes, 'modoMotor' | 'modelos' | 'agentes'>;

const MOTORES: [NonNullable<Ajustes['modoMotor']>, string, string][] = [
  ['claude', 'Claude Code', '✳'],
  ['codex', 'Codex', '⌘'],
  ['opencode', 'OpenCode', 'Oc'],
  ['ambos', 'Por agente', '✳⌘'],
];
const NOMBRE_ESFUERZO: Record<Esfuerzo, string> = { low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto', max: 'Máximo' };

export function EditorAgentes() {
  const { ajustes, motores, tokens, avisar } = useCampos('ajustes', 'motores', 'tokens', 'avisar');
  const [modelos, setModelos] = useState<Modelos>();
  const [agentes, setAgentes] = useState<InfoAgente[]>([]);
  const [config, setConfig] = useState<Config>();
  const [estado, setEstado] = useState<'idle' | 'guardando' | 'guardado' | 'error'>('idle');
  const [abierto, setAbierto] = useState<string>();
  const guardado = useRef('');

  const cargarModelos = () => api.modelos().then(setModelos).catch((e) => avisar(e.message, 'error'));
  useEffect(() => {
    cargarModelos();
    api.agentes().then(setAgentes).catch(() => {});
  }, []);
  // Valor inicial (y cuando cambia desde fuera, p. ej. al aplicar un perfil)
  useEffect(() => {
    if (!ajustes || config) return;
    const c = { modoMotor: ajustes.modoMotor ?? 'ambos', modelos: ajustes.modelos ?? {}, agentes: ajustes.agentes ?? {} };
    guardado.current = JSON.stringify(c);
    setConfig(c);
  }, [ajustes, config]);

  // Autoguardado: cuando deja de cambiar durante 700 ms
  useEffect(() => {
    if (!config) return;
    const actual = JSON.stringify(config);
    if (actual === guardado.current) return;
    const t = setTimeout(async () => {
      setEstado('guardando');
      try {
        const r = await api.guardarAjustes(config);
        guardado.current = actual;
        useEstado.setState({ ajustes: r });
        setEstado('guardado');
      } catch (e) {
        setEstado('error');
        avisar((e as Error).message, 'error');
      }
    }, 700);
    return () => clearTimeout(t);
  }, [config]);

  if (!modelos || !config || !agentes.length) return <div className="py-10 text-center text-sm text-texto-3">Cargando agentes…</div>;

  const listo = (m: Motor) => !!motores?.find((x) => x.motor === m && x.instalado && x.sesion);
  const disponible = (k: NonNullable<Ajustes['modoMotor']>) => (k === 'ambos' ? motores?.some((engine) => engine.instalado && engine.sesion) : listo(k));
  const motorDe = (ag: InfoAgente): Motor => ag.soloMotor ?? (config.modoMotor === 'ambos' ? (config.agentes[ag.id]?.motor ?? ag.motor) : config.modoMotor!);
  const actualDe = (ag: InfoAgente, m: Motor) => config.modelos?.[m]?.[ag.id] ?? modelos.predeterminados[m][ag.id];
  const fijar = (ag: InfoAgente, m: Motor, cambios: { modelo?: string; esfuerzo?: Esfuerzo }) => {
    const previo = actualDe(ag, m) ?? { modelo: modelos[m][0]?.id };
    setConfig({ ...config, modelos: { ...config.modelos, [m]: { ...config.modelos?.[m], [ag.id]: { ...previo, ...cambios } } } });
  };
  const fijarAgente = (id: string, c: Partial<Ajustes['agentes'][string]>) => {
    const nuevo = { ...config.agentes[id], ...c };
    const agentesNuevos = { ...config.agentes };
    if (!nuevo.motor && !nuevo.instrucciones?.trim()) delete agentesNuevos[id];
    else agentesNuevos[id] = { motor: nuevo.motor, instrucciones: nuevo.instrucciones };
    setConfig({ ...config, agentes: agentesNuevos });
  };
  const aplicarPerfil = async (p: PerfilGasto) => {
    try {
      const r = await api.aplicarPerfil(p);
      useEstado.setState({ ajustes: r });
      const c = { ...config, modelos: r.modelos ?? {} };
      guardado.current = JSON.stringify(c);
      setConfig(c);
      await cargarModelos();
      avisar(`Perfil «${modelos.perfiles[p]}» aplicado a todos los agentes`, 'ok');
    } catch (e) {
      avisar((e as Error).message, 'error');
    }
  };

  return (
    <div className="max-h-[62vh] space-y-5 overflow-y-auto pr-1">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-[13px] text-texto-2">
          Con qué motor trabaja cada agente y con qué modelo y esfuerzo. Vale para todas las asignaturas y se puede cambiar en cualquier momento:
          se aplica a la siguiente llamada de cada agente.
        </p>
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-texto-3">
          {estado === 'guardando' ? (
            <>
              <Loader2 className="size-3 animate-spin" /> Guardando…
            </>
          ) : estado === 'guardado' ? (
            <>
              <Check className="size-3 text-ok" /> Guardado
            </>
          ) : estado === 'error' ? (
            <span className="text-error">No se pudo guardar</span>
          ) : (
            'Se guarda automáticamente'
          )}
        </span>
      </div>

      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" aria-label="Motor de los agentes">
        {MOTORES.map(([k, nombre, simbolo]) => {
          const ok = disponible(k);
          const elegido = config.modoMotor === k;
          return (
            <button
              key={k}
              disabled={!ok && !elegido}
              aria-pressed={elegido}
              onClick={() => setConfig({ ...config, modoMotor: k })}
              className={cx(
                'relative flex flex-col gap-1 rounded-xl border p-3.5 text-left transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
                elegido ? 'border-acento bg-acento-suave' : 'border-borde hover:border-acento/50',
              )}
            >
              <span className="text-lg text-acento-texto">{simbolo}</span>
              <span className="text-sm font-semibold">{nombre}</span>
              <span className="text-[12px] text-texto-3">
                {ok ? (k === 'ambos' ? 'Cada agente con el motor que elijas' : 'Sesión disponible') : k === 'ambos' ? 'Necesita un motor listo' : 'Sin sesión iniciada'}
              </span>
              {elegido && <CheckCircle2 className="absolute top-3 right-3 size-4 text-acento-texto" />}
            </button>
          );
        })}
      </section>
      {!disponible(config.modoMotor ?? 'ambos') && (
        <p className="flex items-center gap-1.5 text-[12.5px] text-error">
          <AlertCircle className="size-3.5" /> El motor elegido no tiene sesión iniciada: los agentes usarán otro motor disponible mientras tanto.
        </p>
      )}

      <section>
        <h3 className="text-sm font-semibold">Perfil de gasto</h3>
        <p className="mt-1 text-[12.5px] text-texto-2">
          Rellena el modelo y el esfuerzo de todos los agentes en Claude y Codex. OpenCode conserva el modelo que hayas elegido. «Equilibrado» reserva el modelo más capaz para lo que decide el
          resultado y se llama poco (índice director, investigación), usa uno intermedio con esfuerzo alto donde se juega la calidad (redacción,
          revisión de datos) y el más económico para tareas sencillas (glosario, estilo). «Ahorro» recorta donde menos se nota; «Calidad» sube los
          agentes decisivos. Después puedes ajustar cualquier agente.
        </p>
        <div className="mt-2.5 flex gap-2">
          {(Object.entries(modelos.perfiles) as [PerfilGasto, string][]).map(([k, nombre]) => (
            <button
              key={k}
              onClick={() => aplicarPerfil(k)}
              className={cx(
                'h-8 rounded-lg px-3.5 text-[13px] font-medium transition-colors cursor-pointer',
                (ajustes?.perfil ?? 'equilibrado') === k ? 'bg-acento text-white hover:bg-acento-2' : 'border border-borde hover:bg-panel-2',
              )}
            >
              {nombre}
            </button>
          ))}
        </div>
      </section>

      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-borde text-left text-[11.5px] text-texto-3">
            <th className="py-2 pr-3 font-medium">Agente</th>
            {config.modoMotor === 'ambos' && <th className="py-2 pr-3 font-medium">Motor</th>}
            <th className="py-2 pr-3 font-medium">Modelo</th>
            <th className="py-2 pr-3 font-medium">Esfuerzo</th>
            <th className="py-2 font-medium">Consumo</th>
          </tr>
        </thead>
        <tbody>
          {agentes.map((ag) => {
            const m = motorDe(ag);
            const lista = modelos[m];
            const actual = actualDe(ag, m);
            const modelo = lista.find((x) => x.id === actual?.modelo);
            const esfuerzos = m === 'opencode' ? [] : modelo ? modelo.esfuerzos : modelos.esfuerzos;
            const uso = tokens?.porAgente?.[ag.id];
            const esteAbierto = abierto === ag.id;
            const instrucciones = config.agentes[ag.id]?.instrucciones;
            const selector = 'h-7 max-w-[13rem] rounded-md border border-borde bg-panel px-1.5 text-[12.5px] outline-none focus:border-acento cursor-pointer';
            return [
              <tr key={ag.id} className={cx('align-top', !esteAbierto && 'border-b border-borde')}>
                <td className="py-2 pr-3">
                  <button onClick={() => setAbierto(esteAbierto ? undefined : ag.id)} className="flex items-start gap-1.5 text-left cursor-pointer">
                    <ChevronDown className={cx('mt-0.5 size-3.5 shrink-0 text-texto-3 transition-transform', esteAbierto && 'rotate-180')} />
                    <span>
                      <span className="font-medium">{ag.nombre}</span>
                      {instrucciones?.trim() && <span className="ml-1.5 text-[11px] text-acento-texto">instrucciones propias</span>}
                      <span className="block text-[11.5px] text-texto-3">{ag.descripcion}</span>
                    </span>
                  </button>
                </td>
                {config.modoMotor === 'ambos' && (
                  <td className="py-2 pr-3">
                    <select
                      aria-label={`Motor de ${ag.nombre}`}
                      className={selector}
                      value={m}
                      disabled={!!ag.soloMotor}
                      onChange={(e) => fijarAgente(ag.id, { motor: e.target.value as Motor })}
                    >
                      <option value="claude">Claude Code</option>
                      <option value="codex">Codex</option>
                      <option value="opencode">OpenCode</option>
                    </select>
                  </td>
                )}
                <td className="py-2 pr-3">
                  <select
                    aria-label={`Modelo de ${ag.nombre}`}
                    className={selector}
                    value={actual?.modelo ?? ''}
                    title={modelo?.descripcion ?? actual?.modelo}
                    onChange={(e) => fijar(ag, m, { modelo: e.target.value })}
                  >
                    {!modelo && actual?.modelo && <option value={actual.modelo}>{actual.modelo}</option>}
                    {lista.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nombre}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3">
                  {esfuerzos.length ? (
                    <select
                      aria-label={`Esfuerzo de ${ag.nombre}`}
                      className={selector}
                      value={actual?.esfuerzo ?? 'medium'}
                      onChange={(e) => fijar(ag, m, { esfuerzo: e.target.value as Esfuerzo })}
                    >
                      {esfuerzos.map((e) => (
                        <option key={e} value={e}>
                          {NOMBRE_ESFUERZO[e]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-[12px] text-texto-3">No aplica</span>
                  )}
                </td>
                <td className="py-2 text-[12px] text-texto-3">
                  {uso ? (
                    <span title={`${uso.entrada.toLocaleString('es')} tokens de entrada (${uso.cache.toLocaleString('es')} de caché) · ${uso.salida.toLocaleString('es')} de salida`}>
                      {uso.llamadas} llamadas · {abreviar(uso.entrada)} entrada · {abreviar(uso.salida)} salida
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>,
              esteAbierto && (
                <tr key={`${ag.id}-instrucciones`} className="border-b border-borde">
                  <td colSpan={config.modoMotor === 'ambos' ? 5 : 4} className="pb-3">
                    <div className="mb-1.5 text-[12px] text-texto-3">
                      Instrucciones del agente (su papel y su criterio). El formato de lo que entrega lo controla la app, así que puedes cambiarlas con libertad.
                    </div>
                    <AreaTexto
                      rows={7}
                      className="font-mono text-[12.5px]"
                      value={instrucciones ?? ag.instrucciones}
                      onChange={(e) => fijarAgente(ag.id, { instrucciones: e.target.value === ag.instrucciones ? undefined : e.target.value })}
                    />
                    {ag.id === 'ilustrador' && (
                      <p className="mt-1.5 text-[12px] text-texto-3">Las imágenes generadas con IA siempre usan Codex, sea cual sea el motor elegido.</p>
                    )}
                    {instrucciones?.trim() && (
                      <button
                        onClick={() => fijarAgente(ag.id, { instrucciones: undefined })}
                        className="mt-2 flex items-center gap-1.5 text-[12px] text-texto-3 hover:text-acento-texto cursor-pointer"
                      >
                        <RotateCcw className="size-3" /> Restaurar las instrucciones originales
                      </button>
                    )}
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
