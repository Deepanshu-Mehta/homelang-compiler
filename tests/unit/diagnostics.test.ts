import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile, createSession, DIAGNOSTIC_CODES, stageOutput } from '../../src/compiler/index';

const DOC = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'language-reference.md'), 'utf8');

interface Row {
  code: string;
  severity: string;
  example?: string;
  added: boolean;
}

/** `«X×N»` in the table stands for X repeated N times. */
function expand(text: string): string {
  return text.replace(/«(.*?)×(\d+)»/g, (_all, unit: string, count: string) => unit.repeat(Number(count)));
}

function parseTable(): Row[] {
  return DOC.split('\n').flatMap((line) => {
    const cells = line.split(' | ').map((c) => c.trim());
    const code = /^\| ([LPSWRI]\d{3})$/.exec(cells[0] ?? '')?.[1];
    if (!code) return [];
    const example = /^`(.*)`$/.exec(cells[3] ?? '')?.[1];
    return [{ code, severity: cells[1]!, ...(example && { example: expand(example) }), added: line.endsWith('new |') }];
  });
}

/** Every code a program produces, from compile time and from a run. */
function codesFrom(source: string): string[] {
  const result = compile(source);
  const found = result.stages.flatMap((s) => s.diagnostics.map((d) => d.code));
  const object = stageOutput(result, 'codegen');
  if (object) {
    const session = createSession(object);
    session.runToEnd();
    for (const entry of session.log) {
      const code = /^(R\d{3}):/.exec(entry.text)?.[1];
      if (code) found.push(code);
    }
  }
  return found;
}

describe('the diagnostics table in language-reference.md', () => {
  const rows = parseTable();

  it('lists every code the compiler has, once', () => {
    expect(rows.map((r) => r.code).sort()).toEqual(Object.keys(DIAGNOSTIC_CODES).sort());
  });

  it('marks exactly the codes that plan.txt does not define', () => {
    expect(rows.filter((r) => r.added).map((r) => r.code).sort()).toEqual([
      'I001', 'P214', 'P215', 'P216', 'P217', 'P218', 'R502', 'R503', 'R504',
      'S320', 'S321', 'S322', 'S323', 'S324', 'S325', 'W415', 'W416',
    ]);
  });

  it.each(rows.map((r) => [r.code, r] as const))('%s is correct', (code, row) => {
    expect(row.severity).toBe(DIAGNOSTIC_CODES[code as keyof typeof DIAGNOSTIC_CODES].severity);
    if (code === 'I001') {
      expect(row.example).toBeUndefined();
      return;
    }
    expect(codesFrom(row.example!)).toContain(code);
  });
});
