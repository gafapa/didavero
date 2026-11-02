// Editor Markdown basado en CodeMirror 6.
import { useEffect, useRef } from 'react';
import { EditorView, keymap, placeholder as cmPlaceholder, drawSelection, highlightActiveLine } from '@codemirror/view';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const resaltado = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '700', fontSize: '1.3em', color: 'var(--texto)' },
  { tag: t.heading2, fontWeight: '650', fontSize: '1.15em', color: 'var(--texto)' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '650', color: 'var(--texto)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--acento)' },
  { tag: t.monospace, color: '#d6409f' },
  { tag: [t.processingInstruction, t.meta], color: 'var(--texto-3)' },
  { tag: t.quote, color: 'var(--texto-2)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--acento)' },
  { tag: t.contentSeparator, color: 'var(--texto-3)' },
  { tag: [t.keyword, t.operator], color: '#8250df' },
  { tag: [t.string], color: '#0a7d4f' },
  { tag: [t.comment], color: 'var(--texto-3)' },
]);

/** Marca las transacciones que no vienen del usuario, para no reenviarlas como cambios. */
const externo = Annotation.define<boolean>();

const tema = EditorView.theme({
  '&': { color: 'var(--texto)' },
});

export function Editor({
  valor,
  onCambio,
  soloLectura,
}: {
  valor: string;
  onCambio: (v: string) => void;
  soloLectura?: boolean;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const vista = useRef<EditorView>(null);
  const onCambioRef = useRef(onCambio);
  const readOnlyMode = useRef(new Compartment());
  onCambioRef.current = onCambio;

  useEffect(() => {
    const v = new EditorView({
      parent: contenedor.current!,
      state: EditorState.create({
        doc: valor,
        extensions: [
          history(),
          drawSelection(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(resaltado),
          tema,
          cmPlaceholder('Escribe aquí o pide a la IA que redacte esta sección…'),
          readOnlyMode.current.of([EditorState.readOnly.of(!!soloLectura), EditorView.editable.of(!soloLectura)]),
          EditorView.contentAttributes.of({ 'aria-label': 'Contenido de la sección' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(externo))) {
              onCambioRef.current(u.state.doc.toString());
            }
          }),
        ],
      }),
    });
    vista.current = v;
    return () => v.destroy();
    // El editor se crea una sola vez; los cambios externos se aplican abajo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aplicar cambios que vienen de fuera (p. ej. un agente ha reescrito el archivo)
  useEffect(() => {
    const v = vista.current;
    if (!v) return;
    const actual = v.state.doc.toString();
    if (actual !== valor) {
      v.dispatch({ changes: { from: 0, to: actual.length, insert: valor }, annotations: externo.of(true) });
    }
  }, [valor]);

  useEffect(() => {
    vista.current?.dispatch({ effects: readOnlyMode.current.reconfigure([
      EditorState.readOnly.of(!!soloLectura), EditorView.editable.of(!soloLectura),
    ]) });
  }, [soloLectura]);

  return <div ref={contenedor} className="h-full overflow-hidden" />;
}
