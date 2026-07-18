# Design: linked-apps-data-model

## Context

Decision #43b D8 wired the storage-engine appId to the launcher id so a fork can never touch the original's data — correct when sharing could only be an accident, wrong now that the owner has made coordinated sharing the product default for rewind continuations. The terrain (research.md) concentrates the change into one seam: `StoreAccess.engineAppId` is the only place the launcher→storage binding is computed; `launchApp` is the only place it is consumed; deletion and refcounting live beside it in `store-access.ts`/`app-index.ts`; and the schema-collision guard this model needs already exists (`diffSchemas` type/tombstone conflicts against `_meta`, surfacing as a structured pre-delivery launch failure). The bundle never sees or chooses an appId (host-injected at realm bind; syscalls carry no addressing), so sharing is invisible to the sandbox and to the capability surface.

Owner decisions being encoded: Door 1 (rewind + new prompt → new app) shares by default, silently; Door 2 (explicit Fork) asks share-vs-fresh at fork time; post-split same-named fields in divergent lines may diverge (no reconciliation); residual ID collisions fail closed; clone/unlink is post-v1.

## Goals / Non-Goals

**Goals**
- Storage groups: N launcher entries → 1 database file, host-mediated, default group size 1.
- Share-vs-fresh question in the explicit fork flow; shared-by-default seam for rewind continuations (#7 wires the trigger).
- Refcounted storage deletion; zero data loss when one member of a group is deleted.
- Spec + tests formalizing fail-closed collision behavior on shared databases.
- The #11 contract: accumulated-union `appliedSchema`, IDs allocated past it.

**Non-Goals**
- DB clone / unlink-later (post-v1). No storage-engine, bridge, transport, or dispatcher code changes. No cross-app field reconciliation. No concurrent realm access (one-WebView-one-realm invariant stands). No rewind-prompt UI (that's #7).

## Decisions

**D1 — Storage group id = the founding entry's launcher id, carried in a new optional `InstalledApp.storageGroupId`.** `engineAppId(entry)` becomes `entry.storageGroupId ?? entry.id` — exactly the `(a.storeId ?? a.id)` idiom `AppIndex.refCount` already uses for repos (research.md fact 2), so both shared resources resolve and refcount the same way. Absent field = own database = today's behavior; existing installs need no migration. Alternative (a separate group registry) rejected: a second store to keep consistent, for no added power at v1 group sizes.

**D2 — Sharing is decided at creation time only.** `StoreAccess.fork(entry, {shareData?: boolean})`: when true, the new entry copies `storageGroupId ?? id` from its parent; when false/absent, it gets none. No API exists to change membership later (clone/unlink is post-v1) — this keeps group membership immutable and the refcount trivially correct. The rewind-continuation path (#7) calls the same parameter with `shareData: true`.

**D3 — Refcounted deletion mirrors the repo pattern in the same function.** `AppIndex` gains `storageRefCount(groupId)` counting entries whose `(a.storageGroupId ?? a.id) === groupId`; `StoreAccess.remove` calls `deleteStorage(engineAppId(entry))` only when that count reaches zero after the index removal. The index entry is always removed regardless. Deleting the founding app while a sharer lives keeps the file (still named after the founder's id — a name, not a liveness claim; the group id persists in the sharer's `storageGroupId`).

**D4 — Fork question is one sheet, asked only when it matters.** After Fork is tapped, a two-option sheet: "Use the same saved data" / "Start fresh" (copy through `COPY`, guard-vetted; no "clone"/"link" vocabulary). Shown only for explicit forks — rewind continuations never ask (owner decision). Alternative (a toggle buried in settings) rejected by owner: ask at the moment of intent.

**D5 — Collision behavior is specced and tested, not rebuilt.** A shared-group member launching with a schema artifact that conflicts with the accumulated `_meta` (same burned ID, different type/meaning) already aborts pre-delivery via `engine.open` → structured `StorageEngineError` (research.md fact 4/5). This change adds: (a) spec scenarios naming the shared-storage case; (b) launcher-side handling that surfaces the existing structured error as product copy (the app fails to open with an honest message) rather than a crash; (c) acceptance tests building two artifacts that collide and proving fail-closed behavior. No new detection code.

**D6 — The #11 allocation contract (recorded, not implemented here).** For any app whose entry carries a `storageGroupId`, generation MUST source `appliedSchema` from the live engine's accumulated `_meta` union (not the app's own snapshot artifact) and allocate new burned IDs past the union's max. Divergent same-named fields across lines are permitted and remain distinct fields. Recorded as a roadmap contract note on this change; enforced when #11 is proposed. Rationale over UUID field IDs (owner-ratified): allocation is artifact-author-side and serialized through one device, so monotone-past-union is collision-free in practice; the D5 guard catches the residual; UUIDs would rework a settled engine scheme (#38/#40) for insurance v1 doesn't need — noted as the escape hatch if generation ever becomes concurrent.

**D7 — Serialized DB handle lifecycle is asserted, not assumed.** Only one realm lives at a time and `bind()` closes the previous engine before opening the next (research.md, Risks). Because two entries in a group now reopen the *same file* across a bind cycle, the launcher acceptance suite gains a close-then-reopen-same-file test (write as A, switch to sharer B, read as B) to pin the op-sqlite handle lifecycle the model depends on.

## Risks / Trade-offs

- [Cross-write pollution: a sharer's rows appear in the original's lists] → accepted owner trade-off — that *is* the continuation behavior; divergent post-split fields stay invisible to the line that lacks them (additive-only guarantees no destruction).
- [Residual burned-ID collision between divergent lines] → fail-closed at launch via existing guard (D5); honest product-copy error; repair path is a new generation, never silent corruption.
- [Refcount drift between index and disk] → group membership is immutable after creation (D2) and refcount is derived by counting the index (never stored), so there is no stored counter to drift; the D3 test suite covers founder-first and sharer-first deletion orders.
- [op-sqlite residual file lock across close/reopen] → D7 acceptance test pins it; if a lock surfaces, the fix is sequencing in `bind()` (host-side), not model change.
- [Spec relaxation weakens the isolation story] → the `mini-app-storage` delta redefines the unit (storage group, default size 1) while keeping construction-time binding and no-per-call-addressing verbatim — cross-group isolation is exactly as strong as before, and sharing requires an explicit host-side act recorded in the index.

## Migration Plan

Additive + one default-preserving redefinition: existing entries have no `storageGroupId` and behave byte-identically (own file, unconditional-in-effect delete since their refcount is 1). No data migration. Rollback = revert commits; entries created with sharing would need manual deletion if reverted mid-flight (acceptable pre-#7, when only explicit forks can create them).

## Open Questions

- None blocking. The exact fork-question copy is finalized against the product-verbs guard at implementation; D7's lock behavior is settled empirically by its test.
