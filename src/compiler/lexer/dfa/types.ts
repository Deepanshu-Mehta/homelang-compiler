import type { DiagnosticCode } from '../../diagnostics';

/** Every input character belongs to exactly one class; see charClass.ts. */
export type CharClass =
  | 'letter' | 'digit' | 'underscore' | 'dot' | 'colon' | 'percent' | 'degree'
  | 'gt' | 'lt' | 'eq' | 'bang' | 'quote' | 'backslash' | 'slash' | 'star'
  | 'punct' | 'space' | 'newline' | 'other' | 'eof';

export type DfaName = 'ident' | 'number' | 'relop' | 'string' | 'comment' | 'punct';

export interface DfaState {
  id: string;
  /** Short role label drawn under the state. */
  label?: string;
  /** Token kind produced when the automaton stops here. */
  accept?: string;
  /** Diagram coordinates. */
  x: number;
  y: number;
}

/**
 * A transition. `on` lists the classes it fires for; `'else'` matches any class
 * with no explicit edge from that state. An edge with `error` stops the scan
 * and reports that diagnostic. A state with no matching edge is a dead end,
 * which is what triggers last-accept rollback.
 */
export interface DfaEdge {
  from: string;
  on: readonly (CharClass | 'else')[];
  to?: string;
  error?: DiagnosticCode;
  /** Label drawn on the diagram. */
  label: string;
}

export interface Dfa {
  name: DfaName;
  title: string;
  start: string;
  states: readonly DfaState[];
  edges: readonly DfaEdge[];
  /** Diagram size. */
  width: number;
  height: number;
}

export interface DfaStep {
  from: string;
  to: string;
  ch: string;
  index: number;
}

export interface DfaTrace {
  dfa: DfaName;
  steps: DfaStep[];
  /** The state the automaton accepted in. */
  finalState: string;
  /** Set when the scan overshot and fell back to the last accepting state. */
  rollback?: { deadState: string; lastAcceptState: string; discarded: string };
  /** Plain-language ending, e.g. "Ended in accepting state q4 …". */
  summary: string;
}
