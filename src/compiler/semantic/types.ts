import { canonicalDisplay, type Dimension } from '../lexer/units';
import type { ValueType } from '../parser/ast';

export const quantity = (dim: Dimension): ValueType => ({ kind: 'quantity', dim });

const DIMENSION_NOUN: Readonly<Record<Dimension, string>> = {
  temperature: 'a temperature (°C)',
  percent: 'a percentage',
  illuminance: 'an illuminance (lux)',
  duration: 'a duration',
  colorTemp: 'a colour temperature (K)',
  count: 'a plain number',
};

export function dimensionNoun(dim: Dimension): string {
  return DIMENSION_NOUN[dim];
}

/** Short tag for the annotated AST, e.g. "temperature °C". */
export function typeTag(type: ValueType): string {
  switch (type.kind) {
    case 'quantity': {
      const unit = canonicalDisplay(type.dim);
      return unit ? `${type.dim} ${unit}` : 'count';
    }
    case 'time':
      return 'time';
    case 'day':
      return 'day';
    case 'enum':
      return `enum {${type.states.join(', ')}}`;
    case 'boolean':
      return 'boolean';
  }
}

const STATE_FAMILY: Readonly<Record<string, string>> = {
  ON: 'a power state', OFF: 'a power state',
  LOCKED: 'a lock state', UNLOCKED: 'a lock state',
  OPEN: 'an open/closed state', CLOSED: 'an open/closed state',
  DETECTED: 'a motion state', CLEAR: 'a motion state',
  HOME: 'a presence state', AWAY: 'a presence state',
};

export function stateNoun(state: string): string {
  return STATE_FAMILY[state] ?? 'a state';
}
