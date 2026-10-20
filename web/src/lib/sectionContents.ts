import type { Seccion } from '../../../shared/tipos';
export type SectionContentCache = Map<string, { revision: string; texto: string }>;
/** Reload only changed files, with bounded concurrency and a caller-owned publication step. */
export async function loadSectionContents(sections: Seccion[], previous: SectionContentCache, read: (filename: string) => Promise<{ contenido: string }>) {
  const cache: SectionContentCache = new Map(), contents = new Array<{ archivo: string; texto: string }>(sections.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, sections.length) }, async () => {
    while (next < sections.length) {
      const index = next++, section = sections[index], existing = previous.get(section.archivo);
      const text = section.revision && existing?.revision === section.revision ? existing.texto : (await read(section.archivo)).contenido;
      cache.set(section.archivo, { revision: section.revision ?? '', texto: text });
      contents[index] = { archivo: section.archivo, texto: text };
    }
  }));
  return { cache, contents };
}
