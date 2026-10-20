import { ENGINE_NAMES } from '../../shared/engines';
import { openCodeInvocation, openCodeTokens } from './opencode';
// Cola de trabajos de los agentes: ejecuta Claude/Codex con un límite de simultaneidad
// y traduce su salida JSON a eventos legibles para la interfaz.
//
// Los agentes viven y mueren con la app: al cerrarla (o al reiniciarse el servidor en el
// modo «en vivo») se cierran. El estado de la cola se guarda en disco y, al volver a
// abrirla, los trabajos que quedaron a medias se relanzan solos: si el agente ya tenía
// sesión, continúa su conversación; si no, empieza de nuevo.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import treeKill from 'tree-kill';
import type { Esfuerzo, EventoTrabajo, Motor, PasoFlujo, Tokens, Trabajo, UsoSuscripcion } from '../../shared/tipos';
import { removeFileAtomic, writeFileAtomic } from '../atomicFiles';

type Traduccion = { mensaje?: string; resultado?: string; error?: string; final?: 'ok' | 'error'; tokens?: Tokens; limite?: Limite };
/** Límite de uso de la suscripción agotado; `hasta`, cuándo se renueva (epoch ms), si se sabe. */
type Limite = { hasta?: number };
import { lanzar, rutaMotor } from './motores';

/**
 * Qué hacer con el resultado de un trabajo. Es un dato serializable (no una función)
 * para poder procesar el resultado aunque el servidor se haya reiniciado entre medias.
 */
export interface Postproceso {
  tipo: string;
  datos?: Record<string, unknown>;
}

export interface PeticionTrabajo {
  agente: string;
  nombreAgente: string;
  motor: Motor;
  titulo: string;
  asignatura: string;
  documento?: string;
  prompt: string;
  cwd: string;
  dirsExtra?: string[]; // carpetas adicionales accesibles (p. ej. la de la asignatura)
  reanudar?: string; // id de sesión del motor para continuar una conversación
  paso?: PasoFlujo;
  seccion?: string;
  ref?: string;
  post?: Postproceso;
  /** Instrucciones de sistema (en Claude sustituyen al prompt de sistema por defecto, mucho más largo). */
  sistema?: string;
  /** Si el agente necesita buscar en la web (si no, no se le cargan esas herramientas). */
  web?: boolean;
  esfuerzo?: Esfuerzo;
  modelo?: string;
  /** Servidor MCP de búsqueda en las fuentes (si hay fuentes indexadas). */
  mcp?: { comando: string; args: string[]; env?: Record<string, string> };
}

const HERRAMIENTAS_MCP = ['buscar_en_fuentes', 'listar_fuentes', 'leer_pagina', 'buscar_imagenes', 'guardar_imagen', 'calcular'];

/** Valor de cadena para TOML (comillas literales: sin escapes, válidas para rutas de Windows). */
const toml = (s: string) => (s.includes("'") ? JSON.stringify(s) : `'${s}'`);

/** Funciones de Codex que los agentes de apuntes no usan y que añaden miles de tokens a cada petición. */
const CODEX_SIN_USAR = ['apps', 'browser_use', 'computer_use', 'memories', 'plugins', 'multi_agent', 'goals', 'hooks'];

export interface Manejadores {
  /** Recheck mutable limits immediately before a queued job can start a process. */
  antesDeEjecutar?(t: Trabajo): Promise<void>;
  /**
   * Se ejecuta cuando el agente termina bien (también tras cada respuesta del usuario).
   * Si lanza un error, el trabajo se marca como fallido con ese mensaje y el usuario
   * puede responder al agente para que lo corrija.
   */
  alTerminar(t: Trabajo, post: Postproceso): Promise<string | void>;
  /** Se ejecuta si el trabajo falla o se cancela. */
  alFallar(t: Trabajo, post: Postproceso): Promise<void> | void;
  /** Se ejecuta antes de reintentar desde el principio un trabajo fallido (deshace lo de alFallar). */
  alReintentar?(t: Trabajo, post: Postproceso): Promise<void> | void;
}

/**
 * Error de un postproceso que el propio agente puede arreglar (p. ej. una imagen que no se pudo
 * descargar): en vez de dar el trabajo por fallido, se le responde automáticamente con `paraAgente`.
 */
export class PedirAlAgente extends Error {
  constructor(
    mensaje: string,
    public paraAgente: string,
  ) {
    super(mensaje);
  }
}

/** Respuestas automáticas como máximo por trabajo antes de dejarlo en manos del usuario. */
const MAX_RESPUESTAS_AUTOMATICAS = 2;

/** Lo que se guarda en disco de cada trabajo. */
interface Registro {
  trabajo: Trabajo;
  peticion: Omit<PeticionTrabajo, 'prompt'>; // para poder responder después
  pid?: number;
  ejecucion: number; // nº de ejecución (cada respuesta del usuario es una nueva)
  automaticas?: number; // respuestas automáticas ya enviadas (PedirAlAgente)
}

const MAX_EVENTOS = 400;
const CONTINUAR =
  'La aplicación se cerró mientras trabajabas y se ha vuelto a abrir. Continúa la tarea donde la dejaste y termínala (revisa qué archivos llegaste a escribir).';
const CONTINUAR_LIMITE =
  'Se agotó el límite de uso de la suscripción mientras trabajabas y ya se ha renovado. Continúa la tarea donde la dejaste y termínala (revisa qué archivos llegaste a escribir).';
const MAX_TRABAJOS = 200;
const DIAS_CONSERVAR = 7;
/** Sin ninguna señal del agente durante este tiempo, se avisa (puede haberse quedado bloqueado). */
const INACTIVIDAD_MS = 12 * 60_000;
/** Límite agotado sin hora de renovación conocida: se vuelve a probar pasado este tiempo. */
const ESPERA_SIN_HORA_MS = 15 * 60_000;
const NOMBRE_MOTOR: Record<Motor, string> = { claude: 'Claude', codex: 'Codex', opencode: 'OpenCode' };

