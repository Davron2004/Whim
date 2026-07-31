# Contract: device seam (chain-3)

Everything the device supplies to the generation pipeline: the pure floor helper + the
side-effect-free applied-schema read in the storage engine, the `source.ts` snapshot artifact,
and the one request builder that consumes both. All under `src/host/**`.

## 1. `burnedIdFloor` — `src/host/storage-engine/schema.ts`

```ts
export function burnedIdFloor(applied: AppliedSchema): Record<string, number>
```

- Per-collection max ordinal across a collection's `active` **and** `retired` columns (a
  tombstoned ID stays burned). Keyed by collection burned ID (e.g. `c1`); a collection absent
  from `applied` has no key in the result — an unconstrained first allocation.
- Pure, dependency-free — imports nothing but `./contract`'s `AppliedSchema`/types. Import it
  from `./schema` directly, **never** the `../index` barrel (barrel statically `require()`s
  op-sqlite; breaks esbuild-bundled Node suites).

## 2. `readAppliedSchema` — `src/host/storage-engine/engine.ts`

```ts
export function readAppliedSchema(executor: SqlExecutor): AppliedSchema
```

- One passive `SELECT` against `_meta`; **never** DDL, **never** applies an artifact. Falls back
  to `emptyApplied()` when the row is absent OR `_meta` itself doesn't exist yet (throw
  swallowed). `engine.ts` imports no native binding — importable exactly like `burnedIdFloor`.
- The executor's own construction (and whatever filesystem side effect that had) is the
  **caller's** concern, not this function's.

### File-aware wrappers (existence-checked before any connection)

- Node/test: `readAppliedSchemaFromFile(filename): AppliedSchema` —
  `src/host/storage-engine/bindings/node-sqlite.ts`. Checks `fs.existsSync` FIRST (a
  `DatabaseSync` connection creates the file the instant it opens, even before any statement) —
  never creates a file for a never-created database.
- Device: `readAppliedSchemaFromDevice(opts: {appId: string}): AppliedSchema` —
  `bindings/op-sqlite.ts`. Same functional guarantees (no DDL, no artifact applied,
  `emptyApplied()` fallback); op-sqlite exposes no existence check, so — unlike the Node path —
  connecting to a brand-new app id MAY create an empty file as a native-library side effect
  (documented, device-only, not exercised by any Node suite).
- Barrel export for device callers: `peekAppliedSchema(opts: {appId: string}): AppliedSchema` —
  `src/host/storage-engine/index.ts` (lazy `require` of the op-sqlite binding, same discipline
  as `createStorageEngine`/`deleteStorage`).

## 3. `source.ts` snapshot artifact — `src/host/launcher/store-access.ts`

- `InstallSpec`/`UpdateSpec` gain `source?: string` — the original TypeScript, written as its
  own `source.ts` snapshot file alongside `bundle.js` (and `schema.json` when present). Absent
  is legitimate (first-run seed examples have no original source to track) — never a fallback.
- `activeSource(entry): Promise<string | undefined>` now reads the genuine `source.ts` artifact
  (never `activeBundle`'s `bundle.js`) and returns `undefined`, honestly, when the active
  snapshot predates source tracking — it does not throw and does not alias the bundle.

## 4. `buildGenerateRequest` — `src/host/launcher/generation-request.ts` (new file)

```ts
export type AppliedSchemaReader = (appId: string) => AppliedSchema;

export async function buildGenerateRequest(
  access: StoreAccess,
  readApplied: AppliedSchemaReader,
  editing: InstalledApp | undefined,
  prompt: string,
): Promise<GenerateRequest>
```

- Extracted out of `LauncherRoot.tsx` (which cannot be imported under Node — it pulls
  `react-native`) so the logic is directly Node-testable, mirroring `history-logic.ts`'s split.
- `editing` absent → `{ prompt }`, no `app` key at all (unchanged).
- `editing` present:
  - `app.source` included **only** when `access.activeSource(editing)` returns a value; the key
    is omitted entirely (not sent as `undefined`) for a legacy entry.
  - `app.schema` is still `editing.record.schemaArtifact ?? {}` (unchanged) — the entry's own
    declared schema.
  - `app.appliedSchema` is **always** `readApplied(access.engineAppId(editing))` — the storage
    group's LIVE accumulated union — **never** `entry.record.schemaArtifact`. For a grouped
    entry these differ by construction (union carries every member's fields).
- `LauncherRoot.tsx` wires the device reader as
  `(appId) => peekAppliedSchema({ appId })` from `../storage-engine`.
- `deliverResult` in `LauncherRoot.tsx` now passes `source: wire.source` (the `WireAppRecord`'s
  required `source` field) into every `install`/`update` call.

## Tests added

- `storage:test` (`src/host/storage-engine/test/acceptance.ts`, §G): `burnedIdFloor` retired-vs-
  active floor, unknown-collection no-floor, no-native-binding importability; `readAppliedSchema`
  retired-columns-in-union, side-effect-free (byte-identical file, single SELECT, zero DDL),
  never-created-database reads empty with no file created, missing-`_meta`-table reads empty.
- `launcher:test` (`src/host/launcher/test/generation-request.suite.ts`, registered in
  `acceptance.ts`): new-app ships no `app`; legacy entry omits `source`; non-legacy entry ships
  real `source.ts`; a grouped entry's `appliedSchema` is the whole live union (both members'
  fields), never the entry's own `record.schemaArtifact`; a fresh share-data fork inherits the
  founder's union before writing anything itself; no-live-db-yet reads the empty applied schema.
- `store-access.suite.ts` §36/§36b updated for `activeSource`'s new real (non-aliasing)
  semantics.
