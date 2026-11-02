import type { PowerOp, Relop } from '../parser/ast';
import { formatNumber } from '../numeric';

/** A temporary such as t1, or a constant in canonical or source units. */
export type Operand =
  | { kind: 'temp'; name: string }
  | { kind: 'const'; value: number | string };

export type Conversion = 'F_TO_C' | 'MIN_TO_S' | 'H_TO_S' | 'TIME_TO_MIN';

type Base = {
  /** Position in the listing. Renumbered after every pass, so it has no gaps. */
  index: number;
  ruleId: string;
  /** The rule a command came from, when O9 merged it into another. */
  origin?: string;
};

/**
 * Three-address code. A jump's `target` holds a quad index, or null while it is
 * still on a backpatch list: the `_` in the Dragon Book's listings. `negate`
 * marks the ifFalse form that the jump optimizer produces.
 */
export type Quad = Base & (
  | { kind: 'load'; t: string; name: string }
  | { kind: 'arith'; t: string; op: '+' | '-' | '*' | '/'; a: Operand; b: Operand }
  | { kind: 'neg'; t: string; a: Operand }
  | { kind: 'cvt'; t: string; conversion: Conversion; a: Operand }
  | { kind: 'if'; relop: Relop; a: Operand; b: Operand; target: number | null; negate: boolean }
  | { kind: 'ifIn'; a: Operand; lo: number; hi: number; target: number | null; negate: boolean }
  | { kind: 'goto'; target: number | null }
  | { kind: 'edgeTrue'; hold: number }
  | { kind: 'edgeFalse' }
  | { kind: 'call'; op: PowerOp; device: string }
  | { kind: 'set'; device: string; attr: string; value: Operand }
  | { kind: 'wait'; seconds: Operand }
  | { kind: 'notify'; text: string }
  | { kind: 'ret' }
);

export type JumpQuad = Extract<Quad, { kind: 'if' | 'ifIn' | 'goto' }>;

export function isJump(q: Quad): q is JumpQuad {
  return q.kind === 'if' || q.kind === 'ifIn' || q.kind === 'goto';
}

export function operandText(o: Operand): string {
  if (o.kind === 'temp') return o.name;
  return typeof o.value === 'number' ? formatNumber(o.value) : o.value;
}

function targetText(target: number | null): string {
  return target === null ? '_' : String(target);
}

/** One line of the listing, in the notation of plan.txt §6. */
export function quadText(q: Quad): string {
  switch (q.kind) {
    case 'load':
      return `${q.t} := LOAD ${q.name}`;
    case 'arith':
      return `${q.t} := ${operandText(q.a)} ${q.op} ${operandText(q.b)}`;
    case 'neg':
      return `${q.t} := NEG ${operandText(q.a)}`;
    case 'cvt':
      return `${q.t} := CVT_${q.conversion} ${operandText(q.a)}`;
    case 'if':
      return `${q.negate ? 'ifFalse' : 'if'} ${operandText(q.a)} ${q.relop} ${operandText(q.b)} goto ${targetText(q.target)}`;
    case 'ifIn':
      return `${q.negate ? 'ifFalse' : 'if'} ${operandText(q.a)} IN [${q.lo}, ${q.hi}) goto ${targetText(q.target)}`;
    case 'goto':
      return `goto ${targetText(q.target)}`;
    case 'edgeTrue':
      return `EDGE_TRUE ${q.ruleId}${q.hold ? ` hold=${q.hold}` : ''}`;
    case 'edgeFalse':
      return `EDGE_FALSE ${q.ruleId}`;
    case 'call':
      return `CALL ${q.op} ${q.device}`;
    case 'set':
      return `CALL SET ${q.device} ${q.attr}, ${operandText(q.value)}`;
    case 'wait':
      return `WAIT ${operandText(q.seconds)}`;
    case 'notify':
      return `NOTIFY "${q.text}"`;
    case 'ret':
      return 'RET';
  }
}

export interface QuadColumns {
  op: string;
  arg1: string;
  arg2: string;
  result: string;
}

/** The (op, arg1, arg2, result) columns of the quadruple table. */
export function quadColumns(q: Quad): QuadColumns {
  const row = (op: string, arg1 = '', arg2 = '', result = ''): QuadColumns => ({ op, arg1, arg2, result });
  switch (q.kind) {
    case 'load':
      return row('LOAD', q.name, '', q.t);
    case 'arith':
      return row(q.op, operandText(q.a), operandText(q.b), q.t);
    case 'neg':
      return row('NEG', operandText(q.a), '', q.t);
    case 'cvt':
      return row(`CVT_${q.conversion}`, operandText(q.a), '', q.t);
    case 'if':
      return row(`${q.negate ? 'ifFalse' : 'if'} ${q.relop}`, operandText(q.a), operandText(q.b), targetText(q.target));
    case 'ifIn':
      return row(`${q.negate ? 'ifFalse' : 'if'} IN`, operandText(q.a), `[${q.lo}, ${q.hi})`, targetText(q.target));
    case 'goto':
      return row('goto', '', '', targetText(q.target));
    case 'edgeTrue':
      return row('EDGE_TRUE', q.ruleId, q.hold ? `hold=${q.hold}` : '');
    case 'edgeFalse':
      return row('EDGE_FALSE', q.ruleId);
    case 'call':
      return row('CALL', q.op, q.device);
    case 'set':
      return row('CALL SET', q.device, q.attr, operandText(q.value));
    case 'wait':
      return row('WAIT', operandText(q.seconds));
    case 'notify':
      return row('NOTIFY', `"${q.text}"`);
    case 'ret':
      return row('RET');
  }
}
