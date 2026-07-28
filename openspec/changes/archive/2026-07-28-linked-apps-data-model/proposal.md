# Proposal: linked-apps-data-model

## Why

The owner explore session (2026-07-18, recorded in `docs/v1-roadmap.md` Open deltas) settled a product model the current architecture forbids: an app created by rewinding and re-prompting — and, on request, an explicitly forked app — should **continue using the original's user data** rather than starting empty. Today the engine appId is hard-wired to the launcher id (`store-access.ts:70-72`, decision #43b D8), so every new entry gets a fresh database by construction. For the target user (a non-developer iterating on their own app), a "try that change differently" flow that silently abandons their logged data is wrong; sharing must become a first-class, host-mediated choice.

The terrain makes this cheap (research.md): the appId binding is a single host-side function at one choke point, the fail-closed schema-collision guard already exists (`diffSchemas` conflict detection surfacing as a structured pre-delivery launch failure), and the refcount pattern needed for safe deletion already exists for the version-store repo. Nothing in the syscall surface changes.

## What Changes

- **Storage groups**: an `InstalledApp` gains an optional storage-group field (parallel to `storeId` for the repo); `StoreAccess.engineAppId` resolves through it. Apps in one group share one database file. The bundle-facing surface is untouched — the appId remains host-injected at realm bind, and no syscall gains any addressing (**zero transport/dispatcher diff**).
- **Share-vs-fresh at fork time**: the explicit Fork action asks one plain question — share the original's saved data, or start fresh — and threads the answer to `StoreAccess.fork` (new optional parameter). Fresh keeps today's behavior exactly.
- **Rewind-continuation default** (**BREAKING** — supersedes decision #43b D8's "a fork always gets its own user data"): an app created by continuing from a restored version SHALL share the original's storage group by default, with no question asked. The triggering surface (rewind + new prompt) ships with prompt-flow (#7); this change lands the machinery and the default's contract at the `StoreAccess` seam.
- **Refcounted storage deletion**: `StoreAccess.remove` deletes the shared database file only when the storage group's refcount reaches zero, mirroring the existing `AppIndex.refCount(storeId)` pattern; the index entry itself is always removed.
- **Collision guard, formalized not built**: two apps on one database evolving schemas independently reuse the existing accumulated-union machinery — a conflicting artifact (same burned field ID, different type/meaning) already fails closed at `engine.open` before the bundle runs; this change adds the shared-storage scenarios to the spec and test surface rather than new detection code.
- **Generation contract note for #11**: field-ID allocation is artifact-author-side (research.md, fact 4/5), so for any app in a shared group the generation harness MUST take the live accumulated `_meta` union as `appliedSchema` and allocate new IDs past it. Post-split same-named fields in divergent code lines are *allowed to diverge* (owner decision) — no cross-app field reconciliation.

**Out of scope**: database clone / unlink-later (post-v1, per owner); any change to storage-engine code, syscall surface, transport, or dispatcher; cross-app field reconciliation; concurrent multi-realm access (the one-WebView-one-realm-one-app invariant stands); the rewind-prompt UI itself (#7).

## Capabilities

### New Capabilities
- `linked-apps`: storage groups — membership, host-side appId resolution, share-vs-fresh choice semantics, rewind-continuation default, refcounted deletion, fail-closed schema-collision behavior on shared databases, divergence-is-allowed rule.

### Modified Capabilities
- `mini-app-storage`: Requirement "Each mini-app's data is physically isolated in its own store" is redefined — the isolation unit becomes the **storage group** (default: one app per group, preserving today's behavior); the no-per-call-addressing and construction-time-binding clauses are unchanged.
- `app-launcher`: the Fork action gains the share-vs-fresh question; app deletion's storage teardown becomes refcount-gated.

## Impact

- **Launcher** (`src/host/launcher/`): `app-index.ts` (new optional field + group refcount), `store-access.ts` (`engineAppId` branch, `fork` parameter, refcounted `remove`), `HomeScreen.tsx`/`LauncherRoot.tsx` (fork question UI), `copy.ts` (new strings through the product-verbs guard); `npm run launcher:test` coverage.
- **Storage engine, bridge, runtime, SDK**: no code changes. `launchApp`/`engine.open` already provide the fail-closed collision path; new tests exercise it under sharing.
- **Docs**: decision-log entry recording the #43b D8 supersession (reversal recorded loudly, not overwritten); `docs/v1-roadmap.md` Open-deltas entry updated to proposed; contract note binding #11's `appliedSchema` sourcing.
- **Sequencing**: after `version-history-ux` (shares `store-access.ts`/launcher files); before #7 wires the rewind-prompt flow.
