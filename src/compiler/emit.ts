import type { Span } from './diagnostics';
import type { IrOutput } from './ir/cfg';
import { quadText } from './ir/quads';
import type { LexerOutput } from './lexer/lexer';
import type { ParserOutput } from './parser/parser';
import type { SemanticOutput } from './semantic/analyze';
import type { StageName, StageResult } from './stages';

export type EmitKind = 'tokens' | 'ast' | 'symbols' | 'ir' | 'opt' | 'bytecode' | 'sim';

export const EMIT_KINDS: readonly EmitKind[] = ['tokens', 'ast', 'symbols', 'ir', 'opt', 'bytecode', 'sim'];

/** The stage that must have run for each --emit kind. */
export const EMIT_STAGE: Readonly<Record<EmitKind, StageName>> = {
  tokens: 'lexer', ast: 'parser', symbols: 'semantic', ir: 'ir',
  opt: 'optimizer', bytecode: 'codegen', sim: 'simulation',
};

/** One token per line, so a golden-file diff shows exactly which token changed. */
function emitTokens(output: LexerOutput): string {
  const lines = output.tokens.map((t) =>
    JSON.stringify({ type: t.type, lexeme: t.lexeme, line: t.span.line, col: t.span.col }));
  return `[\n  ${lines.join(',\n  ')}\n]\n`;
}

/** Spans shrink to "line:col", so a golden diff is about structure, not offsets. */
function compactSpans(key: string, value: unknown): unknown {
  if (key === 'span' || key.endsWith('Span')) {
    const span = value as Span | undefined;
    return span ? `${span.line}:${span.col}` : undefined;
  }
  if (key === 'daySpans') return undefined;
  return value;
}

/** One symbol per line, without the catalogue entry each one points at. */
function emitSymbols(output: SemanticOutput): string {
  const lines = output.symbols.map(({ catalog: _catalog, declSpan, ...rest }) =>
    JSON.stringify({ ...rest, ...(declSpan && { declared: `${declSpan.line}:${declSpan.col}` }) }));
  return `[\n  ${lines.join(',\n  ')}\n]\n`;
}

function emitQuads(output: IrOutput): string {
  return output.program.quads.map((q) => `${q.index} ${quadText(q)}`).join('\n') + '\n';
}

/** Text form of a stage's output, used by the CLI and by the golden tests. */
export function emit(kind: EmitKind, stage: StageResult): string {
  if (stage.output === null) return '';
  if (kind === 'tokens') return emitTokens(stage.output as LexerOutput);
  if (kind === 'ir') return emitQuads(stage.output as IrOutput);
  if (kind === 'symbols') return emitSymbols(stage.output as SemanticOutput);
  if (kind === 'ast') return `${JSON.stringify((stage.output as ParserOutput).ast, compactSpans, 2)}\n`;
  return `${JSON.stringify(stage.output, null, 2)}\n`;
}
