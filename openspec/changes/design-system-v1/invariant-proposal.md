# Invariant proposal: SDK motion (design-system-v1 task 6.5)

For the owner of `invariants/`. Nothing here is in `invariants/`; feature chains do not author it
(decision #28). The working draft of every check below runs today as a standalone desktop suite,
`src/sdk/test/motion.desktop.mjs` (`npm run build && node src/sdk/test/motion.desktop.mjs`), against
the same outer page, srcdoc and locked CSP the runtime ships, delivered by source.

## Why it belongs in `invariants/`

SDK motion adds code to the trusted realm that plays animations from inside the sandbox. Two of its
properties are containment- or accessibility-relevant and must never regress silently:

1. Motion needs nothing beyond the sandbox's existing surface (CSP leg of #35/#37).
2. Reduce Motion is honoured by every moving component (system.md §4.5; the spec scenario
   "Reduce Motion is honoured as a pair").

## Proposed checks

### A. Motion runs inside the unchanged sandbox

In a realm built by `buildOuterHtml`/`buildSrcdoc`, after the runtime's own containment probes have
reported (their deliberate `eval`/`data:` attempts raise CSP reports of their own; start listening
after them), drive every moment of B with `reduceMotion: false` and assert:

- zero `securitypolicyviolation` events in the realm;
- `document.styleSheets.length` and `document.scripts.length` unchanged (no `<style>`, `@keyframes`
  injection or script added; WAAPI and inline style writes only);
- no `blob:` URL created (`URL.createObjectURL` call count 0, if the suite can observe it without
  instrumenting the realm the app runs in).

### B. Reduce Motion is a pair (non-vacuous by construction)

For each moment, run the identical trigger twice, in two realms whose host theme differs only in
`reduceMotion`, and read `document.getAnimations()` inside the frame (a host-side query cannot see
into the opaque-origin iframe):

| Moment | Trigger | `reduceMotion: false` | `reduceMotion: true` |
|---|---|---|---|
| Press | `pointerdown` on a `Button` | a `transform` animation | only `opacity` |
| Push / pop | `nav.navigate` / Back | `transform` on both screens | only `opacity` |
| Sheet | `Modal` visible true / Close | `transform` on the sheet | only `opacity` |
| Toast | `toast(text)` | `transform` | only `opacity` |
| Keyed list | add a row / remove a middle row | `transform` (enter), `translate` on the rows below (gap) | only `opacity`; no `translate` |
| Progress | change `value` | `width` / `strokeDashoffset` | no animation |
| Checkbox | check | `strokeDashoffset` | colour transitions only |
| Stepper | step | `transform` | no animation |
| Switch / segment / slider | toggle / select / tap | element drawn off its place (`translate` ≠ none) two frames later | `translate` none |

The `false` column is the negative control: it proves the harness sees motion at all, so the `true`
column can't pass vacuously (#28). "Moving" = any of `transform`, `translate`, `scale`, `width`,
`height`, `left`, `top`, `strokeDashoffset`, `filter` in an animation's keyframes.

### C. Identity-safe lists

An index-keyed `List` (`keyBy` returning the position) starts no animation on add or remove, and the
keyed list's leave animation targets only the removed row.

## Notes for the owner

- Both platforms (`platform: 'ios'` and `'android'`) take different push/switch shapes; the draft
  runs all four platform × scheme combinations, two with each `reduceMotion` value.
- Timing: a discrete event's React update commits in a microtask, so collect animations after one
  macrotask; durations are ≥ 100 ms, so nothing finishes before it is read.
- No new frame kind, global or capability is involved: the theme's `reduceMotion` already arrives in
  `__whimHostInit` and is sanitized by `src/sdk/theme.ts`.
