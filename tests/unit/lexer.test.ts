import { describe, expect, it } from 'vitest';
import { lex } from '../../src/compiler/lexer/lexer';
import { DFAS } from '../../src/compiler/lexer/dfa/index';

const types = (src: string): string[] =>
  lex(src).output.tokens.filter((t) => t.type !== 'EOF').map((t) => t.type);
const codes = (src: string): string[] => lex(src).diagnostics.map((d) => d.code);
const first = (src: string) => lex(src).output.tokens[0]!;

describe('token classes', () => {
  it('reads the brief as 7 tokens from 35 characters', () => {
    const src = 'IF TEMPERATURE > 30 THEN TURN_ON AC';
    const { output, diagnostics } = lex(src);
    expect(diagnostics).toEqual([]);
    expect(output.charCount).toBe(src.length);
    expect(output.tokenCount).toBe(7);
    expect(types(src)).toEqual(['IF', 'IDENT', 'GT', 'NUMBER', 'THEN', 'TURN_ON', 'IDENT']);
  });

  it('is case-insensitive and keeps the original lexeme', () => {
    const token = first('turn_on');
    expect(token.type).toBe('TURN_ON');
    expect(token.lexeme).toBe('turn_on');
    expect(token.upper).toBe('TURN_ON');
    expect(types('if temperature > 30 then turn_on ac')).toEqual(types('IF TEMPERATURE > 30 THEN TURN_ON AC'));
  });

  it.each(['IF', 'THEN', 'ELSE', 'END', 'WHEN', 'AT', 'FOR', 'RULE', 'PRIORITY', 'ROOM', 'DEVICE',
    'SENSOR', 'IN', 'UNIT', 'SIMULATE', 'FROM', 'TO', 'STEP', 'AND', 'OR', 'NOT', 'IS', 'BETWEEN',
    'TURN_ON', 'TURN_OFF', 'TOGGLE', 'SET', 'LOCK', 'UNLOCK', 'OPEN', 'CLOSE', 'WAIT', 'NOTIFY',
    'ON', 'OFF', 'CLOSED', 'LOCKED', 'UNLOCKED', 'DETECTED', 'CLEAR', 'HOME', 'AWAY', 'TRUE', 'FALSE',
    'OPENS', 'CLOSES', 'TURNS', 'RISES', 'FALLS', 'ABOVE', 'BELOW', 'CHANGES', 'LOCKS', 'UNLOCKS',
    'CLEARS'])('keyword %s has its own token type', (word) => {
    expect(first(word).type).toBe(word);
  });

  it.each(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'WEEKDAYS', 'WEEKENDS'])('%s is a DAY', (word) => {
    expect(first(word).type).toBe('DAY');
  });

  it.each(['AC', 'BED_LIGHT2', 'LIGHT', '_X', 'LIGHT_2', 'TEMPERATURE'])('%s is an IDENT', (word) => {
    expect(first(word).type).toBe('IDENT');
  });

  it('reads numbers, including leading zeros and decimals', () => {
    expect(first('30').number).toBe(30);
    expect(first('24.5').number).toBe(24.5);
    expect(first('007').number).toBe(7);
  });

  it.each([
    ['30C', 30, 'C', 'temperature'], ['30c', 30, 'C', 'temperature'], ['30°C', 30, 'C', 'temperature'],
    ['30°c', 30, 'C', 'temperature'], ['86F', 86, 'F', 'temperature'], ['70%', 70, '%', 'percent'],
    ['5MIN', 5, 'MIN', 'duration'], ['5min', 5, 'MIN', 'duration'], ['2H', 2, 'H', 'duration'],
    ['2HR', 2, 'H', 'duration'], ['30S', 30, 'S', 'duration'], ['30SEC', 30, 'S', 'duration'],
    ['50LUX', 50, 'LUX', 'illuminance'], ['2700K', 2700, 'K', 'colorTemp'], ['24.5C', 24.5, 'C', 'temperature'],
  ])('%s is a QUANTITY', (src, number, unit, dim) => {
    expect(first(src).type).toBe('QUANTITY');
    expect(first(src).quantity).toMatchObject({ number, unit, dim });
  });

  it.each([['07:00', 420], ['7:05', 425], ['7:00', 420], ['22:30', 1350], ['00:00', 0], ['23:59', 1439]])(
    '%s is a TIME_LIT of %i minutes', (src, minutes) => {
      expect(first(src).type).toBe('TIME_LIT');
      expect(first(src).minutes).toBe(minutes);
    });

  it('reads strings and resolves escapes', () => {
    expect(first('"Good morning!"').text).toBe('Good morning!');
    expect(first('"a\\"b"').text).toBe('a"b');
    expect(first('"line\\nbreak"').text).toBe('line\nbreak');
  });

  it.each([['>', 'GT'], ['>=', 'GE'], ['<', 'LT'], ['<=', 'LE'], ['==', 'EQ'], ['!=', 'NE'], ['=', 'ASSIGN'],
    ['+', 'PLUS'], ['-', 'MINUS'], ['*', 'STAR'], ['/', 'SLASH'], ['%', 'PERCENT'], ['(', 'LPAREN'],
    [')', 'RPAREN'], ['{', 'LBRACE'], ['}', 'RBRACE'], [',', 'COMMA'], [';', 'SEMI'], [':', 'COLON']])(
    '%s is %s', (src, type) => { expect(first(src).type).toBe(type); });

  it('produces only EOF for an empty program', () => {
    expect(lex('').output.tokenCount).toBe(0);
    expect(first('').type).toBe('EOF');
  });

  it('discards comments and whitespace', () => {
    const { output } = lex('// one\n/* two\n lines */\n  \t\r\n');
    expect(output.tokenCount).toBe(0);
    expect(output.commentCount).toBe(2);
  });

  it('does not nest block comments', () => {
    expect(types('/* a /* b */ IF')).toEqual(['IF']);
  });

  it('never produces signed literals', () => {
    expect(types('-5')).toEqual(['MINUS', 'NUMBER']);
    expect(types('TEMP > -5C')).toEqual(['IDENT', 'GT', 'MINUS', 'QUANTITY']);
    expect(types('X-5')).toEqual(['IDENT', 'MINUS', 'NUMBER']);
  });
});

