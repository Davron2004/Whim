# Research digest: what the synthetic-run sweep does today, and what routes its findings into a repair

Condensed from two `researcher` digests taken at `a579f6f8` (sweep internals; repair routing and
the flowbench evidence). Terrain only. Measurements and the root-cause experiment are in
`evidence.md`.

## Relevant files
- `synthrun/sweep.ts` — the whole sweep: enumeration (:235), actions (:326), per-screen loop (:407), back-step (:456, :557), cold-mount (:475-512), `unreachable_screen` (:585-606).
- `synthrun/observe.ts` — `DEFAULT_RUN_BUDGETS` (:609), `awaitQuiet` (:658), `withTotalBudget` (:681, emits `run_truncated`), relay `exposeBinding` (:500).
- `synthrun/session.ts` — `DELIVERY_ORIGIN = 'https://synthrun.invalid'` (:52), `newIsolatedContext` (:119, the one route that fulfils the run page), `page.goto` (:357).
- `synthrun/capability.ts` — `exposeBinding('whimHostDispatch')` with the main-frame guard (:145-153); fresh `:memory:` engine per run (:87).
- `synthrun/report.ts` — `createRunCandidate` (:109); the sweep runs inside `withTotalBudget` (:163-180); report assembly (:208-230).
- `synthrun/contract.ts` — `RunReport` (:163), `RunBudgets` (:64), `RunOptions` (:129).
- `synthrun/test/acceptance.ts`, `test/harness.ts`, `test/run.mjs`, `test/isolation.ts`, `test/resilience.ts` — the suite (`npm run synthrun:test`, in `gate-full.sh` only).
- `src/runtime/web/syscall.js` — the in-realm syscall marshaller; its reply listener is at :78-99 (read-only here).
- `build/assemble.mjs` — outer page: `relaySyscall`/`relaySysret` (:141-142), `__whimControl.navBack` (:189) (read-only).
- `server/src/generation/machine.ts` — `decideAfterDiagnostics` (:291), `runRepairLoop` (:978), `buildAndRun` (:1159).
- `server/src/generation/stages/run.ts` — maps a `RunReport` to the machine's outcome; synthesizes `run_truncated` (:84).
- `server/src/generation/stages/check.ts` — keeps tile-identity warnings out of the repair policy (:55-75), the one existing precedent for a warning that never costs a repair.
- `checks/contract.ts` — closed `DIAGNOSTIC_KINDS` (:115), `NAV_CALL_SHAPES` (:370, `nav.navigate`, argument 0); `checks/passes/screens.ts` rejects a non-literal navigate target as an error.
- `checks/test/repo/binding-provenance.ts` — static audit: every `exposeBinding` is an inline callback whose first statement is the main-frame guard; any `exposeFunction` fails.
- `evals/adapters/synthetic-run.ts` (:32-33) — reads `report.screens.declared` and `.visited`.
- SDK DOM, read-only: `src/sdk/index.tsx` (HeaderButton :311, `aria-label` only, no text; header Back when depth > 0 :365; Button `disabled` :600), `src/sdk/controls.tsx` (FieldShell overlay :869-888, Picker `<select>` :1033, DateInput :996, TextField :68), `src/sdk/surfaces.tsx` (Modal backdrop `position:fixed` :1039, `aria-hidden` scrim :1053), `src/sdk/navigation.tsx` (leaving screen `pointer-events:none` :99).

## Current behavior

**Enumeration.** One `frame.evaluate` in the candidate's frame returns `{kind, label, domPath}` per element; `domPath` is a `#whim-root > tag:nth-child(n)` selector. Kinds come from DOM shape: `position:fixed` inline style is `modal-backdrop`; `input[type=text|number]`; `[role=switch|checkbox]`; `button:not([disabled])`; a div with `touchAction:none` is `slider`; a div with inline `cursor:pointer` is `pressable`. The label is inner text, so an icon-only button reads `(button)`. Not enumerated: `<select>`, `input[type=date|time|datetime-local]`. Nothing inspects `aria-hidden`, `pointer-events`, visibility or whether another element covers the target.

**Order.** `sortedUnvisited` sorts by `kind::label::domPath`, so kinds run alphabetically: `button`, `checkbox`, `modal-backdrop`, `number-input`, `pressable`, `slider`, `switch`, `text-input`. Buttons are pressed before any input is filled. `pickNext` holds a `modal-backdrop` back until it is the only unvisited element.

**Actions.** Playwright `locator.click`/`fill` with `ACTION_TIMEOUT_MS = 3000`, no `force`, each followed by `.catch(() => {})`. A click Playwright cannot land retries for the full 3 s, then counts as visited with no record. Switch, checkbox and slider make two clicks each (6 s worst case).

**Per-screen loop.** Enumerate, pick, act, mark visited, `awaitQuiet` (300 ms quiet, 4 s cap; activity is frame, console and CDP events), `awaitSettledScreen` (waits out a push/pop, 3 s cap), and return if the settled screen changed. It ends on no unvisited element, 40 actions, or navigation. The first enumeration runs the moment the mount paints; no quiet wait precedes it.

