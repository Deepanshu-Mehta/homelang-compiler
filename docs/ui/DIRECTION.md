# Design direction: the drawing set

This is the final design as built. The measured results are at the end.

![Stage 7 at 1280×720, after the temperature passes 30](shots/after-overview.jpg)

## Second pass: one stage at a time, on a wire

The first version passed every measurement but still read as a long grey document. The second audit is at the end of `AUDIT.md`. The second pass keeps the type, the colour classes, the trees and the floor plan, and changes the frame:

- **The rail.** The top bar is now dark, and the seven stages are stations on one wire. The wire is lit in amber up to where the program got. A failed stage turns red and breaks the wire, and the stages after it are hollow and joined by a dashed line. Amber has one meaning across the page: power is here. It lights the wire and the current station, and a light that is on glows the same colour.
- **One stage at a time.** Choosing a station opens that stage and nothing else, like turning to a slide. The page no longer scrolls through all seven. Previous and next links at the bottom, the arrow keys and Page Up or Page Down (which a presenter's clicker sends) move between stages. They never fire while someone is typing or using a slider.
- **The program pane.** The left pane is the program and its result. The editor fills the height, long lines wrap so nothing is hidden, and the file name sits above it. Under the editor is either the red stopped box or a compiled line with a one-line-per-device summary of the home, which stays live on every stage.
- **The home lives in Stage 7.** The plan, sliders, clock and log appear once, at a size where labels can't collide. Load witness on Stage 3 sets the sliders and opens Stage 7. A plan cell is never narrower than its longest label.
- **Quieter detail.** Stage titles step down to `--t-xl`, so a title and its status fit on one line. Status is a tinted pill with icon, word and time. The automaton panel puts the trace beside the diagram and moves a wide diagram underneath. Optimizer passes that changed nothing are plain rows, so the passes that did something stand out.
- **The primer is its own page,** opened from the rail.

Every test id the suite relied on still exists, except that the home's controls now have the unprefixed ids in Stage 7, and the summary under the editor uses `glance-*`.

## The idea

A house is built from a set of drawings. Each sheet shows one aspect, numbered in order, and the set ends with the plan you can walk through.

This page is the same thing. Each compiler stage is a numbered sheet, and the last sheet is the home itself, drawn the way an architect draws it: solid black walls, door swings, windows in the wall line, and fixtures in plan view.

**Who it's for:** a class watching a projector, with one student presenting.

**Its job:** make each phase readable from the back row, and end on a home that reacts.

**The one bold thing:** the floor plan. Everything else stays quiet so that it lands.

"Sheet" is only the visual metaphor. Every visible label says "Stage", to match the course and the instructor's demo: `Stage 2 · Parser`, and "Stopped at stage 2: Parser".

## How this was tested against the obvious answers

| First instinct | Why I dropped it | What replaced it |
|---|---|---|
| Blueprint: white lines on blue | It's the cliché for anything architectural, and dark backgrounds wash out on projectors | Black ink on pale film, the way real plans are printed |
| IBM Plex, the usual "technical" choice | It's a default, and nothing about it answers this brief | Atkinson Hyperlegible, chosen for the real constraint: reading from far away |
| Serif headings for an "editorial" feel | Thin strokes vanish on a projector, and cream with a serif is a generated-page look | Editorial comes from pacing and measure, not a serif |
| Drafting grid across the whole page | Decoration that competes with the content | The grid appears only inside tree and plan views, where position means something |

## Colour

All values are computed. Text clears AA on both backgrounds, and stays above 4.3:1 with an 18% wash that imitates a projector in a lit room.

| Token | Hex | Role | On film | On sheet |
|---|---|---|---|---|
| `--film` | `#F2F5F5` | Page background: cool, not cream | | |
| `--sheet` | `#FFFFFF` | Editor, tables, tree and plan views | | |
| `--ink` | `#14202B` | Text, walls | 15.1 | 16.5 |
| `--graphite` | `#465360` | Secondary text | 7.2 | 7.9 |
| `--link` | `#16489A` | Links, focus, selection | 7.9 | 8.7 |
| `--rule-strong` | `#7F8D96` | Control outlines | 3.1 | 3.4 |
| `--marker` | `#FFE873` | The teaching highlight: "look here" | | |

The highlighter yellow is the one accent, and it always means the same thing: the current stage, grammar rule, node or source span. It never appears as decoration. Ink stays 13:1 on it.

**The rail** is the one dark surface. Its own text colours were computed against it.

| Token | Hex | Role | On rail |
|---|---|---|---|
| `--rail` | `#17222D` | Top bar | |
| `--rail-raised` | `#243240` | Open station, hover | |
| `--rail-ink` | `#FFFFFF` | Open station's name, buttons | 16.1 |
| `--rail-muted` | `#C3CCD4` | Other station names | 9.9 |
| `--rail-dim` | `#9AA6B1` | Skipped stations, times | 6.5 |
| `--rail-wire` | `#6B7884` | Dark wire after a failure, button outlines | 3.6 |
| `--rail-error` | `#FF8A80` | Failed station | 7.1 |
| `--live` | `#FFC23D` | Lit wire, station nodes, Play | 10.0, and ink on it 10.3 |

**Token classes** match the editor and the chips. Each chip also prints its type, so colour is never the only signal.

| Class | Hex | On sheet |
|---|---|---|
| Keyword | `#5A2A9E` | 9.3 |
| Action | `#0A5AA8` | 6.9 |
| State and event | `#176B3A` | 6.6 |
| Day | `#086A73` | 6.3 |
| Name | `#14202B` | 16.5 |
| Literal | `#964400` | 6.7 |
| Operator | `#A0165A` | 7.6 |
| Punctuation | `#505C68` | 6.8 |

**Diagnostics** always pair colour with an icon and the word.

| Kind | Hex | On its tint | Icon |
|---|---|---|---|
| Error | `#AE1620` | 6.3 | Cross |
| Warning | `#855000` | 6.0 | Triangle |
| Info | `#16489A` | 7.4 | Circled i |
| Passed | `#176B3A` | 5.7 | Tick |

## Type

**Atkinson Hyperlegible Next** for text, and **Atkinson Hyperlegible Mono** for code, tokens and IR, bundled through `@fontsource-variable`. The Braille Institute designed them so similar characters stay distinct: `0` and `O`, `1`, `l` and `I`. That's what matters for tokens read from the back of a room. One superfamily replaces the current three typefaces.

The root size grows with the screen, so a 1920 projector gets larger text rather than more empty space: 16px at 1280 and about 19.5px at 1920.

| Step | Size | Use |
|---|---|---|
| `--t-sm` | 0.875rem | Smallest allowed: 14px at 1280 |
| `--t-base` | 1rem | Body and code, line height 1.55 |
| `--t-lg` | 1.25rem | Intro paragraphs, subheads |
| `--t-xl` | 1.563rem | |
| `--t-2xl` | 1.953rem | Stage titles, weight 700 |
| `--t-3xl` | 2.441rem | Stage number |

The ratio is 1.25. Reading text stays under 72 characters wide. Weights are 400 and 700 only, because lighter weights wash out. There are no all-caps labels. Token names such as `IF` and `NUMBER` stay capitalised because that's their real spelling.

All SVG text is drawn at true size, so no label can shrink below 14px. Diagrams scroll or zoom instead of scaling down.

## Spacing, shape, depth

- **Spacing:** 4, 8, 12, 16, 24, 32, 48, 72px, and nothing in between.
- **Radius:** 2px for chips and controls, 4px for views, and pills only for tree leaves, so the shape carries meaning.
- **Shadow:** only for things that float above the page: the sticky automaton panel and diagnostic hovers.
- **Borders:** sheets aren't boxed. A sheet opens with a heavy 2px ink rule and its title strip. Only instruments, such as the editor, tables and views, have an outline.
- **Controls:** buttons and selects are 32px tall. In the tight left pane, sensor toggles are 28px and sliders have a 24px hit area, so that the slider, plan and newest log line all fit at 1280×720.

## Motion

- 150–250ms, ease-out, and only in response to something a person did.
- Nothing animates on a keystroke. Typing updates text and badges in place, with no transition.
- Allowed: state changes on devices, a trace step, a backpatch fill, the parse tree to AST morph, and scrolling to a stage.
- The floor plan keeps subtle live motion: fan blades turn at their speed, the light glow scales with brightness, the AC shows airflow, the curtain slides and the lock shackle moves.
- `prefers-reduced-motion` turns all of this off, and every state is also written in words.

## Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ ⌂ Let's Automate  Primer  ①━②━③━④━⑤━⑥━⑦                ‹ ▶ Play › │  dark rail, 64px
│   a Home                 Lexer Parser … Simulation                   │
├────────────────────────┬─────────────────────────────────────────────┤
│ brief.home  [Example ▾]│ Stage 1 · Lexer              ✓ Passed  Focus │
│ ┌────────────────────┐ │ One-paragraph intro, under 72 characters     │
│ │                    │ │ ─────────────────────────────────────────── │
│ │ editor, full height│ │ ┌ the visual ─────────────────────────────┐ │
│ │ long lines wrap    │ │ └─────────────────────────────────────────┘ │
│ └────────────────────┘ │ ▸ Reference sections                         │
│ ✓ Compiled: 1 rule     │                                              │
│ Home now               │ ‹ Previous stage            Next stage ›     │
│ AC  OFF 26 °C   LIGHT …│                                              │
└────────────────────────┴─────────────────────────────────────────────┘
   40% wide, 22–44rem       one stage at a time, scrolls on its own
```

**Token wall:** chips are grouped by source line, with a compact and an expanded view. The automaton panel is sticky, so picking a chip never scrolls the trace off screen.

**Why two panes:** the left pane is the program and what it produced, and the right is the explanation of one stage. The home summary under the editor stays live on every stage, so a scenario playing in Stage 7 is still visible from Stage 2.

**Why one stage at a time:** a class follows one idea at a time, and the presenter always knows where they are. Stages that are not open stay mounted but hidden, so a selected token, a folded tree or a debugger position survive moving away and back.

**The tight case is 1280×720.** The rail fits in one row because station names sit under their nodes. Times appear under the names from 1700px wide, and on hover below that. The stage title and its status share one line.

**Failure:** loading a failing example opens the failing stage. Typing never changes the open stage.

**Focus mode:** any stage expands to full width over the page. On Simulation, focus gives a large plan with controls and log beside it. This is the projected finale.

**Narrow screens:** under 1100px the panes stack and the rail names only the open stage. Under 700px the stations get their own row.

## The floor plan

- One building, with rooms sharing walls and filling a single footprint, so no holes.
- Solid black walls, door openings with swing arcs, and windows breaking the top wall line.
- One icon style: everything in plan view, as seen from above. Lights are the standard circled cross and glow when on. The fan is a three-blade plan symbol. The AC is a wall unit with airflow. Curtains slide along the window. The lock sits on the door.
- Each device prints its state in words beside it, such as `ON 24°` or `LOCKED`.
- Sliders and toggles are grouped under room names, and the plan prints sensor readings inside each room. A plan cell is at least as wide as its longest device name or state, so labels never overlap.
- The event log is timestamped and clickable, with firing rules in bold, and the newest line stays in view.

## Trees and graphs

- All trees run top-down, using d3-hierarchy `tree()` with x as position and y as depth.
- Nodes are compact boxes coloured by kind. Tokens and leaves are pills, so shape separates them as well as colour.
- Pan, zoom, fit to view, reset and collapse. Labels stay at true size, and wide trees scroll or zoom, so they never squash.
- Only the first rule starts open. Later rules start folded, because rules sit side by side and would otherwise open as a tree far wider than the view.
- CFG and dependency graph stay `rankDir: "TB"`, with green and red edges, each CFG edge also labelled true or false, and they always draw at true size.
- DFA diagrams stay left to right, as in the demo.

**No compiler changes are needed for source highlighting.** Parse-tree leaves appear in token order, so each one can be matched to its token, and a node's span is the union of its leaves. AST nodes already carry spans. Both can be mapped in `src/ui/`.

## What I'm leaving out

- **Dark theme.** Decided against: a projector shouldn't use it.
- **Page-load animation,** since it serves nothing in a classroom.
- **Heavy dependencies.** The only additions are the two font packages, which replace three. Pan and zoom are hand-written, so the team can explain them.

## Walkthrough

Prev, Play and Next sit at the right of the rail. Before the walkthrough starts, Next and Play begin at the open stage. Choosing a stage yourself ends the walkthrough. Each step scrolls to a stage, marks it in yellow and runs that stage's animation: DFA trace, parser steps, a pause on semantic analysis, backpatching, optimizer passes, VM steps, then the simulation. Play ends at a failed stage, because nothing after it ran. On a program with no scenario, Stage 7 raises the first numeric sensor until a rule fires. The brief takes about 22 seconds.

## Measured results

Checked with Playwright on the brief, advanced, P203 and conflict examples, with every collapsible section open.

| Check | Before | After |
|---|---|---|
| Smallest text at 1280×720 | 9.5px, and 4.4px inside diagrams | 14px, inside diagrams too |
| Smallest text at 1920×1080 | 9.5px, and 4.4px inside diagrams | 17.1px |
| Text failing AA contrast | 21 kinds of element, worst 3.16:1 | None |
| Controls under 24px tall | 20 | None |
| Sideways page scroll | None | None, including the top bar |
| Home state at 1280×720 | Log below the fold on longer programs | A one-line-per-device summary under the editor on every stage; in Stage 7 the plan and the first sensor fit above the fold for the brief |

The advanced program has more rooms and rules, so its left pane scrolls at 1280×720.

Re-checked after the second pass: every text size still comes from the tokens, so nothing is under 14px. The rail adds the colours in the rail table above, all of which clear AA. All 55 browser tests pass at 1280×720.

## Before and after

The "before" shots are the original page. The "after" shots are the second pass.

| | Before | After |
|---|---|---|
| Failure | ![Before](shots/before-failure.jpg) | ![After](shots/after-failure.jpg) |
| Lexer | ![Before](shots/before-lexer.jpg) | ![After](shots/after-lexer.jpg) |
| Parser | ![Before](shots/before-parser.jpg) | ![After](shots/after-parser.jpg) |
| Intermediate code | ![Before](shots/before-ir.jpg) | ![After](shots/after-ir.jpg) |
| Output | ![Before](shots/before-output.jpg) | ![After](shots/after-output.jpg) |
