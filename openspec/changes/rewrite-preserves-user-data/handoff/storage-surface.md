# handoff: storage-surface (chain-1 → chains 2/3/4/5)

Interface only. Source of truth: `checks/storage-surface.ts`, `checks/contract.ts`, `checks/index.ts`.

## Public entry

Both the scanner and its types are re-exported from `checks/index.ts`. Import from there — the
server never reaches into `checks/storage-surface.ts` directly.

```ts
import { scanStorageSurface } from 'checks/index';
import type { StorageSurface, StorageReference, DynamicStorageSite, StorageFacade } from 'checks/index';

export function scanStorageSurface(source: string): StorageSurface;
```

## Types (verbatim)

```ts
/** The two storage facades a location can belong to. Continuity is judged per facade. */
export type StorageFacade = 'kv' | 'records';

/** One storage location the source names with a string literal. */
export interface StorageReference {
  /** The literal kv key or record-collection display name, verbatim. */
  name: string;
  /** The facade method it was passed to, verbatim. METHOD-AGNOSTIC: whatever name follows the
   *  facade is recorded, so today's roster (`kv.get`/`set`/`remove`,
   *  `records.append`/`list`/`update`/`remove`) needs no update here when the SDK grows one. */
  method: string;
  /** 1-based line of the literal in the scanned source. */
  line: number;
  /** 1-based column of the literal in the scanned source. */
  column: number;
}

/** A facade call whose first argument is not a string literal, so the location it names cannot
 *  be established. Anchored at the argument — the call site's most specific position. */
export interface DynamicStorageSite {
  facade: StorageFacade;
  method: string;
  line: number;
  column: number;
}

export interface StorageSurface {
  kvKeys: readonly StorageReference[];
  collections: readonly StorageReference[];
  dynamic: readonly DynamicStorageSite[];
}
```

## Invariants

- **One scanner, two consumers.** The edit turn's storage-location instruction and the drift
  check read this function's output. No second storage-name extractor, no hand-kept list.
- **Pure and total.** No I/O, no caching across calls, no diagnostics — it reports only what it
  found. A source that fails to parse yields whatever the recovered tree contains (the parse
  gate reports the syntax error); a source with no storage use yields three empty lists.
- **Binding resolution, never token matching.** A location is collected only from
  `<storage>.kv.<m>(...)` / `<storage>.records.<m>(...)` where the root lexically resolves to the
  `vc-sdk` `storage` export — the named import or `<ns>.storage` for `import * as ns`. A local
  named `storage`, or a `storage` imported from another module, is collected from never.
- **First argument only.** It is the kv key or the record collection in every method of both
  facades. Substitution-free template literals count as literals; anything else is dynamic.
- **`kvKeys`/`collections` are deduplicated per facade**, first occurrence wins, source order
  preserved; the anchor is the first place the source names that location. **`dynamic` is not
  deduplicated** — every non-literal argument is its own call site and its own warning.
- **KNOWN LIMIT, asserted in the suite:** a facade held in a local alias (`const kv =
  storage.kv; kv.get('total')`) is NOT collected and is NOT a dynamic site. The failure mode is
  a missed guarantee, never a false accusation — continuity may only fire on collected
  locations.

## Kind vocabulary (added to `DIAGNOSTIC_KINDS` in `checks/contract.ts`)

Kinds are declared centrally. No producer mints a kind string outside that module.

| kind | severity | meaning |
| --- | --- | --- |
| `schema_identity_drift` | error | candidate abandons a collection or active field ID the applied schema contains |
| `storage_surface_drift` | error | candidate stops reading a storage location the previous source read |
| `storage_surface_dynamic` | warning | a storage-facade argument is not a string literal (the only warning of this set) |
| `type_mismatch` | error | storage-engine verb-time kinds, carried verbatim under the engine's own names |
| `unknown_collection` | error | (same) |
| `unknown_field` | error | (same) |
| `unknown_record` | error | (same) |
| `unqueryable_field` | error | (same) |
| `kv_too_large` | error | (same) |

`id_below_floor` and `build_failure` already existed and are unchanged.

**Host-fault exclusion rule.** `not_open` and `corrupt_storage` are storage-engine
`StorageErrorKind`s that are deliberately NOT diagnostic kinds: they report the harness's own
engine state, carry no fix a candidate could apply, and are surfaced through the run report's
trace. A producer may not rename a host fault into any kind above in order to report it. The
acceptance suite asserts their absence, and the verb-time roster is typed as
`(StorageErrorKind & DiagnosticKind)[]` so a rename on either side fails to typecheck.
