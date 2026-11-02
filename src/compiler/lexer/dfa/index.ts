import { commentDfa } from './comment';
import { identDfa } from './ident';
import { numberDfa } from './number';
import { punctDfa } from './punct';
import { relopDfa } from './relop';
import { stringDfa } from './string';
import type { CharClass, Dfa, DfaEdge, DfaName, DfaStep } from './types';
import { charClass } from './charClass';

export const DFAS: readonly Dfa[] = [identDfa, numberDfa, relopDfa, stringDfa, commentDfa, punctDfa];
export const DFA_BY_NAME = Object.fromEntries(DFAS.map((d) => [d.name, d])) as Record<DfaName, Dfa>;

/** The first character of a token decides which automaton reads it. */
export function selectDfa(first: CharClass): Dfa | undefined {
  switch (first) {
    case 'letter':
    case 'underscore':
      return identDfa;
    case 'digit':
      return numberDfa;
    case 'gt':
    case 'lt':
    case 'eq':
    case 'bang':
      return relopDfa;
    case 'quote':
      return stringDfa;
    case 'slash':
      return commentDfa;
    case 'punct':
    case 'star':
    case 'colon':
    case 'percent':
      return punctDfa;
    default:
      return undefined;
  }
}

function findEdge(dfa: Dfa, state: string, cls: CharClass): DfaEdge | undefined {
  const edges = dfa.edges.filter((e) => e.from === state);
  // An edge with neither `to` nor `error` documents a deliberate stop.
  return edges.find((e) => e.on.includes(cls)) ?? edges.find((e) => e.on.includes('else'));
}

export type DfaRun =
  | {
      kind: 'accept';
      end: number;
      state: string;
      accept: string;
      steps: DfaStep[];
      rollback?: { deadState: string; lastAcceptState: string; discarded: string };
    }
  | { kind: 'error'; code: NonNullable<DfaEdge['error']>; index: number; steps: DfaStep[] };

/**
 * Runs one automaton from `start` using maximal munch: keep moving while there
 * is a transition, remember the last accepting position, and on a dead end fall
 * back to it. The rollback here is generic; nothing special-cases `2:`.
 */
export function runDfa(dfa: Dfa, source: string, start: number): DfaRun {
  const steps: DfaStep[] = [];
  let state = dfa.start;
  let index = start;
  let lastAccept: { end: number; state: string; accept: string; stepCount: number } | undefined;

  for (;;) {
    const ch = source[index];
    const edge = findEdge(dfa, state, charClass(ch));
    if (edge?.error) return { kind: 'error', code: edge.error, index, steps };
    if (!edge?.to || ch === undefined) break;

    steps.push({ from: state, to: edge.to, ch, index });
    state = edge.to;
    index++;

    const accept = dfa.states.find((s) => s.id === state)?.accept;
    if (accept) lastAccept = { end: index, state, accept, stepCount: steps.length };
  }

  // Every automaton is entered on a character it accepts, except q7 of the
  // relop DFA and q2 of the number DFA, which both report errors above.
  if (!lastAccept) throw new Error(`DFA ${dfa.name} stopped with no accepting state`);

  const overshot = index > lastAccept.end;
  return {
    kind: 'accept',
    end: lastAccept.end,
    state: lastAccept.state,
    accept: lastAccept.accept,
    steps,
    ...(overshot && {
      rollback: {
        deadState: state,
        lastAcceptState: lastAccept.state,
        discarded: source.slice(lastAccept.end, index),
      },
    }),
  };
}
