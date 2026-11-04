import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  DFAS, DFA_BY_NAME, TOKEN_TABLE, type DfaTrace, type LexerOutput, type StageResult, type Token,
  type TokenCategory,
} from '../../compiler/index';
import { Card, Reference, useWalkStep } from '../Card';
import { DiagnosticRow, ErrorBox } from '../DiagnosticBox';
import { DfaDiagram } from '../viz/DfaDiagram';

const STEP_MS = 320;
/** Longer programs open in the compact view, so the token list stays short. */
const COMPACT_ABOVE_TOKENS = 40;

const CLASSES: readonly { category: TokenCategory; label: string }[] = [
  { category: 'keyword', label: 'Keyword' },
  { category: 'action', label: 'Action' },
  { category: 'state', label: 'State or event' },
  { category: 'day', label: 'Day' },
  { category: 'ident', label: 'Name' },
  { category: 'literal', label: 'Literal' },
  { category: 'operator', label: 'Operator' },
  { category: 'punct', label: 'Punctuation' },
];

function typeLabel(token: Token): string {
  if (token.quantity) return `${token.type} ${token.quantity.display}`;
  return token.type;
}

interface TokenChipProps {
  token: Token;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
}

function TokenChip({ token, selected, compact, onSelect }: TokenChipProps) {
  // A keyword's type is its own spelling, so the compact view needs only one word.
  const showType = !compact || token.upper !== token.type;
  return (
    <button class={`chip chip-${token.category} ${selected ? 'is-selected' : ''}`}
      onClick={onSelect} data-testid="token-chip" data-token-type={token.type}
      aria-label={`${token.lexeme}, ${typeLabel(token)}`} aria-pressed={selected}>
      <span class="chip-lexeme">{token.lexeme}</span>
      {showType && <span class="chip-type">{typeLabel(token)}</span>}
    </button>
  );
}

function shownChar(ch: string): string {
  return ch === ' ' ? '␠' : ch === '\n' ? '↵' : ch;
}

/** The q0 –3→ q1 –0→ q1 strip, revealed one step at a time. */
function TraceStrip({ trace, shown }: { trace: DfaTrace; shown: number }) {
  const steps = trace.steps.slice(0, shown);
  const done = shown >= trace.steps.length;
  const accepting = (state: string) =>
    DFA_BY_NAME[trace.dfa].states.some((s) => s.id === state && s.accept);
  return (
    <div class="trace" data-testid="dfa-trace">
      <div class="trace-strip">
        <span class="trace-state">{trace.steps[0]?.from ?? 'q0'}</span>
        {steps.map((step, i) => (
          <span class="trace-step" key={i}>
            <span class="trace-move"><span class="trace-char">{shownChar(step.ch)}</span><span class="trace-arrow">→</span></span>
            <span class={`trace-state ${accepting(step.to) ? 'is-accept' : ''}`}>{step.to}</span>
          </span>
        ))}
      </div>
      <p class="trace-summary" data-testid="dfa-summary">{done ? trace.summary : 'Reading…'}</p>
    </div>
  );
}

interface TokenLine {
  line: number;
  entries: { token: Token; index: number }[];
}

function groupByLine(tokens: readonly Token[]): TokenLine[] {
  const lines: TokenLine[] = [];
  tokens.forEach((token, index) => {
    const last = lines[lines.length - 1];
    if (last?.line === token.span.line) last.entries.push({ token, index });
    else lines.push({ line: token.span.line, entries: [{ token, index }] });
  });
  return lines;
}

