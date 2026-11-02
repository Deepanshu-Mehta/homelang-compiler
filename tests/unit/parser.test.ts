import { describe, expect, it } from 'vitest';
import { compile, stageOutput, stageResult } from '../../src/compiler/index';
import type { Cond, Rule } from '../../src/compiler/parser/ast';
import { condText, programText } from '../../src/compiler/parser/print';

function parsed(source: string, collectAllErrors = false) {
  const result = compile(source, { collectAllErrors });
  return { stage: stageResult(result, 'parser'), output: stageOutput(result, 'parser') };
}

const ok = (source: string) => {
  const { stage, output } = parsed(source);
  expect(stage.diagnostics).toEqual([]);
  return output!.ast;
};
const codes = (source: string, all = false) => parsed(source, all).stage.diagnostics.map((d) => d.code);
const rule = (source: string): Rule => ok(source).rules[0]!;
const cond = (expr: string): Cond => {
  const { trigger } = rule(`IF ${expr} THEN TURN_ON AC`);
  if (trigger.kind !== 'State') throw new Error('expected a state trigger');
  return trigger.cond;
};

describe('program and declarations', () => {
  it('accepts an empty program and comments only', () => {
    expect(ok('').rules).toEqual([]);
    expect(ok('// nothing\n').rules).toEqual([]);
  });

  it('parses ROOM, DEVICE and SENSOR', () => {
    const { decls } = ok('ROOM A; DEVICE L : LIGHT; DEVICE F : FAN IN A; SENSOR T : TEMP_SENSOR IN A UNIT C; SENSOR H : HUMIDITY_SENSOR UNIT %;');
    expect(decls.map((d) => d.kind)).toEqual(['RoomDecl', 'DeviceDecl', 'DeviceDecl', 'SensorDecl', 'SensorDecl']);
    expect(decls[2]).toMatchObject({ name: 'F', typeName: 'FAN', room: 'A' });
    expect(decls[3]).toMatchObject({ unit: 'C', room: 'A' });
    expect(decls[4]).toMatchObject({ unit: '%' });
  });

  it('keeps original spelling and an upper-case canonical name', () => {
    expect(ok('ROOM Bedroom;').decls[0]).toMatchObject({ name: 'BEDROOM', display: 'Bedroom' });
  });

  it('parses a program with declarations, rules and a scenario', () => {
    const ast = ok('ROOM A; IF TRUE THEN TURN_ON X SIMULATE FROM 08:00 TO 09:00 STEP 30S { AT 08:10: T = 3C, U = ON; AT 08:20: T = 4C; }');
    expect(ast.sim).toMatchObject({ from: 480, to: 540 });
    expect(ast.sim!.step).toMatchObject({ value: 30, unit: 'S' });
    expect(ast.sim!.stmts).toHaveLength(2);
    expect(ast.sim!.stmts[0]!.assigns).toHaveLength(2);
  });

  it('allows SIMULATE with no window or step, and an empty body', () => {
    expect(ok('SIMULATE { }').sim).toMatchObject({ stmts: [] });
  });
});

describe('rules', () => {
  it('parses the brief', () => {
    const r = rule('IF TEMPERATURE > 30 THEN TURN_ON AC');
    expect(r).toMatchObject({ id: 'R1', priority: 1 });
    expect(r.trigger.kind).toBe('State');
    expect(r.thenActs[0]).toMatchObject({ kind: 'Power', op: 'TURN_ON', target: { name: 'AC' } });
  });

  it('parses rule headers, including the PRIORITY 2: rollback', () => {
    const r = rule('RULE "Cool" PRIORITY 2:\nIF TRUE THEN TURN_ON AC');
    expect(r).toMatchObject({ name: 'Cool', priority: 2 });
    expect(rule('RULE "Plain": IF TRUE THEN TURN_ON AC').priority).toBe(1);
  });

  it('parses FOR, ELSE, END and ;', () => {
    const r = rule('IF TRUE FOR 2MIN THEN TURN_ON AC ELSE TURN_OFF AC END;');
    expect(r.trigger).toMatchObject({ hold: { value: 2, unit: 'MIN' } });
    expect(r.elseActs).toHaveLength(1);
  });

  it('keeps a negative FOR so that the semantic phase can report it', () => {
    expect(rule('IF TRUE FOR -2MIN THEN TURN_ON AC').trigger).toMatchObject({ hold: { value: -2 } });
  });

  it.each([
    ['DETECTED', 'DETECTED'], ['CLEARS', 'CLEARS'], ['OPENS', 'OPENS'], ['CLOSES', 'CLOSES'],
    ['LOCKS', 'LOCKS'], ['UNLOCKS', 'UNLOCKS'], ['CHANGES', 'CHANGES'], ['TURNS ON', 'TURNS_ON'],
    ['TURNS OFF', 'TURNS_OFF'], ['RISES ABOVE 30', 'RISES_ABOVE'], ['FALLS BELOW 30', 'FALLS_BELOW'],
  ])('parses the event %s', (text, event) => {
    expect(rule(`WHEN X ${text} THEN TURN_ON AC`).trigger).toMatchObject({ kind: 'Event', source: { name: 'X' }, event });
  });

  it('parses a WHEN guard', () => {
    expect(rule('WHEN X CHANGES IF X IS AWAY THEN TURN_ON AC').trigger).toMatchObject({ guard: { kind: 'StateTest' } });
  });

  it('parses AT with days', () => {
    expect(rule('AT 07:00 THEN TURN_ON AC').trigger).toMatchObject({ kind: 'Time', minutes: 420 });
    expect(rule('AT 07:00 ON WEEKDAYS, SAT THEN TURN_ON AC END').trigger).toMatchObject({ days: ['WEEKDAYS', 'SAT'] });
  });

  it('starts a new rule at IF after an action list', () => {
    expect(ok('IF TRUE THEN TURN_ON AC IF FALSE THEN TURN_OFF AC').rules.map((r) => r.id)).toEqual(['R1', 'R2']);
  });
});

