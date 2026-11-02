import type { ObjectFile, Value } from '../codegen/bytecode';
import { newFrame, step, type Frame, type VmHost } from './vm';

export interface DebugEffect {
  pc: number;
  text: string;
}

export interface DebugState {
  frame: Frame;
  effects: DebugEffect[];
}

/**
 * Runs one rule's routine under the UI's control, against values the user picks.
 * Edge state starts false, as at initial sync, unless `wasTrue` says otherwise.
 */
export class VmDebugger {
  readonly frame: Frame;
  readonly effects: DebugEffect[] = [];
  private committed: boolean;

  constructor(
    private readonly object: ObjectFile,
    ruleId: string,
    private readonly values: Readonly<Record<string, Value>>,
    wasTrue = false,
  ) {
    const rule = object.rules.find((r) => r.id === ruleId)!;
    this.frame = newFrame(ruleId, rule.entry);
    this.committed = wasTrue;
  }

  private note(text: string): void {
    this.effects.push({ pc: this.frame.pc - 1, text });
  }

  private readonly host: VmHost = {
    read: (name) => {
      const value = this.values[name];
      if (value !== undefined) return value;
      const device = this.object.devices.find((d) => d.name === name);
      if (device) return device.initialState;
      return this.object.sensors.find((s) => s.name === name)?.initial ?? 0;
    },
    readAttribute: (device, attr) => this.object.devices.find((d) => d.name === device)?.attributes[attr] ?? 0,
    edgeTrue: (ruleId, hold) => {
      if (this.committed) {
        this.note(`${ruleId} was already true, so nothing fires`);
        return false;
      }
      this.committed = true;
      this.note(hold ? `${ruleId} became true (the scheduler would hold it ${hold} s)` : `${ruleId} went false → true, so THEN runs`);
      return true;
    },
    edgeFalse: (ruleId) => {
      if (!this.committed) {
        this.note(`${ruleId} was already false, so nothing fires`);
        return false;
      }
      this.committed = false;
      this.note(`${ruleId} went true → false, so ELSE runs`);
      return true;
    },
    command: (op, device) => this.note(`${op} ${device}`),
    setAttribute: (device, attr, value) => this.note(`SET ${device} ${attr} = ${value}`),
    notify: (text) => this.note(`NOTIFY "${text}"`),
    fault: (message) => this.note(`R502: ${message}`),
  };

  get done(): boolean {
    return this.frame.status !== 'running';
  }

  step(): void {
    if (!this.done) step(this.object.code, this.object.strings, this.frame, this.host);
  }
}
