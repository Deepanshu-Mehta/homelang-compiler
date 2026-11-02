import { describe, expect, it } from 'vitest';
import { compile, emit, stageOutput, stageResult, type CompileResult } from '../src/compiler/index';
import { astExecutor } from '../src/compiler/runtime/astInterpreter';
import { Session } from '../src/compiler/runtime/simulator';
import { vmExecutor } from '../src/compiler/runtime/scheduler';
import { loadExamples, seededRandom } from './helpers';

interface Trace {
  log: string[];
  devices: unknown;
  notifications: unknown;
}

function runSession(session: Session): Trace {
  session.runToEnd();
  const { state } = session;
  return {
    log: session.log.map((e) => `${e.time} ${e.text}`),
    devices: state.devices.map((d) => [d.name, d.state, d.attributes]),
    notifications: state.notifications,
  };
}

/** The same program three ways. Every pair must agree exactly. */
function threeWays(source: string): { ast: Trace; vmPlain: Trace; vmOptimized: Trace } | null {
  const optimized = compile(source);
  const plain = compile(source, { optimize: false });
  const objectOptimized = stageOutput(optimized, 'codegen');
  const objectPlain = stageOutput(plain, 'codegen');
  const semantic = stageOutput(plain, 'semantic');
  if (!objectOptimized || !objectPlain || !semantic) return null;
  return {
    ast: runSession(new Session(objectPlain, astExecutor(semantic.annotated.rules))),
    vmPlain: runSession(new Session(objectPlain, vmExecutor(objectPlain))),
    vmOptimized: runSession(new Session(objectOptimized, vmExecutor(objectOptimized))),
  };
}

function expectSame(source: string): void {
  const runs = threeWays(source);
  if (!runs) throw new Error(`This program does not compile, so nothing was compared:\n${source}`);
  expect(runs.vmPlain, `VM without optimizer differs from the AST interpreter on:\n${source}`).toEqual(runs.ast);
  expect(runs.vmOptimized, `optimized VM differs from the AST interpreter on:\n${source}`).toEqual(runs.ast);
}

