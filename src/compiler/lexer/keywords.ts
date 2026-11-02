export const CORE_KEYWORDS = [
  'IF', 'THEN', 'ELSE', 'END', 'WHEN', 'AT', 'FOR', 'RULE', 'PRIORITY', 'ROOM',
  'DEVICE', 'SENSOR', 'IN', 'UNIT', 'SIMULATE', 'FROM', 'TO', 'STEP', 'AND',
  'OR', 'NOT', 'IS', 'BETWEEN',
] as const;

export const ACTION_KEYWORDS = [
  'TURN_ON', 'TURN_OFF', 'TOGGLE', 'SET', 'LOCK', 'UNLOCK', 'OPEN', 'CLOSE',
  'WAIT', 'NOTIFY',
] as const;

/** CLEARS is here because eventTail needs it; plan.txt's token table omits it. */
export const STATE_EVENT_WORDS = [
  'ON', 'OFF', 'CLOSED', 'LOCKED', 'UNLOCKED', 'DETECTED', 'CLEAR', 'HOME',
  'AWAY', 'TRUE', 'FALSE', 'OPENS', 'CLOSES', 'TURNS', 'RISES', 'FALLS',
  'ABOVE', 'BELOW', 'CHANGES', 'LOCKS', 'UNLOCKS', 'CLEARS',
] as const;

export const DAY_WORDS = [
  'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'WEEKDAYS', 'WEEKENDS',
] as const;

export type KeywordType =
  | (typeof CORE_KEYWORDS)[number]
  | (typeof ACTION_KEYWORDS)[number]
  | (typeof STATE_EVENT_WORDS)[number];

export type WordCategory = 'keyword' | 'action' | 'state' | 'day';

interface WordEntry {
  /** Token type. Each keyword is its own type; all day names share DAY. */
  type: KeywordType | 'DAY';
  category: WordCategory;
}

/**
 * The keyword table. The identifier DFA recognises any word and the lexer then
 * looks it up here: the Dragon Book's "install reserved words in the symbol
 * table" technique. Device types, attributes and unit names are deliberately
 * absent, so they stay IDENT and the semantic phase resolves them in context.
 */
export const KEYWORD_TABLE: ReadonlyMap<string, WordEntry> = new Map<string, WordEntry>([
  ...CORE_KEYWORDS.map((w) => [w, { type: w, category: 'keyword' }] as [string, WordEntry]),
  ...ACTION_KEYWORDS.map((w) => [w, { type: w, category: 'action' }] as [string, WordEntry]),
  ...STATE_EVENT_WORDS.map((w) => [w, { type: w, category: 'state' }] as [string, WordEntry]),
  ...DAY_WORDS.map((w) => [w, { type: 'DAY', category: 'day' }] as [string, WordEntry]),
]);
