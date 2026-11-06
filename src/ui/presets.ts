const files = import.meta.glob('../../examples/*.home', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

function load(name: string): string {
  return files[`../../examples/${name}.home`] ?? '';
}

export interface Preset {
  id: string;
  label: string;
  group: 'Valid programs' | 'Deliberate errors';
  source: string;
}

function preset(id: string, label: string, group: Preset['group']): Preset {
  return { id, label, group, source: load(id) };
}

export const PRESETS: readonly Preset[] = [
  preset('brief', "The brief's one-liner", 'Valid programs'),
  preset('living-room', 'Living-room comfort', 'Valid programs'),
  preset('night-security', 'Night security', 'Valid programs'),
  preset('advanced', 'Advanced: comfort + security', 'Valid programs'),
  preset('conflict', 'Conflict demo (W404)', 'Valid programs'),
  preset('hysteresis', 'Hysteresis demo (FOR)', 'Valid programs'),
  preset('cascade', 'Cascade loop demo (W407 → R501)', 'Valid programs'),
  preset('optimizer', 'Optimizer demo (all nine passes)', 'Valid programs'),
  preset('error-L107-bad-time', 'L107 bad time', 'Deliberate errors'),
  preset('error-L108-unterminated-string', 'L108 unterminated string', 'Deliberate errors'),
  preset('error-P201-missing-then', 'P201 missing THEN', 'Deliberate errors'),
  preset('error-P203-unbalanced-paren', 'P203 unbalanced (', 'Deliberate errors'),
  preset('error-P208-turn-on', 'P208 TURN ON', 'Deliberate errors'),
  preset('error-S301-unknown-device', 'S301 unknown device', 'Deliberate errors'),
  preset('error-S305-action-on-sensor', 'S305 action on sensor', 'Deliberate errors'),
  preset('error-S308-type-mismatch', 'S308 type mismatch', 'Deliberate errors'),
  preset('error-S309-bad-state', 'S309 bad state', 'Deliberate errors'),
  preset('error-S311-out-of-range', 'S311 out of range', 'Deliberate errors'),
  preset('error-S313-contradictory-actions', 'S313 contradictory actions', 'Deliberate errors'),
  preset('error-S317-infinite-loop', 'S317 infinite loop', 'Deliberate errors'),
  preset('warning-W401-contradiction', 'W401 contradiction', 'Deliberate errors'),
];
