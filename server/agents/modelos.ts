// Motor, modelo y esfuerzo de cada agente (como en Lumen): un ajuste global, que se puede cambiar en
// cualquier momento (cada llamada lee el vigente). El motor es Claude Code, Codex o ambos; con ambos,
// cada agente tiene su motor. Los perfiles de gasto rellenan modelo y esfuerzo de todos los agentes en
// los dos motores y después se puede ajustar cualquiera.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Ajustes, Esfuerzo, ModeloDisponible, ModelosDisponibles, Motor, PerfilGasto } from '../../shared/tipos';
import { openCodeModels } from './motores';
import { AGENTES } from './agentes';

export const ESFUERZOS: Esfuerzo[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const PERFILES: Record<PerfilGasto, string> = { ahorro: 'Ahorro', equilibrado: 'Equilibrado', calidad: 'Calidad' };

type Tabla = Record<string, [string, Esfuerzo]>;

// Perfil equilibrado. Criterio: cuánto pesa el agente en la calidad de los apuntes, cuántas veces se
// llama por documento y qué necesita.
// - Decisiones de alto impacto y pocas llamadas (índice director, investigación): el modelo más capaz.
// - La redacción, que se llama una vez por sección y decide la calidad: intermedio con esfuerzo alto.
// - Revisar datos (calidad), donde un error sale caro: intermedio con esfuerzo alto.
// - Diagramas y autoevaluación: intermedio con esfuerzo medio.
// - Tareas mecánicas o de criterio sencillo (estilo, propuestas de visuales, glosario): económico.
const EQUILIBRADO: Record<Exclude<Motor, 'opencode'>, Tabla> = {
  claude: {
    arquitecto: ['opus', 'high'],
    investigador: ['opus', 'medium'],
    redactor: ['sonnet', 'high'],
    calidad: ['sonnet', 'high'],
    fuentes: ['sonnet', 'medium'],
    ilustrador: ['sonnet', 'medium'],
    autoevaluacion: ['sonnet', 'medium'],
    examinador: ['sonnet', 'medium'],
    orquestador: ['sonnet', 'medium'],
    estilo: ['sonnet', 'low'],
    'director-visual': ['sonnet', 'low'],
    glosario: ['haiku', 'low'],
    curriculo: ['sonnet', 'medium'],
    diagnostico: ['sonnet', 'high'],
    transcriptor: ['sonnet', 'low'],
  },
  codex: {
    arquitecto: ['gpt-6-astra', 'high'],
    investigador: ['gpt-6-astra', 'medium'],
    redactor: ['gpt-6.1-sol', 'high'],
    calidad: ['gpt-6.1-sol', 'high'],
    fuentes: ['gpt-6.1-sol', 'medium'],
    ilustrador: ['gpt-6.1-sol', 'medium'],
    autoevaluacion: ['gpt-6.1-sol', 'medium'],
    examinador: ['gpt-6.1-sol', 'medium'],
    orquestador: ['gpt-6.1-sol', 'medium'],
    estilo: ['gpt-6-luna', 'low'],
    'director-visual': ['gpt-6.1-sol', 'low'],
    glosario: ['gpt-6-luna', 'low'],
    curriculo: ['gpt-6.1-sol', 'medium'],
    diagnostico: ['gpt-6.1-sol', 'high'],
    transcriptor: ['gpt-6.1-sol', 'low'],
  },
};
// Ahorro: recorta donde menos se nota (estilo, visuales, glosario, autoevaluación) y mantiene un modelo
// competente para el índice y la redacción.
const AHORRO: Record<Exclude<Motor, 'opencode'>, Tabla> = {
  claude: {
    arquitecto: ['sonnet', 'high'],
    investigador: ['sonnet', 'medium'],
    redactor: ['sonnet', 'medium'],
    calidad: ['sonnet', 'medium'],
    fuentes: ['sonnet', 'low'],
    ilustrador: ['sonnet', 'low'],
    autoevaluacion: ['sonnet', 'low'],
    examinador: ['sonnet', 'medium'],
    orquestador: ['sonnet', 'low'],
    estilo: ['haiku', 'low'],
    'director-visual': ['haiku', 'low'],
    glosario: ['haiku', 'low'],
    curriculo: ['sonnet', 'low'],
    diagnostico: ['sonnet', 'medium'],
    transcriptor: ['haiku', 'low'],
  },
  codex: {
    arquitecto: ['gpt-6.1-sol', 'high'],
    investigador: ['gpt-6.1-sol', 'medium'],
    redactor: ['gpt-6.1-sol', 'medium'],
    calidad: ['gpt-6.1-sol', 'medium'],
    fuentes: ['gpt-6.1-sol', 'low'],
    ilustrador: ['gpt-6.1-sol', 'low'],
    autoevaluacion: ['gpt-6.1-sol', 'low'],
    examinador: ['gpt-6.1-sol', 'medium'],
    orquestador: ['gpt-6.1-sol', 'low'],
    estilo: ['gpt-6-luna', 'low'],
    'director-visual': ['gpt-6-luna', 'medium'],
    glosario: ['gpt-6-luna', 'low'],
    curriculo: ['gpt-6.1-sol', 'low'],
    diagnostico: ['gpt-6.1-sol', 'medium'],
    transcriptor: ['gpt-6-luna', 'low'],
  },
};
// Calidad: sube los agentes que deciden el resultado sin disparar los que se llaman a menudo.
const CALIDAD: Record<Exclude<Motor, 'opencode'>, Tabla> = {
  claude: {
    arquitecto: ['opus', 'xhigh'],
    investigador: ['opus', 'high'],
    redactor: ['opus', 'medium'],
    calidad: ['opus', 'high'],
    fuentes: ['sonnet', 'high'],
    ilustrador: ['sonnet', 'high'],
    autoevaluacion: ['opus', 'medium'],
    examinador: ['opus', 'medium'],
    orquestador: ['opus', 'medium'],
    estilo: ['sonnet', 'medium'],
    'director-visual': ['sonnet', 'medium'],
    glosario: ['sonnet', 'low'],
    curriculo: ['opus', 'medium'],
    diagnostico: ['opus', 'high'],
    transcriptor: ['sonnet', 'medium'],
  },
  codex: {
    arquitecto: ['gpt-6-astra', 'xhigh'],
    investigador: ['gpt-6-astra', 'high'],
    redactor: ['gpt-6-astra', 'medium'],
    calidad: ['gpt-6-astra', 'high'],
    fuentes: ['gpt-6.1-sol', 'high'],
    ilustrador: ['gpt-6.1-sol', 'high'],
    autoevaluacion: ['gpt-6-astra', 'medium'],
    examinador: ['gpt-6-astra', 'medium'],
    orquestador: ['gpt-6-astra', 'medium'],
    estilo: ['gpt-6.1-sol', 'medium'],
    'director-visual': ['gpt-6.1-sol', 'medium'],
    glosario: ['gpt-6.1-sol', 'low'],
    curriculo: ['gpt-6-astra', 'medium'],
    diagnostico: ['gpt-6-astra', 'high'],
    transcriptor: ['gpt-6.1-sol', 'medium'],
  },
};
const PRESETS: Record<PerfilGasto, Record<Exclude<Motor, 'opencode'>, Tabla>> = { ahorro: AHORRO, equilibrado: EQUILIBRADO, calidad: CALIDAD };

/** Modelo y esfuerzo de todos los agentes en un motor según un perfil. */
export function preset(motor: Motor, perfil: PerfilGasto = 'equilibrado'): Record<string, { modelo: string; esfuerzo?: Esfuerzo }> {
  if (motor === 'opencode') return Object.fromEntries(Object.keys(AGENTES).map((id) => [id, { modelo: '' }]));
  const tabla = { ...EQUILIBRADO[motor], ...PRESETS[perfil][motor] };
  return Object.fromEntries(Object.entries(tabla).map(([agente, [modelo, esfuerzo]]) => [agente, { modelo, esfuerzo }]));
}

const MODELOS_CLAUDE: ModeloDisponible[] = [
  { id: 'haiku', nombre: 'Haiku', descripcion: 'Rápido y económico; tareas simples.', esfuerzos: [] },
  { id: 'sonnet', nombre: 'Sonnet', descripcion: 'Equilibrio entre calidad y coste.', esfuerzos: ESFUERZOS },
  { id: 'opus', nombre: 'Opus', descripcion: 'Máxima calidad para planificar y redactar.', esfuerzos: ESFUERZOS },
  { id: 'fable', nombre: 'Fable', descripcion: 'El más capaz; consumo alto.', esfuerzos: ESFUERZOS },
];

/** Modelos de cada motor. Los de Codex se leen de su caché local (los que muestra su selector). */
export async function modelosDisponibles(): Promise<ModelosDisponibles> {
  let codex: ModeloDisponible[] = ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'].map((id) => ({ id, nombre: id, esfuerzos: ESFUERZOS }));
  try {
    const cache = JSON.parse(readFileSync(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'models_cache.json'), 'utf8'));
    const lista = ((cache.models ?? []) as any[])
      .filter((m) => m.visibility === 'list')
      .map((m) => ({
        id: String(m.slug),
        nombre: String(m.display_name || m.slug),
        descripcion: m.description ? String(m.description) : undefined,
        esfuerzos: ((m.supported_reasoning_levels ?? []) as any[]).map((l) => l.effort).filter((e): e is Esfuerzo => ESFUERZOS.includes(e)),
      }));
    if (lista.length) codex = lista;
  } catch {}
  return { claude: MODELOS_CLAUDE, codex, opencode: [{ id: '', nombre: 'Modelo configurado en OpenCode', esfuerzos: [] }, ...(await openCodeModels()).map((id) => ({ id, nombre: id, esfuerzos: [] }))], esfuerzos: ESFUERZOS, perfiles: PERFILES };
}

/** Motor de un agente según el modo elegido (sin tener en cuenta si está instalado). */
export function motorElegido(ajustes: Ajustes, agente: string): Motor {
  const info = AGENTES[agente];
  if (info?.soloMotor) return info.soloMotor;
  const modo = ajustes.modoMotor ?? 'ambos';
  if (modo !== 'ambos') return modo;
  return ajustes.agentes[agente]?.motor ?? info?.motor ?? 'claude';
}

/** Modelo y esfuerzo con los que se lanza un agente en un motor. */
export function modeloDe(ajustes: Ajustes, agente: string, motor: Motor): { modelo?: string; esfuerzo?: Esfuerzo } {
  const propio = ajustes.modelos?.[motor]?.[agente];
  const base = preset(motor, ajustes.perfil ?? 'equilibrado')[agente];
  const r: { modelo?: string; esfuerzo?: Esfuerzo } = { modelo: propio?.modelo ?? base?.modelo, esfuerzo: propio?.esfuerzo ?? base?.esfuerzo };
  if (motor === 'opencode') r.esfuerzo = undefined;
  // Haiku no admite nivel de esfuerzo
  if (motor === 'claude' && r.modelo === 'haiku') r.esfuerzo = undefined;
  return r;
}
