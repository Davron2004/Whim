# Plan: fix-synthrun-dismiss

## Checklist

- [x] F185 — escalated out of the fix-loop lane: spec-visible, cause unconfirmed (see dispositions.md)

## F185

Planner (read-only, opus) output, 2026-10-19, kept as the starting point for the follow-up change.

- reconciled: live at HEAD. After a backdrop dismissal, when the first look finds nothing actionable, the sweep looks
  once more with no wait unless a toast shows (`synthrun/sweep.ts:810-817`) and ends the screen; it cannot dismiss again
  because `actedSinceDismissal` was reset by the dismissal (`:722`, set at `:769`); whatever still covers "Second" is
  booked as blocked (`sweepCountsOf`, `:662`). Matches the log: 5 actions under a cap of 6, `blocked:1`, not truncated.
  The only wait before each look is `awaitMotionStill` (`:806`), which waits only for WAAPI animations already started.
- cause: NOT the dismiss transition (the issue's hypothesis is refuted). A dismissing Modal sets `pointer-events:none`
  on its whole backdrop tree from the dismissal render on (`src/sdk/surfaces.tsx:1048-1049`, `exiting` at `:777`), so an
  exiting or gone Modal cannot fail the hit test. The only state that fails both looks is a Modal still fully open.
  Unverified, two candidates: (a) the close commit landed late under load; (b) the backdrop click or the earlier
  "Inside" press never reached its handler. Side note: the sheet header (`touchAction:'none'`, `surfaces.tsx:1017`) is
  enumerated as `slider:slider` (`sweep.ts:350-351`), the extra action in the log.
- fix sketch (only valid for cause (a)): in `sweepOneScreen`'s no-pick retry branch, after a dismissal, poll until the
  dismissed backdrop stops receiving at its click point (`firstActionable(frame, [backdrop])` null), under a named cap
  (~5000 ms), then the existing second pick.
- test (behavioral, deterministic): fixture copy of `FIXTURE_UNDER_MODAL` whose `onClose` closes after `delay(2500)`;
  red on HEAD every time (no activity → quiet window closes at once → screen ends with "Second" blocked).
- severity: med
- class-1 grant: none

### EVIDENCE

```
## synthrun/sweep.ts
  if (pick !== null || progress.actedSinceDismissal === 0) return pick;
      retried = true;
      await awaitToastGone(frame, acc.ledger);
      continue;
```
