import type { Action, Cond, Program, Rule } from '../../parser/ast';
import { actionText, condText, triggerText } from '../../parser/print';
import { toBoxes, toDnf } from '../../semantic/intervals';
import type { SymbolTable } from '../../semantic/symbols';
import type { AstPassResult, Change } from '../types';

type Truth = 'never' | 'always' | 'sometimes';

function truthOf(cond: Cond, table: SymbolTable): Truth {
  const dnf = toDnf(cond, false, table);
  if (dnf && toBoxes(dnf).length === 0) return 'never';
  const complement = toDnf(cond, true, table);
  if (complement && toBoxes(complement).length === 0) return 'always';
  return 'sometimes';
}

const TRUE_LITERAL = (span: Cond['span']): Cond => ({ kind: 'BoolLit', value: true, span });

function pruneActions(actions: readonly Action[], table: SymbolTable, changes: Change[]): Action[] {
  return actions.flatMap((action): Action[] => {
    if (action.kind !== 'IfAction') return [action];
    const thenActs = pruneActions(action.thenActs, table, changes);
    const elseActs = action.elseActs ? pruneActions(action.elseActs, table, changes) : undefined;
    const truth = truthOf(action.cond, table);
    if (truth === 'sometimes') return [{ ...action, thenActs, ...(elseActs && { elseActs }) }];

    const kept = truth === 'always' ? thenActs : (elseActs ?? []);
    changes.push({
      before: `IF ${condText(action.cond)} THEN …`,
      after: kept.length ? kept.map(actionText).join(', ') : '(removed)',
    });
    return kept;
  });
}

function pruneRule(rule: Rule, table: SymbolTable, changes: Change[]): Rule | undefined {
  const { trigger } = rule;
  const cond = trigger.kind === 'State' ? trigger.cond : trigger.kind === 'Event' ? trigger.guard : undefined;
  const thenActs = pruneActions(rule.thenActs, table, changes);
  const elseActs = rule.elseActs ? pruneActions(rule.elseActs, table, changes) : undefined;
  const pruned: Rule = { ...rule, thenActs };
  if (elseActs) pruned.elseActs = elseActs;
  else delete pruned.elseActs;

  if (!cond) return pruned;
  const truth = truthOf(cond, table);

  if (truth === 'never') {
    // Its true-set is empty, so neither THEN nor the ELSE that follows THEN can run.
    changes.push({ before: `${rule.id}: ${triggerText(trigger)}`, after: '(rule removed)' });
    return undefined;
  }
  if (truth === 'always' && cond.kind !== 'BoolLit') {
    // THEN stays: it fires once at initial sync. ELSE can never run.
    delete pruned.elseActs;
    if (trigger.kind === 'State') pruned.trigger = { ...trigger, cond: TRUE_LITERAL(cond.span) };
    else if (trigger.kind === 'Event') pruned.trigger = { ...trigger, guard: TRUE_LITERAL(cond.span) };
    changes.push({ before: `${rule.id}: ${condText(cond)}`, after: `${rule.id}: TRUE${rule.elseActs ? ', ELSE removed' : ''}` });
  } else if (truth === 'always' && rule.elseActs) {
    delete pruned.elseActs;
    changes.push({ before: `${rule.id}: ELSE of a condition that is always true`, after: '(ELSE removed)' });
  }
  return pruned;
}

/** O5: dead-rule and dead-branch elimination. */
export function deadRule(ast: Program, table: SymbolTable): AstPassResult {
  const changes: Change[] = [];
  const rules = ast.rules.flatMap((r) => pruneRule(r, table, changes) ?? []);
  return { ast: { ...ast, rules }, changes };
}
