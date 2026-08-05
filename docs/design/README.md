# Handoff: Whim mobile shell — design system v2 + prompt→build flow

## Overview

Two things ship in this bundle:

1. **`Whim Design System.dc.html`** — a written, argued design system for the Whim shell (v2). It replaces the placeholder token set currently in `src/sdk/theme.ts`. It is the more important of the two files: it contains decisions, the reasoning behind them, and an explicit list of what is still unresolved.
2. **`Whim Mobile.dc.html`** — annotated screen designs. Turn 1 (`1a`–`1d`) is a faithful recreation of the *existing* launcher from the repo, kept as a baseline. Turns 2–4 (`2a`–`4d`) are the proposed prompt → clarify → plan → build → history flow.

The single most consequential idea here is **Whim Syntax** (design system §04): Whim's UI is mostly machine-written prose, so the type system *is* the design system. Prose is marked up by the role a span plays in the product — not by grammar — using four channels: colour, weight, typeface, and de-emphasis.

## About the design files

The `.dc.html` files in this bundle are **design references written in HTML**. They are prototypes that show intended look, copy and behaviour. They are **not production code and should not be copied into the app**. They use a bespoke streaming-template runtime (`support.js`) that has nothing to do with Whim's stack.

The task is to **recreate these designs inside Whim's existing environment**, using its established patterns, component conventions and libraries. Read them in a browser (open the `.dc.html` file directly) and read their source for exact values; then implement natively.

`support.js` is included only so the files render locally. Ignore it as an implementation reference.

## Fidelity

**High fidelity.** Colours, typography, spacing, radii and copy are final-intent and exact — implement them as specified. Two deliberate exceptions:

- Screens `1a`–`1d` are the *current* app recreated for comparison. They still use Roboto and the old palette. Do not treat them as a target.
- Anything marked **OPEN** or **FEEL IT** in design system §10 is undecided. Do not invent an answer; see "Open questions" below.

## Status legend used throughout the design system

| Badge | Meaning |
|---|---|
| `SETTLED` | Decided. Build against it. |
| `PROPOSED` | This document argues for it; still reversible. |
| `OPEN` | Answerable now, nobody has answered it. Ask before building. |
| `FEEL IT` | Only answerable by using the product for a week. Build the cheap version. |

---

## Design tokens

### Colour — the shell

The shell palette is deliberately almost colourless, so that saturated colour always carries meaning. It is **not themeable**.

| Token | Hex | Use |
|---|---|---|
| `paper` | `#fbfaf8` | Screen background |
| `surface` | `#f1efea` | Cards, inputs, sheets |
| `border` | `#e0dcd4` | Hairlines (1px) |
| `ink` | `#17171a` | Orb, overlays, dark panels, device bezel |
| `text` | `#1c1917` | All readable body text |
| `muted` | `#6b6560` | Secondary copy, hedges |
| `faint` | `#a8a29a` | Units, de-emphasised spans |
| `accent` | `#3f3d8f` | Ink violet. Primary actions, links. |
| `yours` | `#a15c07` | **The colour of the user.** See below. |
| `yours-on-dark` | `#e0a75e` | Same role, on `ink` backgrounds |

`#4f46e5` (framework-default indigo) is **retired** — replace every occurrence. `#3f5d3a` (deep moss) was considered and rejected.

### Colour — status

The only three saturated meanings in the shell. **Reserved globally** — a generated mini-app may not claim these as its primary colour, or the meanings leak.

| Token | Hex | Meaning |
|---|---|---|
| `working` / `done` | `#0d9488` | Succeeded, running, recovered |
| `broken` | `#b91c1c` | Failed and staying failed |
| `waiting` | `#c9c3b8` | Queued, not yet started |

On `ink` backgrounds use `#2dd4bf`, `#f87171`, `#c9c3b8` respectively.

### Typography

Three faces. **Space Grotesk is retired** — it is the default pick of a popular design tool and reads as a tell.

| Face | Role |
|---|---|
| **Instrument Sans** | Everything the interface says. 400/500/600/700. |
| **IBM Plex Mono** | Anything measured — clocks, durations, versions, counters, eyebrow labels. Never prose. |
| **Newsreader Italic** | **Only** the user's own quoted words. Never upright, never a heading, never system copy. |

Scale:

