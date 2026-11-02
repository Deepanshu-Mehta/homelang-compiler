import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  analyzeGrammar, astToView, GRAMMAR, parseTreeToView, programText, renderProduction,
  type ParserOutput, type StageResult, type Token,
} from '../../compiler/index';
import { Card, SkippedNote } from '../Card';
import { DiagnosticRow, ErrorBox } from '../DiagnosticBox';
import { TreeView } from '../viz/TreeView';

const ANALYSIS = analyzeGrammar();
const PRODUCTIONS = GRAMMAR.map(renderProduction);
const PLAY_MS = 450;

function GrammarView({ active }: { active: string | undefined }) {
  return (
    <div class="grammar" data-testid="grammar">
      {PRODUCTIONS.map(({ name, alternatives }) => (
        <div class={`grammar-rule ${active === name ? 'is-active' : ''}`} key={name} data-rule={name}>
          <span class="grammar-lhs">{name}</span>
          <span class="grammar-arrow">→</span>
          <span class="grammar-rhs">
            {alternatives.map((alt, i) => (
              <span class="grammar-alt" key={i}>{i > 0 && <span class="grammar-bar">| </span>}{alt}</span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Steps through the rules in the order the parser entered them. */
function GrammarStepper({ output, tokens }: { output: ParserOutput; tokens: readonly Token[] }) {
  const { steps } = output;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const step = steps[Math.min(index, steps.length - 1)];
  const next = tokens[step?.tokenIndex ?? 0];

  useEffect(() => {
    setIndex(0);
    setPlaying(false);
  }, [output]);

  useEffect(() => {
    if (!playing) return undefined;
    if (index >= steps.length - 1) {
      setPlaying(false);
      return undefined;
    }
    const timer = setTimeout(() => setIndex(index + 1), PLAY_MS);
    return () => clearTimeout(timer);
  }, [playing, index, steps.length]);

  return (
    <>
      <div class="stepper">
        <button onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}>Back</button>
        <button onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
        <button data-testid="grammar-step" onClick={() => setIndex(Math.min(steps.length - 1, index + 1))}
          disabled={index >= steps.length - 1}>Step</button>
        <span class="stepper-note">
          Step {index + 1} of {steps.length}: in <code>{step?.rule}</code>, next token <code>{next?.lexeme || 'EOF'}</code>
        </span>
      </div>
      <GrammarView active={step?.rule} />
    </>
  );
}

function FirstFollowTable() {
  return (
    <div class="table-scroll">
      <table class="compact">
        <thead><tr><th>Nonterminal</th><th>FIRST</th><th>FOLLOW</th></tr></thead>
        <tbody>
          {Object.keys(ANALYSIS.first).map((name) => (
            <tr key={name}>
              <td><code>{name}</code></td>
              <td><code>{ANALYSIS.first[name]!.join(' ')}</code></td>
              <td><code>{ANALYSIS.follow[name]!.join(' ')}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ParseTable() {
  // Grouping terminals that lead to one production keeps the table readable.
  const rows = useMemo(() => {
    const groups = new Map<string, { nonterminal: string; production: string; terminals: string[] }>();
    for (const entry of ANALYSIS.table) {
      const key = `${entry.nonterminal}\u0000${entry.production}`;
      const group = groups.get(key);
      if (group) group.terminals.push(entry.terminal);
      else groups.set(key, { nonterminal: entry.nonterminal, production: entry.production, terminals: [entry.terminal] });
    }
    return [...groups.values()];
  }, []);
  return (
    <div class="table-scroll">
      <table class="compact">
        <thead><tr><th>Nonterminal</th><th>On token</th><th>Use production</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.nonterminal + row.production}>
              <td><code>{row.nonterminal}</code></td>
              <td><code>{row.terminals.join(' ')}</code></td>
              <td><code>{row.production}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ParserCardProps {
  stage: StageResult;
  source: string;
  tokens: readonly Token[];
  collectAll: boolean;
  onCollectAll: (value: boolean) => void;
}

export function ParserCard({ stage, source, tokens, collectAll, onCollectAll }: ParserCardProps) {
  const output = stage.output as ParserOutput | null;
  const [view, setView] = useState<'ast' | 'parse'>('ast');
  const clean = stage.status !== 'error';
  const tree = useMemo(() => {
    if (!output) return null;
    return view === 'ast' ? astToView(output.ast) : parseTreeToView(output.parseTree);
  }, [output, view]);

  return (
    <Card id="parser" badge="2" title="Parser" status={stage.status}
      intro="Checks that the tokens follow the grammar, and builds a tree showing how the program fits together.">
      {stage.status === 'skipped' && <SkippedNote stage={stage} />}

      {stage.diagnostics.slice(0, 1).map((d) => <ErrorBox key={d.code} diagnostic={d} source={source} />)}
      {stage.diagnostics.length > 1 && (
        <ul class="diagnostics">{stage.diagnostics.slice(1).map((d, i) => <DiagnosticRow key={i} diagnostic={d} />)}</ul>
      )}
      {stage.status !== 'skipped' && (
        <label class="toggle-line">
          <input type="checkbox" checked={collectAll} data-testid="collect-all"
            onChange={(e) => onCollectAll(e.currentTarget.checked)} />
          {' '}{collectAll
            ? 'Collecting all errors: after an error the parser skips to the next rule (panic mode).'
            : 'The parser stops at the first error. Tick to collect all errors.'}
        </label>
      )}

      {output && clean && (
        <>
          <div class="view-toggle" role="group" aria-label="Tree view">
            <button class={view === 'ast' ? 'is-on' : ''} onClick={() => setView('ast')}>AST</button>
            <button class={view === 'parse' ? 'is-on' : ''} data-testid="parse-tree-toggle"
              onClick={() => setView('parse')}>Parse tree</button>
          </div>
          <p class="muted small">
            {view === 'ast'
              ? 'The AST keeps only what carries meaning. Click a node to fold it.'
              : 'The parse tree shows every grammar step, so one number sits under a long chain of rules. Click a node to fold it.'}
          </p>
          {tree && <TreeView key={view} root={tree} />}

          <h3>The whole program as the parser sees it</h3>
          <pre class="code-block" data-testid="program-text">{programText(output.ast) || '(an empty program)'}</pre>
        </>
      )}

      <h3>The grammar the parser follows</h3>
      {output && clean && output.steps.length > 1
        ? <GrammarStepper output={output} tokens={tokens} />
        : <GrammarView active={undefined} />}

      <details class="doc-section">
        <summary>Why LL(1)?</summary>
        <p>LL(1) means the parser reads left to right and picks each grammar rule by looking at just one token. HomeLang's grammar has no left recursion, and it is left-factored: comparison, IS and BETWEEN all start with a value, so they share <code>atom → value [ atomTail ]</code>.</p>
        <p>Two conditions must hold. The FIRST sets of a rule's alternatives must not overlap, and wherever something can be skipped, its FIRST must not overlap what follows it. This page computes both from the grammar above.</p>
        <p data-testid="ll1-result"><strong>LL(1) conflicts found: {ANALYSIS.conflicts.length}.</strong></p>
        <p>Nested IFs must end with END, so an ELSE always belongs to the nearest open IF. That removes the dangling-else ambiguity. Parentheses group conditions only, because if they could also group arithmetic, <code>(</code> would need unbounded lookahead.</p>
      </details>

      <details class="doc-section">
        <summary>FIRST and FOLLOW sets</summary>
        <FirstFollowTable />
      </details>

      <details class="doc-section">
        <summary>The LL(1) parse table</summary>
        <ParseTable />
      </details>
    </Card>
  );
}
