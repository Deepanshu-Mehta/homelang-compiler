import type { ObjectDevice, ObjectFile, ObjectRule, Value } from '../codegen/bytecode';
import { makeDiagnostic, type Diagnostic } from '../diagnostics';
import { formatMinutes, formatNumber } from '../numeric';
import type { PowerOp } from '../parser/ast';
import { DAYS, WEEKDAYS, WEEKENDS } from '../semantic/catalog';
import { newFrame, run, type Frame, type VmHost } from './vm';

export const MAX_CASCADE_DEPTH = 16;
const DAY_SECONDS = 86400;
/** R504: this many power changes inside the window counts as oscillation. */
const OSCILLATION_FLIPS = 4;
const OSCILLATION_WINDOW_SECONDS = 300;

/** A running rule. `resume` returns seconds to sleep, or null when finished. */
export interface Activation {
  resume(): number | null;
}

/** Runs rule bodies. The VM and the AST interpreter both implement this. */
export interface RuleExecutor {
  start(ruleId: string, host: VmHost): Activation;
}

function resumeFrame(frame: Frame): Frame {
  frame.status = 'running';
  return frame;
}

const isWaiting = (frame: Frame): boolean => frame.status === 'waiting';

export function vmExecutor(object: ObjectFile): RuleExecutor {
  return {
    start(ruleId, host) {
      const rule = object.rules.find((r) => r.id === ruleId)!;
      const frame = newFrame(ruleId, rule.entry);
      return {
        resume() {
          run(object.code, object.strings, resumeFrame(frame), host);
          return isWaiting(frame) ? frame.waitSeconds : null;
        },
      };
    },
  };
}

export type LogKind = 'fired' | 'noelse' | 'override' | 'nochange' | 'busy' | 'sensor' | 'info' | 'warning' | 'error';

export interface LogEntry {
  /** "22:17", or "22:17:30" off the minute. */
  time: string;
  kind: LogKind;
  text: string;
  /** Source line of the rule, for highlighting it in the editor. */
  line?: number;
  ruleId?: string;
  device?: string;
}

export interface DeviceState {
  name: string;
  type: string;
  room?: string;
  state: string;
  attributes: Record<string, Value>;
}

export interface SensorState {
  name: string;
  type: string;
  room?: string;
  unit: string;
  value: Value;
  states?: readonly string[];
  plausible?: readonly [number, number];
}

export interface SimulatorState {
  /** Minutes after midnight. */
  minutes: number;
  day: string;
  elapsedSeconds: number;
  devices: DeviceState[];
  sensors: SensorState[];
  notifications: { time: string; text: string }[];
  halted: boolean;
}

interface RuleState {
  /** The committed rule state: true only after THEN actually fired. */
  committed: boolean;
  holdStart: number | null;
  activation: Activation | null;
}

interface Timer {
  at: number;
  ruleId: string;
  kind: 'resume' | 'hold';
}

interface Command {
  key: string;
  origin: string;
  /** Shown in the log; empty for the power change implied by a level SET. */
  text: string;
  apply: () => void;
}

interface Happening {
  source: string;
  event: string;
}

const POWER_RESULT: Readonly<Record<PowerOp, string>> = {
  TURN_ON: 'ON', TURN_OFF: 'OFF', TOGGLE: '', LOCK: 'LOCKED', UNLOCK: 'UNLOCKED', OPEN: 'OPEN', CLOSE: 'CLOSED',
};

const EVENT_FOR_STATE: Readonly<Record<string, string>> = {
  ON: 'TURNS_ON', OFF: 'TURNS_OFF', LOCKED: 'LOCKS', UNLOCKED: 'UNLOCKS', OPEN: 'OPENS', CLOSED: 'CLOSES',
  DETECTED: 'DETECTED', CLEAR: 'CLEARS',
};

/**
 * The engine, driven as a discrete-event simulation: time jumps to the next
 * thing that can matter (a minute, a WAIT ending, a FOR hold ending). One round
 * runs every rule that was triggered, resolves their commands, commits them, and
 * treats each device change as an event for the next round, up to depth 16.
 */
