import type { Compare, Cond, Expr, Relop } from '../parser/ast';
import { DAYS } from './catalog';
import type { SymbolTable } from './symbols';

/**
 * Interval analysis. A condition is normalised to disjunctive normal form
 * (an OR of ANDs), and each AND becomes a "box": one allowed set per variable.
 * Every atom constrains a single variable, so this is exact for HomeLang except
 * for comparisons between two sensors, which are recorded as unknown.
 */

export const DAY_MINUTES = 1440;
/** Beyond this many conjunctions the analysis gives up with W416. */
export const MAX_DNF_TERMS = 64;

export interface Interval {
  lo: number;
  hi: number;
  loOpen: boolean;
  hiOpen: boolean;
}

export type Constraint =
  | { kind: 'num'; variable: string; interval: Interval }
  | { kind: 'enum'; variable: string; allowed: readonly string[] }
  | { kind: 'unknown' };

export type Conjunction = readonly Constraint[];
/** [] is FALSE and [[]] is TRUE. */
export type Dnf = readonly Conjunction[];

export interface Box {
  numbers: Map<string, Interval>;
  enums: Map<string, readonly string[]>;
  /** An atom here could not be analysed, so this box may be narrower than it looks. */
  unknown: boolean;
}

const closed = (lo: number, hi: number): Interval => ({ lo, hi, loOpen: false, hiOpen: false });
const halfOpen = (lo: number, hi: number): Interval => ({ lo, hi, loOpen: false, hiOpen: true });

const NEGATED: Readonly<Record<Relop, Relop>> = {
  '>': '<=', '>=': '<', '<': '>=', '<=': '>', '==': '!=', '!=': '==',
};
const FLIPPED: Readonly<Record<Relop, Relop>> = {
  '>': '<', '>=': '<=', '<': '>', '<=': '>=', '==': '==', '!=': '!=',
};

const TRUE: Dnf = [[]];
const FALSE: Dnf = [];
const UNKNOWN: Dnf = [[{ kind: 'unknown' }]];

/** AND two DNFs by distributing. Returns null past the size cap. */
function andDnf(a: Dnf, b: Dnf): Dnf | null {
  if (a.length * b.length > MAX_DNF_TERMS) return null;
  return a.flatMap((x) => b.map((y) => [...x, ...y]));
}

function orDnf(a: Dnf, b: Dnf): Dnf | null {
  return a.length + b.length > MAX_DNF_TERMS ? null : [...a, ...b];
}

function numberAtoms(variable: string, op: Relop, value: number): Dnf {
  const atom = (interval: Interval): Conjunction => [{ kind: 'num', variable, interval }];
  const inf = Number.POSITIVE_INFINITY;
  switch (op) {
    case '>': return [atom({ lo: value, hi: inf, loOpen: true, hiOpen: true })];
    case '>=': return [atom({ lo: value, hi: inf, loOpen: false, hiOpen: true })];
    case '<': return [atom({ lo: -inf, hi: value, loOpen: true, hiOpen: true })];
    case '<=': return [atom({ lo: -inf, hi: value, loOpen: true, hiOpen: false })];
    case '==': return [atom(closed(value, value))];
    case '!=':
      return [
        atom({ lo: -inf, hi: value, loOpen: true, hiOpen: true }),
        atom({ lo: value, hi: inf, loOpen: true, hiOpen: true }),
      ];
  }
}

/** TIME counts whole minutes, so every range is a half-open [lo, hi). */
function timeRanges(op: Relop, t: number): (readonly [number, number])[] {
  switch (op) {
    case '>': return [[t + 1, DAY_MINUTES]];
    case '>=': return [[t, DAY_MINUTES]];
    case '<': return [[0, t]];
    case '<=': return [[0, t + 1]];
    case '==': return [[t, t + 1]];
    case '!=': return [[0, t], [t + 1, DAY_MINUTES]];
  }
}

