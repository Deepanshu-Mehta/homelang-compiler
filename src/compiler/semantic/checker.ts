import { type Diagnostic, type DiagnosticCode, makeDiagnostic, type Span } from '../diagnostics';
import { canonicalDisplay, toCanonical, UNIT_TABLE, type Dimension, type UnitName } from '../lexer/units';
import { formatNumber, round6 } from '../numeric';
import type {
  Action, Arith, Between, Compare, Cond, DurationLit, Expr, Neg, NumLit, Program, Ref, Rule,
  SetAttr, Simulation, SimAssign, StateTest, TimeLit, ValueType,
} from '../parser/ast';
import { exprText } from '../parser/print';
import { editDistance } from '../parser/parser';
import { CATALOG, DAYS, type Attribute, type DeviceType, type SensorType } from './catalog';
import { addBuiltins, addPrelude, makeRoom, makeTyped, SymbolTable, type SymbolEntry } from './symbols';
import { dimensionNoun, quantity, stateNoun, typeTag } from './types';

const ORDERING_OPS: ReadonlySet<string> = new Set(['>', '>=', '<', '<=']);
const MAX_LITERAL = 1e15;

const ACTION_VERB: Readonly<Record<string, string>> = {
  TURN_ON: 'turned on', TURN_OFF: 'turned off', TOGGLE: 'toggled', LOCK: 'locked',
  UNLOCK: 'unlocked', OPEN: 'opened', CLOSE: 'closed', SET: 'set',
};

const CONTRADICTIONS: Readonly<Record<string, string>> = {
  TURN_ON: 'TURN_OFF', TURN_OFF: 'TURN_ON', LOCK: 'UNLOCK', UNLOCK: 'LOCK', OPEN: 'CLOSE', CLOSE: 'OPEN',
};

const EVENT_TEXT: Readonly<Record<string, string>> = {
  TURNS_ON: 'TURNS ON', TURNS_OFF: 'TURNS OFF', RISES_ABOVE: 'RISES ABOVE', FALLS_BELOW: 'FALLS BELOW',
};

/** What the checker knows about an expression after visiting it. */
interface Typed {
  type: ValueType;
  /** Unitless literal arithmetic, which adopts the unit of what it meets. */
  bare: boolean;
  symbol?: SymbolEntry;
  text: string;
}

export interface CheckResult {
  mode: 'prelude' | 'explicit';
  table: SymbolTable;
  diagnostics: Diagnostic[];
}

/** Two passes: declarations first, so that rules can refer to anything declared. */
export function checkProgram(program: Program): CheckResult {
  return new Checker(program).run();
}

class Checker {
  private readonly table = new SymbolTable();
  private readonly diagnostics: Diagnostic[] = [];
  private currentRule = '';
  /** How a read of a name inside a rule should be recorded; off for scenarios. */
  private recordReads = true;
  /** Constant expressions already reported as too large. */
  private readonly oversized = new WeakSet<Arith>();

  constructor(private readonly program: Program) {}

  private report(code: DiagnosticCode, span: Span, message: string, hint?: string): void {
    this.diagnostics.push(makeDiagnostic(code, span, message, hint));
  }

  run(): CheckResult {
    const explicit = this.program.decls.length > 0;
    addBuiltins(this.table);
    if (explicit) this.collectDeclarations();
    else addPrelude(this.table);

    for (const rule of this.program.rules) this.checkRule(rule);
    if (this.program.sim) this.checkSimulation(this.program.sim);
    return {
      mode: explicit ? 'explicit' : 'prelude',
      table: this.table,
      diagnostics: this.diagnostics,
    };
  }

  // ---- pass 1: declarations -----------------------------------------------

  private declare(name: string, display: string, span: Span): boolean {
    const existing = this.table.get(name);
    if (!existing) return true;
    if (existing.builtin) {
      this.report('S302', span, `'${display}' is a built-in name and cannot be redeclared.`);
    } else {
      const at = existing.declSpan!;
      this.report('S302', span,
        `'${display}' is already declared at line ${at.line}, column ${at.col} (names are case-insensitive).`);
    }
    return false;
  }

