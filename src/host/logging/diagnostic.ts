/**
 * diagnostic — the ONE projection of a device log record onto what may leave the phone
 * (developer-observability D2; spec device-diagnostics "Only an allowlisted projection of an error
 * record leaves the device").
 *
 * An allowlist, not a redaction list: a field is sent only when this file names it, so a new
 * field name added at some call site stays on the phone until someone decides here that it may
 * go. The input is a record the seam has already redacted; the output is exactly the contract's
 * `DiagnosticRecord` shape (`.strict()` on the server, so an extra key would refuse the batch).
 *
 * No React Native import, no zod: `@whim/contract` is a TYPE-ONLY import here.
 */

import type { DevLogRecord, DiagnosticRecord } from '@whim/contract';
import { CHANNELS } from './channels';

/** The fields a projection may carry beyond `at`/`level`/`channel`/`message`, in the contract's
 *  order. `route` and `stack` have their own treatment below; the rest are bounded strings or
 *  finite numbers. */
export const DIAGNOSTIC_FIELDS = [
  'screen',
  'errorClass',
  'where',
  'stage',
  'reason',
  'kind',
  'status',
  'errorCode',
  'domain',
  'readyState',
  'observedRepairAttempts',
  'requestId',
  'route',
  'count',
  'stack',
  'exposure',
  'webview',
] as const;

type DiagnosticField = (typeof DIAGNOSTIC_FIELDS)[number];

/** The message of the one record that may carry `exposure` and `webview`: a navigated-frame
 *  exposure result (spec device-diagnostics "Bridge-exposure results are uploaded under the
 *  error-details consent"). Logged on the host's channel at `info`. */
export const BRIDGE_EXPOSURE_MESSAGE = 'bridge-exposure';

/** The `exposure` grammar: `refused` | `timed-out` | `navigated:<visible>[+canary]`. */
const EXPOSURE_GRAMMAR = /^(?:refused|timed-out|navigated:(?:none|android|ios|android\+ios)(?:\+canary)?)$/;
/** The `webview` grammar: an engine name and major version only. */
const WEBVIEW_GRAMMAR = /^(?:chrome-\d{1,4}|webkit)$/;

/** Every string a projection carries is cut to this many characters (the contract's cap). */
export const DIAGNOSTIC_STRING_MAX = 128;
/** `stack` alone may be longer: at most this many characters. */
const DIAGNOSTIC_STACK_MAX = 4096;

/** The error names a mini-app's `errorClass` may travel as. A mini-app sets its own `name`, so a
 *  name outside this set could be built from saved data; it travels as `Other` (#63 B9). */
const BUILTIN_ERROR_NAMES: ReadonlySet<string> = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
  'AggregateError',
]);

/** What a mini-app error name outside {@link BUILTIN_ERROR_NAMES} is sent as. */
const OTHER_ERROR_CLASS = 'Other';

/** The closed set a projected `reason` may hold: which kind of failure a failure screen showed,
 *  as a code host code picks from constants. Never the sentence the screen shows: a terminal
 *  failure's sentence is written from model output (a plan's screen names come from the user's
 *  prompt), and a server hint is the server's text. A `reason` outside this set is dropped,
 *  whoever logged it. The server's own failure code is on its log line for the same `requestId`. */
export const DIAGNOSTIC_REASONS = [
  /** The generation stream ended in a terminal `failure` event. */
  'terminal_failure',
  /** The generation stream ended with no terminal event. */
  'no_terminal_event',
  /** A request was refused with an error status whose server hint the screen shows. */
  'server_refused',
  /** The delivered bundle defines no app. */
  'empty_bundle',
  /** Anything else: the screen shows the generic reason. */
  'unexpected_error',
] as const;

export type DiagnosticReason = (typeof DIAGNOSTIC_REASONS)[number];

function closedReason(value: unknown): DiagnosticReason | undefined {
  return (DIAGNOSTIC_REASONS as readonly unknown[]).includes(value) ? (value as DiagnosticReason) : undefined;
}

/** The `where` values on the page channel that the HOST computes itself (the paint watchdog, a
 *  launch the host refused). Every other page-channel record is treated as coming from the
 *  mini-app, so a `where` added to the loader later is stripped by default, not sent. */
const HOST_SITES_ON_PAGE_CHANNEL: ReadonlySet<string> = new Set(['paint-timeout', 'launch']);