describe('differential: AST interpreter, plain VM and optimized VM agree', () => {
  const valid = loadExamples().filter((e) => stageOutput(compile(e.source), 'codegen'));

  it('covers every valid example', () => {
    expect(valid.map((e) => e.name)).toEqual(expect.arrayContaining([
      'brief', 'living-room', 'night-security', 'advanced', 'conflict', 'hysteresis', 'cascade',
    ]));
  });

  it.each(valid.map((e) => [e.name, e.source] as const))('%s', (_name, source) => {
    expectSame(source);
  });

  describe('programs written to stress one optimization', () => {
    const scenario = `SIMULATE FROM 08:00 TO 08:40 {
      AT 08:00: TEMPERATURE = 20C, HUMIDITY = 40%, MOTION = CLEAR;
      AT 08:05: TEMPERATURE = 31C;
      AT 08:10: MOTION = DETECTED, HUMIDITY = 70%;
      AT 08:15: TEMPERATURE = 25C;
      AT 08:20: MOTION = CLEAR;
      AT 08:25: HUMIDITY = 30%, TEMPERATURE = 35C;
      AT 08:28: TEMPERATURE = 30C;
      AT 08:30: TEMPERATURE = 10C;
      AT 08:32: TEMPERATURE = 25C;
      AT 08:34: TEMPERATURE = 20C, HUMIDITY = 50%;
    }`;
    const cases: Record<string, string> = {
      'O1 folding': 'IF TEMPERATURE > 10 + 2 * 10 THEN TURN_ON AC ELSE TURN_OFF AC',
      'O1 subtraction': 'IF TEMPERATURE > 40 - 10 THEN TURN_ON AC ELSE TURN_OFF AC',
      'O1 division': 'IF TEMPERATURE > 60 / 2 THEN TURN_ON AC ELSE TURN_OFF AC',
      'O1 unary minus': 'IF TEMPERATURE > 20 + -5 THEN TURN_ON AC ELSE TURN_OFF AC',
      'O2 units': 'IF TEMPERATURE > 86F FOR 2MIN THEN TURN_ON AC ELSE TURN_OFF AC',
      'O3 identities': 'IF NOT NOT TEMPERATURE > 30 AND TRUE OR FALSE THEN TURN_ON AC ELSE TURN_OFF AC',
      'O3 NOT >': 'IF NOT TEMPERATURE > 30 THEN TURN_ON AC ELSE TURN_OFF AC',
      'O3 NOT >=': 'IF NOT TEMPERATURE >= 30 THEN TURN_ON AC ELSE TURN_OFF AC',
      'O3 NOT <': 'IF NOT TEMPERATURE < 30 THEN TURN_ON AC ELSE TURN_OFF AC',
      'O3 NOT <=': 'IF NOT TEMPERATURE <= 30 THEN TURN_ON AC ELSE TURN_OFF AC',
      'O3 NOT ==': 'IF NOT TEMPERATURE == 30 THEN TURN_ON AC ELSE TURN_OFF AC',
      'O4 range': 'IF TEMPERATURE > 25 AND TEMPERATURE > 30 THEN TURN_ON AC ELSE TURN_OFF AC',
      'O4 range under OR': 'IF TEMPERATURE > 25 OR TEMPERATURE > 30 THEN TURN_ON AC ELSE TURN_OFF AC',
      'O5 dead rule': 'IF TEMPERATURE > 30 AND TEMPERATURE < 20 THEN TURN_ON AC ELSE TURN_OFF AC END; IF TEMPERATURE > 1 THEN TURN_ON FAN END;',
      'O5 tautology': 'IF TEMPERATURE > 20 OR TEMPERATURE <= 20 THEN TURN_ON AC ELSE TURN_OFF AC',
      'O5 tautology with FOR': 'IF TEMPERATURE > 20 OR TEMPERATURE <= 20 FOR 3MIN THEN TURN_ON AC',
      'O5 dead nested branch': 'WHEN MOTION DETECTED THEN IF FALSE THEN NOTIFY "a" ELSE NOTIFY "b" END',
      'O6 reuse': 'IF TEMPERATURE > 1 AND TEMPERATURE < 30 THEN TURN_ON AC ELSE TURN_OFF AC',
      'O6 short-circuit': 'IF HUMIDITY > 50 AND TEMPERATURE > 30 OR TEMPERATURE < 15 THEN TURN_ON AC ELSE TURN_OFF AC',
      'O6 across WAIT': 'WHEN MOTION DETECTED IF TEMPERATURE > 1 THEN WAIT 10MIN, IF TEMPERATURE > 28 THEN NOTIFY "hot" ELSE NOTIFY "cool" END END',
      'O7 repeat': 'WHEN MOTION DETECTED THEN TURN_ON AC, TURN_ON AC, SET AC TEMPERATURE TO 20C, SET AC TEMPERATURE TO 24C',
      'O7 notify between': 'WHEN MOTION DETECTED THEN TURN_ON AC, NOTIFY "x", TURN_ON AC',
      'O7 toggle': 'WHEN MOTION DETECTED THEN TOGGLE AC, TOGGLE AC',
      'O7 command across a WAIT': 'WHEN MOTION DETECTED THEN TURN_ON AC, WAIT 3MIN, TURN_ON AC',
      'O7 SET across a WAIT': 'WHEN MOTION DETECTED THEN SET LIGHT BRIGHTNESS TO 20%, WAIT 3MIN, SET LIGHT BRIGHTNESS TO 80%',
      'O8 nested': 'WHEN MOTION DETECTED THEN IF TEMPERATURE > 30 THEN IF HUMIDITY > 50 THEN NOTIFY "a" END ELSE NOTIFY "b" END',
      'O9 merge': 'IF TEMPERATURE > 30 THEN TURN_ON AC, NOTIFY "a" ELSE TURN_OFF AC END; IF TEMPERATURE > 30 THEN TURN_ON FAN, NOTIFY "b" END;',
      'O9 merge, one rule named': 'RULE "x": IF TEMPERATURE > 30 THEN TURN_ON AC END; RULE "y": IF TEMPERATURE > 30 THEN TURN_ON FAN ELSE TURN_OFF FAN END;',
      'O9 keeps priorities': 'RULE "a" PRIORITY 3: IF TEMPERATURE > 30 THEN TURN_ON AC END; RULE "b": IF TEMPERATURE > 30 THEN TURN_ON FAN END; RULE "c" PRIORITY 2: IF TEMPERATURE > 30 THEN TURN_OFF FAN END;',
      'O9 keeps a WAIT out': 'IF TEMPERATURE > 30 THEN TURN_ON AC, WAIT 3MIN, TURN_OFF AC END; IF TEMPERATURE > 30 THEN TURN_ON FAN END;',
      'O9 keeps a later WAIT out': 'IF TEMPERATURE > 30 THEN TURN_ON AC END; IF TEMPERATURE > 30 THEN TURN_ON FAN, WAIT 3MIN, TURN_OFF FAN END; IF TEMPERATURE > 30 THEN NOTIFY "c" END;',
      'O9 with a rule between': 'IF TEMPERATURE > 30 THEN TURN_ON AC END; IF TEMPERATURE > 30 AND TRUE THEN TURN_ON AC END; IF HUMIDITY > 1 THEN TURN_OFF AC END;',
      'conflict on one tick': 'IF TEMPERATURE > 28 THEN TURN_ON AC ELSE TURN_OFF AC END; IF TEMPERATURE > 28 THEN TURN_OFF AC ELSE TURN_ON AC END;',
      'overflow at run time (R502)': `WHEN MOTION DETECTED IF TEMPERATURE ${'* 1000000000 '.repeat(40)}> 0 THEN NOTIFY "x" END`,
      'computed SET': 'IF TEMPERATURE > 1 THEN TURN_ON AC, SET AC TEMPERATURE TO TEMPERATURE - 5 END',
      'BETWEEN includes both ends': 'IF TEMPERATURE BETWEEN 20 AND 25 THEN TURN_ON AC ELSE TURN_OFF AC',
      'time window excludes its end': 'IF TIME BETWEEN 08:10 AND 08:20 THEN TURN_ON AC ELSE TURN_OFF AC',
      'NOT time window': 'IF NOT TIME BETWEEN 08:10 AND 08:20 THEN TURN_ON AC ELSE TURN_OFF AC',
      'time window across midnight': 'IF TIME BETWEEN 22:00 AND 08:20 THEN TURN_ON AC ELSE TURN_OFF AC',
    };
    it.each(Object.entries(cases))('%s', (_name, rules) => {
      expectSame(`${rules}\n${scenario}`);
    });
  });
});

