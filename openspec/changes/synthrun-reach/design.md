## Context

The synthetic run boots a generated app in headless Chromium, sweeps its controls, and returns a
report the generation machine routes: errors go to repair, warnings get one repair turn
(`research.md`, "Repair routing"). Issues #162 and #163 came out of the 2026-10-09 flowbench: 7
of 22 delivered apps had cost a warnings-only repair for `unreachable_screen`, and clicks that
could not land cost 3 s each.

Replaying the stored apps changed the picture (`evidence.md`). The run page has been served from
a real origin since 2026-09-22, and the runtime's syscall marshaller ignores a reply from any
parent whose origin is not `null`. No candidate in a synthetic run has received a storage result
since then. Fixing that alone takes the 7 repair-triggering apps to 4. The remaining 4 fail on
two sweep behaviours: a covered element is consumed by a click that never lands, and the header
Back button is the first thing pressed on a pushed screen.

Constraints that shaped the design are in `research.md`, "Constraints and invariants". The ones
that bite: the page bytes and CSP are production artifacts and only delivery may differ; every
`exposeBinding` keeps its main-frame guard; the sweep is deterministic; `src/sdk/**`,
`src/runtime/**`, `build/`, `invariants/` and the gate's `CONFIG_SET` are not edited.

## Goals / Non-Goals

**Goals:**
- A candidate in the run receives capability replies, as on a device.
- A click that cannot land costs about nothing and is retried when it can land.
- A screen that needs one item of data is reached through the app's own form.
- An `unreachable_screen` diagnostic is true when it is raised, so a repair turn spent on it can
  fix something.
- The spec describes the sweep the code runs.

**Non-Goals:**
- Chained state the sweep cannot stumble into, such as flashcards' Done screen after reviewing
  every card. Those screens stay cold-mounted.
- Changing the machine's warnings policy, the 45 s budget or the per-screen cap of 40.
- Following navigation out of a cold-mounted screen.
- Seeding the storage engine from the host side.

## Decisions

### D1. Serve the run page as an opaque-origin document

The route that fulfils the run page adds `Content-Security-Policy: sandbox allow-scripts` to its
response. A document sandboxed without `allow-same-origin` has an opaque origin, so the replies
it posts carry origin `null`, which is what `src/runtime/web/syscall.js:83` requires and what the
device WebView presents. Measured: the probe app in `evidence.md` §3 goes from `pending` to
`resolved` with that header and nothing else.

Alternatives considered:
- Relax the origin test in `syscall.js`. Rejected: it is the production runtime inside the
  sandbox, the spec forbids patching it for testing, and the check is correct on a device.
- Go back to `file://` delivery. Rejected: the in-memory route is one of the three egress layers.
- A `data:` URL. Rejected: it would bypass the route that counts and refuses requests.

The header is a second policy next to the page's own `<meta>` CSP. Policies intersect, so nothing
the page allowed is widened; the outer page loses same-origin storage and popups, which it does
not use. The egress requirement says only delivery may change, and a response header is delivery.
The service-worker block gets stronger, since an opaque origin cannot register one at all; if
the suite's service-worker test counted the aborted script fetch, it now asserts the refusal
itself and keeps its positive control.

### D2. Hit-test before acting, and defer instead of skip

Before each action the sweep evaluates, in the candidate's frame, whether the picked element can
receive it: scrolled into view, non-empty box, not `disabled`, no `aria-hidden="true"`
ancestor-or-self, and `elementFromPoint` at the action point returns the element or a
descendant. Issue #163 asked for a skip. A skip that marks the element visited would repeat the
bug in `evidence.md` §5, where a button under a Modal is never pressed again. So a failing
element is deferred: not visited, not counted, picked again when it passes.

This replaces `pickNext`'s "backdrop only when it is the sole unvisited fingerprint" with a
simpler rule that falls out of the hit test: controls under an open Modal fail the test, the
Modal's own controls pass, the backdrop is ordered after them, and once it is dismissed the
controls beneath pass.

One loop needs a bound. A second trigger can reopen a Modal whose controls and backdrop are all
visited, leaving everything else covered. The sweep may dismiss a visited backdrop again, counted
as an action, only if it acted on some fingerprint since the last dismissal on that screen. A
Modal that cannot be dismissed therefore ends the screen's sweep after one attempt.

