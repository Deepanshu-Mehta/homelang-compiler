import { describe, expect, it } from 'vitest';
import { compile, stageOutput, stageResult } from '../../src/compiler/index';
import { loadExamples } from '../helpers';
import { windowRanges, mergeIntervals, intersectIntervals, isEmptyInterval, pointIn } from '../../src/compiler/semantic/intervals';

function semantic(source: string) {
  const result = compile(source);
  return { stage: stageResult(result, 'semantic'), output: stageOutput(result, 'semantic')! };
}
const diag = (source: string, code: string) => semantic(source).stage.diagnostics.filter((d) => d.code === code);
const has = (source: string, code: string) => diag(source, code).length > 0;

const interval = (lo: number, hi: number, loOpen = false, hiOpen = false) => ({ lo, hi, loOpen, hiOpen });

describe('interval arithmetic', () => {
  it('intersects, keeping the tighter end', () => {
    expect(intersectIntervals(interval(0, 10), interval(5, 20))).toEqual(interval(5, 10));
    expect(intersectIntervals(interval(0, 10, true), interval(0, 10, false, true))).toEqual(interval(0, 10, true, true));
  });

  it('knows when an interval is empty', () => {
    expect(isEmptyInterval(interval(5, 3))).toBe(true);
    expect(isEmptyInterval(interval(5, 5))).toBe(false);
    expect(isEmptyInterval(interval(5, 5, true))).toBe(true);
  });

  it('splits a window across midnight', () => {
    expect(windowRanges(1320, 360)).toEqual([[1320, 1440], [0, 360]]);
    expect(windowRanges(60, 120)).toEqual([[60, 120]]);
    expect(windowRanges(60, 60)).toEqual([]);
  });

  it('merges touching intervals but keeps a gap at an open point', () => {
    expect(mergeIntervals([interval(0, 5), interval(3, 8)])).toEqual([interval(0, 8)]);
    expect(mergeIntervals([interval(0, 5, false, true), interval(5, 8, true)])).toHaveLength(2);
  });

  it('picks a readable point', () => {
    expect(pointIn(interval(28, Infinity, true, true))).toBe(29);
    expect(pointIn(interval(1320, 1440, false, true))).toBe(1380);
  });
});

describe('W401 contradiction', () => {
  it.each([
    'TEMPERATURE > 30 AND TEMPERATURE < 20',
    'TEMPERATURE >= 30 AND TEMPERATURE < 30',
    'TEMPERATURE == 20 AND TEMPERATURE == 21',
    'MOTION IS DETECTED AND MOTION IS CLEAR',
    'DOOR IS LOCKED AND DOOR IS NOT LOCKED',
    'DAY == MON AND DAY == TUE',
    'NOT (TEMPERATURE > 10 OR TEMPERATURE <= 10)',
    'TIME BETWEEN 01:00 AND 02:00 AND TIME BETWEEN 03:00 AND 04:00',
    'FALSE',
    '3 > 4',
  ])('%s', (cond) => {
    expect(has(`IF ${cond} THEN TURN_ON AC, WAIT 1MIN, TURN_OFF AC`, 'W401')).toBe(true);
  });

  it.each([
    'TEMPERATURE > 30 AND TEMPERATURE > 20',
    'TEMPERATURE >= 30 AND TEMPERATURE <= 30',
    'TEMPERATURE > 30 OR TEMPERATURE < 20',
    'TIME BETWEEN 22:00 AND 06:00 AND TIME > 23:00',
    'TIME BETWEEN 22:00 AND 06:00 AND TIME < 01:00',
  ])('not for %s', (cond) => {
    expect(has(`IF ${cond} THEN TURN_ON AC, WAIT 1MIN, TURN_OFF AC`, 'W401')).toBe(false);
  });

  it('applies to a WHEN guard', () => {
    expect(has('WHEN MOTION DETECTED IF TEMPERATURE > 30 AND TEMPERATURE < 20 THEN NOTIFY "x"', 'W401')).toBe(true);
  });

  it('treats two sensors as unknown, so it stays silent', () => {
    const source = 'ROOM A; SENSOR X : TEMP_SENSOR IN A; SENSOR Y : TEMP_SENSOR IN A; DEVICE L : LIGHT IN A; IF X > Y AND X < Y THEN TURN_ON L, TURN_OFF L';
    expect(has(source.replace('TURN_OFF L', 'WAIT 1MIN, TURN_OFF L'), 'W401')).toBe(false);
  });
});