// ---- random programs -------------------------------------------------------

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

/** Few thresholds, and the scenario uses the same ones, so boundaries are hit exactly. */
const THRESHOLDS = [15, 20, 25, 30, 35] as const;

function randomAtom(r: () => number): string {
  const n = pick(r, THRESHOLDS);
  return pick(r, [
    `TEMPERATURE > ${n}`, `TEMPERATURE <= ${n}`, `TEMPERATURE >= ${n}`, `TEMPERATURE < ${n}`,
    `HUMIDITY > ${n * 2}`, `HUMIDITY != ${n * 2}`, `TEMPERATURE == ${n}`,
    `TEMPERATURE > ${n + 5} - 5`, `TEMPERATURE < ${n} * 2 / 2`, `TEMPERATURE >= -5 + ${n + 5}`,
    'MOTION IS DETECTED', 'MOTION IS NOT DETECTED', 'DOOR IS LOCKED', 'AC IS ON', 'FAN == OFF',
    'LIGHT IS ON', `TEMPERATURE BETWEEN ${n} AND ${n + 7}`, 'TIME BETWEEN 08:10 AND 08:30',
    'TIME BETWEEN 22:00 AND 08:20', 'TRUE', 'FALSE', 'DAY == MON', `TEMPERATURE + 2 > ${n}`,
    `TEMPERATURE * 2 < ${n * 3}`, `-TEMPERATURE < ${n}`,
  ]);
}

function randomCond(r: () => number, depth: number): string {
  if (depth === 0 || r() < 0.3) return randomAtom(r);
  const roll = r();
  if (roll < 0.15) return `NOT ${randomAtom(r)}`;
  const op = roll < 0.6 ? 'AND' : 'OR';
  const left = randomCond(r, depth - 1);
  const right = randomCond(r, depth - 1);
  return r() < 0.3 ? `(${left} ${op} ${right})` : `${left} ${op} ${right}`;
}

