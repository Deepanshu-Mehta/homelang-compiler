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
