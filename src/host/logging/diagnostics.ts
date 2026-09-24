/**
 * diagnostics — the seam's second network transport: error records, projected onto the allowlist,
 * uploaded to `POST /v1/diagnostics` (developer-observability D3/D4; spec device-diagnostics
 * "Error-level records are uploaded, batched, deduplicated and capped" and "Uploads require a
 * current AI-data consent grant").
 *
 * Rules this file exists to hold:
 *   - `error` level only, and never a record on the sink's own channel.
 *   - No request, and nothing retained, unless `target()` says an upload is allowed right now. It
 *     is asked at every record and again before every POST, so a consent revoked or a switch
 *     turned off a moment ago applies to the very next decision. A record that arrives while the
 *     answer is no is discarded, never queued for a later grant.
 *   - One entry per `(channel, message, errorClass, where)` for the whole app session; repeats
 *     bump its count, and a flush sends only the count added since the previous flush. At most
 *     `maxDistinct` entries per session; later distinct records are dropped.
 *   - A flush is one POST with no retry. A failure is reported once through `onFailure` (the seam
 *     records it on the sink channel, which this transport never takes), so it cannot recurse.
 *   - A `429` stops uploads: until its `Retry-After` has passed, or for the rest of the app session
 *     when it names no delta-seconds window. What is refused, waiting, or logged meanwhile is
 *     discarded, never queued for later.
 *
 * No React Native import: the seam and the Node suite load this directly.
 */

// `@whim/contract` is a TYPE-ONLY import (design D6) — importing the zod schema VALUES would pull
// zod into the Metro graph. `import type` erases the statement entirely, so nothing crosses.
import type { DevLogRecord, DiagnosticRecord, DiagnosticsBatch } from '@whim/contract';
import { CHANNELS } from './channels';
import { DIAGNOSTIC_STRING_MAX, toDiagnostic } from './diagnostic';

/** The route every upload is POSTed to, relative to the server address. */
export const DIAGNOSTICS_PATH = '/v1/diagnostics';

/** Where an allowed upload goes: the server address and the full `/v1` request headers
 *  (device id, envelope, consent version). */
