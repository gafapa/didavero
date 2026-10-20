// Detección de Claude Code y Codex CLI, y lanzamiento de sus procesos.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EstadoMotor, Motor } from '../../shared/tipos';

const WIN = process.platform === 'win32';

/** Rutas habituales de instalación. Las apps de escritorio en macOS no heredan el PATH de la terminal. */
function candidatas(motor: Motor): string[] {
  const home = os.homedir();
  if (WIN) {
    const appdata = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    return [
      path.join(home, '.local', 'bin', `${motor}.exe`),
      path.join(appdata, 'npm', `${motor}.cmd`),
      path.join(local, 'Programs', motor, `${motor}.exe`),
      path.join(local, 'Microsoft', 'WinGet', 'Links', `${motor}.exe`),
    ];
  }
  return [
    path.join(home, '.local', 'bin', motor),
    path.join(home, '.claude', 'local', motor),
    '/opt/homebrew/bin/' + motor,
    '/usr/local/bin/' + motor,
    '/usr/bin/' + motor,
    path.join(home, '.npm-global', 'bin', motor),
    path.join(home, '.volta', 'bin', motor),
  ];
}

function enPath(motor: Motor): string | undefined {
  const exts = WIN ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, motor + ext);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const rutasCache = new Map<Motor, string | undefined>();

export function rutaMotor(motor: Motor): string | undefined {
  // Para las pruebas automáticas: un motor falso (APUNTES_MOTOR_CLAUDE / APUNTES_MOTOR_CODEX)
  const forzada = process.env[`APUNTES_MOTOR_${motor.toUpperCase()}`];
  if (forzada) return forzada;
  if (!rutasCache.has(motor)) {
    const ruta = enPath(motor) ?? candidatas(motor).find((p) => existsSync(p));
    const nativeOpenCode = ruta && WIN && /\.cmd$/i.test(ruta) ? path.join(path.dirname(ruta), 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe') : undefined;
    rutasCache.set(motor, motor === 'opencode' && nativeOpenCode && existsSync(nativeOpenCode) ? nativeOpenCode : ruta && motor === 'codex' ? (binarioNativoCodex(ruta) ?? ruta) : ruta);
  }
  return rutasCache.get(motor);
}

/**
 * Codex instalado con npm es un lanzador (codex.cmd → node codex.js → codex.exe). Si se lanza
 * el lanzador, al cerrar la app solo se cierra el intermediario y el codex.exe real queda vivo.
 * Por eso se busca y se usa directamente el binario nativo.
 */
function binarioNativoCodex(ruta: string): string | undefined {
  let raiz: string | undefined;
  try {
    const real = realpathSync(ruta);
    if (/\.cmd$/i.test(real)) raiz = path.join(path.dirname(real), 'node_modules', '@openai', 'codex');
    else if (/\.js$/.test(real)) raiz = path.resolve(path.dirname(real), '..');
  } catch {
    return undefined;
  }
  if (!raiz || !existsSync(raiz)) return undefined;
  const exe = WIN ? 'codex.exe' : 'codex';
  const buscar = (dir: string, nivel: number): string | undefined => {
    if (nivel > 6 || !existsSync(dir)) return undefined;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name === exe && path.basename(dir) === 'bin' && p.includes('vendor')) return p;
      if (e.isDirectory() && (nivel < 2 || /vendor|codex|openai|bin|node_modules|-/.test(e.name))) {
        const r = buscar(p, nivel + 1);
        if (r) return r;
      }
    }
    return undefined;
  };
  return buscar(raiz, 0);
}

