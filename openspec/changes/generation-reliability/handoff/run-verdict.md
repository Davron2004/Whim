# Contract: chain-run-verdict (interface only)

For chain-upstream, which edits `machine.ts` (`runModelTurn`, `endOnThrow`, the reason
constants) on top of this. Nothing here is a diary; read the code for how.

## synthrun/contract.ts

```ts
export const UNOBSERVED_PHASES = ['module-eval', 'bundle', 'mount', 'deliver', 'probes', 'mount-timeout', 'none'] as const;
export type UnobservedPhase = (typeof UNOBSERVED_PHASES)[number];

interface RunReport {
  // ...unchanged...
  /** Present exactly when `contained === null`. Never carries message, source or symbol. */
  unobservedPhase?: UnobservedPhase;
}
```

`ObservationState.unobservedPhase?: UnobservedPhase` (synthrun/observe.ts) holds the FIRST
recorded cause (first write wins); `finalizeContainmentVerdict` stamps `'none'` when the verdict is
`null` and nothing was recorded; `report.ts` copies it only while `contained === null`.

Channels: CDP `runtime_throw`/`unhandled_rejection` whose top frame `url === ''` and `paintAtMs === null`
-> `module-eval`; loader error frame `where` in `bundle|mount|deliver|probes` -> that phase;
`awaitMount` budget with no paint -> `mount-timeout`.

## server/src/generation/machine.ts

```ts
export type NeverMountedPhase = Extract<UnobservedPhase, 'module-eval' | 'bundle' | 'mount-timeout'>;

export type RunOutcome =
  | { contained: false; diagnostics: Diagnostic[]; verdict: RunVerdict<'breach'> }
  | { contained: null; repairable: false; diagnostics: Diagnostic[]; verdict: RunVerdict<'unobserved'>; phase: UnobservedPhase; rerun: boolean }
  | { contained: null; repairable: true; diagnostics: Diagnostic[]; phase: NeverMountedPhase }
  | { contained: true; diagnostics: Diagnostic[]; record: WireAppRecord };
```

- `repairable: true` diagnostics = the report's diagnostics minus every `containment_*` kind. The
  terminal arm still carries `diagnostics: []` (nothing fed back).
- `UnobservedPhase` is imported type-only from `../../../synthrun/contract`.

### Functions changed (merge hot spots for chain-upstream)

| Symbol | Change |
|---|---|
| `CandidateOutcome` | `failed` gains optional `phase?: UnobservedPhase`; `containment-unobserved` gains `phase`, `rerun` |
| `unverifiedRunOutcome(outcome)` | param is now `Exclude<RunOutcome, {contained: true} \| {repairable: true}>`; copies `phase`, `rerun` |
| `Completion` (type) | failure arm gains optional `phase?`, `rerun?` |
| `failureTerminalFor(outcome, state)` | same signature; `containment-unobserved` and `failed` pass `phase`/`rerun` through to `Completion` |
| `emitCompletion(state, signal, completion)` | destructures `phase`, `rerun` too; the `terminal failure` line always carries them |
| `buildAndRun(...)` | new branch before the terminal-verdict branch: `contained === null && repairable` -> `repairNeverMounted` |
| `repairNeverMounted(runOutcome, signal, state, budgets, attemptField, roundDiagnostics)` | NEW private generator; streams diagnostics + closes the `run` stage, returns `repair` while `repairsUsed < repairAttempts`, else `failed`/`repair_exhausted` with `phase`; logs `run never mounted` before returning `repair` |

`endOnThrow` and `runModelTurn` are untouched: build the provider terminal beside them. A terminal
built there reaches `emitCompletion` with no `phase`/`rerun`, so its line logs `phase: 'none'`,
`rerun: false`.

## server/src/generation/stages/run.ts

`createRunStage(runCandidate)`: signature unchanged. First report `contained === null` and phase not in
`module-eval|bundle|mount-timeout` and signal not aborted -> calls `runCandidate(input.source, { signal })` a
second time (same source, no repair). The re-run's `true`/`false` maps as a first run's; a re-run still `null`
is always the terminal arm (`rerun: true`, `phase` = the re-run's phase, `'none'` if the report has none).
A never-mounted phase on a FIRST run is the repairable arm.

## Log fields (closed values, no content)

- `terminal failure` (info): `{ reason, verdict?, check?, phase, rerun }`. `phase`: `UnobservedPhase`, `'none'`
  unless the ending run was unobserved (or a repair-exhausted ending on a never-mounted candidate, which keeps
  that phase). `rerun`: boolean, `true` only for `run_unverified` endings.
- `run never mounted` (info): `{ phase }` (a `NeverMountedPhase`), logged only when the candidate is sent to
  repair (not when the budget is spent).

## Tests (names as the runners match them)

- `npm run synthrun:test -- --only resilience` (case "unobserved phase: ...")
- `npm run server:test -- --only run-stage,machine`
- `npm run server:e2e` (case "a candidate that throws while its module loads goes to repair...")
- `server/test/e2e-fixtures.ts` `heldRunTurns()` now has a 4th turn (`repair`, `MOUNT_HANG`).
