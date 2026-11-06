import { describe, expect, it } from 'vitest';
import { compile, emit, stageOutput, stageResult, type PassReport } from '../../src/compiler/index';
import { loadExamples } from '../helpers';

const output = (source: string) => stageOutput(compile(source), 'optimizer')!;
const opt = (source: string) => emit('opt', stageResult(compile(source), 'optimizer')).trim().split('\n').filter(Boolean);
const bodies = (source: string) => opt(source).map((line) => line.replace(/^\d+ /, ''));
const pass = (source: string, id: string): PassReport => output(source).passes.find((p) => p.id === id)!;
const changed = (source: string, id: string) => pass(source, id).changes.length > 0;

describe('O1 constant folding', () => {
  it('folds arithmetic', () => {
    expect(bodies('IF TEMPERATURE > 30 + 2 THEN NOTIFY "x"')[1]).toBe('ifFalse t1 > 32 goto 105');
    expect(pass('IF TEMPERATURE > 30 + 2 THEN NOTIFY "x"', 'O1').changes[0]).toEqual({ before: 't2 := 30 + 2', after: 't2 is 32' });
  });

  it('folds unary minus', () => {
    expect(bodies('IF TEMPERATURE > -5C THEN NOTIFY "x"')[1]).toBe('ifFalse t1 > -5 goto 105');
  });

  it('folds a chain through its temporaries', () => {
    expect(bodies('IF TEMPERATURE > 2 + 3 * 4 THEN NOTIFY "x"')[1]).toBe('ifFalse t1 > 14 goto 105');
  });

  it('avoids float drift with the shared rounding', () => {
    expect(bodies('IF TEMPERATURE > 0.1 + 0.2 THEN NOTIFY "x"')[1]).toBe('ifFalse t1 > 0.3 goto 105');
  });

  it('leaves a sensor expression alone', () => {
    expect(changed('IF TEMPERATURE + 1 > 30 THEN NOTIFY "x"', 'O1')).toBe(false);
  });
});

describe('O2 unit normalization', () => {
  it('converts Fahrenheit', () => {
    expect(pass('IF TEMPERATURE > 86F THEN NOTIFY "x"', 'O2').changes[0]).toEqual({ before: 't2 := CVT_F_TO_C 86', after: 't2 is 30' });
    expect(bodies('IF TEMPERATURE > 86F THEN NOTIFY "x"')[1]).toBe('ifFalse t1 > 30 goto 105');
  });

  it('converts durations and times', () => {
    expect(bodies('WHEN MOTION DETECTED THEN WAIT 5MIN, NOTIFY "x"')[0]).toBe('WAIT 300');
    expect(bodies('WHEN MOTION DETECTED THEN WAIT 2H, NOTIFY "x"')[0]).toBe('WAIT 7200');
    expect(bodies('IF TIME > 22:00 THEN NOTIFY "x"')[1]).toBe('ifFalse t1 > 1320 goto 105');
  });
});

describe('O3 boolean simplification', () => {
  const cases: [string, string][] = [
    ['NOT NOT TEMPERATURE > 1', 'TEMPERATURE > 1'],
    ['TEMPERATURE > 1 AND TRUE', 'TEMPERATURE > 1'],
    ['TRUE AND TEMPERATURE > 1', 'TEMPERATURE > 1'],
    ['TEMPERATURE > 1 OR FALSE', 'TEMPERATURE > 1'],
    ['NOT TEMPERATURE > 1', 'TEMPERATURE <= 1'],
    ['NOT DOOR IS LOCKED', 'DOOR IS NOT LOCKED'],
  ];
  it.each(cases)('%s becomes %s', (before, after) => {
    expect(pass(`IF ${before} THEN NOTIFY "x"`, 'O3').changes.at(-1)!.after).toBe(`R1: ${after}`);
  });

  it('reduces x OR TRUE to TRUE and x AND FALSE to FALSE', () => {
    expect(pass('IF TEMPERATURE > 1 OR TRUE THEN NOTIFY "x"', 'O3').changes[0]!.after).toBe('R1: TRUE');
    expect(pass('IF TEMPERATURE > 1 AND FALSE THEN NOTIFY "x"', 'O3').changes[0]!.after).toBe('R1: FALSE');
  });

  it('simplifies nested IFs and guards too', () => {
    expect(changed('WHEN MOTION DETECTED IF NOT NOT DOOR IS LOCKED THEN NOTIFY "x"', 'O3')).toBe(true);
    expect(changed('AT 07:00 THEN IF NOT NOT DOOR IS LOCKED THEN NOTIFY "x" END', 'O3')).toBe(true);
  });

  it('evaluates comparisons of constants', () => {
    expect(pass('IF 3 > 4 THEN NOTIFY "x"', 'O3').changes[0]!.after).toBe('R1: FALSE');
  });
});