function timeDnf(ranges: readonly (readonly [number, number])[]): Dnf {
  return ranges
    .filter(([lo, hi]) => lo < hi)
    .map(([lo, hi]) => [{ kind: 'num', variable: 'TIME', interval: halfOpen(lo, hi) }]);
}

/** The minutes of a BETWEEN window. A window across midnight splits in two. */
export function windowRanges(a: number, b: number): (readonly [number, number])[] {
  if (a === b) return [];
  return a < b ? [[a, b]] : [[a, DAY_MINUTES], [0, b]];
}

function complementRanges(ranges: readonly (readonly [number, number])[]): (readonly [number, number])[] {
  const result: [number, number][] = [];
  let cursor = 0;
  for (const [lo, hi] of [...ranges].sort((x, y) => x[0] - y[0])) {
    if (lo > cursor) result.push([cursor, lo]);
    cursor = Math.max(cursor, hi);
  }
  if (cursor < DAY_MINUTES) result.push([cursor, DAY_MINUTES]);
  return result;
}

function statesOf(variable: string, table: SymbolTable): readonly string[] {
  if (variable === 'DAY') return DAYS;
  const catalog = table.get(variable)?.catalog;
  return catalog?.states ?? [];
}

function enumAtom(variable: string, state: string, wantEqual: boolean, table: SymbolTable): Dnf {
  const domain = statesOf(variable, table);
  const allowed = wantEqual ? [state] : domain.filter((s) => s !== state);
  return [[{ kind: 'enum', variable, allowed }]];
}

function compareDnf(cond: Compare, negate: boolean, table: SymbolTable): Dnf {
  let { left, right } = cond;
  let op = negate ? NEGATED[cond.op] : cond.op;

  if (left.kind !== 'Ref' && right.kind === 'Ref') {
    [left, right] = [right, left];
    op = FLIPPED[op];
  }

  if (left.constant !== undefined && right.constant !== undefined) {
    return compareConstants(left.constant, op, right.constant) ? TRUE : FALSE;
  }
  if (left.kind !== 'Ref' || right.constant === undefined) return UNKNOWN;

  const { constant } = right;
  if (typeof constant === 'string') {
    if (op !== '==' && op !== '!=') return UNKNOWN;
    return enumAtom(left.name, constant, op === '==', table);
  }
  if (left.name === 'TIME') return timeDnf(timeRanges(op, constant));
  return numberAtoms(left.name, op, constant);
}

function compareConstants(a: number | string, op: Relop, b: number | string): boolean {
  switch (op) {
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '==': return a === b;
    case '!=': return a !== b;
  }
}

function betweenDnf(subject: Expr, lo: Expr, hi: Expr, negate: boolean): Dnf {
  const a = lo.constant;
  const b = hi.constant;
  if (subject.kind !== 'Ref' || typeof a !== 'number' || typeof b !== 'number') return UNKNOWN;

  if (subject.name === 'TIME') {
    const ranges = windowRanges(a, b);
    return timeDnf(negate ? complementRanges(ranges) : ranges);
  }
  // Numeric BETWEEN is inclusive and never wraps, so lo > hi is an empty range.
  if (!negate) {
    return a > b ? FALSE : [[{ kind: 'num', variable: subject.name, interval: closed(a, b) }]];
  }
  if (a > b) return TRUE;
  return [...numberAtoms(subject.name, '<', a), ...numberAtoms(subject.name, '>', b)];
}

/**
 * Converts a condition to DNF. NOT is pushed inward by De Morgan's laws, with
 * relop negation at the leaves, so NOT itself never appears in the result.
 * Returns null when the expansion passes MAX_DNF_TERMS.
 */
