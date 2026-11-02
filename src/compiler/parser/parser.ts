import { type Diagnostic, type DiagnosticCode, type Span, makeDiagnostic } from '../diagnostics';
import { ACTION_KEYWORDS } from '../lexer/keywords';
import type { Token, TokenType } from '../lexer/tokens';
import { UNIT_TABLE } from '../lexer/units';
import type { EventName } from '../semantic/catalog';
import type {
  Action, ArithOp, Cond, Decl, DurationLit, EnumLit, Expr, IfAction, PowerOp, Program, Ref, Relop,
  Rule, SimAssign, Simulation, SimStmt, Trigger,
} from './ast';
import type { ParseNode, ParseStep } from './parseTree';

/** Deepest nesting of grammar rules, which protects the JavaScript stack. */
const MAX_DEPTH = 400;
/** Longest AND/OR/+/* chain: later phases recurse over the left-nested tree. */
const MAX_CHAIN = 1000;
const MAX_STEPS = 5000;

const RELOPS: Partial<Record<TokenType, Relop>> = {
  GT: '>', GE: '>=', LT: '<', LE: '<=', EQ: '==', NE: '!=',
};

const POWER_OPS: Partial<Record<TokenType, PowerOp>> = {
  TURN_ON: 'TURN_ON', TURN_OFF: 'TURN_OFF', TOGGLE: 'TOGGLE', LOCK: 'LOCK',
  UNLOCK: 'UNLOCK', OPEN: 'OPEN', CLOSE: 'CLOSE',
};

const SIMPLE_EVENTS: Partial<Record<TokenType, EventName>> = {
  DETECTED: 'DETECTED', CLEARS: 'CLEARS', OPENS: 'OPENS', CLOSES: 'CLOSES',
  LOCKS: 'LOCKS', UNLOCKS: 'UNLOCKS', CHANGES: 'CHANGES',
};

const STATE_TOKENS: ReadonlySet<TokenType> = new Set<TokenType>([
  'ON', 'OFF', 'OPEN', 'CLOSED', 'LOCKED', 'UNLOCKED', 'DETECTED', 'CLEAR', 'HOME', 'AWAY',
]);

const RULE_START: ReadonlySet<TokenType> = new Set<TokenType>(['RULE', 'IF', 'WHEN', 'AT']);

/** Tokens panic mode stops at. See Crafting Interpreters' synchronize(). */
const SYNC_TOKENS: ReadonlySet<TokenType> = new Set<TokenType>([
  'RULE', 'IF', 'WHEN', 'AT', 'SIMULATE', 'RBRACE', 'EOF',
]);

export interface ParserOutput {
  ast: Program;
  parseTree: ParseNode;
  steps: ParseStep[];
}

/** Unwinds to the nearest recovery point. Never escapes parse(). */
class SyntaxStop extends Error {}

export function parse(
  tokens: readonly Token[],
  source: string,
  collectAllErrors = false,
): { output: ParserOutput; diagnostics: Diagnostic[] } {
  return new Parser(tokens, source, collectAllErrors).parseProgram();
}

/**
 * LL(1) recursive descent. Each method below is one nonterminal of grammar.ts
 * and picks its alternative from the single token `this.peek()`. Repetitions
 * in the EBNF are `while` loops, so the grammar has no left recursion to remove.
 */