describe('maximal munch', () => {
  it('takes the longest operator', () => {
    expect(types('>=')).toEqual(['GE']);
    expect(types('> =')).toEqual(['GT', 'ASSIGN']);
  });

  it('reads TURN_ON as one word', () => {
    expect(types('TURN_ON')).toEqual(['TURN_ON']);
    expect(types('TURN ON')).toEqual(['IDENT', 'ON']);
  });

  it('reads 30C as one QUANTITY and 30 C as two tokens', () => {
    expect(types('30C')).toEqual(['QUANTITY']);
    expect(types('30 C')).toEqual(['NUMBER', 'IDENT']);
  });

  it('reads 10:30 as one TIME_LIT', () => {
    expect(types('10:30')).toEqual(['TIME_LIT']);
  });

  it('keeps a time and the colon after it apart in SIMULATE', () => {
    expect(types('AT 22:10: TEMP')).toEqual(['AT', 'TIME_LIT', 'COLON', 'IDENT']);
  });

  it('rolls back PRIORITY 2: to NUMBER then COLON', () => {
    const { output, diagnostics } = lex('PRIORITY 2:\n');
    expect(diagnostics).toEqual([]);
    expect(output.tokens.map((t) => t.type)).toEqual(['PRIORITY', 'NUMBER', 'COLON', 'EOF']);
    const trace = output.tokens[1]!.trace!;
    expect(trace.steps.map((s) => s.to)).toEqual(['q1', 'q5']);
    expect(trace.finalState).toBe('q1');
    expect(trace.rollback).toEqual({ deadState: 'q5', lastAcceptState: 'q1', discarded: ':' });
    expect(trace.summary).toContain('rolled back');
  });

  it('rolls back at end of input too', () => {
    expect(types('2:')).toEqual(['NUMBER', 'COLON']);
    expect(types('2:IF')).toEqual(['NUMBER', 'COLON', 'IF']);
  });
});