export interface DiagnosticsTarget {
  readonly baseUrl: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** What the server answered: its status, and its `Retry-After` header when it sent one. */
export interface DiagnosticsResponse {
  ok: boolean;
  status: number;
  retryAfter?: string | null;
}

/** How a batch reaches the server. Injectable so the suite can run a refusing or unreachable
 *  server without a socket; defaults to the global `fetch`. */
export type PostDiagnostics = (
  url: string,
  headers: Readonly<Record<string, string>>,
  body: string,
) => Promise<DiagnosticsResponse>;

export interface DiagnosticsOptions {
  /** The upload gate: where to send, or `null` when no upload is allowed right now. */
  target: () => DiagnosticsTarget | null;
  /** The phone's OS version, the one field a batch carries beside its records. */
  osVersion: string;
  post: PostDiagnostics;
  /** Flush as soon as this many distinct records have something to send. */
  maxBatch: number;
  /** Flush at most this long after the first record waiting to be sent. */
  flushIntervalMs: number;
  /** Distinct records kept per app session; later ones are dropped. */
  maxDistinct: number;
  /** The largest body the server accepts (the contract's `DIAGNOSTICS_MAX_BODY_BYTES`). */
  maxBodyBytes: number;
  /** Reported once per failed upload. Must not throw and must not re-enter this transport. */
  onFailure: (message: string, fields: Record<string, unknown>) => void;
  /** The clock a `Retry-After` window is measured on. */
  now: () => number;
}

const DEFAULTS: Omit<DiagnosticsOptions, 'post' | 'onFailure'> = {
  target: () => null,
  osVersion: 'unknown',
  maxBatch: 20,
  flushIntervalMs: 30_000,
  maxDistinct: 50,
  maxBodyBytes: 32 * 1024,
  now: () => Date.now(),
};

/** The status that stops uploads (the route's daily allowances, spec device-diagnostics). */
const TOO_MANY_REQUESTS = 429;

/** A `Retry-After` in HTTP's delta-seconds form, as milliseconds; `undefined` for anything else.
 *  The HTTP-date form is deliberately not parsed, as in `transport-shared.ts`'s
 *  `retryAfterSecondsOf` (`Date.parse` differs between Hermes and V8); here an unparsed window
 *  means the stricter answer: no more uploads this session. */
function retryAfterMs(value: string | null | undefined): number | undefined {
  if (value == null || !/^\d+$/.test(value.trim())) return undefined;
  return Number(value.trim()) * 1000;
}

async function fetchPost(
  url: string,
  headers: Readonly<Record<string, string>>,
  body: string,
): Promise<DiagnosticsResponse> {
  const res = await fetch(url, { method: 'POST', headers: { ...headers }, body });
  return { ok: res.ok, status: res.status, retryAfter: res.headers.get('retry-after') };
}

/** The UTF-8 length of `text`, which is what the server's body limit counts. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i) as number;
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0x10000) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** The upload URL for a server address, however many trailing slashes it was saved with. */
function endpointOf(baseUrl: string): string {
  let base = baseUrl;
  while (base.endsWith('/')) base = base.slice(0, -1);
  return base + DIAGNOSTICS_PATH;
}

interface Entry {
  /** The first projection of this record, with `at` moved to its latest occurrence. */
  record: DiagnosticRecord;
  /** Occurrences this session. */
  total: number;
  /** Occurrences already sent (or discarded). */
  sent: number;
}

function dedupKey(record: DiagnosticRecord): string {
  return JSON.stringify([record.channel, record.message, record.errorClass ?? null, record.where ?? null]);
}

export class DiagnosticsTransport {
  private options: DiagnosticsOptions;
  private readonly entries = new Map<string, Entry>();
  /** Keys with occurrences not yet sent, in first-arrival order. */
  private readonly waiting = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Set while `target()` runs, so a record it logs cannot re-enter the gate. */
  private deciding = false;
  /** When uploads may resume after a `429`; `Infinity` for the rest of the session. */
  private pausedUntil: number | undefined;
  /** Uploads attempted, successful or not — the suite's evidence that a failure is not retried. */
  attempts = 0;
  /** Distinct records dropped because the session cap was reached. */
  dropped = 0;

  constructor(options: Partial<DiagnosticsOptions> = {}) {
    this.options = { ...DEFAULTS, post: fetchPost, onFailure: () => undefined, ...options };
  }

  configure(patch: Partial<DiagnosticsOptions>): void {
    this.options = { ...this.options, ...patch };
  }

  /** Whether an upload is allowed right now. A gate that throws, or is re-entered by a record it
   *  logs itself, answers no. */
  allowed(): boolean {
    return this.currentTarget() !== null;
  }

  /** Take one redacted seam record. Never throws. */
  enqueue(record: DevLogRecord): void {
    if (record.level !== 'error' || record.channel === CHANNELS.sink) return;
    if (this.paused() || !this.allowed()) return;
    this.add(toDiagnostic(record));
  }

  /** Take a record that is already projected (the fatal-error slot read back at launch). */
  enqueueDiagnostic(record: DiagnosticRecord): void {
    if (this.paused() || !this.allowed()) return;
    this.add(record);
  }

  /** Send everything waiting as ONE request. Never rejects; nothing is retried. */
  async flush(): Promise<void> {
    this.cancelTimer();
    if (this.waiting.size === 0) return;
    const target = this.paused() ? null : this.currentTarget();
    if (target === null) {
      // Not allowed any more, or refused for now: what was waiting is discarded, not kept.
      this.discardWaiting();
      return;
    }
    const records = this.takeBatch();
    if (this.waiting.size > 0) this.scheduleFlush();
    if (records.length === 0) return;
    const batch: DiagnosticsBatch = {
      osVersion: this.options.osVersion.slice(0, DIAGNOSTIC_STRING_MAX),
      records,
    };
    this.attempts++;
    try {
      const res = await this.options.post(endpointOf(target.baseUrl), target.headers, JSON.stringify(batch));
      if (res.status === TOO_MANY_REQUESTS) this.pause(res.retryAfter);
      if (!res.ok) {
        this.report('diagnostics upload rejected', { status: res.status, records: records.length });
      }
    } catch (err) {
      this.report('diagnostics upload failed', {
        errorClass: (err as Error)?.name ?? 'Error',
        detail: (err as Error)?.message ?? String(err),
        records: records.length,
      });
    }
  }

