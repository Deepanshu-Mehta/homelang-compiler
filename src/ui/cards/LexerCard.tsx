import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  DFAS, DFA_BY_NAME, TOKEN_TABLE, type DfaTrace, type LexerOutput, type StageResult, type Token,
} from '../../compiler/index';
import { Card } from '../Card';
import { DiagnosticRow, ErrorBox } from '../DiagnosticBox';
import { DfaDiagram } from '../viz/DfaDiagram';

const STEP_MS = 320;

function subType(token: Token): string {
  if (token.quantity) return `${token.type} ${token.quantity.display}`;
  return token.type;
}

function TokenChip({ token, selected, onSelect }: { token: Token; selected: boolean; onSelect: () => void }) {
  return (
    <button class={`chip chip-${token.category} ${selected ? 'is-selected' : ''}`}
      onClick={onSelect} data-testid="token-chip" data-token-type={token.type}>
      <span class="chip-lexeme">{token.lexeme}</span>
      <span class="chip-type">{subType(token)}</span>
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
      {done && <p class="trace-summary" data-testid="dfa-summary">{trace.summary}</p>}
    </div>
  );
}

export function LexerCard({ stage, source }: { stage: StageResult; source: string }) {
  const output = stage.output as LexerOutput | null;
  const tokens = useMemo(() => output?.tokens.filter((t) => t.type !== 'EOF') ?? [], [output]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [shown, setShown] = useState(Number.MAX_SAFE_INTEGER);

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
        <p class="stat-line" data-testid="lexer-stats">
          {output.charCount} character{output.charCount === 1 ? '' : 's'} became {count} token{count === 1 ? '' : 's'}.
          {' '}Spaces and comments are thrown away. Tap a token to see how the lexer's automaton read it.
        </p>
      )}
      {firstError && <ErrorBox diagnostic={firstError} source={source} />}
      {stage.diagnostics.length > 1 && (
        <ul class="diagnostics">{stage.diagnostics.slice(1).map((d, i) => <DiagnosticRow key={i} diagnostic={d} />)}</ul>
      )}
      <div class="chips" data-testid="token-chips">
        {tokens.map((token, i) => (
          <TokenChip key={i} token={token} selected={token === selected} onSelect={() => selectToken(i)} />
        ))}
      </div>

      {selected && trace && (
        <div class="trace-block">
          <h3>How the automaton read <code>{selected.lexeme}</code></h3>
          <TraceStrip trace={trace} shown={shown} />
          <DfaDiagram dfa={DFA_BY_NAME[trace.dfa]} visited={visited} active={active} />
        </div>
      )}

      <details class="reference">
        <summary>The tokens HomeLang has</summary>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Token</th><th>Pattern</th><th>Examples</th></tr></thead>
            <tbody>
              {TOKEN_TABLE.map((row) => (
                <tr key={row.token}><td>{row.token}</td><td><code>{row.pattern}</code></td><td><code>{row.examples}</code></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details class="reference">
        <summary>Maximal munch</summary>
        <p>The lexer always takes the longest match. <code>&gt;=</code> is one GE token, not GT then ASSIGN. <code>30C</code> is one QUANTITY, not a NUMBER then a name. The automaton keeps moving while it has a transition and remembers the last accepting state it passed.</p>
        <p>If it runs out of moves in a non-accepting state, it rolls back. In <code>PRIORITY 2:</code> the colon could start a time, so the automaton reads it and moves to q5. The next character is not a digit, so it falls back to q1, emits NUMBER, and re-scans the colon as COLON.</p>
      </details>

      <details class="reference">
        <summary>All the automata</summary>
        <div class="dfa-grid">
          {DFAS.map((dfa) => (
            <figure key={dfa.name}>
              <figcaption>{dfa.title}</figcaption>
              <DfaDiagram dfa={dfa} />
            </figure>
          ))}
        </div>
      </details>
    </Card>
  );
}
