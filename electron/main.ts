// Proceso principal de Electron: arranca el servidor local y abre la ventana.
import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';
import { crearServidor } from '../server/index';
import { isApplicationUrl } from '../server/localSecurity';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { productStoragePaths } from './storagePaths';
import { load } from 'js-yaml';
import { hasTrustedUpdatePublisher } from './updatePolicy';

let ventana: BrowserWindow | null = null;
let servidor: Awaited<ReturnType<typeof crearServidor>> | null = null;

/**
 * Versión portable (npm run dist:portable): un único .exe que no se instala. Ajustes, apuntes y
 * datos de la ventana van en «Apuntes IA datos», junto al .exe, para llevarla en una memoria USB.
 * Tiene que decidirse antes de pedir el bloqueo de instancia única, que usa la carpeta userData.
 */
const storage = productStoragePaths(app.getPath('appData'), app.getPath('documents'), process.env.PORTABLE_EXECUTABLE_DIR, existsSync);
const DIR_PORTABLE = storage.portable;
app.setPath('userData', storage.userData);
// Windows solo muestra los avisos del sistema (notificaciones) de una app con identificador propio
if (process.platform === 'win32') app.setAppUserModelId('es.apuntesia.app');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (ventana) {
      if (ventana.isMinimized()) ventana.restore();
      ventana.focus();
    }
  });
  app.whenReady().then(iniciar).catch((e) => {
    dialog.showErrorBox('Didavero no ha podido arrancar', String(e?.stack ?? e));
    app.quit();
  });
}

/**
 * Modo «app en vivo» (npm run app): la ventana carga la interfaz desde Vite y usa un servidor
 * aparte que se recarga solo, así los cambios en el código se ven al momento sin reinstalar.
 */
const URL_EN_VIVO = process.env.APUNTES_EN_VIVO;
// En vivo se puede inspeccionar la ventana desde fuera (chrome://inspect o http://127.0.0.1:9333/json)
if (URL_EN_VIVO) app.commandLine.appendSwitch('remote-debugging-port', '9333');

async function iniciar() {
  Menu.setApplicationMenu(null);
  if (!URL_EN_VIVO) servidor = await crearServidor({
    archivoAjustes: DIR_PORTABLE ? path.join(DIR_PORTABLE, 'ajustes.json') : path.join(app.getPath('userData'), 'ajustes.json'),
    carpetaDatosPorDefecto: storage.data,
    dirEstatico: path.join(__dirname, '..', 'dist-web'),
    dirBin: app.isPackaged
      ? path.join(process.resourcesPath, 'bin')
      : path.join(__dirname, '..', 'resources-bin', { win32: 'win', darwin: 'mac' }[process.platform as string] ?? 'linux'),
    version: app.getVersion(),
    instalarActualizacion: () => autoUpdater.quitAndInstall(),
    // El ejecutable de la app hace de Node para el servidor MCP de fuentes
    mcpFuentes: { comando: process.execPath, args: [path.join(__dirname, 'mcp-fuentes.cjs')], env: { ELECTRON_RUN_AS_NODE: '1' } },
  });

  ventana = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: URL_EN_VIVO ? 'Didavero · en vivo' : 'Didavero',
    backgroundColor: '#0f1117',
    show: false,
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  ventana.once('ready-to-show', () => ventana?.show());

  // Los enlaces externos se abren en el navegador del sistema
  const urlApp = URL_EN_VIVO ?? servidor!.url;
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !isApplicationUrl(url, urlApp)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  ventana.webContents.on('will-navigate', (e, url) => {
    if (!isApplicationUrl(url, urlApp)) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  // F12 / Ctrl+Shift+I para depurar, Ctrl+R para recargar
  ventana.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      ventana?.webContents.toggleDevTools();
    } else if (input.control && input.key.toLowerCase() === 'r') {
      ventana?.webContents.reload();
    }
  });

  // «inicio» identifica este arranque: la pantalla de requisitos sale una vez por arranque
  await ventana.loadURL(`${urlApp}?inicio=${Date.now()}`);
  comprobarActualizaciones();
}

/** Signed Windows updates require an explicit install action; other packages use manual releases. */
async function comprobarActualizaciones() {
  // La portable no se actualiza sola (no hay instalador que sustituir): se descarga la nueva
  if (!app.isPackaged || DIR_PORTABLE) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  try {
    const configuration = load(await fs.readFile(path.join(process.resourcesPath, 'app-update.yml'), 'utf8'));
    if (!hasTrustedUpdatePublisher(process.platform, configuration)) return;
  } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', (i) => servidor?.avisarActualizacion('disponible', i.version));
  autoUpdater.on('update-downloaded', (i) => servidor?.avisarActualizacion('descargada', i.version));
  autoUpdater.on('error', (e) => console.warn('Actualizaciones:', e?.message ?? e));
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
}

app.on('window-all-closed', () => app.quit());

let cerrando = false;
app.on('before-quit', (e) => {
  if (cerrando || !servidor) return;
  e.preventDefault();
  cerrando = true;
  servidor.cerrar().finally(() => app.quit());
});