describe('W402 tautology', () => {
  it.each([
    'TEMPERATURE > 20 OR TEMPERATURE <= 20',
    'MOTION IS DETECTED OR MOTION IS CLEAR',
    'NOT (DOOR IS LOCKED AND DOOR IS UNLOCKED)',
    'TRUE',
    'TIME BETWEEN 22:00 AND 06:00 OR TIME BETWEEN 06:00 AND 22:00',
    'NOT TIME BETWEEN 01:00 AND 01:00',
  ])('%s', (cond) => {
    expect(has(`IF ${cond} THEN TURN_ON AC, WAIT 1MIN, TURN_OFF AC`, 'W402')).toBe(true);
  });

  it('is not raised for an ordinary condition', () => {
    expect(has('IF TEMPERATURE > 20 OR TEMPERATURE < 10 THEN TURN_ON AC', 'W402')).toBe(false);
  });
});

describe('W403 implausible value', () => {
  it('checks both sides, BETWEEN and scenarios', () => {
    expect(has('IF 200C < TEMPERATURE THEN NOTIFY "x"', 'W403')).toBe(true);
    expect(has('IF TEMPERATURE BETWEEN 0 AND 200 THEN NOTIFY "x"', 'W403')).toBe(true);
    expect(has('SIMULATE { AT 08:00: TEMPERATURE = 90C; }', 'W403')).toBe(true);
    expect(has('IF TEMPERATURE > 30 THEN NOTIFY "x"', 'W403')).toBe(false);
  });
});

describe('W404 conflicts and the witness', () => {
  const source = 'IF TEMPERATURE > 28 THEN TURN_ON AC ELSE TURN_OFF AC END; IF TIME BETWEEN 22:00 AND 06:00 THEN TURN_OFF AC ELSE TURN_ON AC END;';

  it('finds overlapping rules and gives a concrete moment', () => {
    const { output } = semantic(source);
    expect(output.conflicts).toHaveLength(1);
    const [conflict] = output.conflicts;
    expect(conflict).toMatchObject({ ruleA: 'R1', ruleB: 'R2', target: 'AC', valueA: 'ON', valueB: 'OFF' });
    const values = Object.fromEntries(conflict!.witness.map((w) => [w.variable, w.value]));
    expect(values).toEqual({ TEMPERATURE: 29, TIME: 1380 });
  });

  it('says so in the warning', () => {
    expect(diag(source, 'W404')[0]!.message).toBe(
      'R1 and R2 can be active together (e.g. TEMPERATURE = 29 °C, TIME = 23:00) and set AC to ON and OFF. Equal priority: the later rule wins. Add PRIORITY.');
  });

  it('is silent with different priorities', () => {
    const fixed = `RULE "A" PRIORITY 2: IF TEMPERATURE > 28 THEN TURN_ON AC END; RULE "B": IF TIME BETWEEN 22:00 AND 06:00 THEN TURN_OFF AC END;`;
    expect(has(fixed, 'W404')).toBe(false);
  });

  it('is silent when the conditions cannot overlap', () => {
    expect(has('IF TEMPERATURE > 28 THEN TURN_ON AC END; IF TEMPERATURE < 20 THEN TURN_OFF AC END;', 'W404')).toBe(false);
  });

  it('is silent when both rules set the same value', () => {
    expect(has('IF TEMPERATURE > 28 THEN TURN_ON AC END; IF TIME > 22:00 THEN TURN_ON AC END;', 'W404')).toBe(false);
  });

  it('notices different attribute values', () => {
    expect(has('IF TEMPERATURE > 28 THEN SET LIGHT BRIGHTNESS TO 10% END; IF TIME > 22:00 THEN SET LIGHT BRIGHTNESS TO 90% END;', 'W404')).toBe(true);
  });

  it('adds the TOGGLE note', () => {
    expect(diag('IF TEMPERATURE > 28 THEN TOGGLE AC END; IF TIME > 22:00 THEN TOGGLE AC END;', 'W404')[0]!.message).toContain('TOGGLE results depend on order');
  });

  it('does not treat two different events as simultaneous', () => {
    expect(has('WHEN LIGHT TURNS ON IF TEMPERATURE > 0 THEN TURN_OFF AC; WHEN LIGHT TURNS OFF IF TEMPERATURE > 0 THEN TURN_ON AC;', 'W404')).toBe(false);
  });

  it('does flag two rules on the same event', () => {
    expect(has('WHEN MOTION DETECTED THEN TURN_ON AC; WHEN MOTION DETECTED THEN TURN_OFF AC;', 'W404')).toBe(true);
  });
});