  private collectDeclarations(): void {
    // Rooms go first, so a device may name a room declared further down.
    for (const d of this.program.decls) {
      if (d.kind === 'RoomDecl' && this.declare(d.name, d.display, d.nameSpan)) {
        this.table.add(makeRoom(d.name, d.display, false, d.nameSpan));
      }
    }
    for (const d of this.program.decls) {
      if (d.kind === 'RoomDecl') continue;
      const wanted = d.kind === 'DeviceDecl' ? 'device' : 'sensor';
      const type = CATALOG.get(d.typeName);
      if (!type) {
        const known = [...CATALOG.values()].filter((t) => t.kind === wanted).map((t) => t.name);
        this.report('S303', d.typeSpan, `Unknown type '${d.typeName}'. Known types: ${known.join(', ')}.`,
          this.suggestion(d.typeName, known));
      } else if (type.kind !== wanted) {
        this.report('S303', d.typeSpan,
          `${d.typeName} is a ${type.kind} type; declare it with ${type.kind.toUpperCase()}.`);
      }
      if (d.room !== undefined && this.table.get(d.room)?.kind !== 'ROOM') {
        this.report('S304', d.roomSpan!, `Room '${d.room}' is not declared.`,
          `Add ROOM ${d.room}; above this line.`);
      }
      if (!this.declare(d.name, d.display, d.nameSpan) || !type || type.kind !== wanted) continue;

      const entry = makeTyped(d.name, d.display, type, d.room, false, d.nameSpan);
      if (d.kind === 'SensorDecl' && d.unit !== undefined) this.applyUnit(entry, type as SensorType, d.unit, d.unitSpan!);
      this.table.add(entry);
    }
  }

  private applyUnit(entry: SymbolEntry, type: SensorType, unit: string, span: Span): void {
    const info = UNIT_TABLE[unit];
    if (!info) {
      this.report('S321', span, `Unknown unit '${unit}'.`);
    } else if (info.dim !== type.dim) {
      const wants = type.dim ? `${canonicalDisplay(type.dim)} readings` : 'no unit, because it reports states';
      this.report('S321', span, `${type.name} cannot use unit ${info.display}: it needs ${wants}.`);
    } else {
      entry.unit = info.unit;
    }
  }

  // ---- pass 2: rules ------------------------------------------------------

  private checkRule(rule: Rule): void {
    this.currentRule = rule.id;
    if (rule.prioritySpan && (rule.priority < 1 || !Number.isInteger(rule.priority))) {
      this.report('S320', rule.prioritySpan, `PRIORITY must be a whole number of 1 or more; got ${rule.priority}.`);
    }

    const { trigger } = rule;
    switch (trigger.kind) {
      case 'State':
        this.checkCond(trigger.cond);
        if (trigger.hold) this.checkDuration(trigger.hold, 'FOR');
        break;
      case 'Event':
        this.checkEvent(trigger);
        if (trigger.guard) this.checkCond(trigger.guard);
        break;
      case 'Time':
        break;
    }
    this.checkActions(rule.thenActs);
    if (rule.elseActs) this.checkActions(rule.elseActs);
  }

  private checkDuration(duration: DurationLit, keyword: string): void {
    const info = Object.values(UNIT_TABLE).find((u) => u.unit === duration.unit)!;
    if (info.dim !== 'duration') {
      this.report('S310', duration.span, `${keyword} needs a duration, but ${duration.text} is ${dimensionNoun(info.dim)}.`);
      return;
    }
    duration.seconds = toCanonical(duration.value, duration.unit);
    if (duration.seconds <= 0) {
      this.report('S312', duration.span, `${keyword} duration must be greater than zero.`);
    }
  }

  private checkEvent(trigger: Extract<Rule['trigger'], { kind: 'Event' }>): void {
    const { source, event } = trigger;
    const symbol = this.resolve(source, 'device or sensor');
    if (!symbol) return;
    this.noteRead(symbol);

    if (symbol.kind === 'BUILTIN') {
      this.report('S314', source.span, `${symbol.name} has no events. Use an AT rule for clock times.`);
      return;
    }
    if (symbol.kind === 'ROOM') {
      this.report('S314', source.span, `${symbol.name} is a room; rooms have no events.`);
      return;
    }
    const events = symbol.catalog!.events;
    if (!events.includes(event)) {
      const options = events.map((e) => EVENT_TEXT[e] ?? e).join(', ');
      this.report('S314', source.span,
        `${source.name} (${symbol.typeName}) has no event ${EVENT_TEXT[event] ?? event}. Use ${options}.`);
      return;
    }
    if (trigger.value) this.checkThreshold(trigger.value, symbol);
  }

  private checkThreshold(value: Expr, symbol: SymbolEntry): void {
    const typed = this.typeOf(value);
    if (!typed) return;
    if (value.constant === undefined) {
      this.report('S325', value.span, `The threshold '${exprText(value)}' must be a constant.`);
      return;
    }
    const dim = symbol.dim ?? 'count';
    this.matchDimension(typed, value, symbol, dim);
  }

