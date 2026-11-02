import { type Diagnostic, type DiagnosticCode, makeDiagnostic } from '../diagnostics';
import { SourceMap } from '../source';
import { charClass } from './dfa/charClass';
import { runDfa, selectDfa } from './dfa/index';
import type { DfaRun, } from './dfa/index';
import type { DfaName, DfaTrace } from './dfa/types';
import { KEYWORD_TABLE } from './keywords';
import type { PunctuationType, Token, TokenCategory, TokenType } from './tokens';
import { KNOWN_UNITS_TEXT, UNIT_TABLE } from './units';

const MAX_NUMBER = 1_000_000_000;

export interface LexerOutput {
  tokens: Token[];
  /** Tokens excluding EOF, for "X characters became Y tokens". */
  tokenCount: number;
  charCount: number;
  commentCount: number;
}

const PUNCTUATION: Readonly<Record<string, PunctuationType>> = {
  '+': 'PLUS', '-': 'MINUS', '*': 'STAR', '%': 'PERCENT', '(': 'LPAREN',
  ')': 'RPAREN', '{': 'LBRACE', '}': 'RBRACE', ',': 'COMMA', ';': 'SEMI',
  ':': 'COLON',
};

const SMART_QUOTES = '“”‘’';

/** Characters swallowed along with a malformed number or time. */
const isMalformedRunChar = (ch: string | undefined): boolean => {
  const cls = charClass(ch);
  return ['digit', 'letter', 'underscore', 'dot', 'colon', 'percent', 'degree'].includes(cls);
};

export function lex(source: string): { output: LexerOutput; diagnostics: Diagnostic[] } {
  return new Lexer(source).run();
}

class Lexer {
  private readonly map: SourceMap;
  private readonly tokens: Token[] = [];
  private readonly diagnostics: Diagnostic[] = [];
  private commentCount = 0;
  private pos = 0;

  constructor(private readonly source: string) {
    this.map = new SourceMap(source);
  }

  run(): { output: LexerOutput; diagnostics: Diagnostic[] } {
    while (this.skipWhitespace()) {
      const dfa = selectDfa(charClass(this.source[this.pos]));
      if (!dfa) {
        this.illegalCharacter();
        continue;
      }
      const start = this.pos;
      const result = runDfa(dfa, this.source, start);
      if (result.kind === 'error') this.handleDfaError(result, start);
      else this.handleAccept(dfa.name, result, start);
    }

    const end = this.source.length;
    this.tokens.push({
      type: 'EOF', category: 'eof', lexeme: '', upper: '', span: this.map.span(end, end),
    });
    return {
      output: {
        tokens: this.tokens,
        tokenCount: this.tokens.length - 1,
        charCount: this.source.length,
        commentCount: this.commentCount,
      },
      diagnostics: this.diagnostics,
    };
  }

  /** Returns false at end of input. */
  private skipWhitespace(): boolean {
    for (;;) {
      const cls = charClass(this.source[this.pos]);
      if (cls === 'eof') return false;
      if (cls !== 'space' && cls !== 'newline') return true;
      this.pos++;
    }
  }

  private report(code: DiagnosticCode, start: number, end: number, message: string, hint?: string): void {
    this.diagnostics.push(makeDiagnostic(code, this.map.span(start, end), message, hint));
  }

  private illegalCharacter(): void {
    const start = this.pos;
    const ch = this.source[start]!;
    const { line, col } = this.map.span(start, start);
    let hint: string | undefined;
    if (SMART_QUOTES.includes(ch)) hint = 'Use straight quotes (") around strings.';
    else if (ch === '.') hint = 'Write 0.5, not .5: a number starts with a digit.';
    else if (ch === '°') hint = '° is only valid straight after a number, as in 30°C.';
    this.report('L101', start, start + 1, `Illegal character '${ch}' at line ${line}, column ${col}.`, hint);
    this.pos++;
  }

  private handleDfaError(result: Extract<DfaRun, { kind: 'error' }>, start: number): void {
    const { code } = result;
    switch (code) {
      case 'L102':
        this.report(code, start, start + 1, "'!' is not an operator here; did you mean != or NOT?");
        this.pos = start + 1;
        return;
      case 'L108': {
        // Recover at the line end, so later tokens are still checked.
        const { line, col } = this.map.span(start, start);
        this.report(code, start, result.index, `Unterminated string starting at line ${line}, column ${col}.`);
        this.pos = result.index;
        return;
      }
      case 'L109': {
        const { line, col } = this.map.span(start, start);
        this.report(code, start, result.index, `Unterminated comment starting at line ${line}, column ${col}.`);
        this.pos = result.index;
        return;
      }
      default: {
        let end = result.index;
        while (isMalformedRunChar(this.source[end])) end++;
        const text = this.source.slice(start, end);
        if (code === 'L103') {
          const whole = text.slice(0, text.indexOf('.'));
          this.report(code, start, end, `Digit expected after '.' in '${text}'; write ${whole} or ${whole}.0.`);
        } else if (code === 'L104') {
          this.report(code, start, end, `Malformed number '${text}': only one decimal point is allowed.`);
        } else {
          this.malformedTime(text, start, end);
        }
        this.pos = end;
      }
    }
  }

  private malformedTime(text: string, start: number, end: number): void {
    const hint = /^\d+:\d$/.test(text)
      ? `If this is a rule header, put a space after the colon: PRIORITY ${text.split(':')[0]}: …`
      : undefined;
    this.report('L105', start, end, `Malformed time '${text}': use HH:MM.`, hint);
  }

