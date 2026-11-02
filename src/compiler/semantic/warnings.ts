import { makeDiagnostic, type Diagnostic, type DiagnosticCode, type Span } from '../diagnostics';
import { canonicalDisplay } from '../lexer/units';
import { formatNumber } from '../numeric';
import type { Action, Between, Compare, Cond, Expr, Program, Rule } from '../parser/ast';
import { actionText, condText, exprText, triggerText } from '../parser/print';
import type { DeviceType, SensorType } from './catalog';
import { condReads, ruleWrites, type Write } from './effects';
import { DAY_MINUTES, mergeIntervals, toBoxes, toDnf, type Interval } from './intervals';
import type { SymbolTable } from './symbols';

/** Where a number line can be drawn: one sensor in one rule's condition. */
export interface TruthLine {
  ruleId: string;
  variable: string;
  unit: string;
  isTime: boolean;
  intervals: Interval[];
}

const COOLING = 'AIR_CONDITIONER';
const HEATING = 'HEATER';

class WarningPass {
  readonly diagnostics: Diagnostic[] = [];
  readonly truthLines: TruthLine[] = [];
  private allWrites: Write[] = [];

  constructor(
    private readonly program: Program,
    private readonly table: SymbolTable,
    private readonly explicit: boolean,
  ) {}

  private warn(code: DiagnosticCode, span: Span, message: string, hint?: string): void {
    this.diagnostics.push(makeDiagnostic(code, span, message, hint));
  }

  run(): void {
    const { rules } = this.program;
    this.allWrites = rules.flatMap((r) => ruleWrites(r, this.table));

    for (const rule of rules) {
      const before = this.diagnostics.length;
      this.visitRuleConds(rule);
      const hadEmptyWindow = this.diagnostics.slice(before).some((d) => d.code === 'W409');
      this.checkIntervals(rule, hadEmptyWindow);
      this.checkFlapping(rule);
      this.checkActions(rule);
    }
    this.checkDuplicates(rules);
    this.checkMissingReversal();
    this.checkOscillation(rules);
    if (this.explicit) this.checkUnused();
    this.checkScenarioValues();
  }

  // ---- W401 W402 W416: interval analysis ----------------------------------

  private checkIntervals(rule: Rule, hadEmptyWindow: boolean): void {
    const { trigger } = rule;
    const cond = trigger.kind === 'State' ? trigger.cond : trigger.kind === 'Event' ? trigger.guard : undefined;
    if (!cond) return;

    const dnf = toDnf(cond, false, this.table);
    const complement = toDnf(cond, true, this.table);
    if (!dnf || !complement) {
      this.warn('W416', rule.span, `The condition of ${rule.id} is too large to analyse (more than 64 cases).`);
      return;
    }

    const boxes = toBoxes(dnf);
    if (boxes.length === 0 && !hadEmptyWindow) {
      this.warn('W401', rule.span, `This condition can never be true; rule ${rule.id} will never fire.`,
        `No value satisfies ${condText(cond)}.`);
    } else if (trigger.kind === 'State' && toBoxes(complement).length === 0) {
      this.warn('W402', rule.span, 'Condition is always true; the rule fires once at start and never again.');
    }
    this.recordTruthLines(rule, condReads(cond), boxes);
  }

  private recordTruthLines(rule: Rule, reads: Set<string>, boxes: ReturnType<typeof toBoxes>): void {
    for (const variable of reads) {
      const symbol = this.table.get(variable);
      const isTime = variable === 'TIME';
      if (!isTime && symbol?.dim === undefined) continue;

      const whole: Interval = isTime
        ? { lo: 0, hi: DAY_MINUTES, loOpen: false, hiOpen: true }
        : { lo: -Infinity, hi: Infinity, loOpen: true, hiOpen: true };
      const intervals = mergeIntervals(boxes.map((b) => b.numbers.get(variable) ?? whole));
      this.truthLines.push({
        ruleId: rule.id, variable, isTime, intervals,
        unit: isTime || !symbol?.dim ? '' : canonicalDisplay(symbol.dim),
      });
    }
  }

  // ---- W403 W409: checks on individual atoms ------------------------------

  private visitRuleConds(rule: Rule): void {
    const { trigger } = rule;
    if (trigger.kind === 'State') this.visitCond(trigger.cond);
    if (trigger.kind === 'Event') {
      if (trigger.guard) this.visitCond(trigger.guard);
      if (trigger.value) this.checkPlausible(trigger.source, trigger.value);
    }
    this.visitActions(rule.thenActs);
    if (rule.elseActs) this.visitActions(rule.elseActs);
  }

