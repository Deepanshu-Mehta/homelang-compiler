# HomeLang language reference

This document describes what the compiler does today. Sections are added as each phase is built.

## 1. Lexical structure

Source text is read one character at a time by six automata, stored as data in `src/compiler/lexer/dfa/`. The first character chooses the automaton. Each automaton runs by maximal munch: it keeps moving while it has a transition, remembers the last accepting state, and rolls back to it on a dead end.

- **Case:** keywords and names are case-insensitive. The original spelling is kept for display.
- **Whitespace:** space, tab, CR and LF separate tokens. `\r\n` is one newline and a tab is one column.
- **Comments:** `// to end of line` and `/* block */`. Block comments do not nest.
- **Keywords:** reserved words are looked up after the identifier automaton accepts. Device types, attributes and unit names are not reserved.
- **Numbers:** `30`, `24.5`, `007`. Leading zeros are allowed. The maximum is 1,000,000,000. There are no signed literals: `-5` is MINUS then NUMBER.
- **Quantities:** a number with a unit touching it. Units: `C`, `°C`, `F`, `°F`, `K` (colour temperature only), `%`, `LUX`, `S`, `SEC`, `MIN`, `H`, `HR`. The suffix must be exactly one of these, so `30CTHEN` and `2LIGHT` are errors.
- **Times:** `HH:MM`, with hours 00–23 and minutes 00–59. One-digit hours are allowed.
- **Strings:** double quotes on one line. `\"`, `\\`, `\n` and `\t` are escapes.

## 2. Syntax

The grammar below is generated from `src/compiler/parser/grammar.ts`. `npm run ll1` computes FIRST and FOLLOW from the same object and proves it has no LL(1) conflicts.

```
program   → { decl } { rule } [ simulate ] EOF
decl      → ROOM IDENT ";"
          | DEVICE IDENT ":" IDENT [ IN IDENT ] ";"
          | SENSOR IDENT ":" IDENT [ IN IDENT ] [ UNIT unitName ] ";"
unitName  → IDENT | "%"
rule      → [ RULE STRING [ PRIORITY NUMBER ] ":" ] ruleBody [ ";" ]
ruleBody  → IF cond [ FOR duration ] THEN actions [ ELSE actions ] [ END ]
          | WHEN event [ IF cond ] THEN actions [ END ]
          | AT TIME_LIT [ ON days ] THEN actions [ END ]
duration  → [ "-" ] QUANTITY
days      → DAY { "," DAY }
event     → IDENT eventTail
eventTail → DETECTED | CLEARS | OPENS | CLOSES | LOCKS | UNLOCKS | CHANGES
          | TURNS ( ON | OFF ) | RISES ABOVE value | FALLS BELOW value
actions   → action { "," action }
action    → TURN_ON IDENT | TURN_OFF IDENT | TOGGLE IDENT
          | SET IDENT IDENT TO value
          | LOCK IDENT | UNLOCK IDENT | OPEN IDENT | CLOSE IDENT
          | WAIT duration | NOTIFY STRING
          | IF cond THEN actions [ ELSE actions ] END
cond      → andCond { OR andCond }
andCond   → notCond { AND notCond }
notCond   → NOT notCond | atom
atom      → "(" cond ")" | value [ atomTail ]
atomTail  → relop value | IS [ NOT ] enumLit | BETWEEN value AND value
relop     → ">" | ">=" | "<" | "<=" | "==" | "!="
value     → term { ( "+" | "-" ) term }
term      → factor { ( "*" | "/" ) factor }
factor    → NUMBER | QUANTITY | TIME_LIT | IDENT | "-" factor | enumLit
enumLit   → state | DAY | TRUE | FALSE
state     → ON | OFF | OPEN | CLOSED | LOCKED | UNLOCKED | DETECTED | CLEAR | HOME | AWAY
simulate  → SIMULATE [ FROM TIME_LIT TO TIME_LIT ] [ STEP duration ] "{" { simStmt } "}"
simStmt   → AT TIME_LIT ":" assign { "," assign } ";"
assign    → IDENT "=" value
```

