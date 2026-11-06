# Progress

## Done

- **M1:** scaffold, `compile()` contract, diagnostics registry, six data-driven DFAs, maximal-munch lexer, CLI, Lexer and Domain cards, editor, pipeline bar.
- **M2:** grammar as data, FIRST/FOLLOW and LL(1) proof (`npm run ll1`, 0 conflicts), hand-written recursive-descent parser, AST, parse tree, panic-mode recovery, Parser card with tree views, grammar stepper and parse tables.
- **M3:** two-pass symbol table with prelude and explicit modes, type and unit system, every S3xx check except S317, Semantic card v1.
- **M4:** DNF and interval boxes, conflicts with concrete witnesses, rule-dependency graph with Tarjan SCC, S317 and all W4xx checks, Semantic card with number lines, conflict matrix and graph. Error table covers all 27 §14.3 programs and the §10 rows.
- **M5:** quadruples with Dragon Book backpatching (jump targets match §6.2 exactly), basic blocks and CFG (the eight blocks of §6.3), Intermediate code card with a step-by-step backpatch replay and a CFG view.
- **M6:** nine optimizer passes (AST: O3, O4, O5, O9; quadruples: O2, O1, O6, O7, O8), available-expressions CSE, dense renumbering, Optimizer card with per-pass diffs and safety reasons.
- **M7:** bytecode emitter, JSON object file, stack VM, step-through debugger, Code generation card, all CLI `--emit` kinds except `sim`.
- **M8:** discrete-event scheduler, AST interpreter as the test oracle, simulator, animated floor plan, sensor controls and time scrubber, scenario playback at 1×/10×/60×, event log linked to the editor, Load witness, Simulation card. Three-way differential test over the examples, 39 targeted programs and 400 random programs.
- **M9:** Home Assistant YAML export, browser checks for all 20 presets with a screenshot of every card, a diagnostics table whose examples are compiled by a test, README architecture diagrams, local viva notes.

## Next

All nine milestones are complete.

## UI redesign

Finished. The direction and measured results are in `docs/ui/DIRECTION.md`, and the audit it answers is in `docs/ui/AUDIT.md`.

- One tokens file, Atkinson type, a two-pane frame, a stage stepper, focus mode, and a one-line primer.
- Vertical trees with fold, zoom, fit, reset, pan and two-way editor linking. True-size top-to-bottom graphs.
- Token lines with compact and expanded views, and a sticky automaton panel.
- An architectural floor plan with live motion, controls grouped by room, and a timestamped log.
- A walkthrough with an animation for each stage.

### Second pass (4 November 2026)

The first redesign still read as one long grey document. The audit is at the end of `docs/ui/AUDIT.md`.

- A dark rail where the stages are stations on one wire, lit as far as the program got and broken at a failure.
- One stage at a time, with previous and next links, arrow keys and clicker keys (Page Up and Page Down).
- A full-height editor with wrapped lines, and a live "Home now" summary under it. The full home lives only in Stage 7.
- Floor-plan cells sized to their longest label, so names never collide.
- Status pills with times, a side-by-side automaton panel, and quieter optimizer rows.
- Browser tests updated for the new navigation, plus new tests for the arrow keys, the broken wire and the rail. 55 tests pass.

## Review fixes (6 November 2026)

An end-to-end review compared each stage with a textbook compiler and ran about 140 edge-case programs through the pipeline. No program crashed or raised I001. Fixed:

- S317 now catches a rule that undoes its own condition (see below and D54).
- S324 reported an oversized constant twice; it now reports it once.
- The L106 message listed 8 units while the lexer accepts 10. A test now ties the list to the unit table.
- The P216 hint is a sentence, like every other hint.
- The language reference now gives the 12:00 start time for a program with no SIMULATE block.
- New preset `examples/optimizer.home`, in which all nine passes change something (60 → 31 instructions). A test keeps it that way. On the Advanced preset, six passes had nothing to do.
- The Optimizer stage states the order the passes really run in.

1103 unit tests and 56 browser tests pass.

## Fixed along the way

- **Typing fast froze the tab (shipped in M1, fixed in M2).** The editor mirrored the app's `value` back into CodeMirror. Two keys inside one render made the old value overwrite the new text, each write re-fired the change listener, and the two states chased each other forever. The editor now owns its text, and the app writes to it only on an explicit preset load. `tests/e2e/smoke.spec.ts` covers it.

- **The differential test was weaker than it looked (M8).** Sabotaging 13 passes on purpose showed it caught only 6. The test programs never hit a threshold exactly, and the oracle shared its time-window code with the VM. After strengthening both, all 13 sabotages fail the suite. Doing this also exposed a real logging difference (R503 was written per queued command), now fixed.

- **A certain loop compiled as a warning (review, 6 November 2026).** `IF LIGHT IS OFF THEN TURN_ON LIGHT ELSE TURN_OFF LIGHT` passed the semantic stage with W407, then the simulation stopped with R501. Every state rule counted as guarded by its own condition, even when its actions flip that condition. Such a rule is now S317 (D54). Seven near-misses that can settle stay W407, and `tests/unit/analysis.test.ts` covers both.

## Known issues

- In the CFG, a `false` edge label can sit close to a block, because dagre routes edges without regard for label size.
- `npm run test:e2e` is slow: it took 16 minutes on 6 November 2026, even with a dev server already running on port 5199 (earlier runs took 1 to 6 minutes). The cause has not been investigated.
- Cytoscape logs two warnings that `width: 'label'` and `height: 'label'` are deprecated (`src/ui/viz/GraphView.tsx`). They are harmless; replacing them changes how every graph node is sized, so it needs a visual check first.
