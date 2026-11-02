import type { Action, Program, Rule } from '../../parser/ast';
import { triggerText } from '../../parser/print';
import type { AstPassResult, Change } from '../types';

function hasWait(actions: readonly Action[]): boolean {
  return actions.some((a) => a.kind === 'Wait' ||
    (a.kind === 'IfAction' && (hasWait(a.thenActs) || hasWait(a.elseActs ?? []))));
}

function credit(actions: readonly Action[], origin: string): Action[] {
  return actions.map((a) => {
    if (a.kind === 'Wait') return a;
    if (a.kind !== 'IfAction') return { origin, ...a };
    return {
      ...a, thenActs: credit(a.thenActs, origin),
      ...(a.elseActs && { elseActs: credit(a.elseActs, origin) }),
    };
  });
}

function canMerge(a: Rule, b: Rule): boolean {
  return a.trigger.kind === 'State' && b.trigger.kind === 'State' &&
    a.priority === b.priority && triggerText(a.trigger) === triggerText(b.trigger) &&
    !hasWait(a.thenActs) && !hasWait(b.thenActs) &&
    !hasWait(a.elseActs ?? []) && !hasWait(b.elseActs ?? []);
}

/**
 * O9: rule merging. Only neighbouring rules merge. If another rule sat between
 * them, moving the second one up would reorder its notifications and could
 * change who wins a priority tie.
 */
export function ruleMerge(ast: Program): AstPassResult {
  const changes: Change[] = [];
  const rules: Rule[] = [];

  for (const rule of ast.rules) {
    const previous = rules[rules.length - 1];
    if (!previous || !canMerge(previous, rule)) {
      rules.push(rule);
      continue;
    }
    const firstIds = previous.mergedFrom ?? [previous.id];
    const elseActs = [
      ...credit(previous.elseActs ?? [], previous.id),
      ...credit(rule.elseActs ?? [], rule.id),
    ];
    const merged: Rule = {
      ...previous,
      mergedFrom: [...firstIds, rule.id],
      thenActs: [...credit(previous.thenActs, previous.id), ...credit(rule.thenActs, rule.id)],
    };
    if (elseActs.length) merged.elseActs = elseActs;
    rules[rules.length - 1] = merged;
    changes.push({ before: `${firstIds.join(' + ')}, ${rule.id}: ${triggerText(rule.trigger)}`, after: `one rule ${merged.mergedFrom!.join('+')}` });
  }
  return { ast: { ...ast, rules }, changes };
}
