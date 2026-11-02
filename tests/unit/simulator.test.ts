import { describe, expect, it } from 'vitest';
import { compile, createSession, emit, stageOutput, stageResult } from '../../src/compiler/index';
import { loadExamples } from '../helpers';

function session(source: string) {
  const object = stageOutput(compile(source), 'codegen');
  if (!object) throw new Error(`does not compile: ${source}`);
  return createSession(object);
}
const device = (s: ReturnType<typeof session>, name: string) => s.state.devices.find((d) => d.name === name)!;
const texts = (s: ReturnType<typeof session>) => s.log.map((e) => e.text);
const logOf = (source: string) => emit('sim', stageResult(compile(source), 'simulation')).trim().split('\n');
const lines = (source: string) => logOf(source).map((l) => l.replace(/^\S+ /, ''));

describe('the deliverable: the brief in live mode', () => {
  const brief = 'IF TEMPERATURE > 30 THEN TURN_ON AC';

  it('starts at 28 °C with the AC off', () => {
    const s = session(brief);
    expect(s.state.sensors.find((x) => x.name === 'TEMPERATURE')!.value).toBe(28);
    expect(device(s, 'AC').state).toBe('OFF');
  });

  it('turns the AC on past 30, and logs exactly what the brief asks for', () => {
    const s = session(brief);
    s.setSensor('TEMPERATURE', 31);
    expect(device(s, 'AC').state).toBe('ON');
    expect(texts(s)).toContain('Rule R1 fired: TURN_ON AC');
    expect(device(s, 'AC').attributes['TEMPERATURE']).toBe(26);
  });

  it('leaves the AC on when it falls again, as §14.1 says', () => {
    const s = session(brief);
    s.setSensor('TEMPERATURE', 31);
    s.setSensor('TEMPERATURE', 29);
    expect(device(s, 'AC').state).toBe('ON');
    expect(texts(s)).toContain('R1 condition became false; no ELSE');
  });

  it('fires on the edge only, so a higher value does nothing more', () => {
    const s = session(brief);
    s.setSensor('TEMPERATURE', 31);
    s.setSensor('TEMPERATURE', 35);
    expect(texts(s).filter((t) => t.includes('fired'))).toHaveLength(1);
  });

  it('names the source line of the rule', () => {
    const s = session(brief);
    s.setSensor('TEMPERATURE', 31);
    expect(s.log.find((e) => e.kind === 'fired')!.line).toBe(1);
  });
});

describe('the §9 run of the advanced program', () => {
  const log = logOf(loadExamples().find((e) => e.name === 'advanced')!.source);

  it.each([
    '21:30 Initial sync at 21:30',
    '22:10 Rule R2 "Night light" fired: SET BED_LIGHT BRIGHTNESS 20',
    '22:15 Rule R2 "Night light" fired: TURN_OFF BED_LIGHT',
    '22:17 Rule R1 "Cool bedroom" fired: TURN_ON AC, SET AC TEMPERATURE 24',
    '06:00 Rule R1 "Cool bedroom" fired: TURN_OFF AC',
    '07:00 Rule R3 "Morning" fired: OPEN CURTAIN, NOTIFY "Good morning!"',
    '07:15 Rule R4 "Leaving home" fired: LOCK FRONT_DOOR, TURN_OFF AC, TURN_OFF FAN, NOTIFY "Home secured"',
    '07:15 AC: no change (already OFF)',
  ])('%s', (line) => {
    expect(log).toContain(line);
  });

  it('crosses midnight into Tuesday, so the weekday rule fires', () => {
    const s = session(loadExamples().find((e) => e.name === 'advanced')!.source);
    s.runToEnd();
    expect(s.state.day).toBe('TUE');
    expect(device(s, 'CURTAIN').state).toBe('OPEN');
    expect(device(s, 'FRONT_DOOR').state).toBe('LOCKED');
    expect(s.state.notifications.map((n) => n.text)).toEqual(['Good morning!', 'Home secured']);
  });
});

