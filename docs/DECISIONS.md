# Design decisions

`plan.txt` is the original design. Where this file differs from it, this file and the code win. The authoritative grammar is `src/compiler/parser/grammar.ts`.

## Fixes requested in Step 0

| ID | Problem | Decision |
|---|---|---|
| D1 | `factor` could not parse state words or days, so `TEMPERATURE > ON` failed in the parser instead of reaching S308. | New `enumLit → state \| DAY \| TRUE \| FALSE`, added to `factor`. `atom` becomes `"(" cond ")" \| value [ atomTail ]`, because keeping TRUE/FALSE in both `atom` and `factor` would clash on FIRST. A bare value is valid only if it is TRUE or FALSE; anything else is P216. |
| D2 | `UNIT %` did not fit `UNIT IDENT`, and `%` had no token. | Added a PERCENT token, produced for any bare `%`. `unitName → IDENT \| PERCENT`. `5 %` then reaches the P212 hint without a special case. |
| D3 | q4 accepted a unit prefix, so `30CTHEN` could split wrongly. | q4 consumes every identifier character plus `%` and `°`, and the entire suffix is looked up in the unit table. Anything not in the table is L106. This covers `30CTHEN`, `2LIGHT`, `30°`, `30°X`, `30C2` and `50%%`. |
| D4 | FOR + ELSE timing was unspecified. | ELSE runs only on a true→false change of the *committed* state, meaning after THEN actually fired. If the condition drops during a hold, the timer is cancelled and neither branch runs. When the hold expires, the scheduler re-runs the rule against a fresh snapshot. |
| D5 | Example numbers in `plan.txt` are illustrative. | Tests compute positions and counts from real source. The brief is 35 characters (36 only with a trailing newline). IR is numbered densely from 100, in one sequence across rules, and renumbered after every pass. "X characters became Y tokens" excludes EOF. |

## Grammar and LL(1) (Step 0 item 6)

| ID | Problem | Decision |
|---|---|---|
| D6 | With enums in `factor`, `SET … TO (value \| state)` and `assign → IDENT "=" (value \| state)` are FIRST conflicts. | Both become plain `value`. The semantic phase checks what the value means. |
| D7 | `IS [NOT] state` rejected `DAY IS MON` in the parser. | `IS [NOT] enumLit`. S309 handles invalid words in one place. |
| D8 | `CLEARS` is used in `eventTail` but missing from the token table. | Added to the state and event words. |
| D9 | `FOR -2MIN`, the S312 example, could not parse under `FOR QUANTITY`. | New `duration → [ "-" ] QUANTITY`, used by FOR, WAIT and STEP. |
| D10 | Contextual keywords ON, OPEN, CLOSE and TO looked ambiguous. | They stay reserved and position decides. `OPEN` is an action only after THEN, ELSE or `,`, and a value only in a condition or after TO. These positions never overlap, because actions are comma-separated. `CURTAIN IS CLOSE` gets a "did you mean CLOSED?" hint. |
| D11 | Optional `END` and `;` might not be LL(1). | They are: END is not in FOLLOW(rule) and `;` is not in FIRST(rule). Nested IF's mandatory END is consumed first. `npm run ll1` proves there are no conflicts. |
| D12 | Some spec examples needed a parser code that did not exist. | New P214 keyword used as a name, P215 generic expected/found, P216 bare value as a condition, P217 declaration after a rule, P218 nesting too deep. |

## Lexer and units

| ID | Problem | Decision |
|---|---|---|
| D13 | `K` was both a temperature unit and COLOR_TEMP's unit. | K is colour temperature only. `TEMP > 300K` is S310. No home automation reads room temperature in kelvin. |
| D14 | `123:45` passes the number DFA because q1 loops on digits, and `10:30C` would split into a time plus a name. | Both are L105. |
| D15 | `PRIORITY 2:3` looks like a time. | L105 with a hint. Rollback applies only when no digit follows the colon. |

## Semantics

| ID | Problem | Decision |
|---|---|---|
| D16 | **The physical-effects table would reject the brief.** AC ON → TEMPERATURE falls → R1 reads TEMPERATURE makes a self-loop, so `IF TEMPERATURE > 30 THEN TURN_ON AC` would raise S317. | Physical edges feed W411 only. They are drawn dashed and excluded from S317 and W407. |
| D17 | `SET AC MODE TO FAN`: `FAN` is an enum value and also a device. | An enum attribute resolves IDENTs against its own value set first. |
| D18 | `WHEN LIGHT TURNS ON THEN TURN_OFF LIGHT` alone would look like a self-loop, but it terminates. | Dependency edges are value-sensitive where the written value is known. TOGGLE matches both. |
| D19 | §14.2 says only rule 2 gets W413, but rule 1 also matches W413's definition. | The definition wins; both warn. |
| D20 | §14.2 expects `SET CEILING_FAN SPEED` to be clean, and §5.3 says only LIGHT turns on with SET. | Level attributes (BRIGHTNESS, SPEED, POSITION) imply power; setting 0 turns the device off. W414 applies to setpoints only. |
| D21 | `RISES ABOVE v` could reference a sensor. | It must be constant (S325), so trigger detection stays in the scheduler. |
| D22 | Time arithmetic and `DAY == WEEKDAYS` were unspecified. | Time arithmetic must be constant-evaluable, else S319. WEEKDAYS is a set usable only in `AT … ON`; `DAY == WEEKDAYS` is S308. |
| D23 | Several checks had no code. | New S320 bad PRIORITY, S321 unknown or incompatible UNIT, S322 scenario time outside the window, S323 assignment to a non-sensor, S324 literal division by zero or overflow, W415 implicit unit, W416 DNF cap reached. |
| D24 | Numeric BETWEEN was unspecified. | Inclusive, `lo ≤ x ≤ hi`, which is how people read `TEMP BETWEEN 20 AND 25`. Time windows stay `[a, b)` with midnight wrap. Numeric `lo > hi` never wraps and gives a W409 "empty range" warning. |

