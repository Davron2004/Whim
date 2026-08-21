# Proposal: version-history-ux

## Why

Every generation is already an immutable, prompt-tagged snapshot (#36/#39), but no product surface exposes it — the launcher can launch, fork, and delete, and nothing else. Spec §11 expects rollback to be ~10× more frequent than in normal coding, which makes history the missing hero surface of the versioning story (roadmap #6, deps satisfied: launcher-shell shipped).

One store-level gap blocks the settled UX (research.md, verified fact 1): after a restore moves an app backward, `history()` — an ancestry walk from HEAD — can no longer list the "future" versions the user rewound past, even though their tags survive and `rollback()` would accept them as roll-forward targets. Roll-forward is a product requirement here, so the store needs one additive enumeration verb.

## What Changes

- **New History screen** (full-screen launcher sibling, per app): the user's prompts as a newest-first list with timestamps — history reads as "the changes you asked for," never as version-control vocabulary. Shows a "current version" marker derived live from the store (never persisted on the app record).
- **Instant restore with undo**: tapping an entry restores the app to the state *before* that prompt was applied (Claude-Code-rewind semantics), immediately, with an undo toast — no confirmation dialog. Restore targets include versions *ahead* of the current position (roll-forward), which requires:
- **One additive version-store verb** enumerating the full same-line set (ancestors *and* tag-reachable descendants of the current position), capped like `history`. No existing verb changes shape or behavior.
- **Named pins**: pin any version with a user-chosen label; pinned versions are marked in the list.
- **Fork from any point**: "make this version its own app" on every entry, through the existing `StoreAccess.fork` path (store already supports arbitrary-snapshot forks — research.md, verified fact 2). Fork keeps today's semantics: own storage-engine data, fresh (D8/#43b unchanged by this change).
- **Data annotations from the schema artifact**: each entry that changed the app's data shape gets a one-line annotation ("added: notes (text)") computed with the storage engine's existing pure `diffSchemas` between adjacent snapshots' schema artifacts. Restoring to a version whose schema lacks fields the user has since gained shows a one-line reassurance ("nothing is deleted; it comes back on newer versions") — additive-only evolution guarantees deletions cannot occur, so this is the only data message needed.
- **Prompt envelope `{v: 1, text}`**: this change defines the minimal versioned JSON envelope for the snapshot prompt string and renders defensively (parse the envelope if present, else show the raw string). The store stays content-agnostic; #7/#11 will write this envelope and may extend it — recorded as a roadmap contract note.
- **`StoreAccess` grows the read/act surface**: `history`/`line`/`rollback`/`pin`/`listPins`/`diff` wrappers, each applying the existing `ensureLineage` discipline. The launcher continues to never touch raw `VersionStore` (#43b contract note).
- **Home screen entry point**: a History row in the existing long-press action sheet; all new copy goes through the `COPY` table and must pass the product-verbs guard ("version" is the sanctioned user-facing noun — verified off the denylist).

**Out of scope** (settled in the explore session): rewind-then-new-prompt behavior and everything downstream of it (new-app creation, shared/linked databases, replace-the-old-one offer, database clone) — no prompt flow exists until #7, and a sibling change owns the linked-apps data model; cursor pagination (the `historyLimit` cap is sufficient at Tier-0 depths per #39's latency numbers); visual diffing beyond the data annotation line; any persisted current-version field on `InstalledApp`.

## Capabilities

### New Capabilities
- `version-history`: the per-app history surface — prompts-as-history list, restore-before-prompt semantics with undo and roll-forward, named pins, fork-from-point, data-shape annotations and restore reassurance, prompt-envelope rendering, product-verbs copy discipline.

### Modified Capabilities
- `mini-app-versioning`: adds the same-line enumeration requirement (the full line, including tag-reachable descendants of the current position, remains listable after a rollback) as an additive verb; existing verbs unchanged.
- `app-launcher`: the app action sheet gains a History entry; the launcher's version-store access surface (`StoreAccess`) grows history/line/rollback/pin/diff wrappers under the existing ensure-lineage discipline.

## Impact

- **Version store** (`src/host/version-store/engine.ts` + `index.ts`): one new verb + its `npm run vstore:test` coverage. No changes to existing verbs, snapshot format, or on-disk layout.
- **Launcher** (`src/host/launcher/`): new `HistoryScreen.tsx`; `LauncherRoot.tsx` `Screen` union + handler wiring; `HomeScreen.tsx` action-sheet row; `store-access.ts` wrappers; `copy.ts` strings; `npm run launcher:test` coverage including the product-verbs guard over all new copy.
- **Storage engine**: untouched — annotations reuse the exported pure `diffSchemas`.
- **Runtime/sandbox/CSP/bridge**: untouched (no runtime surface in this change).
- **Docs**: `docs/v1-roadmap.md` ledger update (#6 → proposed, contract notes incl. the prompt envelope for #7/#11); decision-log entry for the restore/roll-forward UX semantics at implementation time.
