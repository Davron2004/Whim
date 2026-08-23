## Why

A "Prompt again" rewrite of a live app returns a different app. The demo's Habit Tracker came back
as "Habit Streaks" with different habits and no history, and a device dump of the real lineage
(`app-mt62laeg-zjf9oghq`, research.md §Device measurement) shows the storage layer did its job:
same appId, same storage group, same collection `c1`, additive schema. v1 kept everything in one kv
blob (`storage.kv.get/set('habitCompletionHistory')`); v2's source never touches kv. The user's week
of check-offs is still in SQLite — the new code simply never looks there.

Two prompt defects make that the default outcome, not bad luck (research.md §Q1): the generate turn
drops `app.source` entirely while telling the model "the current TypeScript source is included below
under Current source", and the rewrite turn is completely app-blind, so "add a streak counter" is
expanded into a standalone product description that becomes the whole build prompt. Nothing in the
checker or the run harness objects, because both candidates are schema-legal.

A second, independent defect from the same session — a check-off rejected at runtime with
`Value for "date" in "Completions" is invalid: expected an epoch-millisecond integer`, passed by
generation, check, run and repair alike — is the synthetic run dropping every verb-time storage
denial on the floor because those kinds were never added to the closed diagnostic vocabulary
(research.md §Q6).

## What Changes

- The generate turn for an edit renders `Current source:` for real, and carries three continuity
  instructions: keep the app's name unless the user asked to change it; keep the burned collection
  and field ids the existing concepts already have; keep reading and writing the storage locations
  the current source uses — add locations, never replace them.
- `RewriteRequest` gains an optional, deliberately small `app` context (current name plus collection
  and field **display names** — no source, no ids, no rows), and the rewrite system prompt tells the
  model it is describing a change to an existing app. The launcher sends it for a re-prompt.
- A new static check pass rejects an edit candidate whose schema artifact abandons a collection id,
  or an untombstoned field id, that exists in the applied schema (`schema_identity_drift`).
- A new static check pass rejects an edit candidate whose statically-collected storage surface is
  not a superset of the previous source's (`storage_surface_drift`), with a warning kind for
  non-literal keys the harness cannot verify (`storage_surface_dynamic`). The prompt instruction and
  the check read the same scanner — one source of truth.
- The synthetic run stops silently dropping verb-time storage denials: `type_mismatch`,
  `unknown_collection`, `unknown_field`, `unknown_record`, `unqueryable_field` and `kv_too_large`
  become error diagnostics that feed repair. `not_open` and `corrupt_storage` stay out — they are
  host faults, not candidate mistakes — and remain visible in the run trace rather than vanishing.
- `docs/sdk-reference.md` documents the schema artifact (collections, the six field types, burned
  ids, `date` = epoch-millisecond integer) and disambiguates `Chart`'s `DayPoint.date` label string.
- `schemaContextFor` stops telling the model the opposite of what it needs: it names the
  per-collection burned-id floor and instructs the model to **keep** existing ids for existing
  concepts while allocating new ids strictly above the floor.

## Capabilities

### New Capabilities
<!-- none: every behaviour lands inside an existing capability -->

### Modified Capabilities
- `generation-pipeline`: the edit turn renders the current source and the continuity instructions;
  the burned-id context names floors and preserves identity; the SDK reference documents the schema
  artifact.
- `generation-contract`: `RewriteRequest` gains optional app context.
- `prompt-flow`: a re-prompt's rewrite request carries the app being changed.
- `static-checks`: two new passes (schema identity continuity, storage-surface continuity) and the
  matching growth of the closed kind vocabulary.
- `harness-diagnostics`: the closed vocabulary gains the verb-time storage kinds verbatim and
  excludes host-fault kinds by rule.
- `synthetic-run`: verb-time storage denials become candidate diagnostics; host faults never do.
- `storage-schema-evolution`: abandoning a burned identity orphans data — stated, and regression-
  tested, because the whole change rests on it.

## Impact

- Server: `server/src/generation/prompts/index.ts`, `server/src/generation/machine.ts`,
  `server/src/generation/stages/check.ts`, `server/src/routes/rewrite.ts`.
- Checks: `checks/contract.ts` (kind vocabulary), `checks/index.ts`, `checks/storage-surface.ts`
  (new), `checks/passes/schema-check.ts`, `checks/passes/storage-continuity.ts` (new).
- Synthetic run: `synthrun/report.ts`.
- Wire: `contract/src/index.ts` (`RewriteRequest`) — additive and optional, no breaking change.
- Device: `src/host/launcher/generation-request.ts`, `generation-client.ts`, `LauncherRoot.tsx`
  (type-only contract imports only — zod never enters Metro).
- Docs: `docs/sdk-reference.md` (fed to the model verbatim, so this is a behavioural input).
- No UI change, no migration of already-orphaned rows, no engine change.
