import { useMemo, useState } from 'preact/hooks';
import type {
  Conflict, DepGraph, Diagnostic, SemanticOutput, StageResult, SymbolEntry, WitnessValue,
} from '../../compiler/index';
import { Card, SkippedNote } from '../Card';
import { DiagnosticRow, ErrorBox } from '../DiagnosticBox';
import { GraphView, type GraphEdge, type GraphNode } from '../viz/GraphView';
import { NumberLine } from '../viz/NumberLine';
import { astTree } from '../trees';
import { TreeView } from '../viz/TreeView';

type SortKey = 'name' | 'kind' | 'typeName' | 'room' | 'useCount';

const COLUMNS: readonly { key: SortKey; title: string }[] = [
  { key: 'name', title: 'Name' },
  { key: 'kind', title: 'Kind' },
  { key: 'typeName', title: 'Type' },
  { key: 'room', title: 'Room' },
  { key: 'useCount', title: 'Uses' },
];

function SymbolTableView({ symbols }: { symbols: readonly SymbolEntry[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('kind');
  const rows = useMemo(() => {
    return [...symbols].sort((a, b) => {
      const x = a[sortKey] ?? '';
      const y = b[sortKey] ?? '';
      return typeof x === 'number' && typeof y === 'number' ? y - x : String(x).localeCompare(String(y));
    });
  }, [symbols, sortKey]);

  return (
    <div class="table-scroll symbol-table">
      <table data-testid="symbol-table">
        <thead>
          <tr>
            {COLUMNS.map(({ key, title }) => (
              <th key={key}>
                <button class={`th-button ${sortKey === key ? 'is-on' : ''}`} onClick={() => setSortKey(key)}>{title}</button>
              </th>
            ))}
            <th>Unit</th>
            <th>Read by</th>
            <th>Written by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.name} class={s.builtin ? 'is-builtin' : ''}>
              <td><code>{s.displayName}</code>{s.builtin && <span class="tag">built-in</span>}</td>
              <td>{s.kind}</td>
              <td>{s.typeName ?? '—'}</td>
              <td>{s.room ?? '—'}</td>
              <td>{s.useCount}</td>
              <td>{s.unit ?? '—'}</td>
              <td>{s.readBy.join(', ') || '—'}</td>
              <td>{s.writtenBy.join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiagnosticGroups({ diagnostics }: { diagnostics: readonly Diagnostic[] }) {
  const groups = useMemo(() => {
    const byCode = new Map<string, Diagnostic[]>();
    for (const d of diagnostics) byCode.set(d.code, [...(byCode.get(d.code) ?? []), d]);
    return [...byCode.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [diagnostics]);

  return (
    <div data-testid="semantic-diagnostics">
      {groups.map(([code, items]) => (
        <div key={code} class="diagnostic-group">
          <h4>{code} <span class="muted">× {items.length}</span></h4>
          <ul class="diagnostics">{items.map((d, i) => <DiagnosticRow key={i} diagnostic={d} />)}</ul>
        </div>
      ))}
    </div>
  );
}

function ConflictMatrix({ rules, conflicts, onLoadWitness }: {
  rules: readonly string[];
  conflicts: readonly Conflict[];
  onLoadWitness: (witness: readonly WitnessValue[]) => void;
}) {
  const find = (a: string, b: string) => conflicts.find((c) =>
    (c.ruleA === a && c.ruleB === b) || (c.ruleA === b && c.ruleB === a));
  return (
    <>
      <div class="table-scroll">
        <table class="matrix" data-testid="conflict-matrix">
          <thead><tr><th />{rules.map((r) => <th key={r}>{r}</th>)}</tr></thead>
          <tbody>
            {rules.map((a) => (
              <tr key={a}>
                <th>{a}</th>
                {rules.map((b) => <td key={b} class={a === b ? 'is-self' : find(a, b) ? 'is-conflict' : ''}>{a !== b && find(a, b) ? '✕' : ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {conflicts.length === 0 && <p class="muted small">No two rules of equal priority fight over a device.</p>}
      <ul class="conflict-list">
        {conflicts.map((c) => (
          <li key={`${c.ruleA}-${c.ruleB}`}>
            <span><code>{c.ruleA}</code> and <code>{c.ruleB}</code> set <code>{c.target}</code> to {c.valueA} and {c.valueB}, for example at {c.witness.map((w) => w.text).join(', ') || 'the same event'}.</span>
            {c.witness.length > 0 && (
              <button class="button" data-testid="load-witness" onClick={() => onLoadWitness(c.witness)}>Load witness</button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function DependencyGraph({ graph }: { graph: DepGraph }) {
  const { nodes, edges } = useMemo(() => {
    const inCycle = new Set(graph.cycles.flat());
    const graphNodes: GraphNode[] = graph.nodes.map((n) => ({
      id: n.id, label: n.label, ...(inCycle.has(n.id) && { tone: 'bad' as const }),
    }));
    const graphEdges: GraphEdge[] = graph.edges.map((e) => {
      const cycleEdge = !e.physical && inCycle.has(e.from) && inCycle.has(e.to);
      const tone = e.physical ? ('dashed' as const) : cycleEdge ? ('red' as const) : undefined;
      return { from: e.from, to: e.to, label: e.via, ...(tone && { tone }) };
    });
    return { nodes: graphNodes, edges: graphEdges };
  }, [graph]);

  if (graph.nodes.length === 0) return <p class="muted small">There are no rules yet.</p>;
  return (
    <>
      <GraphView nodes={nodes} edges={edges} />
      <p class="muted small">An arrow means the first rule can start the second. Red marks a cycle. Dashed arrows are physical effects, such as the AC cooling the room; they never count as loops.</p>
    </>
  );
}

interface SemanticCardProps {
  stage: StageResult;
  source: string;
  onLoadWitness: (witness: readonly WitnessValue[]) => void;
}

export function SemanticCard({ stage, source, onLoadWitness }: SemanticCardProps) {
  const output = stage.output as SemanticOutput | null;
  const firstError = stage.diagnostics.find((d) => d.severity === 'error');
  const annotatedRoot = useMemo(() => (output ? astTree(output.annotated) : null), [output]);

  return (
    <Card stage={stage}
      intro="The grammar says whether a sentence is well formed; this stage asks whether it makes sense. Does the device exist? Can it do that? Does the comparison mean anything?">
      {stage.status === 'skipped' && <SkippedNote stage={stage} />}
      {firstError && <ErrorBox diagnostic={firstError} source={source} />}
      {output && (
        <p class="stat-line">
          {output.mode === 'prelude'
            ? 'This program declares nothing, so it runs against the built-in standard home.'
            : 'This program declares its own home, so only those names exist.'}
        </p>
      )}
      {stage.diagnostics.length > 0 && (
        <>
          <h3>What the compiler found</h3>
          <DiagnosticGroups diagnostics={stage.diagnostics} />
        </>
      )}
      {output && (
        <>
          <h3>The symbol table</h3>
          <SymbolTableView symbols={output.symbols} />
          <h3>The annotated AST</h3>
          <p class="muted small">The same tree as the parser's, now with a type and unit on every value.</p>
          <TreeView root={annotatedRoot!} legend="ast" />
          {output.truthLines.length > 0 && (
            <>
              <h3>When each condition is true</h3>
              <p class="muted small">Interval analysis turns a condition into ranges. Each shaded band is where the rule's condition holds: a hollow dot excludes that exact value, a solid dot includes it.</p>
              <div class="number-lines" data-testid="number-lines">
                {output.truthLines.map((line, i) => <NumberLine key={i} line={line} />)}
              </div>
            </>
          )}
          {output.annotated.rules.length > 1 && (
            <>
              <h3>Which rules fight</h3>
              <ConflictMatrix rules={output.annotated.rules.map((r) => r.id)} conflicts={output.conflicts} onLoadWitness={onLoadWitness} />
            </>
          )}
          <h3>Which rules can start which</h3>
          <DependencyGraph graph={output.depGraph} />
        </>
      )}
    </Card>
  );
}
