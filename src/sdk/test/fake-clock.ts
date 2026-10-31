// A manual clock for the SDK suites whose components keep time (Stepper's hold-to-repeat, toast's
// 4 s): it replaces the global timer functions the components call, and `advance` runs what falls
// due in order. React keeps its own scheduler handles, captured at load, so only SDK timers move.
// Not a suite (no `.acceptance` suffix): `run.mjs` bundles it into the suites that import it.

export interface FakeClock {
  /** Run every timer due within the next `ms`, in time order, then stop at now + `ms`. */
  advance(ms: number): void;
  /** Timers still scheduled. */
  pending(): number;
  /** Put the real timer functions back. */
  restore(): void;
}

interface Timer {
  at: number;
  fn: () => void;
  every?: number;
}

export function installFakeClock(): FakeClock {
  const g = globalThis as unknown as Record<'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval', unknown>;
  const real = { setTimeout: g.setTimeout, clearTimeout: g.clearTimeout, setInterval: g.setInterval, clearInterval: g.clearInterval };
  const timers = new Map<number, Timer>();
  let now = 0;
  let nextId = 0;

  const schedule = (fn: () => void, ms: unknown, repeat: boolean): number => {
    nextId += 1;
    const delay = typeof ms === 'number' && ms > 0 ? ms : 0;
    timers.set(nextId, { at: now + delay, fn, ...(repeat ? { every: Math.max(1, delay) } : {}) });
    return nextId;
  };
  const cancel = (id: unknown): void => {
    if (typeof id === 'number') timers.delete(id);
  };
  g.setTimeout = (fn: () => void, ms?: number) => schedule(fn, ms, false);
  g.setInterval = (fn: () => void, ms?: number) => schedule(fn, ms, true);
  g.clearTimeout = cancel;
  g.clearInterval = cancel;

  return {
    advance(ms: number): void {
      const end = now + ms;
      for (;;) {
        let dueId: number | undefined;
        let due: Timer | undefined;
        for (const [id, timer] of timers) {
          if (timer.at <= end && (due === undefined || timer.at < due.at)) {
            dueId = id;
            due = timer;
          }
        }
        if (dueId === undefined || due === undefined) break;
        now = due.at;
        if (due.every === undefined) timers.delete(dueId);
        else due.at += due.every;
        due.fn();
      }
      now = end;
    },
    pending: () => timers.size,
    restore(): void {
      Object.assign(g, real);
    },
  };
}
