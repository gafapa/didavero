import fs from 'node:fs/promises';
import JSZip from 'jszip';
import type { ProgrammePresentation } from '../shared/programmePresentation';

/** A uniform A4 layout; presentation settings never become executable Typst input. */
export function programmeTypstTemplate(settings: ProgrammePresentation) {
  const margin = settings.marginsCm;
  return `#let conf(title: none, subtitle: none, lang: "es", doc, ..options) = context {
  set document(title: title)
  set page(paper: "a4", margin: (top: ${margin.top}cm, right: ${margin.right}cm, bottom: ${margin.bottom}cm, left: ${margin.left}cm), footer: context align(center, counter(page).display("1")))
  set text(font: "${settings.fontFamily}", size: ${settings.fontSizePt}pt, lang: lang, top-edge: 0.8em, bottom-edge: -0.2em)
  set par(justify: true, leading: ${settings.lineSpacing - 1}em, spacing: 0em)
  set heading(numbering: none)
  show heading: it => block(above: 0.8em, below: 0.4em, sticky: true, text(size: ${settings.fontSizePt}pt, weight: "bold", it.body))
  show raw: set text(font: "${settings.fontFamily}", size: ${settings.fontSizePt}pt)
  show table.cell: set par(justify: false)
  if title != none { block(below: 0.8em, text(weight: "bold", title)) }
  doc
  context [#metadata(counter(page).final().first()) <programme-page-count>]
}`;
}

/** Override template defaults after conversion so a reference file cannot silently defeat explicit choices. */
export async function applyProgrammeOfficePresentation(filename: string, format: 'docx' | 'odt', settings: ProgrammePresentation) {
  const zip = await JSZip.loadAsync(await fs.readFile(filename));
  const margin = settings.marginsCm;
  if (format === 'docx') {
    const halfPoints = Math.round(settings.fontSizePt * 2), line = Math.round(settings.lineSpacing * 240);
    const fonts = `<w:rFonts w:ascii="${settings.fontFamily}" w:hAnsi="${settings.fontFamily}" w:eastAsia="${settings.fontFamily}" w:cs="${settings.fontFamily}"/>`;
    const size = `<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>`;
    for (const file of Object.values(zip.files).filter(file => /^word\/(document|styles|numbering|header\d*|footer\d*)\.xml$/.test(file.name))) {
      let xml = await file.async('string');
      xml = xml.replace(/<w:rFonts\b[^>]*\/>/g, fonts).replace(/<w:sz(?:Cs)?\b[^>]*\/>/g, '').replace(/<w:rPr>/g, `<w:rPr>${size}`)
        .replace(/<w:spacing\b[^>]*\/>/g, `<w:spacing w:before="0" w:after="0" w:line="${line}" w:lineRule="auto"/>`);
      if (file.name === 'word/numbering.xml') xml = xml.replace(/(<w:lvlText\b[^>]*w:val=")[\uf0b7\uf0a7\uf0d8](")/g, '$1•$2');
      xml = xml.replace(/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/, `<w:rPrDefault><w:rPr>${fonts}${size}</w:rPr></w:rPrDefault>`);
      const twips = (cm: number) => Math.round(cm / 2.54 * 1440);
      const page = `<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${twips(margin.top)}" w:right="${twips(margin.right)}" w:bottom="${twips(margin.bottom)}" w:left="${twips(margin.left)}" w:header="0" w:footer="360" w:gutter="0"/>`;
      xml = xml.replace(/<w:pg(?:Mar|Sz)\b[^>]*\/>/g, '').replace(/(<w:sectPr\b[^>]*>)([\s\S]*?)(<\/w:sectPr>)/g, (_match, open: string, body: string, close: string) => {
        const following = body.search(/<w:(?:paperSrc|pgBorders|lnNumType|pgNumType|cols|formProt|vAlign|noEndnote|titlePg|textDirection|bidi|rtlGutter|docGrid|printerSettings|sectPrChange)\b/);
        return open + (following < 0 ? body + page : body.slice(0, following) + page + body.slice(following)) + close;
      });
      zip.file(file.name, xml);
    }
  } else {
    for (const name of ['styles.xml', 'content.xml']) {
      let xml = await zip.file(name)!.async('string');
      xml = xml.replace(/<style:text-properties\b([^>]*?)(\/?)>/g, (_match, attributes: string, close: string) => {
        const clean = attributes.replace(/\s+(?:style:font-name(?:-asian|-complex)?|fo:font-family|fo:font-size|style:font-size-asian|style:font-size-complex)="[^"]*"/g, '');
        return `<style:text-properties${clean} fo:font-family="${settings.fontFamily}" fo:font-size="${settings.fontSizePt}pt"${close}>`;
      }).replace(/<style:paragraph-properties\b([^>]*?)(\/?)>/g, (_match, attributes: string, close: string) =>
        `<style:paragraph-properties${attributes.replace(/\s+(?:fo:line-height|style:line-height-at-least|style:line-spacing|fo:margin-top|fo:margin-bottom)="[^"]*"/g, '')} fo:line-height="${settings.lineSpacing * 100}%" fo:margin-top="0cm" fo:margin-bottom="0cm"${close}>`)
        .replace(/<style:page-layout-properties\b([^>]*?)(\/?)>/g, (_match, attributes: string, close: string) =>
          `<style:page-layout-properties${attributes.replace(/\s+fo:(?:margin(?:-top|-right|-bottom|-left)?|page-width|page-height)="[^"]*"/g, '')} fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="${margin.top}cm" fo:margin-right="${margin.right}cm" fo:margin-bottom="${margin.bottom}cm" fo:margin-left="${margin.left}cm"${close}>`);
      zip.file(name, xml);
    }
  }
  await fs.writeFile(filename, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}