describe('O4 range merging', () => {
  const cases: [string, string][] = [
    ['TEMPERATURE > 25 AND TEMPERATURE > 30', 'TEMPERATURE > 30'],
    ['TEMPERATURE > 30 AND TEMPERATURE > 25', 'TEMPERATURE > 30'],
    ['TEMPERATURE < 25 AND TEMPERATURE < 30', 'TEMPERATURE < 25'],
    ['TEMPERATURE > 25 OR TEMPERATURE > 30', 'TEMPERATURE > 25'],
    ['TEMPERATURE >= 30 AND TEMPERATURE > 30', 'TEMPERATURE > 30'],
    ['TEMPERATURE > 25 AND 30 < TEMPERATURE', '30 < TEMPERATURE'],
  ];
  it.each(cases)('%s becomes %s', (before, after) => {
    expect(pass(`IF ${before} THEN NOTIFY "x"`, 'O4').changes[0]!.after).toBe(`R1: ${after}`);
  });

  it('keeps bounds on opposite sides and on other sensors', () => {
    expect(changed('IF TEMPERATURE > 25 AND TEMPERATURE < 30 THEN NOTIFY "x"', 'O4')).toBe(false);
    expect(changed('IF TEMPERATURE > 25 AND HUMIDITY > 30 THEN NOTIFY "x"', 'O4')).toBe(false);
  });
});

describe('O5 dead-rule elimination', () => {
  it('removes a rule that can never fire', () => {
    expect(output('IF TEMPERATURE > 30 AND TEMPERATURE < 20 THEN TURN_ON AC').program.quads).toEqual([]);
    expect(pass('IF TEMPERATURE > 30 AND TEMPERATURE < 20 THEN TURN_ON AC', 'O5').changes[0]!.after).toBe('(rule removed)');
  });

  it('keeps the rest of the program', () => {
    expect(output('IF FALSE THEN TURN_ON AC END; IF TEMPERATURE > 1 THEN TURN_OFF AC END;').program.routines.map((r) => r.ruleId)).toEqual(['R2']);
  });

  it('keeps THEN of a tautology and drops its ELSE', () => {
    const text = bodies('IF TEMPERATURE > 20 OR TEMPERATURE <= 20 THEN TURN_ON AC ELSE TURN_OFF AC');
    expect(text).toEqual(['EDGE_TRUE R1', 'CALL TURN_ON AC', 'RET']);
  });

  it('removes a dead nested branch, and inlines a live one', () => {
    expect(bodies('AT 07:00 THEN IF FALSE THEN NOTIFY "a" ELSE NOTIFY "b" END, NOTIFY "c"')).toEqual(['NOTIFY "b"', 'NOTIFY "c"', 'RET']);
    expect(bodies('AT 07:00 THEN IF TRUE THEN NOTIFY "a" ELSE NOTIFY "b" END')).toEqual(['NOTIFY "a"', 'RET']);
  });

  it('removes a WHEN rule whose guard is impossible', () => {
    expect(output('WHEN MOTION DETECTED IF DOOR IS LOCKED AND DOOR IS UNLOCKED THEN NOTIFY "x"').program.quads).toEqual([]);
  });
});

