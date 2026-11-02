export type Stage = 'lexer' | 'parser' | 'semantic';

export interface ErrorCase {
  source: string;
  stage: Stage;
  code: string;
  line: number;
  col: number;
  messageIncludes: string;
}

/**
 * Builds a row. `at` is the text the diagnostic should point at; line and column
 * are computed from the real source, never copied from the plan.
 */
function row(source: string, stage: Stage, code: string, at: string | number, messageIncludes: string): ErrorCase {
  const offset = typeof at === 'number' ? at : source.indexOf(at);
  if (offset < 0) throw new Error(`'${String(at)}' is not in ${source}`);
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  const col = offset - (before.lastIndexOf('\n') + 1) + 1;
  return { source, stage, code, line, col, messageIncludes };
}

/** All 27 programs of plan.txt §14.3. */
export const INVALID_PROGRAMS: readonly ErrorCase[] = [
  row('IF TEMPERATURE > 30 THEN TURN_ON AC @', 'lexer', 'L101', '@', "Illegal character '@' at line 1, column 37."),
  row('IF MOTION IS DETECTED THEN NOTIFY "Hello', 'lexer', 'L108', '"Hello', 'Unterminated string starting at line 1, column 35.'),
  row('/* turn on AC', 'lexer', 'L109', 0, 'Unterminated comment starting at line 1, column 1.'),
  row('IF TEMPERATURE > 3.4.5 THEN TURN_ON AC', 'lexer', 'L104', '3.4.5', "Malformed number '3.4.5': only one decimal point is allowed."),
  row('AT 25:70 THEN TURN_ON LIGHT', 'lexer', 'L107', '25:70', "Invalid time '25:70': hours must be 00–23 and minutes 00–59."),
  row('IF TEMPERATURE > 30 TURN_ON AC', 'parser', 'P201', 'TURN_ON', 'Expected THEN after the condition; found TURN_ON at line 1, column 21.'),
  row('IF TEMPERATURE > 30 THEN', 'parser', 'P202', 24, 'Expected an action after THEN; found end of input.'),
  row('IF (TEMPERATURE > 30 THEN TURN_ON AC', 'parser', 'P203', '(', 'Missing ). The ( at line 1, column 4 was never closed.'),
  row('IF TEMPERATURE > 30 AND THEN TURN_ON AC', 'parser', 'P204', 'THEN', 'Expected a condition after AND; found THEN.'),
  row('IF TEMPERATURE > > 30 THEN TURN_ON AC', 'parser', 'P205', 17, "Expected a value after '>'; found '>'."),
  row('ELSE TURN_OFF AC', 'parser', 'P206', 'ELSE', 'ELSE without a matching IF.'),
  row('IF TEMPERATURE > 30 THEN TURN ON AC', 'parser', 'P208', 'TURN', "Unknown action 'TURN'. Did you mean TURN_ON?"),
  row('IF 20 < TEMPERATURE < 30 THEN TURN_ON FAN', 'parser', 'P209', 20, 'Comparisons cannot be chained; write 20 < TEMPERATURE AND TEMPERATURE < 30.'),
  row('IF TEMPERATURE > 30 THEN TURN_ON HEATPUMP', 'semantic', 'S301', 'HEATPUMP', "Unknown device 'HEATPUMP'. Declared devices: AC, LIGHT, FAN, DOOR, CURTAIN."),
  row('IF TEMPERATURE > 30 THEN TURN_ON TEMPERATURE', 'semantic', 'S305', 33, "'TEMPERATURE' is a sensor; sensors are read-only and cannot be turned on."),
  row('IF TEMPERATURE > ON THEN TURN_ON AC', 'semantic', 'S308', 'TEMPERATURE', 'Type mismatch: TEMPERATURE is a temperature (°C) but ON is a power state.'),
  row('IF DOOR IS ON THEN TURN_ON LIGHT', 'semantic', 'S309', 'ON THEN', 'ON is not a valid state for DOOR (DOOR_LOCK). Valid: LOCKED, UNLOCKED.'),
  row('IF TEMPERATURE > 30 THEN SET AC TEMPERATURE TO 35C', 'semantic', 'S311', '35C', 'Out of range: AC TEMPERATURE must be 16–30 °C; got 35 °C.'),
  row('IF MOTION IS DETECTED THEN SET DOOR BRIGHTNESS TO 50%', 'semantic', 'S307', 'BRIGHTNESS', 'DOOR_LOCK has no attribute BRIGHTNESS; use LOCK or UNLOCK.'),
  row('IF TEMPERATURE > 50% THEN TURN_ON FAN', 'semantic', 'S310', 'TEMPERATURE', 'Cannot compare a temperature (°C) with a percentage.'),
  row('ROOM BEDROOM; DEVICE AC : AIR_CONDITIONER IN BEDROOM; DEVICE ac : FAN IN BEDROOM;', 'semantic', 'S302', 'ac', "'ac' is already declared at line 1, column 22 (names are case-insensitive)."),
  row('ROOM BEDROOM; DEVICE AC : AIR_CONDITIONER IN GARAGE;', 'semantic', 'S304', 'GARAGE', "Room 'GARAGE' is not declared."),
  row('IF TEMPERATURE > 30 THEN TURN_ON AC, TURN_OFF AC', 'semantic', 'S313', 'TURN_OFF', 'Contradictory actions on AC in the same branch'),
  row('WHEN MOTION DETECTED THEN TURN_ON LIGHT, WAIT 0MIN, TURN_OFF LIGHT', 'semantic', 'S312', '0MIN', 'WAIT duration must be greater than zero.'),
  row('WHEN LIGHT TURNS ON THEN TURN_OFF LIGHT; WHEN LIGHT TURNS OFF THEN TURN_ON LIGHT;', 'semantic', 'S317', 0, 'Infinite loop: R1 → R2 → R1 with no guarding condition.'),
  row('IF TEMPERATURE > 30 AND TEMPERATURE < 20 THEN TURN_ON AC', 'semantic', 'W401', 0, 'This condition can never be true; rule R1 will never fire.'),
  row('IF TEMPERATURE > 200C THEN NOTIFY "Fire?"', 'semantic', 'W403', '200C', '200 °C is outside the plausible range for TEMP_SENSOR (−40…60 °C).'),
];

