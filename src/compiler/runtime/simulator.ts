import type { ObjectFile, ObjectScenario, Value } from '../codegen/bytecode';
import type { Diagnostic } from '../diagnostics';
import { Scheduler, vmExecutor, type LogEntry, type RuleExecutor, type SimulatorState } from './scheduler';

const DEFAULT_START_MINUTES = 12 * 60;

export interface SimulationOutput {
  hasScenario: boolean;
  log: LogEntry[];
  final: SimulatorState;
  ruleCount: number;
}

function scenarioLength({ from, to }: ObjectScenario): number {
  return ((to - from + 1440) % 1440 || 1440) * 60;
}

function secondsAfterStart({ from }: ObjectScenario, minutes: number): number {
  return ((minutes - from + 1440) % 1440) * 60;
}

/**
 * The live model behind the Output panel. In live mode each slider movement is
 * one tick. In scenario mode the SIMULATE timeline drives the same engine.
 */
export class Session {
  private readonly scheduler: Scheduler;
  private readonly scenario: ObjectScenario | undefined;
  private nextEvent = 0;

  constructor(object: ObjectFile, executor: RuleExecutor = vmExecutor(object), scenarioMode = true) {
    this.scenario = scenarioMode ? object.scenario : undefined;
    this.scheduler = new Scheduler(object, executor, this.scenario?.from ?? DEFAULT_START_MINUTES);
    this.applyStartValues();
    this.scheduler.sync();
  }

  /** Assignments at the first scenario minute set the scene, before the sync. */
  private applyStartValues(): void {
    const first = this.scenario?.events[0];
    if (first && secondsAfterStart(this.scenario!, first.minutes) === 0) {
      this.scheduler.presetValues(first.assigns);
      this.nextEvent = 1;
    }
  }

  get state(): SimulatorState {
    return this.scheduler.snapshot();
  }

  get log(): readonly LogEntry[] {
    return this.scheduler.log;
  }

  get diagnostics(): readonly Diagnostic[] {
    return this.scheduler.diagnostics;
  }

  get hasScenario(): boolean {
    return this.scenario !== undefined;
  }

  get stepSeconds(): number {
    return this.scenario?.stepSeconds ?? 60;
  }

  get lengthSeconds(): number {
    return this.scenario ? scenarioLength(this.scenario) : 0;
  }

  get finished(): boolean {
    return !this.scenario || this.scheduler.halted || this.scheduler.elapsedSeconds >= this.lengthSeconds;
  }

  /** Scenario events as offsets, for the timeline. */
  get timeline(): readonly { seconds: number; minutes: number; text: string }[] {
    const scenario = this.scenario;
    if (!scenario) return [];
    return scenario.events.map((e) => ({
      seconds: secondsAfterStart(scenario, e.minutes), minutes: e.minutes,
      text: e.assigns.map((a) => `${a.name} = ${a.value}`).join(', '),
    }));
  }

  /** Advances the scenario by one STEP. */
  step(): void {
    const scenario = this.scenario;
    if (!scenario || this.finished) return;
    const target = Math.min(this.scheduler.elapsedSeconds + this.stepSeconds, this.lengthSeconds);
    for (;;) {
      const event = scenario.events[this.nextEvent];
      const at = event && secondsAfterStart(scenario, event.minutes);
      if (!event || at === undefined || at > target) break;
      this.scheduler.advanceTo(at);
      this.nextEvent++;
      this.scheduler.input(event.assigns);
    }
    this.scheduler.advanceTo(target);
  }

  runToEnd(): void {
    while (!this.finished) this.step();
  }

  setSensor(name: string, value: Value): void {
    this.scheduler.input([{ name, value }]);
  }

  setDay(day: string): void {
    this.scheduler.input([{ name: 'DAY', value: day }]);
  }

  /**
   * Moves the clock. Forward runs everything crossed on the way, including AT
   * rules. Backward has no past to replay, so the clock simply rests at the time.
   */
  setTime(minutes: number): void {
    const current = this.scheduler.minutes;
    const delta = (minutes - current + 1440) % 1440;
    if (minutes > current) this.scheduler.advanceTo(this.scheduler.elapsedSeconds + delta * 60);
    else if (minutes < current) this.scheduler.jumpBackTo(minutes);
  }
}

/** The Simulation stage: runs the SIMULATE block, or just the initial sync. */
export function simulate(object: ObjectFile): { output: SimulationOutput; diagnostics: Diagnostic[] } {
  const session = new Session(object);
  session.runToEnd();
  return {
    output: {
      hasScenario: session.hasScenario, log: [...session.log], final: session.state, ruleCount: object.rules.length,
    },
    diagnostics: [...session.diagnostics],
  };
}
