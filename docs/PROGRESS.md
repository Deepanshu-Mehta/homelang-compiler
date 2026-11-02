# Progress

## Done

- **M1:** scaffold, `compile()` contract, diagnostics registry, six data-driven DFAs, maximal-munch lexer, CLI, Lexer and Domain cards, editor, pipeline bar.
- **M2:** grammar as data, FIRST/FOLLOW and LL(1) proof (`npm run ll1`, 0 conflicts), hand-written recursive-descent parser, AST, parse tree, panic-mode recovery, Parser card with tree views, grammar stepper and parse tables.
- **M3:** two-pass symbol table with prelude and explicit modes, type and unit system, every S3xx check except S317, Semantic card v1.
- **M4:** DNF and interval boxes, conflicts with concrete witnesses, rule-dependency graph with Tarjan SCC, S317 and all W4xx checks, Semantic card with number lines, conflict matrix and graph. Error table covers all 27 §14.3 programs and the §10 rows.
- **M5:** quadruples with Dragon Book backpatching (jump targets match §6.2 exactly), basic blocks and CFG (the eight blocks of §6.3), Intermediate code card with a step-by-step backpatch replay and a CFG view.
- **M6:** nine optimizer passes (AST: O3, O4, O5, O9; quadruples: O2, O1, O6, O7, O8), available-expressions CSE, dense renumbering, Optimizer card with per-pass diffs and safety reasons.
- **M7:** bytecode emitter, JSON object file, stack VM, step-through debugger, Code generation card, all CLI `--emit` kinds except `sim`.
- **M8:** discrete-event scheduler, AST interpreter as the test oracle, simulator, animated floor plan, sensor controls and time scrubber, scenario playback at 1×/10×/60×, event log linked to the editor, Load witness, Simulation card. Three-way differential test over the examples, 40 targeted programs and 400 random programs.
- **M9:** Home Assistant YAML export, browser checks for all 20 presets with a screenshot of every card, a diagnostics table whose examples are compiled by a test, README architecture diagrams, local viva notes.

## Next

All nine milestones are complete.

## Fixed along the way

- **Typing fast froze the tab (shipped in M1, fixed in M2).** The editor mirrored the app's `value` back into CodeMirror. Two keys inside one render made the old value overwrite the new text, each write re-fired the change listener, and the two states chased each other forever. The editor now owns its text, and the app writes to it only on an explicit preset load. `tests/e2e/smoke.spec.ts` covers it.

- **The differential test was weaker than it looked (M8).** Sabotaging 13 passes on purpose showed it caught only 6. The test programs never hit a threshold exactly, and the oracle shared its time-window code with the VM. After strengthening both, all 13 sabotages fail the suite. Doing this also exposed a real logging difference (R503 was written per queued command), now fixed.

## Known issues

- None known.
