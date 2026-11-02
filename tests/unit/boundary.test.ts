import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const UI_DIR = join(import.meta.dirname, '..', '..', 'src', 'ui');

describe('the UI only sees the public compiler API', () => {
  it.each(sourceFiles(UI_DIR))('%s', (file) => {
    const imports = [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
    for (const path of imports.filter((i) => i.includes('compiler'))) {
      expect(path).toMatch(/\/compiler\/index$/);
    }
  });
});
