import { makeDiagnostic, type Diagnostic } from '../diagnostics';
import { formatMinutes, formatNumber } from '../numeric';
import type { Cond, Program, Rule } from '../parser/ast';
import { ruleWrites, writeKey, type Write } from './effects';
import { intersectBoxes, pointIn, toBoxes, toDnf, type Box, type Dnf } from './intervals';
import type { SymbolTable } from './symbols';
import { canonicalDisplay } from '../lexer/units';

export interface WitnessValue {
  variable: string;
  /** Canonical number, or a state word. TIME is in minutes. */
  value: number | string;
  text: string;
}

export interface Conflict {
  ruleA: string;
  ruleB: string;
  /** Device or attribute both rules write, e.g. "AC". */
  target: string;
  valueA: string;
  valueB: string;
  witness: WitnessValue[];
  toggle: boolean;
}

/** The condition under which a write happens, as a DNF. */
function writeCondition(rule: Rule, write: Write, table: SymbolTable): Dnf | null {
  const parts: { cond: Cond; negated: boolean }[] = [...write.guards];
  const { trigger } = rule;
  if (trigger.kind === 'State') parts.push({ cond: trigger.cond, negated: write.branch === 'else' });
  else if (trigger.kind === 'Event' && trigger.guard) parts.push({ cond: trigger.guard, negated: false });

  let dnf: Dnf = [[]];
  if (trigger.kind === 'Time') {
    const interval = { lo: trigger.minutes, hi: trigger.minutes + 1, loOpen: false, hiOpen: true };
    dnf = [[{ kind: 'num', variable: 'TIME', interval }]];
  }
  for (const { cond, negated } of parts) {
    const next = toDnf(cond, negated, table);
    if (!next || next.length * dnf.length > 64) return null;
    dnf = dnf.flatMap((a) => next.map((b) => [...a, ...b]));
  }
  return dnf;
}

function witnessOf(box: Box, table: SymbolTable): WitnessValue[] {
  const values: WitnessValue[] = [];
  for (const [variable, interval] of box.numbers) {
    const value = pointIn(interval);
    if (variable === 'TIME') {
      const minutes = Math.floor(value);
      values.push({ variable, value: minutes, text: `TIME = ${formatMinutes(minutes)}` });
    } else {
      const dim = table.get(variable)?.dim;
      const unit = dim ? canonicalDisplay(dim) : '';
      values.push({ variable, value, text: `${variable} = ${formatNumber(value)}${unit ? ` ${unit}` : ''}` });
    }
  }
  for (const [variable, allowed] of box.enums) {
    const value = allowed[0]!;
    values.push({ variable, value, text: `${variable} = ${value}` });
  }
  return values;
}

/** Two boxes that overlap mean some concrete moment makes both rules active. */
function firstOverlap(a: Dnf, b: Dnf): Box | null {
  for (const x of toBoxes(a)) {
    if (x.unknown) continue;
    for (const y of toBoxes(b)) {
      if (y.unknown) continue;
      const overlap = intersectBoxes(x, y);
      if (overlap) return overlap;
    }
  }
  return null;
}

/** Pairs of equal-priority rules that write different values to one target. */
export function findConflicts(program: Program, table: SymbolTable): { conflicts: Conflict[]; diagnostics: Diagnostic[] } {
  const conflicts: Conflict[] = [];
  const diagnostics: Diagnostic[] = [];
  const { rules } = program;

  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const ruleA = rules[i]!;
      const ruleB = rules[j]!;
      if (ruleA.priority !== ruleB.priority || !canCoincide(ruleA, ruleB)) continue;
      const conflict = conflictBetween(ruleA, ruleB, table);
      if (!conflict) continue;
      conflicts.push(conflict);
      diagnostics.push(conflictDiagnostic(conflict, ruleB));
    }
  }
  return { conflicts, diagnostics };
}

/**
 * State rules stay active, so they can overlap. An event rule exists for one
 * instant, so it collides only with a rule started by that same event.
 */
function canCoincide(a: Rule, b: Rule): boolean {
  if (a.trigger.kind === 'State' && b.trigger.kind === 'State') return true;
  return triggerKey(a) !== undefined && triggerKey(a) === triggerKey(b);
}

function triggerKey({ trigger }: Rule): string | undefined {
  if (trigger.kind === 'Event') return `${trigger.source.name}/${trigger.event}/${trigger.value?.constant ?? ''}`;
  if (trigger.kind === 'Time') return `AT/${trigger.minutes}`;
  return undefined;
}

function conflictBetween(ruleA: Rule, ruleB: Rule, table: SymbolTable): Conflict | null {
  const writesB = ruleWrites(ruleB, table);
  for (const a of ruleWrites(ruleA, table)) {
    for (const b of writesB) {
      if (writeKey(a) !== writeKey(b) || a.value === '?' || b.value === '?') continue;
      const toggle = a.value === 'TOGGLE' || b.value === 'TOGGLE';
      if (a.value === b.value && !toggle) continue;
      const dnfA = writeCondition(ruleA, a, table);
      const dnfB = writeCondition(ruleB, b, table);
      if (!dnfA || !dnfB) continue;
      const overlap = firstOverlap(dnfA, dnfB);
      if (!overlap) continue;
      return {
        ruleA: ruleA.id, ruleB: ruleB.id, target: writeKey(a),
        valueA: String(a.value), valueB: String(b.value),
        witness: witnessOf(overlap, table), toggle,
      };
    }
  }
  return null;
}

function conflictDiagnostic(c: Conflict, later: Rule): Diagnostic {
  const moment = c.witness.length ? ` (e.g. ${c.witness.map((w) => w.text).join(', ')})` : '';
  const note = c.toggle ? ' TOGGLE results depend on order; prefer TURN_ON/OFF.' : '';
  return makeDiagnostic('W404', later.span,
    `${c.ruleA} and ${c.ruleB} can be active together${moment} and set ${c.target} to ${c.valueA} and ${c.valueB}. Equal priority: the later rule wins. Add PRIORITY.${note}`);
}