| Name | Spec |
|---|---|
| Display | Instrument Sans 700 · 34px/1 · `-0.03em` |
| Screen title | Instrument Sans 700 · 26px/1.15 · `-0.025em` |
| Metric | IBM Plex Mono 500 · 48px/1 · `-0.04em` |
| Body | Instrument Sans 400 · 15px/1.7 |
| Body emphatic | Instrument Sans 500 · 15px/1.7 |
| Caption | Instrument Sans 400 · 12px/1.55 |
| Eyebrow | IBM Plex Mono 500 · 10.5px · `+0.14em` · uppercase |
| Quote (inline) | Newsreader 400 italic · 17px/1.6 · colour `yours` |

### Radius

| Name | Value | Use |
|---|---|---|
| Chip | `999px` | Answer pills |
| Field | `14px` | Rows, list items |
| Card | `18px` | Plan rows, primary buttons |
| Tile | `22px` | App icons |
| Sheet | `28px` | Bottom sheets |

### Spacing

`xs 8` (inside a row) · `sm 12` (between siblings) · `md 16` (card padding) · `lg 22` (screen gutter) · `xl 34` (between groups). All px.

### Motion

| Name | Spec | Rule |
|---|---|---|
| Breathe | `1.9s ease-in-out infinite`, opacity `0.34 → 0.72` | The **only** loading motion. No shimmer sweep, no travelling gradient. |
| Sheet rise | `260ms cubic-bezier(.2,.8,.2,1)` | Sheets enter from the edge they will return to. Nothing fades in from nowhere. |
| Orb wheel | `300ms` hold to arm, `180ms` fan-out | Targets appear fast enough to feel pre-existing. |
| Text arriving | **none** | Streamed prose is never faded or typed in per character. The words appearing is the animation. |

---

## Whim Syntax — prose highlighting

**This is the core feature of the system. Implement it as a shared renderer, not per-screen.**

Rationale: an IDE does not colour by part of speech, it colours by *role in the system*. Colouring by grammar (nouns blue, verbs red) colours everything, and colouring everything is colouring nothing. Six classes:

| Class | Channel | Rule |
|---|---|---|
| `app` | Colour — that app's own tile hue | Every mention of an installed app, everywhere, including inside lists. Strongest tie between prose and the grid. |
| `chg` | Weight 500, no colour | The one thing that changed or broke. **Exactly one per sentence** — if there are two, write two sentences. |
| `yours` | Newsreader italic + `#a15c07` | Anything the user wrote, echoed verbatim. Never paraphrased. |
| `measure` | Mono face, no colour | Anything counted or timed (`0:45`, `3 taps`, `v4`). The face *is* the highlight; colouring numbers too is greedy. |
| `state` | The three status hues | Only the fixed vocabulary (`working` / `broken` / `waiting`). Never a synonym, never when a status dot is already adjacent. |
| `hedge` | Muted `#a8a29a` — reverse highlight | Honest detail that is not the point: attempt counts, approximations, caveats. Say it, then get out of the way. |

### Discipline rules — enforce these in the renderer, not just in the prompt

1. **Four system marks per sentence, hard cap.** Above four, readers stop trusting marks and read everything — worse than no highlighting.
2. **`yours` is exempt from the cap.** It is attribution, not emphasis, and it is the one span allowed two channels at once (italic + colour).
3. **One channel per span.** Never bold *and* coloured (except `yours`).
4. **One colour per sentence.** Two coloured spans read as a comparison even when unrelated. Weight and face are effectively unlimited.
5. **It must survive being switched off.** Every string must stay unambiguous rendered flat. If it doesn't, the highlighting was carrying meaning it shouldn't have.
6. **Never live in a field being typed.** Highlight a prompt only *after* submission. Lexing the composer live feels like the keyboard arguing with you.
7. **Agent prose only.** Labels, buttons, settings and headings are never highlighted. The system marks what it is *telling* you, not what it is *offering* you.

### Who applies which class

Four of six are **deterministic on the client** — implement as a small lexer, no model involvement:

- `app` — match against the installed-app list
- `measure` — number / duration / version pattern
- `yours` — match against the stored verbatim prompt for that change
- `state` — fixed vocabulary lookup

Only `chg` and `hedge` need the generator to tag them. Both are produced inside the post-run summariser (below), capped at one of each per sentence, **enforced in the renderer**.

### `yours` — the brown

