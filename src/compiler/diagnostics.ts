export type Severity = 'error' | 'warning' | 'info';

/** line/col are 1-based; start/end are character offsets, end exclusive. */
export interface Span {
  line: number;
  col: number;
  start: number;
  end: number;
}

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  hint: string;
  span: Span;
}

interface CodeInfo {
  severity: Severity;
  /** Shown when a check has no more specific advice. */
  hint: string;
}

const error = (hint: string): CodeInfo => ({ severity: 'error', hint });
const warning = (hint: string): CodeInfo => ({ severity: 'warning', hint });
const info = (hint: string): CodeInfo => ({ severity: 'info', hint });

/**
 * Every diagnostic the compiler can produce. Prefixes: L lexer, P parser,
 * S semantic error, W semantic warning or info, R runtime, I internal.
 * The registry guarantees that each diagnostic has a severity and a hint.
 */
export const DIAGNOSTIC_CODES = {
  L101: error('Remove this character. HomeLang source uses plain ASCII, plus ° after a number.'),
  L102: error('Use != for "not equal" or the word NOT to negate a condition.'),
  L103: error('Put a digit after the decimal point, or remove the point.'),
  L104: error('A number can contain only one decimal point.'),
  L105: error('Write times as HH:MM, for example 07:30.'),
  L106: error('Known units: C, F, %, K, LUX, S, SEC, MIN, H, HR. A unit cannot run into the next word.'),
  L107: error('Hours must be 00–23 and minutes 00–59.'),
  L108: error('Close the string with " on the same line.'),
  L109: error('Close the comment with */. Block comments do not nest.'),
  L110: error('Use a number no larger than 1,000,000,000.'),

  P201: error('Every IF needs THEN between its condition and its actions.'),
  P202: error('Add at least one action, such as TURN_ON AC.'),
  P203: error('Add the missing ) or remove the (.'),
  P204: error('AND, OR and NOT must be followed by a condition.'),
  P205: error('Put a value such as 30 or TEMPERATURE after the operator.'),
  P206: error('ELSE belongs to an IF rule. WHEN and AT rules have no ELSE.'),
  P207: error('Remove the second ELSE, or nest another IF with its own END.'),
  P208: error('Action names are one word with an underscore, such as TURN_ON.'),
  P209: error('Join the two comparisons with AND.'),
  P210: error('Put a condition inside the parentheses, or remove them.'),
  P211: error('Each declaration ends with a semicolon.'),
  P212: error('Remove the space between the number and its unit.'),
  P213: error('Close the nested IF with END.'),
  P214: error('Choose a name that is not a reserved word.'),
  P215: error('Check the grammar card for what may appear here.'),
  P216: error('Use a comparison or IS <state>, such as MOTION IS DETECTED.'),
  P217: error('Move every ROOM, DEVICE and SENSOR declaration above the first rule.'),
  P218: error('Simplify the expression; it is nested too deeply.'),

  S301: error('Check the spelling, or declare the name first.'),
  S302: error('Each name can be declared once. Names are case-insensitive.'),
  S303: error('Use a type from the device catalogue.'),
  S304: error('Declare the room with ROOM before using it.'),
  S305: error('Sensors are read-only. Act on a device instead.'),
  S306: error('Use an action from the supported list.'),
  S307: error('Use an attribute this device type has.'),
  S308: error('Compare values of the same kind.'),
  S309: error('Use one of the valid states.'),
  S310: error('Use a value with a matching unit.'),
  S311: error('Use a value inside the allowed range.'),
  S312: error('Use a duration greater than zero.'),
  S313: error('Keep one of the two actions, or put a WAIT between them.'),
  S314: error('Use an event this source supports.'),
  S315: error('Compare a sensor with a value of the same kind.'),
  S316: error('Use IS, == or != with states.'),
  S317: error('Add a guarding condition to one of the rules, or remove the loop.'),
  S318: error('Put a device or sensor name directly before IS.'),
  S319: error('Compare TIME with HH:MM values. Time arithmetic must use constants only.'),
  S320: error('PRIORITY must be a whole number of 1 or more.'),
  S321: error('Use a unit that fits this sensor type.'),
  S322: error('Keep scenario times inside the FROM … TO window.'),
  S323: error('SIMULATE can assign only sensors and DAY.'),
  S324: error('Change the expression so that it has a finite value.'),
  S325: error('Use a constant threshold such as 30C.'),

  W401: warning('Check the condition; one part rules out another.'),
  W402: warning('Remove the condition, or check that it says what you meant.'),
  W403: warning('Check the value; it is outside what this sensor can report.'),
  W404: warning('Give one rule a higher PRIORITY, or make the conditions exclusive.'),
  W405: warning('Remove the duplicate rule.'),
  W406: warning('Add an ELSE, or another rule that reverses this action.'),
  W407: warning('Check that the loop terminates. The runtime stops at depth 16.'),
  W408: warning('Remove the declaration or use it in a rule.'),
  W409: warning('Use a range whose start is below its end.'),
  W410: info('Temperatures are stored in °C.'),
  W411: warning('Leave a gap between the thresholds, or add FOR.'),
  W412: warning('Guard the rule with a presence check.'),
  W413: warning('Add FOR 2MIN or use separate on and off thresholds.'),
  W414: info('Add TURN_ON if the device should also start.'),
  W415: info('Write the unit explicitly to silence this note.'),
  W416: info('Split the condition into smaller rules to enable the analysis.'),

  R501: error('Add a guard that breaks the cycle between the rules.'),
  R502: error('Reduce the arithmetic; a computed value stopped being a finite number.'),
  R503: warning('Keep the computed value inside the attribute range.'),
  R504: warning('Add FOR or a dead-band so the device stops switching rapidly.'),

  I001: error('This is a compiler bug, not a problem with your program.'),
} satisfies Record<string, CodeInfo>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_CODES;

export function makeDiagnostic(
  code: DiagnosticCode,
  span: Span,
  message: string,
  hint?: string,
): Diagnostic {
  const entry = DIAGNOSTIC_CODES[code];
  return { code, severity: entry.severity, message, hint: hint ?? entry.hint, span };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
