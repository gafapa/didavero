import type { Motor } from './tipos';

export const ENGINE_IDS = ['claude', 'codex', 'opencode'] as const;
export const ENGINE_NAMES: Record<Motor, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };
export const ENGINE_INSTALL_URLS: Record<Motor, string> = {
  claude: 'https://code.claude.com/docs/en/setup',
  codex: 'https://developers.openai.com/codex/cli/',
  opencode: 'https://dev.opencode.ai/v2/docs/cli/',
};

export function isEngine(value: unknown): value is Motor {
  return ENGINE_IDS.some((engine) => engine === value);
}
