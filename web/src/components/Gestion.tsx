// Duplicar asignaturas y documentos, papelera, copias de seguridad y exportar todos los documentos de
// una asignatura de una vez.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArchiveRestore, FileText, FolderOpen, RotateCcw, Trash2 } from 'lucide-react';
import type { ElementoPapelera, OpcionesExportacion } from '../../../shared/tipos';
import { api } from '../lib/api';
import { useCampos } from '../lib/estado';
import { exportarDocumento } from '../lib/exportacion';
import { Boton, Campo, Entrada, Modal, Vacio, confirmar, cx } from './ui';

// ---------------------------------------------------------------------------
// Duplicar

export function ModalDuplicarAsignatura({ asignatura, nombre, onCerrar }: { asignatura?: string; nombre: string; onCerrar: () => void }) {
  const { cargarAsignaturas, seleccionar, avisar } = useCampos('cargarAsignaturas', 'seleccionar', 'avisar');
  const [nuevo, setNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  useEffect(() => setNuevo(`${nombre} (copia)`), [asignatura, nombre]);

  const duplicar = async (e: FormEvent) => {
    e.preventDefault();
    if (!asignatura) return;
    setGuardando(true);
    try {
      const a = await api.duplicarAsignatura(asignatura, nuevo.trim() || undefined);
      await cargarAsignaturas();
      avisar(`Asignatura duplicada: «${a.nombre}»`, 'ok');
      seleccionar({ asignatura: a.id });
      onCerrar();
    } catch (err) {
      avisar((err as Error).message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      abierto={!!asignatura}
      onCerrar={onCerrar}
      titulo="Duplicar la asignatura"
      descripcion="Se copian su contexto, fuentes, glosario, plantillas y todos sus apuntes (sin el historial ni lo ya exportado). Útil para otro grupo o para el curso que viene."
    >
      <form onSubmit={duplicar} className="space-y-4">
        <Campo etiqueta="Nombre de la copia">
          <Entrada autoFocus value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
        </Campo>
        <div className="flex justify-end gap-2">
          <Boton type="button" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" variante="primario" cargando={guardando}>
            Duplicar
          </Boton>
        </div>
      </form>
    </Modal>
  );
}

export function ModalDuplicarDocumento({
  asignatura,
  documento,
  titulo,
  onCerrar,
}: {
  asignatura: string;
  documento?: string;
  titulo: string;
  onCerrar: () => void;
}) {
  const { asignaturas, cargarAsignaturas, seleccionar, avisar } = useCampos('asignaturas', 'cargarAsignaturas', 'seleccionar', 'avisar');
  const [destino, setDestino] = useState(asignatura);
  const [nuevo, setNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    setDestino(asignatura);
    setNuevo(`${titulo} (copia)`);
  }, [documento, asignatura, titulo]);
  // En otra asignatura no hace falta «(copia)»
  const cambiarDestino = (d: string) => {
    setDestino(d);
    if (d !== asignatura && nuevo === `${titulo} (copia)`) setNuevo(titulo);
    if (d === asignatura && nuevo === titulo) setNuevo(`${titulo} (copia)`);
  };

  const duplicar = async (e: FormEvent) => {
    e.preventDefault();
    if (!documento) return;
    setGuardando(true);
    try {
      const d = await api.duplicarDocumento(asignatura, documento, { titulo: nuevo.trim() || undefined, destino });
      await cargarAsignaturas();
      avisar(`Apuntes duplicados: «${d.titulo}»`, 'ok');
      seleccionar({ asignatura: destino, documento: d.id });
      onCerrar();
    } catch (err) {
      avisar((err as Error).message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      abierto={!!documento}
      onCerrar={onCerrar}
      titulo="Duplicar los apuntes"
      descripcion="Se copian sus secciones, índice, imágenes, fuentes y actividades (sin el historial ni lo ya exportado)."
    >
      <form onSubmit={duplicar} className="space-y-4">
        <Campo etiqueta="Título de la copia">
          <Entrada autoFocus value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
        </Campo>
        <Campo etiqueta="En la asignatura" ayuda="Por ejemplo, para adaptar los apuntes a otro grupo o nivel.">
          <select
            value={destino}
            onChange={(e) => cambiarDestino(e.target.value)}
            className="h-9 w-full rounded-lg border border-borde bg-fondo px-3 text-sm outline-none focus:border-acento"
          >
            {asignaturas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
                {a.nivel ? ` · ${a.nivel}` : ''}
              </option>
            ))}
          </select>
        </Campo>
        <div className="flex justify-end gap-2">
          <Boton type="button" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" variante="primario" cargando={guardando}>
            Duplicar
          </Boton>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Papelera

export function ModalPapelera({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const { cargarAsignaturas, seleccionar, avisar } = useCampos('cargarAsignaturas', 'seleccionar', 'avisar');
  const [lista, setLista] = useState<ElementoPapelera[]>();
  const cargar = () => api.papelera().then(setLista).catch((e) => avisar((e as Error).message, 'error'));
  useEffect(() => {
    if (abierto) cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  const restaurar = async (e: ElementoPapelera) => {
    try {
      const r = await api.restaurarDePapelera(e.id);
      await cargarAsignaturas();
      avisar(`«${e.titulo}» restaurado`, 'ok');
      await cargar();
      seleccionar(r);
    } catch (err) {
      avisar((err as Error).message, 'error');
    }
  };

  const borrar = async (e?: ElementoPapelera) => {
    const ok = await confirmar(e ? `¿Eliminar definitivamente «${e.titulo}»?` : '¿Vaciar la papelera?', {
      texto: e ? 'No se podrá recuperar.' : 'Se eliminará definitivamente todo lo que hay en ella. No se podrá recuperar.',
      boton: e ? 'Eliminar' : 'Vaciar',
      peligro: true,
    });
    if (!ok) return;
    try {
      setLista(await api.borrarDePapelera(e?.id));
    } catch (err) {
      avisar((err as Error).message, 'error');
    }
  };

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} ancho="max-w-2xl" titulo="Papelera" descripcion="Lo que eliminas se guarda aquí hasta que vacías la papelera.">
      {lista && lista.length === 0 && <Vacio icono={<Trash2 className="size-6" />} titulo="La papelera está vacía" />}
      {lista && lista.length > 0 && (
        <>
          <ul className="divide-y divide-borde rounded-lg border border-borde">
            {lista.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-3 py-2.5">
                <FileText className={cx('size-4 shrink-0', e.tipo === 'asignatura' ? 'text-acento-texto' : 'text-texto-3')} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{e.titulo}</div>
                  <div className="text-[12px] text-texto-3">
                    {e.tipo === 'asignatura'
                      ? 'Asignatura con sus apuntes'
                      : `${e.tipo === 'examen' ? 'Examen' : e.tipo === 'programacion' ? 'Programación' : 'Apuntes'} de ${e.nombreAsignatura ?? 'una asignatura eliminada'}`}{' '}
                    · eliminado el{' '}
                    {new Date(e.eliminado).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <Boton tam="sm" icono={<RotateCcw className="size-3.5" />} onClick={() => restaurar(e)}>
                  Restaurar
                </Boton>
                <Boton tam="sm" variante="fantasma" className="text-error" onClick={() => borrar(e)}>
                  Eliminar
                </Boton>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-end">
            <Boton tam="sm" variante="fantasma" className="text-error" icono={<Trash2 className="size-3.5" />} onClick={() => borrar()}>
              Vaciar la papelera
            </Boton>
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Copias de seguridad

/** Botón que pide un .zip de copia de seguridad y lo restaura. */
export function BotonRestaurarCopia({ variante = 'secundario' }: { variante?: 'secundario' | 'fantasma' }) {
  const { cargarAsignaturas, seleccionar, avisar } = useCampos('cargarAsignaturas', 'seleccionar', 'avisar');
  const entrada = useRef<HTMLInputElement>(null);
  const [restaurando, setRestaurando] = useState(false);
  const restaurar = async (archivo?: File) => {
    if (!archivo) return;
    setRestaurando(true);
    try {
      const r = await api.restaurarCopia(archivo);
      await cargarAsignaturas();
      avisar(r.length === 1 ? `Asignatura restaurada: «${r[0].nombre}»` : `${r.length} asignaturas restauradas`, 'ok');
      if (r.length === 1) seleccionar({ asignatura: r[0].id });
    } catch (err) {
      avisar((err as Error).message, 'error');
    } finally {
      setRestaurando(false);
      if (entrada.current) entrada.current.value = '';
    }
  };
  return (
    <>
      <Boton tam="sm" variante={variante} icono={<ArchiveRestore className="size-3.5" />} cargando={restaurando} onClick={() => entrada.current?.click()}>
        Restaurar una copia
      </Boton>
      <input ref={entrada} type="file" accept=".zip" className="hidden" onChange={(e) => restaurar(e.target.files?.[0])} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Exportar todos los documentos de una asignatura

const FORMATOS: [OpcionesExportacion['formato'], string][] = [
  ['pdf', 'PDF'],
  ['docx', 'Word'],
  ['odt', 'LibreOffice'],
  ['md', 'Markdown'],
];

function opcionesGuardadas(): OpcionesExportacion {
  const base: OpcionesExportacion = { formato: 'pdf', portada: true, indice: true, numerar: true, autoevaluacion: true, saltoSeccion: false, pies: true };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem('opcionesExportar') ?? '{}') };
  } catch {
    return base;
  }
}

export function ModalExportarTodos({ asignatura, onCerrar }: { asignatura?: string; onCerrar: () => void }) {
  const { asignaturas, avisar } = useCampos('asignaturas', 'avisar');
  const a = asignaturas.find((x) => x.id === asignatura);
  const [formato, setFormato] = useState<OpcionesExportacion['formato']>(() => opcionesGuardadas().formato);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [progreso, setProgreso] = useState('');
  useEffect(() => setElegidos(new Set(a?.documentos.map((d) => d.id) ?? [])), [asignatura, a?.documentos]);

  const exportar = async () => {
    if (!a) return;
    const op = { ...opcionesGuardadas(), formato };
    const hechos: { documento: string; nombre: string }[] = [];
    const fallos: string[] = [];
    const docs = a.documentos.filter((d) => elegidos.has(d.id));
    for (const [i, d] of docs.entries()) {
      setProgreso(`${i + 1} de ${docs.length}: ${d.titulo}`);
      try {
        const r = await exportarDocumento(a.id, d.id, op);
        hechos.push({ documento: d.id, nombre: r.nombre });
      } catch (err) {
        fallos.push(`«${d.titulo}»: ${(err as Error).message}`);
      }
    }
    setProgreso('');
    for (const f of fallos) avisar(f, 'error');
    if (!hechos.length) return;
    try {
      await api.reunirExportados(a.id, hechos);
      avisar(`${hechos.length} ${hechos.length === 1 ? 'conjunto de apuntes exportado' : 'conjuntos de apuntes exportados'}: se ha abierto la carpeta`, 'ok');
      onCerrar();
    } catch (err) {
      avisar((err as Error).message, 'error');
    }
  };

  return (
    <Modal
      abierto={!!a}
      onCerrar={() => !progreso && onCerrar()}
      sinCerrar={!!progreso}
      titulo="Exportar todos los apuntes"
      descripcion="Cada conjunto de apuntes se exporta con las opciones que usaste la última vez (portada, índice, numeración…) y todos quedan juntos en una carpeta de la asignatura."
    >
      <div className="space-y-4">
        <Campo etiqueta="Formato">
          <div className="flex gap-1.5">
            {FORMATOS.map(([f, nombre]) => (
              <button
                key={f}
                onClick={() => setFormato(f)}
                className={cx(
                  'rounded-lg border px-3 py-1.5 text-[13px] transition-colors cursor-pointer',
                  formato === f ? 'border-acento bg-acento-suave text-acento-texto' : 'border-borde hover:bg-panel-2',
                )}
              >
                {nombre}
              </button>
            ))}
          </div>
        </Campo>
        <Campo etiqueta="Apuntes">
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-borde p-2">
            {a?.documentos.map((d) => (
              <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-panel-2">
                <input
                  type="checkbox"
                  className="accent-[var(--acento)]"
                  checked={elegidos.has(d.id)}
                  onChange={(e) => {
                    const n = new Set(elegidos);
                    if (e.target.checked) n.add(d.id);
                    else n.delete(d.id);
                    setElegidos(n);
                  }}
                />
                {d.titulo}
              </label>
            ))}
          </div>
        </Campo>
        {progreso && <p className="text-[13px] text-texto-2">Exportando {progreso}…</p>}
        <div className="flex justify-end gap-2">
          <Boton onClick={onCerrar} disabled={!!progreso}>
            Cancelar
          </Boton>
          <Boton variante="primario" icono={<FolderOpen className="size-4" />} cargando={!!progreso} disabled={!elegidos.size} onClick={exportar}>
            Exportar {elegidos.size} {elegidos.size === 1 ? 'conjunto de apuntes' : 'conjuntos de apuntes'}
          </Boton>
        </div>
      </div>
    </Modal>
  );
}