describe('actions', () => {
  it.each(['TURN_ON', 'TURN_OFF', 'TOGGLE', 'LOCK', 'UNLOCK', 'OPEN', 'CLOSE'])('parses %s', (op) => {
    expect(rule(`IF TRUE THEN ${op} X`).thenActs[0]).toMatchObject({ kind: 'Power', op });
  });

  it('parses SET with a value, a state and a name', () => {
    expect(rule('IF TRUE THEN SET AC TEMPERATURE TO 24C').thenActs[0]).toMatchObject({ kind: 'SetAttr', attr: 'TEMPERATURE', value: { kind: 'NumLit' } });
    expect(rule('IF TRUE THEN SET AC MODE TO COOL').thenActs[0]).toMatchObject({ value: { kind: 'Ref', name: 'COOL' } });
    expect(rule('IF TRUE THEN SET X Y TO ON').thenActs[0]).toMatchObject({ value: { kind: 'EnumLit', value: 'ON' } });
  });

  it('parses WAIT, NOTIFY and a list', () => {
    const acts = rule('IF TRUE THEN WAIT 5MIN, NOTIFY "hi", TURN_ON AC').thenActs;
    expect(acts.map((a) => a.kind)).toEqual(['Wait', 'Notify', 'Power']);
  });

  it('parses a nested IF, and END attaches to the nearest IF', () => {
    const r = rule('IF TRUE THEN IF FALSE THEN TURN_ON A ELSE TURN_ON B END ELSE TURN_ON C END');
    const inner = r.thenActs[0]!;
    expect(inner).toMatchObject({ kind: 'IfAction' });
    expect(inner.kind === 'IfAction' && inner.elseActs).toHaveLength(1);
    expect(r.elseActs).toHaveLength(1);
  });
});

