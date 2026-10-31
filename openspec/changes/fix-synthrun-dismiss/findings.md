# Findings: fix-synthrun-dismiss

- source: GitHub issue #185 (filed 2026-10-19 from the `gate-full.sh` failure on `integration/beta-2` at `32428a03`)

## F185: synthrun hit test flakes under load — a covered control is marked blocked while a Modal's dismiss is still drawing

- severity: med
- files: `synthrun/test/sweep-reach.ts` (the failing check, line 582), the sweep's hit-test and transition-wait code under `synthrun/`
- symptom: `synthrun/test/sweep-reach.ts:582` ("hit test: deferring a covered control does not spend the per-screen cap") failed once in `scripts/gate-full.sh`:

  ```
  ✗ "Second" was still pressed under a cap of 6 actions (acted on: button:Open sheet ; slider:slider ; button:Close ; button:Inside ; modal-backdrop:modal; sweep {"actions":5,"blocked":1,"failedActions":0})
  FULL GATE FAILED: synthetic-run
  ```

  The cap is not what failed. The sweep took 5 actions against a cap of 6, in the right order, then ended with "Second" **blocked**. The uncapped run of the same fixture in the test just before it reached "Second" as its 6th action. So after the backdrop dismissal, the hit test on "Second" still found it covered — most likely by the Modal's dismiss transition, which stays drawn until it ends (the sdk-motion suite asserts "sheet dismiss: drawn until it is gone"). Because the backdrop fingerprint was already spent, the sweep gave up on "Second" instead of waiting. `npm run synthrun:test` alone passed 3/3 afterwards; the gate runs Chromium suites in parallel, so the machine was loaded.

  Done looks like: after a backdrop dismissal (and any action that closes an overlay), the sweep waits for the overlay to actually leave / finish its transition, under a generous bounded timeout, before hit-testing what it covered; a covered control is marked blocked only when the covering element is still present after that wait; reproduced first (fails with CPU spinners on every core before the fix), passes 20 runs in a row with them after (the method from #144/#172).