export class Scheduler {
  private readonly sensors = new Map<string, Value>();
  private readonly devices = new Map<string, DeviceState>();
  private readonly deviceInfo = new Map<string, ObjectDevice>();
  private readonly rules = new Map<string, RuleState>();
  private readonly timers: Timer[] = [];
  private readonly flips = new Map<string, number[]>();
  private readonly oscillating = new Set<string>();
  readonly notifications: SimulatorState['notifications'] = [];
  readonly log: LogEntry[] = [];
  readonly diagnostics: Diagnostic[] = [];

  /** Seconds since the session began. */
  private now = 0;
  private startMinutes: number;
  private dayIndex = 0;
  halted = false;

  private readonly host: VmHost;
  private queue: Command[] = [];

  constructor(private readonly object: ObjectFile, private readonly executor: RuleExecutor, startMinutes = 0) {
    this.startMinutes = startMinutes;
    for (const s of object.sensors) this.sensors.set(s.name, s.initial);
    for (const d of object.devices) {
      this.deviceInfo.set(d.name, d);
      this.devices.set(d.name, {
        name: d.name, type: d.type, state: d.initialState, attributes: { ...d.attributes },
        ...(d.room && { room: d.room }),
      });
    }
    for (const r of object.rules) this.rules.set(r.id, { committed: false, holdStart: null, activation: null });
    this.host = this.makeHost();
  }

  // ---- clock --------------------------------------------------------------

  get minutes(): number {
    return Math.floor((this.startMinutes * 60 + this.now) / 60) % 1440;
  }

  get day(): string {
    return DAYS[this.dayIndex % 7]!;
  }

  private timeText(): string {
    const seconds = (this.startMinutes * 60 + this.now) % 60;
    const base = formatMinutes(this.minutes);
    return seconds ? `${base}:${String(seconds).padStart(2, '0')}` : base;
  }

  private write(kind: LogKind, text: string, extra: Partial<LogEntry> = {}): void {
    this.log.push({ time: this.timeText(), kind, text, ...extra });
  }

  // ---- what rules can touch ----------------------------------------------

  private makeHost(): VmHost {
    return {
      read: (name) => {
        if (name === 'TIME') return this.minutes;
        if (name === 'DAY') return this.day;
        return this.devices.get(name)?.state ?? this.sensors.get(name) ?? 0;
      },
      readAttribute: (device, attr) => this.devices.get(device)?.attributes[attr] ?? 0,
      edgeTrue: (ruleId, hold) => this.edgeTrue(ruleId, hold),
      edgeFalse: (ruleId) => this.edgeFalse(ruleId),
      command: (op, device, origin) => this.queueCommand(op, device, origin),
      setAttribute: (device, attr, value, origin) => this.queueSet(device, attr, value, origin),
      notify: (text, origin) => {
        this.queue.push({ key: `notify/${this.queue.length}`, origin, text: `NOTIFY "${text}"`, apply: () => {
          this.notifications.push({ time: this.timeText(), text });
        } });
      },
      fault: (message) => this.fail('R502', message),
    };
  }

  /**
   * ELSE fires only on a true→false change of the committed state. A condition
   * that dropped during a FOR hold cancels the hold and runs neither branch.
   */
  private edgeTrue(ruleId: string, hold: number): boolean {
    const state = this.rules.get(ruleId)!;
    if (state.committed) return false;
    if (hold > 0) {
      if (state.holdStart === null) {
        state.holdStart = this.now;
        this.addTimer(this.now + hold, ruleId, 'hold');
        return false;
      }
      if (this.now - state.holdStart < hold) return false;
    }
    state.holdStart = null;
    state.committed = true;
    return true;
  }

