import { formatMinutes } from '../numeric';
import type { Action, Cond, Expr, Program, Rule } from '../parser/ast';
import { exprText } from '../parser/print';
import { condReads } from '../semantic/effects';
import type { SymbolEntry } from '../semantic/symbols';

/**
 * Exports rules as Home Assistant automations. This is an approximation, not an
 * equivalence. A Home Assistant trigger fires only when its own entity crosses a
 * threshold, while HomeLang re-evaluates a rule when anything it reads changes,
 * so each read becomes a trigger and the condition is repeated under
 * `conditions`. ELSE becomes a second automation with the condition negated.
 */

type Yaml = string | number | boolean | Yaml[] | { [key: string]: Yaml };

const DOMAINS: Readonly<Record<string, string>> = {
  LIGHT: 'light', AIR_CONDITIONER: 'climate', HEATER: 'climate', FAN: 'fan', DOOR_LOCK: 'lock',
  CURTAIN: 'cover', PLUG: 'switch', TEMP_SENSOR: 'sensor', HUMIDITY_SENSOR: 'sensor', LIGHT_SENSOR: 'sensor',
  MOTION_SENSOR: 'binary_sensor', CONTACT_SENSOR: 'binary_sensor', PRESENCE_SENSOR: 'binary_sensor',
};

/** The state word Home Assistant reports for a HomeLang state. */
const STATE_VALUE: Readonly<Record<string, string>> = {
  ON: 'on', OFF: 'off', LOCKED: 'locked', UNLOCKED: 'unlocked', DETECTED: 'on', CLEAR: 'off',
  HOME: 'on', AWAY: 'off', OPEN: 'on', CLOSED: 'off',
};

const SERVICE: Readonly<Record<string, string>> = {
  TURN_ON: 'turn_on', TURN_OFF: 'turn_off', TOGGLE: 'toggle', LOCK: 'lock', UNLOCK: 'unlock',
  OPEN: 'open_cover', CLOSE: 'close_cover',
};

const WEEKDAY: Readonly<Record<string, string[]>> = {
  MON: ['mon'], TUE: ['tue'], WED: ['wed'], THU: ['thu'], FRI: ['fri'], SAT: ['sat'], SUN: ['sun'],
  WEEKDAYS: ['mon', 'tue', 'wed', 'thu', 'fri'], WEEKENDS: ['sat', 'sun'],
};

function clock(seconds: number): string {
  const whole = Math.round(seconds);
  const parts = [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60];
  return parts.map((p) => String(p).padStart(2, '0')).join(':');
}

class Exporter {
  private readonly symbols: Map<string, SymbolEntry>;

  constructor(symbols: readonly SymbolEntry[]) {
    this.symbols = new Map(symbols.map((s) => [s.name, s]));
  }

  private entity(name: string): string {
    const type = this.symbols.get(name)?.typeName ?? '';
    return `${DOMAINS[type] ?? 'sensor'}.${name.toLowerCase()}`;
  }

  private stateOf(name: string, state: string): string {
    const type = this.symbols.get(name)?.typeName;
    if (type === 'CURTAIN') return state === 'OPEN' ? 'open' : 'closed';
    if (type === 'AIR_CONDITIONER') return state === 'ON' ? 'cool' : 'off';
    if (type === 'HEATER') return state === 'ON' ? 'heat' : 'off';
    return STATE_VALUE[state] ?? state.toLowerCase();
  }

  /** Anything with no direct Home Assistant condition becomes a Jinja template. */
  private template(cond: Cond, negate: boolean): Yaml {
    const value = (e: Expr): string => {
      if (e.kind === 'Ref' && e.name === 'TIME') return '(now().hour * 60 + now().minute)';
      if (e.kind === 'Ref') return `states('${this.entity(e.name)}') | float`;
      if (e.constant !== undefined) return String(e.constant);
      return exprText(e);
    };
    const test = cond.kind === 'Compare' ? `${value(cond.left)} ${cond.op} ${value(cond.right)}` : 'false';
    return { condition: 'template', value_template: `{{ ${negate ? 'not ' : ''}(${test}) }}` };
  }

  private condition(cond: Cond, negate = false): Yaml {
    switch (cond.kind) {
      case 'BoolLit':
        return { condition: 'template', value_template: `{{ ${cond.value !== negate ? 'true' : 'false'} }}` };
      case 'Not':
        return this.condition(cond.operand, !negate);
      case 'Logic': {
        const isAnd = (cond.op === 'AND') !== negate; // De Morgan
        return {
          condition: isAnd ? 'and' : 'or',
          conditions: [this.condition(cond.left, negate), this.condition(cond.right, negate)],
        };
      }
      case 'StateTest': {
        const name = exprText(cond.target);
        const entry: Yaml = { condition: 'state', entity_id: this.entity(name), state: this.stateOf(name, cond.state) };
        return cond.negated !== negate ? { condition: 'not', conditions: [entry] } : entry;
      }
      case 'Between':
        return this.between(cond, negate);
      case 'Compare':
        return this.compare(cond, negate);
    }
  }

