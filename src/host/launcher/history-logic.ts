/**
 * history-logic — the RN-free decision logic behind HistoryScreen (version-history spec,
 * design-system-v1 chain-20). Row derivation for the timeline (the user's quoted prompt as the
 * headline and Whim's summary under it, the version and when, the kind chip, at-most-two next
 * actions per row) plus the schema-diff annotation helpers D5's restore-reassurance path reads.
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
import { historyQuotedPrompt, historyRowMeta } from './copy';
import { parsePromptEnvelope } from './prompt-envelope';
import type { StoreAccess } from './store-access';
import type { RunSummary, SummaryKind, SummaryMark } from '@whim/contract';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';

/**
 * F1 fixed at the engine level (snapshot-lineage-identity, design D6; handoff/lineage-correctness.md):
 * `timeline()` is now lineage-correct, not just DAG-same-line — a descendant of the active tip is
 * only kept if it was actually created as a continuation of the active lineage, so an undiverged
 * fork's `timeline()` no longer surfaces the original's later snapshots (and a rolled-back original
 * no longer surfaces a fork's). Every entry, fork or original, lists via `timeline()` for full
 * roll-forward — the interim `history()`-for-forks guard this function used to apply is retired.
 *
 * Newest first by the version chain, never the clock (#126), and the WHOLE chain: the store's
 * default cap would cut the oldest versions off, and then the last row would not be the version
 * the app began with. Uncapping costs nothing — `timeline()` reads every version before it caps.
 */
export async function listVersions(access: StoreAccess, app: InstalledApp): Promise<Snapshot[]> {
  return access.timeline(app, { limit: Number.POSITIVE_INFINITY });
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
  } catch (e) {
    // The row simply loses its data-shape annotation. Recorded because an unreadable schema
    // artifact is corrupted stored state, not an expected shape.
    log.warn(CHANNELS.app, 'schema artifact is unreadable, no added-field names', {
      detail: e instanceof Error ? e.message : String(e),
    });
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

// ── the timeline row model (system.md §7.1 Timeline row) ────────────────────

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
  } catch (e) {
    // Not JSON at all — a raw legacy prompt, which is a legitimate stored state and NOT an error;
    // `debug` so the fallback is visible in a log without reading as a fault.
    log.debug(CHANNELS.app, 'stored prompt is not an envelope, no summary', {
      detail: e instanceof Error ? e.message : String(e),
    });
  }
  return undefined;
}

export type HistoryActionKind = 'change-from-here' | 'go-back' | 'start-copy';

export interface HistoryRow {
  id: string;
  index: number;
  /** A display ordinal, oldest = "v1" — never a git ref (product-verbs guard). */
  version: string;
  /** "v4 · 2 days ago". */
  meta: string;
  /** The neutral kind chip's kind; `null` = unclassified, no chip. */
  kind: SummaryKind | null;
  /** What the row leads with: the user's own words — the resolved prompt text, quoted; for a
   *  version with no words of the user's to quote, the stored summary's text. */
  headline: string;
  /** The raw resolved prompt-envelope text, for the renderer's `yours`-class matching. */
  promptText: string;
  /** Producer `chg`/`hedge` marks for `headline` — only a summary headline carries any. */
  marks: SummaryMark[];
  /** Whim's summary of what the version did, under the headline — `null` when the version has
   *  none, or when the summary is already the headline. */
  result: { text: string; marks: SummaryMark[] } | null;
  touched: string[];
  isCurrent: boolean;
  /** The true first version: the end of the chain, where the app began. The only row whose kind
   *  is `Start`. */
  isInstall: boolean;
  /** At most two, never three (E5/E9). */
  actions: HistoryActionKind[];
}

/** What a row says collapsed and opened. The user's words, when there are any, are the headline and
 *  Whim's summary is the opened row's result; with no prompt the summary is the headline, once. */
function rowWords(promptText: string, summary: RunSummary | undefined): Pick<HistoryRow, 'headline' | 'marks' | 'result'> {
  if (promptText.length === 0) return { headline: summary?.text ?? '', marks: summary?.marks ?? [], result: null };
  return {
    headline: historyQuotedPrompt(promptText),
    marks: [],
    result: summary ? { text: summary.text, marks: summary.marks } : null,
  };
}

/** A row's kind chip. `Start` is a place in the chain, not something a summary can claim (#126):
 *  the first version is the Start whatever its summary says, and a later version's `Start` claim
 *  is dropped, leaving it unclassified. */
function rowKind(summary: RunSummary | undefined, isInstall: boolean): SummaryKind | null {
  if (isInstall) return 'Start';
  return summary && summary.kind !== 'Start' ? summary.kind : null;
}

/**
 * The timeline's rows. `rows` is the whole chain, newest first, as `listVersions` returns it — so
 * the last row is the true first version; `activeId` the live current marker (E3 — derived from
 * the store, never persisted on the app record); `now` what each row's "when" counts back from.
 */
export function buildHistoryRows(rows: readonly Snapshot[], activeId: string | null, now: number = Date.now()): HistoryRow[] {
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
    const version = `v${total - index}`;
    return {
      id: snapshot.id,
      index,
      version,
      meta: historyRowMeta(version, snapshot.createdAt, now),
      kind: rowKind(summary, isInstall),
      ...rowWords(promptText, summary),
      promptText,
      touched: summary?.touched ?? [],
      isCurrent,
      isInstall,
      actions,
    };
  });
}