**Navigation.** Screen identity is a React fiber walk matched against `__WHIM_APP_MODULE__.default.screens`; `__whimNavDepth` frames only bound the back-step. Visited fingerprints and the action count persist per screen name, so a screen entered again resumes. When a screen finishes without navigating, the sweep pops with `__whimControl.navBack()` while `backSteps < actions` and the last announced depth is above 0. A screen left through its own Back control is not entered again unless some unvisited element leads there.

**Cold-mount and the warning.** For each declared screen the live sweep never reached, the sweep pushes an `unreachable_screen` warning (hint: "add a reachable nav.navigate(...) path to this screen, or remove it if it is unused"), then rebuilds the source with `initial` retargeted, delivers it with `reinject({reset:true})`, and sweeps that one screen. Navigation out of a cold-mounted screen is not followed. A cold-mount failure is swallowed. The screen is then added to `visited`.

**Budget.** `withTotalBudget` races the sweep against 45 s (the timer starts after mount), kills the page and pushes a `run_truncated` error. The per-screen cap sets `truncated` with no diagnostic; `server/.../run.ts` adds the error for that case.

**Syscall replies.** The outer page hands a syscall to `whimHostDispatch` and posts the reply into the iframe with `postMessage`. The marshaller's listener accepts a reply only when `ev.source` is the parent and `ev.origin` is `'null'` or the frame's own origin (`syscall.js:83`). The run page is served from `https://synthrun.invalid` since `2187bb42` (2026-09-22).

**Repair routing.** `decideAfterDiagnostics` reads severity only, never kind. Any error: repair while `repairsUsed < 3`, else `repair_exhausted`. Warnings only: one repair (`warningRepairAttempts: 1`), then deliver with the residual warnings streamed as `diagnostic` events. Run diagnostics are judged together with check diagnostics. The repair prompt lists every diagnostic as `- [severity] kind (line N): message — hint`, warnings in the same form as errors. The only record of what triggered a repair is the log line `repair triggered {kindCounts, warningsOnly}` (machine.ts:1014).

**Tests.** `synthrun/test/acceptance.ts` holds inline hand-written TSX fixtures plus `fixtures/navigation-demo.app.tsx`. Sweep tests cover mint-one, an orphan screen, push/pop, live navigation, back-step past a dead end, forged nav-depth and determinism. Nothing covers `fill`, a covered or disabled target, `<select>`, or a candidate that waits on a storage reply. The capability tests assert the host-side trace, not that the candidate received a result. The suite passes 391 checks in about 2 minutes at `a579f6f8`.

## Constraints and invariants
- Observation is trusted-vantage only (spec, F4). A bundle's own frames are bookkeeping; `nav-depth` cannot loop the sweep (the `backSteps <= actions` cap has a test).
- The sweep is deterministic: fixed canonical values, sorted order, no randomness. A test compares two runs' action sequences.
- A realm reset recreates the iframe (`reinject({reset:true})`), never re-delivers in place (T7).
- A truncated sweep is marked. No timeout is swallowed silently (spec "Watchdog").
- `DIAGNOSTIC_KINDS` is closed and grows additively; every diagnostic carries a non-empty hint; severity is `error` or `warning` with no threshold knob.
- generation-pipeline: warnings are repaired at most once and residual warnings are never dropped (decisions #19, #56 D6); repair feeds the model the diagnostics verbatim with their hints.
- Egress: the page is delivered from memory at a reserved origin, every other request is aborted, and "the page's bytes, CSP, nonce handshake, and loader SHALL remain the unmodified production artifacts. Only their delivery changes."
- Every `exposeBinding` keeps the main-frame guard as its first statement; no `exposeFunction`. One sanctioned `chromium.launch`.
- `src/sdk/**`, `invariants/`, `build/` and the gate's `CONFIG_SET` are not edited by this change.

## Integration points
- Kinds and recipes: the `SweepElementKind` union and `performAction`'s switch. Order: `sortedUnvisited`, `pickNext`.
- Loop and revisit state: `sweepOneScreen`, `sweepLive`, `ScreenProgress`.
- Warning emission: `sweepApp` (:585-606). Report assembly: `report.ts:171-230`. `RunReport.screens` has no field for how a screen was covered.
- Page delivery: the `route.fulfill` call in `newIsolatedContext`.
- Quiet-window activity: `obs.state.lastActivityAtMs`; the capability dispatch in `capability.ts` does not touch it.

## Risks and unknowns
- The digests ran nothing. Every runtime claim here was confirmed or corrected by the replays in `evidence.md`.
- `repairs-triggered.jsonl` has 11 lines, 8 naming `unreachable_screen` and 7 warnings-only; issue #162 says 12, 9 and 8. `flow-visible.md` also shows 11 repair stages. The one-off difference is unexplained.
- Request ids are matched to cases by duration and order, not by a recorded link.
- The pre-repair candidates were not stored, so "the repair changed nothing" rests on the final source still carrying the same warnings.

## Open questions for the planner
1. Should an element the sweep could not act on be recorded on the report, given the spec forbids silent timeouts?
2. Should the routing change live in the machine, in the run-stage adapter, or in what the sweep reports?
