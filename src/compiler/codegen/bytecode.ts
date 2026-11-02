import type { PowerOp } from '../parser/ast';

export type Value = number | string;

/** The stack machine's instruction set. Addresses are indexes into `code`. */
export type Instr =
  | ['PUSH', Value]
  | ['LOAD', string]
  | ['LOADA', string, string]
  | ['STORE', number]
  | ['LOCAL', number]
  | ['ADD'] | ['SUB'] | ['MUL'] | ['DIV'] | ['NEG']
  | ['CMP_GT'] | ['CMP_GE'] | ['CMP_LT'] | ['CMP_LE'] | ['CMP_EQ'] | ['CMP_NE']
  | ['IN_WINDOW', number, number]
  | ['JMP', number]
  | ['JMP_IF_FALSE', number]
  | ['JMP_IF_TRUE', number]
  | ['EDGE_TRUE', string, number]
  | ['EDGE_FALSE', string]
  | ['CMD', PowerOp, string, string]
  | ['SETA', string, string, string]
  | ['WAIT', number]
  | ['NOTIFY', number, string]
  | ['HALT'];

export interface ObjectDevice {
  name: string;
  type: string;
  room?: string;
  initialState: string;
  states: readonly string[];
  attributes: Record<string, Value>;
  /** Attribute whose value also implies power. */
  levelAttribute?: string;
  /** Limits, for clamping computed values at run time (R503). */
  ranges: Record<string, readonly [number, number]>;
}

export interface ObjectSensor {
  name: string;
  type: string;
  room?: string;
  /** Canonical display unit, such as °C. Empty for enum sensors. */
  unit: string;
  initial: Value;
  states?: readonly string[];
  plausible?: readonly [number, number];
}

export interface ObjectRule {
  id: string;
  name?: string;
  kind: 'STATE' | 'EVENT' | 'TIME';
  priority: number;
  /** Names whose change re-runs a STATE rule. */
  reads: string[];
  writes: string[];
  entry: number;
  source: { line: number; col: number; start: number; end: number };
  event?: { source: string; event: string; threshold?: number };
  time?: { minutes: number; days?: string[] };
  /** Original rules folded into this one by O9. */
  mergedFrom?: string[];
  aliases?: Record<string, { name?: string; line: number }>;
  /** Rule ids here that log "no ELSE" when their condition falls. */
  noElse: string[];
}

export interface ObjectScenario {
  /** Minutes after midnight. */
  from: number;
  to: number;
  stepSeconds: number;
  events: { minutes: number; assigns: { name: string; value: Value }[] }[];
}

export interface ObjectFile {
  version: 1;
  rooms: string[];
  devices: ObjectDevice[];
  sensors: ObjectSensor[];
  strings: string[];
  rules: ObjectRule[];
  code: Instr[];
  scenario?: ObjectScenario;
}

