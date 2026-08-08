/**
 * POST /dev/logs — the dev-only device log sink (obs-v1). Accepts a batch of device log records
 * and appends them to a file, one JSON record per line, so on-device diagnostics survive logcat's
 * ~4 KB truncation.
 *
 * Three properties this route exists to hold:
 *   1. It is mounted ONLY when `main.ts` sees its environment flag (`app.ts`), and NEVER under
 *      `/v1` — so the "every `/v1` route is gated by `x-whim-device`" invariant reads the same
 *      after this change and no ungated product surface is created. Disabled ⇒ 404.
 *   2. A batch is accepted or refused WHOLE: the body-size bound, the record-count bound and the
 *      structural guard all run before the first byte is written, so a rejected batch leaves the
 *      file byte-identical.
 *   3. Records are appended after the SAME redaction the server logger applies — the sink writes
 *      through a `pino` logger carrying the shared `redact` config (`../logger`), not through
 *      `fs.appendFile`, so a device that forgets to redact cannot land a prompt on disk here.
 *
 * The batch shape is validated by a HAND-WRITTEN structural guard (design D6): `contract/`'s
 * dev-log module is type-only precisely so importing it can never pull `zod` into a device's
 * module graph, which means there is no schema to parse with. The absence of a zod schema is not
 * permission to trust a body — hence `isDevLogBatch` below.
 */
import { Hono } from 'hono';
import { destination } from 'pino';
import type { ApiError, DevLogBatch, DevLogLevel, DevLogRecord } from '@whim/contract';
import { createServerLogger, type ServerLogger } from '../logger';

/** Defaults chosen to bound a misbehaving (or hostile) device without truncating a real session:
 *  the device sink's own batch cap is 50 records (`src/host/logging/sink.ts`). */
const DEFAULT_MAX_RECORDS = 500;
const DEFAULT_MAX_BODY_BYTES = 1_000_000;

export interface DevLogSinkOptions {
  /** Absolute path of the append-only JSONL file. Created (with its directory) on first use. */
  filePath: string;
  /** Maximum records in one batch. Default 500. */
  maxRecords?: number;
  /** Maximum request body size in bytes. Default 1_000_000. */
  maxBodyBytes?: number;
}

const LEVELS: readonly DevLogLevel[] = ['debug', 'info', 'warn', 'error'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDevLogRecord(value: unknown): value is DevLogRecord {
  if (!isRecord(value)) return false;
  if (typeof value.at !== 'number' || !Number.isFinite(value.at)) return false;
  if (typeof value.level !== 'string' || !LEVELS.includes(value.level as DevLogLevel)) return false;
  if (typeof value.channel !== 'string' || value.channel.length === 0) return false;
  if (typeof value.message !== 'string') return false;
  return isRecord(value.fields);
}

/** The hand-written structural guard (design D6) — the only thing standing between a POST body
 *  and the log file. */
export function isDevLogBatch(value: unknown): value is DevLogBatch {
  if (!isRecord(value)) return false;
  if (typeof value.sentAt !== 'number' || !Number.isFinite(value.sentAt)) return false;
  if (!Array.isArray(value.records)) return false;
  return value.records.every(isDevLogRecord);
}

/**
 * The file logger. `base: null` + `timestamp: false` + a string-label level formatter make each
 * emitted line exactly the record as received (`level`, `at`, `channel`, `message`, `fields`) —
 * after redaction — with none of this process's own pid/hostname/time noise mixed in.
 */
function createSinkLogger(filePath: string): ServerLogger {
  return createServerLogger({
    level: 'debug',
    base: null,
    timestamp: false,
    formatters: { level: (label) => ({ level: label }) },
    destination: destination({ dest: filePath, sync: true, mkdir: true, append: true }),
  });
}

export function makeDevLogsRoute(options: DevLogSinkOptions): Hono {
  const app = new Hono();
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const sink = createSinkLogger(options.filePath);

  app.post('/', async (c) => {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > maxBodyBytes) {
      return c.json(
        {
          error: 'batch_too_large',
          hint: `The log batch body exceeds ${String(maxBodyBytes)} bytes. Send fewer records per batch.`,
        } satisfies ApiError,
        413,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (err: unknown) {
      return c.json(
        {
          error: 'invalid_batch',
          hint: `The log batch body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        } satisfies ApiError,
        400,
      );
    }

    if (!isDevLogBatch(parsed)) {
      return c.json(
        {
          error: 'invalid_batch',
          hint: 'Expected { sentAt: number, records: { at, level, channel, message, fields }[] }.',
        } satisfies ApiError,
        400,
      );
    }

    if (parsed.records.length > maxRecords) {
      return c.json(
        {
          error: 'batch_too_large',
          hint: `The log batch carries more than ${String(maxRecords)} records.`,
        } satisfies ApiError,
        413,
      );
    }

    // Every bound has passed: from here the whole batch is written, in the order it was sent.
    for (const record of parsed.records) {
      const { level, ...rest } = record;
      sink[level](rest);
    }

    return c.body(null, 204);
  });

  return app;
}