  private edgeFalse(ruleId: string): boolean {
    const state = this.rules.get(ruleId)!;
    state.holdStart = null;
    if (!state.committed) return false;
    state.committed = false;
    const rule = this.object.rules.find((r) => r.id === ruleId)!;
    for (const id of rule.noElse) {
      const line = this.ruleInfo(id)?.line;
      this.write('noelse', `${id} condition became false; no ELSE`, { ruleId: id, ...(line !== undefined && { line }) });
    }
    return true;
  }

  private addTimer(at: number, ruleId: string, kind: Timer['kind']): void {
    this.timers.push({ at, ruleId, kind });
  }

  private ruleInfo(id: string): { name?: string; line: number; priority: number } | undefined {
    for (const rule of this.object.rules) {
      if (rule.id === id) return { ...(rule.name !== undefined && { name: rule.name }), line: rule.source.line, priority: rule.priority };
      const alias = rule.aliases?.[id];
      if (alias) return { ...alias, priority: rule.priority };
    }
    return undefined;
  }

  private queueCommand(op: PowerOp, device: string, origin: string): void {
    const text = `${op} ${device}`;
    this.queue.push({ key: device, origin, text, apply: () => this.applyPower(op, device) });
  }

  private queueSet(device: string, attr: string, value: Value, origin: string): void {
    const info = this.deviceInfo.get(device)!;
    let stored = value;
    const range = info.ranges[attr];
    const outOfRange = range !== undefined && typeof value === 'number' && (value < range[0] || value > range[1]);
    if (outOfRange) stored = Math.min(range[1], Math.max(range[0], value as number));
    const shown = typeof stored === 'number' ? formatNumber(stored) : stored;
    this.queue.push({
      key: `${device}.${attr}`, origin, text: `SET ${device} ${attr} ${shown}`,
      apply: () => {
        // Logged here, not when queued: the log records effects, and only the
        // command that wins is applied, however many copies the rule issued.
        if (outOfRange) this.write('warning', `R503: ${device} ${attr} clamped to ${shown}; the computed value was ${formatNumber(value as number)}.`);
        this.devices.get(device)!.attributes[attr] = stored;
      },
    });
    if (info.levelAttribute === attr) {
      const positive = info.states.includes('ON') ? 'ON' : 'OPEN';
      const negative = info.states.includes('OFF') ? 'OFF' : 'CLOSED';
      this.queue.push({
        key: device, origin, text: '',
        apply: () => this.setPower(device, stored === 0 ? negative : positive),
      });
    }
  }

  private setPower(device: string, state: string): void {
    this.devices.get(device)!.state = state;
  }

  private applyPower(op: PowerOp, device: string): void {
    const current = this.devices.get(device)!;
    const info = this.deviceInfo.get(device)!;
    const result = op === 'TOGGLE' ? (current.state === 'ON' ? 'OFF' : 'ON') : POWER_RESULT[op];
    current.state = result;
    const level = info.levelAttribute;
    if (!level) return;
    if (op === 'OPEN') current.attributes[level] = 100;
    else if (op === 'CLOSE') current.attributes[level] = 0;
    else if (result === 'ON' && current.attributes[level] === 0) current.attributes[level] = info.attributes[level]!;
  }

  private fail(code: 'R501' | 'R502', message: string): void {
    this.write('error', `${code}: ${message}`);
    this.diagnostics.push(makeDiagnostic(code, { line: 1, col: 1, start: 0, end: 0 }, message));
    if (code === 'R501') this.halted = true;
  }

  // ---- one round ----------------------------------------------------------

  private isTriggered(rule: ObjectRule, changed: ReadonlySet<string>, happenings: readonly Happening[], minuteEvent: boolean): boolean {
    switch (rule.kind) {
      case 'STATE':
        return rule.reads.some((name) => changed.has(name));
      case 'EVENT':
        return happenings.some((h) => h.source === rule.event!.source && h.event === this.eventKey(rule));
      case 'TIME':
        return minuteEvent && this.timeMatches(rule);
    }
  }

