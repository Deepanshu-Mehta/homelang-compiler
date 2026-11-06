import { describe, expect, it } from 'vitest';
import { compile, stageOutput, stageResult } from '../../src/compiler/index';

function semantic(source: string) {
  const result = compile(source);
  return { stage: stageResult(result, 'semantic'), output: stageOutput(result, 'semantic') };
}
const codes = (source: string) => semantic(source).stage.diagnostics.map((d) => d.code);
const errors = (source: string) => semantic(source).stage.diagnostics.filter((d) => d.severity === 'error');
const message = (source: string) => errors(source)[0]?.message;

const HOME = `ROOM BEDROOM;
DEVICE LAMP : LIGHT IN BEDROOM;
DEVICE AC : AIR_CONDITIONER IN BEDROOM;
DEVICE FRONT_DOOR : DOOR_LOCK IN BEDROOM;
DEVICE DRAPE : CURTAIN IN BEDROOM;
DEVICE FAN : FAN IN BEDROOM;
SENSOR TEMP : TEMP_SENSOR IN BEDROOM;
SENSOR TEMP_F : TEMP_SENSOR IN BEDROOM UNIT F;
SENSOR HUM : HUMIDITY_SENSOR IN BEDROOM;
SENSOR PIR : MOTION_SENSOR IN BEDROOM;
`;

describe('prelude and explicit mode', () => {
  it('loads the prelude when nothing is declared', () => {
    const { output } = semantic('IF TEMPERATURE > 30 THEN TURN_ON AC');
    expect(output!.mode).toBe('prelude');
    const names = output!.symbols.filter((s) => s.kind === 'DEVICE').map((s) => s.name);
    expect(names).toEqual(['AC', 'LIGHT', 'FAN', 'DOOR', 'CURTAIN']);
    expect(output!.symbols.every((s) => s.builtin)).toBe(true);
  });

  it('switches the prelude off when anything is declared', () => {
    expect(semantic('ROOM A;').output!.mode).toBe('explicit');
    expect(errors('ROOM A; IF TEMPERATURE > 30 THEN TURN_ON AC').map((d) => d.code)).toEqual(['S301', 'S301']);
  });

  it('keeps TIME and DAY in explicit mode', () => {
    expect(errors('ROOM A; DEVICE L : LIGHT IN A; IF TIME BETWEEN 22:00 AND 06:00 AND DAY == MON THEN TURN_ON L')).toEqual([]);
  });

  it('never changes the parser output', () => {
    const result = compile('IF TEMPERATURE > 30 THEN TURN_ON AC');
    const parsed = stageOutput(result, 'parser')!.ast;
    expect(JSON.stringify(parsed)).not.toContain('valueType');
  });
});

describe('annotation', () => {
  it('tags types and units, and gives a bare number the sensor unit', () => {
    const { output, stage } = semantic('IF TEMPERATURE > 30 THEN TURN_ON AC');
    const trigger = output!.annotated.rules[0]!.trigger;
    expect(trigger).toMatchObject({
      cond: { left: { tag: 'temperature °C' }, right: { unit: 'C', constant: 30, tag: 'temperature °C' } },
    });
    expect(stage.diagnostics.find((d) => d.code === 'W415')!.message).toBe('30 interpreted as 30 °C.');
  });

  it('converts Fahrenheit at compile time', () => {
    const { output, stage } = semantic('IF TEMPERATURE > 86F THEN TURN_ON AC');
    expect(output!.annotated.rules[0]!.trigger).toMatchObject({ cond: { right: { constant: 30 } } });
    expect(stage.diagnostics.find((d) => d.code === 'W410')!.message).toBe('86 °F converted to 30 °C.');
  });

  it('reads a bare number in the sensor unit when the sensor is in °F', () => {
    const { output } = semantic(`${HOME}IF TEMP_F > 86 THEN TURN_ON AC`);
    expect(output!.annotated.rules[0]!.trigger).toMatchObject({ cond: { right: { unit: 'F', constant: 30 } } });
  });

  it('folds durations to seconds', () => {
    const { output } = semantic('IF TEMPERATURE > 30C FOR 2MIN THEN TURN_ON AC');
    expect(output!.annotated.rules[0]!.trigger).toMatchObject({ hold: { seconds: 120 } });
  });

  it('records who reads and writes each symbol', () => {
    const { output } = semantic('IF TEMPERATURE > 30 THEN TURN_ON AC');
    const entry = (name: string) => output!.symbols.find((s) => s.name === name)!;
    expect(entry('TEMPERATURE').readBy).toEqual(['R1']);
    expect(entry('AC').writtenBy).toEqual(['R1']);
  });
});