describe('O6 common subexpression elimination', () => {
  it('reads a sensor once per rule', () => {
    const text = bodies('IF TEMPERATURE > 1 AND TEMPERATURE < 9 THEN NOTIFY "x"');
    expect(text.filter((l) => l.includes('LOAD'))).toHaveLength(1);
    expect(text[2]).toBe('ifFalse t1 < 9 goto 106');
  });

  it('reuses arithmetic too', () => {
    const text = bodies('IF TEMPERATURE + 1 > 5 AND TEMPERATURE + 1 < 9 THEN NOTIFY "x"');
    expect(text.filter((l) => l.includes('+'))).toHaveLength(1);
  });

  it('does NOT reuse a load that short-circuiting may have skipped', () => {
    // The first LOAD TEMPERATURE sits behind HUMIDITY > 5. If that test fails,
    // the OR branch runs without it, so the second load must stay.
    const source = 'IF HUMIDITY > 5 AND TEMPERATURE > 1 OR TEMPERATURE < 0 THEN NOTIFY "x"';
    expect(bodies(source).filter((l) => l.includes('LOAD TEMPERATURE'))).toHaveLength(2);
    expect(changed(source, 'O6')).toBe(false);
  });

  it('reuses a load both paths computed', () => {
    const source = 'IF TEMPERATURE > 5 AND HUMIDITY > 1 OR TEMPERATURE < 0 THEN NOTIFY "x"';
    expect(bodies(source).filter((l) => l.includes('LOAD TEMPERATURE'))).toHaveLength(1);
  });

  it('never reuses a value across a WAIT, which takes a fresh snapshot', () => {
    const source = 'WHEN MOTION DETECTED IF TEMPERATURE > 1 THEN WAIT 1MIN, IF TEMPERATURE > 2 THEN NOTIFY "x" END END';
    expect(bodies(source).filter((l) => l.includes('LOAD TEMPERATURE'))).toHaveLength(2);
  });
});

describe('O7 redundant actions', () => {
  it('removes a repeated command', () => {
    expect(bodies('AT 07:00 THEN TURN_ON AC, TURN_ON AC')).toEqual(['CALL TURN_ON AC', 'RET']);
  });

  it('keeps only the last SET', () => {
    expect(bodies('AT 07:00 THEN SET AC TEMPERATURE TO 20C, SET AC TEMPERATURE TO 24C')).toEqual(['CALL SET AC TEMPERATURE, 24', 'RET']);
  });

  it('never merges across a WAIT', () => {
    const text = bodies('AT 07:00 THEN TURN_ON AC, WAIT 1MIN, TURN_ON AC');
    expect(text.filter((l) => l === 'CALL TURN_ON AC')).toHaveLength(2);
    expect(bodies('AT 07:00 THEN SET AC TEMPERATURE TO 20C, WAIT 1MIN, SET AC TEMPERATURE TO 24C')).toHaveLength(4);
  });

  it('keeps TOGGLE, which is not idempotent', () => {
    expect(bodies('AT 07:00 THEN TOGGLE AC, TOGGLE AC').filter((l) => l === 'CALL TOGGLE AC')).toHaveLength(2);
  });

  it('keeps an earlier SET when a power command sits between', () => {
    const text = bodies('AT 07:00 THEN SET LIGHT BRIGHTNESS TO 20%, TURN_OFF LIGHT, SET LIGHT BRIGHTNESS TO 40%');
    expect(text.filter((l) => l.includes('SET LIGHT'))).toHaveLength(2);
  });

  it('keeps duplicates credited to different merged rules', () => {
    const source = 'IF TEMPERATURE > 1 THEN TURN_ON AC END; IF TEMPERATURE > 1 THEN TURN_ON AC END;';
    expect(bodies(source).filter((l) => l === 'CALL TURN_ON AC')).toHaveLength(2);
  });
});

describe('O8 jump optimization', () => {
  it('inverts a branch over a goto', () => {
    expect(bodies('IF TEMPERATURE > 30 THEN TURN_ON AC')).toEqual([
      't1 := LOAD TEMPERATURE', 'ifFalse t1 > 30 goto 105', 'EDGE_TRUE R1', 'CALL TURN_ON AC', 'RET', 'EDGE_FALSE R1', 'RET',
    ]);
  });

  it('removes goto next', () => {
    expect(bodies('IF TRUE THEN NOTIFY "x"').some((l) => l.startsWith('goto'))).toBe(false);
  });

  it('threads a jump to a jump', () => {
    const before = pass('AT 07:00 THEN IF DOOR IS LOCKED THEN IF DOOR IS NOT LOCKED THEN NOTIFY "a" END ELSE NOTIFY "b" END', 'O8');
    expect(before.quadsAfter).toBeLessThan(before.quadsBefore);
  });

  it('counts jumps removed', () => {
    const { totals } = output('IF TEMPERATURE > 30 THEN TURN_ON AC');
    expect(totals).toEqual({ quadsBefore: 8, quadsAfter: 7, jumpsBefore: 2, jumpsAfter: 1 });
  });
});

