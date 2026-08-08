/**
 * dev-log — the device→host dev log envelope (obs-v1, design D6).
 *
 * The ONE sanctioned exception to `generation-contract`'s "schemas SHALL be zod values" rule, and
 * bounded to this module: it declares plain TypeScript types and **exports no runtime value**, so
 * importing it can never pull `zod` — or anything else — into a consumer's module graph. The
 * device imports it `import type` only; the server validates an incoming batch with a
 * hand-written structural guard. The absence of a zod schema is not permission to trust a body.
 *
 * Do not add a value export here, and do not extend the exception to another module: a product
 * wire shape gets a zod schema in `index.ts`.
 */

/** Ordered severities, lowest first. The seam's threshold compares by this order. */
export type DevLogLevel = 'debug' | 'info' | 'warn' | 'error';

/** One structured event. `fields` is already redacted by the device seam before it is buffered,
 *  so every reader (the overlay, this envelope, the host's log file) observes the same values. */
export interface DevLogRecord {
  /** Epoch milliseconds at emission. */
  readonly at: number;
  readonly level: DevLogLevel;
  /** A declared channel name (the device declares them in `src/host/logging/channels.ts`). */
  readonly channel: string;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** One POST body: a batch of records plus the moment the device sent them. */
export interface DevLogBatch {
  /** Epoch milliseconds at which the device attempted delivery. */
  readonly sentAt: number;
  readonly records: readonly DevLogRecord[];
}

/**
 * The log-sink route's path — the single written statement both sides implement. It is a TYPE, not
 * a constant, because this module exports no runtime value: each side writes the literal once and
 * annotates it with this alias, so a typo is a type error rather than a silent 404.
 *
 * Deliberately NOT under `/v1`: the "every `/v1` route is gated by `x-whim-device`" invariant must
 * read the same after this change, and this route is dev-only.
 */
export type DevLogSinkPath = '/dev/logs';
