import type { TimerLike } from '../connectivity';

/** A fake `TimerLike` with exactly the control a suite needs: fire the single pending timer on
 *  demand, and read back every delay `setTimeout` was called with. Never schedules against the
 *  real clock, so nothing using it can hang or flake on wall-clock timing. */
export class FakeTimers implements TimerLike {
  private nextId = 1;
  private readonly pending = new Map<number, () => void>();
  readonly delays: number[] = [];

  setTimeout = (cb: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.pending.set(id, cb);
    this.delays.push(ms);
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.pending.delete(handle as number);
  };

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Fire the one pending timer. Throws if there isn't exactly one, so a regression that
   *  schedules a second timer is caught rather than firing the wrong one silently. */
  fireOnly(): void {
    const entries = [...this.pending.entries()];
    if (entries.length !== 1) {
      throw new Error(`expected exactly one pending timer, found ${entries.length}`);
    }
    const [id, cb] = entries[0];
    this.pending.delete(id);
    cb();
  }
}