interface Seguimiento {
  proc: ChildProcess;
  pid: number;
  archivo: string;
  desplazamiento: number;
  resto: string;
  ultimoMensaje: string;
  errorReportado: boolean;
  final: 'ok' | 'error' | undefined; // evento de fin visto en la salida
  sondeo?: NodeJS.Timeout;
  cerrando?: boolean;
  ultimaActividad: number; // última vez que escribió algo en su salida
  limite?: Limite; // ha avisado de que se agotó el límite de uso
}

export class Cola extends EventEmitter {
  private registros = new Map<string, Registro>();
  private prompts = new Map<string, string>(); // prompt pendiente de los trabajos en cola
  private seguimientos = new Map<string, Seguimiento>();
  private guardadoPendiente = new Set<string>();
  private temporizadorGuardado?: NodeJS.Timeout;
  manejadores?: Manejadores;
  uso: UsoSuscripcion = { actualizado: 0 };
  /** Motores con el límite de uso agotado: hasta cuándo no se lanza nada con ellos (epoch ms). */
  private pausas = new Map<Motor, number>();
  private temporizadorPausa?: NodeJS.Timeout;
  /** Tiempos de espera (modificables en las pruebas). */
  tiempos = { inactividad: INACTIVIDAD_MS, esperaSinHora: ESPERA_SIN_HORA_MS, margenLimite: 30_000 };

  constructor(
    public maxSimultaneos: number,
    private dir: string, // carpeta donde se guardan los trabajos
  ) {
    super();
    fs.mkdirSync(dir, { recursive: true });
  }

  private ruta(id: string, ext: string) {
    return path.join(this.dir, `${id}.${ext}`);
  }

  // ---------------------------------------------------------------------------
  // Persistencia

  /** Recupera los trabajos guardados y relanza los que quedaron a medias al cerrar la app. */
  async cargar() {
    const limite = Date.now() - DIAS_CONSERVAR * 86400_000;
    try {
      const guardadas = JSON.parse(await fsp.readFile(path.join(this.dir, 'pausas.json'), 'utf8')) as Partial<Record<Motor, number>>;
      for (const [m, hasta] of Object.entries(guardadas)) if (hasta && hasta > Date.now()) this.pausas.set(m as Motor, hasta);
    } catch {}
    this.cambioPausas();
    for (const f of await fsp.readdir(this.dir)) {
      if (!f.endsWith('.json') || f === 'servidor.json' || f === 'pausas.json') continue;
      const archivo = path.join(this.dir, f);
      let r: Registro;
      try {
        r = JSON.parse(await fsp.readFile(archivo, 'utf8'));
      } catch {
        continue;
      }
      const t = r.trabajo;
      if (!t?.id) continue;
      if (t.fin && t.fin < limite) {
        this.borrarArchivos(t.id);
        continue;
      }
      this.registros.set(t.id, r);
      if (t.estado !== 'ejecutando' && t.estado !== 'en-cola') continue;

      // A persisted PID can have been reused by an unrelated process. Never kill or duplicate it blindly.
      if (r.pid && vivo(r.pid)) {
        r.pid = undefined;
        this.terminar(t, 'error', 'No se ha reanudado la tarea: el proceso registrado sigue activo y no se puede confirmar su identidad. Comprueba la sesión anterior antes de reintentar.');
        continue;
      }
      r.pid = undefined;
      let prompt: string | undefined;
      if (t.estado === 'ejecutando' && t.sesion) {
        // Ya había empezado: que continúe su propia conversación
        r.peticion = { ...r.peticion, reanudar: t.sesion };
        prompt = CONTINUAR;
      } else {
        prompt = await fsp.readFile(this.ruta(t.id, 'prompt.txt'), 'utf8').catch(() => undefined);
      }
      if (prompt === undefined) {
        this.terminar(t, 'error', 'No se pudo retomar la tarea al abrir la aplicación');
        continue;
      }
      if (t.estado === 'ejecutando') this.evento(t, 'estado', 'Relanzado al volver a abrir la aplicación');
      t.estado = 'en-cola';
      t.inicio = undefined;
      this.prompts.set(t.id, prompt);
      this.guardar(t.id);
    }
    this.siguiente();
  }

  private guardar(id: string) {
    this.guardadoPendiente.add(id);
    if (this.temporizadorGuardado) return;
    this.temporizadorGuardado = setTimeout(() => {
      this.temporizadorGuardado = undefined;
      for (const i of this.guardadoPendiente) {
        const r = this.registros.get(i);
        if (r) void writeFileAtomic(this.ruta(i, 'json'), JSON.stringify(r)).catch(() => console.error('Unable to persist an agent job'));
      }
      this.guardadoPendiente.clear();
    }, 400);
  }

  private borrarArchivos(id: string) {
    for (const ext of ['json', 'prompt.txt', 'original.txt', 'entrada.txt', 'sistema.txt', 'salida.jsonl', 'err.log']) void removeFileAtomic(this.ruta(id, ext)).catch(() => console.error('Unable to remove an agent job file'));
  }

  // ---------------------------------------------------------------------------
  // API pública

  listar(): Trabajo[] {
    return [...this.registros.values()].map((r) => r.trabajo).sort((a, b) => b.creado - a.creado);
  }

  obtener(id: string) {
    return this.registros.get(id)?.trabajo;
  }

