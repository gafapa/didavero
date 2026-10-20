import { useEffect, useState } from 'react';
import { Archive, Copy, FileDown, FileText, FileUp, Plus, Trash2 } from 'lucide-react';
import type { AsignaturaDetalle } from '../../../shared/tipos';
import { api } from '../lib/api';
import { useCampos } from '../lib/estado';
import { AreaTexto, Boton, Campo, Vacio, confirmar, cx } from './ui';
import { GastoTokens } from './ContadorTokens';
import { GestorFuentes } from './GestorFuentes';
import { ModalImportar, ModalNuevoDocumento } from './Modales';
import { ModalDuplicarAsignatura, ModalExportarTodos } from './Gestion';
import { PestanaCurriculo, PestanaGlosario, PestanaPlantillas } from './PestanasAsignatura';
import { PestanaExamenes } from './Examenes';
import { SelectorEnsenanza, type ValorEnsenanza } from './SelectorEnsenanza';
import { EditorPermisos } from './EditorPermisos';
import { describirNivel, type Etapa } from '../../../shared/catalogo/educacion';
import { CURRICULUM_TERRITORIES } from '../../../shared/curriculum';
import { TeachingProgrammeTab } from './TeachingProgramme';

/** Las asignaturas antiguas guardaban «español»; ahora el idioma es «Castellano». */
const normalizarIdioma = (i: string) => (/^(español|castellano)$/i.test(i.trim()) ? 'Castellano' : i);