Every other colour in the shell is a grey between paper and ink. The brown is the one hue that isn't, so it carries something structural: **everything the user authored, wherever it is shown back to them.** That makes it frequent rather than decorative — it appears at the top of every history row, on every plan screen, in every clarifying question.

Two forms, one meaning:
- **Upright brown** when the user's words stand alone as a block.
- **Newsreader italic brown** when set inside a sentence Whim wrote.

---

## Voice

**Minimal is the house voice.** The conversational middle register ("It now warns you before the last pour") is **retired** — it is the default voice of every assistant product, pads every sentence, and is slower to read.

Whimsy is permitted as **one vivid noun or verb inside a minimal sentence** — never as extra clauses. If the playful version is *longer* than the plain one, it is padding, not wit.

| Moment | Stakes | Copy |
|---|---|---|
| Waiting | none | `Rummaging.` |
| Change landed | low | `Nudges you before the last pour.` |
| Fixed after a stumble | medium | `Countdown had a taste for negative numbers. Fixed on attempt two.` |
| Broken, staying broken | high | `Didn't run. I've stopped trying. Your last working version is here.` |

Rules:

- Say what happened, not what the system did. "Warns before the last pour", never "committed 4a3f21e".
- Sentence case. No exclamation marks — no exceptions.
- Never apologise twice. One acknowledgement, then the way forward.
- **The agent may say "I."** Settled. It never introduces itself, has no name, no face, and never refers to itself in the third person.
- In a failure that is staying broken: **zero** whim-words. The sentence gets shorter, not warmer.

---

## Empty & loading states

A skeleton is a promise — only show one you can keep.

**Right:** the thing is genuinely coming *and* its shape is already known. Skeleton geometry must be generated from the same size constants as the real component, or the layout jumps on load and the skeleton was a lie.

- Loading a grid whose count is known → exact tile geometry, exact count, `breathe`.
- Plan rows streaming in → rows resolve top-down, **varying widths** (identical bars read as a progress bar).

**Wrong:** an empty result, or a state that may never fill. A user with no apps must never see six skeletons for apps that will never load.

---

## Two systems, not one

**The six theme presets are cut.** They were scaffolding. They solve no user problem and they put the personality in the shell, where the *apps* should be carrying it.

- **The shell is fixed.** Paper, ink, three status hues, brown for the user's words, three faces. Not themeable, not configurable, identical on every device.
- **Each app has its own look.** No contract, no slot count, no approved palette, no validation beyond legibility.

**Do not reintroduce the presets as a build-time palette library.** Those palettes were themselves AI-generated; feeding them back to a generator adds no information and only narrows the range while looking like expertise. Generator guidance should teach *concepts* the model wouldn't otherwise weigh — that an app's colours should sit well together, that a palette must survive being shrunk to a single tile, that a medication reminder and a party trick should not read alike. Named hex sets belong there only where a concept cannot be pointed at any other way — as an example *of a kind*, never as a menu.

(Colour bundles recommended to **the user**, choosing a look for their own app, is a separate and better idea. Not designed yet.)

---

## The orb — variable arity

Not four fixed buttons. **1–5 actions**, geometry follows the count.

- Press and hold to arm (`300ms`), then flick. Each action owns a `360/n` wedge of travel around the orb.
- The gesture is a **direction**, not a target — hit-test by angle of travel, not by pointer landing on a control.
- 1–3 keep fixed, memorable forms (1 = flick up; 2 = up/down; 3 = 120° each). 4 and 5 divide evenly (90°, 72°).
- Above 5, the wheel stops being blind-reachable and becomes a list.
- Assignment is **the user's choice**, stored per user, edited in a settings screen most people never open.
- **The wheel carries only cheap, undoable actions.** Nothing destructive by gesture — delete, rename and restore each need a screen and a sentence.

The defaults are **not decided** (see below). Ship the plain tapped menu first and instrument it.

---

## Screens

Open `Whim Mobile.dc.html` in a browser. Every screen carries a visible id badge (`1a`, `2b`, …); ids are stable and are the reference vocabulary for this project. Device frame is 390×800 (or 720) with a 9px `ink` bezel and 44px outer radius — frame only, not part of the design.

### Turn 1 — baseline (do not build)
`1a`–`1d` — the existing launcher, settings and theme picker recreated from `src/host/launcher` for comparison. Roboto and old palette, intentionally.