/** The lexical, syntactic and semantic error rows of plan.txt §10. */
export const EDGE_CASE_ERRORS: readonly ErrorCase[] = [
  row('°', 'lexer', 'L101', 0, "Illegal character '°'"),
  row('2LIGHT', 'lexer', 'L106', 0, "Unknown unit 'LIGHT' in '2LIGHT'."),
  row('DEVICE IF : LIGHT;', 'parser', 'P214', 'IF', 'Expected a name; found keyword IF.'),
  row('IF TEMPERATURE > 30. THEN TURN_ON AC', 'lexer', 'L103', '30.', "Digit expected after '.' in '30.'; write 30 or 30.0."),
  row('IF TEMPERATURE > .5 THEN TURN_ON AC', 'lexer', 'L101', '.5', "Illegal character '.'"),
  row('IF TEMPERATURE > 3.4.5 THEN TURN_ON AC', 'lexer', 'L104', '3.4.5', 'only one decimal point'),
  row('IF TEMPERATURE > 30 C THEN TURN_ON AC', 'parser', 'P212', 'C THEN', 'A unit must touch its number: write 30C, not 30 C.'),
  row('IF TEMPERATURE > 30 THEN TURN ON AC', 'parser', 'P208', 'TURN', 'Did you mean TURN_ON?'),
  row('AT 24:00 THEN TURN_ON AC', 'lexer', 'L107', '24:00', "Invalid time '24:00'"),
  row('AT 25:70 THEN TURN_ON AC', 'lexer', 'L107', '25:70', "Invalid time '25:70'"),
  row('AT 12:5 THEN TURN_ON AC', 'lexer', 'L105', '12:5', "Malformed time '12:5': use HH:MM."),
  row('NOTIFY “on”', 'lexer', 'L101', '“', "Illegal character '“'"),
  row('IF TEMPERATURE > 99999999999999999 THEN TURN_ON AC', 'lexer', 'L110', '99999999999999999', 'Number too large (max 1,000,000,000).'),
  row('IF TEMPERATURE > 30 TURN_ON AC', 'parser', 'P201', 'TURN_ON', 'Expected THEN'),
  row('IF TEMPERATURE > 30 THEN', 'parser', 'P202', 24, 'Expected an action after THEN'),
  row('IF TRUE THEN IF FALSE THEN TURN_ON AC', 'parser', 'P213', 37, 'Nested IF at line 1, column 14 needs END'),
  row('IF () THEN TURN_ON AC', 'parser', 'P210', '(', 'Empty parentheses: expected a condition inside ( ).'),
  row('IF TEMPERATURE > 30 AND THEN TURN_ON AC', 'parser', 'P204', 'THEN', 'Expected a condition after AND'),
  row('IF TEMPERATURE > > 30 THEN TURN_ON AC', 'parser', 'P205', 17, "Expected a value after '>'"),
  row('IF > 30 THEN TURN_ON AC', 'parser', 'P205', '>', "Expected a value before '>'."),
  row('ELSE TURN_OFF AC', 'parser', 'P206', 'ELSE', 'ELSE without a matching IF.'),
  row('IF TRUE THEN TURN_ON AC ELSE TURN_OFF AC ELSE TURN_ON AC', 'parser', 'P207', 41, 'A rule can have only one ELSE; the first ELSE is at line 1, column 25.'),
  row('ROOM A; DEVICE L : LIGHT; DEVICE l : FAN;', 'semantic', 'S302', 'l :', "'l' is already declared"),
  row('ROOM A; DEVICE L : LIGHT IN GARAGE;', 'semantic', 'S304', 'GARAGE', "Room 'GARAGE' is not declared."),
  row('ROOM A; ROOM B; DEVICE L : LIGHT IN A; DEVICE L : LIGHT IN B;', 'semantic', 'S302', 'L : LIGHT IN B', "'L' is already declared"),
  row('IF TRUE THEN TURN_ON MOTION', 'semantic', 'S305', 'MOTION', "'MOTION' is a sensor"),
  row('IF TEMPERATURE > HUMIDITY THEN TURN_ON AC', 'semantic', 'S315', 'TEMPERATURE', 'Cannot compare TEMPERATURE with HUMIDITY'),
  row('IF AC > FAN THEN TURN_ON LIGHT', 'semantic', 'S315', 'AC', 'Cannot compare AC with FAN'),
  row('IF TIME BETWEEN 22:00 AND 22:00 THEN TURN_ON AC', 'semantic', 'W409', 'TIME', 'Empty time window: start equals end'),
  row('IF TRUE THEN SET AC TEMPERATURE TO 24C', 'semantic', 'W414', 'SET', 'AC setpoint is stored; AC stays OFF until it is turned on.'),
  row('IF TEMPERATURE > 30 AND TEMPERATURE < 20 THEN TURN_ON AC', 'semantic', 'W401', 0, 'can never be true'),
  row('IF TEMPERATURE > 200C THEN TURN_ON AC', 'semantic', 'W403', '200C', 'plausible range'),
  row('ROOM A; DEVICE L : LIGHT IN A; DEVICE F : FAN IN A; IF TRUE THEN TURN_ON L, WAIT 1MIN, TURN_OFF L', 'semantic', 'W408', 'F :', 'F is declared but never used.'),
];

