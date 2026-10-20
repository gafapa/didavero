import path from 'node:path';
import type { PeticionTrabajo } from './cola';
import type { Tokens } from '../../shared/tipos';

/** Per-process overrides for the OpenCode 2 standalone server. Never edit user configuration. */
export function openCodeInvocation(request: Omit<PeticionTrabajo, 'prompt'>): { args: string[]; env: NodeJS.ProcessEnv } {
  const rule = (action: string, resource = '*', effect = 'allow') => ({ action, resource, effect });
  const directories = [request.cwd, ...(request.dirsExtra ?? [])].map((directory) => path.resolve(directory).replaceAll('\\', '/'));
  const permissions = [
    rule('*', '*', 'deny'),
    ...['read', 'glob', 'grep'].map((action) => rule(action)),
    ...directories.flatMap((directory) => [rule('external_directory', directory), rule('external_directory', `${directory}/**`)]),
    rule('edit', `${directories[0]}/**`),
    ...(request.web ? [rule('websearch'), rule('webfetch')] : []),
    ...(request.mcp ? [rule('fuentes_*')] : []),
  ];
  const config = {
    snapshots: false,
    formatter: false,
    warming: false,
    agents: { apuntes: { description: 'Apuntes task agent', mode: 'primary', system: request.sistema ?? 'Complete the requested task.', permissions } },
    ...(request.mcp ? { mcp: { servers: { fuentes: {
      type: 'local', command: [request.mcp.comando, ...request.mcp.args],
      environment: request.mcp.env ?? {}, codemode: false,
    } } } } : {}),
  };
  return {
    args: ['run', '--standalone', '--format', 'json', '--agent', 'apuntes',
      ...(request.modelo ? ['--model', request.modelo] : []),
      ...(request.reanudar ? ['--session', request.reanudar] : [])],
    env: {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_CONFIG_PROJECT_DISABLE: '1',
      OPENCODE_DISABLE_CLAUDE_CODE: '1',
      OPENCODE_CLIENT: 'apuntes-ia',
    },
  };
}

/** OpenCode reports non-cached input separately, and visible output separately from reasoning. */
export function openCodeTokens(usage: any): Tokens {
  const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  const cache = count(usage?.cache?.read);
  return {
    entrada: count(usage?.input) + cache + count(usage?.cache?.write),
    salida: count(usage?.output) + count(usage?.reasoning),
    cache,
  };
}
