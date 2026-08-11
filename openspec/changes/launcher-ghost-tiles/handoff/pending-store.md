# pending-store — interface contract (chain-1 output, for chain-2 / chain-3)

## Types (`src/host/launcher/pending-builds.ts`)

```ts
export type PendingBuildState = 'building' | 'failed' | 'interrupted';

export interface PendingBuildFailure {
  reason: string;
  diagnostics?: string;
}

export interface PendingBuildRecord {
  id: string;                 // launcher id allocated at generation start
  prompt: string;              // verbatim user prompt
  workingTitle: string;        // from workingTitleFromPrompt(prompt), computed once at create()
  state: PendingBuildState;
  createdAt: number;           // epoch ms
  updatedAt: number;           // epoch ms
  failure?: PendingBuildFailure;
  editingAppId?: string;       // present only for rebuild/edit attempts
}

export interface CreatePendingBuildInput {
  id: string;
  prompt: string;
  workingTitle: string;
  editingAppId?: string;
}
```

## `PendingBuildStore` (`src/host/launcher/pending-builds.ts`)

Constructed over the shared MMKV `KVBackend` (same one `AppIndex`/`ServerAddress` use — a fresh
`new PendingBuildStore(kv)` per shell instance is fine, all state lives in `kv`):

```ts
class PendingBuildStore {
  constructor(kv: KVBackend);
  create(input: CreatePendingBuildInput): PendingBuildRecord;   // always writes state 'building'
  get(id: string): PendingBuildRecord | null;
  list(): PendingBuildRecord[];                                  // NEWEST FIRST
  setFailed(id: string, failure: PendingBuildFailure): void;
  delete(id: string): void;
  demoteBuildingToInterrupted(): void;                           // flips ALL 'building' -> 'interrupted'
}
```

## `prompt-flow.ts` additions

```ts
export function workingTitleFromPrompt(text: string): string;
export function ghostTileColorFor(id: string): string;
```

Both pure, no I/O, importable from a Node suite. `ghostTileColorFor` is `appColor(id)` — the
SAME palette (`../../sdk/theme#appColor`) every installed tile's fallback colour resolves
through, hashed on the launcher id instead of the app name; do not introduce a second palette.

## Invariants a caller MUST honor

- **Single writer.** Only the `LauncherShell` instance driving `onBuildIt` calls `create` /
  `delete` / `setFailed`. No other code path writes a transition.
- **Create at request start**, before any `stage`/`result`/`failure` event — not inside
  `deliverResult`. `id` must be allocated up front (`freshAppId()`) and reused, unchanged, by
  `deliverResult`.
- **Delete only on**: successful delivery (after `access.install`/`update` complete — store
  first, index second, THEN delete the pending record), user cancel, or user dismiss of a
  `failed`/`interrupted` record. Never delete on failure.
- **`setFailed` on**: a terminal `failure` event, or a stream error/thrown error with no terminal
  event (not counting a user-initiated cancel). Record is never deleted here.
- **`demoteBuildingToInterrupted()` MUST run exactly once, before the first grid render, at every
  app/process launch** — not wired into any call site by this chain. A `building` record is never
  shown to the user across a process restart.
- **`list()` ordering**: newest-created record first. Callers composing the grid put pending
  entries before `AppIndex.list()` entries and MUST dedupe by id (pending wins) since delivery's
  delete + refresh is not atomic with the caller's own re-render.
- **`editingAppId`**: set only for rebuild/edit attempts (re-prompting an installed app). A record
  carrying it must not spawn a ghost tile — render it against the existing installed tile instead.
- **No version-store or `AppIndex` access** happens inside this module, ever — writes here touch
  only the `pending:*` KV keys.

## Error surface

- `get`/`list`: corrupt JSON (record or order list) is tolerated — logged via `log.warn` and
  treated as absent/empty. Never throws.
- `create`/`delete`/`setFailed`/`demoteBuildingToInterrupted`: never throw. `setFailed` and
  `delete` on an unknown id are silent no-ops (no record materializes).
- `workingTitleFromPrompt`/`ghostTileColorFor`: pure, total functions — never throw, no I/O.