  encolar(p: PeticionTrabajo): Trabajo {
    const t: Trabajo = {
      id: randomUUID(),
      agente: p.agente,
      nombreAgente: p.nombreAgente,
      motor: p.motor,
      titulo: p.titulo,
      asignatura: p.asignatura,
      documento: p.documento,
      paso: p.paso,
      seccion: p.seccion,
      ref: p.ref,
      estado: 'en-cola',
      creado: Date.now(),
      eventos: [],
    };
    const { prompt, ...peticion } = p;
    this.registros.set(t.id, { trabajo: t, peticion, ejecucion: 0 });
    this.prompts.set(t.id, prompt);
    fs.writeFileSync(this.ruta(t.id, 'prompt.txt'), prompt, 'utf8');
    // prompt.txt pasa a ser la última respuesta si se continúa la conversación; el original, para reintentar
    fs.writeFileSync(this.ruta(t.id, 'original.txt'), prompt, 'utf8');
    this.podar();
    this.emitir(t);
    this.siguiente();
    return t;
  }

  /** Continúa la conversación de un trabajo terminado con una respuesta del usuario. */
  responder(id: string, texto: string) {
    const r = this.registros.get(id);
    if (!r) throw new Error('Trabajo no encontrado');
    const t = r.trabajo;
    if (t.estado === 'en-cola' || t.estado === 'ejecutando') throw new Error('El agente todavía está trabajando');
    if (!t.sesion) throw new Error('Este trabajo no se puede continuar');
    r.automaticas = 0;
    this.reanudar(r, texto);
    return t;
  }

  private reanudar(r: Registro, texto: string) {
    const t = r.trabajo;
    r.peticion = { ...r.peticion, reanudar: t.sesion };
    r.pid = undefined;
    this.prompts.set(t.id, texto);
    fs.writeFileSync(this.ruta(t.id, 'prompt.txt'), texto, 'utf8');
    t.estado = 'en-cola';
    t.fin = undefined;
    t.inicio = undefined;
    t.resultado = undefined;
    t.creado = Date.now();
    this.evento(t, 'usuario', texto);
    this.emitir(t);
    this.siguiente();
  }

  /**
   * Vuelve a lanzar desde el principio (sin continuar su conversación) un trabajo que ha fallado,
   * se ha cancelado o se ha quedado bloqueado.
   */
  async reintentar(id: string) {
    const r = this.registros.get(id);
    if (!r) throw new Error('Trabajo no encontrado');
    const t = r.trabajo;
    if (t.estado === 'en-cola') throw new Error('Este trabajo todavía no ha empezado');
    const original =
      (await fsp.readFile(this.ruta(id, 'original.txt'), 'utf8').catch(() => undefined)) ??
      (await fsp.readFile(this.ruta(id, 'prompt.txt'), 'utf8').catch(() => undefined));
    if (original === undefined) throw new Error('No se conserva la tarea original de este trabajo');
    if (t.estado === 'ejecutando') this.cancelar(id);
    if (r.peticion.post && this.manejadores?.alReintentar) await this.manejadores.alReintentar(t, r.peticion.post);
    r.peticion = { ...r.peticion, reanudar: undefined };
    r.automaticas = 0;
    r.pid = undefined;
    t.sesion = undefined;
    t.estado = 'en-cola';
    t.fin = undefined;
    t.inicio = undefined;
    t.resultado = undefined;
    t.inactivo = undefined;
    t.creado = Date.now();
    this.prompts.set(id, original);
    fs.writeFileSync(this.ruta(id, 'prompt.txt'), original, 'utf8');
    this.evento(t, 'estado', 'Reintento desde el principio');
    this.emitir(t);
    this.siguiente();
    return t;
  }

  /** «Seguir esperando» a un agente que llevaba rato sin dar señales. */
  seguirEsperando(id: string) {
    const t = this.obtener(id);
    const s = this.seguimientos.get(id);
    if (!t || !s) return;
    s.ultimaActividad = Date.now();
    t.inactivo = undefined;
    this.emitir(t);
  }

  /** Quita las pausas por límite de uso (p. ej. si el usuario ha ampliado su plan) y sigue con la cola. */
  reanudarCola() {
    this.pausas.clear();
    this.cambioPausas();
    this.siguiente();
  }

  cancelar(id: string) {
    const t = this.obtener(id);
    if (!t) return;
    if (t.estado === 'en-cola') {
      this.terminar(t, 'cancelado', 'Cancelado antes de empezar');
    } else if (t.estado === 'ejecutando') {
      const s = this.seguimientos.get(id);
      t.estado = 'cancelado'; // se marca antes para que el cierre del proceso no lo pise
      if (s?.pid) treeKill(s.pid);
      this.terminar(t, 'cancelado', 'Cancelado por el usuario');
    }
  }

  /** Elimina de la lista los trabajos terminados. */
  limpiar() {
    const removedIds: string[] = [];
    for (const [id, r] of this.registros) {
      if (r.trabajo.estado !== 'en-cola' && r.trabajo.estado !== 'ejecutando') {
        this.registros.delete(id);
        this.guardadoPendiente.delete(id);
        this.borrarArchivos(id);
        removedIds.push(id);
      }
    }
    return removedIds;
  }

  /** Cancela todo lo pendiente (al cerrar la app de forma ordenada). */
  detenerTodo() {
    for (const t of this.listar()) if (t.estado === 'ejecutando' || t.estado === 'en-cola') this.cancelar(t.id);
  }

  /**
   * Cierre de la app: cierra los agentes en marcha pero los deja anotados para relanzarlos
   * al volver a abrirla. Se guarda de forma síncrona porque el proceso va a terminar.
   */
  pausarTodo() {
    for (const [id, sg] of this.seguimientos) {
      sg.cerrando = true;
      clearInterval(sg.sondeo);
      sg.proc.removeAllListeners();
      if (sg.pid) treeKill(sg.pid);
      const r = this.registros.get(id);
      if (r) r.pid = undefined;
    }
    this.seguimientos.clear();
    void this.flush().catch(() => console.error('Unable to persist the paused agent queue'));
  }

