# Research digest: storage-engine + version-store semantics (ST-4, ST-6) reconciliation post-Sonar-sweep

Researcher subagent digest, saved verbatim 2026-07-02. Question: reconcile critic findings ST-4/ST-6 (openspec/critic/2026-07-02-product-sweep.md) against HEAD after the dev/v1→main merge + Sonar sweep, and gather design facts for a storage/version-store semantics proposal.

## Relevant files
- `src/host/storage-engine/engine.ts` — `compileWhere`, `isRangeFilter` (ST-4)
- `src/host/storage-engine/contract.ts` — filter grammar types, `StorageError`/`StorageEngineError` (ST-4)
- `src/host/storage-engine/marshal.ts` — `checkValue` (evidence of Sonar-sweep touch, see below)
- `src/host/storage-engine/test/acceptance.ts` — storage acceptance suite
- `src/host/version-store/engine.ts` — `rollback()`, `fork()`, `switchLineage()`, error style (ST-6)
- `node_modules/isomorphic-git/index.d.ts:1875-1883` — `isDescendent` signature
- `openspec/specs/mini-app-storage/spec.md` — filter grammar requirement (line 48-54)
- `openspec/specs/mini-app-versioning/spec.md` — rollback requirement (line 17)
- `openspec/specs/mini-app-forking/spec.md` — fork/lineage requirements

## ITEM ST-4 — where-filter grammar ambiguity — STILL ALIVE, verbatim (line numbers shifted ~2-10 lines from the critic's quote, logic identical)

`src/host/storage-engine/engine.ts:316-319`:

    function isRangeFilter(cond: unknown): cond is RangeFilter {
      if (typeof cond !== 'object' || cond === null || Array.isArray(cond)) return false;
      return ['gt', 'gte', 'lt', 'lte'].some(k => k in (cond as object));
    }

`compileWhere` at `engine.ts:252-275` — unchanged branch structure: `isRangeFilter(cond)` gate first, else `cond === null` → `IS NULL`, else plain equality. No `json`-type special-case anywhere in this function.

Grammar at `src/host/storage-engine/contract.ts:78-87`:

    export interface RangeFilter { gt?: JsonValue; gte?: JsonValue; lt?: JsonValue; lte?: JsonValue; }
    export type WhereClause = { [displayField: string]: JsonValue | RangeFilter };

**No `where`-on-json-field usage anywhere in the repo**: no fixture in `fixtures/*.app.tsx` matches `json` (grep zero hits), the storage acceptance suite never filters a `json`-typed field (its `where` scenarios use `spentAt`/`body`/`n`, all text/date/int — lines 154, 494, 554), and `openspec/specs/mini-app-storage/spec.md` has zero occurrences of "json" (grepped, no matches). The `mini-app-storage` spec's only filter requirement is `spec.md:48-54` ("Reads can be filtered, ordered, and bounded host-side" — "`where` (per-field equality or range `gt/gte/lt/lte`, AND-composed)") — silent on json fields, confirming the critic's "spec drift — never covers a json-typed field" claim.

**Structured refusal house style** (`contract.ts:147-188`):

    export type StorageErrorKind = ... | 'unknown_field' | 'type_mismatch' | 'kv_too_large' | 'not_open' | 'corrupt_storage';
    export interface StorageError { kind: StorageErrorKind; collection?: string; field?: string; hint: string; }
    export class StorageEngineError extends Error { readonly detail: StorageError; ... }
    export function storageError(detail: StorageError): StorageEngineError { return new StorageEngineError(detail); }

Examples (engine.ts:238, 246): `storageError({ kind: 'unknown_field', collection: collName, field: name, hint: 'No field named "${name}" in "${collName}"; declare it in the schema.' })`; `storageError({ kind: 'type_mismatch', ..., hint: 'Value for "${fieldName}" in "${collName}" is invalid: ${reason}.' })`. A new `json`-where refusal kind would slot into the same closed `StorageErrorKind` union with a `collection`/`field`/`hint` shape.

**Sonar-sweep touch note**: `marshal.ts:50` now reads `if (value === undefined) return 'value is undefined; use null for "no value"';` — this is exactly ST-1's fix, confirming the sweep DID touch `marshal.ts`. It did NOT touch `engine.ts`'s `isRangeFilter`/`compileWhere` shape — structurally identical to the critic's quote.

## ITEM ST-6 — rollback lacks lineage-reachability check — STILL ALIVE, verbatim (shifted engine.ts:283-290 → 286-293)

