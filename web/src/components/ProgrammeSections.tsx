import { useState } from 'react';
import { PROGRAMME_SECTIONS, type ProgrammeSection, type TeachingProgramme } from '../../../shared/teachingProgramme';
import { AreaTexto, Boton, Campo, Modal } from './ui';

export function ProgrammeSections({ programme, onChange }: { programme: TeachingProgramme; onChange: (value: TeachingProgramme) => void }) {
  const [selection, setSelection] = useState<{ kind: 'section' | 'archive' | 'input'; id: string }>();
  const sections = programme.researchedSections ?? [], archived = programme.archivedSections ?? [];
  const selectedSection = selection?.kind === 'section' ? sections.find(item => item.id === selection.id) : selection?.kind === 'archive' ? archived[Number(selection.id)] : undefined;
  const inputKey = selection?.kind === 'input' ? selection.id as ProgrammeSection : undefined;
  const title = selectedSection?.title ?? (inputKey ? PROGRAMME_SECTIONS[inputKey] : '');
  const text = selectedSection?.text ?? (inputKey ? programme.sections[inputKey] : '');
  const legacy = Object.entries(PROGRAMME_SECTIONS).filter(([key]) => !['context', 'requirements', 'selectionRequirements'].includes(key) && programme.sections[key as ProgrammeSection]?.trim() && !sections.some(item => item.id === key) && !archived.some(item => item.id === `legacy-${key}`));
  function edit(text: string) {
    if (inputKey) onChange({ ...programme, sections: { ...programme.sections, [inputKey]: text } });
    else if (selection?.kind === 'section') onChange({ ...programme, researchedSections: sections.map(item => item.id === selection.id ? { ...item, text } : item) });
    else if (selection?.kind === 'archive') onChange({ ...programme, archivedSections: archived.map((item, index) => index === Number(selection.id) ? { ...item, text } : item) });
  }
  return <>
    <section aria-labelledby="programme-sections-heading">
      <h3 id="programme-sections-heading" className="mb-2 font-semibold">Apartados de la programación</h3>
      {sections.length ? <><p className="mb-3 text-sm text-texto-2">Títulos y orden obtenidos en la investigación. Abre cada apartado para redactarlo o editarlo.</p><ol className="divide-y divide-borde">{sections.map((item, index) => <li key={item.id}><button className="flex w-full items-start gap-3 py-3 text-left hover:text-acento-texto cursor-pointer" onClick={() => setSelection({ kind: 'section', id: item.id })}><span className="text-sm text-texto-3 tabular-nums">{index + 1}.</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.title}</span><span className="mt-1 line-clamp-2 text-sm text-texto-2 whitespace-pre-line">{item.text || item.description}</span></span><span className="shrink-0 text-xs text-texto-3">{item.text ? 'Editar' : 'Redactar'}</span></button></li>)}</ol></> : <p className="text-sm text-texto-2">Usa Investigar para obtener los apartados adecuados a esta programación.</p>}
    </section>

    {(archived.length > 0 || legacy.length > 0) && <details><summary className="cursor-pointer text-sm font-medium">Textos anteriores sin asignar ({archived.length + legacy.length})</summary><p className="mt-2 text-sm text-texto-2">Textos conservados que no forman parte del índice actual. Puedes abrirlos para recuperarlos.</p><div className="mt-2 divide-y divide-borde">{archived.map((item, index) => <button key={`${item.id}:${index}`} className="block w-full py-3 text-left text-sm hover:text-acento-texto cursor-pointer" onClick={() => setSelection({ kind: 'archive', id: String(index) })}>{item.title}</button>)}{legacy.map(([key, label]) => <button key={key} className="block w-full py-3 text-left text-sm hover:text-acento-texto cursor-pointer" onClick={() => setSelection({ kind: 'input', id: key })}>{label}</button>)}</div></details>}
    <Modal abierto={!!title} onCerrar={() => setSelection(undefined)} titulo={title} ancho="max-w-3xl"><div className="space-y-4 pb-5">
      {selectedSection?.description && <p className="text-sm text-texto-2 whitespace-pre-line">{selectedSection.description}</p>}
      <Campo etiqueta={title}><AreaTexto rows={14} value={text} onChange={event => edit(event.target.value)} /></Campo>
      <Boton variante="primario" onClick={() => setSelection(undefined)}>Listo</Boton><p className="text-xs text-texto-3">Los cambios quedan en el borrador hasta guardar.</p>
    </div></Modal>
  </>;
}

export function ProgrammePlanningInputs({ programme, onChange }: { programme: TeachingProgramme; onChange: (value: TeachingProgramme) => void }) {
  const [selection, setSelection] = useState<ProgrammeSection>();
  return <>
    <details><summary className="cursor-pointer text-sm font-medium">Contexto y requisitos (opcional)</summary><p className="mt-2 text-sm text-texto-2">Estos datos orientan la investigación y la redacción. La etapa, asignatura, comunidad y curso se toman del currículo vinculado.</p><div className="mt-2 divide-y divide-borde">{(['context', 'requirements', ...(programme.purpose === 'opposition' ? ['selectionRequirements'] : [])] as ProgrammeSection[]).map(key => <button key={key} className="block w-full py-3 text-left text-sm hover:text-acento-texto cursor-pointer" onClick={() => setSelection(key)}>{PROGRAMME_SECTIONS[key]}<span className="mt-1 block line-clamp-2 text-texto-2 whitespace-pre-line">{programme.sections[key] || 'Añadir información (opcional)'}</span></button>)}</div></details>
    <Modal abierto={!!selection} onCerrar={() => setSelection(undefined)} titulo={selection ? PROGRAMME_SECTIONS[selection] : ''} ancho="max-w-3xl">{selection && <div className="space-y-4 pb-5"><Campo etiqueta={PROGRAMME_SECTIONS[selection]}><AreaTexto rows={10} value={programme.sections[selection]} onChange={event => onChange({ ...programme, sections: { ...programme.sections, [selection]: event.target.value } })} /></Campo><p className="text-xs text-texto-3">Describe necesidades del grupo y recursos disponibles sin datos personales del alumnado. Los cambios quedan en el borrador hasta guardar.</p><Boton variante="primario" onClick={() => setSelection(undefined)}>Listo</Boton></div>}</Modal>
  </>;
}
