/**
 * run-journal — the bounded, persisted history of one generation attempt
 * (generation-observability design D1–D4; `generation-run-journal` spec, all requirements).
 *
 * A SIBLING MMKV key to the pending-build record, not a field on it (design D1): the record is
 * read/written whole on every lifecycle transition and the grid reads it on every render, so the
 * journal's much higher write cadence must not inflate that hot path. Same `KVBackend`, same
 * single-writer discipline as `PendingBuildStore` — only the `LauncherShell` instance driving the
 * generation stream ever appends.
 *
 * Three invariants this module OWNS rather than merely documents:
 *  - `stage` entries carry the WIRE stage vocabulary (`plan`/`generate`/`check`/`run`/`repair`),
 *    never the build screen's four display steps — the display mapping is a `BuildStep` concern.
 *  - an `aggregate` entry carries numeric counts only, never token text, and aggregates are
 *    CUMULATIVE running totals so any single entry renders in isolation.
 *  - a `terminal` entry's failure detail is re-projected here to `{ reason, diagnostics[].hint }`,
 *    so a caller that hands over a richer object cannot leak a diagnostic's `kind`/`symbol`/raw
 *    `message` into storage.
 *
 * Corrupt-record tolerance mirrors `PendingBuildStore`/`AppIndex`: an unreadable journal reads as
 * absent and is logged, never thrown.
 */

import type { KVBackend } from '../version-store/fs/kv-fs';
import type { Stage } from './prompt-flow';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';

/** Cumulative output counts observed so far in the attempt — never a per-tick delta (design D2). */
export interface RunAggregates {
  chars: number;
  tokens: number;
}

/** The only failure detail a journal may hold: the same fields the failure screen already permits
 *  (`reason`, each diagnostic's `hint`) — never a diagnostic's `kind`, `symbol` or raw `message`. */
export interface RunJournalFailure {
  reason: string;
  diagnostics?: readonly { hint: string }[];
}

export type RunJournalEntryKind = 'stage' | 'aggregate' | 'terminal';

/** One journal entry (design D2, additive-only discipline). `t` is epoch ms at append time. */
export interface RunJournalEntry {
  t: number;
  kind: RunJournalEntryKind;
  /** Present only on `kind: 'stage'`. */
  stage?: Stage;
  /** Present only on `kind: 'aggregate'`. */
  aggregates?: RunAggregates;
  /** Present only on `kind: 'terminal'`, and only when the attempt ended in a failure. */
  failure?: RunJournalFailure;
}

export type RunJournal = readonly RunJournalEntry[];

export const JOURNAL_KEY = (launcherId: string) => `journal:${launcherId}`;
export const LAST_RUN_KEY = (appId: string) => `lastrun:${appId}`;

/** At most one `aggregate` entry per this much wall time (design D3): a per-token write would
 *  thrash MMKV, and sub-5s precision has no product value in an after-the-fact timeline. */
export const AGGREGATE_THROTTLE_MS = 5_000;

/** ~200 entries (design D4). Exceeded only in the pathological all-`stage` case below. */
export const JOURNAL_ENTRY_CAP = 200;

export class RunJournalStore {
  /**
   * @param kv the same backend `PendingBuildStore` is constructed over.
   * @param now injectable clock — the aggregate throttle is wall-time based, so tests drive it
   *        instead of sleeping.
   */
  constructor(
    private readonly kv: KVBackend,
    private readonly now: () => number = Date.now,
  ) {}

