import type { EventoTrabajo, Trabajo } from '../../../shared/tipos';

export function mergeJobEvents(...groups: EventoTrabajo[][]): EventoTrabajo[] {
  const seen = new Set<string>();
  return groups.flat().filter(event => {
    const key = JSON.stringify([event.t, event.tipo, event.texto]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => a.t - b.t).slice(-400);
}

/** Keep frames received while REST was loading, without inventing a job for an orphan event. */
export function mergeJobSnapshot(snapshot: Trabajo[], current: Record<string, Trabajo>): Record<string, Trabajo> {
  const result: Record<string, Trabajo> = Object.assign(Object.create(null), Object.fromEntries(snapshot.map(job => [job.id, job])));
  for (const job of Object.values(current)) {
    const captured = result[job.id];
    const metadata = captured && ['ok', 'error', 'cancelado'].includes(captured.estado) && !['ok', 'error', 'cancelado'].includes(job.estado) ? captured : job;
    result[job.id] = { ...metadata, eventos: mergeJobEvents(captured?.eventos ?? [], job.eventos) };
  }
  return result;
}

export function reconnectDelay(attempt: number, random = Math.random()): number {
  return Math.round(Math.min(30000, 1500 * 2 ** Math.min(attempt, 5)) * (0.8 + random * 0.4));
}
