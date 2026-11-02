/**
 * The compiler's public surface. The UI and the CLI import only from this file,
 * which keeps the core pure: compile(source) → { stages }.
 */
import { hasErrors, makeDiagnostic, type Diagnostic } from './diagnostics';
import { lex } from './lexer/lexer';
import {
  STAGE_ORDER, type StageName, type StageOutputs, type StageResult, type StageStatus,
} from './stages';

export * from './diagnostics';
export * from './stages';
export type { LexerOutput } from './lexer/lexer';
export type { Token, TokenCategory } from './lexer/tokens';
export type { Dfa, DfaEdge, DfaState, DfaStep, DfaTrace } from './lexer/dfa/types';
export { DFAS, DFA_BY_NAME } from './lexer/dfa/index';
export { TOKEN_TABLE } from './lexer/tokens';
export { CATALOG, DEVICE_TYPES, SENSOR_TYPES, PRELUDE } from './semantic/catalog';
export type { DeviceType, SensorType } from './semantic/catalog';
export { formatMinutes } from './numeric';
export { emit, EMIT_KINDS, EMIT_STAGE, type EmitKind } from './emit';

export interface CompileOptions {
  /** Use panic-mode recovery so the parser reports every syntax error. */
  collectAllErrors?: boolean;
}

export interface CompileResult {
  source: string;
  stages: StageResult[];
}

interface StageWork<T> {
  output: T;
  diagnostics: Diagnostic[];
}

function statusOf(diagnostics: readonly Diagnostic[]): StageStatus {
  if (hasErrors(diagnostics)) return 'error';
  return diagnostics.some((d) => d.severity === 'warning') ? 'warn' : 'ok';
}

/** Runs one stage. A bug in a stage becomes an I001 diagnostic, never an exception. */
function runStage<T>(
  stage: StageName,
  work: () => StageWork<T>,
): StageResult<T> {
  const number = STAGE_ORDER.findIndex((s) => s.stage === stage) + 1;
  const title = STAGE_ORDER[number - 1]!.title;
  const started = performance.now();
  let output: T | null = null;
  let diagnostics: Diagnostic[];
  try {
    const result = work();
    output = result.output;
    diagnostics = result.diagnostics;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    diagnostics = [makeDiagnostic('I001', { line: 1, col: 1, start: 0, end: 0 },
      `Internal compiler error in the ${title} stage: ${detail}`)];
  }
  const timeMs = performance.now() - started;
  return { stage, number, title, status: statusOf(diagnostics), output, diagnostics, timeMs };
}

function skipped(stage: StageName): StageResult {
  const number = STAGE_ORDER.findIndex((s) => s.stage === stage) + 1;
  const title = STAGE_ORDER[number - 1]!.title;
  return { stage, number, title, status: 'skipped', output: null, diagnostics: [], timeMs: 0 };
}

export function compile(source: string, _options: CompileOptions = {}): CompileResult {
  const stages: StageResult[] = [];
  const lexer = runStage('lexer', () => lex(source));
  stages.push(lexer);

  // Later phases plug in here; each runs only if the previous one has no errors.
  for (const { stage } of STAGE_ORDER.slice(stages.length)) stages.push(skipped(stage));
  return { source, stages };
}

/** Typed access to one stage's output. */
export function stageOutput<K extends StageName>(
  result: CompileResult,
  stage: K,
): StageOutputs[K] | null {
  const found = result.stages.find((s) => s.stage === stage);
  return (found?.output ?? null) as StageOutputs[K] | null;
}

export function stageResult(result: CompileResult, stage: StageName): StageResult {
  return result.stages.find((s) => s.stage === stage)!;
}

/** The first stage that failed, for the "Stopped at stage N" box. */
export function failedStage(result: CompileResult): StageResult | undefined {
  return result.stages.find((s) => s.status === 'error');
}