const SIMPLE_ACTIONS = [
  'TURN_ON AC', 'TURN_OFF AC', 'TOGGLE AC', 'TURN_ON FAN', 'TURN_OFF FAN', 'TURN_ON LIGHT', 'TURN_OFF LIGHT',
  'TOGGLE LIGHT', 'LOCK DOOR', 'OPEN CURTAIN', 'CLOSE CURTAIN', 'SET AC TEMPERATURE TO 22C',
  'SET AC TEMPERATURE TO 25C', 'SET LIGHT BRIGHTNESS TO 40%', 'SET LIGHT BRIGHTNESS TO 0%',
  'SET FAN SPEED TO 3', 'SET AC TEMPERATURE TO TEMPERATURE - 3', 'NOTIFY "a"', 'NOTIFY "b"',
];

function randomActions(r: () => number, depth: number): string {
  const count = 1 + Math.floor(r() * 3);
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const roll = r();
    if (roll < 0.1) parts.push(`WAIT ${1 + Math.floor(r() * 4)}MIN`);
    else if (roll < 0.25 && depth > 0) {
      const otherwise = r() < 0.5 ? ` ELSE ${randomActions(r, depth - 1)}` : '';
      parts.push(`IF ${randomCond(r, 1)} THEN ${randomActions(r, depth - 1)}${otherwise} END`);
    } else parts.push(pick(r, SIMPLE_ACTIONS));
  }
  return parts.join(', ');
}

function randomRule(r: () => number, index: number): string {
  const header = r() < 0.4 ? `RULE "r${index}" PRIORITY ${1 + Math.floor(r() * 3)}: ` : '';
  const roll = r();
  if (roll < 0.6) {
    const hold = r() < 0.25 ? ` FOR ${1 + Math.floor(r() * 3)}MIN` : '';
    const otherwise = r() < 0.5 ? ` ELSE ${randomActions(r, 1)}` : '';
    return `${header}IF ${randomCond(r, 2)}${hold} THEN ${randomActions(r, 1)}${otherwise} END;`;
  }
  if (roll < 0.9) {
    const event = pick(r, [
      'MOTION DETECTED', 'MOTION CLEARS', 'AC TURNS ON', 'AC TURNS OFF', 'LIGHT TURNS ON', 'FAN TURNS OFF',
      'TEMPERATURE RISES ABOVE 30C', 'TEMPERATURE FALLS BELOW 20C', 'HUMIDITY CHANGES', 'CURTAIN OPENS',
    ]);
    const guard = r() < 0.5 ? ` IF ${randomCond(r, 1)}` : '';
    return `${header}WHEN ${event}${guard} THEN ${randomActions(r, 1)} END;`;
  }
  return `${header}AT 08:${String(10 + Math.floor(r() * 30))} THEN ${randomActions(r, 1)} END;`;
}

function randomScenario(r: () => number): string {
  const lines: string[] = [];
  for (let minute = 0; minute < 40; minute += 1 + Math.floor(r() * 4)) {
    const assign = pick(r, [
      `TEMPERATURE = ${pick(r, THRESHOLDS)}C`, `TEMPERATURE = ${pick(r, THRESHOLDS) + 1}C`,
      `HUMIDITY = ${pick(r, THRESHOLDS) * 2}%`, 'MOTION = DETECTED', 'MOTION = CLEAR',
    ]);
    lines.push(`AT 08:${String(minute).padStart(2, '0')}: ${assign};`);
  }
  return `SIMULATE FROM 08:00 TO 08:45 { ${lines.join(' ')} }`;
}

describe('differential on random programs', () => {
  it('agrees on 400 generated programs', () => {
    const random = seededRandom(424242);
    let compiled = 0;
    let passesFired = 0;
    for (let run = 0; run < 400; run++) {
      const rules = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, i) => randomRule(random, i));
      const source = `${rules.join('\n')}\n${randomScenario(random)}`;
      const result: CompileResult = compile(source);
      if (!stageOutput(result, 'codegen')) continue;
      compiled++;
      if (stageOutput(result, 'optimizer')!.passes.some((p) => p.changes.length > 0)) passesFired++;
      expectSame(source);
    }
    // Guards against a generator that quietly stops testing anything.
    expect(compiled).toBeGreaterThan(200);
    expect(passesFired).toBeGreaterThan(150);
  });
});

describe('the sim golden output comes from this engine', () => {
  it('matches a fresh run', () => {
    const { source } = loadExamples().find((e) => e.name === 'advanced')!;
    const result = compile(source);
    expect(emit('sim', stageResult(result, 'simulation'))).toContain('Rule R1 "Cool bedroom" fired');
  });
});
