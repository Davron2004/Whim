/**
 * grid-composition — the home grid's pure composition: which cells there are, in what order, and
 * in which state (app-launcher "Tiles show their state", "The home grid orders and lays out apps
 * for every text size"; system.md §3.2, §9). Free of `react-native`, so the order rule, the
 * collapse of old attempts and the state of every cell are Node-testable — the same split
 * `home-grid` made when `HomeScreen.tsx` first imported React Native at module scope.
 *
 * Rules this module holds (`handoff/ghost-handlers.md` and `handoff/home.md`):
 *   - A pending record with `editingAppId` is a change in flight on an installed app: it decorates
 *     that app's own cell (changing, or change failed) and spawns no cell of its own.
 *   - An id present as both an attempt and an installed app renders once, as the attempt.
 *   - Order: attempts being made (waiting ones with them), then failed and stopped attempts from the
 *     last day, then apps, each group newest first; an app keeps its place when it changes (its
 *     `createdAt` never moves). Failed and stopped attempts older than a day gather in one cell at
 *     the end. `pending` arrives newest first from `PendingBuildStore.list()` and is never re-sorted.
 *   - Attempts and apps whose purge is armed (Delete, Discard waiting out their Undo window) are
 *     not cells.
 */
import type { InstalledApp } from './app-index';
import type { PendingBuildRecord } from './pending-builds';
import type { TileState } from '../ui/AppTile-states';

/** An attempt this old or older has stopped being news. */
export const ATTEMPT_RECENT_MS = 24 * 60 * 60 * 1000;

export type AppCellState = Extract<TileState, 'ready' | 'changing' | 'change-failed'>;
export type AttemptCellState = Extract<TileState, 'making' | 'queued' | 'failed' | 'stopped' | 'needs-update'>;

/** An installed app's cell; `rebuild` is the change in flight or failed on it. */
export interface AppCell {
  readonly kind: 'app';
  readonly state: AppCellState;
  readonly app: InstalledApp;
  readonly rebuild?: PendingBuildRecord;
}

/** A pending-build record that is not a change: a new app being made, or one that did not finish. */
export interface AttemptCell {
  readonly kind: 'attempt';
  readonly state: AttemptCellState;
  readonly rec: PendingBuildRecord;
  /** The tile's name: the description's first three words (`attemptName`). */
  readonly name: string;
}

/** The one cell standing for failed and stopped attempts older than a day. */
export interface OlderCell {
  readonly kind: 'older';
  readonly recs: readonly PendingBuildRecord[];
}

export type GridCell = AppCell | AttemptCell | OlderCell;

export interface ComposeOptions {
  /** The clock the day is measured against. */
  now: number;
  /** Ids of attempts waiting for a free spot (their stream's latest event is `queued`). */
  queued?: ReadonlySet<string>;
  /** Ids of installed apps whose Delete is waiting out its Undo window. */
  deletedApps?: ReadonlySet<string>;
  /** Ids of pending records whose Discard is waiting out its Undo window. */
  discardedAttempts?: ReadonlySet<string>;
}

/** The name of a tile being made. The plan's proposed name is not carried by any record yet, so this
 *  is the description's first three words without a leading "a", "an" or "the", capitalised. */
export function attemptName(rec: Pick<PendingBuildRecord, 'prompt' | 'workingTitle'>): string {
  const words = rec.prompt.trim().split(/\s+/).filter((w) => w !== '');
  if (words.length > 1 && /^(?:a|an|the)$/i.test(words[0])) words.shift();
  const name = words.slice(0, 3).join(' ');
  if (name === '') return rec.workingTitle;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function attemptState(rec: PendingBuildRecord, queued: ReadonlySet<string> | undefined): AttemptCellState {
  if (rec.state === 'building') return queued?.has(rec.id) ? 'queued' : 'making';
  if (rec.state === 'interrupted') return 'stopped';
  return rec.failure?.remedy?.kind === 'update' ? 'needs-update' : 'failed';
}

function appState(rebuild: PendingBuildRecord | undefined): AppCellState {
  if (!rebuild) return 'ready';
  return rebuild.state === 'building' ? 'changing' : 'change-failed';
}

/** Newest first; a tie keeps the later install ahead (the index lists in install order). */
function newestFirst(apps: readonly InstalledApp[]): InstalledApp[] {
  return apps
    .map((app, index) => ({ app, index }))
    .sort((a, b) => b.app.createdAt - a.app.createdAt || b.index - a.index)
    .map(({ app }) => app);
}

/** Whether a failed or stopped attempt has aged into the collapsed cell. Needs-update attempts
 *  never do: the one thing to do about one is to update Whim, so it stays in sight. */
function collapses(cell: AttemptCell, now: number): boolean {
  return (cell.state === 'failed' || cell.state === 'stopped') && now - cell.rec.createdAt > ATTEMPT_RECENT_MS;
}

export function composeGrid(
  pending: readonly PendingBuildRecord[],
  apps: readonly InstalledApp[],
  options: ComposeOptions,
): GridCell[] {
  const visible = pending.filter((rec) => !options.discardedAttempts?.has(rec.id));
  const rebuildByAppId = new Map<string, PendingBuildRecord>();
  const attempts: AttemptCell[] = [];
  for (const rec of visible) {
    if (rec.editingAppId) rebuildByAppId.set(rec.editingAppId, rec);
    else attempts.push({ kind: 'attempt', state: attemptState(rec, options.queued), rec, name: attemptName(rec) });
  }

  const attemptIds = new Set(attempts.map((a) => a.rec.id));
  const seen = new Set<string>();
  const installed: AppCell[] = [];
  for (const app of newestFirst(apps)) {
    // Dedupe by id, the attempt wins (delivery and a render are not atomic); a duplicate id inside
    // `apps` keeps its first.
    if (options.deletedApps?.has(app.id) || attemptIds.has(app.id) || seen.has(app.id)) continue;
    seen.add(app.id);
    const rebuild = rebuildByAppId.get(app.id);
    installed.push({ kind: 'app', state: appState(rebuild), app, ...(rebuild ? { rebuild } : {}) });
  }

  const making = attempts.filter((a) => a.state === 'making' || a.state === 'queued');
  const finished = attempts.filter((a) => a.state !== 'making' && a.state !== 'queued');
  const older = finished.filter((a) => collapses(a, options.now));
  const recent = finished.filter((a) => !collapses(a, options.now));
  const tail: OlderCell[] = older.length > 0 ? [{ kind: 'older', recs: older.map((a) => a.rec) }] : [];
  return [...making, ...recent, ...installed, ...tail];
}

/** A stable key for a cell, so a list re-renders the same tile in place. */
export function cellKey(cell: GridCell): string {
  if (cell.kind === 'app') return `app:${cell.app.id}`;
  if (cell.kind === 'attempt') return `attempt:${cell.rec.id}`;
  return 'older';
}

/** A cell's name as the grid and the menu title show it; the older cell has none of its own. */
export function cellName(cell: Exclude<GridCell, OlderCell>): string {
  return cell.kind === 'app' ? cell.app.name : cell.name;
}

/** The apps' search (shown from 13 apps): the cells whose name contains `query`, any case. The
 *  collapsed older cell has no name and is not searched. An empty query keeps every cell. */
export function searchCells(cells: readonly GridCell[], query: string): GridCell[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...cells];
  return cells.filter((cell) => cell.kind !== 'older' && cellName(cell).toLowerCase().includes(needle));
}

/** Search appears once there are this many apps to look through. */
export const SEARCH_FROM_APPS = 13;
