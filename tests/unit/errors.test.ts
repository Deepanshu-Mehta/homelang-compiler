import { describe, expect, it } from 'vitest';
import { compile, stageOutput, stageResult, DIAGNOSTIC_CODES } from '../../src/compiler/index';
import { EDGE_CASE_ERRORS, INVALID_PROGRAMS, VALID_EDGE_CASES, type ErrorCase } from '../errors.table';

function verify({ source, stage, code, line, col, messageIncludes }: ErrorCase): void {
  const result = compile(source);
  const found = stageResult(result, stage).diagnostics.find((d) => d.code === code);
  expect(found, `no ${code} in ${JSON.stringify(stageResult(result, stage).diagnostics.map((d) => d.code))}`).toBeDefined();
  expect(found!.message).toContain(messageIncludes);
  expect({ line: found!.span.line, col: found!.span.col }).toEqual({ line, col });
}

describe('the §14.3 invalid-program suite', () => {
  it('has all 27 programs', () => {
    expect(INVALID_PROGRAMS).toHaveLength(27);
  });
  it.each(INVALID_PROGRAMS.map((c) => [c.code, c.source, c] as const))('%s: %s', (_code, _source, testCase) => {
    verify(testCase);
  });
});

describe('the §10 edge-case table', () => {
  it.each(EDGE_CASE_ERRORS.map((c) => [c.code, c.source, c] as const))('%s: %s', (_code, _source, testCase) => {
    verify(testCase);
  });

  it.each(VALID_EDGE_CASES.map((c) => [c.name, c] as const))('%s compiles', (_name, { source, tokens, rules }) => {
    const result = compile(source);
    for (const stage of ['lexer', 'parser', 'semantic'] as const) {
      expect(stageResult(result, stage).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    }
    if (tokens !== undefined) expect(stageOutput(result, 'lexer')!.tokenCount).toBe(tokens);
    if (rules !== undefined) expect(stageOutput(result, 'parser')!.ast.rules).toHaveLength(rules);
  });
});

describe('the diagnostics registry', () => {
  it('gives every code a severity and a hint', () => {
    for (const [code, info] of Object.entries(DIAGNOSTIC_CODES)) {
      expect(info.hint.length, code).toBeGreaterThan(0);
      expect(['error', 'warning', 'info']).toContain(info.severity);
    }
  });
});
