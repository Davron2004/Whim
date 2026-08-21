## 1. Run journal store

- [x] 1.1 Add a `RunJournalStore` module colocated with `PendingBuildStore`, on the same MMKV
      `KVBackend`: `create(launcherId)`, `appendStage(launcherId, stage)`, `appendAggregate(launcherId,
      { chars, tokens })` (throttled ~5s internally), `appendTerminal(launcherId, { failure? })`,
      `get(launcherId)`, `moveToLastRun(launcherId, appId)`, `delete(launcherId)`.
- [x] 1.2 Implement the entry cap (~200) with aggregate-first eviction inside the store's append
      path.
- [x] 1.3 Implement `moveToLastRun` (read `journal:<launcherId>`, write `lastrun:<appId>`
      overwriting any prior value, delete `journal:<launcherId>`) and `delete`.
- [x] 1.4 Node acceptance suite for the store: throttling, cap/eviction order, move semantics,
      delete semantics (`npm run launcher:test` surface).

## 2. Pure aggregation and derivation helpers

- [x] 2.1 Add pure helpers to `prompt-flow.ts`: elapsed-time formatting from a start timestamp,
      cumulative char/token aggregation from stream events, heartbeat quiet-duration derivation
      from a last-arrival timestamp and the ~8s threshold.
- [x] 2.2 Add a pure helper mapping a journal's `stage` entries into consecutive-transition
      durations for the timeline view.
- [x] 2.3 Node unit tests for the above helpers, including the threshold boundary and the
      no-quiet-indication case.

## 3. Shell wiring — stream loop writes the journal

- [x] 3.1 In the `LauncherShell` loop driving `onBuildIt`, call `RunJournalStore.create` at the
      same point the pending-build record is created.
- [x] 3.2 Append `stage` entries immediately on every `stage` event; feed `token` events into the
      throttled `appendAggregate` path.
- [x] 3.3 Append the `terminal` entry immediately on `result`, `failure`, or stream error,
      bypassing the aggregate throttle.
- [x] 3.4 Wire `moveToLastRun` into the successful-delivery path (after install succeeds, using the
      delivered app's id) and `delete` into the dismiss path, matching the pending-build record's
      own delete-on-dismiss timing.
- [x] 3.5 Thread the in-memory elapsed/aggregate/heartbeat state (Decision 6 in design.md) through
      to `BuildStep`'s props without a journal re-read on every tick.

## 4. Build-screen UI — activity signals

- [x] 4.1 Render elapsed time and the output-size counter on `BuildStep`, next to the existing
      stage sentence, using only in-memory derived state (no raw token text).
- [x] 4.2 Render the stall heartbeat ("quiet for Ns") once the ~8s threshold is exceeded, clearing
      on the next `token`/`stage` arrival.
- [x] 4.3 Add the details affordance on `BuildStep` that opens the run timeline view.

## 5. Timeline view and failure-screen integration

- [x] 5.1 Build the `RunTimeline` component: stage transitions with durations, output-growth
      summary, and (for failed attempts) the terminal entry's `reason`/`hint` detail — reading from
      a journal already loaded by the caller.
- [x] 5.2 Add the `devMode` render branch showing diagnostics count and repair-attempts count,
      threaded from the project's explicit developer-diagnostics flag (decision #60(c)).
- [x] 5.3 Add the "what happened" section to `FailureScreen`, reading the journal for the record
      being shown (falling back gracefully if the journal is missing — see spec's
      journal-is-not-source-of-truth requirement).
- [x] 5.4 Wire the build screen's details affordance (4.3) to render `RunTimeline` for the
      in-progress attempt's journal.

## 6. Validation

- [ ] 6.1 Run `npm run launcher:test` and the Node aggregation/helper suites; confirm no
      per-token journal writes occur under a synthetic high-cadence token stream (assert write
      count bound by elapsed time, not token count).
- [ ] 6.2 Run `npm run lint` and typecheck; confirm no raw token/diagnostic field is referenced
      anywhere in `BuildStep.tsx`, `FailureScreen.tsx`, or the new timeline component outside the
      permitted `hint`/`reason`/count fields.