export function toDnf(cond: Cond, negate: boolean, table: SymbolTable): Dnf | null {
  switch (cond.kind) {
    case 'BoolLit':
      return cond.value !== negate ? TRUE : FALSE;
    case 'Not':
      return toDnf(cond.operand, !negate, table);
    case 'Logic': {
      const left = toDnf(cond.left, negate, table);
      const right = toDnf(cond.right, negate, table);
      if (!left || !right) return null;
      const isAnd = (cond.op === 'AND') !== negate; // De Morgan swaps AND and OR
      return isAnd ? andDnf(left, right) : orDnf(left, right);
    }
    case 'Compare':
      return compareDnf(cond, negate, table);
    case 'StateTest': {
      if (cond.target.kind !== 'Ref') return UNKNOWN;
      return enumAtom(cond.target.name, cond.state, cond.negated === negate, table);
    }
    case 'Between':
      return betweenDnf(cond.subject, cond.lo, cond.hi, negate);
  }
}

export function intersectIntervals(a: Interval, b: Interval): Interval {
  const lo = a.lo > b.lo ? a : b.lo > a.lo ? b : { lo: a.lo, loOpen: a.loOpen || b.loOpen };
  const hi = a.hi < b.hi ? a : b.hi < a.hi ? b : { hi: a.hi, hiOpen: a.hiOpen || b.hiOpen };
  return { lo: lo.lo, loOpen: lo.loOpen, hi: hi.hi, hiOpen: hi.hiOpen };
}

export function isEmptyInterval({ lo, hi, loOpen, hiOpen }: Interval): boolean {
  return lo > hi || (lo === hi && (loOpen || hiOpen));
}

/** AND-ing constraints: per-variable intersection. Null means the box is empty. */
export function toBox(conjunction: Conjunction): Box | null {
  const box: Box = { numbers: new Map(), enums: new Map(), unknown: false };
  for (const constraint of conjunction) {
    if (constraint.kind === 'unknown') {
      box.unknown = true;
    } else if (constraint.kind === 'num') {
      const previous = box.numbers.get(constraint.variable);
      const next = previous ? intersectIntervals(previous, constraint.interval) : constraint.interval;
      if (isEmptyInterval(next)) return null;
      box.numbers.set(constraint.variable, next);
    } else {
      const previous = box.enums.get(constraint.variable);
      const next = previous ? previous.filter((s) => constraint.allowed.includes(s)) : constraint.allowed;
      if (next.length === 0) return null;
      box.enums.set(constraint.variable, next);
    }
  }
  return box;
}

export function toBoxes(dnf: Dnf): Box[] {
  return dnf.flatMap((conjunction) => toBox(conjunction) ?? []);
}

export function intersectBoxes(a: Box, b: Box): Box | null {
  const result: Box = { numbers: new Map(a.numbers), enums: new Map(a.enums), unknown: a.unknown || b.unknown };
  for (const [variable, interval] of b.numbers) {
    const previous = result.numbers.get(variable);
    const next = previous ? intersectIntervals(previous, interval) : interval;
    if (isEmptyInterval(next)) return null;
    result.numbers.set(variable, next);
  }
  for (const [variable, allowed] of b.enums) {
    const previous = result.enums.get(variable);
    const next = previous ? previous.filter((s) => allowed.includes(s)) : allowed;
    if (next.length === 0) return null;
    result.enums.set(variable, next);
  }
  return result;
}

/** One concrete value inside an interval, preferring something easy to read. */
export function pointIn({ lo, hi, loOpen, hiOpen }: Interval): number {
  const finiteLo = Number.isFinite(lo);
  const finiteHi = Number.isFinite(hi);
  if (finiteLo && finiteHi) return lo === hi ? lo : (lo + hi) / 2;
  if (finiteLo) return loOpen ? lo + 1 : lo;
  if (finiteHi) return hiOpen ? hi - 1 : hi;
  return 0;
}

/** Sorted union of intervals, for drawing the true-set on a number line. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.lo - b.lo || Number(a.loOpen) - Number(b.loOpen));
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    const touches = last && (interval.lo < last.hi || (interval.lo === last.hi && !(interval.loOpen && last.hiOpen)));
    if (last && touches) {
      if (interval.hi > last.hi || (interval.hi === last.hi && !interval.hiOpen)) {
        merged[merged.length - 1] = { ...last, hi: interval.hi, hiOpen: interval.hiOpen };
      }
    } else {
      merged.push(interval);
    }
  }
  return merged;
}
