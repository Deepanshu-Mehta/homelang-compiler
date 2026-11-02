import { setDiagnostics, lintGutter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'preact/hooks';
import type { Diagnostic, Token } from '../compiler/index';

const setTokens = StateEffect.define<readonly Token[]>();
const setFlashLine = StateEffect.define<number | null>();

/** Colours come from the compiler's own token stream, not a second grammar. */
const tokenHighlight = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setTokens)) continue;
      const docLength = transaction.state.doc.length;
      const ranges: Range<Decoration>[] = [];
      for (const token of effect.value) {
        if (token.type === 'EOF' || token.span.end > docLength) continue;
        ranges.push(Decoration.mark({ class: `tok-${token.category}` })
          .range(token.span.start, token.span.end));
      }
      next = Decoration.set(ranges, true);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const flashLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setFlashLine)) continue;
      const line = effect.value;
      if (line === null || line > transaction.state.doc.lines) {
        next = Decoration.none;
      } else {
        const start = transaction.state.doc.line(line).from;
        next = Decoration.set([Decoration.line({ class: 'cm-flash-line' }).range(start)]);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  tokens: readonly Token[];
  diagnostics: readonly Diagnostic[];
  /** 1-based line to highlight, e.g. after clicking a log entry. */
  highlightLine: number | null;
}

export function Editor({ value, onChange, tokens, diagnostics, highlightLine }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          lintGutter(),
          tokenHighlight,
          flashLine,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => editor.destroy();
    // The editor is created once; later changes arrive through dispatch below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = view.current!;
    const current = editor.state.doc.toString();
    if (current !== value) {
      editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    const editor = view.current!;
    if (editor.state.doc.toString() !== value) return; // stale compile result
    const docLength = editor.state.doc.length;
    const lint: CmDiagnostic[] = diagnostics.map((d) => ({
      from: Math.min(d.span.start, docLength),
      to: Math.min(Math.max(d.span.end, d.span.start + 1), docLength),
      severity: d.severity,
      message: `${d.code}: ${d.message}`,
    }));
    editor.dispatch(setDiagnostics(editor.state, lint));
    editor.dispatch({ effects: setTokens.of(tokens) });
  }, [tokens, diagnostics, value]);

  useEffect(() => {
    const editor = view.current!;
    const effects: StateEffect<unknown>[] = [setFlashLine.of(highlightLine)];
    if (highlightLine !== null && highlightLine <= editor.state.doc.lines) {
      effects.push(EditorView.scrollIntoView(editor.state.doc.line(highlightLine).from, { y: 'center' }));
    }
    editor.dispatch({ effects });
  }, [highlightLine]);

  return <div class="editor" ref={host} data-testid="editor" />;
}
