export const PROGRAMME_FONTS = ['Arial', 'Calibri', 'Times New Roman', 'Liberation Sans'] as const;
export interface ProgrammePresentation {
  fontFamily: typeof PROGRAMME_FONTS[number]; fontSizePt: number; lineSpacing: number;
  marginsCm: { top: number; right: number; bottom: number; left: number };
  includeAppendices: boolean; compactReferences?: boolean; includeTableOfContents?: boolean; maxPages?: number; minUnits?: number;
}
export function defaultProgrammePresentation(): ProgrammePresentation {
  return { fontFamily: 'Arial', fontSizePt: 12, lineSpacing: 1.5, marginsCm: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 }, includeAppendices: true };
}
/** Parse explicit presentation decisions without inferring rules from free text. */
export function parseProgrammePresentation(value: unknown): ProgrammePresentation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Formato de presentación no válido.');
  const input = value as ProgrammePresentation;
  const number = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  if (!PROGRAMME_FONTS.includes(input.fontFamily) || !number(input.fontSizePt, 8, 24) || !Number.isSafeInteger(input.fontSizePt * 2) || !number(input.lineSpacing, 1, 3) || typeof input.includeAppendices !== 'boolean'
    || !input.marginsCm || typeof input.marginsCm !== 'object' || ['top', 'right', 'bottom', 'left'].some(side => !number(input.marginsCm[side as keyof typeof input.marginsCm], 0.5, 5))
    || (input.compactReferences !== undefined && typeof input.compactReferences !== 'boolean')
    || (input.includeTableOfContents !== undefined && typeof input.includeTableOfContents !== 'boolean')
    || (input.maxPages !== undefined && (!Number.isSafeInteger(input.maxPages) || !number(input.maxPages, 1, 500)))
    || (input.minUnits !== undefined && (!Number.isSafeInteger(input.minUnits) || !number(input.minUnits, 1, 200)))) throw new Error('Revisa fuente, tamaño, interlineado, márgenes y límites de presentación.');
  return { fontFamily: input.fontFamily, fontSizePt: input.fontSizePt, lineSpacing: input.lineSpacing, marginsCm: { top: input.marginsCm.top, right: input.marginsCm.right, bottom: input.marginsCm.bottom, left: input.marginsCm.left }, includeAppendices: input.includeAppendices,
    ...(input.compactReferences === undefined ? {} : { compactReferences: input.compactReferences }),
    ...(input.includeTableOfContents === undefined ? {} : { includeTableOfContents: input.includeTableOfContents }),
    ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages }), ...(input.minUnits === undefined ? {} : { minUnits: input.minUnits }) };
}
