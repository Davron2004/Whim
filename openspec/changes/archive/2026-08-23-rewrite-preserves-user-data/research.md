# Research: why does a "Prompt again" rewrite lose the user's data?

Researcher digest, 2026-08-23. Triggered by the demo reshoot: a generated "Habit Tracker" (v1: habits Drink water / Exercise / Read / Sleep 7+ hours, five days of completions) was rewritten with "add a streak counter to each habit" and came back as v2 "Habit Streaks" with three different habits, zero streaks, no history. Storyboard narration for that beat: "Same app. New generation. Nothing lost."

A second, independent defect from the same session: a different v1 instance could not record a single check-off — `Could not check: Value for "date" in "Completions" is invalid: expected an epoch-millisecond integer`. Generation, check, run and repair all passed it.

## Relevant files

- `server/src/generation/prompts/index.ts` — every model turn's message text; `requestEditSection` / `buildGenerateMessages` are the smoking gun
- `server/src/generation/machine.ts` — `schemaContextFor` (L254-258) renders the applied schema into the prompt
- `server/src/generation/index.ts` — composition root; `preflightSource` applied to `request.app.source` (L144-146)
- `src/host/launcher/generation-request.ts` — builds `GenerateRequest.app` on the device
- `src/host/launcher/LauncherRoot.tsx` L742-748 — the one `buildGenerateRequest` call site; sends `building.rewritten` as `prompt`
- `src/host/launcher/build-lifecycle.ts` L174-208 — `deliverResult` routing (install / update / behind-tip fork)
- `src/host/launcher/store-access.ts` — `engineAppId` (L93), `update` (L138-158), `fork` (L239-265)
- `src/host/storage-engine/schema.ts` — `diffSchemas`, `burnedIdFloor`, `AppliedSchema`
- `checks/passes/schema-check.ts` — the only schema gate on a candidate
- `checks/contract.ts` L85-121 — `DIAGNOSTIC_KINDS` (closed)
- `synthrun/capability.ts`, `synthrun/report.ts` L124-131 — real bridge over a fresh `:memory:` engine; denial→diagnostic filter
- `contract/src/index.ts` L128-149 — `GenerateRequest` / `RewriteRequest`
- `docs/sdk-reference.md` — the SDK doc fed to the model verbatim

## Q1 — What does the server receive about the existing app?

Device side (`generation-request.ts` L40-61): for an edit it sends `app = { source?, manifest, schema, appliedSchema }`. `source` is the genuine `source.ts` artifact via `StoreAccess.activeSource` (omitted, never substituted with bundle text). `appliedSchema` is the LIVE accumulated union read through `peekAppliedSchema({ appId: access.engineAppId(entry) })`. So the wire carries everything needed.

Server side, `buildGenerateMessages` (prompts/index.ts L224-237) assembles the user message from: prompt, clarifications, `requestEditSection`, `planSection`, `schemaContextSection`. **`request.app.source` is never rendered.** `requestEditSection` (L28-39) even says *"the current TypeScript source is included below under 'Current source' — read it before changing anything"* — but the only builder that emits a `Current source:` block is `buildRepairMessages` (L262). The generate turn sees manifest + schema JSON and nothing else. Grep confirms no other render site (`server/src` matches for `Current source` are exactly L32 and L262).

`RewriteRequest` (contract L145-148) is `{ prompt, clarifications? }` only — **the rewrite/plan turn is completely app-blind**, and `REWRITE_SYSTEM` (L96-103) tells the model to write "one clear, specific product description for generating a tiny app". `LauncherRoot` then sends that rewritten text as `GenerateRequest.prompt`.

## Q2 — Is v2 told to keep v1's collection/field names? What happens on a rename?

No. The only storage instruction is `schemaContextFor` (machine.ts L257):
`Applied schema (existing burned field IDs — do not reuse them): {json}`
Read literally it tells the model not to reuse `c1`/`f1`. Nothing says "the same concept must keep its burned ID; the user's rows live under it". `AppliedSchema` carries ids+types only, no display names (schema.ts L34-49), so id→meaning is only inferable from `Current schema:` (the artifact, which does have display names).

Engine behaviour (`diffSchemas`, schema.ts L331-366):
- same collection id `c1`, same field ids/types, new display names → *rename*, zero DDL, old rows served under the new names (L263-269).
- same `c1`, existing field id with a **different type** → `type_change` conflict → check stage repairs it.
- **new collection id `c2`** → `planNewCollection` → `CREATE TABLE c2`, empty. Old `c1` table and every row stay physically intact but are unreachable from v2's code. **Orphaned, never deleted.** No check flags it: `allocationFloorDiagnostics` skips collections absent from the applied schema (schema-check.ts L77), and `diffSchemas` classifies it as plain `additive`.
- new field id ≤ the collection's floor within an existing `c1` → `id_below_floor` (schema-check.ts L43-61). The only "re-minting identities" guard, and it only exists *inside* a matched collection.

