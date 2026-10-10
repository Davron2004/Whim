## 1. Reply delivery

- [x] 1.1 Copy seven stored flowbench apps byte for byte into `synthrun/test/fixtures/flowbench-2026-10-09/` (water-counter-p1, recipe-box-p1, workout-log-p1, workout-log-p2, packing-checklist-p2, flashcards-p1, score-keeper-p1) under a suffix tsc, eslint and knip do not pick up, and add a suite helper that reads one by case name
- [x] 1.2 Serve the run page with the `sandbox allow-scripts` response policy in `newIsolatedContext`'s route
- [x] 1.3 Add the three scenarios of "A capability reply reaches the candidate realm" to the suite, one of them on the water-counter-p1 fixture, and red-check them against the header removed and against `sandbox allow-scripts allow-same-origin`
- [x] 1.4 Run the whole synthrun suite and `server:e2e` against the opaque-origin page; where an isolation test asserted a mechanism that changed (the service-worker fetch count), make it assert the refusal itself and keep its positive control

## 2. Hit test and native controls

- [x] 2.1 Count a dispatched capability call and its reply as quiet-window activity, and wait for the quiet window before the first enumeration at the initial mount and after each cold-mount
- [x] 2.2 Hit-test the picked element in the candidate's frame and defer one that fails; drop `pickNext`'s sole-unvisited backdrop rule in favour of the hit test plus the bounded re-dismissal
- [x] 2.3 Enumerate and drive a Picker's `<select>` with `selectOption` and DateInput's date, time and datetime-local inputs with fixed values; do not enumerate their wrapper
- [x] 2.4 Count failed actions and blocked fingerprints, add `RunReport.sweep` and `RunReport.screens.coldMounted`, and update the report fakes in `server/test` and `evals`
- [x] 2.5 Add the scenarios of "The sweep acts only on an element that can receive the action", the Picker scenario and the write-then-navigate scenario; red-check the hit test against an attribute-only variant and against a variant that marks a deferred element visited
- [x] 2.6 Replay the 22 stored apps and record repair-triggering apps, total and slowest sweep time, truncations and failed actions

## 3. Order and unreachable_screen

- [ ] 3.1 Use `aria-label` as the label when an element has no text, and give the SDK header Back button its own kind
- [ ] 3.2 Order fingerprints by group (rows, values, buttons, backdrop, header Back) and then by fingerprint
- [ ] 3.3 Raise `unreachable_screen` only for a cold-mounted screen no `navigate` call names, and correct the kind's description in `checks/contract.ts`
- [ ] 3.4 Act on one DOM path of a screen at most three times however its label changes (a Modal backdrop excepted), retire later fingerprints at that path without counting them as blocked or truncating, and stop enumerating the toast host as a Modal backdrop
- [ ] 3.5 Add the scenarios of "The sweep enters values before it presses commands" on the recipe-box-p1 and workout-log-p1 fixtures, plus the gated-screen, gated-screen-throws, orphan, icon-only-label, running-value and toast scenarios (score-keeper-p1 for the running value); red-check the order against values-after-buttons, the diagnostic against always-warn, and the per-path limit against none
- [ ] 3.6 Replay the 22 stored apps and record the same measures as 2.6

## 4. Spec sync and closing

- [ ] 4.1 Apply this change's delta to `openspec/specs/synthetic-run/spec.md`
- [ ] 4.2 Fill `evidence.md` §6 with the after numbers
- [ ] 4.3 Pass `scripts/gate.sh` with `GATE_BASE` pinned, the Chromium suites that reach synthrun, knip and `openspec validate --all --strict`
