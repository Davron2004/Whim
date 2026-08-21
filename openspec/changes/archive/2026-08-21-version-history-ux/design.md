# Design: version-history-ux

## Context

The version store already exposes every product verb a history surface needs — `history`, `rollback` (bidirectional via the same-line predicate), labeled `pin`/`listPins`, `fork` from any tagged snapshot, `diff`, `active` (research.md, Current behavior). The launcher has an established full-screen sibling pattern (`SettingsScreen`: own `BackHandler`, `shellPalette`, `COPY` strings — research.md, Integration points) and a single sanctioned store path (`StoreAccess`, #43b). Two gaps stand between that terrain and the settled UX:

1. **Roll-forward enumeration** (research.md, verified fact 1): `history()` walks ancestry from HEAD, so after a restore the rewound-past versions vanish from the list even though their tags survive and `rollback()` accepts them. Roll-forward is a product requirement.
2. **No UI**: no screen, no entry point, no `StoreAccess` read surface, no copy.

Product decisions were settled in the owner explore session (2026-07-18): history reads as the user's own prompts; tap = instant restore to the state *before* that prompt with an undo toast; named pins; fork-from-point; schema-diff data annotations with reassurance-toned messaging; prompt envelope `{v: 1, text}` defined here, written by #7/#11 later; rewind-then-new-prompt and all linked-apps semantics deferred to a sibling change.

## Goals / Non-Goals

**Goals**
- Per-app History screen: prompts-as-history, restore-before-prompt with undo, roll-forward, named pins, fork-from-point, data annotations.
- One additive store verb closing the roll-forward enumeration gap, TDD'd in the vstore suite.
- `StoreAccess` wrappers so the launcher still never touches raw `VersionStore`.
- All copy through the `COPY` table and the product-verbs guard; "version" is the user-facing noun.

**Non-Goals**
- Rewind-then-new-prompt behavior, linked/shared databases, DB clone, "replace the old one?" offer (sibling change; no prompt flow exists until #7).
- Cursor pagination (cap suffices at Tier-0 depths — #39 latency numbers, research.md).
- Visual code diffing; storage-engine changes of any kind; persisted current-version field on `InstalledApp`.

## Decisions

**D1 — Restore semantics: a row restores the state BEFORE its prompt.** The list maps row *i* (the prompt that produced snapshot Sᵢ) to a restore target of Sᵢ₋₁ — Claude-Code-rewind semantics, per the owner's explicit model. The oldest row (the install event, S₀) has no predecessor and renders without a restore affordance. Alternative (restore-to-after) rejected: it breaks the "undo the change I just asked for" mental model that motivates the whole screen.

**D2 — New store verb `timeline(appId, {limit?}): Promise<Snapshot[]>`.** Implementation: enumerate snap tags (the `oidToId` machinery exists), keep oids satisfying the existing `isSameLine` predicate against the current branch tip, order newest-first by commit timestamp, cap at `historyLimit`. Returns the same `Snapshot` shape as `history()`. Rationale: reuses two existing internal mechanisms, changes no existing verb, and makes roll-forward targets listable (the gap in research.md fact 1). Alternatives rejected: a UI-side workaround listing only pins (fails "roll forward should be a thing" for unpinned versions); tracking a "furthest tip" ref (new persistent state, drift risk). Cost note: `isSameLine` is two ancestry walks per tag — O(n·depth) with n ≤ cap; #39's measured latencies leave ample budget at Tier-0 depths, and the cap bounds it. The screen uses `timeline()`, not `history()`.

**D3 — Undo is screen-local state, not a store concept.** Before calling `rollback`, the screen captures the current active id; the toast's Undo calls `rollback` back to it. Nothing persists; the toast times out (~5 s). The store's non-destructive rollback makes this trivially safe in both directions.

**D4 — Prompt envelope `{v: 1, text: string}` lives in a launcher-local module** (`src/host/launcher/prompt-envelope.ts`): `parsePromptEnvelope(raw: string): {text: string}` — strict-parse JSON with `v === 1` and string `text`, else fall back to `{text: raw}`. Not placed in `contract/` (the RN app must not grow a workspace import — guard:metro seam); #7/#11 surface the shape in `@whim/contract` later and must conform (roadmap contract note). Seeded fixtures keep raw strings; defensive rendering covers them.

**D5 — Data annotations are lazy, per-row, and artifact-level.** For a rendered row pair (Sᵢ₋₁, Sᵢ): run `store.diff` on the pair, and only if the schema artifact file changed, parse its before/after and run the storage engine's pure `diffSchemas`; render additions as "added: <display name> (<type>)". Memoize per pair for the screen's lifetime. Additive-only evolution (#38/#40) guarantees the diff contains only additions/display-renames — no deletion messaging exists. Restore reassurance: on restoring to target T, `diffSchemas(T.schema, active.schema)` additions = fields leaving view; if non-empty, the toast/inline note carries the one-line reassurance. Alternative (eager annotation of all rows on open) rejected: N content fetches up-front for rows that may never scroll into view.

**D6 — `StoreAccess` wrappers, each under `ensureLineage`**: `history`, `timeline`, `rollback`, `pin`, `listPins`, `diff`, plus `activeId` (thin wrapper over `active()` returning the id for the current-marker and D3). `fork` gains an optional snapshot-id parameter (engine already accepts one — research.md fact 2); the existing fork→install launcher flow is reused unchanged for "make this version its own app," including its naming and `forkedFrom` handling. Fork data semantics stay D8/#43b (own, fresh storage).

**D7 — Screen structure mirrors `SettingsScreen`**: new `Screen` union variant `{kind: 'history', app: InstalledApp}` in `LauncherRoot`, entry via a History row in `HomeScreen`'s long-press sheet. `FlatList` of rows: envelope-rendered prompt text, relative timestamp, current-version marker (derived from `activeId()` on load and after every restore), pin badge with label, data annotation line when present. Row tap = instant restore (D1); a per-row overflow affordance opens a small sheet: "Pin this version…" (label input via the existing Modal idiom) and "Make this version its own app." Since History is only reachable from the home action sheet, the app itself is never running during a restore — no live-realm interaction to design for.

**D8 — Pin labels: one label, one version.** Re-pinning an existing label moves it (last write wins), matching the engine's tag-based pin storage; the UI shows the label on its current version only. If the engine turns out to error on re-pin instead, the wrapper normalizes to move semantics (verified at implementation, noted in tasks).

## Risks / Trade-offs

- [`timeline()` cost grows with tag count] → capped at `historyLimit`; ancestry walks bounded by line depth; #39 budget generous at Tier-0 sizes; measured in the on-device acceptance pass.
- [Instant restore surprises a user who tapped exploratively] → undo toast (D3) + non-destructive store make every restore reversible in one tap; roll-forward (D2) guarantees nothing is ever out of reach.
- [Per-row diff walks jank the list on old devices] → lazy + memoized (D5); annotation renders async after the row's static content.
- [New copy trips the product-verbs guard] → all strings enter through `COPY`; the guard runs in `launcher:test` (blocking CI); "version" verified off the denylist (research.md).
- [Envelope defined before its writers exist (#7/#11)] → deliberately minimal (`v` + `text`), defensive rendering means a wrong guess degrades to showing raw text, never breakage; roadmap contract note binds future writers.

## Migration Plan

Purely additive: one new store verb, new launcher screen and wrappers, new copy. No data-format, on-disk, or existing-verb changes; no migration. Rollback strategy = revert the change's commits.

## Open Questions

- None blocking. D8's engine re-pin behavior is verified (and if needed normalized) at implementation time; the install-row copy string is finalized against the guard during implementation.