  private between(cond: Extract<Cond, { kind: 'Between' }>, negate: boolean): Yaml {
    const { subject, lo, hi } = cond;
    let entry: Yaml;
    if (subject.valueType?.kind === 'time') {
      entry = {
        condition: 'time',
        after: `${formatMinutes(lo.constant as number)}:00`, before: `${formatMinutes(hi.constant as number)}:00`,
      };
    } else {
      entry = { condition: 'numeric_state', entity_id: this.entity(exprText(subject)), above: lo.constant as number, below: hi.constant as number };
    }
    return negate ? { condition: 'not', conditions: [entry] } : entry;
  }

  private compare(cond: Extract<Cond, { kind: 'Compare' }>, negate: boolean): Yaml {
    const { left, op, right } = cond;
    if (left.kind === 'Ref' && left.name !== 'TIME' && left.name !== 'DAY' && right.constant !== undefined) {
      const entity = this.entity(left.name);
      if (typeof right.constant === 'string') {
        const state = this.stateOf(left.name, right.constant);
        const entry: Yaml = { condition: 'state', entity_id: entity, state };
        return (op === '!=') !== negate ? { condition: 'not', conditions: [entry] } : entry;
      }
      if (!negate && op === '>') return { condition: 'numeric_state', entity_id: entity, above: right.constant };
      if (!negate && op === '<') return { condition: 'numeric_state', entity_id: entity, below: right.constant };
      if (negate && op === '<=') return { condition: 'numeric_state', entity_id: entity, above: right.constant };
      if (negate && op === '>=') return { condition: 'numeric_state', entity_id: entity, below: right.constant };
    }
    return this.template(cond, negate);
  }

  private action(action: Action): Yaml {
    switch (action.kind) {
      case 'Power': {
        const entity = this.entity(action.target.name);
        const domain = entity.split('.')[0]!;
        return { action: `${domain}.${SERVICE[action.op]}`, target: { entity_id: entity } };
      }
      case 'SetAttr':
        return this.setAction(action);
      case 'Wait':
        return { delay: clock(action.duration.seconds ?? 0) };
      case 'Notify':
        return { action: 'notify.notify', data: { message: action.text } };
      case 'IfAction':
        return {
          if: [this.condition(action.cond)],
          then: action.thenActs.map((a) => this.action(a)),
          ...(action.elseActs && { else: action.elseActs.map((a) => this.action(a)) }),
        };
    }
  }

  private setAction(action: Extract<Action, { kind: 'SetAttr' }>): Yaml {
    const entity = this.entity(action.target.name);
    const target = { entity_id: entity };
    const value = (action.value.constant ?? exprText(action.value)) as Yaml;
    switch (action.attr) {
      case 'BRIGHTNESS':
        return { action: 'light.turn_on', target, data: { brightness_pct: value } };
      case 'COLOR_TEMP':
        return { action: 'light.turn_on', target, data: { color_temp_kelvin: value } };
      case 'TEMPERATURE':
        return { action: 'climate.set_temperature', target, data: { temperature: value } };
      case 'MODE':
        return { action: 'climate.set_hvac_mode', target, data: { hvac_mode: String(value).toLowerCase() } };
      case 'SPEED':
        // FAN.SPEED runs 0–5; Home Assistant uses a percentage.
        return { action: 'fan.set_percentage', target, data: { percentage: typeof value === 'number' ? value * 20 : value } };
      default:
        // CURTAIN.POSITION: HomeLang and Home Assistant both count percent open.
        return { action: 'cover.set_cover_position', target, data: { position: value } };
    }
  }

  private readTriggers(cond: Cond, hold: number | undefined): Yaml[] {
    const triggers: Yaml[] = [];
    for (const name of condReads(cond)) {
      if (name === 'TIME') {
        triggers.push({ trigger: 'time_pattern', minutes: '/1' });
      } else if (name !== 'DAY') {
        const entry: Record<string, Yaml> = { trigger: 'state', entity_id: this.entity(name) };
        if (hold) entry['for'] = clock(hold);
        triggers.push(entry);
      }
    }
    return triggers;
  }

  private single(cond: Cond): { name: string; op: '>' | '<'; value: number } | undefined {
    if (cond.kind !== 'Compare' || cond.left.kind !== 'Ref' || typeof cond.right.constant !== 'number') return undefined;
    if (cond.left.name === 'TIME' || (cond.op !== '>' && cond.op !== '<')) return undefined;
    return { name: cond.left.name, op: cond.op, value: cond.right.constant };
  }