Playwright's own actionability wait stays in place behind the hit test, with the 3 s timeout
unchanged. An action that passes the test and still fails is counted as `sweep.failedActions`
and its fingerprint marked visited, so the sweep always makes progress. The count replaces
today's silent `.catch(() => {})`.

Alternative considered: `click({ force: true })` or `trial: true`. `force` clicks through the
cover and reports nothing; `trial` still waits out the timeout.

### D3. Native controls

A Picker renders a transparent native `<select>` over its field, and DateInput does the same with
a date, time or datetime-local input. A click on either opens a native popup the page cannot see.
The sweep adds kinds for them: `select` uses `locator.selectOption` with the first enabled option
whose value is non-empty and not already selected; the date kinds use `fill` with the fixed
values `2026-01-15`, `09:30` and `2026-01-15T09:30`. The field wrapper under the overlay is not
enumerated on its own.

### D4. Quiet before the first enumeration; capability traffic is activity

The sweep used to enumerate the instant the mount painted, before a mount-time storage read
could resolve, so what it found depended on a race. It now runs `awaitQuiet` first, at the
initial mount and after each cold-mount. The quiet window counts a dispatched capability call
and its reply as activity, in addition to frames, console and CDP events, which makes
"write, then navigate when the write resolves" read the screen after the navigation.

The observer state stays the single owner of `lastActivityAtMs`; the capability wiring gets a
callback, not a reference to the observers.

Two additions came out of implementing it (chain-2 report). The sweep marks its own action as
activity when the driver call returns: what the action causes reaches the host about 10 ms later,
and a window measured from older activity closed before any of it arrived (the write-then-navigate
test failed 2 runs in 5 without this). And before every enumeration the sweep waits, capped by
the action hard cap, until no finite animation is running in the frame. The quiet window cannot
see motion, so 300 ms after the click that opens a Modal the sheet is still sliding in, its
controls read as covered or off screen, and the backdrop was dismissed before they were used.
The SDK animates through the Web Animations API, so `document.getAnimations()` sees it. An
animation with infinite iterations (a spinner) is ignored.

### D5. Order: rows, values, buttons, leave

The sort key gains a leading group:

1. rows and cards (`pressable`)
2. value controls (text, number, select, date, slider, switch, checkbox)
3. buttons
4. Modal backdrop, then the header Back button

Values before buttons is the seeded-data pass issue #162 asked for, done inside the one sweep
instead of as a second pass: fill the form, press save, and the row the save created shows up as
a new fingerprint on the list. Rows go first because a search field is a value control, and
typing the canonical text into it empties the list before any row is pressed. recipe-box-p1 has
exactly that screen.

The header Back button goes last because the sweep already pops a finished screen through
`__whimControl.navBack()`. Pressed first, as today, it abandons every pushed form
(`evidence.md` §5). It is recognised by shape: a `button` with no text whose `aria-label` is the
SDK's back label. Only `HeaderButton` renders an icon-only button with an `aria-label`, so no
`src/sdk` change is needed. Reading `aria-label` as the label fallback also turns today's
`(button)` fingerprints into named ones.

Alternatives considered:
- A second full pass with cleared visited sets. It doubles sweep time and still presses Back
  first on every form.
