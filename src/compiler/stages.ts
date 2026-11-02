import type { Diagnostic } from './diagnostics';
import type { LexerOutput } from './lexer/lexer';
import type { ParserOutput } from './parser/parser';
import type { SemanticOutput } from './semantic/analyze';
import type { IrOutput } from './ir/cfg';
import type { OptimizerOutput } from './opt/pipeline';

export type StageName =
  | 'lexer' | 'parser' | 'semantic' | 'ir' | 'optimizer' | 'codegen' | 'simulation';

export type StageStatus = 'ok' | 'warn' | 'error' | 'skipped';

export interface StageResult<T = unknown> {
  stage: StageName;
  /** 1-based position, as in "Stopped at stage 2: Parser". */
  number: number;
  title: string;
  status: StageStatus;
  output: T | null;
  diagnostics: Diagnostic[];
  timeMs: number;
}

/** What each stage produces. Later milestones extend this map. */
export interface StageOutputs {
  lexer: LexerOutput;
  parser: ParserOutput;
  semantic: SemanticOutput;
  ir: IrOutput;
  optimizer: OptimizerOutput;
  codegen: unknown;
  simulation: unknown;
}

export const STAGE_ORDER: readonly { stage: StageName; title: string }[] = [
  { stage: 'lexer', title: 'Lexer' },
  { stage: 'parser', title: 'Parser' },
  { stage: 'semantic', title: 'Semantic analysis' },
  { stage: 'ir', title: 'Intermediate code' },
  { stage: 'optimizer', title: 'Optimizer' },
  { stage: 'codegen', title: 'Code generation' },
  { stage: 'simulation', title: 'Simulation' },
];
