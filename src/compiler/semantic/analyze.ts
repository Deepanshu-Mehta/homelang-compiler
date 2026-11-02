import type { Diagnostic } from '../diagnostics';
import type { Program } from '../parser/ast';
import { astToView } from '../parser/print';
import type { ViewNode } from '../parser/parseTree';
import { hasErrors } from '../diagnostics';
import { checkProgram } from './checker';
import { findConflicts, type Conflict } from './conflicts';
import { buildDepGraph, loopDiagnostics, type DepGraph } from './depgraph';
import type { SymbolEntry } from './symbols';
import { runWarnings, type TruthLine } from './warnings';

export interface SemanticOutput {
  mode: 'prelude' | 'explicit';
  symbols: SymbolEntry[];
  /** A decorated copy; the parser's own tree stays exactly as parsed. */
  annotated: Program;
  annotatedView: ViewNode;
  truthLines: TruthLine[];
  conflicts: Conflict[];
  depGraph: DepGraph;
}

export function analyze(program: Program): { output: SemanticOutput; diagnostics: Diagnostic[] } {
  const annotated = structuredClone(program);
  const { mode, table, diagnostics } = checkProgram(annotated);

  const depGraph = buildDepGraph(annotated, table);
  const output: SemanticOutput = {
    mode, symbols: table.all(), annotated, annotatedView: astToView(annotated),
    truthLines: [], conflicts: [], depGraph,
  };

  // The analyses assume a well-typed program, so they only run on one.
  if (!hasErrors(diagnostics)) {
    diagnostics.push(...loopDiagnostics(depGraph, annotated));
    const warnings = runWarnings(annotated, table, mode === 'explicit');
    const { conflicts, diagnostics: conflictDiagnostics } = findConflicts(annotated, table);
    diagnostics.push(...warnings.diagnostics, ...conflictDiagnostics);
    output.truthLines = warnings.truthLines;
    output.conflicts = conflicts;
  }

  diagnostics.sort((a, b) => a.span.start - b.span.start);
  return { output, diagnostics };
}
