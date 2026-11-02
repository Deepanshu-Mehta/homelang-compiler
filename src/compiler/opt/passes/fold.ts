import type { IrProgram } from '../../ir/irgen';
import type { Operand, Quad } from '../../ir/quads';
import { round6 } from '../../numeric';
import type { IrPassResult } from '../types';
import { propagate } from './constants';

const number = (o: Operand): number | undefined =>
  o.kind === 'const' && typeof o.value === 'number' ? o.value : undefined;

function evaluate(q: Quad): number | undefined {
  if (q.kind === 'neg') {
    const a = number(q.a);
    return a === undefined ? undefined : round6(-a);
  }
  if (q.kind !== 'arith') return undefined;
  const a = number(q.a);
  const b = number(q.b);
  if (a === undefined || b === undefined) return undefined;
  switch (q.op) {
    case '+': return round6(a + b);
    case '-': return round6(a - b);
    case '*': return round6(a * b);
    case '/': return b === 0 ? undefined : round6(a / b); // left for R502 at run time
  }
}

/** O1: constant folding. */
export function constantFold(program: IrProgram): IrPassResult {
  return propagate(program, evaluate);
}
