import { describe, expect, it } from 'vitest';
import { compile, emit, quadColumns, stageOutput, stageResult } from '../../src/compiler/index';
import { loadExamples } from '../helpers';

function ir(source: string) {
  const result = compile(source);
  expect(stageResult(result, 'ir').status).not.toBe('skipped');
  return stageOutput(result, 'ir')!;
}
const listing = (source: string) => emit('ir', stageResult(compile(source), 'ir')).trim().split('\n');
const bodies = (source: string) => listing(source).map((line) => line.replace(/^\d+ /, ''));
const advanced = loadExamples().find((e) => e.name === 'advanced')!.source;

describe('the worked example of §6.2', () => {
  const { program, steps, cfg } = ir(advanced);
  const r1 = program.routines[0]!;
  const quads = program.quads.slice(0, r1.end - 100);

  it('is 17 quads numbered 100 to 116', () => {
    expect(quads.map((q) => q.index)).toEqual(Array.from({ length: 17 }, (_, i) => 100 + i));
  });

  it('patches every jump to the target in the plan', () => {
    const targets = Object.fromEntries(quads.flatMap((q) => 'target' in q ? [[q.index, q.target]] : []));
    expect(targets).toEqual({ 102: 104, 103: 114, 105: 110, 106: 107, 108: 110, 109: 114 });
  });

  it('applies the patches in the order backpatching does', () => {
    const patches = steps.filter((s) => s.patched.length > 0).slice(0, 4).map((s) => [s.patched, s.target]);
    expect(patches).toEqual([
      [[106], 107], // OR: B1 false goes to B2
      [[102], 104], // AND: B1 true goes to B2
      [[105, 108], 110], // B.truelist goes to THEN
      [[103, 109], 114], // B.falselist goes to ELSE
    ]);
  });

  it('shows an unfilled target before its patch: the animation has real states', () => {
    const emitStep = steps.find((s) => s.note.includes('if t1 > t2'))!;
    expect(emitStep.note).toBe('emit if t1 > t2 goto _');
  });

  it('has the eight basic blocks of §6.3', () => {
    const r1Blocks = cfg.blocks.filter((b) => b.ruleId === 'R1');
    expect(r1Blocks.map((b) => [b.start, b.end - 1])).toEqual([
      [100, 102], [103, 103], [104, 105], [106, 106], [107, 108], [109, 109], [110, 113], [114, 116],
    ]);
  });

  it('colours CFG edges by truth value', () => {
    const edges = cfg.edges.filter((e) => e.from === 'B0');
    expect(edges).toEqual([
      { from: 'B0', to: 'B2', kind: 'true' },
      { from: 'B0', to: 'B1', kind: 'false' },
    ]);
  });

  it('never leaves a target unfilled', () => {
    for (const q of program.quads) if ('target' in q) expect(q.target).not.toBeNull();
  });
});

describe('the brief (§14.1)', () => {
  it('lowers to the listing in the plan', () => {
    expect(listing('IF TEMPERATURE > 30 THEN TURN_ON AC')).toEqual([
      '100 t1 := LOAD TEMPERATURE',
      '101 if t1 > 30 goto 103',
      '102 goto 106',
      '103 EDGE_TRUE R1',
      '104 CALL TURN_ON AC',
      '105 RET',
      '106 EDGE_FALSE R1',
      '107 RET',
    ]);
  });
});

describe('jumping code', () => {
  it('emits no instruction for NOT, only swapped lists', () => {
    const plain = listing('IF TEMPERATURE > 30 THEN TURN_ON AC');
    const negated = listing('IF NOT TEMPERATURE > 30 THEN TURN_ON AC');
    expect(negated.length).toBe(plain.length);
    expect(negated[1]).toBe('101 if t1 > 30 goto 106');
    expect(negated[2]).toBe('102 goto 103');
  });

  it('short-circuits AND: the second test is reached only if the first holds', () => {
    expect(listing('IF TEMPERATURE > 30 AND HUMIDITY > 50 THEN TURN_ON AC').slice(0, 6)).toEqual([
      '100 t1 := LOAD TEMPERATURE',
      '101 if t1 > 30 goto 103',
      '102 goto 109',
      '103 t2 := LOAD HUMIDITY',
      '104 if t2 > 50 goto 106',
      '105 goto 109',
    ]);
  });

  it('short-circuits OR: the second test is reached only if the first fails', () => {
    expect(listing('IF TEMPERATURE > 30 OR HUMIDITY > 50 THEN TURN_ON AC').slice(1, 3)).toEqual([
      '101 if t1 > 30 goto 106',
      '102 goto 103',
    ]);
  });

  it('lowers TRUE and FALSE to a single goto', () => {
    expect(bodies('IF TRUE THEN NOTIFY "x"')[0]).toBe('goto 101');
    expect(bodies('IF FALSE THEN NOTIFY "x"')[0]).toBe('goto 104');
  });

  it('lowers IS and IS NOT', () => {
    expect(bodies('IF DOOR IS LOCKED THEN NOTIFY "x"')[1]).toBe('if t1 == LOCKED goto 103');
    expect(bodies('IF DOOR IS NOT LOCKED THEN NOTIFY "x"')[1]).toBe('if t1 == LOCKED goto 106');
  });

  it('uses a window test for time and two comparisons for numbers', () => {
    expect(bodies('IF TIME BETWEEN 22:00 AND 06:00 THEN NOTIFY "x"')[1]).toBe('if t1 IN [1320, 360) goto 103');
    const numeric = bodies('IF TEMPERATURE BETWEEN 20 AND 25 THEN NOTIFY "x"');
    expect(numeric.slice(0, 5)).toEqual([
      't1 := LOAD TEMPERATURE', 'if t1 >= 20 goto 103', 'goto 108', 'if t1 <= 25 goto 105', 'goto 108',
    ]);
  });

  it('computes arithmetic with temporaries, left to right', () => {
    expect(bodies('IF TEMPERATURE + 2 * 3 > 30 THEN NOTIFY "x"').slice(0, 4)).toEqual([
      't1 := LOAD TEMPERATURE', 't2 := 2 * 3', 't3 := t1 + t2', 'if t3 > 30 goto 105',
    ]);
  });

  it('negates with NEG, leaving folding to the optimizer', () => {
    expect(bodies('IF TEMPERATURE > -5C THEN NOTIFY "x"').slice(1, 2)).toEqual(['t2 := NEG 5']);
  });

  it('keeps unit conversions as instructions for O2', () => {
    expect(bodies('IF TEMPERATURE > 86F FOR 2MIN THEN NOTIFY "x"')[1]).toBe('t2 := CVT_F_TO_C 86');
    expect(bodies('WHEN MOTION DETECTED THEN WAIT 5MIN, NOTIFY "x"')[0]).toBe('t1 := CVT_MIN_TO_S 5');
    expect(bodies('WHEN MOTION DETECTED THEN WAIT 2H, NOTIFY "x"')[0]).toBe('t1 := CVT_H_TO_S 2');
    expect(bodies('IF TIME > 22:00 THEN NOTIFY "x"')[1]).toBe('t2 := CVT_TIME_TO_MIN 22:00');
  });
});

