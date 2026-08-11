/**
 * pending-builds — the persisted lifecycle of an in-flight/failed generation attempt
 * (launcher-ghost-tiles design D1/D2/D4; `pending-builds` spec, all requirements).
 *
 * A SEPARATE MMKV keyspace from `AppIndex` — never an `InstalledApp`, never convertible into one.
 * An `InstalledApp` with a `status` field was explicitly rejected (design D1): it would put
 * bundle-less records behind `AppIndex.list()` and violate the app-launcher invariant that
 * installed apps are real, launchable records (#43b/D1). The grid composes `pending.list()` +
 * `index.list()` at render time; ghosts sort before installed apps (newest first) — that
 * composition is a later chain's job, not this module's.
 *
 * Single-writer discipline (design D4): only the `LauncherShell` instance driving `onBuildIt`
 * ever writes a transition — create(`building`) at request start, `delete` on delivered/cancel,
 * `setFailed` on terminal failure/stream error. This module enforces none of that; it is a plain
 * KV-backed store. The one exception is `demoteBuildingToInterrupted`, which the launch path must
 * run once, before the first grid render, because a `building` record can never be truthful
 * across a cold start (the process that owned the generation stream is gone).
 *
 * Corrupt-record / dangling-order tolerance mirrors `AppIndex` exactly (`app-index.ts`): an
 * unreadable record or order list reads as absent/empty and is logged, never thrown.
 */

import type { KVBackend } from '../version-store/fs/kv-fs';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';

export type PendingBuildState = 'building' | 'failed' | 'interrupted';

export interface PendingBuildFailure {
  reason: string;
  diagnostics?: string;
}

/** The persisted record (design D2, additive-only discipline). */
export interface PendingBuildRecord {
  /** The launcher id allocated for this attempt (design D3: allocated at generation start, not
   *  at delivery) — becomes the `InstalledApp.id` on successful delivery. */
  id: string;
  /** The user's verbatim prompt for this attempt. */
  prompt: string;
  /** First ~28 chars of `prompt`, word-boundary truncated — computed once at creation by
   *  `prompt-flow.ts#workingTitleFromPrompt`. */
  workingTitle: string;
  state: PendingBuildState;
  /** Epoch ms, set once at `create`. */
  createdAt: number;
  /** Epoch ms, set on every write (`create`/`setFailed`/`demoteBuildingToInterrupted`). */
  updatedAt: number;
  /** Present only in state `failed`. */
  failure?: PendingBuildFailure;
  /** Present when this attempt re-prompts an existing installed app — marks a rebuild, which
   *  spawns no ghost tile (spec "Rebuild and edit attempts carry editingAppId and spawn no
   *  ghost"). */
  editingAppId?: string;
}

const PENDING_KEY = (id: string) => `pending:${id}`;
const ORDER_KEY = 'pending:order';

export interface CreatePendingBuildInput {
  id: string;
  prompt: string;
  workingTitle: string;
  editingAppId?: string;
}

export class PendingBuildStore {
  constructor(private readonly kv: KVBackend) {}

  private readOrder(): string[] {
    const raw = this.kv.getString(ORDER_KEY);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch (e) {
      // Tolerated (an unreadable order list reads as "no order"), but never silent — this is
      // corrupted device state, and every ghost tile the user should be seeing is gone because of
      // it (same idiom as AppIndex.readOrder).
      log.warn(CHANNELS.app, 'stored pending-build order is unreadable', {
        key: ORDER_KEY,
        detail: e instanceof Error ? e.message : String(e),
      });
      return [];
    }
  }

  private writeOrder(ids: string[]): void {
    this.kv.set(ORDER_KEY, JSON.stringify(ids));
  }

  /** Read one record (or null). Corrupt JSON reads as "no record", logged, never thrown. */
  get(id: string): PendingBuildRecord | null {
    const raw = this.kv.getString(PENDING_KEY(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PendingBuildRecord;
    } catch (e) {
      log.warn(CHANNELS.app, 'stored pending-build record is unreadable', {
        pendingId: id,
        detail: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }

  /** Create a fresh `building` record and return it. Appends `id` to the order (newest-first: new
   *  ids are unshifted, so `list()` needs no separate sort). Re-creating an id that already
   *  exists overwrites the record in place without duplicating the order entry. */
  create(input: CreatePendingBuildInput): PendingBuildRecord {
    const existed = this.get(input.id) != null;
    const now = Date.now();
    const record: PendingBuildRecord = {
      id: input.id,
      prompt: input.prompt,
      workingTitle: input.workingTitle,
      state: 'building',
      createdAt: now,
      updatedAt: now,
      ...(input.editingAppId ? { editingAppId: input.editingAppId } : {}),
    };
    this.kv.set(PENDING_KEY(input.id), JSON.stringify(record));
    if (!existed) {
      this.writeOrder([input.id, ...this.readOrder()]);
    }
    return record;
  }

  /** All records, newest first. Drops any dangling or corrupt order id (same idiom as
   *  `AppIndex.list`). */
  list(): PendingBuildRecord[] {
    const out: PendingBuildRecord[] = [];
    for (const id of this.readOrder()) {
      const rec = this.get(id);
      if (rec) out.push(rec);
    }
    return out;
  }

  /** Set a record's state to `failed` and persist the failure payload. A no-op (no throw) if the
   *  id has no record — the single-writer discipline means this should never happen in practice,
   *  but a missing/corrupt record must not crash the caller. */
  setFailed(id: string, failure: PendingBuildFailure): void {
    const rec = this.get(id);
    if (!rec) return;
    const updated: PendingBuildRecord = { ...rec, state: 'failed', failure, updatedAt: Date.now() };
    this.kv.set(PENDING_KEY(id), JSON.stringify(updated));
  }

  /** Drop a record and its order entry; survivors keep their relative order. A no-op if the id
   *  was never present. */
  delete(id: string): void {
    this.kv.delete(PENDING_KEY(id));
    this.writeOrder(this.readOrder().filter((x) => x !== id));
  }

  /**
   * Demote every `building` record to `interrupted`. MUST run once, before the first grid render,
   * at every app launch (spec "A live building record is demoted to interrupted at launch") — the
   * process that owned the generation stream is gone, so a `building` state can no longer be
   * truthful. `failed`/`interrupted` records are untouched. Corrupt records are skipped (already
   * logged by the underlying `get`).
   */
  demoteBuildingToInterrupted(): void {
    for (const id of this.readOrder()) {
      const rec = this.get(id);
      if (rec && rec.state === 'building') {
        const updated: PendingBuildRecord = { ...rec, state: 'interrupted', updatedAt: Date.now() };
        this.kv.set(PENDING_KEY(id), JSON.stringify(updated));
      }
    }
  }
}