describe('W405 duplicates', () => {
  it('finds an identical rule', () => {
    expect(diag('IF TEMPERATURE > 1 THEN TURN_ON AC END; IF TEMPERATURE > 1 THEN TURN_ON AC END;', 'W405')[0]!.message).toBe('R2 duplicates R1.');
  });
});

describe('W406 missing reversal', () => {
  it('fires for the brief', () => {
    expect(diag('IF TEMPERATURE > 30 THEN TURN_ON AC', 'W406')[0]!.message).toBe('AC is turned on by R1 but no rule ever turns it off.');
  });

  it('is satisfied by an ELSE, another rule, or a WAIT then off', () => {
    expect(has('IF TEMPERATURE > 30 THEN TURN_ON AC ELSE TURN_OFF AC', 'W406')).toBe(false);
    expect(has('IF TEMPERATURE > 30 THEN TURN_ON AC END; IF TEMPERATURE < 20 THEN TURN_OFF AC END;', 'W406')).toBe(false);
    expect(has('WHEN MOTION DETECTED THEN TURN_ON AC, WAIT 1MIN, TURN_OFF AC', 'W406')).toBe(false);
  });

  it('counts a level SET as switching on, and says opened for a curtain', () => {
    expect(has('IF TRUE THEN SET LIGHT BRIGHTNESS TO 50%', 'W406')).toBe(true);
    expect(diag('AT 07:00 THEN OPEN CURTAIN', 'W406')[0]!.message).toBe('CURTAIN is opened by R1 but no rule ever closes it.');
  });
});

describe('loops: S317, W407 and the dependency graph', () => {
  it('rejects an unguarded cycle', () => {
    expect(diag('WHEN LIGHT TURNS ON THEN TURN_OFF LIGHT; WHEN LIGHT TURNS OFF THEN TURN_ON LIGHT;', 'S317')[0]!.message)
      .toBe('Infinite loop: R1 → R2 → R1 with no guarding condition.');
  });

  it('warns about a guarded cycle', () => {
    const source = 'WHEN LIGHT TURNS ON IF TEMPERATURE > 0 THEN TURN_OFF LIGHT; WHEN LIGHT TURNS OFF IF TEMPERATURE > 0 THEN TURN_ON LIGHT;';
    expect(diag(source, 'W407')[0]!.message).toBe('Possible loop R1 → R2 → R1; the runtime stops at depth 16.');
    expect(semantic(source).stage.status).toBe('warn');
  });

  it('accepts a harmless rule that undoes its own trigger', () => {
    expect(semantic('WHEN LIGHT TURNS ON THEN TURN_OFF LIGHT').output.depGraph.cycles).toEqual([]);
  });

  it('never calls the brief a loop, despite AC cooling the room', () => {
    const { output, stage } = semantic('IF TEMPERATURE > 30 THEN TURN_ON AC');
    expect(stage.diagnostics.map((d) => d.code)).not.toContain('S317');
    expect(stage.diagnostics.map((d) => d.code)).not.toContain('W407');
    expect(output.depGraph.edges).toContainEqual(expect.objectContaining({ from: 'R1', to: 'R1', physical: true }));
    expect(output.depGraph.cycles).toEqual([]);
  });

  it('finds a three-rule cycle', () => {
    const source = 'WHEN LIGHT TURNS ON THEN TURN_ON FAN; WHEN FAN TURNS ON THEN TURN_ON AC; WHEN AC TURNS ON THEN TURN_OFF LIGHT, TURN_OFF FAN, TURN_OFF AC; WHEN LIGHT TURNS OFF THEN TURN_ON LIGHT;';
    expect(semantic(source).output.depGraph.cycles[0]!.sort()).toEqual(['R1', 'R2', 'R3', 'R4']);
  });

  it('treats a WAIT as a guard, because the cascade cannot be instant', () => {
    const source = 'WHEN LIGHT TURNS ON THEN WAIT 1MIN, TURN_OFF LIGHT; WHEN LIGHT TURNS OFF THEN WAIT 1MIN, TURN_ON LIGHT;';
    expect(has(source, 'S317')).toBe(false);
    expect(has(source, 'W407')).toBe(true);
  });

  it('skips loop and interval analysis on an ill-typed program', () => {
    expect(semantic('IF NOPE > 30 AND NOPE < 20 THEN TURN_ON AC').stage.diagnostics.map((d) => d.code)).toEqual(['S301', 'S301']);
  });
});