function capString(value: string, max = DIAGNOSTIC_STRING_MAX): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** A bounded string or a finite number; anything else (object, boolean, null, NaN) is dropped. */
function boundedValue(value: unknown): string | number | undefined {
  if (typeof value === 'string') return capString(value);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

/** A URL or path reduced to its path: no scheme, no host, no query, no fragment. `undefined` when
 *  what is left is not a path. */
function pathOnly(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const withoutOrigin = value.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');
  const path = withoutOrigin.split(/[?#]/, 1)[0];
  if (path === '' && withoutOrigin !== value) return '/';
  return path.startsWith('/') ? capString(path) : undefined;
}

/** A stack frame line as Hermes and V8 print it (`    at fn (file:1:2)`). */
const FRAME_LINE = /^\s+at\s/;

/** A host stack without its message: the first line (`Name: message`) is dropped, and so is any
 *  other line that is not a frame, since a multi-line message spills onto the lines after it.
 *  `undefined` when no frame is left. */
function framesOnly(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const frames = value.split('\n').slice(1).filter(line => FRAME_LINE.test(line));
  return frames.length > 0 ? capString(frames.join('\n'), DIAGNOSTIC_STACK_MAX) : undefined;
}

/** Whether a record describes something a mini-app did: its error name is the mini-app's own
 *  choice, and its message text is the mini-app's data. */
function fromMiniApp(record: DevLogRecord): boolean {
  if (record.channel !== CHANNELS.page) return false;
  const where = record.fields.where;
  return !(typeof where === 'string' && HOST_SITES_ON_PAGE_CHANNEL.has(where));
}

/** Whether a record is the bridge-exposure record, the only one that may carry `exposure` and
 *  `webview`. */
function isBridgeExposure(record: { readonly level?: unknown; readonly channel?: unknown; readonly message?: unknown }): boolean {
  return record.level === 'info' && record.channel === CHANNELS.app && record.message === BRIDGE_EXPOSURE_MESSAGE;
}

/** `value` when it is a string matching `grammar`, else `undefined`. */
function inGrammar(value: unknown, grammar: RegExp): string | undefined {
  return typeof value === 'string' && grammar.test(value) ? value : undefined;
}

function miniAppErrorClass(value: unknown): string {
  return typeof value === 'string' && BUILTIN_ERROR_NAMES.has(value) ? value : OTHER_ERROR_CLASS;
}

/**
 * Project a redacted seam record onto the diagnostic allowlist. Unknown fields are dropped,
 * strings capped, `route` reduced to a path, `stack` to its frames, and a `reason` outside
 * {@link DIAGNOSTIC_REASONS} dropped. A mini-app record keeps only
 * its site (`where`) and its class (`errorClass`, mapped onto the built-in names). The
 * bridge-exposure record keeps only `exposure` and `webview`, each in its grammar; every other
 * record drops both.
 */
export function toDiagnostic(record: DevLogRecord): DiagnosticRecord {
  const out: DiagnosticRecord = {
    at: record.at,
    level: record.level,
    channel: capString(record.channel),
    message: capString(record.message),
  };
  if (isBridgeExposure(record)) return withExposure(out, record.fields);
  if (fromMiniApp(record)) {
    const where = boundedValue(record.fields.where);
    if (where !== undefined) out.where = where;
    out.errorClass = miniAppErrorClass(record.fields.errorClass);
    return out;
  }
  const projected: Partial<Record<DiagnosticField, string | number>> = {};
  for (const field of DIAGNOSTIC_FIELDS) {
    const value = projectedField(field, record.fields[field]);
    if (value !== undefined) projected[field] = value;
  }
  return { ...out, ...projected } as DiagnosticRecord;
}

/** One allowlisted field of an ordinary record, as it may leave; `exposure` and `webview` never do. */
function projectedField(field: DiagnosticField, raw: unknown): string | number | undefined {
  if (field === 'route') return pathOnly(raw);
  if (field === 'stack') return framesOnly(raw);
  if (field === 'reason') return closedReason(raw);
  if (field === 'exposure' || field === 'webview') return undefined;
  return boundedValue(raw);
}

/** The bridge-exposure record's projection: its base fields, plus `exposure` and `webview` when
 *  both are in their grammar. */
function withExposure(base: DiagnosticRecord, fields: DevLogRecord['fields']): DiagnosticRecord {
  const exposure = inGrammar(fields.exposure, EXPOSURE_GRAMMAR);
  const webview = inGrammar(fields.webview, WEBVIEW_GRAMMAR);
  return exposure !== undefined && webview !== undefined ? { ...base, exposure, webview } : base;
}

/**
 * A navigated-frame exposure result as the record that is uploaded: `info`, on the host's channel,
 * `bridge-exposure`, carrying only `exposure` and `webview`. `null` when `webview` is `null` (the
 * page could not name its engine) or either value is outside its grammar: such a result is not sent.
 */
export function bridgeExposureDiagnostic(at: number, exposure: string, webview: string | null): DiagnosticRecord | null {
  const projected = toDiagnostic({ at, level: 'info', channel: CHANNELS.app, message: BRIDGE_EXPOSURE_MESSAGE, fields: { exposure, webview } });
  return projected.exposure !== undefined && projected.webview !== undefined ? projected : null;
}

const LEVELS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error']);

/**
 * Whether a value read back from storage is still a projection this device would send: the four
 * base fields, and otherwise only allowlisted keys holding bounded values. Guards the fatal-error
 * slot, whose stored text is not trusted just because this app wrote it.
 */
export function isDiagnosticRecord(value: unknown): value is DiagnosticRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.at !== 'number' || !Number.isFinite(record.at)) return false;
  if (typeof record.level !== 'string' || !LEVELS.has(record.level)) return false;
  for (const key of ['channel', 'message']) {
    const text = record[key];
    if (typeof text !== 'string' || text.length > DIAGNOSTIC_STRING_MAX) return false;
  }
  return Object.entries(record).every(([key, field]) => {
    if (key === 'at' || key === 'level' || key === 'channel' || key === 'message') return true;
    if (!(DIAGNOSTIC_FIELDS as readonly string[]).includes(key)) return false;
    if (key === 'stack') return typeof field === 'string' && field.length <= DIAGNOSTIC_STACK_MAX;
    if (key === 'route') return typeof field === 'string' && pathOnly(field) === field;
    if (key === 'reason') return closedReason(field) !== undefined;
    if (key === 'exposure' || key === 'webview') {
      return isBridgeExposure(record) && inGrammar(record.exposure, EXPOSURE_GRAMMAR) !== undefined && inGrammar(record.webview, WEBVIEW_GRAMMAR) !== undefined;
    }
    return boundedValue(field) === field;
  });
}
