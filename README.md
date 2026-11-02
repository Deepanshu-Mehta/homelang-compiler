# HomeLang

A complete compiler for a smart-home automation language (`IF TEMPERATURE > 30 THEN TURN_ON AC`), with a live, phase-by-phase visual walkthrough from lexer to simulated home.

## Run it

```sh
npm install
npm run dev        # open the walkthrough
npm test           # unit, golden, error-suite, differential and fuzz tests
npm run test:e2e   # browser smoke tests (needs Google Chrome)
npm run build      # type-check and build the static site and the CLI
npm run ll1        # prove the grammar is LL(1)
```

The site is static and works offline once built: serve `dist/` from anywhere.

### Command line

```sh
npm run homelang -- compile examples/brief.home --emit=tokens
```

`--emit` accepts `tokens`, `ast`, `symbols`, `ir`, `opt`, `bytecode` or `sim`. After `npm run build`, the same tool is available as `node dist-cli/homelang.js`.

## Architecture

### The compiler pipeline

Each phase is a pure function that hands its result to the next. A phase with errors stops the pipeline, and every later stage is reported as skipped. Warnings do not stop it.

```mermaid
flowchart TB
    SRC(["Source program<br/>IF TEMPERATURE > 30 THEN TURN_ON AC"])

    subgraph FRONT["Front end: is the program valid?"]
        direction LR
        LEX["1. Lexer<br/>DFAs, maximal munch"]
        PAR["2. Parser<br/>recursive descent"]
        SEM["3. Semantic analysis<br/>types, intervals, loops"]
        LEX -->|tokens| PAR
        PAR -->|AST| SEM
    end

    subgraph MIDDLE["Middle end: make it simple and small"]
        direction LR
        IR["4. Intermediate code<br/>quadruples, backpatching"]
        OPT["5. Optimizer<br/>nine passes"]
        IR -->|"quadruples, CFG"| OPT
    end

    subgraph BACK["Back end: run it"]
        direction LR
        GEN["6. Code generation<br/>stack bytecode"]
        SIM["7. Simulation<br/>VM and scheduler"]
        GEN -->|object file| SIM
    end

    SRC --> FRONT
    FRONT -->|"annotated AST, symbol table"| MIDDLE
    MIDDLE -->|optimized quadruples| BACK
    BACK --> HOME(["Simulated home<br/>floor plan and event log"])
    BACK -.->|approximate export| HA(["Home Assistant YAML"])

    classDef stage fill:#e6f2ea,stroke:#2f7d4f,color:#1f1e1d
    classDef endpoint fill:#fbf1dd,stroke:#9a6200,color:#1f1e1d
    class LEX,PAR,SEM,IR,OPT,GEN,SIM stage
    class SRC,HOME,HA endpoint
```

| # | Phase | Code | What it does |
|---|---|---|---|
| 1 | Lexer | `src/compiler/lexer/` | Hand-written maximal-munch lexer running on DFAs stored as data |
| 2 | Parser | `src/compiler/parser/` | Hand-written LL(1) recursive descent, with parse tree and AST |
| 3 | Semantic analysis | `src/compiler/semantic/` | Symbol table, types and units, interval analysis, conflict and loop detection |
| 4 | Intermediate code | `src/compiler/ir/` | Quadruples with backpatching, and a control-flow graph |
| 5 | Optimizer | `src/compiler/opt/` | Nine passes, each with a safety argument |
| 6 | Code generation | `src/compiler/codegen/` | Stack-VM bytecode, plus an approximate Home Assistant export |
| 7 | Simulation | `src/compiler/runtime/` | VM, scheduler and floor-plan simulator |

### How the project fits together

The compiler is a pure core with no knowledge of the page. The web page and the command line both use one public file, and a test fails if the UI imports anything else. The DFAs and the grammar are data, so the diagrams on the page are drawn from the same objects the compiler runs on.

