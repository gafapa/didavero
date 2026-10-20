// Flujo de trabajo de un documento: lanza los agentes de cada fase y procesa sus resultados.
//
// Reparto de responsabilidades para que varios agentes trabajen a la vez sin pisarse:
// - Cada redactor escribe solo su sección; el investigador, solo investigacion.md.
// - Los agentes que proponen cosas (índice, sugerencias, visuales) escriben un JSON propio
//   en .agentes/ y es el servidor quien lo valida y lo incorpora (único escritor).
import path from 'node:path';
import type { Trabajo } from '../shared/tipos';
import type { Postproceso } from './agents/cola';
import { incorporarResultados } from './buscador';
import { ProgrammeFlow } from './fases/programme';
import { instantaneaDocumento } from './fases/utilidades';
import type { Dependencias } from './fases/utilidades';
import { ErrorUsuario } from './store';

export type { AmbitoChat, TipoVersion } from './fases/utilidades';

/**
 * Flujo completo de un documento. Cada fase está en su archivo de server/fases/, encadenadas por
 * herencia (base → preparación → escritura → visuales → actividades → importación → asignatura →
 * exámenes);
 * aquí se conectan los manejadores de la cola y se procesan los resultados de los agentes.
 */
export class Flujo extends ProgrammeFlow {
  constructor(dep: Dependencias) {
    super(dep);
    dep.cola.manejadores = {
      antesDeEjecutar: async job => {
        if (!job.documento || !dep.gastoDocumento) return;
        const document = await this.almacen.obtenerDocumento(job.asignatura, job.documento);
        if (document.presupuesto && dep.gastoDocumento(job.asignatura, job.documento) >= document.presupuesto) throw new ErrorUsuario('El apunte ha alcanzado su tope de tokens. Revisa el presupuesto antes de reintentar.');
      },
      alTerminar: (t, post) => this.postprocesar(t, post),
      alFallar: (t, post) => this.alFallarPost(t, post),
      alReintentar: (t, post) => this.alReintentarPost(t, post),
    };
  }


  protected postprocesar(t: Trabajo, post: Postproceso): Promise<string | void> {
    const datos = post.datos ?? {};
    switch (post.tipo) {
      case 'programme-units':
        return this.acceptProgrammeUnits(t, datos);
      case 'programme-research':
        return this.acceptProgrammeResearch(t, datos);
      case 'programme':
        return this.acceptProgramme(t, datos);
      case 'busqueda': {
        const dir = this.dirBusqueda(t.asignatura, t.documento);
        return incorporarResultados(dir, path.join(dir, String(datos.salida)), String(datos.consulta)).then((n) =>
          n ? `${n} fuente${n === 1 ? '' : 's'} encontrada${n === 1 ? '' : 's'}. Elige cuáles añadir.` : 'No ha encontrado fuentes nuevas',
        );
      }
      case 'investigacion':
        return this.postInvestigacion(t, datos);
      case 'indice':
        return this.postIndice(t, datos);
      case 'revision':
        return this.postRevision(t, datos);
      case 'visuales':
        return this.postVisuales(t, datos);
      case 'diagrama':
        return this.postDiagrama(t, datos);
      case 'imagen-ia':
        return this.postImagenIa(t, datos);
      case 'molecula':
        return this.postMolecula(t, datos);
      case 'actividad':
        return this.postActividad(t, datos);
      case 'examen':
        return this.postExamen(t, datos);
      case 'examen-pregunta':
        return this.postPreguntaExamen(t, datos);
      case 'ambito':
        return this.restaurarFueraDeAmbito(t, datos).then((d) =>
          d.length ? `Hecho. Se han deshecho los cambios fuera de la pestaña «${datos.nombre}»: ${d.join(', ')}` : undefined,
        );
      case 'curriculo':
        return this.postStructuredCurriculum(t, datos);
      case 'seleccion':
        return this.postSeleccion(t, datos);
      case 'imagen-web':
        return this.postImagenWeb(t, datos);
      case 'transcripcion':
        return this.postTranscripcion(t, datos);
      case 'diagnostico':
        return this.postDiagnostico(t, datos);
      default:
        return Promise.resolve();
    }
  }

  protected async alFallarPost(t: Trabajo, post: Postproceso) {
    if (post.tipo === 'ambito') {
      await this.restaurarFueraDeAmbito(t, post.datos ?? {}).catch(() => {});
      return;
    }
    if (post.tipo === 'examen') {
      await this.alFallarExamen(t, post.datos ?? {});
      return;
    }
    if (post.tipo === 'actividad' && t.documento) {
      const ultimo = t.eventos.filter((e) => e.tipo === 'error').at(-1)?.texto;
      await this.cambiarActividades(t.asignatura, t.documento, (l) => {
        const b = l.find((x) => x.id === String(post.datos?.id));
        if (b) Object.assign(b, { estado: 'error', error: t.estado === 'cancelado' ? 'Cancelado' : ultimo ?? 'No se pudo generar' });
      }).catch(() => {});
      return;
    }
    if (post.tipo === 'investigacion' && t.documento) {
      await this.marcarPreguntas(t.asignatura, t.documento, (post.datos?.preguntas as string[]) ?? [], 'segun-dossier').catch(() => {});
      return;
    }
    if (!['diagrama', 'grafica', 'mapa', 'molecula', 'imagen-ia', 'imagen-web'].includes(post.tipo) || !t.documento) return;
    const ultimoError = t.eventos.filter((e) => e.tipo === 'error').at(-1)?.texto;
    await this.cambiarPropuesta(t.asignatura, t.documento, String(post.datos?.id), {
      estado: 'error',
      error: t.estado === 'cancelado' ? 'Cancelado' : ultimoError ?? 'No se pudo generar',
    }).catch(() => {});
  }

  /** Antes de reintentar un trabajo fallido: lo que alFallarPost marcó como error vuelve a «en curso». */
  protected async alReintentarPost(t: Trabajo, post: Postproceso) {
    if (post.tipo === 'examen') return this.alReintentarExamen(t, post.datos ?? {});
    if (!t.documento) return;
    const { asignatura: asig, documento: doc } = t;
    if (post.tipo === 'ambito') {
      // Nueva copia de partida para deshacer lo que toque fuera de la pestaña
      this.instantaneas.set(t.id, await instantaneaDocumento(this.almacen.dirDocumento(asig, doc)));
    } else if (post.tipo === 'actividad') {
      await this.cambiarActividades(asig, doc, (l) => {
        const b = l.find((x) => x.id === String(post.datos?.id));
        if (b) Object.assign(b, { estado: 'generando', error: undefined });
      });
    } else if (post.tipo === 'investigacion') {
      await this.marcarPreguntas(asig, doc, (post.datos?.preguntas as string[]) ?? [], 'investigando');
    } else if (['diagrama', 'grafica', 'mapa', 'molecula', 'imagen-ia', 'imagen-web'].includes(post.tipo)) {
      await this.cambiarPropuesta(asig, doc, String(post.datos?.id), { estado: 'generando', error: undefined });
    }
  }
}
