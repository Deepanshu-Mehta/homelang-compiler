import type { Action, Cond, Program, Relop, Rule, Trigger } from '../../parser/ast';
import { condText } from '../../parser/print';
import type { AstPassResult, Change } from '../types';

const NEGATED: Readonly<Record<Relop, Relop>> = {
  '>': '<=', '>=': '<', '<': '>=', '<=': '>', '==': '!=', '!=': '==',
};

function holds(a: number | string, op: Relop, b: number | string): boolean {
  switch (op) {
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '==': return a === b;
    case '!=': return a !== b;
  }
}

/** Applies the boolean identities bottom-up. */
export function simplify(c: Cond): Cond {
  switch (c.kind) {
    case 'Not':
      return simplifyNot({ ...c, operand: simplify(c.operand) });
    case 'Logic':
      return simplifyLogic({ ...c, left: simplify(c.left), right: simplify(c.right) });
    case 'Compare': {
      const { left, right } = c;
      if (left.constant === undefined || right.constant === undefined) return c;
      return { kind: 'BoolLit', value: holds(left.constant, c.op, right.constant), span: c.span };
    }
    default:
      return c;
  }
}

function simplifyNot(c: Extract<Cond, { kind: 'Not' }>): Cond {
  const { operand } = c;
  switch (operand.kind) {
    case 'Not':
      return operand.operand; // NOT NOT x → x
    case 'BoolLit':
      return { ...operand, value: !operand.value };
    case 'Compare':
      return { ...operand, op: NEGATED[operand.op] }; // NOT (a > b) → a <= b
    case 'StateTest':
      return { ...operand, negated: !operand.negated };
    default:
      return c;
  }
}

function simplifyLogic(c: Extract<Cond, { kind: 'Logic' }>): Cond {
  const { left, right, op } = c;
  // Identity element: x AND TRUE → x; x OR FALSE → x.
  const identity = op === 'AND';
  if (left.kind === 'BoolLit') return left.value === identity ? right : left;
  if (right.kind === 'BoolLit') return right.value === identity ? left : right;
  return c;
}

/** Runs `rewrite` on every condition in a rule, recording what changed. */
export function mapRuleConds(rule: Rule, rewrite: (c: Cond) => Cond, changes: Change[]): Rule {
  const apply = (c: Cond): Cond => {
    const after = rewrite(c);
    const [beforeText, afterText] = [condText(c), condText(after)];
    if (beforeText !== afterText) changes.push({ before: `${rule.id}: ${beforeText}`, after: `${rule.id}: ${afterText}` });
    return after;
  };

  const mapActions = (actions: readonly Action[]): Action[] => actions.map((a) => {
    if (a.kind !== 'IfAction') return a;
    return {
      ...a, cond: apply(a.cond), thenActs: mapActions(a.thenActs),
      ...(a.elseActs && { elseActs: mapActions(a.elseActs) }),
    };
  });

  const { trigger } = rule;
  let nextTrigger: Trigger = trigger;
  if (trigger.kind === 'State') nextTrigger = { ...trigger, cond: apply(trigger.cond) };
  else if (trigger.kind === 'Event' && trigger.guard) nextTrigger = { ...trigger, guard: apply(trigger.guard) };

  return {
    ...rule, trigger: nextTrigger, thenActs: mapActions(rule.thenActs),
    ...(rule.elseActs && { elseActs: mapActions(rule.elseActs) }),
  };
}

/** O3: boolean and algebraic simplification. */
export function boolSimp(ast: Program): AstPassResult {
  const changes: Change[] = [];
  const rules = ast.rules.map((rule) => mapRuleConds(rule, simplify, changes));
  return { ast: { ...ast, rules }, changes };
}
