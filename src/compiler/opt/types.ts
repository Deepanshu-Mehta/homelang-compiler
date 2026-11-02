import type { IrProgram } from '../ir/irgen';
import type { Program } from '../parser/ast';

export interface Change {
  before: string;
  after: string;
}

export interface AstPassResult {
  ast: Program;
  changes: Change[];
}

export interface IrPassResult {
  program: IrProgram;
  changes: Change[];
}

export interface PassReport {
  id: string;
  title: string;
  /** The one-line safety argument. */
  reason: string;
  level: 'AST' | 'IR';
  /** 1 for the pass that ran first. */
  runOrder: number;
  changes: Change[];
  before: string[];
  after: string[];
  quadsBefore: number;
  quadsAfter: number;
}
