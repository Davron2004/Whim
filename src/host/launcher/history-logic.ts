/**
 * history-logic — the RN-free decision logic behind HistoryScreen (version-history spec,
 * shell-redesign-v2 chain-E). Rebuilt for the `4a` timeline: row derivation (summary-or-prompt
 * headline, kind grouping for the filter pills, at-most-two next actions per row) plus the
 * pre-existing schema-diff annotation and relative-timestamp helpers this module already carried
 * (kept unchanged — D5's restore-reassurance path still reads through them).
 *
 * `RunSummary`/`SummaryKind`/`SummaryMark` are `@whim/contract` TYPE-ONLY imports (erased at
 * compile — zod itself never enters the RN bundle). `storedSummary` below mirrors
 * `generation-client.ts`'s established pattern of a hand-rolled structural guard standing in for
 * the zod schema. A version's stored summary, when it has one, rides INSIDE its own `prompt`
 * envelope JSON — chain-D bumps that envelope to `{v:2, text, summary?}` (`prompt-envelope.ts`,
 * not this module's file); `storedSummary` reads the `summary` field structurally, by shape, so
 * it keeps working whether or not that bump has landed yet.
 */

// Imported from the specific submodules (not the `../storage-engine` barrel): the barrel also
// exports `createStorageEngine`/`deleteStorage`, which statically `require()` the on-device
// op-sqlite native module — fine on-device, but it makes the file unbundlable for a Node test
// (no `better-sqlite3` dependency here). `schema.ts`/`contract.ts` are pure, dependency-free.
import type { SchemaArtifact } from '../storage-engine/contract';
import { diffSchemas, emptyApplied, type AppliedSchema } from '../storage-engine/schema';
import type { Snapshot } from '../version-store';
import type { InstalledApp } from './app-index';
import { parsePromptEnvelope } from './prompt-envelope';
import type { StoreAccess } from './store-access';
import type { RunSummary, SummaryKind, SummaryMark } from '@whim/contract';

/**
 * F1 fixed at the engine level (snapshot-lineage-identity, design D6; handoff/lineage-correctness.md):
 * `timeline()` is now lineage-correct, not just DAG-same-line — a descendant of the active tip is
 * only kept if it was actually created as a continuation of the active lineage, so an undiverged
 * fork's `timeline()` no longer surfaces the original's later snapshots (and a rolled-back original
 * no longer surfaces a fork's). Every entry, fork or original, lists via `timeline()` for full
 * roll-forward — the interim `history()`-for-forks guard this function used to apply is retired.
 */
export async function listVersions(access: StoreAccess, app: InstalledApp): Promise<Snapshot[]> {
  return access.timeline(app);
}

/**
 * D6: whether `app`'s active snapshot is the newest row `listVersions` would show — "at tip" is
 * defined operationally as "matches what the History screen's own top row would show as current".
 */
export async function isAtTip(access: StoreAccess, app: InstalledApp): Promise<boolean> {
  const list = await listVersions(access, app);
  const active = await access.activeId(app);
  return list[0]?.id === active;
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
    // eslint-disable-next-line no-restricted-syntax -- obs-v1-interim: malformed schema artifact yields no added-field names
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

// ── the `4a` row model (E1/E2/E3/E5/E6/E9) ──────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SUMMARY_KINDS: readonly SummaryKind[] = ['Start', 'Added', 'Changed', 'Removed', 'Look', 'Fixed'];

function isSummaryMark(value: unknown): value is SummaryMark {
  return (
    isRecord(value) &&
    (value.cls === 'chg' || value.cls === 'hedge') &&
    typeof value.start === 'number' &&
    typeof value.end === 'number'
  );
}

function isRunSummary(value: unknown): value is RunSummary {
  return (
    isRecord(value) &&
    typeof value.text === 'string' &&
    typeof value.kind === 'string' &&
    (SUMMARY_KINDS as readonly string[]).includes(value.kind) &&
    Array.isArray(value.touched) &&
    value.touched.every(t => typeof t === 'string') &&
    Array.isArray(value.marks) &&
    value.marks.every(isSummaryMark)
  );
}

/** The stored summary for a version, when its prompt envelope carries one — `undefined` for an
 *  older envelope, a raw legacy string, or a run that produced none (all three are legitimate
 *  states, never an error). */
export function storedSummary(raw: string): RunSummary | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && isRunSummary(parsed.summary)) return parsed.summary;
    // eslint-disable-next-line no-restricted-syntax -- obs-v1-interim: not JSON at all, treated as an envelope with no summary
  } catch {
    // Not JSON at all — same as "this envelope carries no summary".
  }
  return undefined;
}