  private eventKey(rule: ObjectRule): string {
    const { event, threshold } = rule.event!;
    return threshold === undefined ? event : `${event}:${threshold}`;
  }

  private timeMatches(rule: ObjectRule): boolean {
    const { minutes, days } = rule.time!;
    if (minutes !== this.minutes) return false;
    if (!days) return true;
    return days.some((d) => d === this.day ||
      (d === 'WEEKDAYS' && WEEKDAYS.includes(this.day)) ||
      (d === 'WEEKENDS' && WEEKENDS.includes(this.day)));
  }

  private runActivation(rule: ObjectRule, state: RuleState, resync: Set<string>, wasSuspended: boolean): void {
    const sleep = state.activation!.resume();
    if (sleep === null) {
      state.activation = null;
      // A state rule that sat in WAIT may have missed an edge while it was busy.
      if (wasSuspended && rule.kind === 'STATE') resync.add(rule.id);
    } else {
      this.addTimer(this.now + sleep, rule.id, 'resume');
    }
  }

  /** Runs every triggered rule, then commits. Returns the next round's inputs. */
  private round(changed: ReadonlySet<string>, happenings: readonly Happening[], due: ReadonlySet<string>, resumed: ReadonlySet<string>, minuteEvent: boolean, depth: number): void {
    if (depth > MAX_CASCADE_DEPTH) {
      this.fail('R501', `Possible infinite loop: stopped at cascade depth ${MAX_CASCADE_DEPTH}.`);
      return;
    }
    this.queue = [];
    const resync = new Set<string>();

    for (const rule of this.object.rules) {
      const state = this.rules.get(rule.id)!;
      if (resumed.has(rule.id)) {
        this.runActivation(rule, state, resync, true);
        continue;
      }
      const triggered = due.has(rule.id) || this.isTriggered(rule, changed, happenings, minuteEvent);
      if (!triggered) continue;
      if (state.activation) {
        // WAIT in progress: the rule behaves like Home Assistant's `single` mode.
        if (rule.kind !== 'STATE') this.write('busy', `${rule.id} busy; trigger ignored`, { ruleId: rule.id, line: rule.source.line });
        continue;
      }
      state.activation = this.executor.start(rule.id, this.host);
      this.runActivation(rule, state, resync, false);
    }

    const { changes, events } = this.commit();
    if (this.halted || (changes.size === 0 && resync.size === 0)) return;
    this.round(changes, events, resync, new Set(), false, changes.size > 0 ? depth + 1 : depth);
  }

  /** The conflict policy: highest priority wins, then the later rule in source order. */
  private commit(): { changes: Set<string>; events: Happening[] } {
    const queue = this.queue;
    this.queue = [];

    const sourceOrder = (origin: string): number => {
      const n = Number(origin.slice(1));
      return Number.isNaN(n) ? 0 : n;
    };
    const rank = (c: Command): [number, number] => [this.ruleInfo(c.origin)?.priority ?? 1, sourceOrder(c.origin)];

    const winners = new Map<string, Command>();
    const overridden = new Map<string, string>();
    for (const command of queue) {
      const current = winners.get(command.key);
      if (current && current.origin !== command.origin) {
        const [p1, o1] = rank(current);
        const [p2, o2] = rank(command);
        const later = p2 > p1 || (p2 === p1 && o2 > o1);
        const [winner, loser] = later ? [command, current] : [current, command];
        overridden.set(`${winner.origin}/${loser.origin}/${command.key.split('.')[0]}`,
          `${winner.origin} overrode ${loser.origin} on ${command.key.split('.')[0]}`);
        if (!later) continue;
      }
      winners.set(command.key, command);
    }

    this.logFired(queue);
    for (const text of overridden.values()) this.write('override', text);

    const before = new Map([...this.devices].map(([name, d]) => [name, d.state]));
    for (const command of queue) {
      if (winners.get(command.key) === command) command.apply();
    }
    return this.detectChanges(before, queue, winners);
  }