  // ---- actions ------------------------------------------------------------

  private checkActions(actions: readonly Action[]): void {
    for (const action of actions) {
      switch (action.kind) {
        case 'Power':
          this.checkPower(action);
          break;
        case 'SetAttr':
          this.checkSet(action);
          break;
        case 'Wait':
          this.checkDuration(action.duration, 'WAIT');
          break;
        case 'Notify':
          break;
        case 'IfAction':
          this.checkCond(action.cond);
          this.checkActions(action.thenActs);
          if (action.elseActs) this.checkActions(action.elseActs);
          break;
      }
    }
    this.checkContradictions(actions);
  }

  /** S313: opposite commands in one branch, with no WAIT to separate them. */
  private checkContradictions(actions: readonly Action[]): void {
    let seen = new Map<string, Span>();
    for (const action of actions) {
      if (action.kind === 'Wait') {
        seen = new Map();
      } else if (action.kind === 'Power' && action.op !== 'TOGGLE') {
        const opposite = seen.get(`${action.target.name}/${CONTRADICTIONS[action.op]}`);
        if (opposite) {
          this.report('S313', action.span,
            `Contradictory actions on ${action.target.name} in the same branch (line ${opposite.line}, column ${opposite.col} and column ${action.span.col}).`);
        }
        seen.set(`${action.target.name}/${action.op}`, action.span);
      }
    }
  }

  private deviceTarget(target: Ref, action: string): { symbol: SymbolEntry; type: DeviceType } | undefined {
    const symbol = this.resolveDevice(target, action);
    if (!symbol) return undefined;
    symbol.useCount++;
    return { symbol, type: symbol.catalog as DeviceType };
  }

  private resolveDevice(target: Ref, action: string): SymbolEntry | undefined {
    const symbol = this.table.get(target.name);
    const devices = this.table.ofKind('DEVICE').map((d) => d.displayName);
    if (!symbol) {
      this.report('S301', target.span,
        `Unknown device '${target.display}'. Declared devices: ${devices.join(', ') || 'none'}.`,
        this.suggestion(target.name, devices));
      return undefined;
    }
    if (symbol.kind === 'SENSOR') {
      this.report('S305', target.span,
        `'${target.display}' is a sensor; sensors are read-only and cannot be ${ACTION_VERB[action]}.`);
      return undefined;
    }
    if (symbol.kind !== 'DEVICE') {
      this.report('S301', target.span,
        `'${target.display}' is ${symbol.kind === 'ROOM' ? 'a room' : 'a built-in value'}, not a device. Declared devices: ${devices.join(', ')}.`);
      return undefined;
    }
    return symbol;
  }

  private label(symbol: SymbolEntry): string {
    return symbol.name === symbol.typeName ? symbol.name : `${symbol.name} (${symbol.typeName})`;
  }

  private checkPower(action: Extract<Action, { kind: 'Power' }>): void {
    const found = this.deviceTarget(action.target, action.op);
    if (!found) return;
    const { symbol, type } = found;
    if (!type.actions.includes(action.op)) {
      this.report('S306', action.span,
        `${this.label(symbol)} does not support ${action.op}. Supported: ${type.actions.join(', ')}.`);
      return;
    }
    this.noteWrite(symbol);
  }

  private noteWrite(symbol: SymbolEntry): void {
    if (!symbol.writtenBy.includes(this.currentRule)) symbol.writtenBy.push(this.currentRule);
  }

  private checkSet(action: SetAttr): void {
    const found = this.deviceTarget(action.target, 'SET');
    if (!found) return;
    const { symbol, type } = found;
    const attribute = type.attributes[action.attr];
    if (!attribute) {
      const names = Object.keys(type.attributes);
      const advice = names.length
        ? `Attributes: ${names.join(', ')}.`
        : `use ${type.actions.join(' or ')}.`;
      this.report('S307', action.attrSpan,
        `${type.name} has no attribute ${action.attr}${names.length ? '. ' : '; '}${advice}`);
      return;
    }
    this.noteWrite(symbol);
    if (attribute.kind === 'enum') this.checkEnumAttribute(action, attribute);
    else this.checkNumericAttribute(action, attribute);
  }