- Re-pressing a button after later fields change. No stored app needs it once replies arrive
  (workout-log-p3's Setup form submits on defaults), so it stays out.
- Re-entering a screen left with unvisited fingerprints by replaying the action that entered it.
  The order above removes the cases in the evidence; revisit if a later benchmark shows app-drawn
  Cancel buttons abandoning forms.

### D6. `unreachable_screen` only for a screen with no navigate call; gated screens are coverage data

This is the routing question of #162. The choice: the machine's policy does not change, and the
sweep stops raising a diagnostic it cannot stand behind.

The warning says "never reached via navigation" and hints "add a reachable nav.navigate(...)
path to this screen, or remove it if it is unused". In the flowbench evidence that was false 12
times out of 12: every flagged screen had a navigate call, and 7 of 7 warnings-only repair turns
left the warnings in place (`evidence.md` §2). A diagnostic is a claim about the candidate with
a hint the model can act on. For a screen the candidate does navigate to, the sweep has no such
claim. It only knows it did not get there.

So after the live sweep each unreached screen is cold-mounted as before, and:
- if no `navigate` call in the source names it, the sweep raises `unreachable_screen` with the
  existing message and hint. That is an orphan, the hint is right, and one repair turn can fix it.
- otherwise the sweep raises nothing and lists the screen in `RunReport.screens.coldMounted`.

"Names it" is a text scan for a `navigate(` call whose first argument is the screen name as a
string literal, with the method names taken from `checks/contract.ts`'s `NAV_CALL_SHAPES`. The
static check already rejects a non-literal navigate target as an error, so every candidate that
reaches the run has literal targets only. A scan can be fooled by a navigate call in a comment;
that errs toward no repair, which costs nothing. An AST pass in `checks/` would be exact and is
the better home if orphan detection ever moves to the static check; it is outside this change.

Alternatives considered:
- Keep the warning and add a kind filter in the machine or the run adapter, as the check stage
  does for tile kinds. Rejected: an orphan would then never be repaired, and in an error round
  the false hint would still be fed to the model next to the real errors.
- Keep the warning but downgrade or reword it for gated screens. Rejected: the harness has two
  severities and no threshold knob, and the zero-warning steady state (decision #19) means a
  healthy app would carry a permanent warning.
- Leave routing alone and rely on the better sweep. Rejected: screens gated by chained state
  remain (flashcards' Done), and each would still cost a turn that cannot fix it.

A gated screen that throws on render is still an error, because cold-mount still renders it.

### D9. At most three actions on one DOM path of a screen

Chain-2's replay turned up one regression: score-keeper-p1 ends truncated. Its player cards show
the running score in their label, so each press mints a new fingerprint at the same path, and 29
presses of one card filled the 40-action cap. A truncation is an error and costs repairs. At
a579f6f8 the same app only looked healthy because a Modal scrim ate those clicks.

The loop was always there in the fingerprint definition: any control whose label changes with
each press mints without end. Working clicks expose it. The sweep now acts on one DOM path of a
screen at most three times however its label changes, and retires later fingerprints at that
path: they do not keep the screen open, do not truncate the run and are not counted as blocked.
Three covers a toggle that relabels (Start, Stop, Start) and a short stepper, and bounds a
counter. A Modal backdrop is excepted because its re-dismissal has its own bound (D2).

Alternatives considered:
- Fingerprint by kind and path only. A row that takes a deleted row's place would then never be
  pressed, and a button that turns from Start into Stop would be pressed once.
- Strip digits from labels. It fixes scores and leaves every non-numeric relabel looping.

The toast host is a fixed `role="status"` region and was classified as a Modal backdrop, so every
screen carried a phantom backdrop that was clicked last. It is excluded from enumeration.

### D7. Report fields

`RunReport.screens` gains `coldMounted: string[]`, a subset of `visited`. `visited` keeps
its meaning (it has always included cold-mounted screens, and the evals adapter reads it).
`RunReport.sweep` is new: `{ actions, blocked, failedActions }`. Both are required fields; the
fakes in `server/test` and `evals` follow the type. The server's run adapter maps diagnostics
only and needs no change.

### D8. Fixtures come from the stored flowbench apps

The suite gets a small set of the stored generated sources, copied byte for byte into
`synthrun/test/fixtures/flowbench-2026-10-09/` under a suffix that keeps them out of tsc, eslint
and knip without touching their config (the files are text the suite reads and hands to the
builder). Hand-written fixtures stay for the cases no stored app isolates: the orphan, the gated
screen, the undismissable Modal.

## Risks / Trade-offs

- [Sweeps get longer because apps now load data] → Blocked clicks stop costing 3 s; total and
  slowest-app times are re-measured on the 22 apps before the change is called done, with
  `run_truncated` count as the gate (`evidence.md` §6).
- [The suite gets slower with real-app fixtures] → A handful of apps, run with the suite's short
  quiet budgets.
- [An opaque-origin outer page behaves differently somewhere the suite does not look] → The full
  synthrun suite and `server:e2e` run against it; the 22-app replay ran clean with the header.
- [The hit test adds an in-page evaluate per action] → Milliseconds against a 300 ms quiet wait.
- [`elementFromPoint` misjudges an element whose centre is transparent to hits] → It is then
  deferred and counted as blocked, never clicked blind; the count is on the report.
- [A real orphan hidden behind a navigate call in dead code is not flagged] → Accepted; the old
  behaviour flagged 12 healthy screens to catch none.

## Migration Plan

No data or wire migration. `RunReport` is internal to the server process. Rollback is a revert of
the branch.

## Open Questions

- Whether `run_truncated` from the total budget should stay an error that can exhaust all three
  repairs on an app that is merely large. Not decided here; the after-measurement says whether it
  still occurs.
