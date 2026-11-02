import type { IrProgram } from '../../ir/irgen';
import { isJump, operandText, quadText, type Quad } from '../../ir/quads';
import type { Change, IrPassResult } from '../types';
import { originOf, removeQuads } from '../ir';

/** Commands to one device, per origin, since the last barrier. */
type Seen = Map<string, Quad>;

function jumpTargets(program: IrProgram): Set<number> {
  return new Set(program.quads.flatMap((q) => (isJump(q) && q.target !== null ? [q.target] : [])));
}

/**
 * O7: redundant action removal, within straight-line code. WAIT, jumps and join
 * points are barriers, so it never reasons across a suspended rule or a branch.
 * TOGGLE is not idempotent and stays. Commands credited to different rules also
 * stay, so a merged rule still logs each original rule as fired.
 */
export function redundantActions(program: IrProgram): IrPassResult {
  const changes: Change[] = [];
  const removed = new Set<number>();
  const targets = jumpTargets(program);
  let power: Seen = new Map();
  let attributes: Seen = new Map();

  const clear = (): void => {
    power = new Map();
    attributes = new Map();
  };

  for (const q of program.quads) {
    if (targets.has(q.index)) clear();

    if (q.kind === 'wait' || q.kind === 'ret' || isJump(q)) {
      clear();
    } else if (q.kind === 'call') {
      const key = `${originOf(q)}/${q.device}`;
      const earlier = power.get(key);
      if (q.op !== 'TOGGLE' && earlier?.kind === 'call' && earlier.op === q.op) {
        removed.add(q.index);
        changes.push({ before: `${quadText(earlier)}; ${quadText(q)}`, after: quadText(earlier) });
      } else {
        power.set(key, q);
      }
      // A power command may reset a level, so earlier SETs on this device must stay.
      for (const k of [...attributes.keys()]) if (k.startsWith(`${key}/`)) attributes.delete(k);
    } else if (q.kind === 'set') {
      const key = `${originOf(q)}/${q.device}/${q.attr}`;
      const earlier = attributes.get(key);
      if (earlier?.kind === 'set') {
        removed.add(earlier.index);
        changes.push({
          before: `SET ${q.device} ${q.attr} ${operandText(earlier.value)}, then ${operandText(q.value)}`,
          after: `SET ${q.device} ${q.attr} ${operandText(q.value)}`,
        });
      }
      attributes.set(key, q);
      power.delete(`${originOf(q)}/${q.device}`);
    }
  }
  return { program: removeQuads(program, removed), changes };
}