describe('W408 unused', () => {
  it('fires in explicit mode only', () => {
    expect(diag('ROOM A; DEVICE F : FAN IN A;', 'W408')[0]!.message).toBe('F is declared but never used.');
    expect(has('IF TEMPERATURE > 30 THEN TURN_ON AC', 'W408')).toBe(false);
  });
});

describe('W409 empty range', () => {
  it('for an equal time window, without also raising W401', () => {
    const source = 'IF TIME BETWEEN 22:00 AND 22:00 THEN TURN_ON AC';
    expect(diag(source, 'W409')[0]!.message).toBe('Empty time window: start equals end, so this is always false.');
    expect(has(source, 'W401')).toBe(false);
  });

  it('for a numeric BETWEEN with lo above hi, which never wraps', () => {
    expect(diag('IF TEMPERATURE BETWEEN 30 AND 20 THEN TURN_ON AC', 'W409')[0]!.message).toContain('Empty range');
  });

  it('treats numeric BETWEEN as inclusive, and an equal range as one point', () => {
    expect(has('IF TEMPERATURE BETWEEN 20 AND 20 THEN TURN_ON AC', 'W409')).toBe(false);
    const { output } = semantic('IF TEMPERATURE BETWEEN 20 AND 25 THEN TURN_ON AC');
    expect(output.truthLines[0]!.intervals).toEqual([{ lo: 20, hi: 25, loOpen: false, hiOpen: false }]);
  });

  it('does not warn for a window across midnight', () => {
    expect(has('IF TIME BETWEEN 22:00 AND 06:00 THEN TURN_ON AC', 'W409')).toBe(false);
  });
});

describe('W410 W415 W416 notes', () => {
  it('W410 and W415 do not turn the stage amber on their own', () => {
    const clean = semantic('IF TEMPERATURE > 86F FOR 1MIN THEN TURN_ON AC ELSE TURN_OFF AC');
    expect(clean.stage.diagnostics.map((d) => d.code)).toEqual(['W410']);
    expect(clean.stage.status).toBe('ok');
  });

  it('W416 when the DNF passes the cap', () => {
    const big = Array.from({ length: 7 }, (_, i) => `(TEMPERATURE > ${i} OR HUMIDITY > ${i})`).join(' AND ');
    expect(has(`IF ${big} THEN TURN_ON AC, WAIT 1MIN, TURN_OFF AC`, 'W416')).toBe(true);
  });
});

describe('W411 physical oscillation', () => {
  const home = 'ROOM A; DEVICE H : HEATER IN A; DEVICE C : AIR_CONDITIONER IN A; SENSOR T : TEMP_SENSOR IN A;';

  it('fires when heater and AC share a threshold', () => {
    expect(diag(`${home} IF T < 20 THEN TURN_ON H ELSE TURN_OFF H END; IF T > 20 THEN TURN_ON C ELSE TURN_OFF C END;`, 'W411')[0]!.message)
      .toBe('AC and HEATER act on T around one threshold; add a gap or FOR.');
  });

  it('is quiet with a gap or with FOR', () => {
    expect(has(`${home} IF T < 18 THEN TURN_ON H ELSE TURN_OFF H END; IF T > 24 THEN TURN_ON C ELSE TURN_OFF C END;`, 'W411')).toBe(false);
    expect(has(`${home} IF T < 20 FOR 5MIN THEN TURN_ON H ELSE TURN_OFF H END; IF T > 20 FOR 5MIN THEN TURN_ON C ELSE TURN_OFF C END;`, 'W411')).toBe(false);
  });
});

