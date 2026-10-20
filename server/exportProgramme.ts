import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CurriculumVersion } from '../shared/curriculum';
import type { ProgrammeResearch } from '../shared/programmeResearch';
import { programmeMarkdown, type ProgrammeExportFormat, type TeachingProgramme } from '../shared/teachingProgramme';
import { Almacen, ErrorUsuario, slug } from './store';
import { ejecutarBinario, rutaPandoc } from './conversion';
import { idiomaExportacion, plantillaTypst } from './exportar';
import { retocar } from './indiceDocumento';
import { applyProgrammeOfficePresentation, programmeTypstTemplate } from './programmePresentation';

export const PROGRAMME_EXPORT_MIMES: Record<ProgrammeExportFormat, string> = {
  md: 'text/markdown; charset=utf-8', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text', pdf: 'application/pdf',
};

/** Render a captured programme in an isolated workspace, without fetching embedded resources. */
export async function exportProgramme(storage: Almacen, subjectId: string, programme: TeachingProgramme, curriculum: CurriculumVersion,
  format: ProgrammeExportFormat, options: { dirBin?: string; reviewed?: boolean; research?: ProgrammeResearch } = {}) {
  const filename = `${(slug(programme.title) || 'programacion').slice(0, 100)}-${programme.purpose === 'opposition' ? 'oposiciones' : 'docente'}${options.reviewed ? '-revisada' : ''}.${format}`;
  const tableOfContents = programme.presentation?.includeTableOfContents === true && format !== 'md';
  // Keep the authored index in storage; binary exports replace a dedicated index section with a generated one.
  const published = tableOfContents ? { ...programme, researchedSections: programme.researchedSections?.filter(section => !/^(?:\d+[.)]?\s*)?(?:índice(?: de contenidos)?|tabla de contenidos)\s*$/i.test(section.title.trim())) } : programme;
  const markdown = programmeMarkdown(published, curriculum, options.research);
  if (format === 'md') return { filename, content: Buffer.from(markdown, 'utf8'), mime: PROGRAMME_EXPORT_MIMES.md };
  if (!options.dirBin || !existsSync(rutaPandoc(options.dirBin))) throw new ErrorUsuario('No se encuentra Pandoc para exportar la programación. Revisa la instalación de la app.');
  const typst = path.join(options.dirBin, process.platform === 'win32' ? 'typst.exe' : 'typst');
  if (format === 'pdf' && !existsSync(typst)) throw new ErrorUsuario('No se encuentra Typst para exportar a PDF. Revisa la instalación de la app.');
  const subject = await storage.obtenerAsignatura(subjectId), { lang, textos } = idiomaExportacion(subject.idioma);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'apuntes-programme-export-'));
  try {
    const input = path.join(directory, 'programme.md'), output = path.join(directory, filename), filter = path.join(directory, 'text-only.lua');
    await fs.writeFile(input, markdown.replace(/^# [^\n]*\n/, ''), 'utf8');
    // Links remain clickable; images cannot fetch remote URLs or include arbitrary local files.
    await fs.writeFile(filter, 'function Image(image) return pandoc.Str(pandoc.utils.stringify(image.caption)) end\n', 'utf8');
    const common = [input, '--sandbox', '-f', 'markdown-raw_html-raw_tex-raw_attribute', '--lua-filter', filter, '-s',
      '-M', `title=${programme.title}`, '-M', `subtitle=${subject.nombre}`, '-M', `lang=${lang}`, '-M', `toc-title=${textos.indice}`];
    if (tableOfContents) common.push('--toc', '--toc-depth=3');
    const color = /^#[a-f\d]{6}$/i.test(subject.color) ? subject.color : '#7c5cff';
    if (format === 'pdf') {
      if (programme.presentation) {
        const fonts = (await ejecutarBinario(typst, ['fonts'], directory)).split(/\r?\n/).map(font => font.trim().toLowerCase());
        if (!fonts.includes(programme.presentation.fontFamily.toLowerCase())) throw new ErrorUsuario(`La fuente ${programme.presentation.fontFamily} no está instalada. Instálala o elige otra antes de exportar.`);
      }
      await fs.writeFile(path.join(directory, 'programme-template.typ'), programme.presentation ? programmeTypstTemplate(programme.presentation) : plantillaTypst(color, { portada: false, saltoSeccion: false }), 'utf8');
      const typ = path.join(directory, 'programme.typ');
      await ejecutarBinario(rutaPandoc(options.dirBin), [...common, '-t', 'typst', '-o', typ, '-V', 'template=programme-template.typ', '-V', 'papersize=a4', '-V', 'page-numbering=1'], directory);
      await ejecutarBinario(typst, ['compile', '--root', directory, typ, output], directory, 300000);
      if (programme.presentation?.maxPages) {
        const pages = JSON.parse(await ejecutarBinario(typst, ['query', '--root', directory, typ, '<programme-page-count>', '--field', 'value'], directory));
        if (!Array.isArray(pages) || pages.length !== 1 || !Number.isSafeInteger(pages[0])) throw new ErrorUsuario('No se pudo comprobar el número de páginas del PDF.', 500);
        if (pages[0] > programme.presentation.maxPages) throw new ErrorUsuario(`El PDF tiene ${pages[0]} páginas y supera el límite configurado de ${programme.presentation.maxPages}. Ajusta el texto, el formato o los anexos y vuelve a exportar.`);
      }
    } else {
      const reference = storage.rutaPlantilla(subjectId, format);
      await ejecutarBinario(rutaPandoc(options.dirBin), [...common, '-o', output, ...(existsSync(reference) ? ['--reference-doc', reference] : [])], directory);
      await retocar(output, format, { portada: false, indice: false, color, plantillaPropia: existsSync(reference) });
      if (programme.presentation) await applyProgrammeOfficePresentation(output, format, programme.presentation);
    }
    return { filename, content: await fs.readFile(output), mime: PROGRAMME_EXPORT_MIMES[format] };
  } catch (error) {
    if (error instanceof ErrorUsuario) throw error;
    throw new ErrorUsuario(`No se pudo exportar la programación: ${(error as Error).message}`, 500);
  } finally { await fs.rm(directory, { recursive: true, force: true }).catch(() => {}); }
}
