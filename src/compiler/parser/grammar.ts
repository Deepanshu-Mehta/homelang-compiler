import type { TokenType } from '../lexer/tokens';

/**
 * The grammar as data. The same object renders the grammar card and feeds the
 * FIRST/FOLLOW analysis in ll1.ts, so what the UI shows cannot drift from what
 * was proved. parser.ts implements it with one function per nonterminal.
 */
export type GrammarExpr =
  | { kind: 'token'; token: TokenType; text: string }
  | { kind: 'nonterminal'; name: string }
  | { kind: 'sequence'; items: GrammarExpr[] }
  | { kind: 'choice'; options: GrammarExpr[] }
  | { kind: 'optional'; item: GrammarExpr }
  | { kind: 'repeat'; item: GrammarExpr };

export interface Production {
  name: string;
  body: GrammarExpr;
}

type Part = GrammarExpr | string;

/** A lowercase string is a nonterminal; anything else is a token name. */
function toExpr(part: Part): GrammarExpr {
  if (typeof part !== 'string') return part;
  if (/^[a-z]/.test(part)) return { kind: 'nonterminal', name: part };
  return { kind: 'token', token: part as TokenType, text: TOKEN_TEXT[part] ?? part };
}

const TOKEN_TEXT: Readonly<Record<string, string>> = {
  GT: '">"', GE: '">="', LT: '"<"', LE: '"<="', EQ: '"=="', NE: '"!="', ASSIGN: '"="',
  PLUS: '"+"', MINUS: '"-"', STAR: '"*"', SLASH: '"/"', PERCENT: '"%"',
  LPAREN: '"("', RPAREN: '")"', LBRACE: '"{"', RBRACE: '"}"',
  COMMA: '","', SEMI: '";"', COLON: '":"',
};

const seq = (...parts: Part[]): GrammarExpr => {
  const items = parts.map(toExpr);
  return items.length === 1 ? items[0]! : { kind: 'sequence', items };
};
const alt = (...parts: Part[]): GrammarExpr => ({ kind: 'choice', options: parts.map(toExpr) });
const opt = (...parts: Part[]): GrammarExpr => ({ kind: 'optional', item: seq(...parts) });
const rep = (...parts: Part[]): GrammarExpr => ({ kind: 'repeat', item: seq(...parts) });
const p = (name: string, body: GrammarExpr): Production => ({ name, body });

export const GRAMMAR: readonly Production[] = [
  p('program', seq(rep('decl'), rep('rule'), opt('simulate'), 'EOF')),
  p('decl', alt(
    seq('ROOM', 'IDENT', 'SEMI'),
    seq('DEVICE', 'IDENT', 'COLON', 'IDENT', opt('IN', 'IDENT'), 'SEMI'),
    seq('SENSOR', 'IDENT', 'COLON', 'IDENT', opt('IN', 'IDENT'), opt('UNIT', 'unitName'), 'SEMI'),
  )),
  p('unitName', alt('IDENT', 'PERCENT')),
  p('rule', seq(opt('RULE', 'STRING', opt('PRIORITY', 'NUMBER'), 'COLON'), 'ruleBody', opt('SEMI'))),
  p('ruleBody', alt(
    seq('IF', 'cond', opt('FOR', 'duration'), 'THEN', 'actions', opt('ELSE', 'actions'), opt('END')),
    seq('WHEN', 'event', opt('IF', 'cond'), 'THEN', 'actions', opt('END')),
    seq('AT', 'TIME_LIT', opt('ON', 'days'), 'THEN', 'actions', opt('END')),
  )),
  p('duration', seq(opt('MINUS'), 'QUANTITY')),
  p('days', seq('DAY', rep('COMMA', 'DAY'))),
  p('event', seq('IDENT', 'eventTail')),
  p('eventTail', alt(
    'DETECTED', 'CLEARS', 'OPENS', 'CLOSES', 'LOCKS', 'UNLOCKS', 'CHANGES',
    seq('TURNS', alt('ON', 'OFF')),
    seq('RISES', 'ABOVE', 'value'),
    seq('FALLS', 'BELOW', 'value'),
  )),
  p('actions', seq('action', rep('COMMA', 'action'))),
  p('action', alt(
    seq('TURN_ON', 'IDENT'),
    seq('TURN_OFF', 'IDENT'),
    seq('TOGGLE', 'IDENT'),
    seq('SET', 'IDENT', 'IDENT', 'TO', 'value'),
    seq('LOCK', 'IDENT'),
    seq('UNLOCK', 'IDENT'),
    seq('OPEN', 'IDENT'),
    seq('CLOSE', 'IDENT'),
    seq('WAIT', 'duration'),
    seq('NOTIFY', 'STRING'),
    seq('IF', 'cond', 'THEN', 'actions', opt('ELSE', 'actions'), 'END'),
  )),
  p('cond', seq('andCond', rep('OR', 'andCond'))),
  p('andCond', seq('notCond', rep('AND', 'notCond'))),
  p('notCond', alt(seq('NOT', 'notCond'), 'atom')),
  p('atom', alt(seq('LPAREN', 'cond', 'RPAREN'), seq('value', opt('atomTail')))),
  p('atomTail', alt(
    seq('relop', 'value'),
    seq('IS', opt('NOT'), 'enumLit'),
    seq('BETWEEN', 'value', 'AND', 'value'),
  )),
  p('relop', alt('GT', 'GE', 'LT', 'LE', 'EQ', 'NE')),
  p('value', seq('term', rep(alt('PLUS', 'MINUS'), 'term'))),
  p('term', seq('factor', rep(alt('STAR', 'SLASH'), 'factor'))),
  p('factor', alt('NUMBER', 'QUANTITY', 'TIME_LIT', 'IDENT', seq('MINUS', 'factor'), 'enumLit')),
  p('enumLit', alt('state', 'DAY', 'TRUE', 'FALSE')),
  p('state', alt('ON', 'OFF', 'OPEN', 'CLOSED', 'LOCKED', 'UNLOCKED', 'DETECTED', 'CLEAR', 'HOME', 'AWAY')),
  p('simulate', seq('SIMULATE', opt('FROM', 'TIME_LIT', 'TO', 'TIME_LIT'), opt('STEP', 'duration'),
    'LBRACE', rep('simStmt'), 'RBRACE')),
  p('simStmt', seq('AT', 'TIME_LIT', 'COLON', 'assign', rep('COMMA', 'assign'), 'SEMI')),
  p('assign', seq('IDENT', 'ASSIGN', 'value')),
];

function renderExpr(expr: GrammarExpr, nested = false): string {
  switch (expr.kind) {
    case 'token':
      return expr.text;
    case 'nonterminal':
      return expr.name;
    case 'sequence':
      return expr.items.map((item) => renderExpr(item, true)).join(' ');
    case 'choice': {
      const text = expr.options.map((o) => renderExpr(o, true)).join(' | ');
      return nested ? `( ${text} )` : text;
    }
    case 'optional':
      return `[ ${renderExpr(expr.item)} ]`;
    case 'repeat':
      return `{ ${renderExpr(expr.item)} }`;
  }
}

export function renderAlternative(expr: GrammarExpr): string {
  return renderExpr(expr);
}

/** One right-hand side per line, as shown on the grammar card. */
export function renderProduction(production: Production): { name: string; alternatives: string[] } {
  const { body, name } = production;
  const alternatives = body.kind === 'choice' ? body.options.map((o) => renderExpr(o)) : [renderExpr(body)];
  return { name, alternatives };
}
