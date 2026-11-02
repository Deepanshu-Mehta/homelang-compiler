import { GRAMMAR, renderAlternative, type GrammarExpr, type Production } from './grammar';

export interface Ll1Conflict {
  nonterminal: string;
  /** Tokens that make the choice ambiguous. */
  tokens: string[];
  reason: string;
}

export interface ParseTableEntry {
  nonterminal: string;
  terminal: string;
  production: string;
}

export interface Ll1Analysis {
  first: Record<string, string[]>;
  follow: Record<string, string[]>;
  nullable: string[];
  conflicts: Ll1Conflict[];
  table: ParseTableEntry[];
}

/**
 * Computes FIRST and FOLLOW as fixed points over the EBNF grammar, then checks
 * the two LL(1) conditions at every decision point:
 *   1. the FIRST sets of a choice's alternatives are pairwise disjoint;
 *   2. wherever a part may be skipped, its FIRST is disjoint from what follows.
 */
export function analyzeGrammar(grammar: readonly Production[] = GRAMMAR): Ll1Analysis {
  const nullableNames = new Set<string>();
  const first = new Map<string, Set<string>>(grammar.map((p) => [p.name, new Set()]));
  const follow = new Map<string, Set<string>>(grammar.map((p) => [p.name, new Set()]));

  const isNullable = (e: GrammarExpr): boolean => {
    switch (e.kind) {
      case 'token':
        return false;
      case 'nonterminal':
        return nullableNames.has(e.name);
      case 'sequence':
        return e.items.every(isNullable);
      case 'choice':
        return e.options.some(isNullable);
      case 'optional':
      case 'repeat':
        return true;
    }
  };

  const firstOf = (e: GrammarExpr): Set<string> => {
    switch (e.kind) {
      case 'token':
        return new Set([e.token]);
      case 'nonterminal':
        return new Set(first.get(e.name));
      case 'sequence': {
        const result = new Set<string>();
        for (const item of e.items) {
          for (const t of firstOf(item)) result.add(t);
          if (!isNullable(item)) break;
        }
        return result;
      }
      case 'choice':
        return new Set(e.options.flatMap((o) => [...firstOf(o)]));
      case 'optional':
      case 'repeat':
        return firstOf(e.item);
    }
  };

  // FIRST and nullable: repeat until nothing changes.
  for (let changed = true; changed;) {
    changed = false;
    for (const { name, body } of grammar) {
      if (isNullable(body) && !nullableNames.has(name)) {
        nullableNames.add(name);
        changed = true;
      }
      const set = first.get(name)!;
      for (const t of firstOf(body)) {
        if (!set.has(t)) {
          set.add(t);
          changed = true;
        }
      }
    }
  }

  /** Visits every sub-expression with the set of tokens that can follow it. */
  const walk = (e: GrammarExpr, after: Set<string>, visit: (e: GrammarExpr, after: Set<string>) => void): void => {
    visit(e, after);
    switch (e.kind) {
      case 'sequence': {
        let trailing = after;
        for (let i = e.items.length - 1; i >= 0; i--) {
          const item = e.items[i]!;
          walk(item, trailing, visit);
          trailing = new Set([...firstOf(item), ...(isNullable(item) ? trailing : [])]);
        }
        break;
      }
      case 'choice':
        for (const option of e.options) walk(option, after, visit);
        break;
      case 'optional':
        walk(e.item, after, visit);
        break;
      case 'repeat':
        walk(e.item, new Set([...firstOf(e.item), ...after]), visit);
        break;
      default:
        break;
    }
  };

  // FOLLOW: repeat until nothing changes.
  for (let changed = true; changed;) {
    changed = false;
    for (const { name, body } of grammar) {
      walk(body, follow.get(name)!, (e, after) => {
        if (e.kind !== 'nonterminal') return;
        const set = follow.get(e.name)!;
        for (const t of after) {
          if (!set.has(t)) {
            set.add(t);
            changed = true;
          }
        }
      });
    }
  }

  const conflicts: Ll1Conflict[] = [];
  const intersect = (a: Set<string>, b: Set<string>): string[] => [...a].filter((t) => b.has(t));

  for (const { name, body } of grammar) {
    walk(body, follow.get(name)!, (e, after) => {
      if (e.kind === 'choice') {
        for (let i = 0; i < e.options.length; i++) {
          for (let j = i + 1; j < e.options.length; j++) {
            const a = e.options[i]!;
            const b = e.options[j]!;
            const tokens = intersect(firstOf(a), firstOf(b));
            if (tokens.length) {
              conflicts.push({ nonterminal: name, tokens,
                reason: `FIRST clash between "${renderAlternative(a)}" and "${renderAlternative(b)}"` });
            }
          }
        }
      }
      if (e.kind === 'optional' || e.kind === 'repeat') {
        const tokens = intersect(firstOf(e.item), after);
        if (tokens.length) {
          conflicts.push({ nonterminal: name, tokens,
            reason: `"${renderAlternative(e)}" can be skipped, but these tokens can also follow it` });
        }
      }
    });
  }

  const table: ParseTableEntry[] = [];
  for (const { name, body } of grammar) {
    const alternatives = body.kind === 'choice' ? body.options : [body];
    for (const alternative of alternatives) {
      for (const terminal of firstOf(alternative)) {
        table.push({ nonterminal: name, terminal, production: renderAlternative(alternative) });
      }
    }
  }

  const sorted = (m: Map<string, Set<string>>): Record<string, string[]> =>
    Object.fromEntries(grammar.map((p) => [p.name, [...m.get(p.name)!].sort()]));

  return { first: sorted(first), follow: sorted(follow), nullable: [...nullableNames], conflicts, table };
}
