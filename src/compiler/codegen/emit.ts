import type { IrProgram } from '../ir/irgen';
import type { Operand, Quad } from '../ir/quads';
import { canonicalDisplay, toCanonical } from '../lexer/units';
import { round6 } from '../numeric';
import type { Program, Rule } from '../parser/ast';
import type { DeviceType, SensorType } from '../semantic/catalog';
import { ruleWrites, triggerReads, writeKey } from '../semantic/effects';
import { SymbolTable, type SymbolEntry } from '../semantic/symbols';
import type { Instr, ObjectDevice, ObjectFile, ObjectRule, ObjectScenario, ObjectSensor, Value } from './bytecode';

const CMP_OPCODE = {
  '>': 'CMP_GT', '>=': 'CMP_GE', '<': 'CMP_LT', '<=': 'CMP_LE', '==': 'CMP_EQ', '!=': 'CMP_NE',
} as const;

const ARITH_OPCODE = { '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV' } as const;

const DEFAULT_STEP_SECONDS = 60;
const LAST_MINUTE = 1439;

type TempDef = Extract<Quad, { kind: 'load' | 'arith' | 'neg' | 'cvt' }>;

function conversionResult(q: Extract<Quad, { kind: 'cvt' }>): number {
  const { value } = q.a as Extract<Operand, { kind: 'const' }>;
  switch (q.conversion) {
    case 'F_TO_C':
      return toCanonical(value as number, 'F');
    case 'MIN_TO_S':
      return toCanonical(value as number, 'MIN');
    case 'H_TO_S':
      return toCanonical(value as number, 'H');
    case 'TIME_TO_MIN': {
      const [hours, minutes] = String(value).split(':').map(Number) as [number, number];
      return round6(hours * 60 + minutes);
    }
  }
}

/**
 * Lowers quadruples to stack code. A temporary used once is computed where it is
 * used, which keeps the code a plain expression evaluation. A temporary used
 * more than once, which only O6 and BETWEEN create, gets a local slot, so a load
 * removed by O6 really is read once at run time.
 */
class RoutineEmitter {
  private readonly defs = new Map<string, TempDef>();
  private readonly uses = new Map<string, number>();
  private readonly slots = new Map<string, number>();

  constructor(
    private readonly quads: readonly Quad[],
    private readonly code: Instr[],
    private readonly strings: string[],
    private readonly pcOf: Map<number, number>,
    private readonly patches: { pc: number; quad: number }[],
  ) {
    for (const q of quads) {
      if ('t' in q) this.defs.set(q.t, q);
      for (const operand of operandsOf(q)) {
        if (operand.kind === 'temp') this.uses.set(operand.name, (this.uses.get(operand.name) ?? 0) + 1);
      }
    }
  }

  emit(): void {
    for (const q of this.quads) {
      this.pcOf.set(q.index, this.code.length);
      this.quad(q);
    }
  }

  private isShared(temp: string): boolean {
    return (this.uses.get(temp) ?? 0) > 1;
  }

  private operand(o: Operand): void {
    if (o.kind === 'const') {
      this.code.push(['PUSH', o.value]);
      return;
    }
    const slot = this.slots.get(o.name);
    if (slot !== undefined) this.code.push(['LOCAL', slot]);
    else this.compute(this.defs.get(o.name)!);
  }

  private compute(def: TempDef): void {
    switch (def.kind) {
      case 'load':
        this.code.push(['LOAD', def.name]);
        break;
      case 'arith':
        this.operand(def.a);
        this.operand(def.b);
        this.code.push([ARITH_OPCODE[def.op]]);
        break;
      case 'neg':
        this.operand(def.a);
        this.code.push(['NEG']);
        break;
      case 'cvt':
        // Conversions apply only to literals, so they are done here at compile time.
        this.code.push(['PUSH', conversionResult(def)]);
        break;
    }
  }

  private constantOf(o: Operand): number {
    if (o.kind === 'const') return o.value as number;
    return conversionResult(this.defs.get(o.name) as Extract<Quad, { kind: 'cvt' }>);
  }

  private jump(opcode: 'JMP' | 'JMP_IF_FALSE' | 'JMP_IF_TRUE', target: number | null): void {
    this.patches.push({ pc: this.code.length, quad: target! });
    this.code.push([opcode, 0]);
  }

  private quad(q: Quad): void {
    switch (q.kind) {
      case 'load':
      case 'arith':
      case 'neg':
      case 'cvt':
        if (this.isShared(q.t)) {
          this.compute(q);
          const slot = this.slots.size;
          this.slots.set(q.t, slot);
          this.code.push(['STORE', slot]);
        }
        break;
      case 'if':
        this.operand(q.a);
        this.operand(q.b);
        this.code.push([CMP_OPCODE[q.relop]]);
        this.jump(q.negate ? 'JMP_IF_FALSE' : 'JMP_IF_TRUE', q.target);
        break;
      case 'ifIn':
        this.operand(q.a);
        this.code.push(['IN_WINDOW', q.lo, q.hi]);
        this.jump(q.negate ? 'JMP_IF_FALSE' : 'JMP_IF_TRUE', q.target);
        break;
      case 'goto':
        this.jump('JMP', q.target);
        break;
      case 'edgeTrue':
        this.code.push(['EDGE_TRUE', q.ruleId, q.hold]);
        break;
      case 'edgeFalse':
        this.code.push(['EDGE_FALSE', q.ruleId]);
        break;
      case 'call':
        this.code.push(['CMD', q.op, q.device, q.origin ?? q.ruleId]);
        break;
      case 'set':
        this.operand(q.value);
        this.code.push(['SETA', q.device, q.attr, q.origin ?? q.ruleId]);
        break;
      case 'wait':
        this.code.push(['WAIT', this.constantOf(q.seconds)]);
        break;
      case 'notify': {
        let index = this.strings.indexOf(q.text);
        if (index < 0) index = this.strings.push(q.text) - 1;
        this.code.push(['NOTIFY', index, q.origin ?? q.ruleId]);
        break;
      }
      case 'ret':
        this.code.push(['HALT']);
        break;
    }
  }
}

