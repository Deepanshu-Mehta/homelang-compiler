import { describe, expect, it } from 'vitest';
import { compile, type CompileResult } from '../src/compiler/index';
import { loadExamples, seededRandom } from './helpers';

const FRAGMENTS = [
  'IF', 'THEN', 'ELSE', 'END', 'WHEN', 'AT', 'FOR', 'RULE', 'PRIORITY', 'ROOM', 'DEVICE', 'SENSOR',
  'IN', 'UNIT', 'SIMULATE', 'FROM', 'TO', 'STEP', 'AND', 'OR', 'NOT', 'IS', 'BETWEEN', 'TURN_ON',
  'TURN_OFF', 'TOGGLE', 'SET', 'LOCK', 'UNLOCK', 'OPEN', 'CLOSE', 'WAIT', 'NOTIFY', 'ON', 'OFF',
  'CLOSED', 'LOCKED', 'DETECTED', 'CLEAR', 'HOME', 'AWAY', 'TRUE', 'FALSE', 'OPENS', 'TURNS',
  'RISES', 'ABOVE', 'CHANGES', 'MON', 'WEEKDAYS', 'AC', 'LIGHT', 'TEMPERATURE', 'MOTION', 'DOOR',
  'TIME', 'DAY', '30', '30C', '86F', '70%', '5MIN', '07:00', '"s"', '>', '>=', '<', '==', '!=',
  '=', '+', '-', '*', '/', '%', '(', ')', '{', '}', ',', ';', ':', '@', '°', '.', '!', '"', '/*',
  '\n', '0', '0MIN', '99999999999', '25:70',
];

function assertWellFormed(source: string, result: CompileResult): void {
  for (const stage of result.stages) {
    for (const d of stage.diagnostics) {
      expect(d.code, `internal error for ${JSON.stringify(source)}: ${d.message}`).not.toBe('I001');
      expect(d.message.length).toBeGreaterThan(0);
      expect(d.hint.length).toBeGreaterThan(0);
      expect(d.span.line).toBeGreaterThanOrEqual(1);
      expect(d.span.col).toBeGreaterThanOrEqual(1);
      expect(d.span.start).toBeGreaterThanOrEqual(0);
      expect(d.span.end).toBeGreaterThanOrEqual(d.span.start);
      expect(d.span.end).toBeLessThanOrEqual(source.length);
    }
  }
}

function check(source: string): void {
  assertWellFormed(source, compile(source));
  assertWellFormed(source, compile(source, { collectAllErrors: true }));
}

describe('fuzz: the compiler never throws and every span is valid', () => {
  it('random token streams', () => {
    const random = seededRandom(20261102);
    for (let run = 0; run < 1500; run++) {
      const length = 1 + Math.floor(random() * 40);
      const parts: string[] = [];
      for (let i = 0; i < length; i++) parts.push(FRAGMENTS[Math.floor(random() * FRAGMENTS.length)]!);
      check(parts.join(' '));
    }
  });

  it('mutated examples: delete, duplicate or swap a token', () => {
    const random = seededRandom(7);
    for (const { source } of loadExamples()) {
      const words = source.split(/(\s+)/);
      for (let run = 0; run < 60; run++) {
        const mutated = [...words];
        const at = Math.floor(random() * mutated.length);
        const kind = Math.floor(random() * 3);
        if (kind === 0) mutated.splice(at, 1);
        else if (kind === 1) mutated.splice(at, 0, mutated[at]!);
        else mutated[at] = FRAGMENTS[Math.floor(random() * FRAGMENTS.length)]!;
        check(mutated.join(''));
      }
    }
  });

  it('random characters', () => {
    const random = seededRandom(99);
    for (let run = 0; run < 500; run++) {
      let text = '';
      const length = Math.floor(random() * 60);
      for (let i = 0; i < length; i++) text += String.fromCharCode(32 + Math.floor(random() * 95));
      check(text);
    }
  });

  it('pathological nesting does not overflow the stack', () => {
    check(`IF ${'('.repeat(20000)}`);
    check(`IF ${'NOT '.repeat(20000)}TRUE THEN TURN_ON AC`);
    check(`IF TEMPERATURE > ${'-'.repeat(20000)}1 THEN TURN_ON AC`);
    check(`${'IF TRUE THEN '.repeat(20000)}TURN_ON AC`);
  });

  it('a 200-term condition chain compiles', () => {
    const chain = Array.from({ length: 200 }, (_, i) => `TEMPERATURE > ${i}`).join(' AND ');
    check(`IF ${chain} THEN TURN_ON AC`);
  });
});
