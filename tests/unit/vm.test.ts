import { describe, expect, it } from 'vitest';
import type { Instr, Value } from '../../src/compiler/codegen/bytecode';
import { compile, emit, stageOutput, stageResult, VmDebugger } from '../../src/compiler/index';
import { inWindow, newFrame, run, step, type VmHost } from '../../src/compiler/runtime/vm';
import { loadExamples } from '../helpers';

interface Recorder extends VmHost {
  log: string[];
}

function host(values: Record<string, Value> = {}, edges: { true?: boolean; false?: boolean } = {}): Recorder {
  const log: string[] = [];
  return {
    log,
    read: (name) => values[name] ?? 0,
    readAttribute: (device, attr) => values[`${device}.${attr}`] ?? 0,
    edgeTrue: (rule, hold) => { log.push(`edgeTrue ${rule} ${hold}`); return edges.true ?? true; },
    edgeFalse: (rule) => { log.push(`edgeFalse ${rule}`); return edges.false ?? true; },
    command: (op, device, origin) => log.push(`${op} ${device} ${origin}`),
    setAttribute: (device, attr, value, origin) => log.push(`SET ${device} ${attr} ${value} ${origin}`),
    notify: (text, origin) => log.push(`NOTIFY ${text} ${origin}`),
    fault: (message) => log.push(`FAULT ${message}`),
  };
}

function exec(code: Instr[], options: { values?: Record<string, Value>; strings?: string[]; h?: Recorder } = {}) {
  const frame = newFrame('R1', 0);
  const h = options.h ?? host(options.values);
  run([...code, ['HALT']], options.strings ?? [], frame, h);
  return { frame, stack: frame.stack, log: h.log };
}

