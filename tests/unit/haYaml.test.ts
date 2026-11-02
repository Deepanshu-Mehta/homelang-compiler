import { describe, expect, it } from 'vitest';
import { compile, stageOutput } from '../../src/compiler/index';
import { loadExamples } from '../helpers';

const yaml = (source: string) => stageOutput(compile(source), 'codegen')!.haYaml;

describe('Home Assistant export', () => {
  it('labels itself approximate', () => {
    expect(yaml('IF TEMPERATURE > 30 THEN TURN_ON AC')).toContain('APPROXIMATE');
  });

  it('turns one threshold into a numeric_state trigger, with current syntax', () => {
    expect(yaml('IF TEMPERATURE > 30 THEN TURN_ON AC')).toContain(`- alias: "R1"
  mode: "single"
  triggers:
    - trigger: "numeric_state"
      entity_id: "sensor.temperature"
      above: 30
  conditions:
    - condition: "numeric_state"
      entity_id: "sensor.temperature"
      above: 30
  actions:
    - action: "climate.turn_on"
      target:
        entity_id: "climate.ac"
`);
  });

  it('carries FOR as `for`, and adds a trigger for every value read', () => {
    const out = yaml('IF TEMPERATURE > 30 AND MOTION IS DETECTED FOR 2MIN THEN TURN_ON AC');
    expect(out).toContain('entity_id: "sensor.temperature"\n      for: "00:02:00"');
    expect(out).toContain('entity_id: "binary_sensor.motion"\n      for: "00:02:00"');
  });

  it('makes ELSE a second automation with the condition negated', () => {
    const out = yaml('IF TEMPERATURE > 30 THEN TURN_ON AC ELSE TURN_OFF AC');
    expect(out).toContain('alias: "R1 (else)"');
    expect(out).toContain('below: 30');
    expect(out).toContain('climate.turn_off');
  });

  it('exports a time window and weekdays', () => {
    const out = yaml('IF TIME BETWEEN 22:00 AND 06:00 THEN TURN_ON LIGHT END; AT 07:00 ON WEEKDAYS THEN OPEN CURTAIN;');
    expect(out).toContain('after: "22:00:00"');
    expect(out).toContain('before: "06:00:00"');
    expect(out).toContain('at: "07:00:00"');
    expect(out).toContain('weekday: ["mon", "tue", "wed", "thu", "fri"]');
    expect(out).toContain('cover.open_cover');
  });

  it('exports every action, with unit changes', () => {
    const out = yaml('WHEN MOTION DETECTED THEN SET LIGHT BRIGHTNESS TO 70%, SET AC TEMPERATURE TO 24C, SET AC MODE TO COOL, SET FAN SPEED TO 3, SET CURTAIN POSITION TO 40%, WAIT 5MIN, NOTIFY "hi", LOCK DOOR, TOGGLE LIGHT');
    expect(out).toContain('brightness_pct: 70');
    expect(out).toContain('temperature: 24');
    expect(out).toContain('hvac_mode: "cool"');
    expect(out).toContain('percentage: 60');
    expect(out).toContain('position: 40');
    expect(out).toContain('delay: "00:05:00"');
    expect(out).toContain('message: "hi"');
    expect(out).toContain('lock.lock');
    expect(out).toContain('light.toggle');
  });

  it('exports events and a nested IF', () => {
    const out = yaml('WHEN DOOR LOCKS IF PRESENCE IS AWAY THEN IF MOTION IS DETECTED THEN NOTIFY "a" ELSE NOTIFY "b" END');
    expect(out).toContain('to: "locked"');
    expect(out).toContain('state: "off"');
    expect(out).toContain('if:');
    expect(out).toContain('else:');
  });

  it('uses a template where there is no direct condition', () => {
    expect(yaml('IF TEMPERATURE >= 30 THEN TURN_ON AC')).toContain('value_template');
    expect(yaml('IF NOT TEMPERATURE > 30 THEN TURN_ON AC')).toContain('value_template');
  });

  it('handles a program with no rules', () => {
    expect(yaml('')).toContain('[]');
  });

  it.each(loadExamples().map((e) => [e.name, e.source] as const))('exports %s without a crash', (_name, source) => {
    const object = stageOutput(compile(source), 'codegen');
    if (object) expect(object.haYaml).not.toContain('undefined');
  });
});