describe('edge-triggered rules', () => {
  it('runs ELSE on true→false, and not at the initial sync', () => {
    const s = session('IF TEMPERATURE > 30 THEN TURN_ON AC ELSE TURN_OFF AC');
    expect(texts(s).some((t) => t.includes('fired'))).toBe(false);
    s.setSensor('TEMPERATURE', 31);
    s.setSensor('TEMPERATURE', 29);
    expect(texts(s)).toContain('Rule R1 fired: TURN_OFF AC');
    expect(device(s, 'AC').state).toBe('OFF');
  });

  it('fires THEN at the initial sync when the rule starts true', () => {
    expect(texts(session('IF TEMPERATURE > 20 THEN TURN_ON AC'))).toContain('Rule R1 fired: TURN_ON AC');
  });

  it('respects the boundary: exactly 30 with > is false, and with >= is true', () => {
    const strict = session('IF TEMPERATURE > 30 THEN TURN_ON AC');
    strict.setSensor('TEMPERATURE', 30);
    expect(device(strict, 'AC').state).toBe('OFF');
    const inclusive = session('IF TEMPERATURE >= 30 THEN TURN_ON AC');
    inclusive.setSensor('TEMPERATURE', 30);
    expect(device(inclusive, 'AC').state).toBe('ON');
  });

  it('does not run a rule when an unrelated sensor changes', () => {
    const s = session('IF TEMPERATURE > 30 THEN TURN_ON AC ELSE TURN_OFF AC');
    s.setSensor('HUMIDITY', 90);
    expect(texts(s).filter((t) => t.includes('fired'))).toEqual([]);
  });

  it('re-evaluates when a device it reads changes', () => {
    const s = session('WHEN MOTION DETECTED THEN TURN_ON LIGHT END; IF LIGHT IS ON THEN TURN_ON FAN END;');
    s.setSensor('MOTION', 'DETECTED');
    expect(device(s, 'FAN').state).toBe('ON');
  });
});

describe('FOR (Step 0 item 4)', () => {
  const rule = 'IF TEMPERATURE > 30 FOR 2MIN THEN TURN_ON AC ELSE TURN_OFF AC END;';
  const run = (events: string) => lines(`${rule}\nSIMULATE FROM 08:00 TO 08:20 { ${events} }`);

  it('waits out the hold, and wakes up by itself when it expires', () => {
    const log = logOf(`${rule}\nSIMULATE FROM 08:00 TO 08:20 { AT 08:05: TEMPERATURE = 31C; }`);
    expect(log).toContain('08:07 Rule R1 fired: TURN_ON AC');
  });

  it('runs neither branch if the condition drops during the hold', () => {
    const log = run('AT 08:05: TEMPERATURE = 31C; AT 08:06: TEMPERATURE = 29C;');
    expect(log.filter((l) => l.includes('fired'))).toEqual([]);
  });

  it('restarts the hold if the condition comes back', () => {
    const log = logOf(`${rule}\nSIMULATE FROM 08:00 TO 08:20 { AT 08:05: TEMPERATURE = 31C; AT 08:06: TEMPERATURE = 29C; AT 08:06: TEMPERATURE = 31C; }`);
    expect(log.filter((l) => l.includes('fired'))).toEqual(['08:08 Rule R1 fired: TURN_ON AC']);
  });

  it('runs ELSE only after THEN really fired', () => {
    const log = run('AT 08:05: TEMPERATURE = 31C; AT 08:10: TEMPERATURE = 29C;');
    expect(log.filter((l) => l.includes('fired'))).toEqual(['Rule R1 fired: TURN_ON AC', 'Rule R1 fired: TURN_OFF AC']);
  });

  it('is exact to the second, even with a large STEP', () => {
    const source = 'IF TEMPERATURE > 30 FOR 90S THEN TURN_ON AC\nSIMULATE FROM 08:00 TO 08:10 STEP 5MIN { AT 08:01: TEMPERATURE = 31C; }';
    expect(logOf(source)).toContain('08:02:30 Rule R1 fired: TURN_ON AC');
  });

  it('holds from the initial sync when the rule starts true', () => {
    const source = 'IF TEMPERATURE > 20 FOR 2MIN THEN TURN_ON AC\nSIMULATE FROM 08:00 TO 08:10 { }';
    expect(logOf(source)).toContain('08:02 Rule R1 fired: TURN_ON AC');
  });
});

