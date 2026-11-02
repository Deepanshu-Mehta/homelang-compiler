import { round6 } from '../numeric';

export type Dimension =
  | 'temperature'
  | 'percent'
  | 'illuminance'
  | 'duration'
  | 'colorTemp'
  | 'count';

export type UnitName = 'C' | 'F' | 'K' | '%' | 'LUX' | 'S' | 'MIN' | 'H';

export interface UnitInfo {
  unit: UnitName;
  display: string;
  dim: Dimension;
}

const C: UnitInfo = { unit: 'C', display: '°C', dim: 'temperature' };
const F: UnitInfo = { unit: 'F', display: '°F', dim: 'temperature' };
const SECOND: UnitInfo = { unit: 'S', display: 's', dim: 'duration' };
const HOUR: UnitInfo = { unit: 'H', display: 'h', dim: 'duration' };

/**
 * Unit suffixes, keyed by their upper-cased spelling.
 * The number DFA's state q4 reads the whole suffix; this table then decides
 * whether it is a unit. Anything else is L106, so `30CTHEN` and `2LIGHT` fail.
 * K means colour temperature only (see DECISIONS.md D13).
 */
export const UNIT_TABLE: Readonly<Record<string, UnitInfo>> = {
  C,
  '°C': C,
  F,
  '°F': F,
  K: { unit: 'K', display: 'K', dim: 'colorTemp' },
  '%': { unit: '%', display: '%', dim: 'percent' },
  LUX: { unit: 'LUX', display: 'lux', dim: 'illuminance' },
  S: SECOND,
  SEC: SECOND,
  MIN: { unit: 'MIN', display: 'min', dim: 'duration' },
  H: HOUR,
  HR: HOUR,
};

export const KNOWN_UNITS_TEXT = 'C, F, %, K, LUX, S, MIN, H';

/** Canonical storage units: °C, seconds, and the unit itself for the rest. */
export function toCanonical(value: number, unit: UnitName): number {
  switch (unit) {
    case 'F':
      return round6(((value - 32) * 5) / 9);
    case 'MIN':
      return round6(value * 60);
    case 'H':
      return round6(value * 3600);
    default:
      return value;
  }
}

export function canonicalDisplay(dim: Dimension): string {
  switch (dim) {
    case 'temperature':
      return '°C';
    case 'percent':
      return '%';
    case 'illuminance':
      return 'lux';
    case 'duration':
      return 's';
    case 'colorTemp':
      return 'K';
    case 'count':
      return '';
  }
}
