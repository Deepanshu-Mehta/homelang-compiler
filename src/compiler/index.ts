/**
 * The compiler's public surface. The UI and the CLI import only from this file,
 * which keeps the core pure: compile(source) → { stages }.
 */
import { hasErrors, makeDiagnostic, type Diagnostic } from './diagnostics';
import { lex, type LexerOutput } from './lexer/lexer';
import { parse } from './parser/parser';
import { buildCfg, type IrOutput } from './ir/cfg';
import { generateIr } from './ir/irgen';
import { generateObject } from './codegen/emit';
import type { CodegenOutput, ObjectFile } from './codegen/bytecode';
import { toHomeAssistantYaml } from './codegen/haYaml';
import { Session, simulate, type SimulationOutput } from './runtime/simulator';
import { optimize, skipOptimizer, type OptimizerOutput } from './opt/pipeline';
import { analyze } from './semantic/analyze';
import {
  STAGE_ORDER, type StageName, type StageOutputs, type StageResult, type StageStatus,
} from './stages';

export * from './diagnostics';
export * from './stages';
export type { LexerOutput } from './lexer/lexer';
export type { ParserOutput } from './parser/parser';
export type { SemanticOutput } from './semantic/analyze';
export type { SymbolEntry } from './semantic/symbols';
export type { Conflict, WitnessValue } from './semantic/conflicts';
export type { DepEdge, DepGraph } from './semantic/depgraph';
export type { TruthLine } from './semantic/warnings';
export type { Interval } from './semantic/intervals';
export type { Program, Rule, Cond, Expr, Action } from './parser/ast';
export type { ParseStep, ViewNode } from './parser/parseTree';
export { parseTreeToView } from './parser/parseTree';
export { astToView, programText } from './parser/print';
export { GRAMMAR, renderProduction } from './parser/grammar';
export { analyzeGrammar } from './parser/ll1';
export type { Ll1Analysis } from './parser/ll1';
export type { Token, TokenCategory } from './lexer/tokens';
export type { Dfa, DfaEdge, DfaState, DfaStep, DfaTrace } from './lexer/dfa/types';
export { DFAS, DFA_BY_NAME } from './lexer/dfa/index';
export { TOKEN_TABLE } from './lexer/tokens';
export { CATALOG, DEVICE_TYPES, SENSOR_TYPES, PRELUDE } from './semantic/catalog';
export type { DeviceType, SensorType } from './semantic/catalog';
export { formatMinutes } from './numeric';
export type { CodegenOutput, Instr, ObjectFile, ObjectRule, Value } from './codegen/bytecode';
export { VmDebugger } from './runtime/debugger';
export { Session, type SimulationOutput } from './runtime/simulator';
export type { DeviceState, LogEntry, LogKind, SensorState, SimulatorState } from './runtime/scheduler';
export type { Frame } from './runtime/vm';
export type { OptimizerOutput } from './opt/pipeline';
export type { Change, PassReport } from './opt/types';
export type { Quad, QuadColumns } from './ir/quads';
export { quadColumns, quadText } from './ir/quads';
export type { IrProgram, IrStep, Routine } from './ir/irgen';
export type { BasicBlock, Cfg, CfgEdge, IrOutput } from './ir/cfg';
export { emit, EMIT_KINDS, EMIT_STAGE, type EmitKind } from './emit';

export interface CompileOptions {
  /** Use panic-mode recovery so the parser reports every syntax error. */
  collectAllErrors?: boolean;
  /** Set to false to skip every pass, as the differential test does. Default true. */
  optimize?: boolean;
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

export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const stages: StageResult[] = [];

  /** Adds a stage, unless an earlier stage failed. Returns its output, or null. */
  function step<T>(stage: StageName, work: () => StageWork<T>): T | null {
    const result = runStage(stage, work);
    stages.push(result);
    return result.status === 'error' ? null : result.output;
  }

  function pipeline(): void {
    const tokens = step<LexerOutput>('lexer', () => lex(source));
    if (!tokens) return;
    const parsed = step('parser', () => parse(tokens.tokens, source, options.collectAllErrors));
    if (!parsed) return;
    const semantic = step('semantic', () => analyze(parsed.ast));
    if (!semantic) return;
    const ir = step<IrOutput>('ir', () => {
      const { program, steps } = generateIr(semantic.annotated);
      return { output: { program, steps, cfg: buildCfg(program) }, diagnostics: [] };
    });
    if (!ir) return;
    const optimized = step<OptimizerOutput>('optimizer', () => ({
      output: options.optimize === false
        ? skipOptimizer(semantic.annotated, ir.program, ir.cfg)
        : optimize(semantic.annotated, semantic.symbols, ir.program),
      diagnostics: [],
    }));
    if (!optimized) return;
    const object = step<CodegenOutput>('codegen', () => ({
      output: {
        ...generateObject(optimized.ast, optimized.program, semantic.symbols),
        haYaml: toHomeAssistantYaml(semantic.annotated, semantic.symbols),
      },
      diagnostics: [],
    }));
    if (!object) return;
    step<SimulationOutput>('simulation', () => simulate(object));
  }

  pipeline();
  // Every stage after a failure is reported as skipped.
  for (const { stage } of STAGE_ORDER.slice(stages.length)) stages.push(skipped(stage));
  return { source, stages };
}

/** A live simulation of a compiled program, for the Output panel. */
export function createSession(object: ObjectFile): Session {
  return new Session(object);
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