  private read(key: string): RunJournalEntry[] | null {
    const raw = this.kv.getString(key);
    if (!raw) return null;
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as RunJournalEntry[]) : null;
    } catch (e) {
      // Tolerated (an unreadable journal reads as "no journal"), never silent — same idiom as
      // PendingBuildStore.get. A journal is diagnostic history; losing it must never crash a run.
      log.warn(CHANNELS.app, 'stored run journal is unreadable', {
        key,
        detail: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }

  private write(key: string, entries: RunJournalEntry[]): void {
    this.kv.set(key, JSON.stringify(entries));
  }

  /**
   * Append with the cap applied (design D4): when the journal is already at the cap, the OLDEST
   * `aggregate` entry is evicted to make room. `stage` and `terminal` entries are never evicted —
   * so a journal made entirely of them grows one past the cap per append rather than losing the
   * history the timeline actually needs (`generation-run-journal` spec, "Stage and terminal
   * entries survive eviction"). The overshoot stays bounded: the moment one aggregate is present,
   * every later aggregate append evicts it again.
   */
  private appendEntry(launcherId: string, entry: RunJournalEntry): void {
    const entries = this.read(JOURNAL_KEY(launcherId)) ?? [];
    while (entries.length >= JOURNAL_ENTRY_CAP) {
      const oldestAggregate = entries.findIndex((e) => e.kind === 'aggregate');
      if (oldestAggregate < 0) break;
      entries.splice(oldestAggregate, 1);
    }
    entries.push(entry);
    this.write(JOURNAL_KEY(launcherId), entries);
  }

  /** Create an empty journal for an attempt, at the same moment its pending-build record is
   *  created. Re-creating an id discards whatever was there — an attempt starts with no history. */
  create(launcherId: string): void {
    this.write(JOURNAL_KEY(launcherId), []);
  }

  /** The attempt's journal, or `null` when there is none (or it is unreadable). */
  get(launcherId: string): RunJournal | null {
    return this.read(JOURNAL_KEY(launcherId));
  }

  /** A successful attempt's retained report for an app, or `null`. */
  getLastRun(appId: string): RunJournal | null {
    return this.read(LAST_RUN_KEY(appId));
  }

  /** Every stage transition is journaled the instant it arrives, unthrottled — they are rare and
   *  they are what the timeline is made of. `stage` is the wire name, never a display step. */
  appendStage(launcherId: string, stage: Stage): void {
    this.appendEntry(launcherId, { t: this.now(), kind: 'stage', stage });
  }

  /**
   * Record cumulative output counts, throttled to at most one entry per `AGGREGATE_THROTTLE_MS`
   * (design D3). Leading-edge: the first call after a quiet window writes immediately carrying the
   * counts as of that moment, and every call inside the window is coalesced into the next one —
   * so the entry count is bounded by elapsed time / ~5s, never by the number of `token` events.
   *
   * The throttle is derived from the journal's own newest `aggregate` entry rather than from
   * instance state, so it survives a store re-instantiation mid-attempt.
   */
  appendAggregate(launcherId: string, aggregates: RunAggregates): void {
    const at = this.now();
    const entries = this.read(JOURNAL_KEY(launcherId)) ?? [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.kind !== 'aggregate') continue;
      if (at - e.t < AGGREGATE_THROTTLE_MS) return;
      break;
    }
    this.appendEntry(launcherId, {
      t: at,
      kind: 'aggregate',
      aggregates: { chars: aggregates.chars, tokens: aggregates.tokens },
    });
  }

  /**
   * The attempt ended — on a `result`, a `failure`, or a stream error with no terminal event.
   * ALWAYS written immediately, bypassing the aggregate throttle: it is the one entry a consumer
   * cannot afford to miss. Failure detail is re-projected to `reason` + diagnostic `hint`s, which
   * is what keeps a richer caller-side object from reaching storage.
   */
  appendTerminal(launcherId: string, terminal: { failure?: RunJournalFailure } = {}): void {
    const failure = terminal.failure;
    this.appendEntry(launcherId, {
      t: this.now(),
      kind: 'terminal',
      ...(failure
        ? {
            failure: {
              reason: failure.reason,
              ...(failure.diagnostics ? { diagnostics: failure.diagnostics.map((d) => ({ hint: d.hint })) } : {}),
            },
          }
        : {}),
    });
  }

  /**
   * Success path (design D5): move the attempt's journal to the app's retained last-run report,
   * overwriting any prior report for that app, and drop the source key. A missing/unreadable
   * source journal writes NOTHING — a rebuild that lost its journal must not overwrite the
   * previous run's report with an empty one, and must not fabricate a report either.
   */
  moveToLastRun(launcherId: string, appId: string): void {
    const entries = this.read(JOURNAL_KEY(launcherId));
    if (entries) this.write(LAST_RUN_KEY(appId), entries);
    this.kv.delete(JOURNAL_KEY(launcherId));
  }

  /** Drop an attempt's journal (dismissing its ghost). A no-op if it was never there. */
  delete(launcherId: string): void {
    this.kv.delete(JOURNAL_KEY(launcherId));
  }
}
