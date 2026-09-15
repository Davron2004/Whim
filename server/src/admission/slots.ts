/**
 * server/src/admission/slots.ts — the in-memory slot controller (design D8; specs/server-admission-control
 * "A device runs at most one generation at a time", "Global concurrency caps protect the server").
 *
 * One controller per server process. It owns five pieces of state: the set of devices holding a
 * generation, the running-generation count, the in-flight unary (clarify/rewrite) count, the
 * in-flight `/healthz/sse` probe count (its own pool, see `MAX_CONCURRENT_PROBES`), and the
 * one-way `draining` flag. `acquire` applies the slice of the fixed admission order it owns —
 * drain state, then device generation exclusivity (generate only), then the global cap — and
 * either takes a slot or names why it did not. A refused acquire takes nothing.
 *
 * Every successful acquire hands back a handle whose `release()` is idempotent: the first call
 * frees the slot, every later call is a no-op. Routes can therefore release from every exit path
 * (terminal event, cancel, disconnect, throw, a later admission refusal) without counting how many
 * of those paths fired. All operations are O(1), so the caps may be raised freely.
 */

export type SlotKind = 'generate' | 'unary' | 'probe';

/**
 * The anonymous `/healthz/sse` probe's own tiny pool. It is deliberately NOT the unary pool: the
 * probe needs no device header and holds its slot for about three seconds, so counting it against
 * the paid clarify/rewrite pool lets a handful of anonymous requests per second starve every paying
 * device. Two is enough for an operator's smoke check plus an overlapping uptime monitor, and small
 * enough that flooding the probe wedges nothing but the probe.
 */
export const MAX_CONCURRENT_PROBES = 2;

/** Why an acquire took nothing. `draining` and `at_capacity` both surface as `429 server_busy`
 *  (no `Retry-After`); `device_busy` surfaces as `429 device_busy` (no `Retry-After`). */
export type SlotRefusalReason = 'draining' | 'device_busy' | 'at_capacity';

export interface SlotHandle {
  readonly kind: SlotKind;
  readonly deviceId: string;
  /** Frees the slot on the first call; a no-op on every later call, including after drain began. */
  release(): void;
}

export type AcquireResult =
  | { ok: true; handle: SlotHandle }
  | { ok: false; reason: SlotRefusalReason };

export interface SlotCounts {
  readonly generations: number;
  readonly unary: number;
  /** In-flight `/healthz/sse` probes, capped by `MAX_CONCURRENT_PROBES` independently of `unary`. */
  readonly probes: number;
  readonly draining: boolean;
}

export interface SlotLimits {
  /** `ServerConfig.maxConcurrentGenerations` — a positive integer. */
  maxConcurrentGenerations: number;
  /** `ServerConfig.maxConcurrentUnary` — a positive integer. */
  maxConcurrentUnary: number;
}

export interface SlotController {
  acquire(kind: SlotKind, deviceId: string): AcquireResult;
  /** Refuses every later acquire with `draining`. One-way; held handles still release normally. */
  startDraining(): void;
  isDraining(): boolean;
  counts(): SlotCounts;
}

function assertPositiveInteger(name: keyof SlotLimits, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${String(value)}`);
  }
}

export function createSlotController(limits: SlotLimits): SlotController {
  assertPositiveInteger('maxConcurrentGenerations', limits.maxConcurrentGenerations);
  assertPositiveInteger('maxConcurrentUnary', limits.maxConcurrentUnary);
  const { maxConcurrentGenerations, maxConcurrentUnary } = limits;

  const generatingDevices = new Set<string>();
  let generations = 0;
  let unary = 0;
  let probes = 0;
  let draining = false;

  function makeHandle(kind: SlotKind, deviceId: string, free: () => void): SlotHandle {
    let released = false;
    return {
      kind,
      deviceId,
      release() {
        if (released) return;
        released = true;
        free();
      },
    };
  }

  function acquire(kind: SlotKind, deviceId: string): AcquireResult {
    if (draining) return { ok: false, reason: 'draining' };

    if (kind === 'generate') {
      if (generatingDevices.has(deviceId)) return { ok: false, reason: 'device_busy' };
      if (generations >= maxConcurrentGenerations) return { ok: false, reason: 'at_capacity' };
      generatingDevices.add(deviceId);
      generations++;
      return {
        ok: true,
        handle: makeHandle(kind, deviceId, () => {
          generatingDevices.delete(deviceId);
          generations--;
        }),
      };
    }

    if (kind === 'probe') {
      if (probes >= MAX_CONCURRENT_PROBES) return { ok: false, reason: 'at_capacity' };
      probes++;
      return {
        ok: true,
        handle: makeHandle(kind, deviceId, () => {
          probes--;
        }),
      };
    }

    if (unary >= maxConcurrentUnary) return { ok: false, reason: 'at_capacity' };
    unary++;
    return {
      ok: true,
      handle: makeHandle(kind, deviceId, () => {
        unary--;
      }),
    };
  }

  return {
    acquire,
    startDraining() {
      draining = true;
    },
    isDraining: () => draining,
    counts: () => ({ generations, unary, probes, draining }),
  };
}