/** The three filter groups the seeded copy table has labels for (`historyFilterWhatItDoes` /
 *  `Look` / `Fixes`) — there is no per-raw-kind pill copy, so grouping, not one pill per kind, is
 *  the shape E6 settles on. */
export type FilterGroup = 'features' | 'look' | 'fixes';

const KIND_GROUP: Record<SummaryKind, FilterGroup> = {
  Start: 'features',
  Added: 'features',
  Changed: 'features',
  Removed: 'features',
  Look: 'look',
  Fixed: 'fixes',
};

export type HistoryOrigin = 'you-said' | 'whim-on-its-own';
export type HistoryActionKind = 'change-from-here' | 'go-back' | 'start-copy';

export interface HistoryRow {
  id: string;
  index: number;
  /** A display ordinal, oldest = "v1" — never a git ref (product-verbs guard). */
  version: string;
  when: string;
  kind: SummaryKind | null;
  /** `null` = unclassified — stays reachable under the all-versions pill only (E6). */
  group: FilterGroup | null;
  /** The stored summary's text, falling back to the resolved prompt text (E2). */
  headline: string;
  /** The raw resolved prompt-envelope text, for the renderer's `yours`-class matching. */
  promptText: string;
  /** Producer `chg`/`hedge` marks for `headline` — `[]` when the version has no summary. */
  marks: SummaryMark[];
  touched: string[];
  origin: HistoryOrigin;
  isCurrent: boolean;
  isInstall: boolean;
  /** At most two, never three (E5/E9). */
  actions: HistoryActionKind[];
}

/**
 * The `4a` row model. `rows` newest-first (as `listVersions` returns); `activeId` the live
 * current marker (E3 — derived from the store, never persisted on the app record).
 */
export function buildHistoryRows(rows: readonly Snapshot[], activeId: string | null): HistoryRow[] {
  const total = rows.length;
  return rows.map((snapshot, index) => {
    const summary = storedSummary(snapshot.prompt);
    const promptText = parsePromptEnvelope(snapshot.prompt).text;
    const isCurrent = snapshot.id === activeId;
    const isInstall = index === total - 1;
    let actions: HistoryActionKind[];
    if (isCurrent) actions = ['change-from-here'];
    else if (isInstall) actions = ['start-copy'];
    else actions = ['go-back', 'start-copy'];
    return {
      id: snapshot.id,
      index,
      version: `v${total - index}`,
      when: formatRelativeTimestamp(snapshot.createdAt),
      kind: summary?.kind ?? null,
      group: summary ? KIND_GROUP[summary.kind] : null,
      headline: summary?.text ?? promptText,
      promptText,
      marks: summary?.marks ?? [],
      touched: summary?.touched ?? [],
      // No write path in this codebase yet produces a version the user did not prompt (`prompt`
      // is a required field on every install/update spec) — an empty stored prompt is the only
      // signal available on-device for "the product acted unprompted" today.
      origin: promptText.length > 0 ? 'you-said' : 'whim-on-its-own',
      isCurrent,
      isInstall,
      actions,
    };
  });
}

/** Live per-group counts (E6's "the count is live" scenario) — unclassified rows count toward
 *  neither group, only the all-versions pill. */
export function groupCounts(rows: readonly HistoryRow[]): Record<FilterGroup, number> {
  const counts: Record<FilterGroup, number> = { features: 0, look: 0, fixes: 0 };
  for (const row of rows) if (row.group) counts[row.group] += 1;
  return counts;
}

/** Narrows `rows` to one filter pill's group; `'all'` (the default selection) returns every row,
 *  unclassified included (E6's "unclassified versions are never hidden"). */
export function filterRows(rows: readonly HistoryRow[], filter: 'all' | FilterGroup): HistoryRow[] {
  return filter === 'all' ? [...rows] : rows.filter(row => row.group === filter);
}
