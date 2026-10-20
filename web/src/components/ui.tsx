// Componentes básicos de la interfaz.
import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { create } from 'zustand';
import { Loader2, X } from 'lucide-react';
import clsx from 'clsx';

export const cx = clsx;

type Variante = 'primario' | 'secundario' | 'fantasma' | 'peligro';

export const Boton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; tam?: 'sm' | 'md'; cargando?: boolean; icono?: ReactNode }
>(function Boton({ variante = 'secundario', tam = 'md', cargando, icono, className, children, disabled, ...resto }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || cargando}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold whitespace-nowrap transition-colors select-none',
        'disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
        tam === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-[14px]',
        variante === 'primario' && 'bg-acento text-white hover:bg-acento-2 shadow-sm',
        variante === 'secundario' && 'bg-panel border border-borde text-texto hover:bg-panel-2',
        variante === 'fantasma' && 'text-texto-2 hover:bg-panel-2 hover:text-texto',
        variante === 'peligro' && 'bg-error text-white hover:opacity-90 dark:text-fondo',
        className,
      )}
      {...resto}
    >
      {cargando ? <Loader2 className="size-4 animate-spin" /> : icono}
      {children}
    </button>
  );
});

export function BotonIcono({
  titulo,
  className,
  children,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & { titulo: string }) {
  return (
    <button
      title={titulo}
      aria-label={titulo}
      className={cx(
        'inline-flex size-8 items-center justify-center rounded-lg text-texto-3 hover:bg-panel-2 hover:text-texto transition-colors cursor-pointer disabled:opacity-40',
        className,
      )}
      {...resto}
    >
      {children}
    </button>
  );
}

const claseCampo =
  'w-full rounded-xl border border-borde bg-panel px-3 text-[14px] text-texto placeholder:text-texto-3 outline-none transition-colors focus:border-acento focus:ring-3 focus:ring-acento/15';

export const Entrada = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Entrada(
  { className, ...resto },
  ref,
) {
  return <input ref={ref} className={cx(claseCampo, 'h-10', className)} {...resto} />;
});

export const AreaTexto = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function AreaTexto(
  { className, ...resto },
  ref,
) {
  return <textarea ref={ref} className={cx(claseCampo, 'py-2 leading-relaxed resize-y', className)} {...resto} />;
});

export function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: ReactNode; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-texto">{etiqueta}</span>
      {children}
      {ayuda && <span className="block text-xs text-texto-3 leading-snug">{ayuda}</span>}
    </label>
  );
}

export function Insignia({ children, color = 'neutro', className }: { children: ReactNode; color?: 'neutro' | 'acento' | 'ok' | 'aviso' | 'error'; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold',
        color === 'neutro' && 'bg-panel-2 text-texto-2',
        color === 'acento' && 'bg-acento-suave text-acento-texto',
        color === 'ok' && 'bg-ok/12 text-ok',
        color === 'aviso' && 'bg-aviso/12 text-aviso',
        color === 'error' && 'bg-error/12 text-error',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Tarjeta({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-2xl border border-borde bg-panel shadow-suave', className)}>{children}</div>;
}

export function Modal({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  children,
  ancho = 'max-w-lg',
  sinCerrar,
  footer,
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: ReactNode;
  descripcion?: ReactNode;
  children: ReactNode;
  ancho?: string;
  sinCerrar?: boolean;
  footer?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onCerrar);
  const lockedRef = useRef(sinCerrar);
  closeRef.current = onCerrar;
  lockedRef.current = sinCerrar;
  useEffect(() => {
    if (!abierto) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
    (focusable()[0] ?? dialogRef.current)?.focus();
    const f = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== dialogRef.current) return;
      if (e.key === 'Escape' && !lockedRef.current) { e.preventDefault(); closeRef.current(); }
      if (e.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0] ?? dialogRef.current;
      const last = elements[elements.length - 1] ?? dialogRef.current;
      if (!dialogRef.current?.contains(document.activeElement) || (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    window.addEventListener('keydown', f);
    return () => { window.removeEventListener('keydown', f); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [abierto]);
  if (!abierto) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => !sinCerrar && e.target === e.currentTarget && onCerrar()}
    >
      {/* Nunca más alto que la ventana: si no cabe, se desplaza el contenido y la cabecera queda fija */}
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cx('aparecer flex max-h-[calc(100vh-2rem)] w-full flex-col rounded-[22px] border border-borde bg-panel shadow-2xl', ancho)}>
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-5">
          <div>
            <h2 id={titleId} className="text-xl font-bold tracking-tight">{titulo}</h2>
            {descripcion && <p className="mt-1 text-sm text-texto-2">{descripcion}</p>}
          </div>
          {!sinCerrar && (
            <BotonIcono titulo="Cerrar" onClick={onCerrar}>
              <X className="size-4" />
            </BotonIcono>
          )}
        </div>
        <div className="min-h-0 overflow-y-auto px-6 pt-4 pb-6">{children}</div>
        {footer && <div className="shrink-0 border-t border-borde px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Vacio({ icono, titulo, texto, accion }: { icono: ReactNode; titulo: string; texto?: ReactNode; accion?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-acento-suave text-acento-texto">{icono}</div>
      <h3 className="text-lg font-bold">{titulo}</h3>
      {texto && <p className="mt-1 max-w-sm text-sm text-texto-2">{texto}</p>}
      {accion && <div className="mt-5">{accion}</div>}
    </div>
  );
}

// ---------- Confirmación ----------

interface EstadoConfirmar {
  pregunta?: { titulo: string; texto?: string; boton: string; peligro?: boolean; resolver: (v: boolean) => void };
}
const useConfirmar = create<EstadoConfirmar>(() => ({}));

export function confirmar(titulo: string, opciones: { texto?: string; boton?: string; peligro?: boolean } = {}): Promise<boolean> {
  return new Promise((resolver) =>
    useConfirmar.setState({ pregunta: { titulo, texto: opciones.texto, boton: opciones.boton ?? 'Aceptar', peligro: opciones.peligro, resolver } }),
  );
}

export function Confirmador() {
  const p = useConfirmar((s) => s.pregunta);
  const responder = (v: boolean) => {
    p?.resolver(v);
    useConfirmar.setState({ pregunta: undefined });
  };
  return (
    <Modal abierto={!!p} onCerrar={() => responder(false)} titulo={p?.titulo} descripcion={p?.texto} ancho="max-w-md">
      <div className="flex justify-end gap-2">
        <Boton onClick={() => responder(false)}>Cancelar</Boton>
        <Boton variante={p?.peligro ? 'peligro' : 'primario'} onClick={() => responder(true)} autoFocus>
          {p?.boton}
        </Boton>
      </div>
    </Modal>
  );
}