A value alone is not a condition unless it is TRUE or FALSE (P216).

**Precedence, highest first:** unary `-`; `*` `/` (left); `+` `-` (left); relational, `IS`, `BETWEEN` (non-associative); `NOT` (prefix); `AND` (left); `OR` (left). Parentheses group conditions only, never arithmetic.

**END:** optional at the end of a top-level rule, and mandatory on a nested IF. This is why there is no dangling else. A new IF after an action list starts a new rule, and a nested IF must follow THEN, ELSE or `,`.

**Errors:** the parser stops at the first syntax error by default. With "collect all errors" on, it uses panic-mode recovery: it records the error, discards tokens up to `;`, END or the start of a rule, and resumes.

## 3. Types

| Type | Values | Operations |
|---|---|---|
| Quantity | A number with a dimension: temperature, percent, illuminance, duration, colour temperature, or count (unitless) | `< <= > >= == !=` within a dimension; `+ -` within a dimension; `* /` by a count |
| Time | Minutes 0–1439 | Comparisons with times; `BETWEEN`, which wraps midnight |
| Day | MON to SUN | `==`, `!=`, `IS` |
| Enum | The state set of a device or sensor | `IS`, `IS NOT`, `==`, `!=`; no ordering |
| Boolean | TRUE, FALSE | Only as whole conditions |

**Implicit units:** a bare number takes the unit of what it meets, and W415 notes it. In a sensor declared `UNIT F`, `TEMP > 86` means 86 °F.

**Canonical units:** temperatures are stored in °C and durations in seconds. `86F` is converted at compile time (W410).

**Arithmetic limits:** °F values cannot be used in arithmetic (S310). Time arithmetic works only on literals, as in `22:00 + 30MIN` (S319). Parentheses cannot group arithmetic.

**Names:** with no declarations, the standard home is loaded: rooms LIVING_ROOM, BEDROOM, KITCHEN and ENTRANCE; devices AC, LIGHT, FAN, DOOR and CURTAIN; sensors TEMPERATURE, HUMIDITY, MOTION, CONTACT and PRESENCE. With any declaration, only declared names exist. TIME and DAY always exist.

**Enum attributes:** `SET AC MODE TO FAN` reads FAN from the attribute's own value set, so it does not mean the device FAN.

## 4. Runtime model

**Rule kinds.** `IF` rules are state rules: they run whenever something they read changes, and fire on the change. THEN runs on false→true, ELSE on true→false. `WHEN` rules fire on an event, and an optional `IF` guard is checked at that instant. `AT` rules fire on the clock.

**Initial sync.** At the start, values from the first scenario minute are applied with no events, then every state rule runs once. Rules that are true fire THEN. ELSE does not run at the initial sync.

**FOR.** The condition must stay true for the whole duration. If it drops first, the hold is cancelled and neither branch runs. When a hold expires, the scheduler re-runs the rule against current values. ELSE runs only on a true→false change of the committed state, meaning after THEN really fired.

**One round.** Triggered rules run in source order against the current values, and their commands are queued. Per target, the highest PRIORITY wins, then the later rule in source order, and each override is logged. Commands are then committed. Each device change is an event for the next round, up to depth 16, after which R501 stops the simulation.

**WAIT.** A rule in WAIT ignores new triggers and logs "busy", like Home Assistant's `single` mode. Resuming takes fresh values. A state rule re-evaluates once when it finishes, so an edge missed while busy is not lost.

**Devices.** No automatic reversion: a device stays as set. SET on BRIGHTNESS, SPEED or POSITION also switches the device, and setting 0 switches it off. SET on a setpoint is stored without switching the device on. TURN_ON restores a level left at zero.

**Time.** A time window `BETWEEN a AND b` includes `a` and excludes `b`, and wraps midnight when `b` is earlier than `a`. An equal start and end is always false. Numeric BETWEEN includes both ends and never wraps. `FROM == TO` means a full 24 hours. The default window is 00:00–23:59, the default STEP is 1MIN, and the start day is MON. A program with no SIMULATE block starts its live home at 12:00 on MON. STEP sets how far one press of Step moves; the engine always stops at every minute, WAIT end and hold end, so AT rules and FOR holds stay exact.

