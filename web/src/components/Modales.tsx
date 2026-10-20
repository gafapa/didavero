import { useEffect, useState, type FormEvent } from 'react';
import { useCampos } from '../lib/estado';
import { api } from '../lib/api';
import { AreaTexto, Boton, Campo, Entrada, Modal } from './ui';
import { SelectorEnsenanza, type ValorEnsenanza } from './SelectorEnsenanza';
import { describirNivel, destinatariosSugeridos } from '../../../shared/catalogo/educacion';

export function ModalNuevaAsignatura({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const { cargarAsignaturas, seleccionar, avisar } = useCampos('cargarAsignaturas', 'seleccionar', 'avisar');
  const vacio: ValorEnsenanza = { nombre: '', nivelLibre: '', idioma: 'Castellano' };
  const [v, setV] = useState<ValorEnsenanza>(vacio);
  const [destinatarios, setDestinatarios] = useState('');
  const [destinatariosTocados, setDestinatariosTocados] = useState(false);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (abierto) {
      setV(vacio);
      setDestinatarios('');
      setDestinatariosTocados(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  // Destinatarios sugeridos según la enseñanza, mientras el usuario no los escriba
  useEffect(() => {
    if (!destinatariosTocados) setDestinatarios(destinatariosSugeridos(v));
  }, [v, destinatariosTocados]);

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    if (!v.nombre.trim()) return avisar('Indica la asignatura', 'error');
    setGuardando(true);
    try {
      const a = await api.crearAsignatura({
        nombre: v.nombre.trim(),
        nivel: v.etapa === 'libre' || !v.etapa ? v.nivelLibre.trim() : describirNivel(v),
        etapa: v.etapa,
        curso: v.curso,
        modalidad: v.modalidad,
        familia: v.familia,
        titulo: v.titulo,
        idioma: v.idioma.trim() || 'Castellano',
        destinatarios,
      });
      await cargarAsignaturas();
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
      abierto={abierto}
      onCerrar={onCerrar}
      ancho="max-w-xl"
      titulo="Nueva asignatura"
      descripcion="Elige la enseñanza y la asignatura del catálogo oficial, o escribe la tuya. Podrás completar el contexto después."
    >
      <form onSubmit={crear} className="space-y-4">
        <SelectorEnsenanza valor={v} onCambio={setV} />
        <Campo etiqueta="Destinatarios" ayuda="A quién van dirigidos. Cada conjunto de apuntes puede indicar otros distintos.">
          <AreaTexto
            rows={2}
            value={destinatarios}
            onChange={(e) => {
              setDestinatarios(e.target.value);
              setDestinatariosTocados(true);
            }}
            placeholder="Alumnado de 17-18 años que prepara la PAU; nivel medio, poco tiempo de estudio"
          />
        </Campo>
        <div className="flex justify-end gap-2 pt-2">
          <Boton type="button" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" variante="primario" cargando={guardando} disabled={!v.nombre.trim()}>
            Crear asignatura
          </Boton>
        </div>
      </form>
    </Modal>
  );
}

export function ModalNuevoDocumento({ asignatura, onCerrar }: { asignatura?: string; onCerrar: () => void }) {
  const { asignaturas, cargarAsignaturas, seleccionar, avisar } = useCampos('asignaturas', 'cargarAsignaturas', 'seleccionar', 'avisar');
  const asig = asignaturas.find((a) => a.id === asignatura);
  const vacio = { titulo: '', objetivo: '', destinatarios: '', extension: '' };
  const [f, setF] = useState(vacio);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    if (asignatura) setF(vacio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asignatura]);

  const crear = async (e: FormEvent) => {
    e.preventDefault();
    if (!asignatura) return;
    setGuardando(true);
    try {
      const d = await api.crearDocumento(asignatura, f);
      await cargarAsignaturas();
      seleccionar({ asignatura, documento: d.id });
      onCerrar();
    } catch (err) {
      avisar((err as Error).message, 'error');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal abierto={!!asignatura} onCerrar={onCerrar} titulo="Nuevos apuntes" descripcion={asig ? `En ${asig.nombre}` : undefined}>
      <form onSubmit={crear} className="space-y-4">
        <Campo etiqueta="Título">
          <Entrada autoFocus required value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Tema 3: La célula" />
        </Campo>
        <Campo etiqueta="Objetivo" ayuda="Qué deben saber o saber hacer al terminar de estudiarlo.">
          <AreaTexto rows={2} value={f.objetivo} onChange={(e) => setF({ ...f, objetivo: e.target.value })} />
        </Campo>
        <Campo
          etiqueta="Destinatarios"
          ayuda={asig?.destinatarios ? `Si lo dejas vacío se usan los de la asignatura: «${asig.destinatarios}»` : 'Si lo dejas vacío se usan los de la asignatura.'}
        >
          <Entrada value={f.destinatarios} onChange={(e) => setF({ ...f, destinatarios: e.target.value })} placeholder="Los de la asignatura" />
        </Campo>
        <Campo etiqueta="Extensión orientativa">
          <Entrada value={f.extension} onChange={(e) => setF({ ...f, extension: e.target.value })} placeholder="10-15 páginas" />
        </Campo>
        <div className="flex justify-end gap-2 pt-2">
          <Boton type="button" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" variante="primario" cargando={guardando}>
            Crear apuntes
          </Boton>
        </div>
      </form>
    </Modal>
  );
}

export { ImportNotesModal as ModalImportar } from './ImportNotes';