### Turn 2 — prompt → clarify → plan → build
- **`2a`** — the full proposed flow as an interactive prototype: composer → clarifying questions → plan review → build progress → "Pour Timer is ready". This is the primary screen to implement.
- **`2b`** — tile spec. 88×88, radius 22, solid app colour, monogram small at bottom-left, same monogram blown up and bleeding off the top-right at 16% white ("ghost letterform").
- **`2c`** — supporting component notes.

### Turn 3 — the orb
- **`3a`** — orb interaction prototype (press, fan, flick). Interactive: drag from the orb.
- **`3b`** — orb in situ inside a running mini-app.
- **`3c`** — action-set notes.

### Turn 4 — history
- **`4a`** — **the history screen.** Rows are plain-words summaries of what changed, produced by the post-run summariser. Collapsed, each row answers "what did I ask for, and when". Expanded: the result in plain words, what it touched, and the two things you'd want to do next. Nothing destructive is one tap away. This screen is the main consumer of Whim Syntax.
- **`4b`** — ⚠️ **OPEN QUESTION — its existence is unresolved.** A dedicated "last change, undoable in place" screen. It may be redundant with `4a`. Do not build without confirming.
- **`4c`**, **`4d`** — supporting specs (confirm sheet, version list).

Primary button pattern across all screens: 52–56px tall, full width, at the bottom, radius 18. Busy states replace the label with plain words, **never a bare spinner**. In any confirm sheet the **safe** option is the large button and the consequential action is demoted to plain text.

---

## What this asks engineering to build

1. **Post-run summariser.** After every completed run, generate a one-sentence, plain-words description of what changed and what was learned, and store it with the change. This is the string every history row renders. **It is a product feature, not demo copy** — `4a` is not implementable without it. Store the exact submitted prompt text alongside it, so `yours` spans can be echoed verbatim rather than reconstructed.
2. **Highlight lexer (client).** Deterministic, testable, no model involvement. Handles `app`, `measure`, `yours`, `state`.
3. **Two model-side tags.** The summariser emits at most one `chg` and one `hedge` per sentence. Cap enforced in the renderer.
4. **Highlighting off-switch.** A single flag rendering all prose flat — needed both as an accessibility answer and as the only honest way to run the "does highlighting stay signal at volume" experiment.
5. **Shared skeleton geometry.** Skeletons generated from the same size constants as the components they stand in for.
6. **Deterministic app-colour function.** The prose renderer needs the same name→colour mapping the grid uses.
7. **One declared tile colour per app.** The only thing the shell needs back from a generated app.
8. **Orb wheel with variable arity.** 1–5 actions, angle-of-travel hit-testing, per-user assignment.

## Open questions — do not invent answers

**OPEN** (decidable now, undecided):
- How does an app hand the shell its one tile colour — declared, or derived from what it used most?
- What happens to apps already built against the retired theme presets? Pin them to a frozen palette, or silently re-skin on first edit?
- Does screen `4b` exist at all?

**FEEL IT** (needs real use):
- How long is a commit message? Working theory: it reminds you which prompt produced this outcome and not much more, which argues for one line. Build one line first — cheaper to grow out of.
- How many actions belong on the orb, and which? Instrument a tapped menu first; start small, an under-filled wheel is easier to live with than a crowded one.
- Does one whim-word per message stay charming across forty history rows, or become a tic?
- Does four-marks-per-sentence stay signal down a long history?
- Should highlighting decay with age — today's entries fully marked, last week's flattening toward plain?
- Do shell colours mean the same thing inside a mini-app, given apps pick their own colours?
- Prophetic skeleton (labelled ghost tiles suggesting apps) vs. one honest empty tile on first run?

## Files in this bundle

```
START_HERE.md                        what to tell Claude Code
README.md                            this file — the spec, self-sufficient
reference/
  Whim Design System.dc.html         the system, v2. Read this first.
  Whim Mobile.dc.html                annotated screens, 1a–4d. Some are interactive.
  Whim Design System v1.dc.html      superseded; kept only for components carried forward unchanged.
  support.js                         runtime so the files render in a browser. NOT an implementation reference.
```

Open the `.dc.html` files directly in a browser (they need `support.js` sitting alongside them).

Suggested home in the repo: `docs/design/`. These are reference documents — not built, imported or shipped.

## Fonts

Instrument Sans, IBM Plex Mono and Newsreader are all Google Fonts, loaded by URL in the design files. No licensed or brand assets are used, and no image assets are required.
