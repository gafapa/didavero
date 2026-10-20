import { ENGINE_NAMES } from '../../../shared/engines';
// Avisos del sistema (fuera de la app) cuando la ventana no está a la vista: una fase que termina,
// un agente que falla o no da señales, o el límite de uso agotado. Los trabajos de una misma fase
// (p. ej. los redactores de cada sección) se agrupan en un solo aviso al terminar el último.
import type { Motor, PasoFlujo, Trabajo, UsoSuscripcion } from '../../../shared/tipos';
import type { AsignaturaResumen } from './api';

const NOMBRE_PASO: Partial<Record<PasoFlujo, string>> = {
  programacion: 'La programación',
  investigacion: 'La investigación',
  indice: 'El índice',
  redaccion: 'La redacción',
  revision: 'La revisión',
  visuales: 'Los visuales',
  autoevaluacion: 'La autoevaluación',
  glosario: 'El glosario',
  curriculo: 'El currículo',
  fuentes: 'La búsqueda de fuentes',
  importacion: 'La importación',
  diagnostico: 'El diagnóstico',
};

/** Trabajos terminados de cada fase en curso, hasta que termina el último. */
const lotes = new Map<string, { ok: number; error: number }>();

const clave = (t: Trabajo) => `${t.asignatura}/${t.documento ?? ''}/${t.paso ?? t.id}`;

function enSegundoPlano() {
  return typeof document !== 'undefined' && (document.hidden || !document.hasFocus());
}

function mostrar(titulo: string, cuerpo: string, ruta?: string) {
  if (!enSegundoPlano() || typeof Notification === 'undefined') return;
  const crear = () => {
    const n = new Notification(titulo, { body: cuerpo, silent: false });
    n.onclick = () => {
      window.focus();
      if (ruta) location.hash = ruta;
      n.close();
    };
  };
  if (Notification.permission === 'granted') crear();
  else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => p === 'granted' && crear());
}

function tituloDocumento(t: Trabajo, asignaturas: AsignaturaResumen[]) {
  const a = asignaturas.find((x) => x.id === t.asignatura);
  return (t.documento && a?.documentos.find((d) => d.id === t.documento)?.titulo) || a?.nombre || '';
}

/** Llamar con cada cambio de un trabajo (y el estado anterior que se conocía de él). */
export function avisarTrabajo(previo: Trabajo | undefined, t: Trabajo, todos: Record<string, Trabajo>, asignaturas: AsignaturaResumen[]) {
  const ruta = `#/${t.asignatura}${t.documento ? `/${t.documento}` : ''}`;
  const doc = tituloDocumento(t, asignaturas);
  if (t.inactivo && !previo?.inactivo) {
    mostrar('Un agente no da señales', `${t.nombreAgente}: ${t.titulo}${doc ? ` («${doc}»)` : ''}. Puedes esperar o empezar de nuevo.`, ruta);
  }
  const termina = (t.estado === 'ok' || t.estado === 'error') && previo && previo.estado !== t.estado && (previo.estado === 'ejecutando' || previo.estado === 'en-cola');
  if (!termina) return;
  const k = clave(t);
  const lote = lotes.get(k) ?? { ok: 0, error: 0 };
  lote[t.estado === 'ok' ? 'ok' : 'error']++;
  lotes.set(k, lote);
  const quedan = Object.values(todos).some((x) => x.id !== t.id && clave(x) === k && (x.estado === 'ejecutando' || x.estado === 'en-cola'));
  if (quedan) return;
  lotes.delete(k);
  const total = lote.ok + lote.error;
  const fase = t.paso && t.paso !== 'chat' ? NOMBRE_PASO[t.paso] : undefined;
  if (fase && total > 1) {
    mostrar(
      lote.error ? `${fase} ha terminado con errores` : `${fase} ha terminado`,
      `${doc ? `«${doc}»: ` : ''}${lote.ok} de ${total} trabajos bien${lote.error ? `, ${lote.error} con errores` : ''}.`,
      ruta,
    );
  } else {
    mostrar(t.estado === 'ok' ? `${t.nombreAgente} ha terminado` : `${t.nombreAgente} ha fallado`, `${t.titulo}${doc ? ` («${doc}»)` : ''}`, ruta);
  }
}

/** Avisa cuando un motor se queda sin uso de la suscripción. */
export function avisarUso(previo: UsoSuscripcion | undefined, uso: UsoSuscripcion) {
  for (const [m, hasta] of Object.entries(uso.pausas ?? {}) as [Motor, number][]) {
    if (!hasta || previo?.pausas?.[m]) continue;
    const hora = new Date(hasta).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    mostrar(`Límite de uso de ${ENGINE_NAMES[m]} agotado`, `Los agentes esperan y seguirán solos a las ${hora}.`);
  }
}