class Parser {
  private pos = 0;
  private readonly diagnostics: Diagnostic[] = [];
  private readonly root: ParseNode = { kind: 'node', name: 'program', children: [] };
  private readonly stack: ParseNode[] = [this.root];
  private readonly steps: ParseStep[] = [{ rule: 'program', tokenIndex: 0, depth: 0 }];
  private ruleCount = 0;
  private parenDepth = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly source: string,
    private readonly collectAllErrors: boolean,
  ) {}

  // ---- token helpers ------------------------------------------------------

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private advance(): Token {
    const token = this.peek();
    this.stack[this.stack.length - 1]!.children.push({
      kind: 'leaf', tokenType: token.type, lexeme: token.lexeme,
    });
    if (this.pos < this.tokens.length - 1) this.pos++;
    return token;
  }

  private match(type: TokenType): Token | undefined {
    return this.check(type) ? this.advance() : undefined;
  }

  private fail(code: DiagnosticCode, span: Span, message: string, hint?: string): never {
    this.diagnostics.push(makeDiagnostic(code, span, message, hint));
    throw new SyntaxStop();
  }

  private found(token: Token = this.peek()): string {
    if (token.type === 'EOF') return 'end of input';
    if (token.category === 'operator' || token.category === 'punct') return `'${token.lexeme}'`;
    return token.lexeme;
  }

  private where(span: Span): string {
    return `line ${span.line}, column ${span.col}`;
  }

  /** Text of a source range, for messages that quote the user's own code. */
  private text(span: Span): string {
    return this.source.slice(span.start, span.end);
  }

  private spanFrom(start: Span, end: Span): Span {
    return { line: start.line, col: start.col, start: start.start, end: Math.max(start.end, end.end) };
  }

  /** The span of the token before the current one. */
  private previous(): Span {
    return this.tokens[Math.max(0, this.pos - 1)]!.span;
  }

  /** Wraps one nonterminal so that it appears in the parse tree and the trace. */
  private rule<T>(name: string, body: () => T): T {
    if (this.stack.length >= MAX_DEPTH) {
      this.fail('P218', this.peek().span, 'This program is nested too deeply to parse.');
    }
    const node: ParseNode = { kind: 'node', name, children: [] };
    this.stack[this.stack.length - 1]!.children.push(node);
    this.stack.push(node);
    if (this.steps.length < MAX_STEPS) {
      this.steps.push({ rule: name, tokenIndex: this.pos, depth: this.stack.length - 1 });
    }
    const depth = this.stack.length;
    try {
      return body();
    } finally {
      this.stack.length = depth - 1; // also drops nodes left open by a SyntaxStop
    }
  }

  private checkChain(length: number): void {
    if (length > MAX_CHAIN) {
      this.fail('P218', this.peek().span, 'This expression is too long; split it into smaller rules.');
    }
  }

  private expectName(what: string, after: string): Token {
    const token = this.peek();
    if (token.type === 'IDENT') return this.advance();
    if (token.category === 'keyword' || token.category === 'action' ||
        token.category === 'state' || token.category === 'day') {
      this.fail('P214', token.span, `Expected a name; found keyword ${token.lexeme}.`);
    }
    return this.fail('P215', token.span, `Expected ${what} after ${after}; found ${this.found(token)}.`);
  }

  private expect(type: TokenType, description: string): Token {
    const token = this.match(type);
    if (token) return token;
    return this.fail('P215', this.peek().span,
      `Expected ${description}; found ${this.found()}.`);
  }

  // ---- program → { decl } { rule } [ simulate ] EOF ------------------------

  parseProgram(): { output: ParserOutput; diagnostics: Diagnostic[] } {
    const program: Program = {
      kind: 'Program', decls: [], rules: [],
      span: { line: 1, col: 1, start: 0, end: this.source.length },
    };

    try {
      this.parseBody(program);
    } catch (cause) {
      if (!(cause instanceof SyntaxStop)) throw cause;
    }
    return {
      output: { ast: program, parseTree: this.root, steps: this.steps },
      diagnostics: this.diagnostics,
    };
  }

  private parseBody(program: Program): void {
    this.recovering(() => this.isDeclStart(), () => program.decls.push(this.decl()));
    this.recovering(() => !this.atTopLevelEnd(), () => {
      this.rejectBadRuleStart();
      program.rules.push(this.rule_());
    });

    if (this.check('SIMULATE')) {
      program.sim = this.simulate();
      if (!this.check('EOF')) {
        this.fail('P215', this.peek().span, `Expected end of input after SIMULATE; found ${this.found()}.`);
      }
    }
    this.advance(); // EOF
  }

  private isDeclStart(): boolean {
    const { type } = this.peek();
    return type === 'ROOM' || type === 'DEVICE' || type === 'SENSOR';
  }

  private atTopLevelEnd(): boolean {
    const { type } = this.peek();
    return type === 'SIMULATE' || type === 'EOF';
  }

  /**
   * Runs `step` while `more` holds. With collect-all on, a syntax error resumes
   * at the next synchronising token (panic mode); otherwise it stops the parser.
   */
  private recovering(more: () => boolean, step: () => void): void {
    while (more()) {
      const started = this.pos;
      try {
        step();
      } catch (cause) {
        if (!(cause instanceof SyntaxStop) || !this.collectAllErrors) throw cause;
        this.synchronize();
        if (this.pos === started) this.pos++; // always make progress
      }
    }
  }

  /** Panic mode: discard tokens until a point where a rule can start cleanly. */
  private synchronize(): void {
    for (;;) {
      const { type } = this.peek();
      if (type === 'SEMI' || type === 'END') {
        this.pos++;
        if (this.check('SEMI')) this.pos++;
        return;
      }
      if (SYNC_TOKENS.has(type)) return;
      this.pos++;
    }
  }

  private rejectBadRuleStart(): void {
    const token = this.peek();
    if (RULE_START.has(token.type)) return;
    if (this.isDeclStart()) {
      this.fail('P217', token.span, `Declarations must come before the first rule; found ${token.lexeme}.`);
    }
    if (token.type === 'ELSE') this.fail('P206', token.span, 'ELSE without a matching IF.');
    this.fail('P215', token.span, `Expected a rule (IF, WHEN, AT or RULE); found ${this.found(token)}.`,
      token.category === 'action' ? 'Actions go inside a rule, as in IF … THEN TURN_ON AC.' : undefined);
  }

  // ---- declarations -------------------------------------------------------

  private decl(): Decl {
    return this.rule('decl', () => {
      const keyword = this.advance();
      const name = this.expectName('a name', keyword.lexeme);
      const base = { name: name.upper, display: name.lexeme, nameSpan: name.span };

      if (keyword.type === 'ROOM') {
        this.endDecl(name);
        return { kind: 'RoomDecl', ...base, span: this.spanFrom(keyword.span, name.span) };
      }

      this.expect('COLON', `':' and a type after ${name.lexeme}`);
      const type = this.expectName('a type name', "':'");
      const inRoom = this.match('IN');
      const room = inRoom ? this.expectName('a room name', 'IN') : undefined;
      const typed = {
        ...base, typeName: type.upper, typeSpan: type.span,
        ...(room && { room: room.upper, roomSpan: room.span }),
      };

      if (keyword.type === 'DEVICE') {
        this.endDecl(name);
        return { kind: 'DeviceDecl', ...typed, span: this.spanFrom(keyword.span, this.previous()) };
      }

      const unit = this.match('UNIT') ? this.unitName() : undefined;
      this.endDecl(name);
      return {
        kind: 'SensorDecl', ...typed,
        ...(unit && { unit: unit.upper, unitSpan: unit.span }),
        span: this.spanFrom(keyword.span, this.previous()),
      };
    });
  }

  private endDecl(name: Token): void {
    if (!this.match('SEMI')) {
      this.fail('P211', this.previous(), `Expected ';' to end the declaration of ${name.lexeme}.`);
    }
  }

  private unitName(): Token {
    return this.rule('unitName', () => {
      if (this.check('IDENT') || this.check('PERCENT')) return this.advance();
      return this.fail('P215', this.peek().span, `Expected a unit after UNIT; found ${this.found()}.`);
    });
  }

  // ---- rules --------------------------------------------------------------

  /** Underscore only because `rule` is the tracing helper. */
  private rule_(): Rule {
    return this.rule('rule', () => {
      const id = `R${++this.ruleCount}`;
      const start = this.peek().span;
      let name: string | undefined;
      let priority = 1;
      let prioritySpan: Span | undefined;

      if (this.match('RULE')) {
        name = this.expect('STRING', 'a rule name in quotes after RULE').text!;
        if (this.match('PRIORITY')) {
          const number = this.expect('NUMBER', 'a number after PRIORITY');
          priority = number.number!;
          prioritySpan = number.span;
        }
        this.expect('COLON', "':' after the rule header");
      }

      const body = this.ruleBody();
      const end = this.previous();
      this.match('SEMI');
      return {
        kind: 'Rule', id, priority, ...body,
        ...(name !== undefined && { name }),
        ...(prioritySpan && { prioritySpan }),
        span: this.spanFrom(start, end),
      };
    });
  }

  private ruleBody(): Pick<Rule, 'trigger' | 'thenActs' | 'elseActs'> {
    return this.rule('ruleBody', () => {
      const token = this.peek();
      switch (token.type) {
        case 'IF':
          return this.ifRule();
        case 'WHEN':
          return this.whenRule();
        case 'AT':
          return this.atRule();
        default:
          return this.fail('P215', token.span,
            `Expected IF, WHEN or AT after the rule header; found ${this.found(token)}.`);
      }
    });
  }

  private ifRule(): Pick<Rule, 'trigger' | 'thenActs' | 'elseActs'> {
    this.advance();
    const cond = this.cond('IF');
    const hold = this.match('FOR') ? this.duration() : undefined;
    this.expectThen('the condition');
    const thenActs = this.actions('THEN');
    const elseToken = this.match('ELSE');
    const elseActs = elseToken ? this.actions('ELSE') : undefined;
    if (elseToken && this.check('ELSE')) {
      this.fail('P207', this.peek().span,
        `A rule can have only one ELSE; the first ELSE is at ${this.where(elseToken.span)}.`);
    }
    this.match('END');
    const trigger: Trigger = { kind: 'State', cond, ...(hold && { hold }) };
    return { trigger, thenActs, ...(elseActs && { elseActs }) };
  }

  private whenRule(): Pick<Rule, 'trigger' | 'thenActs'> {
    const start = this.advance().span;
    const { source, event, value } = this.event();
    const guard = this.match('IF') ? this.cond('IF') : undefined;
    this.expectThen(guard ? 'the condition' : 'the event');
    const end = this.previous();
    const thenActs = this.actions('THEN');
    this.endEventRule();
    const trigger: Trigger = {
      kind: 'Event', source, event, span: this.spanFrom(start, end),
      ...(value && { value }), ...(guard && { guard }),
    };
    return { trigger, thenActs };
  }

  private atRule(): Pick<Rule, 'trigger' | 'thenActs'> {
    const start = this.advance().span;
    const time = this.expect('TIME_LIT', 'a time such as 07:00 after AT');
    const dayList = this.match('ON') ? this.days() : undefined;
    this.expectThen('the time');
    const end = this.previous();
    const thenActs = this.actions('THEN');
    this.endEventRule();
    const trigger: Trigger = {
      kind: 'Time', minutes: time.minutes!, span: this.spanFrom(start, end),
      ...(dayList && { days: dayList.map((d) => d.upper), daySpans: dayList.map((d) => d.span) }),
    };
    return { trigger, thenActs };
  }

  /** WHEN and AT rules have no ELSE, so an ELSE here has no matching IF. */
  private endEventRule(): void {
    if (this.check('ELSE')) this.fail('P206', this.peek().span, 'ELSE without a matching IF.');
    this.match('END');
  }

  private expectThen(after: string): void {
    if (!this.match('THEN')) {
      const token = this.peek();
      this.fail('P201', token.span,
        `Expected THEN after ${after}; found ${this.found(token)} at ${this.where(token.span)}.`);
    }
  }

  private duration(): DurationLit {
    return this.rule('duration', () => {
      const minus = this.match('MINUS');
      const token = this.peek();
      if (token.type !== 'QUANTITY') {
        this.fail('P215', token.span, `Expected a duration such as 5MIN; found ${this.found(token)}.`,
          token.type === 'NUMBER' ? `Add a unit: ${token.lexeme}S or ${token.lexeme}MIN.` : undefined);
      }
      this.advance();
      const { number, unit } = token.quantity!;
      return {
        value: minus ? -number : number, unit,
        text: minus ? `-${token.lexeme}` : token.lexeme,
        span: minus ? this.spanFrom(minus.span, token.span) : token.span,
      };
    });
  }

  private days(): Token[] {
    return this.rule('days', () => {
      const list = [this.expect('DAY', 'a day such as MON or WEEKDAYS after ON')];
      while (this.match('COMMA')) list.push(this.expect('DAY', "a day after ','"));
      return list;
    });
  }

  private event(): { source: Ref; event: EventName; value?: Expr } {
    return this.rule('event', () => {
      const name = this.expectName('a device or sensor name', 'WHEN');
      const source = this.ref(name);
      return { source, ...this.eventTail() };
    });
  }

  private eventTail(): { event: EventName; value?: Expr } {
    return this.rule('eventTail', () => {
      const token = this.peek();
      const simple = SIMPLE_EVENTS[token.type];
      if (simple) {
        this.advance();
        return { event: simple };
      }
      if (this.match('TURNS')) {
        if (this.match('ON')) return { event: 'TURNS_ON' as const };
        if (this.match('OFF')) return { event: 'TURNS_OFF' as const };
        return this.fail('P215', this.peek().span, `Expected ON or OFF after TURNS; found ${this.found()}.`);
      }
      if (this.match('RISES')) {
        this.expect('ABOVE', 'ABOVE after RISES');
        return { event: 'RISES_ABOVE' as const, value: this.valueAfter('ABOVE') };
      }
      if (this.match('FALLS')) {
        this.expect('BELOW', 'BELOW after FALLS');
        return { event: 'FALLS_BELOW' as const, value: this.valueAfter('BELOW') };
      }
      return this.fail('P215', token.span, `Expected an event such as DETECTED or TURNS ON; found ${this.found(token)}.`);
    });
  }

  // ---- actions ------------------------------------------------------------

  private actions(after: string): Action[] {
    return this.rule('actions', () => {
      const list = [this.action(after)];
      while (this.match('COMMA')) list.push(this.action("','"));
      return list;
    });
  }

  private action(after: string): Action {
    return this.rule('action', () => {
      const token = this.peek();
      const power = POWER_OPS[token.type];
      if (power) {
        this.advance();
        const target = this.ref(this.expectName('a device name', token.lexeme));
        return { kind: 'Power', op: power, target, span: this.spanFrom(token.span, target.span) };
      }
      switch (token.type) {
        case 'SET':
          return this.setAction(token);
        case 'WAIT': {
          this.advance();
          const duration = this.duration();
          return { kind: 'Wait', duration, span: this.spanFrom(token.span, duration.span) };
        }
        case 'NOTIFY': {
          this.advance();
          const message = this.expect('STRING', 'a message in quotes after NOTIFY');
          return { kind: 'Notify', text: message.text!, span: this.spanFrom(token.span, message.span) };
        }
        case 'IF':
          return this.nestedIf();
        default:
          return this.unknownAction(after);
      }
    });
  }

  private setAction(keyword: Token): Action {
    this.advance();
    const target = this.ref(this.expectName('a device name', 'SET'));
    const attr = this.expectName('an attribute name', target.display);
    this.expect('TO', 'TO after the attribute');
    const value = this.valueAfter('TO');
    return {
      kind: 'SetAttr', target, attr: attr.upper, attrSpan: attr.span, value,
      span: this.spanFrom(keyword.span, value.span),
    };
  }

  private nestedIf(): IfAction {
    const start = this.advance();
    const cond = this.cond('IF');
    this.expectThen('the condition');
    const thenActs = this.actions('THEN');
    const elseActs = this.match('ELSE') ? this.actions('ELSE') : undefined;
    // END is mandatory here, which is what rules out the dangling else.
    if (!this.match('END')) {
      this.fail('P213', this.peek().span,
        `Nested IF at ${this.where(start.span)} needs END before ${this.check('ELSE') ? 'ELSE' : 'the next rule'}.`);
    }
    return {
      kind: 'IfAction', cond, thenActs,
      ...(elseActs && { elseActs }),
      span: this.spanFrom(start.span, this.previous()),
    };
  }

  private unknownAction(after: string): never {
    const token = this.peek();
    if (token.type === 'IDENT') {
      const suggestion = suggestAction(token.upper, this.peek(1).type);
      this.fail('P208', token.span,
        `Unknown action '${token.lexeme}'.${suggestion ? ` Did you mean ${suggestion}?` : ''}`,
        suggestion ? undefined : `Actions are: ${ACTION_KEYWORDS.join(', ')}.`);
    }
    return this.fail('P202', token.span, `Expected an action after ${after}; found ${this.found(token)}.`);
  }

  // ---- conditions ---------------------------------------------------------

  private cond(after: string): Cond {
    return this.rule('cond', () => {
      let left = this.andCond(after);
      for (let count = 0; this.match('OR'); count++) {
        this.checkChain(count);
        const right = this.andCond('OR');
        left = { kind: 'Logic', op: 'OR', left, right, span: this.spanFrom(left.span, right.span) };
      }
      return left;
    });
  }

  private andCond(after: string): Cond {
    return this.rule('andCond', () => {
      let left = this.notCond(after);
      for (let count = 0; this.match('AND'); count++) {
        this.checkChain(count);
        const right = this.notCond('AND');
        left = { kind: 'Logic', op: 'AND', left, right, span: this.spanFrom(left.span, right.span) };
      }
      return left;
    });
  }

  private notCond(after: string): Cond {
    return this.rule('notCond', () => {
      const not = this.match('NOT');
      if (not) {
        const operand = this.notCond('NOT');
        return { kind: 'Not', operand, span: this.spanFrom(not.span, operand.span) };
      }
      return this.atom(after);
    });
  }

  private atom(after: string): Cond {
    return this.rule('atom', () => {
      const open = this.match('LPAREN');
      if (open) return this.group(open);
      if (!this.startsValue()) this.badConditionStart(after);

      const value = this.value();
      if (this.isRelop() || this.check('IS') || this.check('BETWEEN')) return this.atomTail(value);
      return this.bareValue(value);
    });
  }

  private group(open: Token): Cond {
    if (this.check('RPAREN')) {
      this.fail('P210', open.span, 'Empty parentheses: expected a condition inside ( ).');
    }
    this.parenDepth++;
    let inner: Cond;
    try {
      inner = this.cond("'('");
    } finally {
      this.parenDepth--;
    }
    if (!this.match('RPAREN')) {
      this.fail('P203', open.span, `Missing ). The ( at ${this.where(open.span)} was never closed.`);
    }
    return inner;
  }

  private badConditionStart(after: string): never {
    const token = this.peek();
    if (this.isRelop()) {
      this.fail('P205', token.span, `Expected a value before '${token.lexeme}'.`);
    }
    return this.fail('P204', token.span, `Expected a condition after ${after}; found ${this.found(token)}.`);
  }

  /** atom → value with no atomTail: only TRUE and FALSE are conditions by themselves. */
  private bareValue(value: Expr): Cond {
    if (value.kind === 'EnumLit' && value.category === 'bool') {
      return { kind: 'BoolLit', value: value.value === 'TRUE', span: value.span };
    }
    const token = this.peek();
    if (token.type === 'ASSIGN') {
      this.fail('P215', token.span, "Expected a comparison; found '='.",
        'Use == to compare. A single = only assigns inside SIMULATE.');
    }
    return this.fail('P216', value.span, `'${this.text(value.span)}' is a value, not a condition.`,
      this.parenDepth > 0
        ? 'Parentheses group conditions, not arithmetic. Write TEMP + 2 > 30 with no parentheses.'
        : undefined);
  }

  private isRelop(): boolean {
    return RELOPS[this.peek().type] !== undefined;
  }

  private atomTail(left: Expr): Cond {
    return this.rule('atomTail', () => {
      if (this.isRelop()) return this.comparison(left);
      if (this.check('IS')) return this.stateTest(left);
      return this.between(left);
    });
  }

  private comparison(left: Expr): Cond {
    const operator = this.rule('relop', () => this.advance());
    const right = this.valueAfter(`'${operator.lexeme}'`);
    if (this.isRelop()) this.chainedComparison(left, operator, right);
    const op = RELOPS[operator.type]!;
    return { kind: 'Compare', op, left, right, span: this.spanFrom(left.span, right.span) };
  }

  /** Comparisons are non-associative: `20 < TEMP < 30` has no meaning here. */
  private chainedComparison(left: Expr, firstOp: Token, middle: Expr): never {
    const second = this.peek();
    const rest = this.tokens[this.pos + 1];
    const [a, b] = [this.text(left.span), this.text(middle.span)];
    const c = rest && rest.type !== 'EOF' ? rest.lexeme : '…';
    return this.fail('P209', second.span,
      `Comparisons cannot be chained; write ${a} ${firstOp.lexeme} ${b} AND ${b} ${second.lexeme} ${c}.`);
  }

  private stateTest(target: Expr): Cond {
    this.advance(); // IS
    const negated = this.match('NOT') !== undefined;
    if (!this.startsEnum()) {
      const token = this.peek();
      this.fail('P215', token.span, `Expected a state after IS; found ${this.found(token)}.`,
        token.type === 'CLOSE' ? 'CLOSE is an action. The state is CLOSED.' : undefined);
    }
    const state = this.enumLit();
    return {
      kind: 'StateTest', target, negated, state: state.value, stateSpan: state.span,
      span: this.spanFrom(target.span, state.span),
    };
  }

  private between(subject: Expr): Cond {
    this.advance(); // BETWEEN
    const lo = this.valueAfter('BETWEEN');
    this.expect('AND', 'AND between the two limits');
    const hi = this.valueAfter('AND');
    return { kind: 'Between', subject, lo, hi, span: this.spanFrom(subject.span, hi.span) };
  }

  // ---- values -------------------------------------------------------------

  private startsEnum(): boolean {
    const { type } = this.peek();
    return STATE_TOKENS.has(type) || type === 'DAY' || type === 'TRUE' || type === 'FALSE';
  }

  private startsValue(): boolean {
    const { type } = this.peek();
    return type === 'NUMBER' || type === 'QUANTITY' || type === 'TIME_LIT' || type === 'IDENT' ||
      type === 'MINUS' || this.startsEnum();
  }

  private valueAfter(what: string): Expr {
    if (!this.startsValue()) {
      this.fail('P205', this.peek().span, `Expected a value after ${what}; found ${this.found()}.`);
    }
    return this.value();
  }

  private value(): Expr {
    return this.rule('value', () => {
      let left = this.term();
      for (let count = 0; this.check('PLUS') || this.check('MINUS'); count++) {
        this.checkChain(count);
        const operator = this.advance();
        const right = this.operand(operator, () => this.term());
        left = this.arith(operator, left, right);
      }
      return left;
    });
  }

  private term(): Expr {
    return this.rule('term', () => {
      let left = this.factor();
      for (let count = 0; this.check('STAR') || this.check('SLASH'); count++) {
        this.checkChain(count);
        const operator = this.advance();
        const right = this.operand(operator, () => this.factor());
        left = this.arith(operator, left, right);
      }
      return left;
    });
  }

  private operand(operator: Token, parseIt: () => Expr): Expr {
    if (!this.startsValue()) {
      this.fail('P205', this.peek().span, `Expected a value after '${operator.lexeme}'; found ${this.found()}.`);
    }
    return parseIt();
  }

  private arith(operator: Token, left: Expr, right: Expr): Expr {
    return {
      kind: 'Arith', op: operator.lexeme as ArithOp, left, right,
      span: this.spanFrom(left.span, right.span),
    };
  }

  private factor(): Expr {
    return this.rule('factor', () => {
      const token = this.peek();
      switch (token.type) {
        case 'NUMBER':
          return this.numberFactor(token);
        case 'QUANTITY': {
          this.advance();
          const { number, unit } = token.quantity!;
          return { kind: 'NumLit', value: number, unit, text: token.lexeme, span: token.span };
        }
        case 'TIME_LIT':
          this.advance();
          return { kind: 'TimeLit', minutes: token.minutes!, text: token.lexeme, span: token.span };
        case 'IDENT':
          this.advance();
          return this.ref(token);
        case 'MINUS': {
          this.advance();
          const operand = this.operand(token, () => this.factor());
          return { kind: 'Neg', operand, span: this.spanFrom(token.span, operand.span) };
        }
        default:
          return this.enumLit();
      }
    });
  }

  private numberFactor(token: Token): Expr {
    this.advance();
    const next = this.peek();
    const isUnitWord = next.type === 'PERCENT' || (next.type === 'IDENT' && UNIT_TABLE[next.upper] !== undefined);
    if (isUnitWord) {
      this.fail('P212', next.span,
        `A unit must touch its number: write ${token.lexeme}${next.lexeme}, not ${token.lexeme} ${next.lexeme}.`);
    }
    return { kind: 'NumLit', value: token.number!, text: token.lexeme, span: token.span };
  }

  private enumLit(): EnumLit {
    return this.rule('enumLit', () => {
      if (STATE_TOKENS.has(this.peek().type)) {
        const token = this.rule('state', () => this.advance());
        return { kind: 'EnumLit', value: token.upper, category: 'state' as const, span: token.span };
      }
      const token = this.advance();
      const category = token.type === 'DAY' ? ('day' as const) : ('bool' as const);
      return { kind: 'EnumLit', value: token.upper, category, span: token.span };
    });
  }

  private ref(token: Token): Ref {
    return { kind: 'Ref', name: token.upper, display: token.lexeme, span: token.span };
  }

  // ---- simulate -----------------------------------------------------------

  private simulate(): Simulation {
    return this.rule('simulate', () => {
      const start = this.advance().span;
      const sim: Simulation = { kind: 'Simulation', stmts: [], span: start };

      if (this.match('FROM')) {
        sim.from = this.expect('TIME_LIT', 'a time after FROM').minutes!;
        this.expect('TO', 'TO after the start time');
        sim.to = this.expect('TIME_LIT', 'a time after TO').minutes!;
      }
      if (this.match('STEP')) sim.step = this.duration();
      this.expect('LBRACE', "'{' to open the scenario");

      this.recovering(() => this.check('AT'), () => sim.stmts.push(this.simStmt()));
      if (!this.match('RBRACE')) {
        this.fail('P215', this.peek().span, `Expected AT or '}' in the scenario; found ${this.found()}.`);
      }
      sim.span = this.spanFrom(start, this.previous());
      return sim;
    });
  }

  private simStmt(): SimStmt {
    return this.rule('simStmt', () => {
      const start = this.advance().span;
      const time = this.expect('TIME_LIT', 'a time after AT');
      this.expect('COLON', "':' after the time");
      const assigns = [this.assign()];
      while (this.match('COMMA')) assigns.push(this.assign());
      this.expect('SEMI', "';' after the assignments");
      return { minutes: time.minutes!, assigns, span: this.spanFrom(start, this.previous()) };
    });
  }

  private assign(): SimAssign {
    return this.rule('assign', () => {
      const target = this.ref(this.expectName('a sensor name', 'the time'));
      this.expect('ASSIGN', `'=' after ${target.display}`);
      const value = this.valueAfter("'='");
      return { target, value, span: this.spanFrom(target.span, value.span) };
    });
  }
}

/** The action a misspelled word most likely meant. Used only for the P208 hint. */
function suggestAction(word: string, next: TokenType): string | undefined {
  if (word === 'TURN' || word === 'SWITCH') return next === 'OFF' ? 'TURN_OFF' : 'TURN_ON';
  let best: string | undefined;
  let bestDistance = 3;
  for (const action of ACTION_KEYWORDS) {
    const distance = editDistance(word, action);
    if (distance < bestDistance) {
      best = action;
      bestDistance = distance;
    }
  }
  return best;
}

export function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      next.push(Math.min(row[j]! + 1, next[j - 1]! + 1, substitution));
    }
    row = next;
  }
  return row[b.length]!;
}