  /** One threshold on one sensor maps exactly onto a numeric_state trigger. */
  private stateTriggers(cond: Cond, hold: number | undefined, negate: boolean): Yaml[] {
    const simple = this.single(cond);
    if (!simple) return this.readTriggers(cond, hold);
    const above = (simple.op === '>') !== negate;
    return [{
      trigger: 'numeric_state', entity_id: this.entity(simple.name),
      ...(above ? { above: simple.value } : { below: simple.value }),
      ...(hold ? { for: clock(hold) } : {}),
    }];
  }

  private eventTrigger(rule: Rule): Yaml {
    const trigger = rule.trigger as Extract<Rule['trigger'], { kind: 'Event' }>;
    const name = trigger.source.name;
    const entity = this.entity(name);
    const to = (state: string): Yaml => ({ trigger: 'state', entity_id: entity, to: this.stateOf(name, state) });
    switch (trigger.event) {
      case 'RISES_ABOVE':
        return { trigger: 'numeric_state', entity_id: entity, above: trigger.value?.constant as number };
      case 'FALLS_BELOW':
        return { trigger: 'numeric_state', entity_id: entity, below: trigger.value?.constant as number };
      case 'CHANGES':
        return { trigger: 'state', entity_id: entity };
      case 'DETECTED':
        return to('DETECTED');
      case 'CLEARS':
        return to('CLEAR');
      case 'TURNS_ON':
        return to('ON');
      case 'TURNS_OFF':
        return to('OFF');
      case 'LOCKS':
        return to('LOCKED');
      case 'UNLOCKS':
        return to('UNLOCKED');
      case 'OPENS':
        return to('OPEN');
      case 'CLOSES':
        return to('CLOSED');
    }
  }

  private automation(alias: string, triggers: Yaml[], conditions: Yaml[], actions: readonly Action[]): Yaml {
    return {
      alias, mode: 'single', triggers,
      ...(conditions.length ? { conditions } : {}),
      actions: actions.map((a) => this.action(a)),
    };
  }

  rule(rule: Rule): Yaml[] {
    const alias = rule.name ?? rule.id;
    const { trigger } = rule;
    if (trigger.kind === 'Time') {
      const days = trigger.days?.flatMap((d) => WEEKDAY[d] ?? []);
      const conditions: Yaml[] = days ? [{ condition: 'time', weekday: days }] : [];
      return [this.automation(alias, [{ trigger: 'time', at: `${formatMinutes(trigger.minutes)}:00` }], conditions, rule.thenActs)];
    }
    if (trigger.kind === 'Event') {
      const conditions = trigger.guard ? [this.condition(trigger.guard)] : [];
      return [this.automation(alias, [this.eventTrigger(rule)], conditions, rule.thenActs)];
    }
    const hold = trigger.hold?.seconds;
    const main = this.automation(alias, this.stateTriggers(trigger.cond, hold, false), [this.condition(trigger.cond)], rule.thenActs);
    if (!rule.elseActs) return [main];
    const otherwise = this.automation(`${alias} (else)`, this.stateTriggers(trigger.cond, undefined, true),
      [this.condition(trigger.cond, true)], rule.elseActs);
    return [main, otherwise];
  }
}

function scalar(value: string | number | boolean): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** Just enough YAML for the shapes above. */
function write(value: Yaml, indent: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const [first, ...rest] = write(item, `${indent}  `);
      const head = first!.slice(indent.length + 2);
      return [`${indent}- ${head}`, ...rest];
    });
  }
  if (typeof value !== 'object') return [`${indent}${scalar(value)}`];
  return Object.entries(value).flatMap(([key, item]) => {
    if (typeof item !== 'object') return [`${indent}${key}: ${scalar(item)}`];
    if (Array.isArray(item) && item.every((x) => typeof x !== 'object')) {
      return [`${indent}${key}: [${item.map((x) => scalar(x as string)).join(', ')}]`];
    }
    return [`${indent}${key}:`, ...write(item, `${indent}  `)];
  });
}

export function toHomeAssistantYaml(ast: Program, symbols: readonly SymbolEntry[]): string {
  const exporter = new Exporter(symbols);
  const automations = ast.rules.flatMap((rule) => exporter.rule(rule));
  const header = [
    '# Exported by HomeLang. This is an APPROXIMATE translation, not an equivalence:',
    '# Home Assistant triggers fire on their own entity only, so each value a rule',
    '# reads becomes a trigger, and ELSE becomes a second automation.',
  ];
  if (automations.length === 0) return `${header.join('\n')}\n[]\n`;
  return `${[...header, ...write(automations, '')].join('\n')}\n`;
}
