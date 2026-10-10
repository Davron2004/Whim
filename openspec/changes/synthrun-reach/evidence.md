# Evidence: replaying the stored flowbench apps

Source: the 22 delivered apps of the 2026-10-09 flowbench run, stored outside git at
`Whim-evidence/flowbench-2026-10-09/sources/` (packing-checklist-p1 failed and was not saved).
Each replay calls `createRunCandidate(session)(source)` exactly as the server's run stage does,
serially, on one `SynthRunSession`. No model call and no network. The script is
`Whim-evidence/flowbench-2026-10-09/synthrun-replay.mjs`; it bundles `synthrun/` from a checkout
passed on the command line and must run with that checkout as the working directory. Times are
one machine under load from other agents, so read them as ratios.

"Repair turn" below means what `decideAfterDiagnostics` would do with the run report alone: an
error or a truncation triggers a repair, warnings alone trigger one, nothing triggers none.

## 1. Baseline at a579f6f8

| Measure | Value |
|---|---|
| Apps whose run report triggers a repair turn | 7 of 22, all warnings-only, all `unreachable_screen` |
| `unreachable_screen` warnings | 11 |
| `run_truncated` | 0 |
| Sweep wall time, sum over 22 apps | 137.9 s |
| Slowest app | 27.5 s (workout-log-p2) |
| Actions that hit Playwright's 3 s timeout | 18, about 54 s of the 138 s |

The interceptors Playwright named: an `aria-hidden` div (the Modal scrim), a disabled button, the
Picker's `<select>`, a toast, a text input, plain divs.

## 2. The 12 flagged screens all have a navigate call

Across the flowbench run, 12 screens were flagged (11 in the stored final sources, plus Editor in
packing-checklist-p2's earlier probe). Every one is the string-literal target of at least one
`nav.navigate(...)` in its source. None is an orphan. The warning's hint, "add a reachable
nav.navigate(...) path to this screen, or remove it if it is unused", was wrong for all 12, and
the 7 warnings-only repair turns left the same warnings on the final sources.

## 3. Root cause: no syscall reply reaches a candidate in the run

Two apps got zero sweep actions (water-counter-p1 in 2 ms). water-counter-p1 disables its only
buttons until a `storage.kv.get` at mount resolves, and the host trace showed that one `get` and
nothing after it, though the app awaits two in a row.

A probe app made it exact. It reads `storage.kv.get` at mount and again on a button press, and
renders `pending`, `resolved` or `rejected` for each. Replayed at a579f6f8, both stay `pending`
a second after the press, while the host trace records both calls as successful.

The reply is dropped inside the candidate's realm. `src/runtime/web/syscall.js:83` accepts a
reply only from a parent whose origin serialises as `null` (the device WebView's does) or equals
the frame's own. Since `2187bb42` (committed 2026-09-22) the run page is served from
`https://synthrun.invalid`, so every reply carries that origin and is ignored. Each call then
rejects with `syscall_timeout` after 10 s, which is the "Couldn't load your templates." toast in
packing-checklist-p2's trace.

In a synthetic run since 2026-09-22, then, no generated app has seen the result of a storage
read or write. Lists seeded from storage stay empty, `ready` flags never flip, and a
`save().then(() => nav.navigate(...))` never navigates. That is most of issue #162. It probably
also explains the Tier-B storage round-trip score of 8/18, which this change did not re-measure.

Experiment: the same replay with one response header added to the route that serves the run
page, `Content-Security-Policy: sandbox allow-scripts`, which gives the outer document an opaque
origin. The probe app then shows `resolved` for both reads.

## 4. With replies delivered and the sweep unchanged

| Measure | Baseline | Replies delivered |
|---|---|---|
| Apps triggering a repair turn | 7 | 4 |
| `unreachable_screen` warnings | 11 | 6 |
| `run_truncated` | 0 | 0 |
| Sweep wall time, sum | 137.9 s | 227.9 s |
| Slowest app | 27.5 s | 28.2 s |
| Actions hitting the 3 s timeout | 18 | 30, about 90 s |

Apps do more once storage answers, so the sweep has more to press and more of it sits under an
open Modal. The time lost to blocked clicks grows from 54 s to 90 s, which makes issue #163's
fix a precondition for shipping this one.

## 5. What still blocks the remaining six screens

Action traces of the four apps still flagged:

- **workout-log-p1 / SessionDetail.** History's `+` opens LogSession. The sweep's first action
  there is the header Back button (an icon-only button, so its label is `(button)` and it sorts
  first). The form is never filled and no session is ever saved.
- **packing-checklist-p2 / Trip.** A Modal is open while the sweep presses the three template
  rows underneath it. All three clicks time out against the scrim, count as visited, and are
  never retried. Editor is then left through the header Back as its first action.
- **flashcards-p1 / Review, Done.** "Start review" is pressed while a Modal covers it. The click
  times out and the button is never pressed again.
- **workout-log-p2 / History, Detail.** Same shape: "View history" is pressed under an open
  Modal, among 8 timed-out actions.

Two mechanisms account for all four: an element covered at the moment it is picked is consumed
instead of deferred, and the header Back button is pressed before the screen's form is used.

## 6. After the change

Filled in at the end of implementation (task 4.2).
