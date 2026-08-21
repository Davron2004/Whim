# Start here — implementing the Whim redesign with Claude Code

This folder is a **design handoff**, not code. It contains an argued design system
and a set of annotated screens for the Whim mobile shell.

## Setup

1. Copy this whole folder into the repo at `docs/design/`.
2. Open `reference/Whim Design System.dc.html` and `reference/Whim Mobile.dc.html`
   in a browser and look at them. Every screen carries a visible id badge
   (`1a`, `2b`, `4a`…) — those ids are the vocabulary for this work.
3. Read `README.md`. It is self-sufficient: tokens, type scale, motion,
   the prose-highlighting spec, voice rules, and the open questions.

## The prompt to give Claude Code

> Read `docs/design/README.md` in full, then look at the two `.dc.html`
> reference files it points to. They are HTML prototypes of a redesign — design
> references only, do not copy their markup or their runtime (`support.js`).
> Implement the design natively in this codebase using our existing patterns.
>
> Start with the tokens: replace the placeholder values in `src/sdk/theme.ts`
> with the v2 palette, type scale, radii and spacing from the README. Retire
> `#4f46e5` and Space Grotesk everywhere. Do not touch screens `1a`–`1d` —
> those are a recreation of what already exists, kept only as a baseline.
>
> Then work through the list in "What this asks engineering to build",
> one item per PR. Anything marked OPEN or FEEL IT in the README is undecided:
> stop and ask rather than picking an answer.

## Suggested order of work

| # | Task | Where |
|---|---|---|
| 1 | v2 tokens — colour, type, radius, spacing, motion | `src/sdk/theme.ts` |
| 2 | Deterministic app-colour function, shared by grid and prose renderer | sdk |
| 3 | Whim Syntax renderer + client lexer (`app`, `measure`, `yours`, `state`), four-mark cap enforced in the renderer, plus the off-switch flag | new shared component |
| 4 | Post-run summariser + verbatim prompt storage | server |
| 5 | Prompt → clarify → plan → build flow (screen `2a`) | `src/host/launcher` |
| 6 | History screen (screen `4a`) — depends on 3 and 4 | `src/host/launcher` |
| 7 | Orb, tapped-menu version first, instrumented | in-app |
| 8 | Cut the six theme presets — see the OPEN question about existing apps first | `src/sdk/theme.ts` |

Item 3 is the centre of the design. Items 5 and 6 are not implementable without it.

## Two things not to do

- **Do not ship the HTML.** It uses a bespoke streaming-template runtime that has
  nothing to do with Whim's stack.
- **Do not invent answers to the OPEN / FEEL IT questions** at the end of the
  README. They are listed as undecided on purpose.