describe('the brief', () => {
  it('passes with no errors', () => {
    expect(errors('IF TEMPERATURE > 30 THEN TURN_ON AC')).toEqual([]);
  });
});

describe('Step 0 traps', () => {
  it('SET AC MODE TO FAN means the mode, not the device', () => {
    const { output } = semantic(`${HOME}IF TRUE THEN SET AC MODE TO FAN`);
    expect(errors(`${HOME}IF TRUE THEN SET AC MODE TO FAN`)).toEqual([]);
    expect(output!.annotated.rules[0]!.thenActs[0]).toMatchObject({ value: { kind: 'EnumLit', value: 'FAN' } });
  });

  it('K is a colour temperature, never a room temperature', () => {
    expect(errors('IF TRUE THEN SET LIGHT COLOR_TEMP TO 2700K')).toEqual([]);
    expect(errors('IF TEMPERATURE > 300K THEN TURN_ON AC')[0]!.code).toBe('S310');
  });

  it('rejects °F arithmetic rather than guessing what it means', () => {
    expect(message('IF TEMPERATURE + 2F > 30 THEN TURN_ON AC')).toBe('Arithmetic on °F values is not supported.');
    expect(errors(`${HOME}IF TEMP_F + 2 > 86 THEN TURN_ON AC`)[0]!.code).toBe('S310');
    expect(errors('IF TEMPERATURE + 2C > 30 THEN TURN_ON AC')).toEqual([]);
  });

  it('a level attribute needs no TURN_ON and raises no error', () => {
    expect(errors('IF TRUE THEN SET FAN SPEED TO 3')).toEqual([]);
  });
});

