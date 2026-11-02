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
