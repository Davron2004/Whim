/**
 * The server's ONE logger (obs-v1, design D3). `pino` root logger + `redact` paths; every child
 * inherits the redaction, so a new call site gets the privacy floor without opting in. There is no
 * wrapper around this module — a call site imports `log` (or a child of it) and calls a level
 * method directly. The two retired `dev-log.ts` console helpers are deleted, deliberately not
 * wrapped: two ways to log is the failure being removed.
 *
 * Redaction happens at the SERIALIZER, not by convention at the call site: prompt text, generated
 * mini-app source, the `x-whim-device` value and the model-provider API key are replaced with
 * `REDACTED` even when a caller passes them, in any plausible casing, at the top level and up to
 * three levels of nesting (which covers `{ fields: { … } }` device records, `{ headers: { … } }`
 * shapes, and a record relayed inside a request-scoped child logger's bindings).
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
 * same way on both sides. pino matches a path exactly, so `caseVariants` below expands each name
 * into the casings it can arrive in — this list carries one canonical spelling per concept.
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
 * The casings a sensitive name can plausibly arrive in. pino's redaction is exact-match, while the
 * device seam compares case-insensitively — so each name is expanded here rather than trusting
 * every present and future call site to pick the one spelling that happens to be listed.
 * `deviceId` → `deviceId`, `DeviceId`, `deviceid`, `DEVICEID`; `api_key` → `API_KEY` too.
 */
function caseVariants(name: string): string[] {
  const head = name.charAt(0);
  return [
    name,
    head.toUpperCase() + name.slice(1),
    head.toLowerCase() + name.slice(1),
    name.toLowerCase(),
    name.toUpperCase(),
  ];
}

/** How deep a wildcard path reaches. Depth 3 covers `{ fields: { detail: { headers: { … } } } }`
 *  — a relayed device record nested inside a request-scoped child logger's bindings. */
const WILDCARD_DEPTH = 3;

/** `['', '*.', '*.*.', '*.*.*.']` — the top level plus each wildcard depth. */
const PATH_PREFIXES: readonly string[] = Array.from({ length: WILDCARD_DEPTH + 1 }, (_unused, depth) =>
  '*.'.repeat(depth),
);

/**
 * Every sensitive name, in every plausible casing, at the top level and beneath up to three
 * wildcard levels — `fields.prompt` (a relayed device record) and `fields.detail.headers.apiKey`
 * are covered without enumerating carriers. Generated, so widening the set widens every path.
 */
const REDACT_PATHS: readonly string[] = [
  ...new Set(
    SENSITIVE_FIELD_NAMES.flatMap((name) =>
      caseVariants(name).flatMap((variant) => {
        const segment = pathSegment(variant);
        return PATH_PREFIXES.map((prefix) => `${prefix}${segment}`);
      }),
    ),
  ),
];

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