  private handleAccept(dfaName: DfaName, run: Extract<DfaRun, { kind: 'accept' }>, start: number): void {
    const { end, accept } = run;
    const lexeme = this.source.slice(start, end);
    const span = this.map.span(start, end);
    this.pos = end;

    if (accept === 'COMMENT') {
      this.commentCount++;
      return;
    }

    const base = { lexeme, upper: lexeme.toUpperCase(), span };
    const trace = (description: string): DfaTrace => buildTrace(dfaName, run, description);

    switch (accept) {
      case 'IDENT': {
        const word = KEYWORD_TABLE.get(base.upper);
        this.tokens.push(word
          ? { ...base, type: word.type, category: word.category,
              trace: trace(`'${base.upper}' is in the keyword table, so this is ${word.type}`) }
          : { ...base, type: 'IDENT', category: 'ident',
              trace: trace(`'${lexeme}' is not in the keyword table, so this is an IDENT`) });
        return;
      }
      case 'NUMBER': {
        const value = Number(lexeme);
        if (value > MAX_NUMBER) {
          this.report('L110', start, end, 'Number too large (max 1,000,000,000).');
          return;
        }
        this.tokens.push({ ...base, type: 'NUMBER', category: 'literal', number: value,
          trace: trace(`this is a NUMBER (${value})`) });
        return;
      }
      case 'QUANTITY':
        this.quantity(base, run, dfaName);
        return;
      case 'TIME_LIT':
        this.time(base, run, dfaName);
        return;
      case 'STRING':
        this.tokens.push({ ...base, type: 'STRING', category: 'literal', text: unescape(lexeme),
          trace: trace('this is a STRING') });
        return;
      case 'SLASH':
      case 'GT': case 'GE': case 'LT': case 'LE': case 'EQ': case 'NE': case 'ASSIGN':
        this.pushOperator(accept, base, trace);
        return;
      default: {
        const type = PUNCTUATION[lexeme]!;
        this.tokens.push({ ...base, type, category: categoryOfPunct(type),
          trace: trace(`'${lexeme}' is ${type}`) });
      }
    }
  }

  private pushOperator(
    type: TokenType,
    base: Pick<Token, 'lexeme' | 'upper' | 'span'>,
    trace: (description: string) => DfaTrace,
  ): void {
    this.tokens.push({ ...base, type, category: 'operator', trace: trace(`this is ${type}`) });
  }

  private quantity(
    base: Pick<Token, 'lexeme' | 'upper' | 'span'>,
    run: Extract<DfaRun, { kind: 'accept' }>,
    dfaName: DfaName,
  ): void {
    const { lexeme, upper, span } = base;
    const digits = /^[0-9]+(\.[0-9]+)?/.exec(lexeme)![0];
    const suffix = upper.slice(digits.length);
    const unit = UNIT_TABLE[suffix];
    if (!unit) {
      const shown = lexeme.slice(digits.length);
      this.report('L106', span.start, span.end, `Unknown unit '${shown}' in '${lexeme}'. Known units: ${KNOWN_UNITS_TEXT}.`);
      return;
    }
    const number = Number(digits);
    if (number > MAX_NUMBER) {
      this.report('L110', span.start, span.end, 'Number too large (max 1,000,000,000).');
      return;
    }
    this.tokens.push({
      ...base, type: 'QUANTITY', category: 'literal',
      quantity: { number, unit: unit.unit, display: unit.display, dim: unit.dim },
      trace: buildTrace(dfaName, run, `this is a QUANTITY (${number} ${unit.display})`),
    });
  }

  private time(
    base: Pick<Token, 'lexeme' | 'upper' | 'span'>,
    run: Extract<DfaRun, { kind: 'accept' }>,
    dfaName: DfaName,
  ): void {
    const { lexeme, span } = base;
    const [hh, mm] = lexeme.split(':') as [string, string];
    if (hh.length > 2) {
      this.malformedTime(lexeme, span.start, span.end);
      return;
    }
    const hours = Number(hh);
    const minutes = Number(mm);
    if (hours > 23 || minutes > 59) {
      this.report('L107', span.start, span.end,
        `Invalid time '${lexeme}': hours must be 00–23 and minutes 00–59.`);
      return;
    }
    const total = hours * 60 + minutes;
    this.tokens.push({ ...base, type: 'TIME_LIT', category: 'literal', minutes: total,
      trace: buildTrace(dfaName, run, `this is a TIME_LIT (${total} minutes after midnight)`) });
  }
}

function categoryOfPunct(type: PunctuationType): TokenCategory {
  return ['PLUS', 'MINUS', 'STAR', 'SLASH'].includes(type) ? 'operator' : 'punct';
}

function buildTrace(
  dfa: DfaName,
  run: Extract<DfaRun, { kind: 'accept' }>,
  description: string,
): DfaTrace {
  const accepted = `Ended in accepting state ${run.state}, so ${description}.`;
  const summary = run.rollback
    ? `State ${run.rollback.deadState} had no move and is not accepting, so the lexer rolled back to the last accepting state ${run.state} and will re-scan '${run.rollback.discarded}'. ${accepted}`
    : accepted;
  return {
    dfa,
    steps: run.steps,
    finalState: run.state,
    ...(run.rollback && { rollback: run.rollback }),
    summary,
  };
}

function unescape(lexeme: string): string {
  const inner = lexeme.slice(1, -1);
  return inner.replace(/\\(.)/g, (_match, ch: string) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch));
}