  /** An enum attribute reads its own value set first, so MODE TO FAN is not the device FAN. */
  private checkEnumAttribute(action: SetAttr, attribute: Extract<Attribute, { kind: 'enum' }>): void {
    const { value } = action;
    const word = value.kind === 'Ref' ? value.name : value.kind === 'EnumLit' ? value.value : undefined;
    if (word === undefined || !attribute.values.includes(word)) {
      this.report('S309', value.span,
        `${exprText(value)} is not a valid value for ${action.target.name} ${action.attr}. Valid: ${attribute.values.join(', ')}.`);
      return;
    }
    const type: ValueType = { kind: 'enum', states: attribute.values };
    action.value = {
      kind: 'EnumLit', value: word, category: 'state', span: value.span,
      valueType: type, constant: word, tag: typeTag(type),
    };
  }

  private checkNumericAttribute(action: SetAttr, attribute: Extract<Attribute, { kind: 'number' }>): void {
    const { value } = action;
    const typed = this.typeOf(value);
    if (!typed) return;

    const unit = attribute.dim === 'count' ? undefined : canonicalUnit(attribute.dim);
    if (typed.bare) {
      this.adopt(value, attribute.dim, unit);
    } else if (typed.type.kind !== 'quantity' || typed.type.dim !== attribute.dim) {
      this.report('S310', value.span,
        `${action.target.name} ${action.attr} needs ${dimensionNoun(attribute.dim)}; got ${this.describe(typed)}.`);
      return;
    }
    if (typeof value.constant !== 'number') return; // run time clamps it (R503)

    const got = value.constant;
    const unitText = canonicalDisplay(attribute.dim);
    const shown = (x: number): string => (unitText ? `${x} ${unitText}` : String(x));
    const range = `${attribute.min}–${attribute.max}${unitText ? ` ${unitText}` : ''}`;
    if (got < attribute.min || got > attribute.max) {
      this.report('S311', value.span,
        `Out of range: ${action.target.name} ${action.attr} must be ${range}; got ${shown(got)}.`);
    } else if (attribute.integer && !Number.isInteger(got)) {
      this.report('S311', value.span,
        `Out of range: ${action.target.name} ${action.attr} must be a whole number; got ${got}.`);
    }
  }

  // ---- conditions ---------------------------------------------------------

  private checkCond(cond: Cond): void {
    switch (cond.kind) {
      case 'Logic':
        this.checkCond(cond.left);
        this.checkCond(cond.right);
        break;
      case 'Not':
        this.checkCond(cond.operand);
        break;
      case 'Compare':
        this.checkCompare(cond);
        break;
      case 'StateTest':
        this.checkStateTest(cond);
        break;
      case 'Between':
        this.checkBetween(cond);
        break;
      case 'BoolLit':
        break;
    }
  }

  private checkCompare(cond: Compare): void {
    const left = this.typeOf(cond.left);
    const right = this.typeOf(cond.right);
    if (left && right) this.compareTypes(cond, left, right);
  }

  private compareTypes(cond: Compare, left: Typed, right: Typed): void {
    const a = left.type;
    const b = right.type;
    const span = cond.span;

    if (left.symbol?.kind === 'DEVICE' && right.symbol?.kind === 'DEVICE') {
      this.report('S315', span, `Cannot compare ${left.text} with ${right.text}: devices have states, not values.`);
      return;
    }
    if (a.kind === 'time' || b.kind === 'time') {
      if (a.kind !== b.kind) this.report('S319', span, 'TIME can only be compared with HH:MM times.');
      return;
    }
    if (a.kind === 'quantity' && b.kind === 'quantity') {
      this.compareQuantities(cond, left, right, a.dim, b.dim);
      return;
    }
    if (a.kind === 'enum' && b.kind === 'enum') {
      this.compareEnums(cond, left, right);
      return;
    }
    if (a.kind === 'day' && b.kind === 'day') {
      if (ORDERING_OPS.has(cond.op)) {
        this.report('S316', span, `Days can only be tested with IS or ==, not ${cond.op}.`);
      } else {
        this.rejectDaySet(cond.left);
        this.rejectDaySet(cond.right);
      }
      return;
    }
    this.report('S308', span, `Type mismatch: ${this.describe(left)} but ${this.describe(right)}.`);
  }

  private rejectDaySet(e: Expr): void {
    if (e.kind === 'EnumLit' && (e.value === 'WEEKDAYS' || e.value === 'WEEKENDS')) {
      this.report('S308', e.span, `${e.value} is a set of days, usable only in AT … ON.`,
        'Compare DAY with one day, such as DAY == MON.');
    }
  }