describe('one test per opcode', () => {
  it('PUSH', () => {
    expect(exec([['PUSH', 7]]).stack).toEqual([7]);
    expect(exec([['PUSH', 'ON']]).stack).toEqual(['ON']);
  });

  it('LOAD reads the snapshot', () => {
    expect(exec([['LOAD', 'TEMP']], { values: { TEMP: 31 } }).stack).toEqual([31]);
  });

  it('LOADA reads a device attribute (reserved: no surface syntax yet)', () => {
    expect(exec([['LOADA', 'AC', 'TEMPERATURE']], { values: { 'AC.TEMPERATURE': 24 } }).stack).toEqual([24]);
  });

  it('STORE pops into a local, and LOCAL pushes it back', () => {
    const { stack, frame } = exec([['PUSH', 9], ['STORE', 2], ['LOCAL', 2], ['LOCAL', 2]]);
    expect(stack).toEqual([9, 9]);
    expect(frame.locals[2]).toBe(9);
  });

  it.each([
    ['ADD', 7, 2, 9], ['SUB', 7, 2, 5], ['MUL', 7, 2, 14], ['DIV', 7, 2, 3.5],
  ] as const)('%s', (opcode, a, b, result) => {
    expect(exec([['PUSH', a], ['PUSH', b], [opcode]]).stack).toEqual([result]);
  });

  it('ADD rounds, so run-time values match folded ones', () => {
    expect(exec([['PUSH', 0.1], ['PUSH', 0.2], ['ADD']]).stack).toEqual([0.3]);
  });

  it('DIV by zero reports a fault and halts, instead of producing NaN', () => {
    const { frame, log } = exec([['PUSH', 1], ['PUSH', 0], ['DIV'], ['CMD', 'TURN_ON', 'AC', 'R1']]);
    expect(frame.status).toBe('halted');
    expect(log[0]).toContain('FAULT');
    expect(log).toHaveLength(1);
  });

  it('NEG', () => {
    expect(exec([['PUSH', 5], ['NEG']]).stack).toEqual([-5]);
    expect(Object.is(exec([['PUSH', 0], ['NEG']]).stack[0], 0)).toBe(true);
  });

  it.each([
    ['CMP_GT', 2, 1, 1], ['CMP_GT', 1, 1, 0],
    ['CMP_GE', 1, 1, 1], ['CMP_GE', 0, 1, 0],
    ['CMP_LT', 1, 2, 1], ['CMP_LT', 2, 2, 0],
    ['CMP_LE', 2, 2, 1], ['CMP_LE', 3, 2, 0],
    ['CMP_EQ', 2, 2, 1], ['CMP_EQ', 'ON', 'OFF', 0],
    ['CMP_NE', 'ON', 'OFF', 1], ['CMP_NE', 2, 2, 0],
  ] as const)('%s %s %s gives %i', (opcode, a, b, result) => {
    expect(exec([['PUSH', a], ['PUSH', b], [opcode]]).stack).toEqual([result]);
  });

  it('IN_WINDOW handles plain and midnight-crossing windows', () => {
    expect(exec([['PUSH', 1380], ['IN_WINDOW', 1320, 360]]).stack).toEqual([1]);
    expect(exec([['PUSH', 720], ['IN_WINDOW', 1320, 360]]).stack).toEqual([0]);
    expect(inWindow(1320, 1320, 360)).toBe(true); // starts exactly at a
    expect(inWindow(360, 1320, 360)).toBe(false); // ends just before b
    expect(inWindow(60, 60, 120)).toBe(true);
    expect(inWindow(120, 60, 120)).toBe(false);
    expect(inWindow(60, 60, 60)).toBe(false); // empty window
  });

  it('JMP', () => {
    expect(exec([['JMP', 2], ['PUSH', 1], ['PUSH', 2]]).stack).toEqual([2]);
  });

  it('JMP_IF_FALSE', () => {
    expect(exec([['PUSH', 0], ['JMP_IF_FALSE', 3], ['PUSH', 1], ['PUSH', 2]]).stack).toEqual([2]);
    expect(exec([['PUSH', 1], ['JMP_IF_FALSE', 3], ['PUSH', 1], ['PUSH', 2]]).stack).toEqual([1, 2]);
  });

  it('JMP_IF_TRUE', () => {
    expect(exec([['PUSH', 1], ['JMP_IF_TRUE', 3], ['PUSH', 1], ['PUSH', 2]]).stack).toEqual([2]);
    expect(exec([['PUSH', 0], ['JMP_IF_TRUE', 3], ['PUSH', 1], ['PUSH', 2]]).stack).toEqual([1, 2]);
  });

  it('EDGE_TRUE continues when the host agrees, and halts when it does not', () => {
    expect(exec([['EDGE_TRUE', 'R1', 120], ['PUSH', 1]]).stack).toEqual([1]);
    const blocked = exec([['EDGE_TRUE', 'R1', 0], ['PUSH', 1]], { h: host({}, { true: false }) });
    expect(blocked.frame.status).toBe('halted');
    expect(blocked.stack).toEqual([]);
    expect(blocked.log).toEqual(['edgeTrue R1 0']);
  });

  it('EDGE_FALSE continues when the host agrees, and halts when it does not', () => {
    expect(exec([['EDGE_FALSE', 'R1'], ['PUSH', 1]]).stack).toEqual([1]);
    expect(exec([['EDGE_FALSE', 'R1'], ['PUSH', 1]], { h: host({}, { false: false }) }).stack).toEqual([]);
  });

  it('CMD passes the op, the device and the credited rule', () => {
    expect(exec([['CMD', 'TURN_ON', 'AC', 'R3']]).log).toEqual(['TURN_ON AC R3']);
  });

  it('SETA pops the value', () => {
    expect(exec([['PUSH', 24], ['SETA', 'AC', 'TEMPERATURE', 'R1']]).log).toEqual(['SET AC TEMPERATURE 24 R1']);
  });

  it('WAIT suspends, and the frame resumes where it stopped', () => {
    const frame = newFrame('R1', 0);
    const code: Instr[] = [['WAIT', 300], ['PUSH', 1], ['HALT']];
    const h = host();
    run(code, [], frame, h);
    expect(frame).toMatchObject({ status: 'waiting', waitSeconds: 300, pc: 1 });
    frame.status = 'running';
    run(code, [], frame, h);
    expect(frame.status).toBe('halted');
    expect(frame.stack).toEqual([1]);
  });

  it('NOTIFY looks up the string table', () => {
    expect(exec([['NOTIFY', 1, 'R1']], { strings: ['a', 'hello'] }).log).toEqual(['NOTIFY hello R1']);
  });

  it('HALT stops', () => {
    expect(exec([['HALT'], ['PUSH', 1]]).stack).toEqual([]);
  });

  it('step executes exactly one instruction', () => {
    const frame = newFrame('R1', 0);
    step([['PUSH', 1], ['PUSH', 2], ['HALT']], [], frame, host());
    expect(frame.pc).toBe(1);
    expect(frame.stack).toEqual([1]);
  });
});