describe('W412 security default', () => {
  it('fires without a presence check', () => {
    expect(diag('ROOM A; DEVICE D : DOOR_LOCK IN A; SENSOR O : PRESENCE_SENSOR IN A; IF O IS HOME THEN LOCK D END; AT 07:00 THEN UNLOCK D;', 'W412')[0]!.message)
      .toBe('UNLOCK runs without checking presence. Consider IF O IS HOME.');
  });

  it('is satisfied by a guard or an enclosing IF', () => {
    const home = 'ROOM A; DEVICE D : DOOR_LOCK IN A; SENSOR O : PRESENCE_SENSOR IN A;';
    expect(has(`${home} WHEN O CHANGES IF O IS HOME THEN UNLOCK D;`, 'W412')).toBe(false);
    expect(has(`${home} AT 07:00 THEN IF O IS HOME THEN UNLOCK D END END;`, 'W412')).toBe(false);
  });
});

describe('W413 flapping', () => {
  it('needs a numeric sensor, an ELSE and no FOR', () => {
    expect(has('IF TEMPERATURE > 30 THEN TURN_ON AC ELSE TURN_OFF AC', 'W413')).toBe(true);
    expect(has('IF TEMPERATURE > 30 FOR 2MIN THEN TURN_ON AC ELSE TURN_OFF AC', 'W413')).toBe(false);
    expect(has('IF TEMPERATURE > 30 THEN TURN_ON AC', 'W413')).toBe(false);
    expect(has('IF MOTION IS DETECTED THEN TURN_ON AC ELSE TURN_OFF AC', 'W413')).toBe(false);
  });
});

describe('W414 setpoint', () => {
  it('fires on a setpoint with no TURN_ON beside it', () => {
    expect(has('IF TRUE THEN SET AC TEMPERATURE TO 24C', 'W414')).toBe(true);
    expect(has('IF TRUE THEN TURN_ON AC, SET AC TEMPERATURE TO 24C', 'W414')).toBe(false);
  });

  it('does not fire for level attributes, which imply power', () => {
    expect(has('IF TRUE THEN SET LIGHT BRIGHTNESS TO 50%', 'W414')).toBe(false);
    expect(has('IF TRUE THEN SET FAN SPEED TO 3', 'W414')).toBe(false);
  });
});

describe('truth lines for the number-line view', () => {
  it('records the true set of each sensor', () => {
    const { output } = semantic('IF TEMPERATURE > 30 THEN TURN_ON AC');
    expect(output.truthLines).toEqual([{
      ruleId: 'R1', variable: 'TEMPERATURE', unit: '°C', isTime: false,
      intervals: [{ lo: 30, hi: Infinity, loOpen: true, hiOpen: true }],
    }]);
  });

  it('splits a midnight window into two bands', () => {
    const { output } = semantic('IF TIME BETWEEN 22:00 AND 06:00 THEN TURN_ON AC');
    expect(output.truthLines[0]!.intervals.map((i) => [i.lo, i.hi])).toEqual([[0, 360], [1320, 1440]]);
  });
});

describe('the examples behave as plan.txt predicts', () => {
  const example = (name: string) => loadExamples().find((e) => e.name === name)!.source;
  const codes = (name: string) => semantic(example(name)).stage.diagnostics.map((d) => d.code);

  it('the advanced program raises W410 and W406, and no W413 (§9)', () => {
    expect(codes('advanced')).toEqual(['W410', 'W406']);
  });

  it('the brief raises W406 and the implicit-unit note (§14.1)', () => {
    expect(codes('brief').sort()).toEqual(['W406', 'W415']);
  });

  it('the conflict demo has a witness to load', () => {
    expect(semantic(example('conflict')).output.conflicts[0]!.witness.length).toBeGreaterThan(0);
  });

  it('the cascade demo warns but compiles', () => {
    expect(codes('cascade')).toContain('W407');
    expect(codes('cascade')).not.toContain('S317');
  });

  it('the hysteresis demo warns only about the rule without FOR', () => {
    expect(codes('hysteresis').filter((c) => c === 'W413')).toHaveLength(1);
  });
});
