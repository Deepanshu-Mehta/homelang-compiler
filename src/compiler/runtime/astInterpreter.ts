import type { Action, Cond, Expr, Rule } from '../parser/ast';
import type { Value } from '../codegen/bytecode';
import { round6 } from '../numeric';
import type { Activation, RuleExecutor } from './scheduler';
import type { VmHost } from './vm';

class Halt extends Error {}

/**
 * The window test, written separately from the VM's on purpose. An oracle that
 * shared this code could not notice a bug in it.
 */
function isInsideWindow(minute: number, start: number, end: number): boolean {
  const length = (end - start + 1440) % 1440;
  const offset = (minute - start + 1440) % 1440;
  return offset < length;
}

function evaluate(e: Expr, host: VmHost, ruleId: string): Value {
  if (e.constant !== undefined) return e.constant;
  switch (e.kind) {
    case 'NumLit':
      return e.value;
    case 'TimeLit':
      return e.minutes;
    case 'EnumLit':
      return e.value;
    case 'Ref':
      return host.read(e.name);
    case 'Neg':
      return round6(-(evaluate(e.operand, host, ruleId) as number));
    case 'Arith': {
      const a = evaluate(e.left, host, ruleId) as number;
      const b = evaluate(e.right, host, ruleId) as number;
      const result = round6(e.op === '+' ? a + b : e.op === '-' ? a - b : e.op === '*' ? a * b : a / b);
      if (!Number.isFinite(result)) {
        host.fault(`Division by zero or an overflow in rule ${ruleId}.`);
        throw new Halt();
      }
      return result;
    }
  }
}

function test(c: Cond, host: VmHost, ruleId: string): boolean {
  switch (c.kind) {
    case 'BoolLit':
      return c.value;
    case 'Not':
      return !test(c.operand, host, ruleId);
    case 'Logic':
      return c.op === 'AND'
        ? test(c.left, host, ruleId) && test(c.right, host, ruleId)
        : test(c.left, host, ruleId) || test(c.right, host, ruleId);
    case 'StateTest':
      return (evaluate(c.target, host, ruleId) === c.state) !== c.negated;
    case 'Between': {
      const x = evaluate(c.subject, host, ruleId) as number;
      const lo = evaluate(c.lo, host, ruleId) as number;
      const hi = evaluate(c.hi, host, ruleId) as number;
      return c.subject.valueType?.kind === 'time' ? isInsideWindow(x, lo, hi) : x >= lo && x <= hi;
    }
    case 'Compare': {
      const a = evaluate(c.left, host, ruleId);
      const b = evaluate(c.right, host, ruleId);
      switch (c.op) {
        case '>': return a > b;
        case '>=': return a >= b;
        case '<': return a < b;
        case '<=': return a <= b;
        case '==': return a === b;
        case '!=': return a !== b;
      }
    }
  }
}

/** A generator, so that a WAIT can suspend it just as it suspends a VM frame. */
function* runActions(actions: readonly Action[], host: VmHost, ruleId: string): Generator<number, void, void> {
  for (const action of actions) {
    switch (action.kind) {
      case 'Power':
        host.command(action.op, action.target.name, ruleId);
        break;
      case 'SetAttr':
        host.setAttribute(action.target.name, action.attr, evaluate(action.value, host, ruleId), ruleId);
        break;
      case 'Wait':
        yield action.duration.seconds!;
        break;
      case 'Notify':
        host.notify(action.text, ruleId);
        break;
      case 'IfAction':
        if (test(action.cond, host, ruleId)) yield* runActions(action.thenActs, host, ruleId);
        else if (action.elseActs) yield* runActions(action.elseActs, host, ruleId);
        break;
    }
  }
}

function* runRule(rule: Rule, host: VmHost): Generator<number, void, void> {
  const { trigger, id } = rule;
  if (trigger.kind === 'State') {
    if (test(trigger.cond, host, id)) {
      if (host.edgeTrue(id, trigger.hold?.seconds ?? 0)) yield* runActions(rule.thenActs, host, id);
    } else if (host.edgeFalse(id)) {
      yield* runActions(rule.elseActs ?? [], host, id);
    }
  } else if (trigger.kind === 'Event' && trigger.guard) {
    if (test(trigger.guard, host, id)) yield* runActions(rule.thenActs, host, id);
  } else {
    yield* runActions(rule.thenActs, host, id);
  }
}

/**
 * The test oracle: runs rules directly from the annotated AST, with no IR, no
 * optimizer and no VM. If this and the optimized VM produce the same event log,
 * every phase in between kept the program's meaning.
 */
export function astExecutor(rules: readonly Rule[]): RuleExecutor {
  const byId = new Map(rules.map((r) => [r.id, r]));
  return {
    start(ruleId, host): Activation {
      const generator = runRule(byId.get(ruleId)!, host);
      return {
        resume(): number | null {
          try {
            const next = generator.next();
            return next.done ? null : next.value;
          } catch (cause) {
            if (cause instanceof Halt) return null;
            throw cause;
          }
        },
      };
    },
  };
}