**Live mode.** Each slider movement is one tick. Scrubbing time forward runs everything crossed on the way, including AT rules. Scrubbing backward re-evaluates rules but fires no AT rule, because the past is not replayed.

**The log.** It records effects, not how code ran. Within one segment of a rule, each target lists its final command once.

## 5. Diagnostics

Every diagnostic has a code, a severity, a message, a hint and a position. Errors stop the pipeline at that stage; warnings and notes do not. L is lexical, P syntax, S semantic error, W semantic warning or note, R run time, I internal.

"New" marks a code that `plan.txt` does not define. `docs/DECISIONS.md` explains why each exists.

`tests/unit/diagnostics.test.ts` reads this table and compiles every example, so each row is checked against the compiler. Where a program would be very long, `«X×N»` means X repeated N times.

| Code | Severity | Meaning | Example program | Added |
|---|---|---|---|---|
| L101 | error | Illegal character | `IF TEMPERATURE > 30 THEN TURN_ON AC @` |  |
| L102 | error | Lone `!` | `IF ! TRUE THEN TURN_ON AC` |  |
| L103 | error | No digit after the decimal point | `IF TEMPERATURE > 30. THEN TURN_ON AC` |  |
| L104 | error | Two decimal points | `IF TEMPERATURE > 3.4.5 THEN TURN_ON AC` |  |
| L105 | error | Malformed time | `AT 10:3 THEN TURN_ON AC` |  |
| L106 | error | Unknown unit suffix | `IF TEMPERATURE > 30X THEN TURN_ON AC` |  |
| L107 | error | Time out of range | `AT 25:70 THEN TURN_ON AC` |  |
| L108 | error | Unterminated string | `IF MOTION IS DETECTED THEN NOTIFY "Hello` |  |
| L109 | error | Unterminated comment | `/* turn on AC` |  |
| L110 | error | Number too large | `IF TEMPERATURE > 99999999999 THEN TURN_ON AC` |  |
| P201 | error | THEN is missing | `IF TEMPERATURE > 30 TURN_ON AC` |  |
| P202 | error | No action after THEN, ELSE or a comma | `IF TEMPERATURE > 30 THEN` |  |
| P203 | error | Unclosed parenthesis | `IF (TEMPERATURE > 30 THEN TURN_ON AC` |  |
| P204 | error | No condition where one is needed | `IF TEMPERATURE > 30 AND THEN TURN_ON AC` |  |
| P205 | error | No value where one is needed | `IF TEMPERATURE > > 30 THEN TURN_ON AC` |  |
| P206 | error | ELSE with no matching IF | `ELSE TURN_OFF AC` |  |
| P207 | error | Second ELSE in one rule | `IF TRUE THEN TURN_ON AC ELSE TURN_OFF AC ELSE TOGGLE AC` |  |
| P208 | error | Unknown action | `IF TEMPERATURE > 30 THEN TURN ON AC` |  |
| P209 | error | Chained comparison | `IF 20 < TEMPERATURE < 30 THEN TURN_ON FAN` |  |
| P210 | error | Empty parentheses | `IF () THEN TURN_ON AC` |  |
| P211 | error | Declaration missing its semicolon | `DEVICE AC : AIR_CONDITIONER IN BEDROOM` |  |
| P212 | error | Space between a number and its unit | `IF TEMPERATURE > 30 C THEN TURN_ON AC` |  |
| P213 | error | Nested IF with no END | `IF TRUE THEN IF FALSE THEN TURN_ON AC` |  |
| P214 | error | Reserved word used as a name | `DEVICE IF : LIGHT;` | new |
| P215 | error | Any other syntax error: expected one thing, found another | `TURN_ON AC` | new |
| P216 | error | A bare value used as a condition | `IF MOTION THEN TURN_ON AC` | new |
| P217 | error | Declaration after the first rule | `IF TRUE THEN TURN_ON AC ROOM A;` | new |
| P218 | error | Nesting too deep, or a chain too long | `IF «(×500»` | new |
| S301 | error | Undeclared name | `IF TEMPERATURE > 30 THEN TURN_ON HEATPUMP` |  |
| S302 | error | Duplicate declaration | `ROOM A; DEVICE L : LIGHT IN A; DEVICE l : FAN IN A;` |  |
| S303 | error | Unknown device or sensor type | `DEVICE X : TOASTER;` |  |
| S304 | error | Unknown room | `ROOM A; DEVICE L : LIGHT IN GARAGE;` |  |
| S305 | error | Action on a read-only sensor | `IF TEMPERATURE > 30 THEN TURN_ON TEMPERATURE` |  |
| S306 | error | Action the device type does not support | `IF TRUE THEN LOCK LIGHT` |  |
| S307 | error | Attribute the device type does not have | `IF MOTION IS DETECTED THEN SET DOOR BRIGHTNESS TO 50%` |  |
| S308 | error | Comparison type mismatch | `IF TEMPERATURE > ON THEN TURN_ON AC` |  |
| S309 | error | State not valid for this device | `IF DOOR IS ON THEN TURN_ON LIGHT` |  |
| S310 | error | Unit or dimension mismatch | `IF TEMPERATURE > 50% THEN TURN_ON FAN` |  |
| S311 | error | Value out of range | `IF TEMPERATURE > 30 THEN SET AC TEMPERATURE TO 35C` |  |
| S312 | error | Duration not above zero | `WHEN MOTION DETECTED THEN TURN_ON LIGHT, WAIT 0MIN, TURN_OFF LIGHT` |  |
| S313 | error | Contradictory actions in one branch | `IF TEMPERATURE > 30 THEN TURN_ON AC, TURN_OFF AC` |  |
| S314 | error | Event the source does not have | `WHEN TEMPERATURE DETECTED THEN TURN_ON AC` |  |
| S315 | error | Comparing two devices, or sensors of different dimensions | `IF AC > FAN THEN TURN_ON LIGHT` |  |
| S316 | error | Ordering on states | `IF DOOR > LOCKED THEN TURN_ON AC` |  |
| S317 | error | Infinite loop with no guard, or a rule whose THEN and ELSE each undo its own state test (`IF LIGHT IS OFF THEN TURN_ON LIGHT ELSE TURN_OFF LIGHT`) | `WHEN LIGHT TURNS ON THEN TURN_OFF LIGHT; WHEN LIGHT TURNS OFF THEN TURN_ON LIGHT;` |  |
| S318 | error | IS after something that is not a name | `IF TEMPERATURE + 2 IS ON THEN TURN_ON AC` |  |
| S319 | error | TIME with a non-time, or bad time arithmetic | `IF TIME > 30C THEN TURN_ON AC` |  |
| S320 | error | PRIORITY is not a whole number of 1 or more | `RULE "A" PRIORITY 0: IF TRUE THEN TURN_ON AC` | new |
| S321 | error | UNIT is unknown, or does not fit the sensor | `SENSOR H : HUMIDITY_SENSOR UNIT C;` | new |
| S322 | error | Scenario time outside FROM … TO | `SIMULATE FROM 08:00 TO 09:00 { AT 10:00: TEMPERATURE = 3C; }` | new |
| S323 | error | Scenario assigns something other than a sensor or DAY | `SIMULATE { AT 08:00: AC = ON; }` | new |
| S324 | error | Literal division by zero, or a constant too large | `IF TEMPERATURE > 5 / 0 THEN TURN_ON AC` | new |
| S325 | error | Threshold or scenario value is not constant | `WHEN TEMPERATURE RISES ABOVE HUMIDITY THEN TURN_ON AC` | new |
| W401 | warning | Condition can never be true | `IF TEMPERATURE > 30 AND TEMPERATURE < 20 THEN TURN_ON AC` |  |
| W402 | warning | Condition is always true | `IF TEMPERATURE > 20 OR TEMPERATURE <= 20 THEN TURN_ON AC` |  |
| W403 | warning | Physically implausible value | `IF TEMPERATURE > 200C THEN NOTIFY "Fire?"` |  |
| W404 | warning | Two rules can fight over one device | `IF TEMPERATURE > 28 THEN TURN_ON AC END; IF TIME BETWEEN 22:00 AND 06:00 THEN TURN_OFF AC END;` |  |
| W405 | warning | Duplicate rule | `IF TEMPERATURE > 1 THEN TURN_ON AC END; IF TEMPERATURE > 1 THEN TURN_ON AC END;` |  |
| W406 | warning | Nothing ever reverses this action | `IF TEMPERATURE > 30 THEN TURN_ON AC` |  |
| W407 | warning | Loop with a guard | `WHEN LIGHT TURNS ON IF TEMPERATURE > 0 THEN TURN_OFF LIGHT; WHEN LIGHT TURNS OFF IF TEMPERATURE > 0 THEN TURN_ON LIGHT;` |  |
| W408 | warning | Declared but unused | `ROOM A; DEVICE F : FAN IN A;` |  |
| W409 | warning | Empty time window, or numeric range with its limits reversed | `IF TEMPERATURE BETWEEN 30 AND 20 THEN TURN_ON AC` |  |
| W410 | info | °F value converted to °C | `IF TEMPERATURE > 86F THEN TURN_ON AC` |  |
| W411 | warning | Heater and AC act around one threshold | `ROOM A; DEVICE H : HEATER IN A; DEVICE C : AIR_CONDITIONER IN A; SENSOR T : TEMP_SENSOR IN A; IF T < 20 THEN TURN_ON H ELSE TURN_OFF H END; IF T > 20 THEN TURN_ON C ELSE TURN_OFF C END;` |  |
| W412 | warning | UNLOCK with no presence check | `AT 07:00 THEN UNLOCK DOOR` |  |
| W413 | warning | Flapping risk: numeric sensor, ELSE, no FOR | `IF TEMPERATURE > 30 THEN TURN_ON AC ELSE TURN_OFF AC` |  |
| W414 | info | Setpoint on a device that may be off | `IF TRUE THEN SET AC TEMPERATURE TO 24C` |  |
| W415 | info | A bare number took on a unit | `IF TEMPERATURE > 30 THEN TURN_ON AC` | new |
| W416 | info | Condition too large for interval analysis | `IF «(TEMPERATURE > 1 OR HUMIDITY > 1) AND ×7»TRUE THEN NOTIFY "x"` | new |
| R501 | error | Cascade passed depth 16 | `WHEN MOTION DETECTED THEN TURN_ON LIGHT; WHEN LIGHT TURNS ON IF TEMPERATURE > 0 THEN TURN_OFF LIGHT; WHEN LIGHT TURNS OFF IF TEMPERATURE > 0 THEN TURN_ON LIGHT; SIMULATE { AT 08:00: MOTION = DETECTED; }` |  |
| R502 | error | A computed value stopped being finite | `WHEN MOTION DETECTED IF TEMPERATURE «* 1000000000 ×40»> 0 THEN NOTIFY "x" SIMULATE { AT 08:00: MOTION = DETECTED; }` | new |
| R503 | warning | Computed SET value clamped to its range | `WHEN MOTION DETECTED THEN SET AC TEMPERATURE TO TEMPERATURE + 50 SIMULATE { AT 08:00: MOTION = DETECTED; }` | new |
| R504 | warning | A device is switching back and forth quickly | `IF TEMPERATURE > 30 THEN TURN_ON FAN ELSE TURN_OFF FAN END; SIMULATE { AT 08:00: TEMPERATURE = 31C; AT 08:01: TEMPERATURE = 29C; AT 08:02: TEMPERATURE = 31C; AT 08:03: TEMPERATURE = 29C; }` | new |
| I001 | error | Internal compiler error, caught and reported instead of thrown | None: it means the compiler itself has a bug. | new |
