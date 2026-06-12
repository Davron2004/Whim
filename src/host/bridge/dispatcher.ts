/**
 * capability-bridge — the RPC dispatcher (Decision #41, D3). Pure host-side logic: it owns
 * envelope validation, the gate handoff, request-ID dedup, the realm-generation fences, and
 * turning a handler outcome (or refusal) into a structured `sysret`. It is transport-agnostic
 * — `handle(frame)` returns the `sysret` (or null when the frame is dropped); the RN host
 * injects it back into the iframe, the Node test reads it directly, the invariant-suite host
 * shim returns it from an exposed function. No postMessage knowledge lives here.
 *
 * D3 semantics, written once for EVERY present and future capability:
 *   • Correlation — the stub assigns the id; the dispatcher echoes it on `sysret`.
 *   • Idempotent delivery — a bounded per-realm-generation LRU of `id → outcome`; a duplicate
 *     id REPLAYS the recorded outcome without re-running the handler (a retried `append` cannot
 *     double-append). A duplicate that arrives while the first is still in flight awaits it.
 *   • Generation fences — a frame stamped with a stale generation is dropped; a handler result
 *     that completes after its realm was torn down is discarded, never delivered into the
 *     successor realm (constraint #5 extended to the bridge).
 */

import {
  classifyFrame,
  errSysret,
  okSysret,
  RealmRecord,
  SyscallFrame,
  SysretFrame,
  validateSyscall,
} from './contract';
import { CapabilityRegistry } from './registry';
import { StorageEngineError } from '../storage-engine/contract';
import { PermissionHook, ALLOW_ALL, runGate } from './gate';

const DEFAULT_DEDUP_LIMIT = 256;

interface DedupEntry {
  /** Resolves to the recorded outcome once the handler/gate completes (in-flight de-dup too).
   *  null means the frame was dropped post-hoc (realm torn down mid-flight) — deliver nothing. */
  promise: Promise<SysretFrame | null>;
}

export interface DispatcherOptions {
  realm: RealmRecord;
  registry: CapabilityRegistry;
  permissionHook?: PermissionHook;
  /** Bounded dedup map size per realm generation (D3); whole map dropped on teardown. */
  dedupLimit?: number;
}

export class Dispatcher {
  private readonly realm: RealmRecord;
  private readonly registry: CapabilityRegistry;
  private readonly permissionHook: PermissionHook;
  private readonly dedupLimit: number;
  /** id → outcome, insertion-ordered so the oldest entry evicts first (a plain bounded LRU). */
  private readonly dedup = new Map<number, DedupEntry>();

  constructor(opts: DispatcherOptions) {
    this.realm = opts.realm;
    this.registry = opts.registry;
    this.permissionHook = opts.permissionHook ?? ALLOW_ALL;
    this.dedupLimit = opts.dedupLimit ?? DEFAULT_DEDUP_LIMIT;
  }

  /**
   * Handle one inbound frame. Returns the `sysret` to deliver, or null when the frame is
   * dropped (not a syscall, stale generation, torn-down realm, or uncorrelatable malformed).
   */
  async handle(raw: string | object): Promise<SysretFrame | null> {
    const parsed = typeof raw === 'string' ? safeParse(raw) : raw;
    if (parsed === undefined) return null;

    // Family separation (D1): the dispatcher interprets ONLY syscall frames. A control or
    // sysret frame here is not ours — drop it untouched.
    if (classifyFrame(parsed) !== 'syscall') return null;

    const v = validateSyscall(parsed);
    if (!v.ok) {
      // Correlatable malformed → a structured denial; otherwise nothing to answer.
      if (v.id === null) return null;
      return errSysret(v.id, { kind: 'malformed_envelope', hint: `Malformed syscall envelope: ${v.reason}.` });
    }
    const frame = v.frame;

    // Generation fence (D3): a frame from a previous generation is dropped — the marshaller in
    // the live realm stamps the current generation; anything else is stale.
    if (frame.gen !== this.realm.generation) return null;

    // Idempotent delivery (D3): replay a recorded/in-flight outcome without re-running.
    const existing = this.dedup.get(frame.id);
    if (existing) return existing.promise;

    const entry: DedupEntry = { promise: this.execute(frame) };
    this.remember(frame.id, entry);
    return entry.promise;
  }

  /** Bind a fresh dispatcher state to a new generation isn't needed — a generation reset means
   *  a NEW Dispatcher over the NEW realm record (fresh dedup + fresh id space). This method
   *  exists only to make the lifecycle explicit for the host wiring. */
  static forRealm(realm: RealmRecord, registry: CapabilityRegistry, permissionHook?: PermissionHook): Dispatcher {
    return new Dispatcher({ realm, registry, permissionHook });
  }

  private async execute(frame: SyscallFrame): Promise<SysretFrame | null> {
    const gate = await runGate(frame, this.realm, this.registry, this.permissionHook);
    if (!gate.ok) {
      return errSysret(frame.id, gate.error);
    }
    try {
      const result = await gate.row.handler(frame.params, this.realm);
      // Teardown fence (D3): if the realm was torn down or rolled to a new generation while
      // this handler ran, DISCARD the result entirely — deliver nothing, so the successor realm
      // never observes a response it did not request.
      if (!this.realm.alive || frame.gen !== this.realm.generation) return null;
      return okSysret(frame.id, (result ?? null) as never);
    } catch (err) {
      // An engine refusal (StorageEngineError) surfaces its structured detail verbatim, so the
      // bundle sees `unknown_field`/`unknown_collection`/… directly (the end-to-end injection
      // property). Any other throw is a generic, non-leaky handler error.
      if (err instanceof StorageEngineError) {
        return errSysret(frame.id, err.detail);
      }
      return errSysret(frame.id, {
        kind: 'handler_error',
        method: frame.method,
        hint: `"${frame.method}" failed: ${(err as Error)?.message ?? 'unknown error'}.`,
      });
    }
  }

  private remember(id: number, entry: DedupEntry): void {
    this.dedup.set(id, entry);
    while (this.dedup.size > this.dedupLimit) {
      const oldest = this.dedup.keys().next().value as number | undefined;
      if (oldest === undefined) break;
      this.dedup.delete(oldest);
    }
  }
}

/**
 * Reset a realm record for a new generation (D3): fence the old generation (so any late result
 * is discarded), bump the counter, mark alive. The caller then builds a NEW Dispatcher over the
 * same record — which gives the new generation an empty dedup map and a fresh id space.
 */
export function resetRealmGeneration(realm: RealmRecord): void {
  realm.alive = false; // fence in-flight results from the old generation
  realm.generation += 1;
  realm.alive = true;
}

/** Permanently tear a realm down (the app is closed, not reset). Any handler still in flight
 *  resolves to a dropped (null) outcome — its result is never delivered. */
export function tearDownRealm(realm: RealmRecord): void {
  realm.alive = false;
}

function safeParse(s: string): object | undefined {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}