So the user's week of check-offs is almost certainly still in SQLite under `c1`; v2 reads `c2`.

## Q3 — Does a rewrite keep the storage-engine appId?

Yes. `deliverResult` at-tip calls `access.update(editing, …)`; `update` (store-access.ts L155) does `{ ...entry, record: spec.record }` — `id` and `storageGroupId` survive, so `engineAppId(entry)` (L93) is unchanged. The behind-tip path forks with `{ shareData: true }` (build-lifecycle L206), copying `entry.storageGroupId ?? entry.id` (store-access L261) → same engine appId. `deleteStorage` is only reachable from `remove()` (L276-287). The "wholesale record replace" note applies to `AppRecord` fields (why `manifest.tileColor` is explicitly passed back at L202), not to the appId. Contrast #43b: a *user-initiated* fork without `shareData` gets its own appId — not this path.

## Q4 — Do generated apps seed defaults in code?

Not verifiable from the repo (v2's source is on the device). No fixture seeds data — `fixtures/water-counter.app.tsx` reads storage on mount and shows 0 when empty. But nothing in the prompts, the checker, or the run harness forbids a hardcoded default list, and the plan turn asks for `"state"` in the model's own words. The run gate cannot notice: `synthrun/capability.ts` L87 builds a **fresh `:memory:` engine per run**, so a candidate is only ever exercised against an empty database.

## Q5 — Is there a spec/test for "a rewrite preserves user data"?

No. Closest: `storage-schema-evolution/spec.md` — "A rename serves existing data unchanged" (L10), "Rollback and roll-forward never lose data" (L38-45) — engine level only. `generation-pipeline/spec.md` L390-407 only requires the burned-ID **floor** to reach the model. `prompt-flow/spec.md` says nothing about rewrite carrying app context. `app-launcher/spec.md` L69 asserts a fork keeps its user data, nothing about a rebuild.

Where tests belong:
- prompt-turn assertions (source + identity-continuity instructions reach the generate prompt) → `server/test/prompts.suite.ts` (`npm run server:test`). Today `buildGenerateMessages` is only tested with `NEW_APP_REQUEST` (L223); `EDIT_REQUEST` (L184-187) is used for plan and repair only — the edit path's prompt is untested.
- schema-identity-continuity diagnostic → `checks/test/acceptance.ts` + a new kind in `checks/contract.ts` `DIAGNOSTIC_KINDS`.
- appId/engine continuity across an update → partially covered in `src/host/launcher/test/store-access.suite.ts` / `build-lifecycle.suite.ts`.
- rows survive an artifact whose collection ids changed → `src/host/storage-engine/test/acceptance.ts`.

## Q6 — Does check/run exercise user interaction? Why wasn't the bad `date` write caught?

It does interact: `synthrun/sweep.ts` presses buttons/switches/checkboxes and types canonical values per screen, over the real production gate/dispatcher/registry and a real (ephemeral) storage engine. A rejected syscall is captured host-side even when the candidate swallows the promise (`capability.ts` L105-129 pushes a `denial` entry with the engine's `err.kind`).

The gap is `synthrun/report.ts` L126-131:
```
for (const entry of wiring.trace) {
  if (entry.kind !== 'denial') continue;
  if (!CLOSED_KINDS.includes(entry.errorKind)) continue; // closed vocabulary — never minted
```
`CLOSED_KINDS` is `checks/contract.ts`'s `DIAGNOSTIC_KINDS`, which imports the storage engine's *artifact/diff* kinds but **none of its verb-time kinds**. `StorageErrorKind` (`src/host/storage-engine/contract.ts` L162-170) verb-time members — `unknown_collection`, `unknown_field`, `unknown_record`, `type_mismatch`, `unqueryable_field`, `kv_too_large`, `not_open`, `corrupt_storage` — are all absent. A non-integer into a `date` field yields `type_mismatch` (marshal.ts L33-35), silently dropped from the run report. Run comes back green, pipeline delivers.

Compounding: `docs/sdk-reference.md` mentions `schema` twice (L19, L187) and **never documents `SchemaArtifact`, the six field types, burned IDs, or that `date` means epoch-ms**. The only place the model learns the schema shape is the water-counter few-shot. L145 shows `Chart`'s `DayPoint` as `date: string /* YYYY-MM-DD */` — a plausible source of the string-into-`date` confusion.

## Root-cause hypothesis, ranked

1. **The rewrite is a from-scratch regeneration, by two independent mechanisms.** (a) The generate prompt drops `app.source` entirely while claiming to include it; (b) the rewrite turn never sees the app at all, so "add a streak counter to each habit" is expanded into a standalone product description that becomes the whole build prompt. Given both, the model invents an app — new name, new habits, new schema.
2. **The schema instruction points the wrong way** — "do not reuse them" with no counter-instruction to preserve identity; `diffSchemas` accepts a fresh `c2` as additive and `schema-check.ts` has no rule against abandoning a collection, so old rows are orphaned.
3. Hardcoded seed habits in v2 — plausible, unverified, at most the visible surface of 1–2.

Independent: the `date` bug — `report.ts` L128 filters verb-time storage denials because they are not in `DIAGNOSTIC_KINDS`.

Minimal fix surface per hypothesis:
1. `server/src/generation/prompts/index.ts` (`buildGenerateMessages` / `requestEditSection`) + `server/test/prompts.suite.ts`; spec: `generation-pipeline`.
2. `contract/src/index.ts` (`RewriteRequest`), `server/src/routes/rewrite.ts`, `REWRITE_SYSTEM`, `src/host/launcher/prompt-flow.ts` + `generation-client.ts`; specs: `generation-contract`, `prompt-flow`.
3. `server/src/generation/machine.ts` (`schemaContextFor`) and a new identity-continuity pass in `checks/passes/schema-check.ts` + kind in `checks/contract.ts`; specs: `generation-pipeline`, `storage-schema-evolution`.
4. `synthrun/report.ts` L124-131 + `checks/contract.ts` `DIAGNOSTIC_KINDS`; specs: `synthetic-run`, `harness-diagnostics`.
5. `docs/sdk-reference.md` schema-artifact section — gated by the existing "every SDK export is documented" tripwire in `server/test/prompts.suite.ts`.

## Risks and unknowns

- Delivered v2 source not read; a device-side dump of v1/v2 `schema.json` + the SQLite tables is the discriminating measurement (in progress separately).
- Not verified at runtime that a storage `type_mismatch` reaches `sysret.error.kind` through the bridge dispatcher (shape read, not executed).
- Not checked whether in-flight `openspec/changes/server-connectivity` touches the rewrite request shape.

## Open questions for the planner

1. Identity continuity as a hard check (new error diagnostic feeding repair) or only a prompt instruction? → Decision: both; the prompt is advisory, the check is the guarantee.
2. Should `RewriteRequest` gain app context, or should the edit flow skip the rewrite turn and send the user's verbatim prompt? → Decision: gain context; the rewrite turn stays (it still resolves ambiguity) but is told it is describing a *change to an existing app* and must keep its name and concepts.
3. Should the synthetic run exercise a candidate against a pre-seeded engine derived from the applied schema? → Out of scope here; noted as follow-up.

## Device measurement (2026-08-23, after the digest above)

The real lineage `app-mt62laeg-zjf9oghq` was dumped on-device. It **falsifies hypothesis 2's
orphaned-collection story and confirms hypothesis 1**:

- Same `appId`, same storage group, same collection `c1`, additive schema (`+f2`). No orphaned
  collection, no re-minted ids, nothing for `diffSchemas` or `schema-check.ts` to object to.
- v1's source declared `c1` in `schema.json` but **never wrote a row**. All state was one kv blob:
  `storage.kv.get/set('habitCompletionHistory')` holding `{ [date]: habitId[] }`, with `HABITS`
  hardcoded as `water / exercise / read / sleep`.
- v2's source **never touches kv**. It uses `storage.records.list/append('Completions')`
  exclusively, `HABITS` became `water / read / run`, and the app name became "Habit Streaks".

So the loss is a **storage-surface change in code** — the set of kv keys and record collections the
source actually reads — which is invisible to schema diffing by construction: both artifacts are
schema-legal and the diff is additive. `schema_identity_drift` (open question 1) remains worth
having as the guard for the id-drift case, but it would **not** have caught this defect.

Consequences folded into the plan: a second static pass (`storage_surface_drift`) comparing the
candidate's statically-collected storage surface against the previous source's, one shared scanner
feeding both that check and the generate turn's instruction, and confirmation that the
"keep the app's name" instruction is load-bearing — the rename was entirely unprompted.