const COLORES = ['#7c5cff', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#64748b'];

type Pestana = 'documentos' | 'examenes' | 'contexto' | 'material' | 'curriculo' | 'programacion' | 'glosario' | 'plantillas';

export function VistaAsignatura({ asignatura }: { asignatura: string }) {
  const { seleccionar, cargarAsignaturas, avisar, versiones, reconexion } = useCampos('seleccionar', 'cargarAsignaturas', 'avisar', 'versiones', 'reconexion');
  const [a, setA] = useState<AsignaturaDetalle>();
  const [examCount, setExamCount] = useState<number>();
  const [programmeCount, setProgrammeCount] = useState<number>();
  const [pestana, setPestana] = useState<Pestana>('documentos');
  const [nuevoDoc, setNuevoDoc] = useState(false);
  const [importar, setImportar] = useState(false);
  const [duplicar, setDuplicar] = useState(false);
  const [exportarTodos, setExportarTodos] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const version = `${versiones[`${asignatura}/`] ?? 0}-${reconexion}`; // también al reconectar con el servidor

  useEffect(() => {
    api.asignatura(asignatura).then(setA).catch((e) => avisar(e.message, 'error'));
  }, [asignatura, version, avisar]);

  useEffect(() => {
    let current = true;
    api.programmes(asignatura).then(projects => { if (current) setProgrammeCount(projects.length); }).catch(() => { if (current) setProgrammeCount(undefined); });
    return () => { current = false; };
  }, [asignatura, version]);

  useEffect(() => {
    let current = true;
    api.examenes(asignatura).then((exams) => {
      if (current) setExamCount(exams.length);
    }).catch(() => { if (current) setExamCount(undefined); });
    return () => { current = false; };
  }, [asignatura, version]);

  if (!a) return null;

  const deleteNotes = async (id: string, title: string) => {
    if (deletingId || !await confirmar(`¿Eliminar «${title}»?`, {
      texto: 'Se moverán los apuntes completos a la papelera, con sus secciones, actividades y archivos. Puedes recuperarlos en Inicio → Papelera.',
      boton: 'Mover a la papelera', peligro: true,
    })) return;
    setDeletingId(id);
    try {
      await api.eliminarDocumento(a.id, id);
      setA(await api.asignatura(a.id));
      await cargarAsignaturas();
      avisar('Apuntes movidos a la papelera.', 'ok');
    } catch (error) { avisar((error as Error).message, 'error'); }
    finally { setDeletingId(''); }
  };

  const eliminar = async () => {
    const ok = await confirmar(`¿Eliminar la asignatura «${a.nombre}»?`, {
      texto: 'Se moverá con todos sus apuntes a la papelera, de donde podrás recuperarla (pantalla de inicio → Papelera).',
      boton: 'Eliminar',
      peligro: true,
    });
    if (!ok) return;
    await api.eliminarAsignatura(a.id);
    await cargarAsignaturas();
    seleccionar({});
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl px-10 pt-10 pb-16">
        <div className="flex items-start gap-4">
          <div className="mt-1.5 size-4 rounded-full" style={{ background: a.color }} />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{a.nombre}</h1>
            <p className="mt-0.5 text-texto-2">
              {[a.nivel, a.idioma].filter(Boolean).join(' · ')}
              {a.destinatarios && <span className="text-texto-3"> · Para: {a.destinatarios}</span>}
            </p>
          </div>
          <GastoTokens asignatura={a.id} etiqueta="Tokens" className="mt-2 shrink-0 text-[12.5px]" />
        </div>
        <div className="mt-3 ml-8 flex flex-wrap gap-1.5">
          {a.documentos.length > 0 && (
            <Boton tam="sm" variante="fantasma" icono={<FileDown className="size-3.5" />} onClick={() => setExportarTodos(true)}>
              Exportar todos
            </Boton>
          )}
          <Boton tam="sm" variante="fantasma" icono={<Copy className="size-3.5" />} title="Para otro grupo o para el curso que viene" onClick={() => setDuplicar(true)}>
            Duplicar
          </Boton>
          <Boton
            tam="sm"
            variante="fantasma"
            icono={<Archive className="size-3.5" />}
            title="Un .zip con la asignatura, sus apuntes y sus fuentes, para guardarlo aparte o llevarlo a otro equipo"
            onClick={() => api.descargarCopia([a.id])}
          >
            Copia de seguridad
          </Boton>
        </div>

        <div className="mt-8 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-borde">
          {(
            [
              ['contexto', 'Contexto'],
              ['documentos', `Apuntes (${a.documentos.length})`],
              ['examenes', `Exámenes (${examCount ?? '…'})`],
              ['programacion', `Programaciones (${programmeCount ?? '…'})`],
              ['material', 'Fuentes'],
              ['glosario', 'Glosario'],
              ['curriculo', 'Currículo'],
              ['plantillas', 'Plantillas'],
            ] as [Pestana, string][]
          ).map(([id, txt]) => (
            <button
              key={id}
              onClick={() => setPestana(id)}
              className={cx(
                '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer',
                pestana === id ? 'border-acento text-acento-texto' : 'border-transparent text-texto-2 hover:text-texto',
              )}
            >
              {txt}
            </button>
          ))}
        </div>

        <div className="pt-6">
          {pestana === 'documentos' &&
            (a.documentos.length === 0 ? (
              <Vacio
                icono={<FileText className="size-6" />}
                titulo="Sin apuntes todavía"
                texto="Organiza los apuntes por temas o unidades, cada uno con sus propias secciones."
                accion={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Boton variante="primario" icono={<Plus className="size-4" />} onClick={() => setNuevoDoc(true)}>
                      Nuevos apuntes
                    </Boton>
                    <Boton icono={<FileUp className="size-4" />} onClick={() => setImportar(true)}>
                Importar apuntes existentes
                    </Boton>
                  </div>
                }
              />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                {a.documentos.map((d) => (
                  <div key={d.id} className="rounded-xl border border-borde bg-panel shadow-suave transition-colors hover:border-acento/50">
                  <button
                    onClick={() => seleccionar({ asignatura: a.id, documento: d.id })}
                    disabled={deletingId === d.id}
                    className="w-full rounded-xl p-4 text-left cursor-pointer disabled:cursor-wait"
                  >
                    <FileText className="mb-3 size-5 text-acento-texto" />
                    <div className="font-medium leading-snug">{d.titulo}</div>
                    {d.objetivo && <p className="mt-1 line-clamp-2 text-[13px] text-texto-2">{d.objetivo}</p>}
                    <div className="mt-3 flex items-center justify-between gap-2 text-xs text-texto-3">
                      <span>Actualizado {new Date(d.actualizado).toLocaleDateString('es', { day: 'numeric', month: 'short' })}</span>
                      <GastoTokens asignatura={a.id} documento={d.id} />
                    </div>
                  </button>
                  <div className="flex justify-end px-3 pb-3"><Boton tam="sm" variante="fantasma" icono={<Trash2 className="size-3.5" />} aria-label={`Eliminar apuntes ${d.titulo}`} disabled={!!deletingId} cargando={deletingId === d.id} onClick={() => void deleteNotes(d.id, d.titulo)}>Eliminar</Boton></div>
                  </div>
                ))}
                <button
                  onClick={() => setNuevoDoc(true)}
                  className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-borde text-texto-3 transition-colors hover:border-acento hover:text-acento-texto cursor-pointer"
                >
                  <Plus className="size-5" />
                  Nuevos apuntes
                </button>
                <button
                  onClick={() => setImportar(true)}
                  className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-borde px-4 text-center text-texto-3 transition-colors hover:border-acento hover:text-acento-texto cursor-pointer"
                >
                  <FileUp className="size-5" />
                  Importar apuntes existentes
                  <span className="text-[11.5px]">Word, LibreOffice, Markdown o PDF</span>
                </button>
              </div>
            ))}

          {pestana === 'contexto' && (
            <FormContexto
              a={a}
              onGuardado={(n) => {
                setA(n);
                cargarAsignaturas();
              }}
            />
          )}

          {pestana === 'examenes' && <PestanaExamenes a={a} onCount={setExamCount} />}
          {pestana === 'glosario' && <PestanaGlosario a={a.id} />}
          {pestana === 'curriculo' && (
            <PestanaCurriculo
              a={a.id}
              comunidad={a.comunidad}
              onContext={() => setPestana('contexto')}
            />
          )}
          {pestana === 'plantillas' && <PestanaPlantillas a={a.id} />}
          {pestana === 'programacion' && <TeachingProgrammeTab key={a.id} subjectId={a.id} onCurriculum={() => setPestana('curriculo')} onCount={setProgrammeCount} />}
          {pestana === 'material' && (
            <GestorFuentes
              asignatura={a.id}
              descripcion="Material de consulta común a la asignatura: libros, apuntes del profesor, documentos o recursos. Los agentes pueden consultarlo al elaborar apuntes, exámenes y programaciones, según los permisos que hayas activado."
            />
          )}
        </div>

        {pestana === 'contexto' && (
          <div className="mt-12 flex items-center justify-between rounded-xl border border-error/30 px-5 py-4">
            <div>
              <div className="text-sm font-medium">Eliminar asignatura</div>
              <div className="text-xs text-texto-3">Se mueve a la papelera junto con sus apuntes (se puede restaurar desde la pantalla de inicio).</div>
            </div>
            <Boton tam="sm" icono={<Trash2 className="size-3.5" />} onClick={eliminar} className="text-error">
              Eliminar
            </Boton>
          </div>
        )}
      </div>
      <ModalNuevoDocumento asignatura={nuevoDoc ? a.id : undefined} onCerrar={() => setNuevoDoc(false)} />
      <ModalImportar asignatura={importar ? a.id : undefined} onCerrar={() => setImportar(false)} />
      <ModalDuplicarAsignatura asignatura={duplicar ? a.id : undefined} nombre={a.nombre} onCerrar={() => setDuplicar(false)} />
      <ModalExportarTodos asignatura={exportarTodos ? a.id : undefined} onCerrar={() => setExportarTodos(false)} />
    </div>
  );
}

function FormContexto({ a, onGuardado }: { a: AsignaturaDetalle; onGuardado: (a: AsignaturaDetalle) => void }) {
  const { avisar } = useCampos('avisar');
  const inicial = { destinatarios: a.destinatarios, estilo: a.estilo, color: a.color, contexto: a.contexto, permisos: a.permisos ?? {}, comunidad: a.comunidad ?? '' };
  const ensenanzaInicial: ValorEnsenanza = {
    etapa: (a.etapa as Etapa) ?? (a.nivel ? 'libre' : undefined),
    curso: a.curso,
    modalidad: a.modalidad,
    familia: a.familia,
    titulo: a.titulo,
    nombre: a.nombre,
    nivelLibre: a.etapa && a.etapa !== 'libre' ? '' : a.nivel,
    idioma: normalizarIdioma(a.idioma),
  };
  const [f, setF] = useState(inicial);
  const [ens, setEns] = useState<ValorEnsenanza>(ensenanzaInicial);
  const [guardando, setGuardando] = useState(false);
  const cambiado = JSON.stringify(f) !== JSON.stringify(inicial) || JSON.stringify(ens) !== JSON.stringify(ensenanzaInicial);

  const guardar = async () => {
    if (!ens.nombre.trim()) return avisar('Indica la asignatura', 'error');
    setGuardando(true);
    try {
      onGuardado(
        await api.guardarAsignatura(a.id, {
          ...f,
          nombre: ens.nombre.trim(),
          nivel: ens.etapa === 'libre' || !ens.etapa ? ens.nivelLibre.trim() : describirNivel(ens),
          etapa: ens.etapa ?? '',
          curso: ens.curso ?? '',
          modalidad: ens.modalidad ?? '',
          familia: ens.familia ?? '',
          titulo: ens.titulo ?? '',
          idioma: ens.idioma.trim() || 'Castellano',
        }),
      );
      avisar('Asignatura guardada', 'ok');
    } catch (e) {
      avisar((e as Error).message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-5">
      <SelectorEnsenanza valor={ens} onCambio={setEns} />
      <Campo etiqueta="Comunidad autónoma" ayuda="Se utiliza también para obtener el currículo oficial de la asignatura.">
        <select className="min-h-11 w-full rounded-xl border border-borde bg-panel px-3 text-sm focus-visible:outline-2 focus-visible:outline-acento" value={f.comunidad} onChange={(event) => setF({ ...f, comunidad: event.target.value })}>
          <option value="">Solo la norma estatal</option>
          {CURRICULUM_TERRITORIES.filter((territory) => territory !== 'Estatal').map((territory) => <option key={territory}>{territory}</option>)}
        </select>
      </Campo>
      <Campo etiqueta="Destinatarios" ayuda="Edad, nivel previo, objetivo (examen, repaso, divulgación)… Cada conjunto de apuntes puede sobrescribirlo.">
        <AreaTexto rows={2} value={f.destinatarios} onChange={(e) => setF({ ...f, destinatarios: e.target.value })} />
      </Campo>
      <div className="grid grid-cols-2 gap-4">
        <Campo etiqueta="Color">
          <div className="flex h-9 items-center gap-2">
            {COLORES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                onClick={() => setF({ ...f, color: c })}
                className={cx('size-6 rounded-full transition-transform cursor-pointer', f.color === c && 'ring-2 ring-offset-2 ring-offset-panel scale-110')}
                style={{ background: c, ['--tw-ring-color' as string]: c }}
              />
            ))}
          </div>
        </Campo>
      </div>
      <Campo etiqueta="Estilo de redacción" ayuda="Tono, formato preferido, extensión de párrafos, uso de ejemplos…">
        <AreaTexto
          rows={2}
          value={f.estilo}
          onChange={(e) => setF({ ...f, estilo: e.target.value })}
          placeholder="Claro y directo, con ejemplos cotidianos y un resumen al final de cada sección"
        />
      </Campo>
      <Campo
        etiqueta="Qué pueden usar los agentes"
        ayuda="Por defecto, todo. Lo que desmarques no lo propondrán ni lo usarán en ningún conjunto de apuntes de la asignatura (cada uno puede cambiarlo en su ficha)."
      >
        <EditorPermisos valor={f.permisos} onCambio={(permisos) => setF({ ...f, permisos })} />
      </Campo>
      <Campo etiqueta="Contexto de la asignatura" ayuda="Temario, enfoque, criterios de evaluación, qué se da por sabido… Todo lo que deban tener en cuenta los agentes. Admite Markdown.">
        <AreaTexto rows={10} className="font-mono text-[13px]" value={f.contexto} onChange={(e) => setF({ ...f, contexto: e.target.value })} />
      </Campo>
      <div className="flex justify-end gap-2">
        {cambiado && (
          <Boton variante="fantasma" onClick={() => (setF(inicial), setEns(ensenanzaInicial))}>
            Descartar
          </Boton>
        )}
        <Boton variante="primario" disabled={!cambiado} cargando={guardando} onClick={guardar}>
          Guardar cambios
        </Boton>
      </div>
    </div>
  );
}
