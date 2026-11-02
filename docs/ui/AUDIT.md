# UI audit

The current page, measured before any redesign. Screenshots are in `docs/ui/before/`, named `<program>-<width>-<part>.png`, for the brief, the advanced example and P203, at 1280×720 and 1920×1080. The measurements use the advanced example at 1280×720 with every collapsible section open.

## The short version

The page works, but it was built for a laptop at arm's length, not a projector at the back of a room. Most of its text is too small, the failure state hides the failure, and the floor plan, which should be the payoff, looks like a settings panel.

## Measured against your requirements

| Requirement | Today | Verdict |
|---|---|---|
| Minimum 14px text | 84% of characters are under 14px (19,958 of 23,695). Sizes go down to 9.5px | Fails |
| Text inside SVG | Diagrams scale down, so real sizes shrink: DFA state names 5.4px, DFA labels 4.4px, floor-plan device names 6.5px, room names 8px, number-line ticks 6.8px | Fails badly |
| WCAG AA contrast | 21 kinds of element fail. The worst is 3.16:1 (grammar arrows). Nearly all come from one colour, `--ink-3` `#8b8880`, used for timings, types and secondary text | Fails |
| Colour never carries meaning alone | A light's on or off state, and an AC's, are shown only by colour and glow | Fails |
| Controls easy to hit | 20 controls are under 24px tall, including every sensor toggle | Fails |
| No layout jumps while typing | Layout shift of 0.011 while typing through a parse error. Small, but stage times changing width cause it | Minor |
| Pipeline bar on one line | Wraps to two rows at 1280 (71px tall) | Fails |
| Design tokens in one place | 12 text sizes in use, 19 colours written outside the variables, and more in `GraphView.tsx` and `FloorPlan.tsx` | Fails |
| Trees top-down | Left-to-right | Fails |

## Hierarchy

- **The failure is hidden.** With P203 loaded, the first screen explains the lexer. The red error is two screens below the fold, and the only route to it is a link in the left pane. See `p203-1280-viewport.png`.
- **The token wall.** The advanced program renders 223 chips before the automaton, so the most interesting part of the lexer card is off-screen. See `advanced-1920-viewport.png`.
- **Reference buries the story.** On the Parser card, the grammar is open by default and sits between the tree and the rest of the page. See `advanced-1280-parser.png`.
- **The primer holds the best spot.** "How a smart home thinks" takes the top of the page on every program, even for a class that has already read it.
- **Everything has the same weight.** Each stage is an identical rounded box, so nothing tells the eye where the story is going.

## Typography

- Three typefaces, Space Grotesk, Inter and JetBrains Mono, with no clear job between them.
- 12 sizes with half-pixel steps (11.5, 12.5, 13.5), which is drift, not a scale.
- Nothing scales up at 1920. The same 13px text sits on a larger screen, leaving the page looking sparse and small. See `advanced-1920-viewport.png`.

## Colour

- Warm grey-cream with low-contrast secondary text washes out on a projector, as your demo photos show even at the instructor's higher contrast.
- Token colours were chosen by eye. They work on a laptop but were never checked.
- Warning amber and the literal orange are close enough to be confused.

## Spacing and density

- Spacing uses 2, 3, 4, 5, 6, 7, 8, 9 and 10px with no scale behind them.
- Tables, grammar and listings are dense at 12–13px, which reads as a wall from a distance.
- The left pane is 760px tall against about 673px available, so the event log, the proof that something happened, starts below the fold on longer programs.

## The floor plan

The biggest miss. See `advanced-1280-output.png`.

- It isn't a plan. It's a grid of identical boxes with a hole where a fourth room would be, and rooms have no walls, doors or relationship to each other.
- Icons are drawn in different styles: a side-on bulb, a front-on curtain, a top-down fan, a padlock from a phone UI.
- No device shows its state in words.
- Sliders are one flat list, not grouped by room, so a sensor is disconnected from the room it lives in.
- The log is the same size and weight as everything else, although it's the punchline.

## Interaction friction

- The tree has no zoom or fit, and wide trees scroll in a small window.
- Nothing connects the tree to the source. You can't see which code a node came from.
- The animations (DFA trace, grammar steps, backpatching, VM) each need their own controls, and there's no way to walk a class through them in order.
- A card can't be enlarged for projecting.
- The first run has no guidance towards "Load an example…".

## What looks templated

- The SaaS card kit: the same rounded card, the same border and the same spacing, repeated eight times.
- All-caps labels with no reason, such as `COMPILED` and `4 RULES`.
- Space Grotesk with Inter and JetBrains Mono is a very common default pairing.
- The warm off-white with hairline borders appears on a lot of generated pages.

## What already works, and stays

- The token chip with lexeme over type, and the DFA trace with double-ringed accepting states.
- The error box with the caret, which is close to the instructor's demo.
- The backpatching replay with orange blanks, and the green and red CFG edges.
- The optimizer diffs with a stated safety reason.
