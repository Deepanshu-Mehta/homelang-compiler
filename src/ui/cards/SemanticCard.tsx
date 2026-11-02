import { useMemo, useState } from 'preact/hooks';
import type { Diagnostic, SemanticOutput, StageResult, SymbolEntry } from '../../compiler/index';
import { Card, SkippedNote } from '../Card';
import { DiagnosticRow, ErrorBox } from '../DiagnosticBox';
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

export function SemanticCard({ stage, source }: { stage: StageResult; source: string }) {
  const output = stage.output as SemanticOutput | null;
  const firstError = stage.diagnostics.find((d) => d.severity === 'error');

  return (
    <Card id="semantic" badge="3" title="Semantic analysis" status={stage.status}
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
          <TreeView root={output.annotatedView} />
        </>
      )}
    </Card>
  );
}
