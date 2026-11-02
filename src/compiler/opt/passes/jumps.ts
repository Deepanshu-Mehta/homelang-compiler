import { FIRST_INDEX, type IrProgram } from '../../ir/irgen';
import { isJump, quadText, type Quad } from '../../ir/quads';
import type { Change, IrPassResult } from '../types';
import { removeQuads, successors } from '../ir';

/** Jump to a goto: aim straight at the goto's own target. */
function threadJumps(program: IrProgram, changes: Change[]): IrProgram {
  const at = (i: number) => program.quads[i - FIRST_INDEX];
  const quads = program.quads.map((q): Quad => {
    if (!isJump(q) || q.target === null) return q;
    let target = q.target;
    for (let next = at(target); next?.kind === 'goto' && next.target !== null && next.target !== target; next = at(target)) {
      target = next.target;
    }
    if (target === q.target) return q;
    const threaded = { ...q, target };
    changes.push({ before: quadText(q), after: quadText(threaded) });
    return threaded;
  });
  return { ...program, quads };
}

/** `if c goto L1; goto L2; L1:` becomes `ifFalse c goto L2`. */
function invertBranches(program: IrProgram, changes: Change[]): IrProgram {
  const quads = [...program.quads];
  const removed = new Set<number>();
  for (let i = 0; i + 1 < quads.length; i++) {
    const test = quads[i]!;
    const jump = quads[i + 1]!;
    if ((test.kind !== 'if' && test.kind !== 'ifIn') || jump.kind !== 'goto') continue;
    if (test.target !== jump.index + 1 || test.ruleId !== jump.ruleId) continue;

    const inverted = { ...test, negate: !test.negate, target: jump.target };
    quads[i] = inverted;
    removed.add(jump.index);
    changes.push({ before: `${quadText(test)}; ${quadText(jump)}`, after: quadText(inverted) });
  }
  return removeQuads({ ...program, quads }, removed);
}

function removeGotoNext(program: IrProgram, changes: Change[]): IrProgram {
  const removed = new Set<number>();
  for (const q of program.quads) {
    if (q.kind === 'goto' && q.target === q.index + 1) {
      removed.add(q.index);
      changes.push({ before: quadText(q), after: '(removed)' });
    }
  }
  return removeQuads(program, removed);
}

function removeUnreachable(program: IrProgram, changes: Change[]): IrProgram {
  const reached = new Set<number>();
  const visit = (start: number): void => {
    const pending = [start];
    while (pending.length) {
      const index = pending.pop()!;
      if (reached.has(index)) continue;
      const quad = program.quads[index - FIRST_INDEX];
      if (!quad) continue;
      reached.add(index);
      pending.push(...successors(quad));
    }
  };
  for (const routine of program.routines) if (routine.start < routine.end) visit(routine.start);

  const removed = new Set(program.quads.filter((q) => !reached.has(q.index)).map((q) => q.index));
  for (const index of removed) {
    changes.push({ before: quadText(program.quads[index - FIRST_INDEX]!), after: '(unreachable, removed)' });
  }
  return removeQuads(program, removed);
}

/** O8: jump optimization, repeated until nothing changes. */
export function jumpOptimize(start: IrProgram): IrPassResult {
  const changes: Change[] = [];
  let program = start;
  for (let count = -1; count !== changes.length;) {
    count = changes.length;
    program = threadJumps(program, changes);
    program = invertBranches(program, changes);
    program = removeGotoNext(program, changes);
    program = removeUnreachable(program, changes);
  }
  return { program, changes };
}
