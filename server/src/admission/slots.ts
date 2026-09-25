/**
 * server/src/admission/slots.ts — the in-memory slot controller (design D8; specs/server-admission-control
 * "A device runs at most one generation at a time", "Global concurrency caps protect the server",
 * beta-1 "A generation that finds every slot busy waits in line on its stream").
 *
 * One controller per server process. It owns six pieces of state: the set of devices holding or
 * waiting for a generation, the running-generation count, the line of generations waiting for a
 * generation slot, the in-flight unary (clarify/rewrite) count, the in-flight `/healthz/sse` probe
 * count (its own pool, see `SlotLimits.maxConcurrentProbes`), and the one-way `draining` flag.
 * `acquire` applies the slice of the fixed admission order it owns — drain state, then device
 * generation exclusivity (generate only), then the global cap — and either takes a slot or names why
 * it did not. A refused acquire takes nothing. `acquireInLine` is the generate route's version of the
 * same step: where `acquire` refuses at the cap, it joins a first-come-first-served line instead,
 * refusing only once the line holds `maxQueuedGenerations`. A waiting device counts as generating,
 * so one device can never hold more than one place.
 *
 * Every successful acquire hands back a handle whose `release()` is idempotent: the first call
 * frees the slot, every later call is a no-op. Routes can therefore release from every exit path
 * (terminal event, cancel, disconnect, throw, a later admission refusal) without counting how many
 * of those paths fired. Freeing a generation slot hands it straight to the head of the line. The
 * slot operations are O(1); the line's are O(line length), which `maxQueuedGenerations` bounds.
 */

export type SlotKind = 'generate' | 'unary' | 'probe';

/**
 * The default size of the anonymous `/healthz/sse` probe's own tiny pool — `ServerConfig`'s
 * `WHIM_LIMIT_PROBE_CONCURRENCY` default, repeated here so a controller built without a
 * `ServerConfig` (tests, the app's own fallback) gets the same number. It is deliberately NOT the
 * unary pool: the probe needs no device header and holds its slot for about three seconds, so
 * counting it against the paid clarify/rewrite pool lets a handful of anonymous requests per second
 * starve every paying device. Two is enough for an operator's smoke check plus an overlapping
 * uptime monitor, and small enough that flooding the probe wedges nothing but the probe.
 */
export const DEFAULT_MAX_CONCURRENT_PROBES = 2;

/** The default length of the generation line — `ServerConfig`'s `WHIM_QUEUE_MAX` default, repeated
 *  here for the same reason as `DEFAULT_MAX_CONCURRENT_PROBES`. */
export const DEFAULT_MAX_QUEUED_GENERATIONS = 50;

/** Why an acquire took nothing. `draining` and `at_capacity` both surface as `429 server_busy`
 *  (no `Retry-After`); `device_busy` surfaces as `429 device_busy` (no `Retry-After`). For
 *  `acquireInLine`, `at_capacity` means the line is full. */
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

/** Why a ticket left the line without a slot: it left (`LineTicket.leave`), or the server began
 *  draining. */
export type LineExit = 'left' | 'draining';

export type LineOutcome =
  | { readonly ok: true; readonly handle: SlotHandle }
  | { readonly ok: false; readonly reason: LineExit };

/** A generation's place in the line. */
export interface LineTicket {
  /** Generations ahead of it in the line, plus one; `0` once it has left the line, with a slot or
   *  without one. */
  position(): number;
  /** Calls `listener` with the new position each time the ticket moves up. Returns the unsubscribe. */
  onMove(listener: (position: number) => void): () => void;
  /** Settles once the ticket leaves the line: with the generation slot it was handed, or with why
   *  it has none. Never rejects. */
  readonly outcome: Promise<LineOutcome>;
  /** Gives up: leaves the line, or gives back the slot it was handed, which then goes to the next
   *  waiter. Idempotent. A slot handed over in the same turn is never delivered: `outcome` then
   *  settles `left`. */
  leave(): void;
}

export type LineEntry =
  | { readonly kind: 'slot'; readonly handle: SlotHandle }
  | { readonly kind: 'line'; readonly ticket: LineTicket }
  | { readonly kind: 'refused'; readonly reason: SlotRefusalReason };

export interface SlotCounts {
  readonly generations: number;
  /** Generations waiting in line for a generation slot. */
  readonly queued: number;
  readonly unary: number;
  /** In-flight `/healthz/sse` probes, capped by `maxConcurrentProbes` independently of `unary`. */
  readonly probes: number;
  readonly draining: boolean;
}

export interface SlotLimits {
  /** `ServerConfig.maxConcurrentGenerations` — a positive integer. */
  maxConcurrentGenerations: number;
  /** `ServerConfig.maxConcurrentUnary` — a positive integer. */
  maxConcurrentUnary: number;
  /** `ServerConfig.maxConcurrentProbes` — a positive integer; `DEFAULT_MAX_CONCURRENT_PROBES`
   *  when omitted. */
  maxConcurrentProbes?: number;
  /** `ServerConfig.queueMax` — a non-negative integer, `0` meaning no line;
   *  `DEFAULT_MAX_QUEUED_GENERATIONS` when omitted. */
  maxQueuedGenerations?: number;
}

export interface SlotController {
  acquire(kind: SlotKind, deviceId: string): AcquireResult;
  /**
   * `generate` only. Drain state, then device exclusivity, then: a free slot with nobody waiting
   * is taken at once (`slot`); otherwise the generation joins the back of the line (`line`), unless
   * the line already holds `maxQueuedGenerations` (`at_capacity`). The device counts as busy from
   * here until the ticket leaves the line without a slot or the slot it gets is released.
   */
  acquireInLine(deviceId: string): LineEntry;
  /** Refuses every later acquire with `draining` and empties the line: every waiting ticket settles
   *  `draining`. One-way; held handles still release normally. */
  startDraining(): void;
  isDraining(): boolean;
  counts(): SlotCounts;
}

