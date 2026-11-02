import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const EXAMPLES_DIR = join(import.meta.dirname, '..', 'examples');

export interface Example {
  name: string;
  source: string;
}

export function loadExamples(): Example[] {
  return readdirSync(EXAMPLES_DIR)
    .filter((f) => f.endsWith('.home'))
    .sort()
    .map((f) => ({ name: f.replace('.home', ''), source: readFileSync(join(EXAMPLES_DIR, f), 'utf8') }));
}

/** Small seeded generator, so a fuzz failure is reproducible from its seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
