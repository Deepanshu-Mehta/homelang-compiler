import type { CharClass } from './types';

const SINGLE_CHARS: Readonly<Record<string, CharClass>> = {
  '_': 'underscore', '.': 'dot', ':': 'colon', '%': 'percent', '°': 'degree',
  '>': 'gt', '<': 'lt', '=': 'eq', '!': 'bang', '"': 'quote', '\\': 'backslash',
  '/': 'slash', '*': 'star', '+': 'punct', '-': 'punct', '(': 'punct',
  ')': 'punct', '{': 'punct', '}': 'punct', ',': 'punct', ';': 'punct',
  ' ': 'space', '\t': 'space', '\r': 'newline', '\n': 'newline',
};

/** undefined means end of input. */
export function charClass(ch: string | undefined): CharClass {
  if (ch === undefined) return 'eof';
  if (ch >= '0' && ch <= '9') return 'digit';
  if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) return 'letter';
  return SINGLE_CHARS[ch] ?? 'other';
}
