# mini-app-storage-engine — Design

## Context

v0.2 was one milestone ("bridge + storage as syscall #1", spec §15.2) until the storage side grew into a real engine: `docs/explorations/storage-engine.md` settled SQLite / one-DB-per-app / schema-declared / verbs-never-SQL, superseding spec §5.6's "schemaless JSON soup" sketch. The work is now split: **this change builds the host-side engine** (the version-store playbook — Node-tested core, on-device acceptance, no bridge/WebView); the follow-up `capability-bridge` change wires it to mini-apps as syscall #1.

Settled inputs consumed here, not re-litigated: #38 (burned field IDs, additive-only evolution, unknown-field retention, transform catalog deferred), #39 (D2 constructor-guard isolation, D7 Node-then-device verification ladder), #33 (code/data split — the version store and this engine never share a substrate or a handle).

## Goals / Non-Goals

**Goals:**

- A per-mini-app SQLite storage engine with the lean verb set (`kv.*`, `records.*`) compiled host-side to parameterized SQL.
- #38 rules 1–3 as code: schema artifact with burned IDs, additive-only static checks, structural unknown-field retention.
- The shared TypeScript contract (verb signatures, schema-artifact types, structured-error shape) the bridge change will implement against verbatim.
- Ephemeral (`:memory:`) mode — Spike 3's test-storage isolation requirement.
- Proven on the real device (D7), with numbers recorded.

**Non-Goals:**

