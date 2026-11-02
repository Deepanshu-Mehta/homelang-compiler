import { buildCfg, type Cfg } from '../ir/cfg';
import { generateIr, type IrProgram } from '../ir/irgen';
import { quadText } from '../ir/quads';
import type { Program } from '../parser/ast';
import { programText } from '../parser/print';
import { SymbolTable, type SymbolEntry } from '../semantic/symbols';
import { countJumps } from './ir';
import { boolSimp } from './passes/boolsimp';
import { commonSubexpressions } from './passes/cse';
import { deadRule } from './passes/deadrule';
import { constantFold } from './passes/fold';
import { jumpOptimize } from './passes/jumps';
import { ruleMerge } from './passes/merge';
import { rangeMerge } from './passes/ranges';
import { redundantActions } from './passes/redundant';
import { unitNormalize } from './passes/units';
import type { AstPassResult, IrPassResult, PassReport } from './types';

export interface OptimizerOutput {
  ast: Program;
  program: IrProgram;
  cfg: Cfg;
  passes: PassReport[];
  totals: { quadsBefore: number; quadsAfter: number; jumpsBefore: number; jumpsAfter: number };
}

const listing = (program: IrProgram): string[] => program.quads.map((q) => `${q.index} ${quadText(q)}`);

interface PassInfo {
  id: string;
  title: string;
  reason: string;
}

const O1: PassInfo = { id: 'O1', title: 'Constant folding', reason: 'Literals have no side effects, and folding uses the same rounding as the VM.' };
const O2: PassInfo = { id: 'O2', title: 'Unit normalization', reason: 'A pure conversion into the canonical unit the VM uses.' };
const O3: PassInfo = { id: 'O3', title: 'Boolean simplification', reason: 'Boolean identities, and quantities are totally ordered, so NOT (a > b) is a <= b.' };
const O4: PassInfo = { id: 'O4', title: 'Range merging', reason: 'Interval intersection gives the same truth set.' };
const O5: PassInfo = { id: 'O5', title: 'Dead-rule elimination', reason: 'The truth set is empty, so the code can never run. A tautology keeps THEN for the initial sync.' };
const O6: PassInfo = { id: 'O6', title: 'Common subexpressions', reason: 'Reads come from one snapshot, and a value is reused only if every path computed it. WAIT clears the set.' };
const O7: PassInfo = { id: 'O7', title: 'Redundant action removal', reason: 'Repeating an idempotent command changes nothing. TOGGLE stays, and nothing crosses a WAIT.' };
const O8: PassInfo = { id: 'O8', title: 'Jump optimization', reason: 'The rewritten jumps follow the same control-flow paths.' };
const O9: PassInfo = { id: 'O9', title: 'Rule merging', reason: 'Neighbouring rules with one condition fire at the same instants, and each action keeps its original rule for the log.' };

/**
 * Runs the passes. O3, O4, O5 and O9 rewrite conditions and rules, so they work
 * on a copy of the AST, which is then lowered with the same generator. O2, O1,
 * O6, O7 and O8 then work on the quadruples. Each pass is a pure function.
 */
export function optimize(annotated: Program, symbols: readonly SymbolEntry[], unoptimized: IrProgram): OptimizerOutput {
  const table = new SymbolTable();
  for (const symbol of symbols) table.add(symbol);

  const passes: PassReport[] = [];
  const report = (info: PassInfo, level: PassReport['level'], changes: PassReport['changes'],
    before: string[], after: string[], quadsBefore: number, quadsAfter: number): void => {
    passes.push({ ...info, level, runOrder: passes.length + 1, changes, before, after, quadsBefore, quadsAfter });
  };

  let ast = annotated;
  const astPass = (info: PassInfo, run: (a: Program) => AstPassResult): void => {
    const before = programText(ast).split('\n');
    const quadsBefore = generateIr(ast).program.quads.length;
    const result = run(ast);
    ast = result.ast;
    report(info, 'AST', result.changes, before, programText(ast).split('\n'), quadsBefore, generateIr(ast).program.quads.length);
  };

  astPass(O3, boolSimp);
  astPass(O4, rangeMerge);
  astPass(O5, (a) => deadRule(a, table));
  astPass(O9, ruleMerge);

  let program = generateIr(ast).program;
  const irPass = (info: PassInfo, run: (p: IrProgram) => IrPassResult): void => {
    const before = listing(program);
    const quadsBefore = program.quads.length;
    const result = run(program);
    program = result.program;
    report(info, 'IR', result.changes, before, listing(program), quadsBefore, program.quads.length);
  };

  irPass(O2, unitNormalize);
  irPass(O1, constantFold);
  irPass(O6, commonSubexpressions);
  irPass(O7, redundantActions);
  irPass(O8, jumpOptimize);

  return {
    ast, program, cfg: buildCfg(program), passes,
    totals: {
      quadsBefore: unoptimized.quads.length, quadsAfter: program.quads.length,
      jumpsBefore: countJumps(unoptimized), jumpsAfter: countJumps(program),
    },
  };
}

/** The same output shape with every pass skipped, for the differential test. */
export function skipOptimizer(annotated: Program, unoptimized: IrProgram, cfg: Cfg): OptimizerOutput {
  const count = unoptimized.quads.length;
  const jumps = countJumps(unoptimized);
  return {
    ast: annotated, program: unoptimized, cfg, passes: [],
    totals: { quadsBefore: count, quadsAfter: count, jumpsBefore: jumps, jumpsAfter: jumps },
  };
}