`src/host/version-store/engine.ts:285-293`:

    /** rollback(appId, snapshotId) → move lineage ref + checkout; non-destructive (task 3.4). */
    async rollback(appId: string, snapshotId: string): Promise<{ activeId: string }> {
      const { dir, gitdir } = this.paths(appId);
      const oid = await this.resolveSnap(gitdir, snapshotId);
      const branch = (await git.currentBranch({ fs: this.client, gitdir, fullname: false })) || 'main';
      await git.writeRef({ fs: this.client, gitdir, ref: `refs/heads/${branch}`, value: oid, force: true });
      await git.checkout({ fs: this.client, dir, gitdir, ref: branch, force: true });
      return { activeId: snapshotId };
    }

No ancestry/reachability check before `writeRef` — confirmed identical to critic's finding.

`isDescendent` **is available** in the vendored isomorphic-git (`node_modules/isomorphic-git/index.d.ts:1875-1883`): `export function isDescendent({ fs, dir, gitdir, oid, ancestor, depth, cache }): Promise<boolean>` and is exported at `index.js` (via `index.d.ts:661`). **No existing use** of `isDescendent`/`isAncestor` anywhere in `src/host/version-store` (grep zero hits) — `compaction.ts`'s "reachable" logic is an unrelated from-scratch object-graph walk (`collectReachable`, `compaction.ts:40-67`), not an ancestry test between two oids.

**Error surface**: no structured error class — every version-store error is a bare `throw new Error(msg)`. Examples: `engine.ts:147` `throw new Error(\`unknown snapshot: ${snapshotId}\`)`; `engine.ts:99` `throw new Error(\`invalid app id: ${appId}\`)`; `engine.ts:299` `throw new Error(\`invalid pin label: ${label}\`)`. This is a materially different (unstructured) house style vs. storage-engine's `StorageEngineError{kind,hint}` — a new lineage-reachability refusal would either follow this plain-`Error` convention or introduce structure where none exists today.

**Spec text**: `openspec/specs/mini-app-versioning/spec.md:17`: "The user SHALL be able to roll back a mini-app to any previous snapshot, and rolling back MUST NOT destroy later snapshots — they remain recoverable." No lineage-scope qualifier — matches critic's "ambiguous about lineage scope" claim. Fork/independence requirements in `openspec/specs/mini-app-forking/spec.md:8` ("fork...into a new, independent lineage...MUST NOT affect the original") and `:17` ("forks as permanently independent lineages...No operation...MUST ever require merging").

**Fork/switchLineage signatures** (`engine.ts:331`, `:353`):

    async fork(appId: string, snapshotId: string): Promise<{ lineageId: string }>
    async switchLineage(appId: string, lineageId: string): Promise<{ activeId: string | null }>

## Quick reconcile (other escalation items, for the record — out of scope for this change)
- **ST-2** (compaction never packs refs): ALIVE, verbatim. `compaction.ts:69-104` only calls `git.packObjects`/`git.indexPack`/loose-object `unlink` — no ref consolidation. No test asserts ref/tag/KV-key count; acceptance only asserts `looseObjectCount`.
- **SRV-1** (`cancel()` doesn't stop generator): ALIVE, verbatim. `sse.ts:64-66` only clears `keepaliveInterval`; no `AbortSignal` anywhere in `server/src`; `pipeline.ts:7-9` has no abort param.
- **HL-4**: ALIVE but critic's producer-side claim needs correction — `paint` (`loader.js:97`) and `probes` (`loader.js:101`) already carry a `generation` field; the handler (`useMiniAppHost.ts:195-208`) reads it but never compares against the live generation (unlike `nav-depth` at `:183-190`). `ui-event` genuinely has no generation field (producer `src/sdk/index.tsx:163` posts `{ __whimUiEvent: true, type, label }` only).
- **RT-1**: ALIVE, verbatim. `resolver.js:25,45` plain assignments; `probes.js:88-167` module/T3/T5 probes call the live global.

## Sonar-sweep touch summary
- `marshal.ts` — TOUCHED (ST-1's undefined-guard present). Storage `engine.ts` `isRangeFilter`/`compileWhere` — untouched in shape (line drift only). `version-store/engine.ts` `rollback` — untouched. `compaction.ts`, `sse.ts`, `pipeline.ts`, `resolver.js`, `probes.js` — untouched, identical to critic quotes.