function assertPositiveInteger(name: keyof SlotLimits, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${String(value)}`);
  }
}

/** A generation waiting in line (`waiting`), handed a slot (`holding`), or gone without one. */
interface Waiter {
  readonly deviceId: string;
  state: 'waiting' | 'holding' | 'gone';
  handle: SlotHandle | undefined;
  /** The position its listeners last heard. */
  heard: number;
  readonly listeners: Set<(position: number) => void>;
  readonly settle: (outcome: LineOutcome) => void;
  readonly ticket: LineTicket;
}

export function createSlotController(limits: SlotLimits): SlotController {
  assertPositiveInteger('maxConcurrentGenerations', limits.maxConcurrentGenerations);
  assertPositiveInteger('maxConcurrentUnary', limits.maxConcurrentUnary);
  const maxConcurrentProbes = limits.maxConcurrentProbes ?? DEFAULT_MAX_CONCURRENT_PROBES;
  assertPositiveInteger('maxConcurrentProbes', maxConcurrentProbes);
  const maxQueuedGenerations = limits.maxQueuedGenerations ?? DEFAULT_MAX_QUEUED_GENERATIONS;
  if (!Number.isInteger(maxQueuedGenerations) || maxQueuedGenerations < 0) {
    throw new RangeError(`maxQueuedGenerations must be a non-negative integer, got ${String(maxQueuedGenerations)}`);
  }
  const { maxConcurrentGenerations, maxConcurrentUnary } = limits;

  const generatingDevices = new Set<string>();
  const line: Waiter[] = [];
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

  /** Takes a generation slot for a device already counted in `generatingDevices`. */
  function generationHandle(deviceId: string): SlotHandle {
    generations++;
    return makeHandle('generate', deviceId, () => {
      generatingDevices.delete(deviceId);
      generations--;
      handOff();
    });
  }

  /** Tells every waiter whose position changed since it last heard. */
  function notifyMoves(): void {
    for (const waiter of [...line]) {
      const position = line.indexOf(waiter) + 1;
      if (position === 0 || position === waiter.heard) continue;
      waiter.heard = position;
      for (const listener of [...waiter.listeners]) listener(position);
    }
  }

  /** Gives every free generation slot to the head of the line, then tells whoever moved up. */
  function handOff(): void {
    while (generations < maxConcurrentGenerations) {
      const next = line.shift();
      if (next === undefined) break;
      next.state = 'holding';
      const handle = generationHandle(next.deviceId);
      next.handle = handle;
      // Delivered a microtask later, so a `leave()` in the same turn as the handoff still passes the
      // slot on and settles `left` (a promise keeps its first settlement).
      queueMicrotask(() => next.settle({ ok: true, handle }));
    }
    notifyMoves();
  }

  function leave(waiter: Waiter): void {
    if (waiter.state === 'waiting') {
      line.splice(line.indexOf(waiter), 1);
      generatingDevices.delete(waiter.deviceId);
      waiter.state = 'gone';
      waiter.settle({ ok: false, reason: 'left' });
      notifyMoves();
    } else if (waiter.state === 'holding') {
      waiter.state = 'gone';
      waiter.settle({ ok: false, reason: 'left' });
      waiter.handle?.release();
    }
  }

  function joinLine(deviceId: string): LineTicket {
    let settle!: (outcome: LineOutcome) => void;
    const outcome = new Promise<LineOutcome>((resolve) => {
      settle = resolve;
    });
    const waiter: Waiter = {
      deviceId,
      state: 'waiting',
      handle: undefined,
      heard: line.length + 1,
      listeners: new Set(),
      settle,
      ticket: {
        position: () => (waiter.state === 'waiting' ? line.indexOf(waiter) + 1 : 0),
        onMove(listener) {
          waiter.listeners.add(listener);
          return () => {
            waiter.listeners.delete(listener);
          };
        },
        outcome,
        leave: () => leave(waiter),
      },
    };
    generatingDevices.add(deviceId);
    line.push(waiter);
    return waiter.ticket;
  }

  function acquireInLine(deviceId: string): LineEntry {
    if (draining) return { kind: 'refused', reason: 'draining' };
    if (generatingDevices.has(deviceId)) return { kind: 'refused', reason: 'device_busy' };
    if (generations < maxConcurrentGenerations && line.length === 0) {
      generatingDevices.add(deviceId);
      return { kind: 'slot', handle: generationHandle(deviceId) };
    }
    if (line.length >= maxQueuedGenerations) return { kind: 'refused', reason: 'at_capacity' };
    return { kind: 'line', ticket: joinLine(deviceId) };
  }

  function acquire(kind: SlotKind, deviceId: string): AcquireResult {
    if (draining) return { ok: false, reason: 'draining' };

    if (kind === 'generate') {
      if (generatingDevices.has(deviceId)) return { ok: false, reason: 'device_busy' };
      if (generations >= maxConcurrentGenerations) return { ok: false, reason: 'at_capacity' };
      generatingDevices.add(deviceId);
      return { ok: true, handle: generationHandle(deviceId) };
    }

    if (kind === 'probe') {
      if (probes >= maxConcurrentProbes) return { ok: false, reason: 'at_capacity' };
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
    acquireInLine,
    startDraining() {
      draining = true;
      for (const waiter of line.splice(0)) {
        generatingDevices.delete(waiter.deviceId);
        waiter.state = 'gone';
        waiter.settle({ ok: false, reason: 'draining' });
      }
    },
    isDraining: () => draining,
    counts: () => ({ generations, queued: line.length, unary, probes, draining }),
  };
}