  private visitActions(actions: readonly Action[]): void {
    for (const action of actions) {
      if (action.kind !== 'IfAction') continue;
      this.visitCond(action.cond);
      this.visitActions(action.thenActs);
      if (action.elseActs) this.visitActions(action.elseActs);
    }
  }

  private visitCond(cond: Cond): void {
    switch (cond.kind) {
      case 'Logic':
        this.visitCond(cond.left);
        this.visitCond(cond.right);
        break;
      case 'Not':
        this.visitCond(cond.operand);
        break;
      case 'Compare':
        this.visitCompare(cond);
        break;
      case 'Between':
        this.visitBetween(cond);
        break;
      default:
        break;
    }
  }

  private visitCompare({ left, right }: Compare): void {
    this.checkPlausible(left, right);
    this.checkPlausible(right, left);
  }

  private visitBetween(cond: Between): void {
    const { subject, lo, hi, span } = cond;
    this.checkPlausible(subject, lo);
    this.checkPlausible(subject, hi);
    if (typeof lo.constant !== 'number' || typeof hi.constant !== 'number') return;
    if (subject.valueType?.kind === 'time') {
      if (lo.constant === hi.constant) {
        this.warn('W409', span, 'Empty time window: start equals end, so this is always false.');
      }
    } else if (lo.constant > hi.constant) {
      this.warn('W409', span, `Empty range: ${exprText(lo)} is above ${exprText(hi)}, and a numeric BETWEEN never wraps, so this is always false.`);
    }
  }

  private checkPlausible(sensorExpr: Expr, value: Expr): void {
    if (sensorExpr.kind !== 'Ref' || typeof value.constant !== 'number') return;
    this.checkPlausibleValue(sensorExpr.name, value.constant, value.span);
  }

  private checkPlausibleValue(name: string, value: number, span: Span): void {
    const symbol = this.table.get(name);
    const sensor = symbol?.catalog as SensorType | undefined;
    if (sensor?.kind !== 'sensor' || !sensor.plausible || !sensor.dim) return;
    const [lo, hi] = sensor.plausible;
    if (value >= lo && value <= hi) return;
    const unit = canonicalDisplay(sensor.dim);
    const low = String(lo).replace('-', '−');
    this.warn('W403', span,
      `${formatNumber(value)} ${unit} is outside the plausible range for ${sensor.name} (${low}…${hi} ${unit}).`);
  }

  private checkScenarioValues(): void {
    for (const stmt of this.program.sim?.stmts ?? []) {
      for (const { target, value } of stmt.assigns) {
        if (typeof value.constant === 'number') this.checkPlausibleValue(target.name, value.constant, value.span);
      }
    }
  }

  // ---- W405: duplicates ---------------------------------------------------

  private checkDuplicates(rules: readonly Rule[]): void {
    const seen = new Map<string, string>();
    for (const rule of rules) {
      const lines = [triggerText(rule.trigger), ...rule.thenActs.map(actionText), 'ELSE', ...(rule.elseActs ?? []).map(actionText)];
      const key = lines.join('\n');
      const first = seen.get(key);
      if (first) this.warn('W405', rule.span, `${rule.id} duplicates ${first}.`);
      else seen.set(key, rule.id);
    }
  }

  // ---- W406: missing reversal ---------------------------------------------

  private checkMissingReversal(): void {
    const reported = new Set<string>();
    for (const write of this.allWrites) {
      const isOn = write.affectsPower && (write.value === 'ON' || write.value === 'OPEN');
      if (!isOn || reported.has(write.device)) continue;
      const reversed = this.allWrites.some((w) => w.device === write.device && w.affectsPower &&
        ['OFF', 'CLOSED', 'TOGGLE', '?'].includes(String(w.value)));
      if (reversed) continue;
      reported.add(write.device);
      const [did, undo] = write.value === 'ON' ? ['turned on', 'turns it off'] : ['opened', 'closes it'];
      this.warn('W406', write.span, `${write.device} is ${did} by ${write.ruleId} but no rule ever ${undo}.`);
    }
  }

  // ---- W408: unused -------------------------------------------------------

  private checkUnused(): void {
    for (const symbol of this.table.all()) {
      if (symbol.builtin || symbol.kind === 'ROOM' || symbol.useCount > 0) continue;
      this.warn('W408', symbol.declSpan!, `${symbol.displayName} is declared but never used.`);
    }
  }

  // ---- W411: heater and AC around one threshold ---------------------------

