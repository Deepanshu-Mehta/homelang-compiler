# Progress

## Done

- **M1:** scaffold, `compile()` contract, diagnostics registry, six data-driven DFAs, maximal-munch lexer, CLI, Lexer and Domain cards, editor, pipeline bar.
- **M2:** grammar as data, FIRST/FOLLOW and LL(1) proof (`npm run ll1`, 0 conflicts), hand-written recursive-descent parser, AST, parse tree, panic-mode recovery, Parser card with tree views, grammar stepper and parse tables.
- **M3:** two-pass symbol table with prelude and explicit modes, type and unit system, every S3xx check except S317, Semantic card v1.
- **M4:** DNF and interval boxes, conflicts with concrete witnesses, rule-dependency graph with Tarjan SCC, S317 and all W4xx checks, Semantic card with number lines, conflict matrix and graph. Error table covers all 27 §14.3 programs and the §10 rows.
- **M5:** quadruples with Dragon Book backpatching (jump targets match §6.2 exactly), basic blocks and CFG (the eight blocks of §6.3), Intermediate code card with a step-by-step backpatch replay and a CFG view.

## Next

- **M6:** optimizer passes O1–O9, Optimizer card.

## Fixed along the way

- **Typing fast froze the tab (shipped in M1, fixed in M2).** The editor mirrored the app's `value` back into CodeMirror. Two keys inside one render made the old value overwrite the new text, each write re-fired the change listener, and the two states chased each other forever. The editor now owns its text, and the app writes to it only on an explicit preset load. `tests/e2e/smoke.spec.ts` covers it.

## Known issues

- Stages 5–7 are not built yet and report `skipped`.
- "Load witness" stores the witness, but the sliders arrive in M8, so it has no visible effect until then.
