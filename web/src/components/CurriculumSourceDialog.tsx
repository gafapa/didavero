import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { isOfficialCurriculumUrl, type CurriculumSource } from '../../../shared/curriculum';
import { AreaTexto, Boton, Campo, Entrada, Modal, confirmar } from './ui';

type Props = { source: CurriculumSource; creating: boolean; disabled: boolean; onApply: (source: CurriculumSource) => void; onClose: () => void };
export function CurriculumSourceDialog({ source, creating, disabled, onApply, onClose }: Props) {
  const [value, setValue] = useState(() => structuredClone(source));
  const [error, setError] = useState('');
  const dirty = JSON.stringify(value) !== JSON.stringify(source);
  const update = (patch: Partial<CurriculumSource>) => setValue(current => ({ ...current, reviewed: false, ...patch }));
  const close = async () => { if (!dirty || await confirmar('¿Descartar los cambios de esta fuente?', { boton: 'Descartar cambios' })) onClose(); };
  return <Modal abierto titulo={creating ? 'Añadir fuente del currículo' : 'Modificar fuente del currículo'} ancho="max-w-2xl" onCerrar={() => void close()} footer={<div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-texto-3">Los cambios se aplican al borrador. Después guarda el currículo.</p><div className="flex gap-2"><Boton className="min-h-11" onClick={() => void close()}>Cancelar</Boton><Boton className="min-h-11" variante="primario" disabled={disabled || !value.title.trim() || (!creating && !dirty)} onClick={() => { try { onApply(value); } catch (failure) { setError((failure as Error).message); } }}>{creating ? 'Añadir al borrador' : 'Aplicar al borrador'}</Boton></div></div>}>
    <fieldset disabled={disabled} className="space-y-4">
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
      <Campo etiqueta="Nombre completo de la norma"><Entrada value={value.title} onChange={event => update({ title: event.target.value })} /></Campo>
      <div className="grid gap-4 sm:grid-cols-2"><Campo etiqueta="Tipo de fuente"><select className="min-h-11 w-full rounded-xl border border-borde bg-panel px-3 text-sm" value={value.origin} onChange={event => update({ origin: event.target.value as CurriculumSource['origin'] })}><option value="official">Publicación oficial</option><option value="provided">Documento normativo aportado</option></select></Campo><Campo etiqueta="Fecha de publicación"><Entrada type="date" value={value.publishedOn} onChange={event => update({ publishedOn: event.target.value })} /></Campo></div>
      <Campo etiqueta="Enlace oficial HTTPS"><Entrada type="url" value={value.url} onChange={event => update({ url: event.target.value })} /></Campo>
      {value.origin === 'provided' && <Campo etiqueta="Nombre del documento aportado"><Entrada value={value.filename} onChange={event => update({ filename: event.target.value })} /></Campo>}
      {isOfficialCurriculumUrl(value.url) && <a className="inline-flex min-h-11 items-center gap-2 text-sm text-acento-texto underline underline-offset-4" href={value.url} target="_blank" rel="noreferrer">Abrir publicación oficial<ExternalLink aria-hidden="true" className="size-4" /><span className="sr-only"> (en otra pestaña)</span></a>}
      <Campo etiqueta="Aplicación al curso o fecha de implantación"><Entrada value={value.applicableFrom} onChange={event => update({ applicableFrom: event.target.value })} /></Campo>
      <Campo etiqueta="Ámbito, modificaciones y observaciones"><AreaTexto rows={3} value={value.notes} onChange={event => update({ notes: event.target.value })} /></Campo>
      <label className="flex min-h-11 items-start gap-3 text-sm"><input className="mt-1 size-4 shrink-0 accent-acento" type="checkbox" checked={value.reviewed} onChange={event => update({ reviewed: event.target.checked })} />He comprobado la fuente y su aplicación a este perfil.</label>
    </fieldset>
  </Modal>;
}