  async flush() {
    clearTimeout(this.temporizadorGuardado);
    this.temporizadorGuardado = undefined;
    this.guardadoPendiente.clear();
    await Promise.all([...this.registros].map(([id, record]) => writeFileAtomic(this.ruta(id, 'json'), JSON.stringify(record))));
  }

  // ---------------------------------------------------------------------------

  private podar() {
    if (this.registros.size <= MAX_TRABAJOS) return;
    const terminados = this.listar().filter((t) => t.fin).reverse();
    for (const t of terminados.slice(0, this.registros.size - MAX_TRABAJOS)) {
      this.registros.delete(t.id);
      this.borrarArchivos(t.id);
    }
  }

  private emitir(t: Trabajo) {
    this.guardar(t.id);
    this.emit('trabajo', t);
  }

  private evento(t: Trabajo, tipo: EventoTrabajo['tipo'], texto: string, silencioso = false) {
    const ev: EventoTrabajo = { t: Date.now(), tipo, texto };
    t.eventos.push(ev);
    if (t.eventos.length > MAX_EVENTOS) t.eventos.splice(0, t.eventos.length - MAX_EVENTOS);
    this.guardar(t.id);
    if (!silencioso) this.emit('evento', t.id, ev);
  }

  private terminar(t: Trabajo, estado: Trabajo['estado'], texto?: string) {
    if (t.fin) return;
    this.openCodeSteps.delete(t.id);
    t.estado = estado;
    t.fin = Date.now();
    if (estado === 'error' && texto) {
      if (t.resultado && t.resultado !== texto && !t.eventos.some(event => event.tipo === 'texto' && event.texto === t.resultado)) this.evento(t, 'texto', t.resultado);
      t.resultado = texto;
    }
    if (texto) this.evento(t, estado === 'error' ? 'error' : 'estado', texto);
    const s = this.seguimientos.get(t.id);
    if (s) clearInterval(s.sondeo);
    this.seguimientos.delete(t.id);
    this.prompts.delete(t.id);
    const r = this.registros.get(t.id);
    if (r) r.pid = undefined;
    if (estado !== 'ok' && r?.peticion.post && this.manejadores) {
      Promise.resolve(this.manejadores.alFallar(t, r.peticion.post)).catch((e) => console.error(e));
    }
    this.emitir(t);
    this.emit('terminado', t);
    this.siguiente();
  }

  private siguiente() {
    const enCurso = this.listar().filter((t) => t.estado === 'ejecutando').length;
    if (enCurso >= this.maxSimultaneos) return;
    const pendiente = this.listar()
      .filter((t) => t.estado === 'en-cola' && this.prompts.has(t.id) && !this.pausas.has(t.motor))
      .sort((a, b) => a.creado - b.creado)[0];
    if (!pendiente) return;
    void this.ejecutar(pendiente).catch(error => {
      if (pendiente.estado === 'ejecutando') this.terminar(pendiente, 'error', (error as Error).message);
    });
    this.siguiente();
  }

