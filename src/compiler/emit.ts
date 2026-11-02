import type { LexerOutput } from './lexer/lexer';
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

/** Text form of a stage's output, used by the CLI and by the golden tests. */
export function emit(kind: EmitKind, stage: StageResult): string {
  if (stage.output === null) return '';
  if (kind === 'tokens') return emitTokens(stage.output as LexerOutput);
  return `${JSON.stringify(stage.output, null, 2)}\n`;
}
