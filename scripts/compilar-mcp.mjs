// Compila el servidor MCP de fuentes a dist/mcp-fuentes.cjs, autocontenido porque lo lanza
// un proceso aparte (Claude Code o Codex).
import { build } from 'esbuild';

export function compilarMcp() {
  return build({
    entryPoints: ['server/mcp-fuentes.ts'],
    outfile: 'dist/mcp-fuentes.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['pdfjs-dist'], // solo lo usa la indexación, no la búsqueda
    logLevel: 'warning',
  });
}
