import { FIRST_INDEX, type IrProgram } from '../../ir/irgen';
import { operandText, quadText, type Operand, type Quad } from '../../ir/quads';
import type { Change, IrPassResult } from '../types';
import { removeQuads, substituteOperands, successors } from '../ir';

type Available = ReadonlyMap<string, string>;

/** The value a quad computes, as a key, for quads that have no side effect. */
function expressionKey(q: Quad): string | undefined {
  if (q.kind === 'load') return `LOAD ${q.name}`;
  if (q.kind === 'arith') return `${operandText(q.a)} ${q.op} ${operandText(q.b)}`;
  if (q.kind === 'neg') return `NEG ${operandText(q.a)}`;
  return undefined;
}

function meet(paths: readonly Available[]): Map<string, string> {
  const [first, ...rest] = paths;
  const result = new Map<string, string>();
  if (!first) return result;
  for (const [key, temp] of first) {
    if (rest.every((p) => p.get(key) === temp)) result.set(key, temp);
  }
  return result;
}

/**
 * O6: common subexpression elimination by available expressions. A value may be
 * reused only if it was computed on *every* path to this point, so the state at
 * a join is the intersection of its predecessors. Short-circuit code makes this
 * essential: in `A AND B OR C`, a load inside B may never have run. WAIT clears
 * the set, because resuming takes a fresh snapshot.
 */
export function commonSubexpressions(program: IrProgram): IrPassResult {
  const changes: Change[] = [];
  const removed = new Set<number>();
  const quads = [...program.quads];

  for (const routine of program.routines) {
    const outState = new Map<number, Available>();
    const preds = new Map<number, number[]>();
    for (let i = routine.start; i < routine.end; i++) {
      for (const next of successors(quads[i - FIRST_INDEX]!)) {
        preds.set(next, [...(preds.get(next) ?? []), i]);
      }
    }

    const renamed = new Map<string, string>();
    const rename = (o: Operand): Operand => {
      if (o.kind !== 'temp') return o;
      const name = renamed.get(o.name);
      return name ? { kind: 'temp', name } : o;
    };

    // Jumps only go forward, so one pass in order sees every predecessor first.
    for (let i = routine.start; i < routine.end; i++) {
      const original = quads[i - FIRST_INDEX]!;
      const quad = substituteOperands(original, rename);
      quads[i - FIRST_INDEX] = quad;

      const incoming = (preds.get(i) ?? []).flatMap((p) => outState.get(p) ?? []);
      const available = meet(incoming);

      if (quad.kind === 'wait') {
        outState.set(i, new Map());
        continue;
      }
      const key = expressionKey(quad);
      if (key && 't' in quad) {
        const existing = available.get(key);
        if (existing) {
          renamed.set(quad.t, existing);
          removed.add(i);
          changes.push({ before: quadText(original), after: `reuse ${existing}` });
        } else {
          available.set(key, quad.t);
        }
      }
      outState.set(i, available);
    }
  }
  return { program: removeQuads({ ...program, quads }, removed), changes };
}