describe('code generation', () => {
  const object = (source: string, optimize = true) => stageOutput(compile(source, { optimize }), 'codegen')!;

  it('produces the bytecode of §14.1 for the brief', () => {
    expect(object('IF TEMPERATURE > 30 THEN TURN_ON AC').code).toEqual([
      ['LOAD', 'TEMPERATURE'], ['PUSH', 30], ['CMP_GT'], ['JMP_IF_FALSE', 7],
      ['EDGE_TRUE', 'R1', 0], ['CMD', 'TURN_ON', 'AC', 'R1'], ['HALT'],
      ['EDGE_FALSE', 'R1'], ['HALT'],
    ]);
  });

  it('reads a shared value once, so O6 reaches the bytecode', () => {
    const { code } = object('IF TEMPERATURE > 1 AND TEMPERATURE < 9 THEN NOTIFY "x"');
    expect(code.filter((i) => i[0] === 'LOAD')).toHaveLength(1);
    expect(code.slice(0, 2)).toEqual([['LOAD', 'TEMPERATURE'], ['STORE', 0]]);
    expect(code.filter((i) => i[0] === 'LOCAL')).toHaveLength(2);
  });

  it('translates quad targets to bytecode addresses', () => {
    const { code } = object('IF TEMPERATURE > 1 AND HUMIDITY > 2 THEN NOTIFY "x" ELSE NOTIFY "y"');
    for (const instr of code) {
      if (instr[0] === 'JMP' || instr[0] === 'JMP_IF_FALSE' || instr[0] === 'JMP_IF_TRUE') {
        expect(instr[1]).toBeGreaterThan(0);
        expect(instr[1]).toBeLessThan(code.length);
      }
    }
  });

  it('shares strings', () => {
    expect(object('AT 07:00 THEN NOTIFY "a", NOTIFY "a", NOTIFY "b"').strings).toEqual(['a', 'b']);
  });

  it('records rule metadata', () => {
    const { rules } = object('RULE "Cool" PRIORITY 2: IF TEMPERATURE > 30 AND HUMIDITY > 5 FOR 2MIN THEN TURN_ON AC, SET AC TEMPERATURE TO 24C ELSE TURN_OFF AC END; WHEN MOTION RISES ABOVE 3 THEN NOTIFY "x";'.replace('WHEN MOTION RISES ABOVE 3 THEN NOTIFY "x"', 'WHEN TEMPERATURE RISES ABOVE 30C THEN NOTIFY "x"'));
    expect(rules[0]).toMatchObject({
      id: 'R1', name: 'Cool', kind: 'STATE', priority: 2, entry: 0,
      reads: ['TEMPERATURE', 'HUMIDITY'], writes: ['AC', 'AC.TEMPERATURE'], source: { line: 1 },
    });
    expect(rules[1]).toMatchObject({ kind: 'EVENT', event: { source: 'TEMPERATURE', event: 'RISES_ABOVE', threshold: 30 } });
  });

  it('expands time rules and scenarios', () => {
    const file = object('AT 07:00 ON WEEKDAYS THEN NOTIFY "x" SIMULATE FROM 22:00 TO 06:00 STEP 5MIN { AT 01:00: TEMPERATURE = 86F; AT 23:00: DAY = TUE; }');
    expect(file.rules[0]).toMatchObject({ kind: 'TIME', time: { minutes: 420, days: ['WEEKDAYS'] } });
    expect(file.scenario).toEqual({
      from: 1320, to: 360, stepSeconds: 300,
      events: [
        { minutes: 1380, assigns: [{ name: 'DAY', value: 'TUE' }] },
        { minutes: 60, assigns: [{ name: 'TEMPERATURE', value: 30 }] },
      ],
    });
  });

  it('lists the home, with initial values', () => {
    const file = object('IF TEMPERATURE > 30 THEN TURN_ON AC');
    expect(file.rooms).toEqual(['LIVING_ROOM', 'BEDROOM', 'KITCHEN', 'ENTRANCE']);
    expect(file.devices[0]).toMatchObject({
      name: 'AC', type: 'AIR_CONDITIONER', room: 'LIVING_ROOM', initialState: 'OFF',
      attributes: { TEMPERATURE: 26, MODE: 'COOL' }, ranges: { TEMPERATURE: [16, 30] },
    });
    expect(file.sensors[0]).toMatchObject({ name: 'TEMPERATURE', unit: '°C', initial: 28 });
  });

  it('removed rules do not appear', () => {
    expect(object('IF FALSE THEN TURN_ON AC').rules).toEqual([]);
  });

  it('can compile unoptimized code too', () => {
    const { code } = object('IF TEMPERATURE > 86F FOR 2MIN THEN TURN_ON AC, WAIT 5MIN, TURN_OFF AC', false);
    expect(code).toContainEqual(['PUSH', 30]);
    expect(code).toContainEqual(['WAIT', 300]);
    expect(code.some((i) => i[0] === 'JMP')).toBe(true);
  });

  it.each(loadExamples().map((e) => [e.name, e.source] as const))('emits valid JSON: %s', (_name, source) => {
    const stage = stageResult(compile(source), 'codegen');
    if (stage.output) expect(() => JSON.parse(emit('bytecode', stage))).not.toThrow();
  });
});

describe('the debugger', () => {
  const object = stageOutput(compile('IF TEMPERATURE > 30 THEN TURN_ON AC ELSE TURN_OFF AC'), 'codegen')!;

  it('walks the THEN path one instruction at a time', () => {
    const vm = new VmDebugger(object, 'R1', { TEMPERATURE: 31 });
    vm.step();
    expect(vm.frame.stack).toEqual([31]);
    vm.step();
    expect(vm.frame.stack).toEqual([31, 30]);
    vm.step();
    expect(vm.frame.stack).toEqual([1]);
    while (!vm.done) vm.step();
    expect(vm.effects.map((e) => e.text)).toEqual(['R1 went false → true, so THEN runs', 'TURN_ON AC']);
  });

  it('takes the ELSE path when the condition has just gone false', () => {
    const vm = new VmDebugger(object, 'R1', { TEMPERATURE: 20 }, true);
    while (!vm.done) vm.step();
    expect(vm.effects.map((e) => e.text)).toEqual(['R1 went true → false, so ELSE runs', 'TURN_OFF AC']);
  });

  it('stops at the edge guard when nothing changed', () => {
    const vm = new VmDebugger(object, 'R1', { TEMPERATURE: 31 }, true);
    while (!vm.done) vm.step();
    expect(vm.effects.map((e) => e.text)).toEqual(['R1 was already true, so nothing fires']);
  });
});
