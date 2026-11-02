import type { Diagnostic } from './diagnostics';
import type { LexerOutput } from './lexer/lexer';

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
  parser: unknown;
  semantic: unknown;
  ir: unknown;
  optimizer: unknown;
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
