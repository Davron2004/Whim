# Contract: logging-seam (chain-B → chains C/E/F)

Interface only; rationale is `design.md` §D2–§D6.

## Call shape (the ONE way to log on the device)

```ts
import { log } from '<rel>/logging';               // src/host/logging/index.ts
import { CHANNELS } from '<rel>/logging/channels';
log.error(CHANNELS.gen, 'transport failed', { kind, status, readyState, detail });
```
The binding name `log` is load-bearing (the `.eslintrc.js` tripwire recognizes `log.<level>(…)`).
Message = a short constant string; everything variable is a NAMED FIELD, never interpolated.

## Exports — `src/host/logging/index.ts`

```ts
export type LogLevel = DevLogLevel;                 // 'debug' | 'info' | 'warn' | 'error'
export const LEVELS: readonly LogLevel[];           // ['debug','info','warn','error'] — the order
export const LEVEL_ORDER: Record<LogLevel, number>; // debug 0 … error 3
export interface Seam {
  debug(channel: Channel, message: string, fields?: Readonly<Record<string, unknown>>): void;
  info(…same…): void; warn(…same…): void; error(…same…): void;
  readonly buffer: LogRing; readonly sink: DevLogSink;
  setLevel(level: LogLevel): void; thresholdFor(channel: Channel): LogLevel;
  setChannelLevel(channel: Channel, level: LogLevel | undefined): void;  // undefined = default
}
export interface SeamOptions {   // every field optional at the call
  capacity: number; level: LogLevel; channelLevels: Partial<Record<Channel, LogLevel>>;
  console: boolean;              // default true; mirrors to logcat, NEVER console.error
  now: () => number; sink: Partial<SinkOptions>;
}
export function createSeam(options?: Partial<SeamOptions>): Seam;  // isolated seam (tests)
export const log: Seam;                                            // the app's seam
```
A record below its channel's threshold is neither buffered nor delivered; fields are redacted
before ANY transport sees the record.

## Channels — `src/host/logging/channels.ts`

```ts
export const CHANNELS = {
  gen: 'whim:gen',       // generation client + transport
  app: 'whim',           // mini-app container / WebView host
  page: 'whim:page',     // relayed sandbox-page log
  screen: 'whim:screen', // launcher screen error boundary
  sink: 'whim:sink',     // the seam reporting on itself (dev-sink failures)
} as const;
export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];
export const ALL_CHANNELS: readonly Channel[];            // for the overlay's channel filter
```
A call site imports a constant; it never writes the literal.

## Redaction — `src/host/logging/redact.ts`

```ts
export const REDACTED = '[redacted]';
export const SENSITIVE_FIELD_NAMES: readonly string[];
export function isSensitiveField(name: string): boolean; // case-insensitive
export function redactFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown>;
```
The set (lower-cased comparison; recurses into nested objects/arrays to depth 4): `prompt,
prompttext, prompt_text, userprompt, utterance, transcript, source, sourcetext, generatedsource,
appsource, bundlesource, code, deviceid, device_id, x-whim-device, xwhimdevice, apikey, api_key,
apitoken, accesstoken, authorization, secret`.

## Ring buffer — `src/host/logging/ring-buffer.ts`

```ts
export const RING_CAPACITY = 500;
export class LogRing {
  constructor(capacity?: number);  readonly capacity: number;
  push(record: DevLogRecord): DevLogRecord;   // freezes the record; evicts oldest at capacity
  snapshot(): readonly DevLogRecord[];        // oldest-first, frozen, stable across later pushes
  get size(): number;  clear(): void;
}
```
Never persisted to disk.

## Sink — `src/host/logging/sink.ts`

```ts
export type PostBatch = (url: string, body: string) => Promise<{ ok: boolean; status: number }>;
export interface SinkOptions {
  enabled: boolean;          // default FALSE — the explicit flag; __DEV__ is not the gate
  baseUrl?: string;          // the address `server-address.ts` already persists
  maxBatch: number;          // default 50   — count bound
  flushIntervalMs: number;   // default 5000 — time bound
  maxPending: number;        // default 200  — drops the OLDEST pending, never grows
  post: PostBatch;           // default: global fetch
  now: () => number; onFailure: (message: string, fields: Record<string, unknown>) => void;
}
export class DevLogSink {
  get active(): boolean;     // enabled AND a non-empty baseUrl
  get endpoint(): string | undefined;  // `${baseUrl without trailing '/'}/dev/logs`
  configure(patch: Partial<SinkOptions>): void;  // disabling drops pending + stops the timer
  enqueue(record: DevLogRecord): void;
  flush(): Promise<void>;    // never rejects
  stop(): void; attempts: number; dropped: number;
}
```
A delivery failure (throw or non-2xx): recorded ONCE in the ring buffer on `CHANNELS.sink`
(`fields`: `errorClass`/`detail`/`records`, or `status`/`records`), the batch is dropped, nothing
is retried, nothing throws into the caller, nothing reaches the user. Records on `CHANNELS.sink`
are never enqueued, so the failure record cannot recurse into another attempt.

## Wire types — `contract/src/dev-log.ts` (no runtime export)
```ts
export type DevLogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface DevLogRecord {
  readonly at: number; readonly level: DevLogLevel; readonly channel: string;
  readonly message: string; readonly fields: Readonly<Record<string, unknown>>;
}
export interface DevLogBatch { readonly sentAt: number; readonly records: readonly DevLogRecord[]; }
export type DevLogSinkPath = '/dev/logs';   // a TYPE: each side writes the literal once, annotated
```
Re-exported type-only from `contract/src/index.ts`. The SERVER writes
`const path: DevLogSinkPath = '/dev/logs';` (import type from `@whim/contract`) and validates a
batch with a hand-written structural guard. Device modules import the module BY PATH
(`../../../contract/src/dev-log`) with `import type`, so not even the barrel can enter Metro.