/** Sources from plan.txt §10 that must compile with no errors. */
export const VALID_EDGE_CASES: readonly { name: string; source: string; tokens?: number; rules?: number }[] = [
  { name: 'empty program', source: '', tokens: 0, rules: 0 },
  { name: 'only comments', source: '// one\n/* two */\n', tokens: 0, rules: 0 },
  { name: '30°C and 30°c', source: 'IF TEMPERATURE > 30°C OR TEMPERATURE < 30°c THEN TURN_ON AC', rules: 1 },
  { name: 'tabs and CRLF', source: 'IF\tTEMPERATURE > 30\r\nTHEN TURN_ON AC\r\n', rules: 1 },
  { name: 'lower case', source: 'if temperature > 30 then turn_on ac', tokens: 7, rules: 1 },
  { name: 'identifiers with _ and digits', source: 'ROOM _X; DEVICE LIGHT_2 : LIGHT IN _X; IF TRUE THEN TURN_ON LIGHT_2, WAIT 1MIN, TURN_OFF LIGHT_2', rules: 1 },
  { name: 'negative quantity', source: 'IF TEMPERATURE > -5C THEN TURN_ON AC', rules: 1 },
  { name: 'leading zeros and short hours', source: 'IF TEMPERATURE > 007 AND TIME > 7:00 AND TIME < 07:30 THEN TURN_ON AC', rules: 1 },
  { name: 'nested IF with END', source: 'IF TRUE THEN IF TEMPERATURE > 3 THEN TURN_ON AC END END', rules: 1 },
  { name: 'a new IF starts a new rule', source: 'IF TEMPERATURE > 30 THEN TURN_ON AC IF TEMPERATURE < 20 THEN TURN_OFF AC', rules: 2 },
  { name: 'window across midnight', source: 'IF TIME BETWEEN 22:00 AND 06:00 THEN TURN_ON AC ELSE TURN_OFF AC', rules: 1 },
  { name: 'SET on a device that may be off', source: 'IF TRUE THEN SET AC TEMPERATURE TO 24C', rules: 1 },
];
