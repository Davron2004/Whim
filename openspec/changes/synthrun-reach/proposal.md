## Why

The synthetic run decides whether a generated app goes to a paid repair turn, and on the
2026-10-09 flowbench it sent 7 healthy apps there for `unreachable_screen` warnings that no repair
could fix, while blocked clicks cost 3 s each and pushed one app past the 45 s budget (issues #162
and #163). Replaying the stored apps found the larger cause underneath both: since 2026-09-22 no
syscall reply reaches a candidate in the run, so every app is swept with its storage reads hung
(`evidence.md` §3).

## What Changes

- The run page is delivered as an opaque-origin document, so the runtime's syscall marshaller
  accepts the host's replies again. The page's bytes are untouched; one response header changes.
- The sweep checks that an element can receive a click before it acts. An element that is
  disabled, inside an `aria-hidden` subtree or covered by another element is deferred at no cost
  and picked again once it is clear. An open Modal therefore gets used and dismissed before the
  controls beneath it, and a covered control is no longer consumed by a click that never landed.
- The sweep drives native form controls: a Picker's `<select>` through `selectOption`, and
  DateInput's date and time inputs with canonical values.
- The sweep waits for the page to go quiet before its first enumeration on each fresh mount, and
  a capability call counts as activity for that wait.
- Value controls are filled before buttons and rows are pressed, and the SDK's header Back button
  is pressed last, so a form screen is filled and submitted before the sweep leaves it. This is
  the seeded-data pass of #162: the sweep creates one item through the app's own form, then
  follows the row that appears.
- `unreachable_screen` is raised only for a screen that no `navigate` call in the candidate
  names. A screen the candidate does navigate to, but the sweep did not reach, is still
  cold-mounted and is listed on the report as `screens.coldMounted`. It produces no diagnostic,
  so it never costs a repair turn.
- The run report says how complete the sweep was: actions taken, elements never actionable,
  actions that failed.
- The synthetic-run spec is brought in line with the resume and back-step sweep that landed with
  the last run, which the spec did not describe.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synthetic-run`: sweep order, the pre-action hit test, native controls, the quiet wait, resume
  and back-step (spec sync), when `unreachable_screen` is raised, page delivery origin, and new
  report fields.

## Impact

- `synthrun/session.ts`, `synthrun/sweep.ts`, `synthrun/report.ts`, `synthrun/contract.ts`,
  `synthrun/capability.ts` and `observe.ts` (activity hook), and the synthrun suite with fixtures
  copied from the stored flowbench apps. One comment line in `checks/contract.ts`.
- `RunReport` gains `screens.coldMounted` and `sweep`; the fakes in `server/test` follow the
  type. `evals/` reads only `screens.declared` and `screens.visited` and does not change.
- No change to `src/sdk/**`, `src/runtime/**`, `build/`, `invariants/`, or the gate's
  `CONFIG_SET`. No server routing change: the machine's warnings policy stays as specified.
- Sweeps reach more of each app, so `sweepMs` rises on apps whose storage reads used to hang. The
  45 s budget is unchanged and re-measured (`evidence.md` §6).
