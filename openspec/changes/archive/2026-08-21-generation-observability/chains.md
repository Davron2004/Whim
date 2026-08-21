# Context chains: generation-observability

<!--
  Tasks from tasks.md grouped into context chains for the dispatcher.
  Rules: 3–7 tasks per chain (≤~800 lines expected diff), grouped by shared
  files/layer, sequential by default. Each chain must be completable from ONLY
  its named spec excerpts + contracts from earlier chains — if a task needs
  "whatever an earlier chain happened to learn," promote that into a contract.
  Declare a writes-contract for every chain whose outputs a later chain consumes.
  A contract (handoff/*.md) is an interface, hard-capped at 120 lines.
-->

**Whole-change dependency:** this change applies on top of `launcher-ghost-tiles`
(`openspec/changes/launcher-ghost-tiles/`, in flight). Every chain below reads
`PendingBuildStore`'s shape and lifecycle from that change's `design.md` and
`specs/pending-builds/spec.md` — dispatch of this change's chains MUST NOT start until
`launcher-ghost-tiles` has merged (its `PendingBuildStore` module is a hard prerequisite, not
just a spec reference). This is a whole-change `after:`, not per-chain — noted once here rather
than repeated in every block below.

## chain-1: persistence-foundations

- tasks: 1.1–2.3
- rationale: the journal store (persistence, MMKV-backed, colocated with `PendingBuildStore`) and
  the pure aggregation/derivation helpers (`prompt-flow.ts`, no RN UI, no store access) are both
  foundation layer with no dependency on each other's internals — grouped into one chain because
  each is small (4 + 3 tasks) and both are pure/non-UI, read by every later chain.
- reads: `specs/generation-run-journal/spec.md` (all requirements); design.md Decisions 1–4, 6;
  `openspec/changes/launcher-ghost-tiles/design.md` D1–D5, `specs/pending-builds/spec.md`
  (`PendingBuildStore` shape/keys/lifecycle, prerequisite module)
- writes-contract: handoff/journal-foundations.md

## chain-2: shell-wiring

- tasks: 3.1–3.5
- rationale: single-writer stream-loop integration inside `LauncherShell` — one file/layer, must
  land after the store and helpers exist to call into.
- reads: `specs/generation-run-journal/spec.md` (creation, stage/aggregate/terminal write timing,
  move-on-success, delete-on-dismiss requirements); design.md Decisions 3, 5, 6; handoff:
  handoff/journal-foundations.md
- writes-contract: handoff/shell-wiring.md

## chain-3: build-screen-signals

- tasks: 4.1–4.3
- rationale: `BuildStep.tsx` UI layer — elapsed time, output counter, heartbeat, and the details
  affordance, all driven by the in-memory derived state the shell loop now threads through; no
  journal read of its own.
- reads: `specs/prompt-flow/spec.md` ADDED "build screen shows derived activity signals" and
  "stall heartbeat" and "details affordance" requirements; design.md Decisions 6, 8; handoff:
  handoff/shell-wiring.md

## chain-4: timeline-view

- tasks: 5.1–5.4
- rationale: the `RunTimeline` component, its `devMode` branch, `FailureScreen`'s "what happened"
  section, and wiring the build screen's details affordance (4.3) to it. Ordered after chain-3
  because 5.4 edits `BuildStep.tsx`, the same file chain-3 owns — undeclared-independent chains
  must not touch the same file.
- reads: `specs/prompt-flow/spec.md` ADDED "details affordance", "what-happened timeline
  section", "dev mode" requirements; `specs/generation-run-journal/spec.md` (entry shape, journal-
  is-not-source-of-truth requirement); design.md Decisions 5, 7; handoff:
  handoff/journal-foundations.md, handoff/shell-wiring.md
- after: chain-3

## chain-5: validation

- tasks: 6.1–6.2
- rationale: cross-cutting suite/lint pass over everything the prior chains touched; must run
  last.
- reads: tasks.md §6; no new spec surface
- after: chain-4