- The bridge (transport/dispatcher/registry/gate), request-ID idempotency, `vc-sdk` stubs, `defineApp({ schema })` wiring — all `capability-bridge`.
- Transform catalog (#38 rule 4), aggregation push-down, cross-app sharing, physical column deletion — deferred; the only obligation here is to not preclude the future audited drop.
- Undo/redo of data mutations (rejected by #38 — data time-travel is not coupled to code rollback).
- Encryption-at-rest, sync, backup — out of scope for the on-device-only product phase.

## Decisions

### D1 — SQLite via a two-binding adapter: op-sqlite on device, `node:sqlite` in tests

The engine core is pure TypeScript speaking to a ~3-method `SqlExecutor` adapter (`execute(sql, params) → rows`, transaction wrapper, close). Device binding: `@op-engineering/op-sqlite` (JSI; same toolchain generation as the MMKV v4 already shipped). Test binding: Node 22's built-in `node:sqlite` — zero new devDependency, real SQLite, so the Node suite exercises real SQL semantics, not a mock.

*Alternatives rejected:* MMKV-KV JSON blobs (blob granularity makes #38 rule 3 unimplementable for records — the exploration note's core argument); WatermelonDB/Realm (framework gravity, own sync/reactivity models — wrong altitude for a syscall backend); reusing the version store's KV-FS (it's a *filesystem for git*, not a queryable record store; #33 wants these separate anyway). *Caveat accepted:* two SQLite builds may drift in version/flags → the engine restricts itself to a boringly conservative SQL subset (no JSON1, no upsert exotica, no partial indexes), and the device run remains the authoritative acceptance (D7).

### D2 — Isolation by construction: one DB file per app, one handle per engine instance

`createStorageEngine({ appId, mode })` resolves to exactly one database file (`storage/<appId>.db`) or `:memory:`, opens it, and returns an instance whose API has **no per-call app addressing** — the #39 D2 constructor-guard pattern. Identity will come from the realm/channel at the bridge layer; nothing in this library can express "another app's data". One DB file per app is also the cleanest physical boundary available (cleaner than key prefixes or named MMKV instances — there is no shared keyspace for a routing bug to leak across).

### D3 — Schema artifact format (settles exploration open questions 1 & 4)

```ts
interface SchemaArtifact {
  schemaVersion: 1;                          // format version of the artifact itself
  collections: {
    [displayName: string]: {
      id: string;                            // burned collection ID, e.g. 'c1' — IS the table name
      fields: {
        [displayName: string]: {
          id: string;                        // burned field ID, e.g. 'f1' — IS the column name
          type: 'text' | 'int' | 'float' | 'bool' | 'date' | 'json';
          default?: JsonValue;               // REQUIRED for fields added after collection creation
        };
      };
      tombstones: string[];                  // retired field IDs — never reusable, data retained
    };
  };
}
```

- **Type set is closed at six:** `text`→TEXT, `int`→INTEGER, `float`→REAL, `bool`→INTEGER 0/1, `date`→INTEGER epoch-ms, `json`→TEXT (serialized) as the one escape hatch for genuinely amorphous values. There is no undifferentiated `number` — a count and a price are different declarations, and offering `number` alongside `int`/`float` would make the prompt-time choice ambiguous. `float` is an 8-byte IEEE-754 double end to end (SQLite REAL has no narrower storage class; JS numbers are doubles anyway — the zero-conversion option). `int` is write-validated to the JS safe-integer range (SQLite INTEGER is i64; past 2^53 a value would silently lose precision crossing back into JS). Day-boundary/timezone semantics are explicitly *not* the engine's problem (the cross-cutting "new day" question belongs to the SDK design, later).
- **`int`→`float` widening is still a type change** and is rejected like any other (#38 rule 1: old code reading `2.5` from a field it wrote whole numbers into is exactly the silent drift the rule prevents). If real demand appears, widening becomes an invertible-ish transform-catalog op (deferred with the rest of rule 4) — not a static-check exception now.
- **Physical names are the burned IDs.** A rename is a display-name key change over the same `id` — zero DDL, zero data movement. Aliases need no separate structure: the current display name *is* the alias, the `id` is the identity.
- The engine stores the last-applied artifact in a `_meta` table inside the DB, making evolution checks self-contained at runtime. (The version store *also* tracks the artifact file across generations — that's for history/rollback per #39 D6, not for the engine's diffing.)

### D4 — Evolution semantics: validate → diff → {no-op | ADD COLUMN | accept-older | reject}

`open(artifact)` diffs the incoming artifact against the applied one and lands in exactly one of four classes: **identical** (no-op); **additive** (new collections/fields → `CREATE TABLE` / `ALTER TABLE ADD COLUMN` with the declared default — the only two DDL forms the engine can emit); **older subset** (the rollback case — accepted with *no DDL*: unaddressed columns simply persist untouched, which is #38 rule 3 made structural); **conflict** (type change on an existing id, id reuse, tombstone violation, new field without default → structured error, open refused). The check logic is exported as a pure function so the future harness can run it as a static check at generation time, before any device is involved.

### D5 — Verb surface and filter line (settles exploration open question 5)

```
kv.get(key) / kv.set(key, value) / kv.remove(key)        — scalars; value ≤ sizeCap (config, default 32 KiB)
records.append(collection, record) → { id }              — engine-assigned integer id
records.list(collection, { where?, orderBy?, limit?, offset? })
records.update(collection, id, patch)                    — patches named fields only
records.remove(collection, id)
```

`where` is `{ field: value | {gt|gte|lt|lte} }`, **AND-composed only**, on declared fields. `orderBy` is one field + direction. No OR, no joins, no aggregates, no expressions — that is the line between "useful filter" and "reinventing a query language"; anything past it is a new decision (aggregation push-down is already named and deferred). The KV size cap exists to make "ledger in a blob" structurally awkward — its error carries the fix hint pointing at `records.append` (the §8.1 diagnostics discipline).

### D5a — Injection defense: values are bound, identifiers are mapped, nothing is interpolated

The engine MUST treat caller-supplied SQL inputs in exactly two ways, never a third:

- **Values** (record field values, `kv` values, `where` comparison values) are *always* SQL bind parameters — never string-built into statement text. A field value of `'); DROP TABLE c1;--` is stored and compared as that literal nine-and-some-character string.
- **Identifiers** (collection names, field names in `where`/`orderBy`) cannot be bind parameters — SQL has no parameter slot for a table or column name. So they are **resolved through the schema**: a caller-supplied display name is looked up in the applied artifact and replaced by its burned ID (`c1`, `f3`), which is the literal physical name. A name that resolves to nothing is a structured `unknown_field`/`unknown_collection` error — it is **never** concatenated into SQL as a fallback. Because burned IDs are engine-minted from a `[a-z][0-9]+` alphabet (D3), even the post-mapping identifier is structurally incapable of carrying metacharacters.

This is the rule that makes the storage syscall safe to expose to hostile, model-written bundles: there is no code path where caller text reaches the SQL string. It is verified by capturing every executed statement in tests (D8) and asserting the statement text is one of the fixed host-authored templates with the dangerous input present only in the bound-parameter array. This property is a never-regress security invariant on par with sandbox containment, and is gated per-push (D8).

### D6 — `records.remove` hard-deletes (settles exploration open question 2)

No engine-level soft delete. Rationale: #38's tombstones protect against *schema* regressions (silent, structural); a runtime `remove` is a deliberate user-facing action the app chose to expose — a different trust category. Engine-level soft delete would tax every `list`, create a hidden second dataset, and duplicate what an app can model explicitly with an `archived` field when archiving *is* the product behavior.

### D7 — Verification ladder, op-sqlite smoke first

Task 1 is a half-day device smoke (open, DDL, insert/select, kill+relaunch, read back) that gates the op-sqlite commitment before anything is built on it — acceptance-level risk, not spike-level (mainstream JSI module vs. isomorphic-git's exotic territory), but the D7 pattern stands: prove it on the device. Then: Node suite (`npm run storage:test`, mirroring `vstore:test`) as the fast checkpoint; an on-device probe screen (the `VersionStoreProbeScreen` pattern, `RUN_STORAGE_PROBE` flag) as the acceptance; numbers into `docs/decisions.md`/`DEVLOG.md`.

The **injection subset of `storage:test` is promoted to a per-push CI gate.** The current `.github/workflows/invariants.yml` runs only `build` + `invariants` (headless Chromium containment); it gains a step running `npm run storage:test`, so the D5a parameterization/identifier-mapping property is a blocking gate alongside sandbox containment — not a file someone remembers to run. The whole `storage:test` suite is cheap (`node:sqlite`, no browser, sub-second), so gating all of it costs nothing and avoids a fragile "just the injection tests" carve-out. The injection cases are authored as their own clearly-labelled block so a reviewer can see the never-regress assertions at a glance, and per §16.4 they are owned as security invariants, not feature tests.

### D8 — The contract file is the inter-change seam

`src/host/storage-engine/contract.ts` exports the verb param/result types, `SchemaArtifact`, and the structured-error shape (`{ kind, collection?, field?, hint }`). The `capability-bridge` change imports these types for its registry rows and `vc-sdk` stubs — the protocol-shaped decisions get made once, here.

## Risks / Trade-offs

- [op-sqlite breaks under RN 0.85 / new arch / Hermes] → task-1 device smoke before the engine is built on it; the `SqlExecutor` adapter makes the binding swappable (`react-native-nitro-sqlite` as named fallback) without touching engine code.
- [`node:sqlite` (tests) vs op-sqlite (device) dialect drift] → conservative SQL subset only; device acceptance is authoritative; any statement form used must appear in both suites.
- [Schema-artifact format churns when the real generation harness arrives] → `schemaVersion` field from day one; validation is a pure, exported function the harness will reuse rather than reimplement.
- [Verb surface creeps toward a query language] → the filter grammar in D5 is closed; extensions require a new decision-log entry, not a quiet PR.
- [Tombstoned columns accumulate forever] → accepted for now (cheap: empty columns cost ~nothing in SQLite); the audited physical drop is deferred by design, and nothing here precludes it — tombstones carry enough identity (`id`, retired-at generation via the version-store-tracked artifact history) for a future drop to establish its safety conditions.
- [Integer record ids leak ordering information to apps] → accepted; ids are documented as opaque references, and unlike git hashes (the no-leak guard's target) an integer id carries no mechanism vocabulary.

## Migration Plan

Greenfield — no existing mini-app user data exists anywhere (v0.1 apps are in-memory only). Nothing to migrate; no consumers until `capability-bridge` lands, so rollback of this change is deleting an unreferenced library. The one forward obligation: the contract file ships here and the bridge change treats it as read-mostly — breaking it after the bridge lands requires touching both.

## Open Questions

- Exact default for the KV size cap (32 KiB is the placeholder; tune when the first real app corpus exercises it).
- Whether the probe screen sits beside `VersionStoreProbeScreen` as a third `App.tsx` flag or the flags consolidate into a tiny probe-picker — implementation detail, decide in task 7.