describe('automaton traces', () => {
  it('traces 30C through q4', () => {
    const trace = first('30C').trace!;
    expect(trace.steps.map((s) => `${s.from}-${s.ch}-${s.to}`)).toEqual(['q0-3-q1', 'q1-0-q1', 'q1-C-q4']);
    expect(trace.summary).toBe('Ended in accepting state q4, so this is a QUANTITY (30 °C).');
  });

  it('traces a keyword to the table lookup', () => {
    expect(first('TURN_ON').trace!.summary).toBe(
      "Ended in accepting state q1, so 'TURN_ON' is in the keyword table, so this is TURN_ON.");
  });

  it('gives every non-EOF token a trace from one of the data DFAs', () => {
    const names = DFAS.map((d) => d.name);
    for (const t of lex('IF (A >= 2.5C) THEN SET X Y TO "s" / 2').output.tokens) {
      if (t.type === 'EOF') continue;
      expect(names).toContain(t.trace!.dfa);
    }
  });
});

describe('every DFA is well formed', () => {
  it.each(DFAS.map((d) => [d.name, d] as const))('%s', (_name, dfa) => {
    const ids = dfa.states.map((s) => s.id);
    expect(ids).toContain(dfa.start);
    for (const edge of dfa.edges) {
      expect(ids).toContain(edge.from);
      if (edge.to) expect(ids).toContain(edge.to);
    }
  });
});

describe('lexical errors', () => {
  it.each([
    ['@', 'L101'], ['#', 'L101'], ['$', 'L101'], ['“on”', 'L101'], ['°', 'L101'], ['.5', 'L101'],
    ['!', 'L102'], ['! X', 'L102'],
    ['30.', 'L103'], ['30. ', 'L103'],
    ['3.4.5', 'L104'],
    ['10:3', 'L105'], ['10:300', 'L105'], ['12:5', 'L105'], ['123:45', 'L105'], ['10:30C', 'L105'],
    ['30X', 'L106'], ['30CTHEN', 'L106'], ['2LIGHT', 'L106'], ['30°', 'L106'], ['30°X', 'L106'],
    ['30C2', 'L106'], ['5MIN_', 'L106'], ['50%%', 'L106'], ['50%X', 'L106'],
    ['25:70', 'L107'], ['24:00', 'L107'],
    ['"Hello', 'L108'], ['"a\nb"', 'L108'], ['"a\\', 'L108'],
    ['/* open', 'L109'], ['/* open *', 'L109'],
    ['99999999999999999', 'L110'], ['99999999999C', 'L110'],
  ])('%j gives %s', (src, code) => {
    expect(codes(src)[0]).toBe(code);
  });

  it('accepts ° only before C or F, and % only as a whole suffix', () => {
    expect(codes('30°C 86°F 50%)')).toEqual([]);
  });

  it('gives exact positions computed from the source', () => {
    const src = 'IF TEMPERATURE > 30 THEN TURN_ON AC @';
    const [d] = lex(src).diagnostics;
    expect(d!.span.col).toBe(src.indexOf('@') + 1);
    expect(d!.message).toBe(`Illegal character '@' at line 1, column ${src.indexOf('@') + 1}.`);
  });

  it('hints for .5 and smart quotes', () => {
    expect(lex('.5').diagnostics[0]!.hint).toContain('0.5');
    expect(lex('“').diagnostics[0]!.hint).toContain('straight quotes');
  });

  it('reports the start of an unterminated string', () => {
    const src = 'NOTIFY "Hello';
    expect(lex(src).diagnostics[0]!.message).toBe('Unterminated string starting at line 1, column 8.');
  });

  it('collects several lexical errors and keeps going', () => {
    expect(codes('@ 30X # IF')).toEqual(['L101', 'L106', 'L101']);
  });

  it('counts CRLF as one line and a tab as one column', () => {
    const [d] = lex('IF\r\n\t@').diagnostics;
    expect(d!.span).toMatchObject({ line: 2, col: 2 });
  });
});
