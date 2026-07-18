/**
 * history-logic — the RN-free decision logic behind HistoryScreen (version-history-ux, D1/D5/F1).
 *
 * Kept separate from HistoryScreen.tsx so it is directly Node-testable (mirrors teardown.ts's
 * split for useMiniAppHost): the F1 listing guard, D1's restore-target-is-the-predecessor rule,
 * D5's lazy per-pair schema-diff annotation, and the relative-timestamp formatter.
 */

// Imported from the specific submodules (not the `../storage-engine` barrel): the barrel also
// exports `createStorageEngine`/`deleteStorage`, which statically `require()` the on-device
// op-sqlite native module — fine on-device, but it makes the file unbundlable for a Node test
// (no `better-sqlite3` dependency here). `schema.ts`/`contract.ts` are pure, dependency-free.
import type { SchemaArtifact } from '../storage-engine/contract';
import { diffSchemas, emptyApplied, type AppliedSchema } from '../storage-engine/schema';
import type { Snapshot } from '../version-store';
import type { InstalledApp } from './app-index';
import type { StoreAccess } from './store-access';

/**
 * F1 guard (verified engine gap — handoff/store-access-history.md "known gap"): `timeline()`'s
 * `isSameLine` check is DAG-ancestry-only, so an un-diverged fork's `timeline()` can surface a
 * snapshot committed later on the ORIGINAL's lineage (its tip is literally the same commit as the
 * shared fork point). No cheap "has this fork diverged" signal exists on `InstalledApp`/
 * `StoreAccess` without adding new store state (out of scope here — awaits the lineage-stamp fix
 * in `linked-apps-data-model`), so every fork entry lists via the always-safe `history()` (a
 * strict ancestor walk — provably never a sibling lineage's snapshot). The primary/original
 * lineage lists via `timeline()` for full roll-forward (a rollback on the SAME entry keeps later
 * snapshots reachable and listed).
 */
export async function listVersions(access: StoreAccess, app: InstalledApp): Promise<Snapshot[]> {
  return app.storeId != null ? access.history(app) : access.timeline(app);
}

/**
 * D1: row `idx` (the prompt that produced `list[idx]`) restores to its predecessor, `list[idx+1]`
 * — the version active before that prompt. `list` is newest-first, so the predecessor is the next
 * (older) entry. The oldest row (the install event) has no predecessor and returns `null` — no
 * restore affordance.
 */
export function restoreTargetId(list: readonly Snapshot[], idx: number): string | null {
  return list[idx + 1]?.id ?? null;
}

function emptyArtifact(): SchemaArtifact {
  return { schemaVersion: 1, collections: {} };
}

/** The `AppliedSchema` an artifact would produce if it were the very first thing ever applied —
 *  used as the "before" side of a two-artifact diff. Diffing from `emptyApplied()` can only ever
 *  land in `identical` (no collections) or `additive` (brand-new collections need no defaults),
 *  never `conflict`, so the fallback below is unreachable in practice. */
function appliedFromArtifact(artifact: SchemaArtifact): AppliedSchema {
  const diff = diffSchemas(emptyApplied(), artifact);
  return diff.kind === 'conflict' ? emptyApplied() : diff.nextApplied;
}

/**
 * D5: fields present in `afterRaw`'s schema artifact but not in `beforeRaw`'s, formatted as
 * `"<display name> (<type>)"`. Additive-only evolution means only additions/display-renames can
 * ever appear here — never throws (malformed JSON on either side yields no annotation).
 */
export function addedFieldsBetween(beforeRaw: string | undefined, afterRaw: string): string[] {
  try {
    const before: SchemaArtifact = beforeRaw != null ? JSON.parse(beforeRaw) : emptyArtifact();
    const after: SchemaArtifact = JSON.parse(afterRaw);
    const diff = diffSchemas(appliedFromArtifact(before), after);
    if (diff.kind !== 'additive') return [];

    const addedIds = new Set<string>();
    for (const create of diff.plan.creates) for (const col of create.columns) addedIds.add(col.id);
    for (const add of diff.plan.adds) addedIds.add(add.column.id);

    const names: string[] = [];
    for (const coll of Object.values(after.collections)) {
      for (const [displayName, field] of Object.entries(coll.fields)) {
        if (addedIds.has(field.id)) names.push(`${displayName} (${field.type})`);
      }
    }
    return names;
  } catch {
    return [];
  }
}

/**
 * D5: the data-shape annotation for a rendered row pair — diffs `schema.json` between `fromId`
 * and `toId` ONLY (the "only if the schema artifact file changed" gate: `StoreAccess.diff` omits
 * unchanged files entirely) and, if it changed, returns the added-field names. Caller memoizes
 * per pair for the screen's lifetime (this function does no caching of its own).
 */
export async function annotationBetween(
  access: StoreAccess,
  app: InstalledApp,
  fromId: string,
  toId: string,
): Promise<string[]> {
  const changes = await access.diff(app, fromId, toId);
  const schemaChange = changes.find(c => c.file === 'schema.json');
  if (!schemaChange || schemaChange.after == null) return [];
  return addedFieldsBetween(schemaChange.before, schemaChange.after);
}

/**
 * D5 restore reassurance: fields that would leave view by restoring to `targetId` — present in
 * the currently active version's schema, absent from the target's. Empty means nothing would
 * leave view (no reassurance needed).
 */
export function fieldsLeavingViewOnRestore(
  access: StoreAccess,
  app: InstalledApp,
  targetId: string,
  currentActiveId: string,
): Promise<string[]> {
  return annotationBetween(access, app, targetId, currentActiveId);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** A short, human-readable relative timestamp (D7). Falls back to a locale date string once a
 *  version is a week or older. */
export function formatRelativeTimestamp(createdAt: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - createdAt);
  if (diff < MINUTE_MS) return 'Just now';
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`;
  if (diff < 7 * DAY_MS) return `${Math.floor(diff / DAY_MS)}d ago`;
  return new Date(createdAt).toLocaleDateString();
}