/** Entrecomilla un argumento para cmd.exe (solo se usa con .cmd/.bat en Windows). */
function citarCmd(arg: string): string {
  if (/^[\w\-.:\\/=]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

/**
 * Lanza un ejecutable. En Windows los .cmd (instalaciones con npm) requieren shell;
 * por eso los textos largos (prompts) se pasan siempre por stdin y nunca como argumento.
 */
export function lanzar(ejecutable: string, args: string[], opciones: SpawnOptions = {}): ChildProcess {
  const necesitaShell = WIN && /\.(cmd|bat)$/i.test(ejecutable);
  // Electron empaquetado añade ELECTRON_RUN_AS_NODE en algunos casos; no debe heredarse.
  const env = { ...process.env, ...opciones.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (necesitaShell) {
    const linea = [ejecutable, ...args].map(citarCmd).join(' ');
    return spawn(linea, { ...opciones, env, shell: true, windowsHide: true });
  }
  return spawn(ejecutable, args, { ...opciones, env, windowsHide: true });
}

function ejecutar(ejecutable: string, args: string[], timeoutMs = 20000): Promise<{ codigo: number | null; salida: string }> {
  return new Promise((resolve) => {
    let salida = '';
    let hijo: ChildProcess;
    try {
      hijo = lanzar(ejecutable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ codigo: -1, salida: String(e) });
      return;
    }
    const t = setTimeout(() => hijo.kill(), timeoutMs);
    hijo.stdout?.on('data', (d) => (salida += d));
    hijo.stderr?.on('data', (d) => (salida += d));
    hijo.on('error', (e) => {
      clearTimeout(t);
      resolve({ codigo: -1, salida: String(e) });
    });
    hijo.on('close', (codigo) => {
      clearTimeout(t);
      resolve({ codigo, salida: salida.trim() });
    });
  });
}

export async function comprobarMotor(motor: Motor): Promise<EstadoMotor> {
  rutasCache.delete(motor);
  const ruta = rutaMotor(motor);
  if (!ruta) return { motor, instalado: false, sesion: false };
  const v = await ejecutar(ruta, ['--version']);
  if (v.codigo !== 0) return { motor, instalado: false, ruta, sesion: false, detalle: v.salida.slice(0, 300) };
  const version = v.salida.split(/\r?\n/)[0];
  if (motor === 'claude') {
    const s = await ejecutar(ruta, ['auth', 'status']);
    let sesion = false;
    try {
      sesion = JSON.parse(s.salida.slice(s.salida.indexOf('{'))).loggedIn === true;
    } catch {
      sesion = s.codigo === 0 && !/not logged in/i.test(s.salida);
    }
    return { motor, instalado: true, ruta, version, sesion };
  }
  if (motor === 'opencode') {
    if (!/\b(?:v)?2\./i.test(version)) return { motor, instalado: true, ruta, version, sesion: false, detalle: 'Esta integración requiere OpenCode 2. Actualiza desde su guía de instalación.' };
    const models = await openCodeModels();
    return { motor, instalado: true, ruta, version, sesion: models.length > 0, detalle: models.length ? undefined : 'Configura un proveedor o modelo local en OpenCode y vuelve a comprobar.' };
  }
  const s = await ejecutar(ruta, ['login', 'status']);
  return { motor, instalado: true, ruta, version, sesion: s.codigo === 0 && /logged in/i.test(s.salida) };
}

// ---------- Instalación e inicio de sesión (en una terminal visible) ----------

export function comandoInstalacion(motor: Motor): string {
  if (motor === 'claude') {
    return WIN ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash';
  }
  return motor === 'opencode' ? 'npm install -g @opencode/cli' : 'npm install -g @openai/codex';
}

export function comandoSesion(motor: Motor): string {
  const ruta = rutaMotor(motor) ?? motor;
  const r = WIN ? `& '${ruta}'` : `'${ruta}'`;
  return motor === 'codex' ? `${r} login` : `${r} auth login`;
}

/** Abre una terminal del sistema que ejecuta el comando y queda abierta. */
export function abrirTerminal(comando: string) {
  if (WIN) {
    const cod = Buffer.from(comando, 'utf16le').toString('base64');
    spawn('cmd.exe', ['/c', 'start', '""', 'powershell.exe', '-NoExit', '-EncodedCommand', cod], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    }).unref();
  } else if (process.platform === 'darwin') {
    const script = `tell application "Terminal" to do script ${JSON.stringify(comando)}\ntell application "Terminal" to activate`;
    spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('x-terminal-emulator', ['-e', 'bash', '-lc', `${comando}; exec bash`], { detached: true, stdio: 'ignore' }).unref();
  }
}

/** Abre un archivo con el programa predeterminado del sistema. */
export function abrirArchivo(ruta: string) {
  if (WIN) spawn('explorer.exe', [ruta], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else abrirCarpeta(ruta);
}

export function abrirCarpeta(ruta: string) {
  const cmd = WIN ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(cmd, [ruta], { detached: true, stdio: 'ignore' }).unref();
}

let openCodeModelCache: { executable: string; expires: number; promise: Promise<string[]> } | undefined;

/** Read configured models without making an inference request. */
export function openCodeModels(): Promise<string[]> {
  const executable = rutaMotor('opencode');
  if (!executable) return Promise.resolve([]);
  if (openCodeModelCache?.executable === executable && openCodeModelCache.expires > Date.now()) return openCodeModelCache.promise;
  const promise = ejecutar(executable, ['models', '--standalone']).then(({ codigo, salida }) => codigo === 0
    ? [...new Set(salida.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[\w.:-]+\/[\w./:#-]+$/.test(line)))].slice(0, 2000)
    : []);
  openCodeModelCache = { executable, expires: Date.now() + 60_000, promise };
  return promise;
}