describe('rule shapes', () => {
  it('gives every IF rule both edge guards, even with no ELSE', () => {
    const text = bodies('IF TEMPERATURE > 30 THEN TURN_ON AC');
    expect(text).toContain('EDGE_TRUE R1');
    expect(text).toContain('EDGE_FALSE R1');
  });

  it('puts the hold time on EDGE_TRUE', () => {
    expect(bodies('IF TEMPERATURE > 30 FOR 2MIN THEN NOTIFY "x"')).toContain('EDGE_TRUE R1 hold=120');
  });

  it('gives WHEN and AT rules no edge guard', () => {
    expect(bodies('WHEN MOTION DETECTED THEN NOTIFY "x"')).toEqual(['NOTIFY "x"', 'RET']);
    expect(bodies('AT 07:00 THEN NOTIFY "x"')).toEqual(['NOTIFY "x"', 'RET']);
  });

  it('jumps past the actions when a guard fails', () => {
    expect(listing('WHEN MOTION DETECTED IF DOOR IS LOCKED THEN NOTIFY "x"')).toEqual([
      '100 t1 := LOAD DOOR',
      '101 if t1 == LOCKED goto 103',
      '102 goto 104',
      '103 NOTIFY "x"',
      '104 RET',
    ]);
  });

  it('lowers a nested IF with ELSE, jumping over the ELSE', () => {
    expect(listing('WHEN MOTION DETECTED THEN IF DOOR IS LOCKED THEN NOTIFY "a" ELSE NOTIFY "b" END, NOTIFY "c"')).toEqual([
      '100 t1 := LOAD DOOR',
      '101 if t1 == LOCKED goto 103',
      '102 goto 105',
      '103 NOTIFY "a"',
      '104 goto 106',
      '105 NOTIFY "b"',
      '106 NOTIFY "c"',
      '107 RET',
    ]);
  });

  it('lowers every action kind', () => {
    expect(bodies('WHEN MOTION DETECTED THEN TURN_ON LIGHT, SET LIGHT BRIGHTNESS TO 50%, WAIT 30S, TURN_OFF LIGHT, NOTIFY "x"')).toEqual([
      'CALL TURN_ON LIGHT', 'CALL SET LIGHT BRIGHTNESS, 50', 'WAIT 30', 'CALL TURN_OFF LIGHT', 'NOTIFY "x"', 'RET',
    ]);
  });

  it('numbers rules in one dense sequence', () => {
    const { program } = ir('IF TEMPERATURE > 30 THEN TURN_ON AC END; IF HUMIDITY > 50 THEN TURN_ON FAN END;');
    expect(program.routines.map((r) => [r.ruleId, r.start, r.end])).toEqual([['R1', 100, 108], ['R2', 108, 116]]);
    expect(program.quads.map((q) => q.index)).toEqual(Array.from({ length: 16 }, (_, i) => 100 + i));
  });

  it('produces no quads for a program with no rules', () => {
    expect(ir('').program.quads).toEqual([]);
    expect(ir('').cfg.blocks).toEqual([]);
  });
});

describe('quadruple columns', () => {
  it('splits a quad into (op, arg1, arg2, result)', () => {
    const { program } = ir('IF TEMPERATURE > 30 THEN TURN_ON AC');
    expect(quadColumns(program.quads[0]!)).toEqual({ op: 'LOAD', arg1: 'TEMPERATURE', arg2: '', result: 't1' });
    expect(quadColumns(program.quads[1]!)).toEqual({ op: 'if >', arg1: 't1', arg2: '30', result: '103' });
  });
});

describe('every example lowers without leaving a jump open', () => {
  it.each(loadExamples().map((e) => [e.name, e.source] as const))('%s', (_name, source) => {
    const output = stageOutput(compile(source), 'ir');
    for (const q of output?.program.quads ?? []) {
      if ('target' in q) expect(q.target).not.toBeNull();
    }
  });
});