describe('conditions and precedence', () => {
  it('binds AND tighter than OR', () => {
    expect(condText(cond('A > 1 OR B > 2 AND C > 3'))).toBe('A > 1 OR B > 2 AND C > 3');
    expect(cond('A > 1 OR B > 2 AND C > 3')).toMatchObject({ kind: 'Logic', op: 'OR', right: { kind: 'Logic', op: 'AND' } });
  });

  it('is left-associative', () => {
    expect(cond('A > 1 AND B > 2 AND C > 3')).toMatchObject({ op: 'AND', left: { op: 'AND' } });
  });

  it('groups with parentheses', () => {
    expect(cond('(A > 1 OR B > 2) AND C > 3')).toMatchObject({ op: 'AND', left: { op: 'OR' } });
  });

  it('binds NOT tighter than AND', () => {
    expect(cond('NOT A > 1 AND B > 2')).toMatchObject({ op: 'AND', left: { kind: 'Not' } });
    expect(cond('NOT NOT A > 1')).toMatchObject({ kind: 'Not', operand: { kind: 'Not' } });
  });

  it.each(['>', '>=', '<', '<=', '==', '!='])('parses %s', (op) => {
    expect(cond(`A ${op} 1`)).toMatchObject({ kind: 'Compare', op });
  });

  it('parses IS and IS NOT', () => {
    expect(cond('A IS ON')).toMatchObject({ kind: 'StateTest', negated: false, state: 'ON' });
    expect(cond('A IS NOT LOCKED')).toMatchObject({ negated: true, state: 'LOCKED' });
    expect(cond('DAY IS MON')).toMatchObject({ state: 'MON' });
  });

  it('keeps the AND of BETWEEN apart from a logical AND', () => {
    expect(cond('TIME BETWEEN 22:00 AND 06:00 AND A IS ON')).toMatchObject({
      kind: 'Logic', op: 'AND', left: { kind: 'Between' }, right: { kind: 'StateTest' },
    });
  });

  it('accepts TRUE and FALSE as conditions', () => {
    expect(cond('TRUE')).toMatchObject({ kind: 'BoolLit', value: true });
    expect(cond('FALSE AND TRUE')).toMatchObject({ kind: 'Logic' });
  });

  it('lets enum and day words reach the semantic phase', () => {
    expect(cond('DOOR == LOCKED')).toMatchObject({ right: { kind: 'EnumLit', value: 'LOCKED', category: 'state' } });
    expect(cond('DAY == MON')).toMatchObject({ right: { kind: 'EnumLit', value: 'MON', category: 'day' } });
    expect(cond('TEMPERATURE > ON')).toMatchObject({ right: { kind: 'EnumLit', value: 'ON' } });
    expect(cond('TEMPERATURE > TRUE')).toMatchObject({ right: { kind: 'EnumLit', value: 'TRUE', category: 'bool' } });
  });
});

describe('arithmetic', () => {
  const left = (expr: string) => (cond(`${expr} > 0`) as { left: unknown }).left;

  it('binds * tighter than +, and is left-associative', () => {
    expect(left('1 + 2 * 3')).toMatchObject({ op: '+', right: { op: '*' } });
    expect(left('8 - 4 - 2')).toMatchObject({ op: '-', left: { op: '-' } });
    expect(left('8 / 4 * 2')).toMatchObject({ op: '*', left: { op: '/' } });
  });

  it('parses unary minus with quantities', () => {
    expect(left('-5C')).toMatchObject({ kind: 'Neg', operand: { kind: 'NumLit', unit: 'C' } });
    expect(left('--5')).toMatchObject({ kind: 'Neg', operand: { kind: 'Neg' } });
  });
});

