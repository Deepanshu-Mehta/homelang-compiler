# HomeLang

A complete compiler for a smart-home automation language (`IF TEMPERATURE > 30 THEN TURN_ON AC`), with a live, phase-by-phase visual walkthrough from lexer to simulated home.

## Run it

```sh
npm install
npm run dev        # open the walkthrough
npm test           # unit, golden, error-suite, differential and fuzz tests
npm run test:e2e   # browser smoke tests (needs Google Chrome)
npm run build      # type-check and build the static site and the CLI
```

The site is static and works offline once built: serve `dist/` from anywhere.

### Command line

```sh
npm run homelang -- compile examples/brief.home --emit=tokens
```

`--emit` accepts `tokens`, `ast`, `symbols`, `ir`, `opt`, `bytecode` or `sim`. After `npm run build`, the same tool is available as `node dist-cli/homelang.js`.

## The phases

| # | Phase | Code | What it does |
|---|---|---|---|
| 1 | Lexer | `src/compiler/lexer/` | Hand-written maximal-munch lexer running on DFAs stored as data |
| 2 | Parser | `src/compiler/parser/` | Hand-written LL(1) recursive descent, with parse tree and AST |
| 3 | Semantic analysis | `src/compiler/semantic/` | Symbol table, types and units, interval analysis, conflict and loop detection |
| 4 | Intermediate code | `src/compiler/ir/` | Quadruples with backpatching, and a control-flow graph |
| 5 | Optimizer | `src/compiler/opt/` | Nine passes, each with a safety argument |
| 6 | Code generation | `src/compiler/codegen/` | Stack-VM bytecode, plus an approximate Home Assistant export |
| 7 | Simulation | `src/compiler/runtime/` | VM, scheduler and floor-plan simulator |

## Documentation

- [Language reference](docs/language-reference.md)
- [Design decisions](docs/DECISIONS.md)
- [Progress](docs/PROGRESS.md)

## Team

Course: Compiler Design

1. Deepanshu Mehta
2. Vishesh
3. Pranay Vishwakarma
4. Ankush
5. Manu Vahan
