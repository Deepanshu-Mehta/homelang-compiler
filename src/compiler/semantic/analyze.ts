import type { Diagnostic } from '../diagnostics';
import type { Program } from '../parser/ast';
import { astToView } from '../parser/print';
import type { ViewNode } from '../parser/parseTree';
import { checkProgram } from './checker';
import type { SymbolEntry } from './symbols';

export interface SemanticOutput {
  mode: 'prelude' | 'explicit';
  symbols: SymbolEntry[];
  /** A decorated copy; the parser's own tree stays exactly as parsed. */
  annotated: Program;
  annotatedView: ViewNode;
}

export function analyze(program: Program): { output: SemanticOutput; diagnostics: Diagnostic[] } {
  const annotated = structuredClone(program);
  const { mode, table, diagnostics } = checkProgram(annotated);
  diagnostics.sort((a, b) => a.span.start - b.span.start);
  return {
    output: { mode, symbols: table.all(), annotated, annotatedView: astToView(annotated) },
    diagnostics,
  };
}