describe('O9 rule merging', () => {
  const same = 'IF TEMPERATURE > 30 THEN TURN_ON AC END; IF TEMPERATURE > 30 THEN TURN_ON FAN END;';

  it('merges neighbouring rules with one condition', () => {
    const { ast, program } = output(same);
    expect(ast.rules).toHaveLength(1);
    expect(ast.rules[0]!.mergedFrom).toEqual(['R1', 'R2']);
    expect(program.quads.filter((q) => q.kind === 'edgeTrue')).toHaveLength(1);
  });

  it('keeps each action credited to its own rule', () => {
    const calls = output(same).program.quads.filter((q) => q.kind === 'call');
    expect(calls.map((q) => q.kind === 'call' && [q.device, q.origin])).toEqual([['AC', 'R1'], ['FAN', 'R2']]);
  });

  it('does not merge rules with a rule between them, which would reorder its effects', () => {
    const source = 'IF TEMPERATURE > 30 THEN TURN_ON AC END; IF HUMIDITY > 5 THEN TURN_ON LIGHT END; IF TEMPERATURE > 30 THEN TURN_ON FAN END;';
    expect(output(source).ast.rules).toHaveLength(3);
  });

  it('does not merge different priorities, holds or a WAIT', () => {
    expect(output('RULE "a" PRIORITY 2: IF TEMPERATURE > 30 THEN TURN_ON AC END; IF TEMPERATURE > 30 THEN TURN_ON FAN END;').ast.rules).toHaveLength(2);
    expect(output('IF TEMPERATURE > 30 FOR 1MIN THEN TURN_ON AC END; IF TEMPERATURE > 30 THEN TURN_ON FAN END;').ast.rules).toHaveLength(2);
    expect(output('IF TEMPERATURE > 30 THEN TURN_ON AC, WAIT 1MIN END; IF TEMPERATURE > 30 THEN TURN_ON FAN END;').ast.rules).toHaveLength(2);
  });
});

describe('the pipeline', () => {
  const advanced = loadExamples().find((e) => e.name === 'advanced')!.source;

  it('turns the §6.2 rule into the shape of §7', () => {
    const lines = bodies(advanced).slice(0, 13);
    expect(lines).toEqual([
      't1 := LOAD TEMP',
      'ifFalse t1 > 30 goto 110',
      't3 := LOAD MOTION',
      'if t3 == DETECTED goto 106',
      't4 := LOAD TIME',
      'ifFalse t4 IN [1320, 360) goto 110',
      'EDGE_TRUE R1 hold=120',
      'CALL TURN_ON AC',
      'CALL SET AC TEMPERATURE, 24',
      'RET',
      'EDGE_FALSE R1',
      'CALL TURN_OFF AC',
      'RET',
    ]);
  });

  it('numbers densely after optimizing, with no gap', () => {
    const { program } = output(advanced);
    expect(program.quads.map((q) => q.index)).toEqual(program.quads.map((_, i) => 100 + i));
  });

  it('reports all nine passes, with their real run order', () => {
    const { passes } = output(advanced);
    expect(passes.map((p) => p.id)).toEqual(['O3', 'O4', 'O5', 'O9', 'O2', 'O1', 'O6', 'O7', 'O8']);
    expect(passes.map((p) => p.runOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const p of passes) expect(p.reason.length).toBeGreaterThan(10);
  });

  it('can be switched off for the differential test', () => {
    const result = compile(advanced, { optimize: false });
    const { program, passes } = stageOutput(result, 'optimizer')!;
    expect(passes).toEqual([]);
    expect(program).toEqual(stageOutput(result, 'ir')!.program);
  });

  it.each(loadExamples().map((e) => [e.name, e.source] as const))('leaves every jump inside its routine: %s', (_name, source) => {
    const stage = stageOutput(compile(source), 'optimizer');
    if (!stage) return;
    const { quads, routines } = stage.program;
    for (const routine of routines) {
      for (const q of quads.slice(routine.start - 100, routine.end - 100)) {
        if ('target' in q) {
          expect(q.target).toBeGreaterThan(q.index);
          expect(q.target).toBeLessThan(routine.end);
        }
      }
      expect(quads[routine.end - 101]!.kind).toBe('ret');
    }
  });
});

describe('the optimizer demo example', () => {
  it('gives every one of the nine passes something to do', () => {
    const { source } = loadExamples().find((e) => e.name === 'optimizer')!;
    const idle = output(source).passes.filter((p) => p.changes.length === 0).map((p) => p.id);
    expect(idle).toEqual([]);
    expect(output(source).passes).toHaveLength(9);
  });
});
