## Why

`BuildStep` today shows only a 4-step stage sentence with no sense of *whether the run is still
alive* — a hung connect, a stalled repair loop, and healthy progress all render identically at
`stage:null` (research.md §1). When a run fails, the failure screen shows the terminal diagnostic
but nothing about how the attempt got there. Derived, non-internal activity signals (elapsed time,
output growth, a stall heartbeat) and a persisted run journal close both gaps without loosening the
prompt-flow spec's standing prohibition on rendering raw token/diagnostic internals.

## Dependency

This change applies **on top of `launcher-ghost-tiles`** (in flight, not yet archived). It reads
that change's `PendingBuildStore` — a persisted pending-build record keyed `pending:<launcherId>`,
single-writer from the `LauncherShell` loop, states `building`/`failed`/`interrupted`
(`openspec/changes/launcher-ghost-tiles/design.md` D2–D4, `specs/pending-builds/spec.md`). The
run journal introduced here is written by that same single writer and lives alongside that record.
Because `pending-builds` is not yet synced to `openspec/specs/`, this change does not delta it —
journal requirements live in a new capability spec instead (see below).

## What Changes

- Add derived, aggregate-only activity signals to the build screen: elapsed time since the request
  started, a rising output-size counter (character count), and a token-arrival heartbeat that
  visibly reports when the stream has gone quiet past a threshold (~8s) — alongside the existing
  stage sentence. No raw token or diagnostic text is ever rendered (the existing prompt-flow
  prohibition is unchanged and is reaffirmed for the new signals).
- Add a persisted, append-only run journal, written by the same single writer that owns the
  pending-build record: throttled entries on every stage transition and at most one aggregate
  entry per ~5s (never per token), hard-capped at ~200 entries with aggregate entries dropped
  first, stored under sibling key `journal:<launcherId>`.
- Journal lifecycle follows the pending record it rides alongside: persists with a failed/
  interrupted ghost for the failure screen's timeline; on success, moved to a per-app,
  last-run-only report at key `lastrun:<appId>` (overwritten each rebuild); deleted when its ghost
  is dismissed.
- Add a minimal timeline view rendering a journal as a readable list — stage transitions with
  durations, output growth, failure detail — reachable from the failure screen (a new "what
  happened" section) and from a details affordance on the build screen. In dev mode (the project's
  explicit-flag convention, decision #60(c) — never bare `__DEV__`) the same view additionally
  shows diagnostics counts and repair-attempt counts.

## Capabilities

### New Capabilities

- `generation-run-journal`: the append-only, throttled, capped run journal — its record shape,
  write cadence, storage keys, and success/failure/dismiss lifecycle.

### Modified Capabilities

- `prompt-flow`: the build screen's progress requirement gains derived activity signals (elapsed
  time, output-size counter, stall heartbeat) and a details affordance into the timeline view; the
  failure screen gains a "what happened" timeline section. Both additions are additive to existing
  requirements (ADDED, not MODIFIED — see specs).

## Impact

- `src/host/launcher/BuildStep.tsx` — activity signals + details affordance.
- `src/host/launcher/FailureScreen.tsx` — "what happened" timeline section.
- `src/host/launcher/prompt-flow.ts` — pure aggregation helpers (elapsed/heartbeat/growth), stage
  vocabulary already lives here.
- `src/host/launcher/LauncherShell` stream loop (the single writer identified in research.md §3) —
  journal writes alongside `PendingBuildStore` transitions.
- New: a journal store module colocated with `PendingBuildStore`, and a new timeline view
  component.
- No change to the generation server or the wire contract — the client only consumes existing
  `stage`/`token`/`diagnostic`/terminal events (generation-contract untouched).

## Non-Goals

- Mascot/animations, LLM- or structurally-generated narration of progress.
- Per-token UI of any kind.
- Journal history beyond the last run per app — no browsable multi-run archive.
- Any change to the generation server or its wire contract.