  private compareQuantities(cond: Compare, left: Typed, right: Typed, a: Dimension, b: Dimension): void {
    if (left.bare && right.bare) return;
    if (left.bare) {
      this.adopt(cond.left, b, right.symbol?.unit ?? canonicalUnit(b));
      return;
    }
    if (right.bare) {
      this.adopt(cond.right, a, left.symbol?.unit ?? canonicalUnit(a));
      return;
    }
    if (a === b) return;
    if (left.symbol && right.symbol) {
      this.report('S315', cond.span, `Cannot compare ${left.text} with ${right.text}: ${dimensionNoun(a)} and ${dimensionNoun(b)}.`);
    } else {
      this.report('S310', cond.span, `Cannot compare ${dimensionNoun(a)} with ${dimensionNoun(b)}.`);
    }
  }

  private compareEnums(cond: Compare, left: Typed, right: Typed): void {
    if (ORDERING_OPS.has(cond.op)) {
      this.report('S316', cond.span, `States can only be tested with IS or ==, not ${cond.op}.`);
      return;
    }
    const a = left.type as Extract<ValueType, { kind: 'enum' }>;
    const b = right.type as Extract<ValueType, { kind: 'enum' }>;
    if (b.states.length === 1 && !a.states.includes(b.states[0]!)) {
      this.invalidState(left.symbol, left.text, b.states[0]!, a.states, cond.right.span);
    } else if (a.states.length === 1 && !b.states.includes(a.states[0]!)) {
      this.invalidState(right.symbol, right.text, a.states[0]!, b.states, cond.left.span);
    }
  }

  private invalidState(symbol: SymbolEntry | undefined, name: string, state: string, valid: readonly string[], span: Span): void {
    const who = symbol ? this.labelWithType(symbol) : name;
    this.report('S309', span, `${state} is not a valid state for ${who}. Valid: ${valid.join(', ')}.`);
  }

  private labelWithType(symbol: SymbolEntry): string {
    return `${symbol.name} (${symbol.typeName})`;
  }

  private checkStateTest(cond: StateTest): void {
    if (cond.target.kind !== 'Ref') {
      this.typeOf(cond.target);
      this.report('S318', cond.target.span, 'IS needs a device or sensor name on its left.');
      return;
    }
    const typed = this.typeOf(cond.target);
    if (!typed) return;
    const { type } = typed;
    if (type.kind === 'day') {
      if (!(DAYS as readonly string[]).includes(cond.state)) {
        this.report('S309', cond.stateSpan, `${cond.state} is not a valid value for DAY. Valid: ${DAYS.join(', ')}.`);
      }
    } else if (type.kind === 'enum') {
      if (!type.states.includes(cond.state)) {
        this.invalidState(typed.symbol, typed.text, cond.state, type.states, cond.stateSpan);
      }
    } else {
      this.report('S309', cond.stateSpan,
        `${cond.state} is not a valid state for ${typed.symbol ? this.labelWithType(typed.symbol) : typed.text}. It has numeric readings; compare it with > or <.`);
    }
  }

  private checkBetween(cond: Between): void {
    const subject = this.typeOf(cond.subject);
    const lo = this.typeOf(cond.lo);
    const hi = this.typeOf(cond.hi);
    if (!subject || !lo || !hi) return;

    if (subject.type.kind === 'time' || lo.type.kind === 'time' || hi.type.kind === 'time') {
      if (subject.type.kind !== 'time' || lo.type.kind !== 'time' || hi.type.kind !== 'time') {
        this.report('S319', cond.span, 'TIME can only be compared with HH:MM times.');
      }
      return;
    }
    if (subject.type.kind !== 'quantity') {
      this.report('S308', cond.subject.span, `Type mismatch: BETWEEN needs a numeric value, but ${this.describe(subject)}.`);
      return;
    }
    const { dim } = subject.type;
    for (const [bound, typed] of [[cond.lo, lo], [cond.hi, hi]] as const) {
      this.matchDimension(typed, bound, subject.symbol, dim);
    }
  }

  /** Checks a value against a dimension, letting bare numbers adopt it. */
  private matchDimension(typed: Typed, value: Expr, owner: SymbolEntry | undefined, dim: Dimension): void {
    if (typed.bare) {
      if (dim !== 'count') this.adopt(value, dim, owner?.unit ?? canonicalUnit(dim));
      return;
    }
    if (typed.type.kind !== 'quantity' || typed.type.dim !== dim) {
      this.report('S310', value.span, `Cannot compare ${dimensionNoun(dim)} with ${this.describe(typed)}.`);
    }
  }