  private async ejecutar(t: Trabajo) {
    const r = this.registros.get(t.id)!;
    const p = r.peticion;
    this.openCodeSteps.delete(t.id);
    const prompt = this.prompts.get(t.id) ?? '';
    this.prompts.delete(t.id);
    const ruta = rutaMotor(p.motor);
    t.estado = 'ejecutando';
    t.inicio = Date.now();
    r.ejecucion++;
    this.emitir(t);
    try { await this.manejadores?.antesDeEjecutar?.(t); }
    catch (error) { if (t.estado === 'ejecutando') this.terminar(t, 'error', (error as Error).message); return; }
    if (t.estado !== 'ejecutando') return;
    if (!ruta) {
      this.terminar(t, 'error', `No se encuentra ${ENGINE_NAMES[p.motor]} en este equipo`);
      return;
    }

    // Ahorro de tokens: solo las herramientas necesarias, sin servidores MCP, sin los ajustes,
    // hooks y skills globales del usuario y con un prompt de sistema propio y corto
    // (medido: un «hola» pasa de ~21.000 a ~6.500 tokens de entrada con Claude).
    const herramientas = ['Read', 'Write', 'Edit', 'Glob', 'Grep', ...(p.web ? ['WebSearch', 'WebFetch'] : [])].join(',');
    const permitidas = [herramientas, ...(p.mcp ? HERRAMIENTAS_MCP.map((h) => `mcp__fuentes__${h}`) : [])].join(',');
    const mcpClaude = JSON.stringify({ mcpServers: p.mcp ? { fuentes: { command: p.mcp.comando, args: p.mcp.args, env: p.mcp.env ?? {} } } : {} });
    const archivoSistema = this.ruta(t.id, 'sistema.txt');
    if (p.motor === 'claude' && p.sistema) fs.writeFileSync(archivoSistema, p.sistema, 'utf8');
    const openCode = p.motor === 'opencode' ? openCodeInvocation(p) : undefined;
    const args = openCode ? openCode.args :
      p.motor === 'claude'
        ? [
            '-p',
            '--output-format', 'stream-json',
            '--verbose',
            '--permission-mode', 'acceptEdits',
            '--tools', herramientas,
            '--allowedTools', permitidas,
            '--strict-mcp-config', '--mcp-config', mcpClaude,
            '--setting-sources', 'project,local',
            '--disable-slash-commands',
            '--no-chrome',
            ...(p.sistema ? ['--system-prompt-file', archivoSistema] : []),
            // Haiku no admite nivel de esfuerzo
            ...(p.esfuerzo && !/haiku/i.test(p.modelo ?? '') ? ['--effort', p.esfuerzo] : []),
            ...(p.modelo ? ['--model', p.modelo] : []),
            ...(p.dirsExtra ?? []).flatMap((d) => ['--add-dir', d]),
            ...(p.reanudar ? ['--resume', p.reanudar] : []),
          ]
        : [
            'exec',
            '--json',
            '--skip-git-repo-check',
            '-s', 'workspace-write',
            '-C', p.cwd,
            ...CODEX_SIN_USAR.flatMap((f) => ['--disable', f]),
            ...(p.mcp
              ? [
                  '-c', `mcp_servers.fuentes.command=${toml(p.mcp.comando)}`,
                  '-c', `mcp_servers.fuentes.args=[${p.mcp.args.map(toml).join(',')}]`,
                  // Las herramientas de fuentes solo leen: se aprueban sin preguntar (en exec no hay a quién)
                  '-c', `mcp_servers.fuentes.default_tools_approval_mode="approve"`,
                  ...(p.mcp.env ? ['-c', `mcp_servers.fuentes.env={${Object.entries(p.mcp.env).map(([k, v]) => `${k}=${toml(v)}`).join(',')}}`] : []),
                ]
              : []),
            ...(p.esfuerzo ? ['-c', `model_reasoning_effort=${p.esfuerzo}`] : []),
            ...(p.modelo ? ['-m', p.modelo] : []),
            ...(p.dirsExtra ?? []).flatMap((d) => ['--add-dir', d]),
            ...(p.reanudar ? ['resume', p.reanudar] : []),
            '-',
          ];

    // Codex no permite sustituir su prompt de sistema: las instrucciones van al principio del prompt
    const promptFinal = p.motor === 'codex' && p.sistema && !p.reanudar ? `${p.sistema}

${prompt}` : prompt;

    // El prompt entra por un archivo y la salida va a otro (prompt.txt guarda el original, para relanzar)
    const archivoPrompt = this.ruta(t.id, 'entrada.txt');
    const archivoSalida = this.ruta(t.id, 'salida.jsonl');
    fs.writeFileSync(archivoPrompt, promptFinal, 'utf8');
    fs.writeFileSync(archivoSalida, '');
    let proc: ChildProcess;
    const fds: number[] = [];
    try {
      fds.push(fs.openSync(archivoPrompt, 'r'), fs.openSync(archivoSalida, 'a'), fs.openSync(this.ruta(t.id, 'err.log'), 'w'));
      proc = lanzar(ruta, args, { cwd: p.cwd, env: openCode?.env, stdio: [fds[0], fds[1], fds[2]] });
    } catch (e) {
      this.terminar(t, 'error', `No se pudo iniciar: ${e}`);
      return;
    } finally {
      for (const fd of fds) fs.close(fd, () => {});
    }
    if (!proc.pid) {
      this.terminar(t, 'error', 'No se pudo iniciar el agente');
      return;
    }
    r.pid = proc.pid;
    this.evento(t, 'estado', `Iniciando ${ENGINE_NAMES[p.motor]}…`);
    this.seguir(t.id, proc.pid, proc);
  }

  /** Lee la salida del agente a medida que la escribe. */
  private seguir(id: string, pid: number, proc: ChildProcess) {
    const t = this.obtener(id)!;
    const s: Seguimiento = {
      proc,
      pid,
      archivo: this.ruta(id, 'salida.jsonl'),
      desplazamiento: 0,
      resto: '',
      ultimoMensaje: '',
      errorReportado: false,
      final: undefined,
      ultimaActividad: Date.now(),
    };
    this.seguimientos.set(id, s);
    proc.on('error', (e) => this.terminar(t, 'error', `Error al ejecutar: ${e.message}`));
    proc.on('exit', (codigo) => setTimeout(() => this.alSalir(id, codigo), 150));
    s.sondeo = setInterval(() => {
      this.leer(id);
      this.vigilarInactividad(t, s);
    }, 400);
  }

  /** Avisa si el agente lleva mucho sin dar señales (no se cierra solo: puede estar pensando). */
  private vigilarInactividad(t: Trabajo, s: Seguimiento) {
    if (t.inactivo || t.estado !== 'ejecutando' || Date.now() - s.ultimaActividad < this.tiempos.inactividad) return;
    t.inactivo = s.ultimaActividad;
    this.evento(t, 'estado', `Sin señales del agente desde hace ${Math.round(this.tiempos.inactividad / 60_000)} minutos: puede estar preparando una respuesta larga o haberse quedado bloqueado.`);
    this.emitir(t);
  }

  // ---------------------------------------------------------------------------
  // Límite de uso de la suscripción

