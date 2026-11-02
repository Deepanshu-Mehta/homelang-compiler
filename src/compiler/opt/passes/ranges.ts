import type { Cond, Program, Relop } from '../../parser/ast';
import type { AstPassResult, Change } from '../types';
import { mapRuleConds } from './boolsimp';

const FLIPPED: Readonly<Record<Relop, Relop>> = {
  '>': '<', '>=': '<=', '<': '>', '<=': '>=', '==': '==', '!=': '!=',
};

interface Bound {
  variable: string;
  /** 'lower' for > and >=, 'upper' for < and <=. */
  side: 'lower' | 'upper';
  value: number;
  strict: boolean;
}

function boundOf(c: Cond): Bound | undefined {
  if (c.kind !== 'Compare') return undefined;
  const reversed = c.left.kind !== 'Ref';
  const ref = reversed ? c.right : c.left;
  const literal = reversed ? c.left : c.right;
  if (ref.kind !== 'Ref' || typeof literal.constant !== 'number') return undefined;

  const op = reversed ? FLIPPED[c.op] : c.op;
  if (op === '==' || op === '!=') return undefined;
  return {
    variable: ref.name, value: literal.constant,
    side: op === '>' || op === '>=' ? 'lower' : 'upper',
    strict: op === '>' || op === '<',
  };
}

/** Is `a` at least as tight as `b`? Both are bounds on one side of one variable. */
function tighter(a: Bound, b: Bound): boolean {
  if (a.value !== b.value) return a.side === 'lower' ? a.value > b.value : a.value < b.value;
  return a.strict || !b.strict;
}

function flatten(c: Cond, op: 'AND' | 'OR', out: Cond[]): Cond[] {
  if (c.kind === 'Logic' && c.op === op) {
    flatten(c.left, op, out);
    flatten(c.right, op, out);
  } else {
    out.push(c);
  }
  return out;
}

/** Within one AND or OR chain, keeps one bound per variable and side. */
function mergeChain(terms: readonly Cond[], op: 'AND' | 'OR'): Cond[] {
  const kept: Cond[] = [];
  for (const term of terms) {
    const bound = boundOf(term);
    const clash = bound && kept.findIndex((k) => {
      const other = boundOf(k);
      return other?.variable === bound.variable && other.side === bound.side;
    });
    if (bound === undefined || clash === undefined || clash === -1) {
      kept.push(term);
      continue;
    }
    // AND keeps the tighter bound, because both must hold; OR keeps the looser.
    const other = boundOf(kept[clash]!)!;
    const newIsTighter = tighter(bound, other);
    if ((op === 'AND') === newIsTighter) kept[clash] = term;
  }
  return kept;
}

export function mergeRanges(c: Cond): Cond {
  switch (c.kind) {
    case 'Not':
      return { ...c, operand: mergeRanges(c.operand) };
    case 'Logic': {
      const terms = flatten(c, c.op, []).map(mergeRanges);
      return mergeChain(terms, c.op).reduce((left, right) => ({ kind: 'Logic', op: c.op, left, right, span: c.span }));
    }
    default:
      return c;
  }
}

/** O4: range merging. */
export function rangeMerge(ast: Program): AstPassResult {
  const changes: Change[] = [];
  const rules = ast.rules.map((rule) => mapRuleConds(rule, mergeRanges, changes));
  return { ast: { ...ast, rules }, changes };
}
