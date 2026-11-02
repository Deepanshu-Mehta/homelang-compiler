import { describe, expect, it } from 'vitest';
import { GRAMMAR, renderProduction, type Production } from '../../src/compiler/parser/grammar';
import { analyzeGrammar } from '../../src/compiler/parser/ll1';

const tok = (token: string) => ({ kind: 'token' as const, token: token as never, text: token });
const nt = (name: string) => ({ kind: 'nonterminal' as const, name });

describe('LL(1) analysis of the HomeLang grammar', () => {
  const analysis = analyzeGrammar();

  it('has no conflicts', () => {
    expect(analysis.conflicts).toEqual([]);
  });

  it('computes FIRST sets that include the new enum words', () => {
    expect(analysis.first['factor']).toEqual(expect.arrayContaining(['ON', 'OPEN', 'DAY', 'TRUE', 'NUMBER', 'MINUS']));
    expect(analysis.first['rule']).toEqual(['AT', 'IF', 'RULE', 'WHEN']);
    expect(analysis.first['atom']).toContain('LPAREN');
  });

  it('computes FOLLOW sets used by the LL(1) argument', () => {
    expect(analysis.follow['rule']).not.toContain('END');
    expect(analysis.follow['rule']).not.toContain('SEMI');
    expect(analysis.follow['value']).not.toContain('PLUS');
    expect(analysis.follow['actions']).not.toContain('COMMA');
    expect(analysis.follow['actions']).toEqual(expect.arrayContaining(['ELSE', 'END', 'SEMI', 'IF', 'EOF']));
  });

  it('builds a table with one production per cell', () => {
    const cells = new Set(analysis.table.map((e) => `${e.nonterminal}/${e.terminal}`));
    expect(cells.size).toBe(analysis.table.length);
    expect(analysis.table).toContainEqual({ nonterminal: 'notCond', terminal: 'NOT', production: 'NOT notCond' });
  });

  it('renders every production', () => {
    for (const production of GRAMMAR) expect(renderProduction(production).alternatives.length).toBeGreaterThan(0);
  });
});

describe('the checker catches grammars that are not LL(1)', () => {
  it('finds a FIRST/FIRST clash', () => {
    const grammar: Production[] = [
      { name: 'a', body: { kind: 'choice', options: [tok('X'), { kind: 'sequence', items: [tok('X'), tok('Y')] }] } },
    ];
    expect(analyzeGrammar(grammar).conflicts).toHaveLength(1);
  });

  it('finds a FIRST/FOLLOW clash on an optional part (the dangling else)', () => {
    const grammar: Production[] = [
      { name: 'stmt', body: { kind: 'choice', options: [
        { kind: 'sequence', items: [tok('IF'), nt('stmt'), { kind: 'optional', item: { kind: 'sequence', items: [tok('ELSE'), nt('stmt')] } }] },
        tok('X'),
      ] } },
      { name: 'start', body: { kind: 'sequence', items: [nt('stmt'), { kind: 'optional', item: tok('ELSE') }] } },
    ];
    const reasons = analyzeGrammar(grammar).conflicts.map((c) => c.tokens);
    expect(reasons).toContainEqual(['ELSE']);
  });

  it('flags the original plan.txt rule SET … TO ( value | state ) once factor has enums', () => {
    const grammar: Production[] = [
      { name: 'factor', body: { kind: 'choice', options: [tok('NUMBER'), nt('state')] } },
      { name: 'state', body: { kind: 'choice', options: [tok('ON'), tok('OFF')] } },
      { name: 'target', body: { kind: 'choice', options: [nt('factor'), nt('state')] } },
    ];
    const clash = analyzeGrammar(grammar).conflicts[0]!;
    expect(clash.nonterminal).toBe('target');
    expect(clash.tokens.sort()).toEqual(['OFF', 'ON']);
  });
});
