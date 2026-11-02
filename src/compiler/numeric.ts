/**
 * Exact-enough decimal arithmetic shared by the optimizer and the VM.
 * Rounding after every operation means a value folded at compile time equals
 * the same value computed at run time, which the differential test relies on.
 */
export function round6(x: number): number {
  const rounded = Math.round(x * 1e6) / 1e6;
  return rounded === 0 ? 0 : rounded; // normalise -0 to 0
}

export function formatNumber(x: number): string {
  return String(round6(x));
}

/** "22:00" from 1320. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
