import type { Span } from '../diagnostics';
import type { KeywordType, WordCategory } from './keywords';
import type { Dimension, UnitName } from './units';
import type { DfaTrace } from './dfa/types';

export type OperatorType = 'GT' | 'GE' | 'LT' | 'LE' | 'EQ' | 'NE' | 'ASSIGN';
export type PunctuationType =
  | 'PLUS' | 'MINUS' | 'STAR' | 'SLASH' | 'PERCENT'
  | 'LPAREN' | 'RPAREN' | 'LBRACE' | 'RBRACE'
  | 'COMMA' | 'SEMI' | 'COLON';

export type TokenType =
  | KeywordType
  | OperatorType
  | PunctuationType
  | 'DAY' | 'IDENT' | 'NUMBER' | 'QUANTITY' | 'TIME_LIT' | 'STRING' | 'EOF';

export type TokenCategory =
  | WordCategory
  | 'ident' | 'literal' | 'operator' | 'punct' | 'eof';

export interface QuantityValue {
  number: number;
  unit: UnitName;
  display: string;
  dim: Dimension;
}

export interface Token {
  type: TokenType;
  category: TokenCategory;
  /** Text exactly as written; `upper` is the canonical form for lookups. */
  lexeme: string;
  upper: string;
  span: Span;
  /** NUMBER value. */
  number?: number;
  /** QUANTITY value. */
  quantity?: QuantityValue;
  /** TIME_LIT value, minutes since midnight. */
  minutes?: number;
  /** STRING value with escapes resolved. */
  text?: string;
  /** How the automaton read this token. EOF has none. */
  trace?: DfaTrace;
}

/** The token table shown on the Lexer card. */
export const TOKEN_TABLE: readonly { token: string; pattern: string; examples: string }[] = [
  { token: 'Keywords', pattern: 'IF THEN ELSE END WHEN AT FOR RULE PRIORITY ROOM DEVICE SENSOR IN UNIT SIMULATE FROM TO STEP AND OR NOT IS BETWEEN', examples: 'IF, then, Between' },
  { token: 'Action keywords', pattern: 'TURN_ON TURN_OFF TOGGLE SET LOCK UNLOCK OPEN CLOSE WAIT NOTIFY', examples: 'TURN_ON, SET' },
  { token: 'State / event words', pattern: 'ON OFF CLOSED LOCKED UNLOCKED DETECTED CLEAR HOME AWAY TRUE FALSE OPENS CLOSES TURNS RISES FALLS ABOVE BELOW CHANGES LOCKS UNLOCKS CLEARS', examples: 'IS ON, DETECTED' },
  { token: 'DAY', pattern: 'MON TUE WED THU FRI SAT SUN WEEKDAYS WEEKENDS', examples: 'ON WEEKDAYS' },
  { token: 'IDENT', pattern: '[A-Za-z_][A-Za-z0-9_]* (not a keyword)', examples: 'AC, BED_LIGHT2' },
  { token: 'NUMBER', pattern: '[0-9]+(\\.[0-9]+)?', examples: '30, 24.5, 007' },
  { token: 'QUANTITY', pattern: 'NUMBER + unit from the unit table', examples: '30C, 30°C, 86F, 70%, 5MIN' },
  { token: 'TIME_LIT', pattern: '[0-9]{1,2}:[0-9]{2}, with HH ≤ 23 and MM ≤ 59', examples: '07:00, 7:05' },
  { token: 'STRING', pattern: '"([^"\\\\\\n]|\\\\.)*"', examples: '"Good morning!"' },
  { token: 'GT GE LT LE EQ NE', pattern: '> >= < <= == !=', examples: '>=' },
  { token: 'ASSIGN', pattern: '=', examples: 'TEMP = 32C' },
  { token: 'PLUS MINUS STAR SLASH', pattern: '+ - * /', examples: '30 + 2' },
  { token: 'PERCENT', pattern: '% on its own, after UNIT', examples: 'UNIT %' },
  { token: 'LPAREN RPAREN LBRACE RBRACE', pattern: '( ) { }', examples: '(' },
  { token: 'COMMA SEMI COLON', pattern: ', ; :', examples: ';' },
  { token: 'COMMENT (discarded)', pattern: '//… to end of line, or /* … */ (no nesting)', examples: '// note' },
  { token: 'WHITESPACE (discarded)', pattern: 'space, tab, CR, LF', examples: '' },
  { token: 'EOF', pattern: 'end of input', examples: '' },
];
