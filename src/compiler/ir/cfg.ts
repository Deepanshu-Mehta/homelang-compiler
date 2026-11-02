import { FIRST_INDEX, type IrProgram, type IrStep } from './irgen';
import { isJump, quadText, type Quad } from './quads';

export interface IrOutput {
  program: IrProgram;
  steps: IrStep[];
  cfg: Cfg;
}

export interface BasicBlock {
  id: string;
  ruleId: string;
  /** First quad index, and one past the last. */
  start: number;
  end: number;
  lines: string[];
}

export type CfgEdgeKind = 'true' | 'false' | 'jump';

export interface CfgEdge {
  from: string;
  to: string;
  kind: CfgEdgeKind;
}

export interface Cfg {
  blocks: BasicBlock[];
  edges: CfgEdge[];
}

/**
 * Partitions quads into basic blocks by the leader rules: the first quad of a
 * routine, every jump target, and every quad after a jump or a RET.
 */
export function buildCfg(program: IrProgram): Cfg {
  const { quads, routines } = program;
  const at = (index: number): Quad => quads[index - FIRST_INDEX]!;

  const leaders = new Set<number>();
  for (const routine of routines) {
    if (routine.start < routine.end) leaders.add(routine.start);
  }
  for (const quad of quads) {
    if (isJump(quad)) {
      if (quad.target !== null) leaders.add(quad.target);
      leaders.add(quad.index + 1);
    }
    if (quad.kind === 'ret') leaders.add(quad.index + 1);
  }

  const lastIndex = FIRST_INDEX + quads.length;
  const starts = [...leaders].filter((i) => i < lastIndex).sort((a, b) => a - b);

  const blocks: BasicBlock[] = starts.map((start, i) => {
    const end = starts[i + 1] ?? lastIndex;
    const members = quads.slice(start - FIRST_INDEX, end - FIRST_INDEX);
    return {
      id: `B${i}`, ruleId: at(start).ruleId, start, end,
      lines: members.map((q) => `${q.index}  ${quadText(q)}`),
    };
  });

  const blockAt = new Map(blocks.map((b) => [b.start, b.id]));
  const edges: CfgEdge[] = [];

  for (const block of blocks) {
    const last = at(block.end - 1);
    const fallthrough = blockAt.get(block.end);
    if (last.kind === 'goto') {
      if (last.target !== null) edges.push({ from: block.id, to: blockAt.get(last.target)!, kind: 'jump' });
    } else if (last.kind === 'if' || last.kind === 'ifIn') {
      // ifFalse swaps which way counts as true.
      const taken = last.negate ? 'false' : 'true';
      const fallen = last.negate ? 'true' : 'false';
      if (last.target !== null) edges.push({ from: block.id, to: blockAt.get(last.target)!, kind: taken });
      if (fallthrough) edges.push({ from: block.id, to: fallthrough, kind: fallen });
    } else if (last.kind !== 'ret' && fallthrough) {
      edges.push({ from: block.id, to: fallthrough, kind: 'jump' });
    }
  }
  return { blocks, edges };
}
