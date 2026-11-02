import type { IrProgram } from '../../ir/irgen';
import type { Quad } from '../../ir/quads';
import { toCanonical } from '../../lexer/units';
import type { IrPassResult } from '../types';
import { propagate } from './constants';

function evaluate(q: Quad): number | undefined {
  if (q.kind !== 'cvt' || q.a.kind !== 'const') return undefined;
  const { value } = q.a;
  switch (q.conversion) {
    case 'F_TO_C':
      return toCanonical(value as number, 'F');
    case 'MIN_TO_S':
      return toCanonical(value as number, 'MIN');
    case 'H_TO_S':
      return toCanonical(value as number, 'H');
    case 'TIME_TO_MIN': {
      const [hours, minutes] = String(value).split(':').map(Number) as [number, number];
      return hours * 60 + minutes;
    }
  }
}

/** O2: unit normalization. */
export function unitNormalize(program: IrProgram): IrPassResult {
  return propagate(program, evaluate);
}