  /** Stop the timer (tests; a process that is going away). */
  stop(): void {
    this.cancelTimer();
  }

  /** Whether a `429` has stopped uploads right now. */
  private paused(): boolean {
    return this.pausedUntil !== undefined && this.options.now() < this.pausedUntil;
  }

  /** Stop uploading until `retryAfter` has passed (for the session when it names no window), and
   *  discard what is waiting. */
  private pause(retryAfter: string | null | undefined): void {
    const windowMs = retryAfterMs(retryAfter);
    this.pausedUntil = windowMs === undefined ? Infinity : this.options.now() + windowMs;
    this.cancelTimer();
    this.discardWaiting();
  }

  private discardWaiting(): void {
    for (const key of this.waiting) this.settle(key);
  }

  private currentTarget(): DiagnosticsTarget | null {
    if (this.deciding) return null;
    this.deciding = true;
    try {
      return this.options.target();
      // eslint-disable-next-line no-restricted-syntax -- intentional: a gate that cannot answer means no upload (fail closed); reporting the throw through the seam from inside the gate is the recursion this transport must not have.
    } catch {
      return null;
    } finally {
      this.deciding = false;
    }
  }

  private add(record: DiagnosticRecord): void {
    const key = dedupKey(record);
    const entry = this.entries.get(key);
    if (entry) {
      entry.total++;
      entry.record = { ...entry.record, at: record.at };
    } else if (this.entries.size >= this.options.maxDistinct) {
      this.dropped++;
      return;
    } else {
      const first: DiagnosticRecord = { ...record };
      delete first.count;
      this.entries.set(key, { record: first, total: 1, sent: 0 });
    }
    this.waiting.add(key);
    if (this.waiting.size >= this.options.maxBatch) {
      this.fireFlush();
    } else {
      this.scheduleFlush();
    }
  }

  /** Everything waiting that fits one body, each with the count added since its last flush.
   *  What doesn't fit keeps waiting; a record that could never fit alone is discarded. */
  private takeBatch(): DiagnosticRecord[] {
    const records: DiagnosticRecord[] = [];
    const empty = utf8Length(JSON.stringify({ osVersion: this.options.osVersion.slice(0, DIAGNOSTIC_STRING_MAX), records: [] }));
    let bytes = empty;
    for (const key of this.waiting) {
      const entry = this.entries.get(key);
      if (!entry) continue;
      const record: DiagnosticRecord = { ...entry.record, count: entry.total - entry.sent };
      const size = utf8Length(JSON.stringify(record)) + (records.length > 0 ? 1 : 0);
      if (bytes + size <= this.options.maxBodyBytes) {
        records.push(record);
        bytes += size;
        this.settle(key);
      } else if (empty + size > this.options.maxBodyBytes) {
        this.settle(key);
      }
    }
    return records;
  }

  /** Count everything so far as sent (or discarded) and stop waiting on it. */
  private settle(key: string): void {
    const entry = this.entries.get(key);
    if (entry) entry.sent = entry.total;
    this.waiting.delete(key);
  }

  private report(message: string, fields: Record<string, unknown>): void {
    try {
      this.options.onFailure(message, fields);
      // eslint-disable-next-line no-restricted-syntax -- intentional: the failure reporter is the seam's last line; if reporting itself throws there is nowhere left to report to, and a logging call must never take the app down with it.
    } catch {
      // deliberately silent — see the disable comment above
    }
  }

  /** `flush` already swallows every delivery failure; the trailing handler exists so a future bug
   *  in it can still never reach an unhandled rejection. */
  private fireFlush(): void {
    this.flush().catch(() => undefined);
  }

  private scheduleFlush(): void {
    if (this.timer != null) return;
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