| D40 | `TEMP + 2F` is ambiguous. Converted as a temperature, 2 °F is −16.67 °C; in a sum it means a difference of about 1.1 °C. | °F arithmetic is S310, with a hint to use °C. Plain comparison with °F values still works and converts at compile time. |
| D41 | W404 as written would flag two `WHEN` rules with different events, which never run at the same moment. | State rules can overlap. An event or time rule conflicts only with a rule started by the same trigger. This matches §1.3, which defines the bug as overlapping state rules. |
| D42 | The spec says an SCC is guarded or not, but not what counts as a guard. | An edge is guarded if the target rule has a condition, or the write is inside a nested IF, follows a WAIT, or is a TOGGLE. A WAIT means the cascade cannot be instant, and TOGGLE's effect depends on the current state. |

## Runtime and optimizer

| ID | Problem | Decision |
|---|---|---|
| D25 | One start-of-rule snapshot makes `WAIT 5MIN, IF MOTION IS CLEAR THEN …` read stale data. | Resuming after WAIT takes a fresh snapshot, and WAIT is a CSE barrier. This refines §2.3.9. |
| D26 | A state rule busy in WAIT could miss an edge and stay out of step. | When it finishes, the rule is re-evaluated once. |
| D27 | `reads` could include nested-IF reads, re-running rules needlessly. | `reads` covers trigger reads only. Nested reads go to the dependency graph. It is recomputed after optimization. |
| D28 | O7 as written would merge `TOGGLE X, TOGGLE X`, which is not idempotent. | O7 excludes TOGGLE. |
| D29 | O9 could reorder notifications and change who wins a priority tie when another rule sits between the two merged rules. | O9 merges neighbouring rules only. Each action keeps its origin rule ID, so the log still names the original rule, and O7 never removes a duplicate credited to a different rule. |
| D43 | O6 as described reuses any earlier load, but short-circuit jumps mean an earlier load may never have run. In `B > 2 AND A > 1 OR A < 0`, the first `LOAD A` is skipped when B fails. | O6 is available-expressions analysis: a value is reused only if every path to that point computed it, using intersection at joins. |
| D30 | O3, O4, O5 and O9 work on conditions and rules, but the spec calls every pass `IR → IR`. | These four run on a clone of the AST, which is re-lowered with the same `irgen`. O1, O2, O6, O7 and O8 then run on quadruples. The UI shows O1–O9 and states the real run order. |
| D31 | "Store tenths as integers" cannot represent every literal. | A shared `round6()` runs after arithmetic, in folding and in the VM, so fold-time and run-time values agree. |
| D32 | Only R501 was defined. | New R502 division by zero or non-finite result, R503 computed SET value out of range (clamped), R504 oscillation warning. |
| D33 | `LOADA` has no surface syntax, because there is no `.` token. | It stays in the VM as a reserved opcode, tested directly, rather than inventing syntax the spec does not define. |
| D34 | Scenario edge cases were unspecified. | First-scenario assignments apply before sync and raise no events. No ELSE on initial sync. `FROM == TO` means 24 hours. The default window is 00:00–23:59, the default STEP is 1MIN and the start day is MON. DAY is assignable; TIME is not. Scrubbing forward fires each AT rule crossed; scrubbing backward fires none. |
| D35 | Every stage must be safe from compiler bugs. | Any internal exception becomes I001, and the fuzz test asserts I001 never appears. |

## Brief versus spec

| ID | Problem | Decision |
|---|---|---|
| D36 | §14.1 logs `Rule R1 fired: TURN_ON AC (LIVING_ROOM)`, but the brief asks for `Rule R1 fired: TURN_ON AC`. | The brief wins. The room shows as a separate chip. |
| D37 | The card list numbers Domain as 1, but "Stopped at stage 2: Parser" needs Parser to be 2. | Cards use stage numbers (Lexer = 1), as in the demo. The Domain card is an unnumbered primer. |

## Repository

| ID | Problem | Decision |
|---|---|---|
| D38 | `plan.txt` and `reference/` are working material, and the photos show classmates. | Both are gitignored and stay on disk only. |
| D39 | The Playwright browser cache holds no binary on the development machine. | E2E tests use the installed Google Chrome via `channel: "chrome"`. |