  // ---- expressions --------------------------------------------------------

  private describe(typed: Typed): string {
    const { type, text, symbol } = typed;
    switch (type.kind) {
      case 'quantity':
        return symbol || !typed.bare ? `${text} is ${dimensionNoun(type.dim)}` : `${text} is a plain number`;
      case 'time':
        return `${text} is a time`;
      case 'day':
        return `${text} is a day`;
      case 'boolean':
        return `${text} is a boolean`;
      case 'enum':
        return `${text} is ${stateNoun(type.states[0]!)}`;
    }
  }

  private noteRead(symbol: SymbolEntry): void {
    symbol.useCount++;
    if (this.recordReads && !symbol.readBy.includes(this.currentRule)) symbol.readBy.push(this.currentRule);
  }

  private suggestion(name: string, candidates: readonly string[]): string | undefined {
    let best: string | undefined;
    let bestDistance = 3;
    for (const candidate of candidates) {
      const distance = editDistance(name, candidate.toUpperCase());
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best ? `Did you mean ${best}?` : undefined;
  }

  private resolve(ref: Ref, what: string): SymbolEntry | undefined {
    const symbol = this.table.get(ref.name);
    if (symbol) return symbol;
    const names = this.table.all().filter((s) => s.kind !== 'ROOM').map((s) => s.displayName);
    this.report('S301', ref.span, `Unknown ${what} '${ref.display}'.`,
      this.suggestion(ref.name, names) ?? `Known names: ${names.join(', ')}.`);
    return undefined;
  }

  private typeOf(e: Expr): Typed | undefined {
    const typed = this.visit(e);
    if (typed) {
      e.valueType = typed.type;
      e.tag = typeTag(typed.type);
    }
    return typed;
  }

  private visit(e: Expr): Typed | undefined {
    switch (e.kind) {
      case 'NumLit':
        return this.visitNumber(e);
      case 'TimeLit':
        return this.visitTime(e);
      case 'EnumLit':
        e.constant = e.value;
        if (e.category === 'day') return { type: { kind: 'day' }, bare: false, text: e.value };
        if (e.category === 'bool') return { type: { kind: 'boolean' }, bare: false, text: e.value };
        return { type: { kind: 'enum', states: [e.value] }, bare: false, text: e.value };
      case 'Ref':
        return this.visitRef(e);
      case 'Neg':
        return this.visitNeg(e);
      case 'Arith':
        return this.visitArith(e);
    }
  }

  private visitNumber(e: NumLit): Typed {
    if (e.unit === undefined) {
      e.constant = e.value;
      return { type: quantity('count'), bare: true, text: e.text };
    }
    const canonical = toCanonical(e.value, e.unit);
    e.constant = canonical;
    if (e.unit === 'F') {
      this.report('W410', e.span, `${formatNumber(e.value)} °F converted to ${formatNumber(canonical)} °C.`);
    }
    const dim = Object.values(UNIT_TABLE).find((u) => u.unit === e.unit)!.dim;
    return { type: quantity(dim), bare: false, text: e.text };
  }

  private visitTime(e: TimeLit): Typed {
    e.constant = e.minutes;
    return { type: { kind: 'time' }, bare: false, text: e.text };
  }

  private visitRef(e: Ref): Typed | undefined {
    const symbol = this.resolve(e, 'device or sensor');
    if (!symbol) return undefined;
    this.noteRead(symbol);
    const base = { bare: false, symbol, text: e.name };

    if (symbol.kind === 'ROOM') {
      this.report('S301', e.span, `'${e.display}' is a room, not a device or sensor.`);
      return undefined;
    }
    if (symbol.kind === 'BUILTIN') {
      return { ...base, type: { kind: symbol.name === 'TIME' ? 'time' : 'day' } };
    }
    if (symbol.kind === 'DEVICE') {
      return { ...base, type: { kind: 'enum', states: (symbol.catalog as DeviceType).states } };
    }
    const sensor = symbol.catalog as SensorType;
    if (sensor.dim) return { ...base, type: quantity(sensor.dim) };
    return { ...base, type: { kind: 'enum', states: sensor.states! } };
  }

  private visitNeg(e: Neg): Typed | undefined {
    const typed = this.typeOf(e.operand);
    if (!typed) return undefined;
    if (typed.type.kind !== 'quantity') {
      this.report('S308', e.span, `Type mismatch: unary minus needs a number, but ${this.describe(typed)}.`);
      return undefined;
    }
    if (typeof e.operand.constant === 'number') e.constant = round6(-e.operand.constant);
    return { type: typed.type, bare: typed.bare, text: exprText(e) };
  }

  private visitArith(e: Arith): Typed | undefined {
    const left = this.typeOf(e.left);
    const right = this.typeOf(e.right);
    if (!left || !right) return undefined;
    const a = left.type;
    const b = right.type;

    if (a.kind === 'time' || b.kind === 'time') return this.timeArith(e, left, right);
    if (a.kind !== 'quantity' || b.kind !== 'quantity') {
      const bad = a.kind !== 'quantity' ? left : right;
      this.report('S308', e.span, `Type mismatch: arithmetic needs numbers, but ${this.describe(bad)}.`);
      return undefined;
    }
    if (this.usesFahrenheit(e.left) || this.usesFahrenheit(e.right)) {
      this.report('S310', e.span, 'Arithmetic on °F values is not supported.',
        'Write the values in °C. A °F literal in a sum is ambiguous between a temperature and a difference.');
      return undefined;
    }

    const result = e.op === '+' || e.op === '-' ? this.addSub(e, left, right, a.dim, b.dim) : this.mulDiv(e, left, right, a.dim, b.dim);
    if (!result) return undefined;
    this.foldConstant(e);
    return { ...result, text: exprText(e) };
  }

  private usesFahrenheit(e: Expr): boolean {
    if (e.kind === 'NumLit') return e.unit === 'F';
    if (e.kind === 'Ref') return this.table.get(e.name)?.unit === 'F';
    if (e.kind === 'Neg') return this.usesFahrenheit(e.operand);
    if (e.kind === 'Arith') return this.usesFahrenheit(e.left) || this.usesFahrenheit(e.right);
    return false;
  }

  private addSub(e: Arith, left: Typed, right: Typed, a: Dimension, b: Dimension): Typed | undefined {
    if (left.bare && right.bare) return { type: quantity('count'), bare: true, text: '' };
    if (left.bare) this.adopt(e.left, b, canonicalUnit(b));
    else if (right.bare) this.adopt(e.right, a, canonicalUnit(a));
    else if (a !== b) {
      this.report('S310', e.span, `Cannot ${e.op === '+' ? 'add' : 'subtract'} ${dimensionNoun(a)} and ${dimensionNoun(b)}.`);
      return undefined;
    }
    return { type: quantity(left.bare ? b : a), bare: false, text: '' };
  }

  private mulDiv(e: Arith, left: Typed, right: Typed, a: Dimension, b: Dimension): Typed | undefined {
    const rightIsCount = b === 'count';
    const leftIsCount = a === 'count';
    if (!rightIsCount && !(e.op === '*' && leftIsCount)) {
      this.report('S310', e.span, `Quantities can only be ${e.op === '*' ? 'multiplied' : 'divided'} by a plain number.`);
      return undefined;
    }
    if (e.op === '/' && e.right.constant === 0) {
      this.report('S324', e.right.span, 'Division by zero.');
      return undefined;
    }
    const dim = leftIsCount ? b : a;
    return { type: quantity(dim), bare: left.bare && right.bare, text: '' };
  }

  private foldConstant(e: Arith): void {
    const { constant: l } = e.left;
    const { constant: r } = e.right;
    if (typeof l !== 'number' || typeof r !== 'number') return;
    const value = round6(e.op === '+' ? l + r : e.op === '-' ? l - r : e.op === '*' ? l * r : l / r);
    if (!Number.isFinite(value) || Math.abs(value) > MAX_LITERAL) {
      // A bare expression is folded again after it adopts a unit; report it once.
      if (!this.oversized.has(e)) this.report('S324', e.span, 'This constant expression is too large.');
      this.oversized.add(e);
      return;
    }
    e.constant = value;
  }

  private timeArith(e: Arith, left: Typed, right: Typed): Typed | undefined {
    const duration = left.type.kind === 'time' ? right : left;
    const time = left.type.kind === 'time' ? e.left : e.right;
    const isDuration = duration.type.kind === 'quantity' && duration.type.dim === 'duration';
    if (!isDuration || (e.op !== '+' && e.op !== '-') || time.kind !== 'TimeLit' || left.type.kind !== 'time') {
      this.report('S319', e.span, 'Time arithmetic needs a literal time plus or minus a literal duration.');
      return undefined;
    }
    const seconds = e.right.constant;
    if (typeof seconds !== 'number') {
      this.report('S319', e.span, 'Time arithmetic needs a literal time plus or minus a literal duration.');
      return undefined;
    }
    const minutes = time.minutes + (e.op === '+' ? seconds : -seconds) / 60;
    if (minutes < 0 || minutes > 1439) {
      this.report('S319', e.span, `${exprText(e)} falls outside the day (00:00–23:59).`);
      return undefined;
    }
    e.constant = minutes;
    return { type: { kind: 'time' }, bare: false, text: exprText(e) };
  }

  /**
   * The implicit unit rule: a bare number takes the unit of what it meets.
   * The AST copy records that unit, so later phases see a normal quantity.
   */
  private adopt(e: Expr, dim: Dimension, unit: UnitName | undefined): void {
    if (dim === 'count') return;
    if (e.kind === 'NumLit') {
      if (unit !== undefined) e.unit = unit;
      e.constant = unit ? toCanonical(e.value, unit) : e.value;
      const display = unit ? (Object.values(UNIT_TABLE).find((u) => u.unit === unit)?.display ?? '') : '';
      this.report('W415', e.span, `${e.text} interpreted as ${e.text} ${display}.`.replace(' .', '.'));
    } else if (e.kind === 'Neg') {
      this.adopt(e.operand, dim, unit);
      if (typeof e.operand.constant === 'number') e.constant = round6(-e.operand.constant);
    } else if (e.kind === 'Arith') {
      if (unit === 'F') {
        this.report('S310', e.span, 'Arithmetic on °F values is not supported.');
        return;
      }
      this.adopt(e.left, dim, unit);
      if (e.op === '+' || e.op === '-') this.adopt(e.right, dim, unit);
      this.foldConstant(e);
    }
    e.valueType = quantity(dim);
    e.tag = typeTag(e.valueType);
  }

  // ---- scenario -----------------------------------------------------------

  private checkSimulation(sim: Simulation): void {
    this.recordReads = false;
    if (sim.step) this.checkDuration(sim.step, 'STEP');
    const from = sim.from ?? 0;
    const to = sim.to ?? 1439;
    const inWindow = (t: number): boolean => {
      if (from === to) return true; // a full 24 hours
      return from < to ? t >= from && t <= to : t >= from || t <= to;
    };
    for (const stmt of sim.stmts) {
      if (!inWindow(stmt.minutes)) {
        this.report('S322', stmt.span, `This time is outside the scenario window.`);
      }
      for (const assign of stmt.assigns) this.checkAssign(assign);
    }
  }

  private checkAssign(assign: SimAssign): void {
    const { target, value } = assign;
    const symbol = this.table.get(target.name);
    if (!symbol) {
      const sensors = this.table.ofKind('SENSOR').map((s) => s.displayName);
      this.report('S301', target.span, `Unknown sensor '${target.display}'. Declared sensors: ${sensors.join(', ') || 'none'}.`,
        this.suggestion(target.name, sensors));
      return;
    }
    if (symbol.name === 'DAY') {
      this.checkDayAssign(value);
      return;
    }
    if (symbol.kind !== 'SENSOR') {
      this.report('S323', target.span, `SIMULATE cannot assign ${symbol.name}: only sensors and DAY can be set.`,
        symbol.name === 'TIME' ? 'The scenario clock sets TIME.' : 'Devices change only through rules.');
      return;
    }
    symbol.useCount++;
    const sensor = symbol.catalog as SensorType;
    const typed = this.typeOf(value);
    if (!typed) return;
    if (value.constant === undefined) {
      this.report('S325', value.span, `A scenario value must be a constant; got '${exprText(value)}'.`);
      return;
    }
    if (sensor.dim) {
      this.matchDimension(typed, value, symbol, sensor.dim);
    } else if (typed.type.kind !== 'enum' || !sensor.states!.includes(String(value.constant))) {
      this.invalidState(symbol, symbol.name, exprText(value), sensor.states!, value.span);
    }
  }

  private checkDayAssign(value: Expr): void {
    const valid = value.kind === 'EnumLit' && (DAYS as readonly string[]).includes(value.value);
    if (valid) value.constant = (value as { value: string }).value;
    else this.report('S309', value.span, `${exprText(value)} is not a valid value for DAY. Valid: ${DAYS.join(', ')}.`);
  }
}

function canonicalUnit(dim: Dimension): UnitName | undefined {
  switch (dim) {
    case 'temperature':
      return 'C';
    case 'percent':
      return '%';
    case 'illuminance':
      return 'LUX';
    case 'colorTemp':
      return 'K';
    case 'duration':
      return 'S';
    case 'count':
      return undefined;
  }
}

