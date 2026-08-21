/**
 * sink — best-effort batched delivery of log records to the dev server (obs-v1, spec "Batched
 * delivery to the dev sink is best-effort and never affects the app"; design D4/D5).
 *
 * Rules this file exists to hold:
 *   - OFF unless explicitly enabled. `__DEV__` is `false` in this project's working build recipe
 *     (release APK), so the gate is an explicit flag — a network transport must not switch itself
 *     on because someone happened to run Metro.
 *   - The destination is the server address the device already persists for `/v1/generate`
 *     (reached over `adb reverse`), on the dev-log path. No second address, no new setting.
 *   - Bounded by BOTH a record count and a flush interval, and bounded in memory: when more
 *     records pile up than `maxPending`, the OLDEST pending are dropped rather than growing.
 *   - A delivery failure never throws into the caller, is never retried, and is reported once
 *     through `onFailure` (the seam turns that into a ring-buffer record on the sink channel).
 *     Records on the sink's own channel are never enqueued, so a failure report cannot recurse
 *     into another delivery attempt.
 */

// `@whim/contract` is a TYPE-ONLY import (design D6) — importing the zod schema VALUES would pull
// zod into the Metro graph. `import type` erases the statement entirely, so nothing crosses.
import type { DevLogBatch, DevLogRecord, DevLogSinkPath } from '@whim/contract';
import { CHANNELS } from './channels';

/** The one written statement of the route on the device side; the alias comes from the contract
 *  module, so the device and the server cannot drift apart on it. */
const SINK_PATH: DevLogSinkPath = '/dev/logs';

/** How a batch reaches the host. Injectable so the suite can run an unreachable/refusing host
 *  without a socket; defaults to the global `fetch`. */
export type PostBatch = (url: string, body: string) => Promise<{ ok: boolean; status: number }>;

export interface SinkOptions {
  /** The explicit flag. `false` unless a build turns it on — a shipping build never has it. */
  enabled: boolean;
  /** The persisted server address, e.g. `http://127.0.0.1:8787`. Without one the sink stays idle. */
  baseUrl?: string;
  /** Flush as soon as this many records are pending. */
  maxBatch: number;
  /** Flush at most this long after the first pending record. */
  flushIntervalMs: number;
  /** Hard bound on the pending queue; the oldest are dropped past it. */
  maxPending: number;
  post: PostBatch;
  now: () => number;
  /** Reported once per failed delivery. Must not throw and must not re-enter the sink. */
  onFailure: (message: string, fields: Record<string, unknown>) => void;
}

const DEFAULTS: Omit<SinkOptions, 'post' | 'onFailure'> = {
  enabled: false,
  baseUrl: undefined,
  maxBatch: 50,
  flushIntervalMs: 5000,
  maxPending: 200,
  now: () => Date.now(),
};

async function fetchPost(url: string, body: string): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  return { ok: res.ok, status: res.status };
}

export class DevLogSink {
  private options: SinkOptions;
  private pending: DevLogRecord[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Deliveries attempted, successful or not — the suite's evidence that a failure is not retried. */
  attempts = 0;
  /** Records dropped because the pending queue was full. */
  dropped = 0;

  constructor(options: Partial<SinkOptions> = {}) {
    this.options = {
      ...DEFAULTS,
      post: fetchPost,
      onFailure: () => undefined,
      ...options,
    };
  }

  /** True only when explicitly enabled AND an address is configured. */
  get active(): boolean {
    return this.options.enabled && typeof this.options.baseUrl === 'string' && this.options.baseUrl.length > 0;
  }

  /** The URL a batch is POSTed to, or `undefined` when the sink is idle. */
  get endpoint(): string | undefined {
    let base = this.options.baseUrl;
    if (base == null || base.length === 0) {
      return undefined;
    }
    while (base.endsWith('/')) {
      base = base.slice(0, -1);
    }
    return base + SINK_PATH;
  }

  /** Turn the sink on/off or point it at the persisted address. Turning it off drops what is
   *  pending — a disabled sink holds nothing and sends nothing. */
  configure(patch: Partial<SinkOptions>): void {
    this.options = { ...this.options, ...patch };
    if (!this.active) {
      this.cancelTimer();
      this.pending = [];
    }
  }

  /** Queue one already-redacted record. Never throws; a no-op while the sink is idle. */
  enqueue(record: DevLogRecord): void {
    if (!this.active || record.channel === CHANNELS.sink) {
      return;
    }
    this.pending.push(record);
    while (this.pending.length > this.options.maxPending) {
      this.pending.shift();
      this.dropped++;
    }
    if (this.pending.length >= this.options.maxBatch) {
      this.fireFlush();
      return;
    }
    this.scheduleFlush();
  }

  /** Deliver everything pending as ONE request. Never rejects; a failure is reported, the batch
   *  is dropped, and nothing is retried. */
  async flush(): Promise<void> {
    this.cancelTimer();
    const batchRecords = this.pending;
    const url = this.endpoint;
    if (batchRecords.length === 0 || url == null) {
      return;
    }
    this.pending = [];
    const batch: DevLogBatch = { sentAt: this.options.now(), records: batchRecords };
    this.attempts++;
    try {
      const res = await this.options.post(url, JSON.stringify(batch));
      if (!res.ok) {
        this.report('dev log sink rejected a batch',{ status: res.status, records: batchRecords.length });
      }
    } catch (err) {
      this.report('dev log sink delivery failed', {
        errorClass: (err as Error)?.name ?? 'Error',
        detail: (err as Error)?.message ?? String(err),
        records: batchRecords.length,
      });
    }
  }

  /** Stop the interval and forget what is pending (unmount / disable). */
  stop(): void {
    this.cancelTimer();
    this.pending = [];
  }

  private report(message: string, fields: Record<string, unknown>): void {
    try {
      this.options.onFailure(message, fields);
      // eslint-disable-next-line no-restricted-syntax -- intentional: the failure reporter is the seam's last line; if reporting itself throws there is nowhere left to report to, and a logging call must never take the app down with it.
    } catch {
      // deliberately silent — see the disable comment above
    }
  }

  /** Flush without a caller to await it. `flush` already swallows every delivery failure; the
   *  trailing handler exists so a future bug in it can still never reach an unhandled rejection. */
  private fireFlush(): void {
    this.flush().catch(() => undefined);
  }

  private scheduleFlush(): void {
    if (this.timer != null) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.fireFlush();
    }, this.options.flushIntervalMs);
  }

  private cancelTimer(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