describe('syntax errors', () => {
  it.each([
    ['IF TEMPERATURE > 30 TURN_ON AC', 'P201'],
    ['WHEN X DETECTED TURN_ON AC', 'P201'],
    ['AT 07:00 TURN_ON AC', 'P201'],
    ['IF TEMPERATURE > 30 THEN', 'P202'],
    ['IF TRUE THEN TURN_ON AC,', 'P202'],
    ['IF TRUE THEN TURN_ON AC ELSE', 'P202'],
    ['IF (TEMPERATURE > 30 THEN TURN_ON AC', 'P203'],
    ['IF TEMPERATURE > 30 AND THEN TURN_ON AC', 'P204'],
    ['IF NOT THEN TURN_ON AC', 'P204'],
    ['IF THEN TURN_ON AC', 'P204'],
    ['IF TEMPERATURE > > 30 THEN TURN_ON AC', 'P205'],
    ['IF > 30 THEN TURN_ON AC', 'P205'],
    ['IF TEMPERATURE + THEN TURN_ON AC', 'P205'],
    ['ELSE TURN_OFF AC', 'P206'],
    ['WHEN X DETECTED THEN TURN_ON AC ELSE TURN_OFF AC', 'P206'],
    ['AT 07:00 THEN TURN_ON AC ELSE TURN_OFF AC', 'P206'],
    ['IF TRUE THEN TURN_ON AC ELSE TURN_OFF AC ELSE TURN_ON AC', 'P207'],
    ['IF TRUE THEN TURN ON AC', 'P208'],
    ['IF TRUE THEN TURN OFF AC', 'P208'],
    ['IF TRUE THEN TRUN_ON AC', 'P208'],
    ['IF 20 < TEMPERATURE < 30 THEN TURN_ON FAN', 'P209'],
    ['IF () THEN TURN_ON AC', 'P210'],
    ['DEVICE AC : AIR_CONDITIONER IN BEDROOM', 'P211'],
    ['ROOM A', 'P211'],
    ['IF TEMPERATURE > 30 C THEN TURN_ON AC', 'P212'],
    ['IF TEMPERATURE > 30 % THEN TURN_ON AC', 'P212'],
    ['IF A THEN IF B IS ON THEN TURN_ON X', 'P216'],
    ['IF TRUE THEN IF FALSE THEN TURN_ON X', 'P213'],
    ['IF TRUE THEN IF FALSE THEN TURN_ON X ELSE TURN_ON Y ELSE TURN_ON Z', 'P213'],
    ['DEVICE IF : LIGHT;', 'P214'],
    ['IF TRUE THEN TURN_ON THEN', 'P214'],
    ['TURN_ON AC', 'P215'],
    ['IF TEMPERATURE = 30 THEN TURN_ON AC', 'P215'],
    ['IF CURTAIN IS CLOSE THEN TURN_ON AC', 'P215'],
    ['IF TRUE FOR 5 THEN TURN_ON AC', 'P215'],
    ['IF TRUE THEN TURN_ON AC END END', 'P215'],
    ['SIMULATE { } IF', 'P215'],
    ['SIMULATE { AT 08:00 T = 1; }', 'P215'],
    ['IF MOTION THEN TURN_ON AC', 'P216'],
    ['IF ON THEN TURN_ON AC', 'P216'],
    ['IF (TEMPERATURE + 2) > 30 THEN TURN_ON AC', 'P216'],
    ['IF TRUE THEN TURN_ON AC ROOM A;', 'P217'],
    [`IF ${'('.repeat(500)}`, 'P218'],
  ])('%s gives %s', (source, code) => {
    expect(codes(source)[0]).toBe(code);
  });

  it('gives the P216 hint exactly as specified', () => {
    const [d] = parsed('IF MOTION THEN TURN_ON AC').stage.diagnostics;
    expect(d!.hint).toBe('use a comparison or IS <state>, e.g. MOTION IS DETECTED');
  });

  it('explains that parentheses are for conditions', () => {
    const [d] = parsed('IF (TEMPERATURE + 2) > 30 THEN TURN_ON AC').stage.diagnostics;
    expect(d!.hint).toContain('Parentheses group conditions');
  });

  it('hints at CLOSED', () => {
    expect(parsed('IF CURTAIN IS CLOSE THEN TURN_ON AC').stage.diagnostics[0]!.hint).toContain('CLOSED');
  });

  it('quotes the program in the P209 advice', () => {
    expect(parsed('IF 20 < TEMPERATURE < 30 THEN TURN_ON FAN').stage.diagnostics[0]!.message)
      .toBe('Comparisons cannot be chained; write 20 < TEMPERATURE AND TEMPERATURE < 30.');
  });

  it('stops at the first error by default', () => {
    expect(codes('IF TRUE TURN_ON AC; IF TRUE TURN_ON AC;')).toEqual(['P201']);
  });

  it('collects every error in panic mode, without cascades', () => {
    const source = 'IF TRUE TURN_ON AC;\nIF TRUE THEN TURN ON AC;\nIF (TRUE THEN TURN_ON AC;\nIF TRUE THEN TURN_ON AC;';
    expect(codes(source, true)).toEqual(['P201', 'P208', 'P203']);
  });

  it('recovers inside SIMULATE', () => {
    expect(codes('SIMULATE { AT 08:00 T = 1; AT 09:00: T = ; AT 10:00: T = 2; }', true)).toEqual(['P215', 'P205']);
  });
});

describe('parse tree and printing', () => {
  it('keeps every grammar level in the parse tree', () => {
    const { output } = parsed('IF TEMPERATURE > 30 THEN TURN_ON AC');
    const names: string[] = [];
    const walk = (n: { kind: string; name?: string; children?: unknown[] }): void => {
      if (n.name) names.push(n.name);
      for (const c of n.children ?? []) walk(c as never);
    };
    walk(output!.parseTree);
    expect(names).toEqual(expect.arrayContaining(['program', 'rule', 'ruleBody', 'cond', 'andCond', 'notCond', 'atom', 'value', 'term', 'factor', 'atomTail', 'relop', 'actions', 'action']));
  });

  it('records a step for each rule entered', () => {
    const { output } = parsed('IF TRUE THEN TURN_ON AC');
    expect(output!.steps[0]!.rule).toBe('program');
    expect(output!.steps.map((s) => s.rule)).toContain('action');
  });

  it('prints the program as the parser sees it', () => {
    expect(programText(ok('IF TEMPERATURE > 30 THEN TURN_ON AC ELSE TURN_OFF AC'))).toBe(
      'Rule R1 (priority 1)\n  IF TEMPERATURE > 30\n  THEN\n    TURN_ON AC\n  ELSE\n    TURN_OFF AC');
  });
});
