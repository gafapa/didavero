import { useState } from 'react';
import type { TeachingProgramme } from '../../../shared/teachingProgramme';
import { defaultProgrammePresentation, PROGRAMME_FONTS, type ProgrammePresentation } from '../../../shared/programmePresentation';
import { Boton, Campo, Entrada, Modal } from './ui';

export function ProgrammePresentationEditor({ programme, onChange, disabled }: { programme: TeachingProgramme; onChange: (value: TeachingProgramme) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false), settings = programme.presentation;
  function update(changes: Partial<ProgrammePresentation>) { onChange({ ...programme, presentation: { ...(settings ?? defaultProgrammePresentation()), ...changes } }); }
  return <>
    <Boton disabled={disabled} onClick={() => setOpen(true)}>Presentación{settings ? ' · A4' : ''}</Boton>
    <Modal abierto={open} onCerrar={() => setOpen(false)} titulo="Presentación de la programación" ancho="max-w-2xl"><div className="space-y-5 pb-5">
      <p className="text-sm text-texto-2">Configura el formato que indiquen la investigación y tu convocatoria o centro. Estos valores son decisiones editables; no acreditan por sí solos el cumplimiento de una convocatoria.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!settings} onChange={event => onChange({ ...programme, presentation: event.target.checked ? defaultProgrammePresentation() : undefined })} />Aplicar formato personalizado en A4</label>
      {settings && <>
        <div className="grid gap-4 sm:grid-cols-3"><Campo etiqueta="Fuente"><select className="w-full rounded-lg border border-borde bg-panel p-2 text-sm" value={settings.fontFamily} onChange={event => update({ fontFamily: event.target.value as ProgrammePresentation['fontFamily'] })}>{PROGRAMME_FONTS.map(font => <option key={font} value={font}>{font}</option>)}</select></Campo>
          <Campo etiqueta="Tamaño (puntos)"><Entrada type="number" min={8} max={24} step={0.5} value={settings.fontSizePt} onChange={event => update({ fontSizePt: Number(event.target.value) })} /></Campo>
          <Campo etiqueta="Interlineado"><select className="w-full rounded-lg border border-borde bg-panel p-2 text-sm" value={settings.lineSpacing} onChange={event => update({ lineSpacing: Number(event.target.value) })}>{[1, 1.15, 1.5, 2, 2.5, 3].map(value => <option key={value} value={value}>{value === 1 ? 'Sencillo' : value === 2 ? 'Doble' : value}</option>)}</select></Campo></div>
        <fieldset><legend className="mb-2 text-sm font-medium">Márgenes en centímetros</legend><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{([['top', 'Superior'], ['right', 'Derecho'], ['bottom', 'Inferior'], ['left', 'Izquierdo']] as const).map(([side, label]) => <Campo key={side} etiqueta={label}><Entrada type="number" min={0.5} max={5} step={0.1} value={settings.marginsCm[side]} onChange={event => update({ marginsCm: { ...settings.marginsCm, [side]: Number(event.target.value) } })} /></Campo>)}</div></fieldset>
        <div className="grid gap-4 sm:grid-cols-2"><Campo etiqueta="Máximo de páginas del PDF (opcional)" ayuda="Se comprueba sobre el PDF generado. Word y LibreOffice pueden paginar de otra forma."><Entrada type="number" min={1} max={500} value={settings.maxPages ?? ''} onChange={event => update({ maxPages: event.target.value ? Number(event.target.value) : undefined })} /></Campo>
          <Campo etiqueta="Mínimo de unidades (opcional)"><Entrada type="number" min={1} max={200} value={settings.minUnits ?? ''} onChange={event => update({ minUnits: event.target.value ? Number(event.target.value) : undefined })} /></Campo></div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={settings.includeAppendices} onChange={event => update({ includeAppendices: event.target.checked })} />Incluir anexos de trazabilidad: textos anteriores, datos de partida, fuentes e investigación.</label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={settings.compactReferences === true} onChange={event => update({ compactReferences: event.target.checked })} />Referencias compactas: mostrar códigos en unidades y actividades, con sus referentes superiores.</label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={settings.includeTableOfContents === true} onChange={event => update({ includeTableOfContents: event.target.checked })} />Generar índice automático en PDF, Word y LibreOffice.</label>
        <p className="text-xs text-texto-3">El PDF incluye páginas calculadas. En Word o LibreOffice puede ser necesario actualizar el índice al abrir el archivo. El índice automático sustituye el apartado dedicado al índice solo al exportar; su texto original se conserva en la app.</p>
        <p className="text-xs text-texto-3">Con referencias compactas se evita repetir el currículo completo en cada actividad. La vinculación exacta se conserva en la app; si incluyes anexos, los textos completos aparecen una sola vez al final.</p>
        <p className="text-xs text-texto-3">El límite cuenta todas las páginas exportadas. Si la convocatoria excluye anexos, puedes exportar el cuerpo sin estos anexos. La app conserva los originales. El formato personalizado prevalece sobre la plantilla de Word o LibreOffice.</p>
      </>}
      <Boton variante="primario" onClick={() => setOpen(false)}>Listo</Boton><p className="text-xs text-texto-3">Los ajustes quedan en el borrador hasta guardar. La copia revisada conserva su propio formato.</p>
    </div></Modal>
  </>;
}
