# Contract: stored flowbench fixtures (chain-1 delivery-replies)

Interface for later chains' tests. Reply delivery itself is done: the run page is served with
`Content-Security-Policy: sandbox allow-scripts`, so a candidate receives capability replies.

## Where
- Directory: `synthrun/test/fixtures/flowbench-2026-10-09/`
- Naming: `<case>.app.tsx.txt`, byte-identical to the 2026-10-09 flowbench run's `sources/<case>.ts`
  (integration/beta-2 28a9e5cb, production roster). The suffix keeps them out of tsc, eslint, knip.
  Never edit one; add a new case by copying unmodified and extending the helper's union.

## Helper
- File: `synthrun/test/flowbench.ts`; from a sibling suite file: `import { flowbenchApp } from './flowbench';`
- Signature: `export function flowbenchApp(name: FlowbenchCase): string` (sync; source text by case name;
  `FlowbenchCase` is the union of the seven names below, not exported)
- Resolves from `process.cwd()` (repo root), like the rest of the suite.

## Cases and what each exercises
- `water-counter-p1`: buttons gated on a storage read (`Log a glass` is disabled until two `storage.kv.get` resolve; `Undo` disabled at 0)
- `workout-log-p2`: Modal + Picker (`<select>`) + a disabled button
- `score-keeper-p1`: aria-hidden scrim
- `recipe-box-p1`: list seeded from storage, a form, a detail screen behind a row
- `workout-log-p1`: pushed form with header Back and a DateInput
- `packing-checklist-p2`: rows under a Modal
- `flashcards-p1`: a button under a Modal

## Running one with storage
All seven declare `storage`. Wire as `synthrun/test/delivery.ts` does: an `AppRecord` with
`manifest.capabilities: ['storage']` and `schemaArtifact` (the app's own, or `{schemaVersion: 1, collections: {}}`),
`wireCapabilityBridge(app)`, then `openObservedRun(session, source, { appId, beforeNavigate: wiring.beforeNavigate })`.

## Invariants for consumers
- A host trace entry for a call is not evidence the candidate got the reply; assert an effect that follows it
  (see `delivery.ts`: enabled button, a dependent call).
- Today's sweep enumerates the moment the mount paints (chain-2 adds the quiet wait): wait on a DOM condition
  with `frame.waitForFunction(..., { timeout })` before `sweepApp` if the assertion depends on a mount-time read.
- `delivery.ts` also holds `servePageWithoutPolicy`, a test-local override route (no policy) for negative controls.