describe('WHEN rules and events', () => {
  it('checks the guard at the moment of the event', () => {
    const s = session('WHEN MOTION DETECTED IF DOOR IS LOCKED THEN TURN_ON LIGHT, WAIT 1MIN, TURN_OFF LIGHT');
    s.setSensor('MOTION', 'DETECTED');
    expect(device(s, 'LIGHT').state).toBe('OFF');
  });

  it('fires CLEARS, OPENS and CHANGES', () => {
    const s = session('WHEN MOTION CLEARS THEN NOTIFY "a"; WHEN CONTACT OPENS THEN NOTIFY "b"; WHEN CONTACT CLOSES THEN NOTIFY "c"; WHEN PRESENCE CHANGES THEN NOTIFY "d";');
    s.setSensor('MOTION', 'DETECTED');
    s.setSensor('MOTION', 'CLEAR');
    s.setSensor('CONTACT', 'OPEN');
    s.setSensor('CONTACT', 'CLOSED');
    s.setSensor('PRESENCE', 'AWAY');
    expect(s.state.notifications.map((n) => n.text)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('fires RISES ABOVE and FALLS BELOW on the crossing only', () => {
    const s = session('WHEN TEMPERATURE RISES ABOVE 30C THEN NOTIFY "up"; WHEN TEMPERATURE FALLS BELOW 20C THEN NOTIFY "down";');
    s.setSensor('TEMPERATURE', 31);
    s.setSensor('TEMPERATURE', 35);
    s.setSensor('TEMPERATURE', 25);
    s.setSensor('TEMPERATURE', 15);
    s.setSensor('TEMPERATURE', 10);
    expect(s.state.notifications.map((n) => n.text)).toEqual(['up', 'down']);
  });

  it('fires device events', () => {
    const s = session('WHEN MOTION DETECTED THEN TURN_ON LIGHT, LOCK DOOR, OPEN CURTAIN; WHEN LIGHT TURNS ON THEN NOTIFY "on"; WHEN DOOR LOCKS THEN NOTIFY "lock"; WHEN CURTAIN OPENS THEN NOTIFY "open";');
    s.setSensor('MOTION', 'DETECTED');
    expect(s.state.notifications.map((n) => n.text).sort()).toEqual(['lock', 'on', 'open']);
  });

  it('does not treat the scenario start as an event', () => {
    const source = 'WHEN MOTION DETECTED THEN NOTIFY "x"\nSIMULATE FROM 08:00 TO 08:05 { AT 08:00: MOTION = DETECTED; }';
    expect(lines(source).filter((l) => l.includes('fired'))).toEqual([]);
  });
});

describe('AT rules', () => {
  it('fires at the minute, even with a large STEP', () => {
    const source = 'AT 08:07 THEN NOTIFY "x"\nSIMULATE FROM 08:00 TO 08:20 STEP 5MIN { }';
    expect(logOf(source)).toContain('08:07 Rule R1 fired: NOTIFY "x"');
  });

  it('respects days, including across midnight', () => {
    const weekend = 'AT 07:00 ON WEEKENDS THEN NOTIFY "x"\nSIMULATE FROM 06:00 TO 08:00 { }';
    expect(lines(weekend).filter((l) => l.includes('fired'))).toEqual([]);
    const saturday = 'AT 07:00 ON WEEKENDS THEN NOTIFY "x"\nSIMULATE FROM 06:00 TO 08:00 { AT 06:30: DAY = SAT; }';
    expect(lines(saturday).filter((l) => l.includes('fired'))).toHaveLength(1);
    const listed = 'AT 07:00 ON TUE, WED THEN NOTIFY "x"\nSIMULATE FROM 23:00 TO 08:00 { }';
    expect(lines(listed).filter((l) => l.includes('fired'))).toHaveLength(1);
  });

  it('fires at the scenario start', () => {
    expect(logOf('AT 08:00 THEN NOTIFY "x"\nSIMULATE FROM 08:00 TO 08:05 { }')).toContain('08:00 Rule R1 fired: NOTIFY "x"');
  });
});

describe('time windows', () => {
  const window = 'IF TIME BETWEEN 22:00 AND 06:00 THEN TURN_ON AC ELSE TURN_OFF AC\nSIMULATE FROM 21:00 TO 07:00 { }';

  it('starts exactly at a and ends just before b, across midnight', () => {
    const log = logOf(window);
    expect(log).toContain('22:00 Rule R1 fired: TURN_ON AC');
    expect(log).toContain('06:00 Rule R1 fired: TURN_OFF AC');
  });

  it('treats a scenario with FROM equal to TO as a full day', () => {
    const s = session('AT 07:00 THEN NOTIFY "x"\nSIMULATE FROM 08:00 TO 08:00 { }');
    expect(s.lengthSeconds).toBe(86400);
    s.runToEnd();
    expect(s.state.notifications).toHaveLength(1);
  });
});

describe('scrubbing time in live mode', () => {
  it('fires AT rules crossed going forward, but none going backward', () => {
    const s = session('AT 13:00 THEN NOTIFY "x"');
    expect(s.state.minutes).toBe(720);
    s.setTime(14 * 60);
    expect(s.state.notifications).toHaveLength(1);
    s.setTime(12 * 60);
    expect(s.state.minutes).toBe(720);
    expect(s.state.notifications).toHaveLength(1);
  });

  it('re-evaluates time conditions in both directions', () => {
    const s = session('IF TIME BETWEEN 13:00 AND 15:00 THEN TURN_ON AC ELSE TURN_OFF AC');
    s.setTime(14 * 60);
    expect(device(s, 'AC').state).toBe('ON');
    s.setTime(12 * 60);
    expect(device(s, 'AC').state).toBe('OFF');
  });

  it('finishes a WAIT as time moves on', () => {
    const s = session('WHEN MOTION DETECTED THEN TURN_ON LIGHT, WAIT 5MIN, TURN_OFF LIGHT');
    s.setSensor('MOTION', 'DETECTED');
    expect(device(s, 'LIGHT').state).toBe('ON');
    s.setTime(12 * 60 + 10);
    expect(device(s, 'LIGHT').state).toBe('OFF');
  });
});

describe('conflicts within one tick', () => {
  it('lets the higher priority win, and logs the override', () => {
    const source = 'RULE "a" PRIORITY 2: IF TEMPERATURE > 30 THEN TURN_ON AC END; RULE "b": IF TEMPERATURE > 30 THEN TURN_OFF AC END;';
    const s = session(source);
    s.setSensor('TEMPERATURE', 31);
    expect(device(s, 'AC').state).toBe('ON');
    expect(texts(s)).toContain('R1 overrode R2 on AC');
  });

  it('lets the later rule win a tie', () => {
    const s = session('IF TEMPERATURE > 30 THEN TURN_ON AC END; IF TEMPERATURE > 30 THEN TURN_OFF AC END;');
    s.setSensor('TEMPERATURE', 31);
    expect(device(s, 'AC').state).toBe('OFF');
    expect(texts(s)).toContain('R2 overrode R1 on AC');
  });

  it('resolves each attribute separately', () => {
    const s = session('IF TEMPERATURE > 30 THEN TURN_ON AC, SET AC TEMPERATURE TO 20C END; IF TEMPERATURE > 30 THEN SET AC TEMPERATURE TO 24C END;');
    s.setSensor('TEMPERATURE', 31);
    expect(device(s, 'AC')).toMatchObject({ state: 'ON', attributes: { TEMPERATURE: 24 } });
  });

  it('applies the merged-rule priority to each original rule', () => {
    const source = 'IF TEMPERATURE > 30 THEN TURN_ON FAN END; IF TEMPERATURE > 30 THEN TURN_ON AC END;';
    const s = session(source);
    s.setSensor('TEMPERATURE', 31);
    expect(texts(s)).toEqual(expect.arrayContaining(['Rule R1 fired: TURN_ON FAN', 'Rule R2 fired: TURN_ON AC']));
  });
});

describe('devices', () => {
  it('SET on a level attribute switches the device, and 0 switches it off', () => {
    const s = session('WHEN MOTION DETECTED THEN SET LIGHT BRIGHTNESS TO 70%; WHEN MOTION CLEARS THEN SET LIGHT BRIGHTNESS TO 0%;');
    s.setSensor('MOTION', 'DETECTED');
    expect(device(s, 'LIGHT')).toMatchObject({ state: 'ON', attributes: { BRIGHTNESS: 70 } });
    s.setSensor('MOTION', 'CLEAR');
    expect(device(s, 'LIGHT')).toMatchObject({ state: 'OFF', attributes: { BRIGHTNESS: 0 } });
  });

  it('a setpoint is stored without switching the AC on', () => {
    const s = session('WHEN MOTION DETECTED THEN SET AC TEMPERATURE TO 22C');
    s.setSensor('MOTION', 'DETECTED');
    expect(device(s, 'AC')).toMatchObject({ state: 'OFF', attributes: { TEMPERATURE: 22 } });
  });

  it('OPEN and CLOSE move the curtain', () => {
    const s = session('WHEN MOTION DETECTED THEN OPEN CURTAIN; WHEN MOTION CLEARS THEN CLOSE CURTAIN;');
    s.setSensor('MOTION', 'DETECTED');
    expect(device(s, 'CURTAIN')).toMatchObject({ state: 'OPEN', attributes: { POSITION: 100 } });
    s.setSensor('MOTION', 'CLEAR');
    expect(device(s, 'CURTAIN')).toMatchObject({ state: 'CLOSED', attributes: { POSITION: 0 } });
  });

  it('TOGGLE flips', () => {
    const s = session('WHEN MOTION DETECTED THEN TOGGLE LIGHT');
    s.setSensor('MOTION', 'DETECTED');
    expect(device(s, 'LIGHT').state).toBe('ON');
    s.setSensor('MOTION', 'CLEAR');
    s.setSensor('MOTION', 'DETECTED');
    expect(device(s, 'LIGHT').state).toBe('OFF');
  });

  it('TURN_ON restores a level left at zero', () => {
    const s = session('WHEN MOTION DETECTED THEN SET FAN SPEED TO 0; WHEN MOTION CLEARS THEN TURN_ON FAN;');
    s.setSensor('MOTION', 'DETECTED');
    s.setSensor('MOTION', 'CLEAR');
    expect(device(s, 'FAN')).toMatchObject({ state: 'ON', attributes: { SPEED: 3 } });
  });

  it('logs no change for a device already in that state', () => {
    const s = session('WHEN MOTION DETECTED THEN TURN_OFF AC');
    s.setSensor('MOTION', 'DETECTED');
    expect(texts(s)).toContain('AC: no change (already OFF)');
  });
});

describe('runtime diagnostics', () => {
  it('R501: a cascade stops at depth 16 and the simulation halts', () => {
    const { source } = loadExamples().find((e) => e.name === 'cascade')!;
    const stage = stageResult(compile(source), 'simulation');
    expect(stage.status).toBe('error');
    expect(stage.diagnostics[0]!.code).toBe('R501');
    const s = session(source);
    s.runToEnd();
    expect(s.state.halted).toBe(true);
    expect(texts(s).at(-1)).toContain('R501');
    expect(s.state.minutes).toBe(8 * 60 + 2);
  });

  it('R502: an overflow stops the rule, not the home', () => {
    const huge = '* 1000000000 '.repeat(40);
    const s = session(`WHEN MOTION DETECTED IF TEMPERATURE ${huge}> 0 THEN TURN_ON AC, WAIT 1MIN, TURN_OFF AC`);
    s.setSensor('MOTION', 'DETECTED');
    expect(texts(s).some((t) => t.startsWith('R502'))).toBe(true);
    expect(s.state.halted).toBe(false);
    expect(device(s, 'AC').state).toBe('OFF');
  });

  it('R503: a computed value is clamped to the attribute range', () => {
    const s = session('WHEN MOTION DETECTED THEN SET AC TEMPERATURE TO TEMPERATURE + 50');
    s.setSensor('MOTION', 'DETECTED');
    expect(device(s, 'AC').attributes['TEMPERATURE']).toBe(30);
    expect(texts(s).some((t) => t.startsWith('R503'))).toBe(true);
  });

  it('R504: flapping shows up in the log', () => {
    const { source } = loadExamples().find((e) => e.name === 'hysteresis')!;
    expect(lines(source).some((l) => l.startsWith('R504: FAN'))).toBe(true);
  });
});

describe('WAIT', () => {
  it('ignores a new firing while busy (single mode), and logs it', () => {
    const source = `WHEN MOTION DETECTED THEN TURN_ON LIGHT, WAIT 5MIN, TURN_OFF LIGHT
SIMULATE FROM 08:00 TO 08:10 { AT 08:01: MOTION = DETECTED; AT 08:02: MOTION = CLEAR; AT 08:03: MOTION = DETECTED; }`;
    const log = logOf(source);
    expect(log).toContain('08:03 R1 busy; trigger ignored');
    expect(log).toContain('08:06 Rule R1 fired: TURN_OFF LIGHT');
  });

  it('reads fresh values after a WAIT', () => {
    const source = `WHEN MOTION DETECTED THEN WAIT 2MIN, IF TEMPERATURE > 30 THEN NOTIFY "hot" ELSE NOTIFY "cool" END
SIMULATE FROM 08:00 TO 08:10 { AT 08:01: MOTION = DETECTED; AT 08:02: TEMPERATURE = 31C; }`;
    expect(logOf(source)).toContain('08:03 Rule R1 fired: NOTIFY "hot"');
  });

  it('catches up on an edge missed during a WAIT', () => {
    const source = `IF TEMPERATURE > 30 THEN TURN_ON LIGHT, WAIT 5MIN, NOTIFY "done" ELSE TURN_OFF LIGHT END;
SIMULATE FROM 08:00 TO 08:20 { AT 08:01: TEMPERATURE = 31C; AT 08:02: TEMPERATURE = 25C; }`;
    const log = logOf(source);
    expect(log).toContain('08:06 Rule R1 fired: TURN_OFF LIGHT');
  });
});

describe('the stage output', () => {
  it('says when there is nothing to simulate', () => {
    expect(stageOutput(compile(''), 'simulation')).toMatchObject({ ruleCount: 0, hasScenario: false });
  });

  it('lists the timeline in play order, across midnight', () => {
    const s = session('SIMULATE FROM 23:00 TO 01:00 { AT 00:30: TEMPERATURE = 30C; AT 23:30: TEMPERATURE = 20C; }');
    expect(s.timeline.map((t) => t.seconds)).toEqual([1800, 5400]);
  });

  it('steps one STEP at a time, then finishes', () => {
    const s = session('SIMULATE FROM 08:00 TO 08:02 { }');
    s.step();
    expect(s.state.minutes).toBe(8 * 60 + 1);
    expect(s.finished).toBe(false);
    s.step();
    expect(s.finished).toBe(true);
  });
});
