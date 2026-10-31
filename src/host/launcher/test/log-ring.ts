import { log } from '../../logging';
import { CHANNELS } from '../../logging/channels';
import { RING_CAPACITY } from '../../logging/ring-buffer';

/** Reads the records logged after this call. The process-wide ring holds `RING_CAPACITY` records and
 *  drops the oldest, so a test cannot slice from `buffer.size` or `snapshot().length`: once an earlier
 *  suite filled the ring, that index points past the end. Records are frozen, distinct objects, so
 *  "not in the snapshot taken here" names exactly the new ones, however full the ring was. A test that
 *  logs more than `RING_CAPACITY` records itself would still lose its oldest. */
export function recordsSince(): () => ReturnType<typeof log.buffer.snapshot> {
  const seen = new Set(log.buffer.snapshot());
  return () => log.buffer.snapshot().filter((record) => !seen.has(record));
}

/** Leaves the ring full, as a long suite before the caller would: more records than it holds. */
export function fillRing(): void {
  for (let i = 0; i < RING_CAPACITY + 100; i++) {
    log.buffer.push({ at: 0, level: 'debug', channel: CHANNELS.gen, message: 'ring filler', fields: { i } });
  }
}
