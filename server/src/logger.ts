/**
 * The server's ONE logger (obs-v1, design D3). `pino` root logger + `redact` paths; every child
 * inherits the redaction, so a new call site gets the privacy floor without opting in. There is no
 * wrapper around this module — a call site imports `log` (or a child of it) and calls a level
 * method directly. The two retired `dev-log.ts` console helpers are deleted, deliberately not
 * wrapped: two ways to log is the failure being removed.
 *
 * Redaction happens at the SERIALIZER, not by convention at the call site: prompt text, generated
 * mini-app source, the `x-whim-device` value and the model-provider API key are replaced with
 * `REDACTED` even when a caller passes them, at the top level and up to two levels of nesting
 * (which covers `{ fields: { … } }` device records and `{ headers: { … } }` shapes).
 *
 * Output: the pretty transport for human reading in development; plain structured JSON when
 * `pino-pretty` is not installed or `WHIM_LOG_JSON=1` is set (piping to a file, and the mode the
 * acceptance suite runs in — JSON on `process.stdout` is what a test can read back).
 *
 * NOTE for bundlers: `pino` must stay EXTERNAL in every esbuild runner that reaches this module
 * (`server/dev.mjs`, `server/test/run.mjs`, `server/test/e2e.run.mjs`) — bundling it throws
 * `Dynamic require of "node:os" is not supported` at import time, the same gotcha those runners
 * already document for `esbuild`/`typescript`/`playwright`.
 */
import { createRequire } from 'node:module';
import { pino, transport, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

/** The fixed marker a redacted value is replaced with. */
export const REDACTED = '[redacted]';

/**
 * Field names whose VALUE is never allowed into emitted output. Mirrors the device seam's
 * sensitive set (`src/host/logging/redact.ts`) so a record relayed from a device is censored the
 * same way on both sides. Names are matched exactly (pino redaction is case-sensitive), so each
 * concept lists the casings this codebase actually writes.
 */
const SENSITIVE_FIELD_NAMES: readonly string[] = [
  'prompt',
  'promptText',
  'prompt_text',
  'userPrompt',
  'utterance',
  'transcript',
  'source',
  'sourceText',
  'generatedSource',
  'appSource',
  'bundleSource',
  'code',
  'deviceId',
  'device_id',
  'x-whim-device',
  'xWhimDevice',
  'apiKey',
  'api_key',
  'apiToken',
  'accessToken',
  'authorization',
  'Authorization',
  'secret',
];

/** A name that is not a plain identifier needs pino's bracket form (`["x-whim-device"]`). */
function pathSegment(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : `["${name}"]`;
}

/**
 * Every sensitive name at the top level and beneath one or two wildcard levels — `fields.prompt`
 * (a relayed device record) and `fields.detail.prompt` are covered without enumerating carriers.
 */
const REDACT_PATHS: readonly string[] = SENSITIVE_FIELD_NAMES.flatMap((name) => {
  const segment = pathSegment(name);
  return [segment, `*.${segment}`, `*.*.${segment}`];
});

export type ServerLogger = Logger;

export interface ServerLoggerOptions {
  /** Where serialized lines go. Default: `process.stdout` (or the pretty transport, in dev). */
  destination?: DestinationStream;
  level?: LoggerOptions['level'];
  /** `pino`'s base fields (pid/hostname). `null` omits them — used by the dev log sink, whose
   *  lines are device records, not this process's records. */
  base?: LoggerOptions['base'];
  timestamp?: LoggerOptions['timestamp'];
  formatters?: LoggerOptions['formatters'];
}

/**
 * An independently-destined logger carrying the SAME redaction config as the root — the dev log
 * sink and the acceptance suite both need one that writes somewhere other than stdout.
 */
export function createServerLogger(options: ServerLoggerOptions = {}): ServerLogger {
  const { destination, ...rest } = options;
  const loggerOptions: LoggerOptions = {
    level: process.env.WHIM_LOG_LEVEL ?? 'info',
    redact: { paths: [...REDACT_PATHS], censor: REDACTED },
    ...rest,
  };
  return destination ? pino(loggerOptions, destination) : pino(loggerOptions, process.stdout);
}

/** The pretty transport, or `undefined` when it is unavailable or explicitly declined. */
function prettyDestination(): DestinationStream | undefined {
  if (process.env.WHIM_LOG_JSON === '1') return undefined;
  if (process.env.NODE_ENV === 'production') return undefined;
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
  } catch (err: unknown) {
    // `pino-pretty` is a DEV dependency: its ABSENCE is the normal production shape, not a fault,
    // and falls through to structured JSON. Anything else went wrong for another reason and is
    // rethrown rather than silently degraded.
    if ((err as NodeJS.ErrnoException).code !== 'MODULE_NOT_FOUND') throw err;
    return undefined;
  }
  return transport({ target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } });
}

/** The application's logger. Call sites use this, or `log.child({ scope })`. */
export const log: ServerLogger = createServerLogger({ destination: prettyDestination() });