  /** Within one rule the last command for a target stands, so only that one is listed. */
  private logFired(queue: readonly Command[]): void {
    const origins = [...new Set(queue.map((c) => c.origin))];
    for (const origin of origins) {
      const mine = queue.filter((c) => c.origin === origin);
      const texts = mine.filter((c, i) => c.text && !mine.slice(i + 1).some((later) => later.key === c.key && later.text));
      if (texts.length === 0) continue;
      const info = this.ruleInfo(origin);
      const named = info?.name !== undefined ? ` "${info.name}"` : '';
      this.write('fired', `Rule ${origin}${named} fired: ${texts.map((c) => c.text).join(', ')}`, {
        ruleId: origin, ...(info && { line: info.line }),
      });
    }
  }

  private detectChanges(before: ReadonlyMap<string, string>, queue: readonly Command[], winners: ReadonlyMap<string, Command>): { changes: Set<string>; events: Happening[] } {
    const changes = new Set<string>();
    const events: Happening[] = [];
    for (const [name, device] of this.devices) {
      const previous = before.get(name)!;
      if (device.state !== previous) {
        changes.add(name);
        events.push({ source: name, event: EVENT_FOR_STATE[device.state] ?? 'CHANGES' });
        this.noteFlip(name);
      } else if (winners.has(name) && queue.some((c) => c.key === name && c.text)) {
        this.write('nochange', `${name}: no change (already ${device.state})`, { device: name });
      }
    }
    return { changes, events };
  }

  /** R504: a device switching back and forth quickly. */
  private noteFlip(device: string): void {
    const recent = (this.flips.get(device) ?? []).filter((t) => this.now - t < OSCILLATION_WINDOW_SECONDS);
    recent.push(this.now);
    this.flips.set(device, recent);
    if (recent.length >= OSCILLATION_FLIPS) {
      if (!this.oscillating.has(device)) {
        this.oscillating.add(device);
        this.write('warning', `R504: ${device} changed ${recent.length} times in 5 minutes.`, { device });
      }
    } else {
      this.oscillating.delete(device);
    }
  }

  // ---- inputs -------------------------------------------------------------

  private sensorHappenings(name: string, previous: Value, value: Value): Happening[] {
    const list: Happening[] = [{ source: name, event: 'CHANGES' }];
    if (typeof value === 'string') {
      const event = EVENT_FOR_STATE[value];
      if (event) list.push({ source: name, event });
      return list;
    }
    for (const rule of this.object.rules) {
      const trigger = rule.event;
      if (trigger?.source !== name || trigger.threshold === undefined) continue;
      const { threshold } = trigger;
      if (trigger.event === 'RISES_ABOVE' && (previous as number) <= threshold && value > threshold) {
        list.push({ source: name, event: `RISES_ABOVE:${threshold}` });
      }
      if (trigger.event === 'FALLS_BELOW' && (previous as number) >= threshold && value < threshold) {
        list.push({ source: name, event: `FALLS_BELOW:${threshold}` });
      }
    }
    return list;
  }

  private assign(assignments: readonly { name: string; value: Value }[]): { changed: Set<string>; happenings: Happening[] } {
    const changed = new Set<string>();
    const happenings: Happening[] = [];
    for (const { name, value } of assignments) {
      if (name === 'DAY') {
        const index = DAYS.indexOf(value as (typeof DAYS)[number]);
        if (this.dayIndex % 7 !== index) {
          this.dayIndex = index;
          changed.add('DAY');
          this.write('sensor', `DAY = ${value}`);
        }
        continue;
      }
      const previous = this.sensors.get(name);
      if (previous === value || previous === undefined) continue;
      this.sensors.set(name, value);
      changed.add(name);
      happenings.push(...this.sensorHappenings(name, previous, value));
      const unit = this.object.sensors.find((s) => s.name === name)?.unit;
      this.write('sensor', `${name} = ${typeof value === 'number' ? formatNumber(value) : value}${unit ? ` ${unit}` : ''}`);
    }
    return { changed, happenings };
  }

