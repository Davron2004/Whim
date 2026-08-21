## Context

The build screen renders exclusively from `stage` events (`prompt-flow.ts` `BUILD_STEPS`,
`currentActionSentence`) — a deliberate prohibition on raw `token`/`diagnostic` internals that this
change does not touch (research.md §1, prompt-flow spec "Generation progress is shown without
exposing internals"). The only place the event stream is consumed is the single async-generator
loop inside `LauncherShell` driving `onBuildIt` (research.md §3) — there is no independent event
bus, so any journal write or signal derivation happens in that loop, matching the single-writer
discipline `launcher-ghost-tiles` already established for `PendingBuildStore` (design.md D4).
Token arrival cadence is already observable client-side because SSE arrives via XHR incremental
reads, not RN's streaming-body-less `fetch` (research.md §20/§24 — `xhr-transport.ts`).

`launcher-ghost-tiles` (in flight) introduces the persistence substrate this change rides on: a
pending-build record at `pending:<id>` with states `building`/`failed`/`interrupted`, deleted on
delivery/cancel/dismiss, single-writer from the same shell loop
(`openspec/changes/launcher-ghost-tiles/design.md` D1–D5). This change does not modify that record
shape — it adds a sibling key.

## Goals / Non-Goals

**Goals:**
- Give the build screen a truthful sense of liveness — elapsed time, growing output, and an
  explicit "quiet for Ns" signal when the stream stalls — using only aggregates already permitted
  under the no-internals rule.
- Persist a compact, bounded record of what happened during a build attempt, written by the same
  single writer that owns the pending-build record, surviving process death exactly as that record
  does.
- Give a failed run a "what happened" timeline and give any run an on-demand details view, without
  inventing new narration.

**Non-Goals:**
- Mascot/animation, LLM-authored narration, per-token UI (proposal.md).
- Multi-run journal history — only the last run per app is retained after success.
- Any wire-contract or server change — the journal is a pure client-side derivation from events the
  client already receives.
- Resuming or replaying a journal across a realm/process boundary beyond the existing
  interrupted-ghost recovery story.

## Decisions

1. **Journal lives at a sibling MMKV key, not inside the pending record.** `journal:<launcherId>`
   alongside `pending:<launcherId>`, same `KVBackend` `PendingBuildStore` already uses. Alternative
   — embedding entries as an array field on the pending record — rejected: the record is read/
   written whole on every transition (`launcher-ghost-tiles` design D4), and the journal's higher
   write cadence (throttled aggregates, not just state transitions) would inflate every pending-
   record read/write for consumers (the grid) that only need the small record. A separate key keeps
   the hot "does a ghost exist" read cheap and the journal's own throttling independent.
2. **Record shape, additive-only, mirrors the pending-build discipline.** Entry:
   `{ t: number, kind: 'stage' | 'aggregate' | 'terminal', stage?: Stage, aggregates?: { chars:
   number, tokens: number }, failure?: { reason: string, diagnostics?: ... } }`. `stage` uses the
   WIRE vocabulary (`'plan'|'generate'|'check'|'run'|'repair'`), never the four display steps —
   the display mapping is a `BuildStep` concern, not a journal concern (research.md §35).
   `aggregates` are cumulative counts (running totals), not per-tick deltas, so a consumer can
   render any single entry in isolation.
3. **Write cadence is throttled by kind, not by a single timer.** Every stage transition writes
   immediately (these are rare and load-bearing for the timeline). Aggregate entries are written at
   most once per ~5s of wall time, coalescing all `token` arrivals in that window into one entry
   holding the latest cumulative counts — never once per token (research.md §33: per-token MMKV
   writes would thrash the store). The terminal entry (`result`/`failure`/stream-error) always
   writes immediately, bypassing the aggregate throttle, because it is the one entry a consumer
   cannot afford to miss.
4. **Cap ~200 entries; aggregates are dropped first, stage/terminal entries are never dropped.**
   When appending would exceed the cap, the oldest `aggregate` entry is evicted before any
   `stage`/`terminal` entry is touched. In the pathological case of an unbounded number of stage
   transitions (repair looping) the cap still holds — the journal is diagnostic, not a legal
   record, and a very long repair loop degrading to "no fresh aggregates, but stage/terminal history
   intact" is an acceptable, honestly-labeled degradation rather than unbounded growth.
5. **Lifecycle mirrors the pending record it rides with, plus one migration.** Created alongside
   the pending record at generation start; on terminal failure/stream-error it persists next to the
   now-`failed`/`interrupted` record (read by the failure screen's timeline section); on dismiss it
   is deleted with the record. On success it does **not** simply get deleted with the pending
   record — it is moved (read, written to `lastrun:<appId>`, then the `journal:<launcherId>` key
   deleted) so a successful run's report survives past the pending record's own deletion. `appId`
   here is the launcher id the delivered app now has (same id for new installs; for edit-at-tip and
   edit-behind-tip it is the id the generation was already using — see prompt-flow's existing
   delivery-routing requirement, which this change does not alter). `lastrun:<appId>` is
   overwritten on every subsequent successful rebuild of that app — last run only, no history, per
   the proposal's non-goal.
6. **Signals are derived, not separately persisted.** Elapsed time, the character counter, and the
   heartbeat are computed in-memory in the shell/`BuildStep` render path from (a) the request start
   timestamp already available to the loop and (b) the same cumulative aggregates the journal
   throttles into entries — they do not require their own storage. The heartbeat's "quiet for Ns"
   threshold (~8s) is evaluated against the timestamp of the last token/stage arrival, independent
   of the journal's own ~5s write throttle — a stalled stream still updates the on-screen clock even
   though no new journal entry is being written, because the heartbeat is UI-tick-driven, not
   journal-read-driven.
7. **Timeline view is one component, two render modes.** A single `RunTimeline` component takes a
   journal (array of entries) and renders stage transitions with durations (computed as consecutive
   `stage`-entry timestamp deltas), an output-growth summary, and failure detail from the terminal
   entry. A `devMode` boolean prop additionally renders diagnostics counts and repair-attempt counts
   already present in memory (`FailureScreen` already carries `observedRepairAttempts`,
   `diagnostics` — research.md §12) — no new data source, just a gated extra render branch. `devMode`
   is threaded from the existing explicit-flag convention (decision #60(c): `__DEV__` is dead code
   on-device; developer surfaces use an explicit build-time flag), not a bare `__DEV__` check.
8. **`BuildStep`'s "no animation, nothing fades or types in" invariant is preserved.** The elapsed-
   time and heartbeat text update by re-render (a ticking clock, like any timer display), not by any
   transition/fade — consistent with `BuildStep.tsx`'s existing comment that arriving text is never
   animated in.

## Risks / Trade-offs

- [Throttled aggregate writes mean a journal read immediately after a burst of tokens can be up to
  ~5s stale] → acceptable: the on-screen heartbeat/counter are driven by in-memory state (Decision
  6), not by re-reading the journal; the journal's staleness only affects the persisted record used
  for the after-the-fact timeline, where sub-5s precision has no product value.
- [Moving the journal to `lastrun:<appId>` on success is a second write path beyond the pending
  record's own delete, so a crash between "delivery succeeded" and "journal moved" could lose the
  last-run report] → matches the existing risk profile `launcher-ghost-tiles` already accepts for
  delivery-adjacent crashes (design.md Risk 4 / D5 "store first, index second"); the journal move is
  best-effort telemetry, not the source of truth for the app's existence, so losing it degrades to
  "no last-run report" rather than a lost app.
- [200-entry cap with a long repair loop could still evict every aggregate before failure, leaving
  the timeline growth summary thin] → accepted per Decision 4; stage/terminal entries — the ones the
  timeline actually needs for "what happened" — are never evicted.
- [A separate MMKV key per attempt (`journal:<id>`) alongside `pending:<id>` doubles the keyspace
  writes on the hot path] → matches the existing `PendingBuildStore` pattern of a primary key plus a
  sibling (`pending:order`), and the throttle in Decision 3 keeps the actual write rate low.

## Migration Plan

Additive only: new keyspace (`journal:<id>`, `lastrun:<appId>`), no schema change to
`PendingBuildStore`'s existing record. No existing data to migrate. Rollout is gated entirely by
this change landing on top of `launcher-ghost-tiles`; if that change's merge order changes, this
change's chains simply wait (see chains.md `after:`).

## Open Questions

- None blocking. Exact copy for the timeline's stage-duration labels and the heartbeat's "quiet for
  Ns" phrasing follows `copy.ts` conventions at implementation, same as `launcher-ghost-tiles`
  deferred its ghost-state copy (design.md Open Questions).
