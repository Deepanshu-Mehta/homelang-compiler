import type { Span } from '../diagnostics';
import type { Action, Cond, Expr, PowerOp, Rule } from '../parser/ast';
import type { DeviceType } from './catalog';
import type { SymbolTable } from './symbols';

/** The power-state word each command leaves the device in. */
const POWER_RESULT: Readonly<Record<PowerOp, string>> = {
  TURN_ON: 'ON', TURN_OFF: 'OFF', TOGGLE: 'TOGGLE', LOCK: 'LOCKED', UNLOCK: 'UNLOCKED',
  OPEN: 'OPEN', CLOSE: 'CLOSED',
};

export interface Write {
  ruleId: string;
  device: string;
  /** undefined for the power state; an attribute name otherwise. */
  attr?: string;
  /** ON, OFF, a number, or '?' when only known at run time. */
  value: string | number;
  /** True when this write can change the device's power state. */
  affectsPower: boolean;
  span: Span;
  /** Conditions that must hold for this write, on top of the rule's own. */
  guards: readonly { cond: Cond; negated: boolean }[];
  branch: 'then' | 'else';
  /** Sits inside a nested IF. */
  conditional: boolean;
  /** A WAIT comes first, so this write cannot be part of an instant cascade. */
  afterWait: boolean;
}

export function writeKey(write: Write): string {
  return write.attr ? `${write.device}.${write.attr}` : write.device;
}

function constantOf(e: Expr): string | number {
  return e.constant ?? '?';
}

interface WalkState {
  rule: Rule;
  table: SymbolTable;
  branch: 'then' | 'else';
  guards: Write['guards'];
  afterWait: boolean;
}

function walk(actions: readonly Action[], state: WalkState, out: Write[]): void {
  let { afterWait } = state;
  const base = () => ({
    ruleId: state.rule.id,
    guards: state.guards,
    branch: state.branch,
    conditional: state.guards.length > 0,
    afterWait,
  });

  for (const action of actions) {
    switch (action.kind) {
      case 'Wait':
        afterWait = true;
        break;
      case 'Power':
        out.push({
          ...base(), device: action.target.name, value: POWER_RESULT[action.op],
          affectsPower: true, span: action.span,
        });
        break;
      case 'SetAttr': {
        const type = state.table.get(action.target.name)?.catalog as DeviceType | undefined;
        const value = constantOf(action.value);
        out.push({
          ...base(), device: action.target.name, attr: action.attr, value,
          affectsPower: false, span: action.span,
        });
        if (type?.levelAttribute === action.attr) {
          // SET BRIGHTNESS > 0 also switches the device on, like Matter's "with on/off" commands.
          const on = type.states.includes('ON') ? 'ON' : 'OPEN';
          const off = type.states.includes('OFF') ? 'OFF' : 'CLOSED';
          const power = value === '?' ? '?' : value === 0 ? off : on;
          out.push({ ...base(), device: action.target.name, value: power, affectsPower: true, span: action.span });
        }
        break;
      }
      case 'IfAction': {
        const nested = (cond: Cond, negated: boolean): WalkState => ({
          ...state, afterWait, guards: [...state.guards, { cond, negated }],
        });
        walk(action.thenActs, nested(action.cond, false), out);
        if (action.elseActs) walk(action.elseActs, nested(action.cond, true), out);
        break;
      }
      case 'Notify':
        break;
    }
  }
}

/** Every device command a rule can issue, with the conditions around it. */
export function ruleWrites(rule: Rule, table: SymbolTable): Write[] {
  const out: Write[] = [];
  const start = { rule, table, guards: [], afterWait: false };
  walk(rule.thenActs, { ...start, branch: 'then' }, out);
  if (rule.elseActs) walk(rule.elseActs, { ...start, branch: 'else' }, out);
  return out;
}

export function exprReads(e: Expr, out: Set<string>): void {
  switch (e.kind) {
    case 'Ref':
      out.add(e.name);
      break;
    case 'Arith':
      exprReads(e.left, out);
      exprReads(e.right, out);
      break;
    case 'Neg':
      exprReads(e.operand, out);
      break;
    default:
      break;
  }
}

export function condReads(c: Cond, out: Set<string> = new Set()): Set<string> {
  switch (c.kind) {
    case 'Logic':
      condReads(c.left, out);
      condReads(c.right, out);
      break;
    case 'Not':
      condReads(c.operand, out);
      break;
    case 'Compare':
      exprReads(c.left, out);
      exprReads(c.right, out);
      break;
    case 'StateTest':
      exprReads(c.target, out);
      break;
    case 'Between':
      exprReads(c.subject, out);
      exprReads(c.lo, out);
      exprReads(c.hi, out);
      break;
    case 'BoolLit':
      break;
  }
  return out;
}

/** The names whose change can start this rule. Nested-IF reads do not count. */
export function triggerReads(rule: Rule): Set<string> {
  const { trigger } = rule;
  if (trigger.kind === 'State') return condReads(trigger.cond);
  if (trigger.kind === 'Event') return new Set([trigger.source.name]);
  return new Set(['TIME']);
}
