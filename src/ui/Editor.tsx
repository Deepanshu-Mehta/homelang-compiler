import { setDiagnostics, lintGutter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { EditorState, StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, placeholder, type DecorationSet } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'preact/hooks';
import type { Diagnostic, Token } from '../compiler/index';
import type { SourceSpan } from './trees';

const setTokens = StateEffect.define<readonly Token[]>();
const setFlashLine = StateEffect.define<number | null>();
const setSpan = StateEffect.define<SourceSpan | null>();

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

/** Text pushed into the editor from outside. A new object means "load this". */
export interface LoadedText {
  text: string;
}

/** Shows the source of the tree node under the pointer. */
const spanHighlight = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setSpan)) continue;
      const span = effect.value;
      const docLength = transaction.state.doc.length;
      next = span && span.end <= docLength && span.start < span.end
        ? Decoration.set([Decoration.mark({ class: 'cm-span-highlight' }).range(span.start, span.end)])
        : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

interface EditorProps {
  loaded: LoadedText;
  onChange: (value: string) => void;
  /** The source that `tokens` and `diagnostics` were computed from. */
  compiledSource: string;
  tokens: readonly Token[];
  diagnostics: readonly Diagnostic[];
  /** 1-based line to highlight, e.g. after clicking a log entry. */
  highlightLine: number | null;
  /** Source range to mark, e.g. the tree node under the pointer. */
  span: SourceSpan | null;
  /** A click in the text, which selects the matching tree node. */
  onPick: (position: number) => void;
}

export function Editor({ loaded, onChange, compiledSource, tokens, diagnostics, highlightLine, span, onPick }: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: loaded.text,
        extensions: [
          basicSetup,
          // Long comments wrap, so no part of the program hides off the right edge.
          EditorView.lineWrapping,
          lintGutter(),
          tokenHighlight,
          flashLine,
          spanHighlight,
          placeholder('Type a rule, such as IF TEMPERATURE > 30 THEN TURN_ON AC, or choose Load an example…'),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) change.current(update.state.doc.toString());
            const clicked = update.selectionSet && update.transactions.some((t) => t.isUserEvent('select.pointer'));
            if (clicked) pick.current(update.state.selection.main.head);
          }),
        ],
      }),
    });
    view.current = editor;
    return () => editor.destroy();
    // The editor is created once; later changes arrive through dispatch below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The editor owns its text. Only an explicit load writes into it: mirroring
  // every keystroke back in would race the user and loop forever on fast typing.
  useEffect(() => {
    const editor = view.current!;
    const { length } = editor.state.doc;
    if (editor.state.doc.toString() !== loaded.text) {
      editor.dispatch({ changes: { from: 0, to: length, insert: loaded.text } });
    }
  }, [loaded]);

  useEffect(() => {
    const editor = view.current!;
    // While the user types, the last result describes older text. Its offsets
    // no longer fit the document, so wait for the debounced compile to catch up.
    if (editor.state.doc.toString() !== compiledSource) return;
    const docLength = editor.state.doc.length;
    const lint: CmDiagnostic[] = diagnostics.map((d) => {
      // An error at end of input has an empty span, so underline the last
      // character instead: otherwise there is nothing visible to squiggle.
      const to = Math.min(Math.max(d.span.end, d.span.start + 1), docLength);
      const from = Math.min(d.span.start, Math.max(0, to - 1));
      return { from, to, severity: d.severity, message: `${d.code}: ${d.message}` };
    });
    editor.dispatch(setDiagnostics(editor.state, lint));
    editor.dispatch({ effects: setTokens.of(tokens) });
  }, [tokens, diagnostics, compiledSource]);

  useEffect(() => {
    const editor = view.current!;
    const effects: StateEffect<unknown>[] = [setFlashLine.of(highlightLine)];
    if (highlightLine !== null && highlightLine <= editor.state.doc.lines) {
      effects.push(EditorView.scrollIntoView(editor.state.doc.line(highlightLine).from, { y: 'center' }));
    }
    editor.dispatch({ effects });
  }, [highlightLine]);

  useEffect(() => {
    view.current!.dispatch({ effects: setSpan.of(span) });
  }, [span]);

  return <div class="editor" ref={host} data-testid="editor" />;
}