  private switchOnBounds(rules: readonly Rule[], deviceType: string, side: 'lo' | 'hi'): Map<string, { rule: Rule; bound: number }> {
    const found = new Map<string, { rule: Rule; bound: number }>();
    for (const rule of rules) {
      if (rule.trigger.kind !== 'State' || rule.trigger.hold) continue;
      const turnsOn = ruleWrites(rule, this.table).some((w) => w.branch === 'then' && w.value === 'ON' &&
        this.table.get(w.device)?.typeName === deviceType);
      if (!turnsOn) continue;
      const dnf = toDnf(rule.trigger.cond, false, this.table);
      if (!dnf) continue;
      for (const box of toBoxes(dnf)) {
        for (const [variable, interval] of box.numbers) {
          if (this.table.get(variable)?.dim !== 'temperature') continue;
          const bound = interval[side];
          if (Number.isFinite(bound)) found.set(variable, { rule, bound });
        }
      }
    }
    return found;
  }

  private checkOscillation(rules: readonly Rule[]): void {
    const cooling = this.switchOnBounds(rules, COOLING, 'lo');
    const heating = this.switchOnBounds(rules, HEATING, 'hi');
    for (const [variable, cool] of cooling) {
      const heat = heating.get(variable);
      if (!heat || cool.bound - heat.bound >= 1) continue;
      this.warn('W411', cool.rule.span, `AC and HEATER act on ${variable} around one threshold; add a gap or FOR.`);
    }
  }

  // ---- W412 W414: per-rule action checks ----------------------------------

  private checkActions(rule: Rule): void {
    const { trigger } = rule;
    const outer = new Set<string>();
    if (trigger.kind === 'State') condReads(trigger.cond, outer);
    if (trigger.kind === 'Event') {
      outer.add(trigger.source.name);
      if (trigger.guard) condReads(trigger.guard, outer);
    }
    this.checkActionList(rule.thenActs, outer);
    if (rule.elseActs) this.checkActionList(rule.elseActs, outer);
  }

  private hasPresenceGuard(reads: ReadonlySet<string>): boolean {
    return [...reads].some((name) => this.table.get(name)?.typeName === 'PRESENCE_SENSOR');
  }

  private checkActionList(actions: readonly Action[], reads: ReadonlySet<string>): void {
    for (const action of actions) {
      if (action.kind === 'Power' && action.op === 'UNLOCK' && !this.hasPresenceGuard(reads)) {
        const presence = this.table.all().find((s) => s.typeName === 'PRESENCE_SENSOR');
        const example = presence ? `IF ${presence.displayName} IS HOME` : 'a presence check';
        this.warn('W412', action.span, `UNLOCK runs without checking presence. Consider ${example}.`);
      }
      if (action.kind === 'SetAttr') this.checkSetpoint(action, actions);
      if (action.kind === 'IfAction') {
        const inner = condReads(action.cond, new Set(reads));
        this.checkActionList(action.thenActs, inner);
        if (action.elseActs) this.checkActionList(action.elseActs, inner);
      }
    }
  }

  /** W414: a setpoint on a device that may be off is stored, not acted on. */
  private checkSetpoint(action: Extract<Action, { kind: 'SetAttr' }>, siblings: readonly Action[]): void {
    const type = this.table.get(action.target.name)?.catalog as DeviceType | undefined;
    if (!type || type.kind !== 'device' || type.levelAttribute === action.attr) return;
    if (!type.actions.includes('TURN_ON')) return;
    const turnsOn = siblings.some((a) => a.kind === 'Power' && a.op === 'TURN_ON' && a.target.name === action.target.name);
    if (turnsOn) return;
    const name = action.target.name;
    this.warn('W414', action.span, `${name} setpoint is stored; ${name} stays OFF until it is turned on.`);
  }

  // ---- W413: flapping -----------------------------------------------------

  private checkFlapping(rule: Rule): void {
    const { trigger } = rule;
    if (trigger.kind !== 'State' || trigger.hold || !rule.elseActs) return;
    const numeric = [...condReads(trigger.cond)].find((name) => this.table.get(name)?.dim !== undefined);
    if (!numeric) return;
    const target = ruleWrites(rule, this.table)[0]?.device ?? 'the device';
    this.warn('W413', rule.span,
      `${numeric} hovering at its threshold may toggle ${target} rapidly. Add FOR 2MIN or separate thresholds.`);
  }
}

export function runWarnings(program: Program, table: SymbolTable, explicit: boolean): { diagnostics: Diagnostic[]; truthLines: TruthLine[] } {
  const pass = new WarningPass(program, table, explicit);
  pass.run();
  return { diagnostics: pass.diagnostics, truthLines: pass.truthLines };
}
