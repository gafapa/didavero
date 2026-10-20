/** Only Windows packages with an embedded trusted signing identity can use the installed updater. */
export function hasTrustedUpdatePublisher(platform: string, configuration: unknown): boolean {
  if (platform !== 'win32' || !configuration || typeof configuration !== 'object') return false;
  const input = configuration as { publisherName?: unknown; verifyUpdateCodeSignature?: unknown };
  const names = Array.isArray(input.publisherName) ? input.publisherName : [input.publisherName];
  return input.verifyUpdateCodeSignature !== false && names.length > 0 && names.every(name => typeof name === 'string' && name.trim().length > 0);
}