function operandsOf(q: Quad): Operand[] {
  switch (q.kind) {
    case 'arith':
    case 'if':
      return [q.a, q.b];
    case 'neg':
    case 'cvt':
    case 'ifIn':
      return [q.a];
    case 'set':
      return [q.value];
    case 'wait':
      return [q.seconds];
    default:
      return [];
  }
}

function objectRule(rule: Rule, entry: number, table: SymbolTable): ObjectRule {
  const { trigger } = rule;
  const writes = [...new Set(ruleWrites(rule, table).map(writeKey))];
  const base = {
    id: rule.id, priority: rule.priority, entry, writes, source: { line: rule.span.line },
    ...(rule.name !== undefined && { name: rule.name }),
    ...(rule.mergedFrom && { mergedFrom: rule.mergedFrom }),
  };
  if (trigger.kind === 'State') return { ...base, kind: 'STATE', reads: [...triggerReads(rule)] };
  if (trigger.kind === 'Time') {
    return {
      ...base, kind: 'TIME', reads: [],
      time: { minutes: trigger.minutes, ...(trigger.days && { days: trigger.days }) },
    };
  }
  const threshold = trigger.value?.constant;
  return {
    ...base, kind: 'EVENT', reads: [],
    event: { source: trigger.source.name, event: trigger.event, ...(typeof threshold === 'number' && { threshold }) },
  };
}

function objectDevice(s: SymbolEntry): ObjectDevice {
  const type = s.catalog as DeviceType;
  const attributes: Record<string, Value> = {};
  const ranges: Record<string, readonly [number, number]> = {};
  for (const [name, attribute] of Object.entries(type.attributes)) {
    attributes[name] = attribute.initial;
    if (attribute.kind === 'number') ranges[name] = [attribute.min, attribute.max];
  }
  return {
    name: s.name, type: type.name, initialState: type.initialState, states: type.states, attributes, ranges,
    ...(s.room && { room: s.room }),
    ...(type.levelAttribute && { levelAttribute: type.levelAttribute }),
  };
}

function objectSensor(s: SymbolEntry): ObjectSensor {
  const type = s.catalog as SensorType;
  return {
    name: s.name, type: type.name, initial: type.initial,
    unit: type.dim ? canonicalDisplay(type.dim) : '',
    ...(s.room && { room: s.room }),
    ...(type.states && { states: type.states }),
    ...(type.plausible && { plausible: type.plausible }),
  };
}

function objectScenario(ast: Program): ObjectScenario | undefined {
  const { sim } = ast;
  if (!sim) return undefined;
  const from = sim.from ?? 0;
  const to = sim.to ?? LAST_MINUTE;
  const offset = (minutes: number): number => (minutes - from + 1440) % 1440;
  const events = [...sim.stmts]
    .sort((a, b) => offset(a.minutes) - offset(b.minutes))
    .map((stmt) => ({
      minutes: stmt.minutes,
      assigns: stmt.assigns.map((a) => ({ name: a.target.name, value: a.value.constant as Value })),
    }));
  return { from, to, stepSeconds: sim.step?.seconds ?? DEFAULT_STEP_SECONDS, events };
}

export function generateObject(ast: Program, program: IrProgram, symbols: readonly SymbolEntry[]): ObjectFile {
  const table = new SymbolTable();
  for (const symbol of symbols) table.add(symbol);

  const code: Instr[] = [];
  const strings: string[] = [];
  const pcOf = new Map<number, number>();
  const patches: { pc: number; quad: number }[] = [];

  const rules: ObjectRule[] = [];
  for (const routine of program.routines) {
    const quads = program.quads.slice(routine.start - 100, routine.end - 100);
    const entry = code.length;
    new RoutineEmitter(quads, code, strings, pcOf, patches).emit();
    const rule = ast.rules.find((r) => r.id === routine.ruleId)!;
    rules.push(objectRule(rule, entry, table));
  }

  // Backpatch once more, now from quad numbers to bytecode addresses.
  for (const { pc, quad } of patches) {
    const instr = code[pc]!;
    code[pc] = [instr[0], pcOf.get(quad) ?? code.length] as Instr;
  }

  const scenario = objectScenario(ast);
  return {
    version: 1,
    rooms: table.ofKind('ROOM').map((r) => r.name),
    devices: table.ofKind('DEVICE').map(objectDevice),
    sensors: table.ofKind('SENSOR').map(objectSensor),
    strings, rules, code,
    ...(scenario && { scenario }),
  };
}