export function LexerCard({ stage, source }: { stage: StageResult; source: string }) {
  const output = stage.output as LexerOutput | null;
  const tokens = useMemo(() => output?.tokens.filter((t) => t.type !== 'EOF') ?? [], [output]);
  const lines = useMemo(() => groupByLine(tokens), [tokens]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [shown, setShown] = useState(Number.MAX_SAFE_INTEGER);
  const [viewChoice, setViewChoice] = useState<'compact' | 'expanded' | null>(null);
  const compact = (viewChoice ?? (tokens.length > COMPACT_ABOVE_TOKENS ? 'compact' : 'expanded')) === 'compact';

  const selected = tokens[Math.min(selectedIndex, tokens.length - 1)];
  const trace = selected?.trace;

  useEffect(() => {
    if (!trace || shown >= trace.steps.length) return undefined;
    const timer = setTimeout(() => setShown(shown + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [shown, trace]);

  function selectToken(index: number) {
    setSelectedIndex(index);
    setShown(0);
  }

  // The walkthrough shows the most interesting token: one with several states.
  useWalkStep('lexer', (done) => {
    const quantity = tokens.findIndex((t) => t.type === 'QUANTITY' || t.type === 'TIME_LIT' || t.type === 'NUMBER');
    const index = Math.max(0, quantity);
    if (tokens.length === 0) {
      done();
      return undefined;
    }
    selectToken(index);
    const timer = setTimeout(done, ((tokens[index]?.trace?.steps.length ?? 1) + 1) * STEP_MS);
    return () => clearTimeout(timer);
  });

  const visited = new Set<string>();
  let active: string | undefined;
  if (trace) {
    visited.add(trace.steps[0]?.from ?? 'q0');
    active = trace.steps[0]?.from;
    for (const step of trace.steps.slice(0, shown)) {
      visited.add(step.to);
      active = step.to;
    }
    if (shown >= trace.steps.length) active = trace.finalState;
  }

  const count = output?.tokenCount ?? 0;
  const firstError = stage.diagnostics[0];

  return (
    <Card stage={stage}
      intro="Reads the program one character at a time and groups the characters into tokens: keywords, names, numbers with units, operators.">
      {output && (
        <p class="prose" data-testid="lexer-stats">
          {output.charCount} character{output.charCount === 1 ? '' : 's'} became {count} token{count === 1 ? '' : 's'}.
          {' '}Spaces and comments are thrown away. Tap a token to see how the lexer's automaton read it.
        </p>
      )}
      {firstError && <ErrorBox diagnostic={firstError} source={source} />}
      {stage.diagnostics.length > 1 && (
        <ul class="diagnostics">{stage.diagnostics.slice(1).map((d, i) => <DiagnosticRow key={i} diagnostic={d} />)}</ul>
      )}

      {tokens.length === 0 && !firstError && <p class="muted">There are no tokens yet.</p>}

      {tokens.length > 0 && (
        <div class="lexer-story">
          {selected && trace && (
            <div class="trace-panel" data-testid="trace-panel">
              <div class="trace-text">
                <h3>How the automaton read <code>{selected.lexeme}</code></h3>
                <TraceStrip trace={trace} shown={shown} />
              </div>
              <DfaDiagram dfa={DFA_BY_NAME[trace.dfa]} visited={visited} active={active} />
            </div>
          )}

          <div class="toolbar">
            <div class="segmented" role="group" aria-label="Token view">
              <button class={compact ? 'is-on' : ''} data-testid="tokens-compact" onClick={() => setViewChoice('compact')}>Compact</button>
              <button class={compact ? '' : 'is-on'} data-testid="tokens-expanded" onClick={() => setViewChoice('expanded')}>Expanded</button>
            </div>
            <ul class="token-legend" aria-label="Token classes">
              {CLASSES.map(({ category, label }) => (
                <li key={category} class={`chip-${category}`}><span class="token-swatch" /> {label}</li>
              ))}
            </ul>
          </div>

          <ol class={`token-lines ${compact ? 'is-compact' : ''}`} data-testid="token-chips">
            {lines.map(({ line, entries }) => (
              <li key={line} class="token-line">
                <span class="token-line-number" aria-label={`Line ${line}`}>{line}</span>
                <div class="chips">
                  {entries.map(({ token, index }) => (
                    <TokenChip key={index} token={token} compact={compact} selected={token === selected}
                      onSelect={() => selectToken(index)} />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <Reference title="The tokens HomeLang has">
        <div class="table-scroll">
          <table class="compact">
            <thead><tr><th>Token</th><th>Pattern</th><th>Examples</th></tr></thead>
            <tbody>
              {TOKEN_TABLE.map((row) => (
                <tr key={row.token}><td>{row.token}</td><td><code>{row.pattern}</code></td><td><code>{row.examples}</code></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reference>

      <Reference title="Maximal munch">
        <p>The lexer always takes the longest match. <code>&gt;=</code> is one GE token, not GT then ASSIGN. <code>30C</code> is one QUANTITY, not a NUMBER then a name. The automaton keeps moving while it has a transition and remembers the last accepting state it passed.</p>
        <p>If it runs out of moves in a non-accepting state, it rolls back. In <code>PRIORITY 2:</code> the colon could start a time, so the automaton reads it and moves to q5. The next character is not a digit, so it falls back to q1, emits NUMBER, and re-scans the colon as COLON.</p>
      </Reference>

      <Reference title="All the automata">
        <div class="dfa-grid">
          {DFAS.map((dfa) => (
            <figure key={dfa.name}>
              <figcaption>{dfa.title}</figcaption>
              <DfaDiagram dfa={dfa} />
            </figure>
          ))}
        </div>
      </Reference>
    </Card>
  );
}
