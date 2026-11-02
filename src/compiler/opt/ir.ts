import { FIRST_INDEX, type IrProgram } from '../ir/irgen';
import { isJump, type Operand, type Quad } from '../ir/quads';

/** Successors of a quad. Jumps only go forward, so routines have no loops. */
export function successors(q: Quad): number[] {
  switch (q.kind) {
    case 'goto':
      return q.target === null ? [] : [q.target];
    case 'if':
    case 'ifIn':
      return q.target === null ? [q.index + 1] : [q.target, q.index + 1];
    case 'ret':
      return [];
    default:
      return [q.index + 1];
  }
}

/**
 * Deletes quads and renumbers densely from 100. A jump aimed at a deleted quad
 * moves to the next survivor, which is where control would have gone anyway.
 */
export function removeQuads(program: IrProgram, removed: ReadonlySet<number>): IrProgram {
  const newIndex = new Map<number, number>();
  let next = FIRST_INDEX;
  for (const q of program.quads) {
    if (!removed.has(q.index)) newIndex.set(q.index, next++);
  }
  const survivor = (index: number): number => {
    let i = index;
    while (removed.has(i)) i++;
    return newIndex.get(i) ?? next;
  };

  const quads = program.quads.filter((q) => !removed.has(q.index)).map((q): Quad => {
    const moved = { ...q, index: newIndex.get(q.index)! };
    if (isJump(moved) && moved.target !== null) moved.target = survivor(moved.target);
    return moved;
  });

  const routines = program.routines.map((r) => ({ ...r, start: survivor(r.start), end: survivor(r.end) }));
  return { quads, routines };
}

/** Replaces temporaries in every operand position. */
export function substituteOperands(q: Quad, replace: (o: Operand) => Operand): Quad {
  switch (q.kind) {
    case 'arith':
    case 'if':
      return { ...q, a: replace(q.a), b: replace(q.b) };
    case 'neg':
    case 'cvt':
    case 'ifIn':
      return { ...q, a: replace(q.a) };
    case 'set':
      return { ...q, value: replace(q.value) };
    case 'wait':
      return { ...q, seconds: replace(q.seconds) };
    default:
      return q;
  }
}

export function countJumps(program: IrProgram): number {
  return program.quads.filter(isJump).length;
}

/** The rule a command is credited to in the event log. */
export function originOf(q: Quad): string {
  return q.origin ?? q.ruleId;
}
