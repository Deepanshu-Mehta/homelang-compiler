import type { Instr, Value } from '../codegen/bytecode';
import type { PowerOp } from '../parser/ast';
import { round6 } from '../numeric';

/** What the VM needs from the world. The scheduler implements it. */
export interface VmHost {
  /** A sensor or device state, from the current snapshot. */
  read(name: string): Value;
  readAttribute(device: string, attr: string): Value;
  /** False means the rule must stop here. See `EDGE_TRUE` in the scheduler. */
  edgeTrue(ruleId: string, holdSeconds: number): boolean;
  edgeFalse(ruleId: string): boolean;
  command(op: PowerOp, device: string, origin: string): void;
  setAttribute(device: string, attr: string, value: Value, origin: string): void;
  notify(text: string, origin: string): void;
  /** Division by zero or a non-finite result. */
  fault(message: string): void;
}

export type FrameStatus = 'running' | 'waiting' | 'halted';

/** One activation of a rule's routine. It survives a WAIT. */
export interface Frame {
  ruleId: string;
  pc: number;
  stack: Value[];
  locals: Value[];
  status: FrameStatus;
  /** Seconds left to sleep, when status is 'waiting'. */
  waitSeconds: number;
}

export function newFrame(ruleId: string, entry: number): Frame {
  return { ruleId, pc: entry, stack: [], locals: [], status: 'running', waitSeconds: 0 };
}

/** The circular time test: [lo, hi), wrapping midnight when hi < lo. */
export function inWindow(t: number, lo: number, hi: number): boolean {
  if (lo === hi) return false;
  return lo < hi ? t >= lo && t < hi : t >= lo || t < hi;
}

function compare(opcode: string, a: Value, b: Value): boolean {
  switch (opcode) {
    case 'CMP_GT': return a > b;
    case 'CMP_GE': return a >= b;
    case 'CMP_LT': return a < b;
    case 'CMP_LE': return a <= b;
    case 'CMP_EQ': return a === b;
    default: return a !== b;
  }
}

/** True and false are 1 and 0 on the stack, so every stack slot is a Value. */
const toBool = (b: boolean): number => (b ? 1 : 0);

function arithmetic(opcode: string, a: number, b: number): number {
  switch (opcode) {
    case 'ADD': return round6(a + b);
    case 'SUB': return round6(a - b);
    case 'MUL': return round6(a * b);
    default: return b === 0 ? Number.NaN : round6(a / b);
  }
}

/** Executes exactly one instruction, which is what the debugger needs. */
export function step(code: readonly Instr[], strings: readonly string[], frame: Frame, host: VmHost): void {
  const instr = code[frame.pc]!;
  const { stack } = frame;
  const pop = (): Value => stack.pop()!;
  frame.pc++;

  switch (instr[0]) {
    case 'PUSH':
      stack.push(instr[1]);
      break;
    case 'LOAD':
      stack.push(host.read(instr[1]));
      break;
    case 'LOADA':
      stack.push(host.readAttribute(instr[1], instr[2]));
      break;
    case 'STORE':
      frame.locals[instr[1]] = pop();
      break;
    case 'LOCAL':
      stack.push(frame.locals[instr[1]]!);
      break;
    case 'ADD':
    case 'SUB':
    case 'MUL':
    case 'DIV': {
      const b = pop() as number;
      const a = pop() as number;
      const result = arithmetic(instr[0], a, b);
      if (!Number.isFinite(result)) {
        host.fault(`Division by zero or an overflow in rule ${frame.ruleId}.`);
        frame.status = 'halted';
        return;
      }
      stack.push(result);
      break;
    }
    case 'NEG':
      stack.push(round6(-(pop() as number)));
      break;
    case 'CMP_GT':
    case 'CMP_GE':
    case 'CMP_LT':
    case 'CMP_LE':
    case 'CMP_EQ':
    case 'CMP_NE': {
      const b = pop();
      const a = pop();
      stack.push(toBool(compare(instr[0], a, b)));
      break;
    }
    case 'IN_WINDOW':
      stack.push(toBool(inWindow(pop() as number, instr[1], instr[2])));
      break;
    case 'JMP':
      frame.pc = instr[1];
      break;
    case 'JMP_IF_FALSE':
      if (pop() === 0) frame.pc = instr[1];
      break;
    case 'JMP_IF_TRUE':
      if (pop() !== 0) frame.pc = instr[1];
      break;
    case 'EDGE_TRUE':
      if (!host.edgeTrue(instr[1], instr[2])) frame.status = 'halted';
      break;
    case 'EDGE_FALSE':
      if (!host.edgeFalse(instr[1])) frame.status = 'halted';
      break;
    case 'CMD':
      host.command(instr[1], instr[2], instr[3]);
      break;
    case 'SETA':
      host.setAttribute(instr[1], instr[2], pop(), instr[3]);
      break;
    case 'WAIT':
      frame.status = 'waiting';
      frame.waitSeconds = instr[1];
      break;
    case 'NOTIFY':
      host.notify(strings[instr[1]]!, instr[2]);
      break;
    case 'HALT':
      frame.status = 'halted';
      break;
  }
}

/** Runs until the routine halts or suspends in WAIT. */
export function run(code: readonly Instr[], strings: readonly string[], frame: Frame, host: VmHost): void {
  while (frame.status === 'running') step(code, strings, frame, host);
}
