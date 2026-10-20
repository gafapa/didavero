// Arranque del servidor sin Electron (lo recarga `tsx watch` al cambiar el código).
//
// - `npm run dev`: datos de prueba en «Documentos/Apuntes IA (desarrollo)».
// - `npm run app`: modo «app en vivo» con los datos y ajustes reales de la app instalada.
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { productStoragePaths } from '../electron/storagePaths';
import { crearServidor } from './index';
// @ts-expect-error: script de compilación en JavaScript
import { compilarMcp } from '../scripts/compilar-mcp.mjs';

const real = process.env.APUNTES_REAL === '1';
const appData = process.platform === 'win32' ? process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
  : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
const storage = productStoragePaths(appData, path.join(os.homedir(), 'Documents'), undefined, existsSync);
const datos = process.env.APUNTES_DATOS ?? (real ? storage.data : path.join(os.homedir(), 'Documents', 'Didavero (desarrollo)'));
const archivoAjustes = real ? path.join(storage.userData, 'ajustes.json') : path.join(datos, '.ajustes-dev.json');

compilarMcp().then(() => crearServidor({
  archivoAjustes,
  carpetaDatosPorDefecto: datos,
  puerto: Number(process.env.APUNTES_PUERTO ?? 4317),
  dirBin: path.resolve('resources-bin', { win32: 'win', darwin: 'mac' }[process.platform as string] ?? 'linux'),
  version: real ? 'en vivo' : 'desarrollo',
  dirTrabajos: real ? undefined : path.join(datos, '.trabajos'),
  // APUNTES_SIN_RAG=1 desactiva la búsqueda en fuentes (para comparar el consumo de tokens)
  mcpFuentes: process.env.APUNTES_SIN_RAG ? undefined : { comando: process.execPath, args: [path.resolve('dist/mcp-fuentes.cjs')] },
})).catch((e: any) => {
  console.error(e?.code === 'EADDRINUSE' ? 'El puerto 4317 está ocupado: ya hay otro servidor de Didavero abierto.' : e);
  process.exit(1);
}).then((servidor: Awaited<ReturnType<typeof crearServidor>> | void) => {
  if (!servidor) return;
  console.log(`Servidor en ${servidor.url} · ajustes en ${archivoAjustes}`);
  // Al reiniciarse (tsx watch) o cerrarse, se cierran los agentes; se relanzan al arrancar de nuevo
  const salir = () => servidor.cerrar().finally(() => process.exit(0));
  process.once('SIGTERM', salir);
  process.once('SIGINT', salir);
});