  /**
   * El agente ha agotado el límite de uso: el trabajo vuelve a la cola (continuará su conversación,
   * si la tenía) y su motor queda en pausa hasta que se renueve el límite.
   */
  private esperarLimite(t: Trabajo, limite: Limite) {
    const r = this.registros.get(t.id)!;
    const motor = r.peticion.motor;
    const ahora = Date.now();
    const hasta = limite.hasta && limite.hasta > ahora ? limite.hasta + this.tiempos.margenLimite : ahora + this.tiempos.esperaSinHora;
    this.pausas.set(motor, Math.max(this.pausas.get(motor) ?? 0, hasta));
    let prompt: string | undefined;
    if (t.sesion) {
      r.peticion = { ...r.peticion, reanudar: t.sesion };
      prompt = CONTINUAR_LIMITE;
      fs.writeFileSync(this.ruta(t.id, 'prompt.txt'), prompt, 'utf8');
    } else {
      prompt = fs.existsSync(this.ruta(t.id, 'prompt.txt')) ? fs.readFileSync(this.ruta(t.id, 'prompt.txt'), 'utf8') : undefined;
    }
    const s = this.seguimientos.get(t.id);
    if (s) clearInterval(s.sondeo);
    this.seguimientos.delete(t.id);
    r.pid = undefined;
    if (prompt === undefined) return this.terminar(t, 'error', `Se ha agotado el límite de uso de ${NOMBRE_MOTOR[motor]}`);
    this.prompts.set(t.id, prompt);
    t.estado = 'en-cola';
    t.inicio = undefined;
    t.inactivo = undefined;
    const hora = new Date(this.pausas.get(motor)!).toLocaleString('es', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    this.evento(
      t,
      'estado',
      `Se ha agotado el límite de uso de tu suscripción de ${NOMBRE_MOTOR[motor]}. ${t.sesion ? 'Continuará donde lo dejó' : 'Empezará'} automáticamente al renovarse (${limite.hasta ? '' : 'se volverá a probar '}${hora}).`,
    );
    this.emitir(t);
    this.cambioPausas();
    this.siguiente();
  }

  /** Guarda las pausas, las comunica a la interfaz y programa su fin. */
  private cambioPausas() {
    const ahora = Date.now();
    for (const [m, hasta] of this.pausas) if (hasta <= ahora) this.pausas.delete(m);
    const pausas = Object.fromEntries(this.pausas) as Partial<Record<Motor, number>>;
    try {
      fs.writeFileSync(path.join(this.dir, 'pausas.json'), JSON.stringify(pausas));
    } catch {}
    this.uso = { ...this.uso, pausas, actualizado: Date.now() };
    this.emit('uso', this.uso);
    if (this.temporizadorPausa) clearTimeout(this.temporizadorPausa);
    this.temporizadorPausa = undefined;
    const proxima = Math.min(...this.pausas.values());
    if (Number.isFinite(proxima)) {
      this.temporizadorPausa = setTimeout(() => {
        this.cambioPausas();
        this.siguiente();
      }, Math.max(1000, proxima - ahora));
    }
  }

  private leer(id: string, silencioso = false) {
    const s = this.seguimientos.get(id);
    const t = this.obtener(id);
    if (!s || !t) return;
    let tam: number;
    try {
      tam = fs.statSync(s.archivo).size;
    } catch {
      return;
    }
    if (tam <= s.desplazamiento) return;
    s.ultimaActividad = Date.now();
    if (t.inactivo) {
      t.inactivo = undefined;
      this.emitir(t);
    }
    const fd = fs.openSync(s.archivo, 'r');
    const buf = Buffer.alloc(tam - s.desplazamiento);
    fs.readSync(fd, buf, 0, buf.length, s.desplazamiento);
    fs.closeSync(fd);
    s.desplazamiento = tam;
    s.resto += buf.toString('utf8');
    const lineas = s.resto.split('\n');
    s.resto = lineas.pop() ?? '';
    for (const l of lineas) this.procesarLinea(t, s, l, silencioso);
  }

  private procesarLinea(t: Trabajo, s: Seguimiento, linea: string, silencioso: boolean) {
    if (!linea.trim()) return;
    let ev: any;
    try {
      ev = JSON.parse(linea);
    } catch {
      return;
    }
    const motor = this.registros.get(t.id)!.peticion.motor;
    const r = motor === 'opencode' ? this.translateOpenCode(t, ev, silencioso) : motor === 'claude' ? this.traducirClaude(t, ev, silencioso) : this.traducirCodex(t, ev, silencioso);
    if (r?.mensaje) s.ultimoMensaje = r.mensaje;
    if (r?.resultado !== undefined) t.resultado = r.resultado;
    if (r?.final) s.final = r.final;
    if (r?.limite) s.limite = { hasta: r.limite.hasta ?? s.limite?.hasta };
    if (r?.tokens && (r.tokens.entrada || r.tokens.salida)) {
      const previo = t.tokens ?? { entrada: 0, salida: 0, cache: 0 };
      t.tokens = { entrada: previo.entrada + r.tokens.entrada, salida: previo.salida + r.tokens.salida, cache: previo.cache + r.tokens.cache };
      this.emit('tokens', motor, r.tokens, t);
      this.emitir(t);
    }
    if (r?.error) {
      s.errorReportado = true;
      this.evento(t, 'error', r.error, silencioso);
    }
  }

  /** El proceso ha terminado. */
  private alSalir(id: string, codigo: number | null) {
    const s = this.seguimientos.get(id);
    const t = this.obtener(id);
    if (!s || !t || s.cerrando) return;
    s.cerrando = true;
    clearInterval(s.sondeo);
    this.leer(id);
    if (s.resto) this.procesarLinea(t, s, s.resto, false);
    if (t.estado === 'cancelado') return;
    if (t.resultado === undefined && s.ultimoMensaje) t.resultado = s.ultimoMensaje;
    const bien = codigo === 0;
    if (bien && !s.errorReportado) return this.finalizarBien(t);
    let detalle = '';
    try {
      detalle = fs
        .readFileSync(this.ruta(id, 'err.log'), 'utf8')
        .slice(-4000)
        .trim()
        .split(/\r?\n/)
        .filter((l) => !/Reading additional input/i.test(l))
        .slice(-3)
        .join('\n');
    } catch {}
    // Límite de uso agotado (avisado en la salida o en los errores): a esperar, no es un fallo
    const limite = s.limite ?? (!bien ? limiteEnTexto(detalle) : undefined);
    if (limite) return this.esperarLimite(t, limite);
    this.terminar(
      t,
      'error',
      `Ha terminado con errores${detalle ? `:\n${detalle}` : codigo !== null ? ` (código ${codigo})` : ''}`,
    );
  }

  private finalizarBien(t: Trabajo) {
    const post = this.registros.get(t.id)?.peticion.post;
    if (!post || !this.manejadores) return this.terminar(t, 'ok', 'Terminado');
    this.evento(t, 'estado', 'Procesando el resultado…');
    this.manejadores
      .alTerminar(t, post)
      .then((msg) => this.terminar(t, 'ok', msg || 'Terminado'))
      .catch((e) => {
        const r = this.registros.get(t.id);
        const automaticLimit = r?.peticion.agente === 'curriculo' || r?.peticion.paso === 'programacion' ? 1 : MAX_RESPUESTAS_AUTOMATICAS;
        if (e instanceof PedirAlAgente && r && t.sesion && (r.automaticas ?? 0) < automaticLimit) {
          r.automaticas = (r.automaticas ?? 0) + 1;
          const s = this.seguimientos.get(t.id);
          if (s) clearInterval(s.sondeo);
          this.seguimientos.delete(t.id);
          this.evento(t, 'estado', `${e.message} Se lo pido de nuevo al agente (intento ${r.automaticas} de ${automaticLimit}).`);
          return this.reanudar(r, e.paraAgente);
        }
        this.terminar(t, 'error', String(e?.message ?? e));
      });
  }

  // ---------------------------------------------------------------------------
  // Traducción de la salida de cada motor

  private traducirClaude(t: Trabajo, ev: any, sil: boolean): Traduccion | void {
    switch (ev.type) {
      case 'system':
        if (ev.subtype === 'init') {
          if (ev.session_id) t.sesion = ev.session_id;
          this.evento(t, 'estado', `Conectado (${ev.model ?? 'Claude'})`, sil);
        }
        return;
      case 'assistant': {
        let mensaje: string | undefined;
        for (const c of ev.message?.content ?? []) {
          if (c.type === 'text' && c.text?.trim()) {
            this.evento(t, 'texto', c.text.trim(), sil);
            mensaje = c.text.trim();
          } else if (c.type === 'tool_use') {
            this.evento(t, 'herramienta', describirHerramienta(c.name, c.input ?? {}), sil);
          }
        }
        return { mensaje };
      }
      case 'rate_limit_event': {
        const info = ev.rate_limit_info ?? {};
        const w = info.unifiedWindows ?? {};
        this.uso = {
          ...this.uso,
          cincoHoras: w.five_hour?.utilization,
          semanal: w.seven_day?.utilization,
          reinicio: w.five_hour?.resetsAt ?? info.resetsAt,
          pausas: this.uso.pausas,
          actualizado: Date.now(),
        };
        if (!sil) this.emit('uso', this.uso);
        // Rechazada por el límite: se renueva en resetsAt (s)
        if (info.status === 'rejected') return { limite: { hasta: info.resetsAt ? Number(info.resetsAt) * 1000 : undefined } };
        return;
      }
      case 'result': {
        const u = ev.usage ?? {};
        const cache = Number(u.cache_read_input_tokens ?? 0);
        const tokens: Tokens = {
          entrada: Number(u.input_tokens ?? 0) + Number(u.cache_creation_input_tokens ?? 0) + cache,
          salida: Number(u.output_tokens ?? 0),
          cache,
        };
        if (ev.is_error) return { error: String(ev.result ?? 'Error del agente'), final: 'error', tokens, limite: limiteEnTexto(String(ev.result ?? '')) };
        return { resultado: typeof ev.result === 'string' ? ev.result : undefined, final: 'ok', tokens };
      }
    }
  }

  private openCodeSteps = new Map<string, Set<string>>();

  private translateOpenCode(t: Trabajo, event: any, silent: boolean): Traduccion | void {
    if (typeof event.sessionID === 'string') t.sesion = event.sessionID;
    const part = event.part;
    if (event.type === 'text' && typeof part?.text === 'string' && part.text.trim()) {
      this.evento(t, 'texto', part.text.trim(), silent);
      return { mensaje: part.text.trim() };
    }
    if (event.type === 'tool_use') {
      this.evento(t, 'herramienta', describirHerramienta(String(part?.tool ?? 'OpenCode'), part?.state?.input ?? {}), silent);
      return;
    }
    if (event.type === 'step_finish') {
      const seen = this.openCodeSteps.get(t.id) ?? new Set<string>();
      this.openCodeSteps.set(t.id, seen);
      if (typeof part?.id === 'string') {
        if (seen.has(part.id)) return;
        seen.add(part.id);
      }
      return { tokens: openCodeTokens(part?.tokens) };
    }
    if (event.type === 'error') {
      const message = String(event.error?.message ?? event.error?.data?.message ?? event.message ?? 'Error de OpenCode');
      return { error: message, final: 'error', limite: limiteEnTexto(message) };
    }
  }

  private traducirCodex(t: Trabajo, ev: any, sil: boolean): Traduccion | void {
    const item = ev.item;
    switch (ev.type) {
      case 'thread.started':
        if (ev.thread_id) t.sesion = ev.thread_id;
        this.evento(t, 'estado', 'Conectado (Codex)', sil);
        return;
      case 'item.started':
        if (item?.type === 'command_execution') this.evento(t, 'herramienta', `Ejecutando: ${recortar(item.command, 120)}`, sil);
        else if (item?.type === 'web_search') this.evento(t, 'herramienta', `Buscando en la web: ${item.query ?? ''}`, sil);
        else if (item?.type === 'mcp_tool_call') this.evento(t, 'herramienta', describirHerramienta(`mcp__${item.server}__${item.tool}`, item.arguments ?? {}), sil);
        return;
      case 'item.completed':
        if (item?.type === 'agent_message' && item.text?.trim()) {
          this.evento(t, 'texto', item.text.trim(), sil);
          return { mensaje: item.text.trim() };
        }
        if (item?.type === 'file_change') {
          const archivos = (item.changes ?? []).map((c: any) => nombreCorto(c.path)).join(', ');
          this.evento(t, 'herramienta', `Modificando: ${archivos || 'archivos'}`, sil);
        } else if (item?.type === 'image_generation' || /image/i.test(item?.type ?? '')) {
          this.evento(t, 'herramienta', 'Imagen generada', sil);
        } else if (item?.type === 'error') {
          return { error: item.message ?? 'Error de Codex', limite: limiteEnTexto(String(item.message ?? '')) };
        }
        return;
      case 'turn.completed': {
        // En Codex, input_tokens ya incluye los leídos de caché (cached_input_tokens)
        const u = ev.usage ?? {};
        return {
          final: 'ok',
          tokens: { entrada: Number(u.input_tokens ?? 0), salida: Number(u.output_tokens ?? 0), cache: Number(u.cached_input_tokens ?? 0) },
        };
      }
      case 'turn.failed':
      case 'error': {
        const mensaje = String(ev.error?.message ?? ev.message ?? 'Error de Codex');
        return { error: mensaje, final: 'error', limite: limiteEnTexto(mensaje) };
      }
    }
  }
}

/**
 * ¿Es un aviso de límite de uso agotado? Claude: «Claude AI usage limit reached|1760000000» o
 * «You've hit your limit · resets 5pm»; Codex: «You've hit your usage limit… try again at 3:05 PM».
 * Si trae la hora de renovación, la devuelve.
 */
export function limiteEnTexto(texto: string, ahora = new Date()): Limite | undefined {
  const delPlan = /usage limit|hit your (usage )?limit|limit reached|quota exceeded|l[ií]mite de uso/i.test(texto);
  // Demasiadas peticiones seguidas (no es el límite del plan): basta con esperar un poco
  if (!delPlan) return /rate limit|too many requests|\b429\b/i.test(texto) ? { hasta: ahora.getTime() + 2 * 60_000 } : undefined;
  const epoch = texto.match(/\|(\d{10})\b/);
  if (epoch) return { hasta: Number(epoch[1]) * 1000 };
  // «try again in 2 hours 5 minutes», «in 35 minutes»
  const en = texto.match(/\bin\s+(?:(\d+)\s*h(?:ours?|rs?)?)?[\s,]*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?\b/i);
  if (en && (en[1] || en[2])) return { hasta: ahora.getTime() + (Number(en[1] ?? 0) * 60 + Number(en[2] ?? 0)) * 60_000 };
  // Fecha completa: «try again at Oct 12th, 2026 3:05 PM»
  const fecha = texto.match(/again at\s+([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4},?\s+\d{1,2}(?::\d{2})?\s*[AaPp]\.?[Mm]\.?)/);
  if (fecha) {
    const t = Date.parse(fecha[1].replace(/(\d)(st|nd|rd|th)/, '$1').replace(/,/g, '').replace(/\./g, ''));
    if (Number.isFinite(t)) return { hasta: t };
  }
  // Día sin año: «resets Oct 13, 10am» (límite semanal)
  const dia = texto.match(/resets\s+([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m/i);
  if (dia) {
    const t = Date.parse(`${dia[1]} ${dia[2]} ${ahora.getFullYear()} ${dia[3]}:${dia[4] ?? '00'} ${dia[5]}M`);
    if (Number.isFinite(t)) return { hasta: t < ahora.getTime() - 86400_000 ? new Date(t).setFullYear(ahora.getFullYear() + 1) : t };
  }
  // Solo la hora: «resets 5pm», «resets 5:30pm (Europe/Madrid)», «try again at 3:05 PM»
  const hora = texto.match(/(?:resets(?: at)?|again at)\s+(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i);
  if (hora) {
    let h = Number(hora[1]);
    const m = Number(hora[2] ?? 0);
    const ampm = hora[3]?.toLowerCase().replace(/\./g, '');
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    if (h < 24 && m < 60) {
      const d = new Date(ahora);
      d.setHours(h, m, 0, 0);
      if (d.getTime() <= ahora.getTime()) d.setDate(d.getDate() + 1);
      return { hasta: d.getTime() };
    }
  }
  return {};
}

/** ¿Sigue vivo el proceso? */
function vivo(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function recortar(s: string, n: number) {
  s = String(s ?? '').replace(/\s+/g, ' ');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function nombreCorto(ruta: string) {
  return String(ruta ?? '').split(/[\\/]/).slice(-2).join('/');
}

function describirHerramienta(nombre: string, input: any): string {
  switch (nombre) {
    case 'Read':
      return `Leyendo ${nombreCorto(input.file_path)}`;
    case 'Write':
      return `Escribiendo ${nombreCorto(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
      return `Editando ${nombreCorto(input.file_path)}`;
    case 'Glob':
    case 'Grep':
      return `Buscando archivos: ${recortar(input.pattern, 60)}`;
    case 'WebSearch':
      return `Buscando en la web: ${recortar(input.query, 100)}`;
    case 'WebFetch':
      return `Consultando ${recortar(input.url, 100)}`;
    case 'TodoWrite':
      return 'Planificando tareas';
    case 'mcp__fuentes__buscar_en_fuentes':
      return `Buscando en tus fuentes: ${recortar(input.consulta, 90)}`;
    case 'mcp__fuentes__buscar_imagenes':
      return `Buscando imágenes en museos y bibliotecas: ${recortar(input.consulta, 80)}`;
    case 'mcp__fuentes__calcular':
      return `Calculando: ${recortar((input.expresiones ?? []).join(' · '), 90)}`;
    case 'mcp__fuentes__guardar_imagen':
      return `Descargando la imagen ${recortar(input.nombre, 60)}`;
    case 'mcp__fuentes__listar_fuentes':
      return 'Repasando la lista de fuentes';
    case 'mcp__fuentes__leer_pagina':
      return `Leyendo ${nombreCorto(input.archivo)}${input.pagina ? `, pág. ${input.pagina}` : ''}`;
    default:
      return `Usando ${nombre}`;
  }
}
