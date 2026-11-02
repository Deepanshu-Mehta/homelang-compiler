import type { IrProgram } from '../../ir/irgen';
import { quadText, type Operand, type Quad } from '../../ir/quads';
import type { Change, IrPassResult } from '../types';
import { removeQuads, substituteOperands } from '../ir';

/**
 * Shared by O1 and O2. Each temporary is assigned once, so when `evaluate` gives
 * a quad a constant value, that value can replace every later use of the temp.
 */
export function propagate(
  program: IrProgram,
  evaluate: (q: Quad) => number | undefined,
): IrPassResult {
  const known = new Map<string, number>();
  const removed = new Set<number>();
  const changes: Change[] = [];

  const replace = (o: Operand): Operand => {
    if (o.kind !== 'temp') return o;
    const value = known.get(o.name);
    return value === undefined ? o : { kind: 'const', value };
  };

  const quads = program.quads.map((original) => {
    const quad = substituteOperands(original, replace);
    const value = evaluate(quad);
    if (value !== undefined && 't' in quad) {
      known.set(quad.t, value);
      removed.add(quad.index);
      changes.push({ before: quadText(original), after: `${quad.t} is ${value}` });
    }
    return quad;
  });
  return { program: removeQuads({ ...program, quads }, removed), changes };
}
