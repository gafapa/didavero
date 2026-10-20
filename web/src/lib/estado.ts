// Estado global de la interfaz y conexión WebSocket con el servidor.
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { Ajustes, ContadorTokens, EstadoMotor, EventoTrabajo, MensajeWS, SeleccionTexto, Trabajo, UsoSuscripcion } from '../../../shared/tipos';
import { mergeJobEvents, mergeJobSnapshot, reconnectDelay } from './jobEvents';
import { api, type AsignaturaResumen } from './api';
import { avisarTrabajo, avisarUso } from './notificaciones';

export interface Aviso {
  id: number;
  texto: string;
  tipo: 'ok' | 'error' | 'info';
}

interface Seleccion {
  asignatura?: string;
  documento?: string;
}

interface Estado {
  asignaturas: AsignaturaResumen[];
  seleccion: Seleccion;
  trabajos: Record<string, Trabajo>;
  uso?: UsoSuscripcion;
  tokens?: ContadorTokens;
  motores?: EstadoMotor[];
  ajustes?: Ajustes;
  /** Contador por "asignatura/documento" que aumenta cuando cambian sus archivos en disco. */
  versiones: Record<string, number>;
  ultimaRuta?: string;
  avisos: Aviso[];
  conectado: boolean;
  /** Abrir la pantalla de requisitos (desde Ajustes, aunque esté oculta). */
  verRequisitos?: boolean;
  /** Aumenta cada vez que se recupera la conexión con el servidor: las vistas vuelven a cargar sus datos. */
  reconexion: number;
  /** Fragmento seleccionado en la vista previa: el chat de la derecha actúa solo sobre él. */
  seleccionTexto?: SeleccionTexto;
  /** Cambia al pulsar «Pedir cambios» en una figura: el panel de agentes se abre y pone el cursor en el chat. */
  enfocarChat?: number;
  /** Sección abierta en el editor (se envía como contexto a los agentes). */
  seccionActiva?: string;
  /** Petición de abrir una sección en el editor (desde el flujo). */
  irASeccion?: string;
  actualizacion?: { estado: 'disponible' | 'descargada'; version: string };
  /** Vista abierta en cada documento («asignatura/documento» → fase o pestaña). */
  vistas: Record<string, string>;
  elegirVista(clave: string, vista: string): void;

  cargarAsignaturas(): Promise<void>;
  seleccionar(s: Seleccion): void;
  cargarMotores(): Promise<EstadoMotor[]>;
  cargarAjustes(): Promise<void>;
  avisar(texto: string, tipo?: Aviso['tipo']): void;
  quitarAviso(id: number): void;
}

function leerHash(): Seleccion {
  const [a, d] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { asignatura: a || undefined, documento: d || undefined };
}

let idAviso = 0;

export const useEstado = create<Estado>((set, get) => ({
  asignaturas: [],
  seleccion: leerHash(),
  trabajos: {},
  versiones: {},
  avisos: [],
  conectado: false,
  reconexion: 0,
  vistas: {},

  elegirVista(clave, vista) {
    set({ vistas: { ...get().vistas, [clave]: vista } });
    try {
      localStorage.setItem(`vista:${clave}`, vista);
    } catch {}
  },

  async cargarAsignaturas() {
    try {
      set({ asignaturas: await api.asignaturas() });
    } catch (e) {
      get().avisar(String((e as Error).message), 'error');
    }
  },

  seleccionar(s) {
    const hash = s.asignatura ? `#/${encodeURIComponent(s.asignatura)}${s.documento ? '/' + encodeURIComponent(s.documento) : ''}` : '#/';
    if (location.hash !== hash) history.pushState(null, '', hash);
    set({ seleccion: s });
  },

  async cargarMotores() {
    const motores = await api.motores();
    set({ motores });
    return motores;
  },

  async cargarAjustes() {
    set({ ajustes: await api.ajustes() });
  },

  avisar(texto, tipo = 'info') {
    const id = ++idAviso;
    set({ avisos: [...get().avisos, { id, texto, tipo }] });
    setTimeout(() => get().quitarAviso(id), tipo === 'error' ? 7000 : 3500);
  },

  quitarAviso(id) {
    set({ avisos: get().avisos.filter((a) => a.id !== id) });
  },
}));

/**
 * Solo los campos indicados del estado. El componente se vuelve a dibujar cuando cambia alguno de
 * ellos y no con cada mensaje del servidor: cada paso de cada agente cambia `trabajos`, y con
 * `useEstado()` a secas se redibujaba la app entera varias veces por segundo.
 */
export function useCampos<K extends keyof Estado>(...campos: K[]): Pick<Estado, K> {
  return useEstado(useShallow((s) => Object.fromEntries(campos.map((c) => [c, s[c]])) as Pick<Estado, K>));
}

window.addEventListener('popstate', () => useEstado.setState({ seleccion: leerHash() }));