  /** Sets values before anything runs. Initial assignments raise no events. */
  presetValues(assignments: readonly { name: string; value: Value }[]): void {
    for (const { name, value } of assignments) {
      if (name === 'DAY') this.dayIndex = DAYS.indexOf(value as (typeof DAYS)[number]);
      else this.sensors.set(name, value);
    }
  }

  /** Initial sync: every state rule runs once, and AT rules for this minute fire. */
  sync(): void {
    this.write('info', `Initial sync at ${formatMinutes(this.minutes)}`);
    const all = new Set(this.object.rules.filter((r) => r.kind === 'STATE').map((r) => r.id));
    this.round(new Set(), [], all, new Set(), true, 0);
  }

  /** One tick caused by an outside change, such as a slider. */
  input(assignments: readonly { name: string; value: Value }[]): void {
    if (this.halted) return;
    const { changed, happenings } = this.assign(assignments);
    if (changed.size > 0) this.round(changed, happenings, new Set(), new Set(), false, 0);
  }

  /** Time of the next timer, if any is due by `limit`. */
  private nextTimerAt(limit: number): number | undefined {
    const times = this.timers.map((t) => t.at).filter((t) => t <= limit);
    return times.length ? Math.min(...times) : undefined;
  }

  /**
   * Moves the clock forward to `target`, stopping at every minute, WAIT end and
   * hold end on the way. AT rules therefore fire even with a large STEP.
   */
  advanceTo(target: number): void {
    while (!this.halted && this.now < target) {
      const nextMinute = this.now + (60 - (this.startMinutes * 60 + this.now) % 60);
      const next = Math.min(target, nextMinute, this.nextTimerAt(target) ?? target);
      this.tickAt(next);
    }
  }

  private tickAt(time: number): void {
    const previousMinute = this.minutes;
    const wrapped = time - this.now > 0 && (this.startMinutes * 60 + time) % DAY_SECONDS < (this.startMinutes * 60 + this.now) % DAY_SECONDS;
    this.now = time;
    const changed = new Set<string>();
    if (wrapped) {
      this.dayIndex++;
      changed.add('DAY');
    }
    const minuteChanged = this.minutes !== previousMinute;
    if (minuteChanged) changed.add('TIME');

    const dueTimers = this.timers.filter((t) => t.at <= this.now);
    for (const timer of dueTimers) this.timers.splice(this.timers.indexOf(timer), 1);
    const resumed = new Set(dueTimers.filter((t) => t.kind === 'resume').map((t) => t.ruleId));
    const due = new Set(dueTimers.filter((t) => t.kind === 'hold').map((t) => t.ruleId));
    if (changed.size > 0 || resumed.size > 0 || due.size > 0) {
      this.round(changed, [], due, resumed, minuteChanged, 0);
    }
  }

  /**
   * Scrubbing backward: the clock rests at the new time and rules re-evaluate,
   * but no AT rule fires, because nothing in the past is replayed.
   */
  jumpBackTo(minutes: number): void {
    if (this.halted) return;
    const seconds = (this.startMinutes * 60 + this.now) % DAY_SECONDS;
    this.startMinutes -= (seconds - minutes * 60) / 60;
    this.round(new Set(['TIME']), [], new Set(), new Set(), false, 0);
  }

  get elapsedSeconds(): number {
    return this.now;
  }

  snapshot(): SimulatorState {
    return {
      minutes: this.minutes, day: this.day, elapsedSeconds: this.now, halted: this.halted,
      devices: [...this.devices.values()].map((d) => ({ ...d, attributes: { ...d.attributes } })),
      sensors: this.object.sensors.map((s) => ({
        name: s.name, type: s.type, unit: s.unit, value: this.sensors.get(s.name)!,
        ...(s.room && { room: s.room }),
        ...(s.states && { states: s.states }),
        ...(s.plausible && { plausible: s.plausible }),
      })),
      notifications: [...this.notifications],
    };
  }
}
