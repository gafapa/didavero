/** Prepare exact file selections locally; never summarize or split a source section. */
export async function buildSectionReference(
  filenames: string[],
  read: (filename: string) => Promise<string>,
  characterLimit = 90_000,
): Promise<string> {
  const unique = [...new Set(filenames)];
  const bodies: string[] = [];
  const manifest: string[] = [];
  let remaining = characterLimit;
  // Read only requested files, one at a time to bound transient memory.
  for (const filename of unique) {
    const text = await read(filename);
    const included = text.length <= remaining;
    manifest.push(`- secciones/${filename}: ${included ? 'incluida completa' : 'PENDIENTE: leer el archivo completo con herramientas'} (${text.length} caracteres)`);
    if (included) {
      bodies.push(`===== secciones/${filename} =====\n${text}\n===== fin de secciones/${filename} =====`);
      remaining -= text.length;
    }
  }
  return ['### Alcance de las secciones seleccionadas',
    'Revisa todas las secciones de esta lista. Las pendientes no están incluidas: léelas antes de concluir. No sustituyas una revisión completa por una búsqueda de fragmentos.',
    ...manifest, ...bodies].join('\n');
}
