/**
 * The device's ONE logging seam (obs-v1, design D2; spec "One logging seam; `console.*` is not a
 * device log surface").
 *
 * Built on `react-native-logs` v5.6.0: pure JS, zero deps, and a transport model — the ring buffer,
 * the console and the batching HTTP sink are three transports over one record stream, rather than
 * three call sites each formatting their own string.
 *
 * Usage, and the shape the lint tripwire recognizes:
 *
 *     import { log } from '../logging';
 *     import { CHANNELS } from '../logging/channels';
 *     log.error(CHANNELS.gen, 'transport failed', { kind, status, readyState, detail });
 *
 * A message is a short constant string; everything variable is a NAMED FIELD, never interpolated
 * into the message. Sensitive-named fields are replaced with a fixed marker before the record
 * reaches any transport (`redact.ts`), so the overlay and the sink cannot disagree.
 */

import { logger } from 'react-native-logs';
// TYPE-ONLY import of the contract package's type-only dev-log module (design D6). Reached by
// path rather than through `@whim/contract`'s entry so not even the barrel — and therefore
// never zod — can enter the Metro graph; `import type` erases it entirely regardless.
import type { DevLogLevel, DevLogRecord } from '../../../contract/src/dev-log';
import type { Channel } from './channels';
import { ALL_CHANNELS, CHANNELS } from './channels';
import { redactFields } from './redact';
import { LogRing, RING_CAPACITY } from './ring-buffer';
import { DevLogSink } from './sink';
import type { SinkOptions } from './sink';

export type LogLevel = DevLogLevel;

/** Severities, lowest first. The array IS the order; `LEVEL_ORDER` derives from it. */
export const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** level → its rank, for threshold comparisons and for `react-native-logs`' own filter. */
export const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface SeamOptions {
  /** Ring-buffer capacity. */
  capacity: number;
  /** The default threshold: a record below it is neither buffered nor delivered. */
  level: LogLevel;
  /** Per-channel overrides of the default threshold. */
  channelLevels: Partial<Record<Channel, LogLevel>>;
  /** Mirror records to the platform console (logcat on Android). Never `console.error` — that
   *  trips RN's redbox, i.e. the logger would create the failure state it exists to report. */
  console: boolean;
  now: () => number;
  /** Sink configuration; the sink is off unless `enabled` is explicitly set. */
  sink: Partial<SinkOptions>;
}

export interface Seam {
  debug(channel: Channel, message: string, fields?: Readonly<Record<string, unknown>>): void;
  info(channel: Channel, message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(channel: Channel, message: string, fields?: Readonly<Record<string, unknown>>): void;
  error(channel: Channel, message: string, fields?: Readonly<Record<string, unknown>>): void;
  /** The bounded in-memory retention the overlay reads. */
  readonly buffer: LogRing;
  /** The batching dev-server transport (off until configured with `enabled: true`). */
  readonly sink: DevLogSink;
  /** Raise or lower the default threshold. */
  setLevel(level: LogLevel): void;
  /** Raise or lower one channel's threshold; `undefined` restores the default. */
  setChannelLevel(channel: Channel, level: LogLevel | undefined): void;
  /** The threshold that currently applies to a channel. */
  thresholdFor(channel: Channel): LogLevel;
}

function consoleWrite(record: DevLogRecord): void {
  const line = `[${record.channel}] ${record.message}`;
  const args: unknown[] = Object.keys(record.fields).length > 0 ? [line, record.fields] : [line];
  if (LEVEL_ORDER[record.level] >= LEVEL_ORDER.warn) {
    console.warn(...args);
  } else {
    console.log(...args);
  }
}

/**
 * Build a seam. The app uses the module-level `log` below; the suite builds isolated seams so the
 * buffer, thresholds and sink of one test cannot leak into another.
 */
export function createSeam(options: Partial<SeamOptions> = {}): Seam {
  const now = options.now ?? (() => Date.now());
  const buffer = new LogRing(options.capacity ?? RING_CAPACITY);
  const channelLevels: Partial<Record<Channel, LogLevel>> = { ...options.channelLevels };
  let defaultLevel: LogLevel = options.level ?? 'debug';
  const mirrorToConsole = options.console ?? true;

  const sink = new DevLogSink({
    now,
    ...options.sink,
    onFailure: (message, fields) => {
      // Emitted on the sink's OWN channel, which `DevLogSink.enqueue` never queues — a delivery
      // failure lands in the ring buffer (so the overlay can explain the silence) and cannot
      // recurse into another delivery attempt.
      emit('warn', CHANNELS.sink, message, fields);
    },
  });

  const rnl = logger.createLogger<(props: { rawMsg: unknown }) => void, LogLevel>({
    levels: LEVEL_ORDER,
    severity: 'debug',
    async: false,
    formatFunc: (_level, _extension, msgs) => String((msgs as unknown[])[0] ?? ''),
    transport: (props: { rawMsg: unknown }) => {
      const record = (props.rawMsg as DevLogRecord[])[0];
      const stored = buffer.push(record);
      sink.enqueue(stored);
      if (mirrorToConsole) {
        consoleWrite(stored);
      }
    },
  });

  const perChannel = new Map<Channel, ReturnType<typeof rnl.extend>>(
    ALL_CHANNELS.map(channel => [channel, rnl.extend(channel)]),
  );

  function thresholdFor(channel: Channel): LogLevel {
    return channelLevels[channel] ?? defaultLevel;
  }

  function emit(
    level: LogLevel,
    channel: Channel,
    message: string,
    fields: Readonly<Record<string, unknown>> = {},
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[thresholdFor(channel)]) {
      return;
    }
    const record: DevLogRecord = {
      at: now(),
      level,
      channel,
      message,
      // Redaction happens HERE — before any transport sees the record (design D3).
      fields: redactFields(fields),
    };
    const target = perChannel.get(channel) ?? rnl;
    target[level](record);
  }

  return {
    debug: (channel, message, fields) => emit('debug', channel, message, fields),
    info: (channel, message, fields) => emit('info', channel, message, fields),
    warn: (channel, message, fields) => emit('warn', channel, message, fields),
    error: (channel, message, fields) => emit('error', channel, message, fields),
    buffer,
    sink,
    setLevel: level => {
      defaultLevel = level;
    },
    setChannelLevel: (channel, level) => {
      if (level == null) {
        delete channelLevels[channel];
      } else {
        channelLevels[channel] = level;
      }
    },
    thresholdFor,
  };
}

/**
 * The app's seam. Exported under the binding name `log` on purpose: the repo's silent-catch lint
 * rule recognizes `log.<level>(...)` (and `log`-prefixed helpers) as "this catch is not swallowing".
 */
export const log: Seam = createSeam();