```mermaid
flowchart LR
    subgraph CLIENTS["Clients"]
        direction TB
        WEB["Web walkthrough<br/>editor, pipeline bar, cards, floor plan"]
        CLI["Command line<br/>homelang compile --emit=..."]
        TESTS["Tests<br/>unit, golden, differential, fuzz"]
    end

    API{{"Public API: src/compiler/index.ts<br/>compile(), createSession()"}}

    subgraph CORE["Pure compiler core"]
        direction TB
        STAGES["Seven stages<br/>each returns status, output,<br/>diagnostics, time"]
        DATA[("Shared data<br/>DFAs, grammar,<br/>device catalogue")]
        STAGES --> DATA
    end

    WEB --> API
    CLI --> API
    TESTS --> API
    API --> STAGES
    DATA -.->|"drawn as diagrams"| WEB

    classDef client fill:#e3ecf7,stroke:#2e5fa8,color:#1f1e1d
    classDef api fill:#fbf1dd,stroke:#9a6200,color:#1f1e1d
    classDef core fill:#e6f2ea,stroke:#2f7d4f,color:#1f1e1d
    class WEB,CLI,TESTS client
    class API api
    class STAGES,DATA core
```

### One tick of the simulated home

Rules are edge-triggered: THEN runs when a condition changes from false to true, and ELSE when it changes back. A device change is an event, so one tick can cascade through several rounds. The depth limit of 16 stops a runaway loop with error R501.

```mermaid
flowchart TB
    IN(["A slider moves, or the scenario<br/>clock reaches an event"])
    UPD["Update sensor values"]
    PICK["Find the rules this change triggers"]
    RUN["Run each rule in the VM<br/>commands go on a queue"]
    RESOLVE["Resolve commands per device<br/>highest priority, then latest rule"]
    COMMIT["Commit, and write the event log"]
    Q{"Did a device<br/>change?"}
    DEPTH{"Cascade depth<br/>above 16?"}
    DONE(["Wait for the next change"])
    STOP(["Stop with R501"])

    IN --> UPD --> PICK --> RUN --> RESOLVE --> COMMIT --> Q
    Q -->|no| DONE
    Q -->|yes| DEPTH
    DEPTH -->|no, next round| PICK
    DEPTH -->|yes| STOP

    classDef step fill:#e6f2ea,stroke:#2f7d4f,color:#1f1e1d
    classDef decide fill:#fbf1dd,stroke:#9a6200,color:#1f1e1d
    classDef stop fill:#fbeceb,stroke:#b3261e,color:#1f1e1d
    class UPD,PICK,RUN,RESOLVE,COMMIT step
    class Q,DEPTH,IN,DONE decide
    class STOP stop
```

### Why the optimizations are safe

Each program runs three ways, and all three must produce the same event log and the same final home. This runs on every example, on programs written to stress each pass, and on 400 random programs. To check the test itself, 13 parts of the compiler were broken on purpose, and the suite failed every time.

```mermaid
flowchart LR
    P(["HomeLang program"])
    A["AST interpreter<br/>no IR, no optimizer, no VM"]
    B["VM with plain bytecode<br/>optimizer switched off"]
    C["VM with optimized bytecode"]
    CMP{"Identical logs and<br/>final state?"}
    OK(["Test passes"])
    BAD(["Test fails and<br/>prints the program"])

    P --> A --> CMP
    P --> B --> CMP
    P --> C --> CMP
    CMP -->|yes| OK
    CMP -->|no| BAD

    classDef run fill:#e3ecf7,stroke:#2e5fa8,color:#1f1e1d
    classDef check fill:#fbf1dd,stroke:#9a6200,color:#1f1e1d
    classDef good fill:#e6f2ea,stroke:#2f7d4f,color:#1f1e1d
    classDef bad fill:#fbeceb,stroke:#b3261e,color:#1f1e1d
    class A,B,C run
    class P,CMP check
    class OK good
    class BAD bad
```

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
