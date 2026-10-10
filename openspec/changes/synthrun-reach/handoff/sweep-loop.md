# Contract: the sweep loop after chain-2 (hit test, deferral, native controls, counts)

Interface for chain-3, which changes labels, fingerprint order and when `unreachable_screen` is raised.
All in `synthrun/sweep.ts` unless stated.

## Types (verbatim)
```ts
export type SweepElementKind =
  | 'button' | 'text-input' | 'number-input' | 'select' | 'date-input' | 'time-input' | 'datetime-input'
  | 'switch' | 'checkbox' | 'slider' | 'pressable' | 'modal-backdrop';
export interface SweptElement { kind: SweepElementKind; label: string; domPath: string }
// synthrun/contract.ts
export interface SweepCounts { actions: number; blocked: number; failedActions: number }
// SweepResult gained:  coldMountedScreens: string[]  (the cold-mounted subset of visitedScreens);  sweep: SweepCounts;
// Since the review fixes SweepResult is derived (sweepResultOf) from a caller-owned SweepAccumulator that sweepApp
// keeps current (optional 6th parameter), so a run the budget killed still reports what it reached.
// RunReport changed:   screens: { declared: string[]; visited: string[]; coldMounted: string[] };  sweep: SweepCounts;
```
- `actions` = `actionsLog.length` (a failed action is included; a second backdrop dismissal appears twice).
- `blocked` = distinct `screen::kind::label::domPath` keys enumerated during the run and never acted on. A label that
  changes (a score, a cell glyph) mints a new key, so a relabelled control counts once per label it showed.
- `enumerateInteractiveElements` already emits no fingerprint for the field box that hosts a `select` or date input.

## Where order is decided
- `orderUnvisited(elements, visited)`: the order unvisited fingerprints are TRIED in. Today: `fingerprintKey` sort
  (`kind::label::domPath`, `byFingerprint`), then every `modal-backdrop` after every other kind. Chain-3's groups
  (rows, values, buttons, leave) replace this one function. `sortedUnvisited` is also what the truncation check uses.
- `pickNext(frame, elements, progress)`: takes the first of that order that passes the hit test; never reorders.
- Label text comes only from `enumerateInteractiveElements` (`textOf`, `fieldLabel`, `aria-label` for the native kinds).

## Invariants chain-3 must not break
1. Defer, never skip: `firstActionable` tests candidates in order; one that fails is NOT added to `visited`, NOT
   counted in `progress.actions`, and has no driver call made on it. Only `act()` marks visited and counts.
2. Re-dismissal: when unvisited fingerprints remain and none passes, a visited `modal-backdrop` that passes may be
   dismissed again only if `progress.actedSinceDismissal > 0`; `act()` zeroes it on a backdrop and increments it on
   anything else. Otherwise `pickNext` returns `null`. A `null` while unvisited fingerprints remain sends the loop
   round once more (after a toast wait if one shows and the run has one left); a second `null` in a row ends the
   screen, not truncated. The termination argument is the comment on `sweepOneScreen`. A new group must not let a leave-the-screen control precede a
   Modal's own controls on the same screen.
3. `performAction` throws on a driver failure; only `act()` catches it, counts `ledger.failedActions` and still marks
   the fingerprint visited. No other `.catch(() => {})` around a driver call.
4. Hit test = `firstActionableIndex`: scroll into view, non-empty box, not `disabled`, no `aria-hidden="true"`
   ancestor-or-self, `elementFromPoint` at EVERY point the action uses lands on the element or a descendant. The
   points per kind live there and in `performAction`; a new kind needs both.
5. Before each enumeration the loop runs `awaitMotionStill` (finite animations done, capped by `actionHardCapMs`),
   and after each action `noteActivity(obs.state)` then `awaitQuiet`. Dropping either makes a sheet's controls read
   as covered (the backdrop gets dismissed first) or a write-then-navigate be read before it navigates.
6. `unreachable_screen` is raised in `sweepApp`'s cold loop only for a screen no navigate call names
   (`navigateNamesScreen`, a scan of `source`); every cold-mounted screen is pushed into `coldMountedScreens`.

## Other changed interfaces
- `synthrun/observe.ts`: `noteActivity(state: ObservationState): void` (sole writer of `lastActivityAtMs` besides the
  observers' own listeners).
- `synthrun/capability.ts`: `CapabilityWiringOptions.onActivity?: () => void`, called at dispatch and at reply.
  `report.ts` wires it to `noteActivity(early.state)`.

## Tests and helpers
- Suite: `synthrun/test/sweep-reach.ts`, `export async function testSweepReach(): Promise<void>` (registered in
  `acceptance.ts`); its fixtures are local consts. It builds sweeps with `runSweep(session, source, { budgets?,
  engineFactory?, sweep? })` (private) and asserts on `actionsLog` order, `result.sweep`, trace and page text.
- Shared: `synthrun/test/support.ts` exports `within(work, ms, what)` (the `AppRecord` comes from
  `appRecordForSource(source, appId)`, exported by `synthrun/report.ts` and used by production too),
  `openWiredRun(session, source, wiringOptions?)` -> `{ ctx, obs, wiring, dispose }` (observers first, bridge second,
  bridge traffic counted as activity; `dispose` also detaches).
