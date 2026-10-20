// Compila el proceso principal de Electron (con el servidor) a dist/main.cjs y el servidor
// MCP de fuentes. Las dependencias del principal no se empaquetan: electron-builder las incluye.
import { build } from 'esbuild';
import { compilarMcp } from './compilar-mcp.mjs';

await build({
  entryPoints: ['electron/main.ts'],
  outfile: 'dist/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
});
await compilarMcp();
