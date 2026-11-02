import type { Span } from '../diagnostics';
import type { Dimension, UnitName } from '../lexer/units';
import type { EventName } from '../semantic/catalog';

export type Relop = '>' | '>=' | '<' | '<=' | '==' | '!=';
export type ArithOp = '+' | '-' | '*' | '/';
export type PowerOp = 'TURN_ON' | 'TURN_OFF' | 'TOGGLE' | 'LOCK' | 'UNLOCK' | 'OPEN' | 'CLOSE';

/** The semantic type attached to expressions in the annotated AST. */
export type ValueType =
  | { kind: 'quantity'; dim: Dimension }
  | { kind: 'time' }
  | { kind: 'day' }
  | { kind: 'enum'; states: readonly string[] }
  | { kind: 'boolean' };

/** Filled in by the semantic phase, on its own copy of the tree. */
export interface Annotation {
  valueType?: ValueType;
  /** Compile-time value in canonical units (°C, seconds, minutes). */
  constant?: number | string;
  /** Tag shown on the annotated AST, e.g. "temperature °C". */
  tag?: string;
}

export interface NumLit extends Annotation {
  kind: 'NumLit';
  value: number;
  unit?: UnitName;
  /** "30C" as written. */
  text: string;
  span: Span;
}

export interface TimeLit extends Annotation {
  kind: 'TimeLit';
  minutes: number;
  text: string;
  span: Span;
}

export type EnumCategory = 'state' | 'day' | 'bool';

/** A state word, a day name, or TRUE/FALSE used as a value. */
export interface EnumLit extends Annotation {
  kind: 'EnumLit';
  value: string;
  category: EnumCategory;
  span: Span;
}

export interface Ref extends Annotation {
  kind: 'Ref';
  /** Canonical upper-case name. */
  name: string;
  display: string;
  span: Span;
}

export interface Arith extends Annotation {
  kind: 'Arith';
  op: ArithOp;
  left: Expr;
  right: Expr;
  span: Span;
}

export interface Neg extends Annotation {
  kind: 'Neg';
  operand: Expr;
  span: Span;
}

export type Expr = NumLit | TimeLit | EnumLit | Ref | Arith | Neg;

export interface Logic {
  kind: 'Logic';
  op: 'AND' | 'OR';
  left: Cond;
  right: Cond;
  span: Span;
}

export interface Not {
  kind: 'Not';
  operand: Cond;
  span: Span;
}

export interface Compare {
  kind: 'Compare';
  op: Relop;
  left: Expr;
  right: Expr;
  span: Span;
}

export interface StateTest {
  kind: 'StateTest';
  /** Normally a Ref; anything else is S318. */
  target: Expr;
  negated: boolean;
  state: string;
  stateSpan: Span;
  span: Span;
}

export interface Between {
  kind: 'Between';
  subject: Expr;
  lo: Expr;
  hi: Expr;
  span: Span;
}

export interface BoolLit {
  kind: 'BoolLit';
  value: boolean;
  span: Span;
}

export type Cond = Logic | Not | Compare | StateTest | Between | BoolLit;

/** A duration as written; the semantic phase checks its unit and sign. */
export interface DurationLit {
  /** Signed, because `FOR -2MIN` must parse so that S312 can report it. */
  value: number;
  unit: UnitName;
  text: string;
  span: Span;
  /** Canonical seconds, set by the semantic phase. */
  seconds?: number;
}

/** Set by O9 on actions moved into a merged rule, so the log still names their rule. */
interface Attributed {
  origin?: string;
}

export interface Power extends Attributed {
  kind: 'Power';
  op: PowerOp;
  target: Ref;
  span: Span;
}

export interface SetAttr extends Attributed {
  kind: 'SetAttr';
  target: Ref;
  attr: string;
  attrSpan: Span;
  value: Expr;
  span: Span;
}

export interface Wait {
  kind: 'Wait';
  duration: DurationLit;
  span: Span;
}

export interface Notify extends Attributed {
  kind: 'Notify';
  text: string;
  span: Span;
}

export interface IfAction {
  kind: 'IfAction';
  cond: Cond;
  thenActs: Action[];
  elseActs?: Action[];
  span: Span;
}

export type Action = Power | SetAttr | Wait | Notify | IfAction;

export interface StateTrigger {
  kind: 'State';
  cond: Cond;
  hold?: DurationLit;
}

export interface EventTrigger {
  kind: 'Event';
  source: Ref;
  event: EventName;
  value?: Expr;
  guard?: Cond;
  span: Span;
}

export interface TimeTrigger {
  kind: 'Time';
  minutes: number;
  days?: string[];
  daySpans?: Span[];
  span: Span;
}

export type Trigger = StateTrigger | EventTrigger | TimeTrigger;

export interface RuleAlias {
  name?: string;
  line: number;
}

export interface Rule {
  kind: 'Rule';
  /** R1, R2, … in source order. */
  id: string;
  name?: string;
  priority: number;
  prioritySpan?: Span;
  trigger: Trigger;
  thenActs: Action[];
  elseActs?: Action[];
  /** Rule ids folded into this one by O9, including its own. */
  mergedFrom?: string[];
  /** After O9: names and lines of the merged rules, for the log. */
  aliases?: Record<string, RuleAlias>;
  /** After O9: merged rules that had no ELSE of their own. */
  noElse?: string[];
  span: Span;
}

export interface RoomDecl {
  kind: 'RoomDecl';
  name: string;
  display: string;
  nameSpan: Span;
  span: Span;
}

export interface DeviceDecl {
  kind: 'DeviceDecl';
  name: string;
  display: string;
  nameSpan: Span;
  typeName: string;
  typeSpan: Span;
  room?: string;
  roomSpan?: Span;
  span: Span;
}

export interface SensorDecl {
  kind: 'SensorDecl';
  name: string;
  display: string;
  nameSpan: Span;
  typeName: string;
  typeSpan: Span;
  room?: string;
  roomSpan?: Span;
  unit?: string;
  unitSpan?: Span;
  span: Span;
}

export type Decl = RoomDecl | DeviceDecl | SensorDecl;

export interface SimAssign {
  target: Ref;
  value: Expr;
  span: Span;
}

export interface SimStmt {
  minutes: number;
  assigns: SimAssign[];
  span: Span;
}

export interface Simulation {
  kind: 'Simulation';
  from?: number;
  to?: number;
  step?: DurationLit;
  stmts: SimStmt[];
  span: Span;
}

export interface Program {
  kind: 'Program';
  decls: Decl[];
  rules: Rule[];
  sim?: Simulation;
  span: Span;
}
