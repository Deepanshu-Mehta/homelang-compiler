import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const UI = join(import.meta.dirname, '..', '..', 'src', 'ui');
const TOKENS = join(UI, 'styles', 'tokens.css');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g;

describe('design tokens live in one file', () => {
  it.each(files(UI).filter((f) => f !== TOKENS).map((f) => [relative(UI, f), f] as const))('%s has no literal colours', (_name, file) => {
    const text = readFileSync(file, 'utf8');
    expect(text.match(COLOUR) ?? []).toEqual([]);
  });

  it('app.css uses no raw font sizes', () => {
    const css = readFileSync(join(UI, 'styles', 'app.css'), 'utf8');
    expect(css.match(/font-size:\s*[\d.]+(px|rem|em)/g) ?? []).toEqual([]);
  });

  it('every type step is at least 14px at the 16px root', () => {
    const css = readFileSync(TOKENS, 'utf8');
    const steps = [...css.matchAll(/--t-[a-z0-9]+:\s*([\d.]+)rem/g)].map((m) => Number(m[1]) * 16);
    expect(steps.length).toBeGreaterThan(3);
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(14);
  });
});
