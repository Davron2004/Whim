# chain-5 synthrun-modal-close: handoff (#185)

## What changed
- `synthrun/sweep.ts`: new `awaitBackdropGone(frame, backdrop)` + `MODAL_LEAVE_CAP_MS = 5000`. In
  `sweepOneScreen`, after a `modal-backdrop` action (after the quiet wait and the navigation check,
  before the next enumeration) the sweep polls every 30 ms until `firstActionable(frame, [backdrop])`
  is null (a probe that throws counts as gone), capped at 5 s. Once per dismissal, no action spent.
  `sweepOneScreen` and `pickNext` comments updated (termination argument names the capped wait;
  a backdrop still receiving at re-dismissal time is a reopened or never-closing Modal).
- `synthrun/test/sweep-reach.ts`: fixture `FIXTURE_UNDER_LATE_MODAL` (a literal copy of
  `FIXTURE_UNDER_MODAL` whose `onClose` runs `delay(2500).then(() => setOpen(false))`) and test
  "hit test: a Modal that closes late does not strand the control beneath it": asserts "Second" is
  pressed after the backdrop, the candidate shows "Second was pressed", blocked 0, failed 0.
- "deferring a covered control does not spend the per-screen cap" left as it was (5.3).

## Tests
- Red check (the new test against the unfixed sweep, one run): `synthrun:test` EXIT 1, "3 FAILED,
  520 passed". All three failures are the new test's: the log shows `button:Open sheet ;
  slider:slider ; button:Close ; button:Inside ; modal-backdrop:modal`, sweep
  `{"actions":5,"blocked":1,"failedActions":0}`, page text "Second is waiting".
- Green (with the fix, one run): `synthrun:test` EXIT 0, "523 checks passed". The cap test from
  5.3 is in that pass, unchanged.
- `npx eslint --max-warnings 0` on both files: exit 0. `npx tsc --noEmit -p .`: exit 0.
- Cost: the "Modal that cannot be dismissed" test now waits the full 5 s cap once (its Modal never
  closes). That is how it should behave, and it is well inside `SWEEP_TIMEOUT_MS`.

## Deviations
- None. The READY acceptance step (20 runs under CPU spinners) is the runner's, and the
  orchestrator dropped it under the no-repeat-runs ruling. Not run here.

## Side finding filed
- #230 (`ai-proposed`): the Modal sheet's drag header (`touchAction:'none'`,
  `src/sdk/surfaces.tsx:1017`) is enumerated as `slider:slider` (`synthrun/sweep.ts:350`). It shows in
  the red log above, where it spends an action. Not fixed.