describe('one test per S code', () => {
  it('S301 unknown device, with the list of devices', () => {
    expect(message('IF TEMPERATURE > 30 THEN TURN_ON HEATPUMP'))
      .toBe("Unknown device 'HEATPUMP'. Declared devices: AC, LIGHT, FAN, DOOR, CURTAIN.");
  });

  it('S301 suggests a close name', () => {
    expect(errors('IF TEMPERATUR > 30 THEN TURN_ON AC')[0]!.hint).toBe('Did you mean TEMPERATURE?');
    expect(errors('IF TRUE THEN TURN_ON LIGTH')[0]!.hint).toBe('Did you mean LIGHT?');
  });

  it('S301 for a room used as a value or a target', () => {
    expect(errors('IF BEDROOM IS ON THEN TURN_ON AC')[0]!.code).toBe('S301');
    expect(errors('IF TRUE THEN TURN_ON BEDROOM')[0]!.code).toBe('S301');
  });

  it('S302 duplicate, case-insensitive', () => {
    expect(message('ROOM BEDROOM; DEVICE AC : AIR_CONDITIONER IN BEDROOM; DEVICE ac : FAN IN BEDROOM;'))
      .toBe("'ac' is already declared at line 1, column 22 (names are case-insensitive).");
    expect(errors('DEVICE TIME : LIGHT;')[0]!.code).toBe('S302');
    expect(errors('ROOM A; ROOM a;')[0]!.code).toBe('S302');
  });

  it('S303 unknown type, or the wrong kind of type', () => {
    expect(message('DEVICE X : TOASTER;')).toContain("Unknown type 'TOASTER'. Known types: LIGHT, AIR_CONDITIONER");
    expect(message('DEVICE X : TEMP_SENSOR;')).toBe('TEMP_SENSOR is a sensor type; declare it with SENSOR.');
    expect(errors('SENSOR X : LIGHT;')[0]!.code).toBe('S303');
  });

  it('S304 unknown room', () => {
    expect(message('ROOM BEDROOM; DEVICE AC : AIR_CONDITIONER IN GARAGE;')).toBe("Room 'GARAGE' is not declared.");
  });

  it('accepts a room declared after the device that uses it', () => {
    expect(errors('DEVICE L : LIGHT IN A; ROOM A;')).toEqual([]);
  });

  it.each([
    ['TURN_ON', 'cannot be turned on'], ['TURN_OFF', 'cannot be turned off'], ['TOGGLE', 'cannot be toggled'],
  ])('S305 %s on a sensor', (op, text) => {
    expect(message(`IF TEMPERATURE > 30 THEN ${op} TEMPERATURE`)).toContain(`'TEMPERATURE' is a sensor; sensors are read-only and ${text}.`);
  });

  it('S305 SET on a sensor', () => {
    expect(errors('IF TRUE THEN SET TEMPERATURE X TO 5')[0]!.code).toBe('S305');
  });

  it('S306 unsupported action', () => {
    expect(message('IF TRUE THEN LOCK LIGHT')).toBe('LIGHT does not support LOCK. Supported: TURN_ON, TURN_OFF, TOGGLE, SET.');
    expect(message('IF TRUE THEN TOGGLE DOOR')).toBe('DOOR (DOOR_LOCK) does not support TOGGLE. Supported: LOCK, UNLOCK.');
    expect(errors(`${HOME}IF TRUE THEN OPEN LAMP`)[0]!.code).toBe('S306');
  });

  it('S307 unsupported attribute', () => {
    expect(message('IF MOTION IS DETECTED THEN SET DOOR BRIGHTNESS TO 50%'))
      .toBe('DOOR_LOCK has no attribute BRIGHTNESS; use LOCK or UNLOCK.');
    expect(message('IF TRUE THEN SET AC BRIGHTNESS TO 50%'))
      .toBe('AIR_CONDITIONER has no attribute BRIGHTNESS. Attributes: TEMPERATURE, MODE.');
  });

  it('S308 type mismatch', () => {
    expect(message('IF TEMPERATURE > ON THEN TURN_ON AC'))
      .toBe('Type mismatch: TEMPERATURE is a temperature (°C) but ON is a power state.');
    expect(errors('IF MOTION > 30 THEN TURN_ON AC')[0]!.code).toBe('S308');
    expect(errors('IF DOOR == 25 THEN TURN_ON AC')[0]!.code).toBe('S308');
    expect(errors('IF TEMPERATURE > TRUE THEN TURN_ON AC')[0]!.code).toBe('S308');
    expect(errors('IF DAY == 3 THEN TURN_ON AC')[0]!.code).toBe('S308');
    expect(errors('IF DAY == WEEKDAYS THEN TURN_ON AC')[0]!.code).toBe('S308');
  });

  it('S309 invalid state', () => {
    expect(message('IF DOOR IS ON THEN TURN_ON LIGHT')).toBe('ON is not a valid state for DOOR (DOOR_LOCK). Valid: LOCKED, UNLOCKED.');
    expect(errors('IF DOOR == ON THEN TURN_ON LIGHT')[0]!.code).toBe('S309');
    expect(errors('IF TEMPERATURE IS ON THEN TURN_ON LIGHT')[0]!.code).toBe('S309');
    expect(errors('IF DAY IS WEEKDAYS THEN TURN_ON LIGHT')[0]!.code).toBe('S309');
    expect(errors('IF TRUE THEN SET AC MODE TO HOT')[0]!.code).toBe('S309');
    expect(errors('IF MOTION IS TRUE THEN TURN_ON AC')[0]!.code).toBe('S309');
  });

  it('S309 accepts valid forms', () => {
    expect(errors('IF DOOR == LOCKED AND DAY == MON AND DAY IS TUE AND CURTAIN IS OPEN THEN TURN_ON AC')).toEqual([]);
  });

  it('S310 unit mismatch', () => {
    expect(message('IF TEMPERATURE > 50% THEN TURN_ON FAN')).toBe('Cannot compare a temperature (°C) with a percentage.');
    expect(errors('IF HUMIDITY > 30C THEN TURN_ON FAN')[0]!.code).toBe('S310');
    expect(errors('IF TRUE THEN SET AC TEMPERATURE TO 50%')[0]!.code).toBe('S310');
    expect(errors('IF TRUE FOR 5C THEN TURN_ON AC')[0]!.code).toBe('S310');
    expect(errors('IF TEMPERATURE + 5% > 3 THEN TURN_ON AC')[0]!.code).toBe('S310');
    expect(errors('IF TEMPERATURE * 2C > 3 THEN TURN_ON AC')[0]!.code).toBe('S310');
  });

  it('S311 out of range', () => {
    expect(message('IF TEMPERATURE > 30 THEN SET AC TEMPERATURE TO 35C'))
      .toBe('Out of range: AC TEMPERATURE must be 16–30 °C; got 35 °C.');
    expect(message('IF TRUE THEN SET LIGHT BRIGHTNESS TO 120%')).toBe('Out of range: LIGHT BRIGHTNESS must be 0–100 %; got 120 %.');
    expect(message('IF TRUE THEN SET FAN SPEED TO 7')).toBe('Out of range: FAN SPEED must be 0–5; got 7.');
    expect(message('IF TRUE THEN SET FAN SPEED TO 2.5')).toBe('Out of range: FAN SPEED must be a whole number; got 2.5.');
  });

  it('S311 converts before checking the range', () => {
    expect(errors('IF TRUE THEN SET AC TEMPERATURE TO 86F')).toEqual([]);
    expect(errors('IF TRUE THEN SET AC TEMPERATURE TO 95F')[0]!.code).toBe('S311');
  });

  it('S312 non-positive duration', () => {
    expect(message('WHEN MOTION DETECTED THEN TURN_ON LIGHT, WAIT 0MIN, TURN_OFF LIGHT')).toBe('WAIT duration must be greater than zero.');
    expect(message('IF TRUE FOR -2MIN THEN TURN_ON AC')).toBe('FOR duration must be greater than zero.');
    expect(errors('SIMULATE STEP 0S { }')[0]!.code).toBe('S312');
  });

  it('S313 contradictory actions, unless a WAIT separates them', () => {
    const source = 'IF TEMPERATURE > 30 THEN TURN_ON AC, TURN_OFF AC';
    expect(message(source)).toBe(`Contradictory actions on AC in the same branch (line 1, column ${source.indexOf('TURN_ON') + 1} and column ${source.indexOf('TURN_OFF') + 1}).`);
    expect(errors('IF TRUE THEN TURN_ON AC, WAIT 5MIN, TURN_OFF AC')).toEqual([]);
    expect(errors(`${HOME}IF TRUE THEN LOCK FRONT_DOOR, UNLOCK FRONT_DOOR`)[0]!.code).toBe('S313');
    expect(errors(`${HOME}IF TRUE THEN OPEN DRAPE, CLOSE DRAPE`)[0]!.code).toBe('S313');
  });

  it('S314 event not supported by the source', () => {
    expect(message(`${HOME}WHEN TEMP DETECTED THEN TURN_ON AC`))
      .toBe('TEMP (TEMP_SENSOR) has no event DETECTED. Use RISES ABOVE, FALLS BELOW, CHANGES.');
    expect(errors('WHEN TIME CHANGES THEN TURN_ON AC')[0]!.code).toBe('S314');
    expect(errors('WHEN LIGHT DETECTED THEN TURN_ON AC')[0]!.code).toBe('S314');
    expect(errors('WHEN BEDROOM CHANGES THEN TURN_ON AC')[0]!.code).toBe('S314');
  });

  it('S315 comparing devices or sensors of different dimensions', () => {
    expect(message('IF AC > FAN THEN TURN_ON LIGHT')).toBe('Cannot compare AC with FAN: devices have states, not values.');
    expect(errors('IF TEMPERATURE > HUMIDITY THEN TURN_ON AC')[0]!.code).toBe('S315');
  });

  it('allows sensors of one dimension in different units', () => {
    expect(errors(`${HOME}IF TEMP > TEMP_F THEN TURN_ON AC`)).toEqual([]);
  });

  it('S316 ordering on an enum', () => {
    expect(message('IF DOOR > LOCKED THEN TURN_ON AC')).toBe('States can only be tested with IS or ==, not >.');
    expect(errors('IF DAY > MON THEN TURN_ON AC')[0]!.code).toBe('S316');
  });

  it('S318 IS on a non-name', () => {
    expect(message('IF TEMPERATURE + 2 IS ON THEN TURN_ON AC')).toBe('IS needs a device or sensor name on its left.');
  });

  it('S319 TIME with a non-time, or bad time arithmetic', () => {
    expect(message('IF TIME > 30C THEN TURN_ON AC')).toBe('TIME can only be compared with HH:MM times.');
    expect(errors('IF TIME BETWEEN 3 AND 05:00 THEN TURN_ON AC')[0]!.code).toBe('S319');
    expect(errors('IF TIME > 23:50 + 30MIN THEN TURN_ON AC')[0]!.code).toBe('S319');
    expect(errors('IF TIME + 1MIN > 10:00 THEN TURN_ON AC')[0]!.code).toBe('S319');
    expect(errors('IF TIME > 22:00 + 30MIN THEN TURN_ON AC')).toEqual([]);
  });

  it('S320 bad PRIORITY', () => {
    expect(errors('RULE "A" PRIORITY 0: IF TRUE THEN TURN_ON AC')[0]!.code).toBe('S320');
    expect(errors('RULE "A" PRIORITY 2.5: IF TRUE THEN TURN_ON AC')[0]!.code).toBe('S320');
  });

  it('S321 unknown or incompatible UNIT', () => {
    expect(errors('SENSOR T : TEMP_SENSOR UNIT XYZ;')[0]!.code).toBe('S321');
    expect(errors('SENSOR H : HUMIDITY_SENSOR UNIT C;')[0]!.code).toBe('S321');
    expect(errors('SENSOR M : MOTION_SENSOR UNIT C;')[0]!.code).toBe('S321');
    expect(errors('SENSOR T : TEMP_SENSOR UNIT K;')[0]!.code).toBe('S321');
    expect(errors('SENSOR H : HUMIDITY_SENSOR UNIT %;')).toEqual([]);
  });

  it('S322 scenario time outside the window', () => {
    expect(errors('SIMULATE FROM 08:00 TO 09:00 { AT 10:00: TEMPERATURE = 3C; }')[0]!.code).toBe('S322');
    expect(errors('SIMULATE FROM 22:00 TO 06:00 { AT 23:00: TEMPERATURE = 3C; AT 05:00: TEMPERATURE = 4C; }')).toEqual([]);
    expect(errors('SIMULATE FROM 22:00 TO 06:00 { AT 12:00: TEMPERATURE = 3C; }')[0]!.code).toBe('S322');
  });

  it('S323 assignment to something that is not a sensor', () => {
    expect(errors('SIMULATE { AT 08:00: AC = ON; }')[0]!.code).toBe('S323');
    expect(errors('SIMULATE { AT 08:00: TIME = 09:00; }')[0]!.code).toBe('S323');
    expect(errors('SIMULATE { AT 08:00: DAY = SAT; }')).toEqual([]);
  });

  it('S324 literal division by zero or overflow', () => {
    expect(message('IF TEMPERATURE > 5 / 0 THEN TURN_ON AC')).toBe('Division by zero.');
    expect(errors(`IF TEMPERATURE > ${Array(8).fill('999999999').join(' * ')} THEN TURN_ON AC`)[0]!.code).toBe('S324');
  });

  it('S324 reports an oversized constant once, though it is folded again when it adopts a unit', () => {
    expect(errors('IF TEMPERATURE > 1000000000 * 1000000000 THEN TURN_ON AC').map((d) => d.code)).toEqual(['S324']);
  });

  it('S325 thresholds and scenario values must be constant', () => {
    expect(errors('WHEN TEMPERATURE RISES ABOVE HUMIDITY THEN TURN_ON AC')[0]!.code).toBe('S325');
    expect(errors('SIMULATE { AT 08:00: TEMPERATURE = HUMIDITY; }')[0]!.code).toBe('S325');
  });
});

describe('collecting errors', () => {
  it('reports every semantic error, in source order', () => {
    expect(errors('IF TEMPERATURE > 50% THEN TURN_ON HEATPUMP, LOCK LIGHT').map((d) => d.code)).toEqual(['S310', 'S301', 'S306']);
  });

  it('does not cascade from an unknown name', () => {
    expect(codes('IF NOPE > 30 THEN TURN_ON AC')).toEqual(['S301']);
  });
});