// ---------- WebSocket ----------

let recargaAsignaturas: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempts = 0;

function conectar() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  const pendingEvents = new Map<string, EventoTrabajo[]>();
  const changedJobs: Record<string, Trabajo> = Object.create(null);
  const removedJobs = new Set<string>();
  let active = true;
  ws.onopen = async () => {
    reconnectAttempts = 0;
    // Si el servidor se reinició (p. ej. en el modo en vivo), lo que se cargó mientras estaba caído
    // falló: las vistas lo vuelven a pedir
    useEstado.setState((s) => ({ conectado: true, reconexion: s.reconexion + 1 }));
    // Al (re)conectar se recupera todo: el servidor puede haberse reiniciado
    const e = useEstado.getState();
    e.cargarAsignaturas();
    e.cargarAjustes().catch(() => {});
    e.cargarMotores().catch(() => {});
    api.tokens().then((tokens) => useEstado.setState({ tokens })).catch(() => {});
    const lista = await api.trabajos().catch(() => Object.values(useEstado.getState().trabajos));
    if (!active) return;
    const merged = mergeJobSnapshot(lista, changedJobs);
    for (const [id, events] of pendingEvents) if (merged[id]) { merged[id].eventos = mergeJobEvents(merged[id].eventos, events); pendingEvents.delete(id); }
    for (const id of removedJobs) delete merged[id];
    useEstado.setState({ trabajos: merged });
  };
  ws.onclose = () => {
    active = false;
    useEstado.setState({ conectado: false });
    setTimeout(conectar, reconnectDelay(reconnectAttempts++));
  };
  ws.onmessage = (m) => {
    let msg: MensajeWS;
    try { msg = JSON.parse(m.data); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.tipo !== 'string') return;
    const { trabajos, versiones } = useEstado.getState();
    switch (msg.tipo) {
      case 'trabajos-eliminados': {
        if (!Array.isArray(msg.ids)) return;
        const removedIds = new Set(msg.ids);
        for (const id of removedIds) { removedJobs.add(id); delete changedJobs[id]; pendingEvents.delete(id); }
        useEstado.setState({ trabajos: Object.fromEntries(Object.entries(trabajos).filter(([id]) => !removedIds.has(id))) });
        break;
      }
      case 'trabajo': {
        if (!msg.trabajo || typeof msg.trabajo.id !== 'string') return;
        const previo = trabajos[msg.trabajo.id];
        const t = { ...msg.trabajo, eventos: mergeJobEvents(msg.trabajo.eventos ?? [], previo?.eventos ?? [], pendingEvents.get(msg.trabajo.id) ?? []) };
        changedJobs[t.id] = t; removedJobs.delete(t.id); pendingEvents.delete(t.id);
        useEstado.setState({ trabajos: { ...trabajos, [t.id]: t } });
        avisarTrabajo(previo, t, useEstado.getState().trabajos, useEstado.getState().asignaturas);
        if (previo && previo.estado === 'ejecutando' && t.estado === 'ok') {
          useEstado.getState().avisar(`${t.nombreAgente} ha terminado: ${t.titulo}`, 'ok');
        } else if (previo && t.estado === 'error' && previo.estado !== 'error') {
          useEstado.getState().avisar(`${t.nombreAgente} ha fallado: ${t.titulo}`, 'error');
        }
        break;
      }
      case 'evento': {
        if (typeof msg.id !== 'string' || !msg.evento || typeof msg.evento.texto !== 'string' || typeof msg.evento.t !== 'number') return;
        const t = trabajos[msg.id];
        if (!t) {
          if (removedJobs.has(msg.id)) return;
          pendingEvents.set(msg.id, mergeJobEvents(pendingEvents.get(msg.id) ?? [], [msg.evento]));
          if (pendingEvents.size > 100) pendingEvents.delete(pendingEvents.keys().next().value!);
          break;
        }
        const updated = { ...t, eventos: mergeJobEvents(t.eventos, [msg.evento]) };
        changedJobs[t.id] = updated;
        useEstado.setState({ trabajos: { ...trabajos, [t.id]: updated } });
        break;
      }
      case 'actualizacion':
        useEstado.setState({ actualizacion: { estado: msg.estado, version: msg.version } });
        break;
      case 'tokens':
        useEstado.setState({ tokens: msg.contador });
        break;
      case 'uso':
        avisarUso(useEstado.getState().uso, msg.uso);
        useEstado.setState({ uso: msg.uso });
        break;
      case 'archivos': {
        const clave = `${msg.asignatura}/${msg.documento ?? ''}`;
        useEstado.setState({ versiones: { ...versiones, [clave]: (versiones[clave] ?? 0) + 1 }, ultimaRuta: msg.ruta });
        clearTimeout(recargaAsignaturas);
        recargaAsignaturas = setTimeout(() => useEstado.getState().cargarAsignaturas(), 600);
        break;
      }
    }
  };
}

conectar();
