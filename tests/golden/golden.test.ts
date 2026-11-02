import { describe, expect, it } from 'vitest';
import { compile, emit, EMIT_STAGE, stageResult, type EmitKind } from '../../src/compiler/index';
import { loadExamples } from '../helpers';

const FILE_NAME: Partial<Record<EmitKind, string>> = {
  tokens: 'tokens.json',
  ast: 'ast.json',
  symbols: 'symbols.json',
};

describe.each(loadExamples())('golden: $name', ({ name, source }) => {
  const result = compile(source);
  for (const [kind, file] of Object.entries(FILE_NAME) as [EmitKind, string][]) {
    it(file, async () => {
      const text = emit(kind, stageResult(result, EMIT_STAGE[kind]));
      await expect(text).toMatchFileSnapshot(`./snapshots/${name}/${file}`);
    });
  }
});
