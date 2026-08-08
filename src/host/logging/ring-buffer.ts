/**
 * ring-buffer — the seam's in-memory retention (obs-v1, spec "Every log record is a structured
 * event held in a bounded ring buffer").
 *
 * Fixed capacity, oldest evicted, never persisted to disk. `snapshot()` hands back a frozen array
 * of frozen records taken in one synchronous pass, so a reader (the overlay, the sink) can never
 * observe a half-written record and a snapshot it holds does not change when more records arrive.
 */

// TYPE-ONLY import of the contract package's type-only dev-log module (design D6). Reached by
// path rather than through `@whim/contract`'s entry so not even the barrel — and therefore
// never zod — can enter the Metro graph; `import type` erases it entirely regardless.
import type { DevLogRecord } from '../../../contract/src/dev-log';

/** How many records the device keeps. Chosen to cover a whole generation round-trip's
 *  breadcrumbs while staying trivially bounded in memory. */
export const RING_CAPACITY = 500;

export class LogRing {
  private readonly records: DevLogRecord[] = [];

  constructor(readonly capacity: number = RING_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`LogRing capacity must be a positive integer (got ${String(capacity)})`);
    }
  }

  /** Append one record, evicting the oldest when the buffer is full. The record is frozen on the
   *  way in — a reader shares the object with the buffer and must not be able to change it. */
  push(record: DevLogRecord): DevLogRecord {
    const frozen = Object.freeze({ ...record, fields: Object.freeze({ ...record.fields }) });
    this.records.push(frozen);
    while (this.records.length > this.capacity) {
      this.records.shift();
    }
    return frozen;
  }

  /** Oldest-first, stable: later pushes do not mutate an already-returned snapshot. */
  snapshot(): readonly DevLogRecord[] {
    return Object.freeze(this.records.slice());
  }

  /** How many records are currently retained. */
  get size(): number {
    return this.records.length;
  }

  /** Drop everything (the overlay's clear affordance; tests). */
  clear(): void {
    this.records.length = 0;
  }
}
