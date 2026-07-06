# mini-app-storage-engine — Proposal

## Why

v0.2 (the capability bridge, with storage as syscall #1 per spec §15.2) needs an engine for mini-app user data, and the design position is settled in `docs/explorations/storage-engine.md`: **SQLite, one database file per mini-app, schema-declared storage, product verbs — never SQL**. Building the engine as its own host-side change — before the bridge — follows the proven version-store playbook (Node-tested core + on-device acceptance, zero bridge/WebView dependency), front-loads the only acceptance-level unknown (op-sqlite under RN 0.85 / new arch / Hermes), and gives the upcoming `capability-bridge` change a real first customer implementing against a pinned contract instead of an `echo` stub.

This change realizes decision #38's machinery (burned field IDs, additive-only evolution, unknown-field retention) as code, and records the one reversal it implies: spec §5.6's "schemaless JSON soup" becomes *schema-declared storage with forgiving reads* — which #38 had already half-decided.

## What Changes

- New host-side library `src/host/storage-engine/`: a per-mini-app SQLite store with a factory that constructs one engine instance per app, holding exactly one DB handle (the #39 D2 constructor-guard isolation pattern; no per-call app addressing exists in the API).
- **Schema artifact** format + validation: collections/fields with burned IDs as physical column names, display names as metadata, types from a small closed set, defaults, tombstones. Additive-only diff checks (#38 rules 1–3) with structured, fix-hint-carrying errors.
- **Derived DDL**: the engine compiles schema diffs to `CREATE TABLE` / `ALTER TABLE ADD COLUMN` only. No other DDL form is ever executed; the agent never writes DDL or SQL.
- **Verb set, lean** (compiled host-side to parameterized SQL): `kv.get/set/remove` for small scalars (size-capped, with the error hint pointing at records) + `records.append/list/update/remove` with `{where, orderBy, limit}` filters (equality + range, AND-only).
- **Ephemeral mode**: a `:memory:` store behind the same API — Spike 3's smoke-tests-never-touch-real-data requirement, nearly free.
- **Shared contract file**: the verb signatures + schema-artifact types as TypeScript types, pinned here so the `capability-bridge` change implements against them verbatim.
- Node acceptance suite (`npm run storage:test`, mirroring `vstore:test`) + on-device probe-screen acceptance (D7 pattern), with measured numbers recorded in `docs/decisions.md` / `DEVLOG.md`.
- New decision-log entry recording the §5.6 revision and the engine choice.

**Not in this change** (explicit boundary):

- The bridge itself — transport, dispatcher, capability registry, gate, request-ID idempotency, `vc-sdk` client stubs, and `defineApp({ schema })` wiring all land in the follow-up `capability-bridge` change.
- The invertible transform catalog (#38 rule 4), aggregation push-down (`GROUP BY` verbs), cross-app sharing, and physical column deletion — all deferred per the exploration note; nothing built here may preclude the future audited column drop.

## Capabilities

### New Capabilities

- `mini-app-storage`: per-app isolated SQLite storage exposed through product verbs — KV for scalars, record verbs for collections — with parameterized host-authored SQL, filtered reads, an ephemeral test mode, and cross-restart persistence.
- `storage-schema-evolution`: the declared schema artifact and its evolution rules — burned field IDs as physical keys, additive-only changes enforced by static checks, tombstones, unknown-field retention so rollback/roll-forward never loses data.

### Modified Capabilities

*None.* The version store is content-agnostic by design (#39 D6) — the schema artifact is just another tracked file, no `mini-app-versioning`/`mini-app-forking` requirement changes. The sandbox specs are untouched (no bridge or runtime work in this change).

## Impact

- **New dependency**: `@op-engineering/op-sqlite` (JSI/Nitro-adjacent, same autolinking generation as the MMKV v4 already shipped). An early device smoke gates the commitment; fallback candidate if it fails: `react-native-nitro-sqlite`.
- **Node test backend**: the Node suite runs against `node:sqlite` (built into Node 22) behind a thin `SqlExecutor` adapter, so the engine core stays testable without a device — same adapter seam the device binding implements.
- **New code**: `src/host/storage-engine/` (engine, schema module, adapters, contract types, tests). New npm script `storage:test`. A `RUN_STORAGE_PROBE`-style acceptance screen following the existing `VersionStoreProbeScreen` pattern.
- **CI**: `.github/workflows/invariants.yml` gains a blocking per-push step running `storage:test`, so the SQL-injection / parameterization property (a never-regress security invariant) is gated on every push alongside sandbox containment.
- **Docs**: new numbered entry in `docs/decisions.md`; `docs/explorations/storage-engine.md` is consumed by this change's design.
- **Untouched**: the version store and its MMKV substrate (#33 code/data split keeps the stores separate), the sandbox runtime, the SDK, the build pipeline, the existing isolation invariant suite.
