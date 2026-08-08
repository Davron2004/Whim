/**
 * logging.suite — acceptance for the device logging seam (obs-v1 chain B).
 *
 * Covers the spec scenarios from `host-observability`:
 *   - "Levels order and filter" (default and per-channel thresholds)
 *   - the channel registry is the ONE place a channel name is written
 *   - "A sensitive field is redacted at the seam" / "Redaction is not sink-dependent"
 *   - "Capacity is enforced by eviction" / "A snapshot is stable"
 *   - "Records are batched, not sent one by one" / "Off by default" /
 *     "An unreachable sink is invisible to the user" / "The failure record does not recurse"
 *
 * Runs under Node via `npm run launcher:test` (registered in `../../launcher/test/acceptance.ts`).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Harness } from '../../launcher/test/harness';
import { CHANNELS, ALL_CHANNELS } from '../channels';
import { REDACTED, SENSITIVE_FIELD_NAMES, isSensitiveField } from '../redact';
import { LogRing } from '../ring-buffer';
import { createSeam, LEVELS, LEVEL_ORDER } from '../index';
import type { PostBatch } from '../sink';

interface Sent {
  url: string;
  body: string;
}

/** The address the device would have persisted for `/v1/generate`; the sink reuses it. */
const BASE_URL = 'http://127.0.0.1:8787';

/** A sink transport that records what it was handed; `fail` makes every delivery reject. */
function recordingPost(sent: Sent[], fail = false): PostBatch {
  return async (url, body) => {
    sent.push({ url, body });
    if (fail) {
      throw new Error('connect ECONNREFUSED');
    }
    return { ok: true, status: 204 };
  };
}

/** Let queued microtasks and a zero-delay timer settle (fire-and-forget flushes). */
async function settle(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

export async function runLoggingTests(h: Harness): Promise<void> {
  await h.test('levels are ordered lowest-first and the threshold filters below it', () => {
    h.eq([...LEVELS], ['debug', 'info', 'warn', 'error'], 'level order');
    h.ok(
      LEVEL_ORDER.debug < LEVEL_ORDER.info &&
        LEVEL_ORDER.info < LEVEL_ORDER.warn &&
        LEVEL_ORDER.warn < LEVEL_ORDER.error,
      'ranks increase with severity',
    );

    const seam = createSeam({ console: false, level: 'warn' });
    seam.debug(CHANNELS.gen, 'below');
    seam.info(CHANNELS.gen, 'below');
    seam.warn(CHANNELS.gen, 'at');
    seam.error(CHANNELS.gen, 'above');
    h.eq(
      seam.buffer.snapshot().map(r => r.message),
      ['at', 'above'],
      'records below the threshold are not buffered',
    );
  });

  await h.test('a per-channel threshold overrides the default without touching other channels', () => {
    const seam = createSeam({ console: false, level: 'debug' });
    seam.setChannelLevel(CHANNELS.gen, 'error');
    h.eq(seam.thresholdFor(CHANNELS.gen), 'error', 'gen threshold raised');
    h.eq(seam.thresholdFor(CHANNELS.app), 'debug', 'app keeps the default');

    seam.info(CHANNELS.gen, 'gen-info');
    seam.info(CHANNELS.app, 'app-info');
    seam.error(CHANNELS.gen, 'gen-error');
    h.eq(
      seam.buffer.snapshot().map(r => r.message),
      ['app-info', 'gen-error'],
      'only the raised channel is filtered',
    );

    seam.setChannelLevel(CHANNELS.gen, undefined);
    h.eq(seam.thresholdFor(CHANNELS.gen), 'debug', 'clearing an override restores the default');
  });

  await h.test('a filtered record reaches no sink either', async () => {
    const sent: Sent[] = [];
    const seam = createSeam({
      console: false,
      level: 'error',
      sink: { enabled: true, baseUrl: BASE_URL, post: recordingPost(sent) },
    });
    seam.info(CHANNELS.gen, 'dropped');
    await seam.sink.flush();
    h.eq(sent.length, 0, 'nothing was delivered');
    seam.sink.stop();
  });

  await h.test('the channel registry is the only place a channel name is written', () => {
    h.eq(CHANNELS.gen, 'whim:gen', 'the generation prefix became a channel verbatim');
    h.eq(CHANNELS.app, 'whim', 'the container prefix became a channel verbatim');
    h.eq(CHANNELS.page, 'whim:page', 'the relayed sandbox-page prefix became a channel verbatim');
    h.ok(typeof CHANNELS.screen === 'string' && CHANNELS.screen.length > 0, 'the screen boundary has a channel');
    h.ok(typeof CHANNELS.sink === 'string' && CHANNELS.sink.length > 0, 'the sink has its own channel');
    h.eq(new Set(ALL_CHANNELS).size, ALL_CHANNELS.length, 'channel names are distinct');

    // Every module of the seam itself imports the constant; none re-writes the literal. (The
    // seam's own test folder is excluded — asserting the literals IS this test's job.)
    const dir = path.join(process.cwd(), 'src', 'host', 'logging');
    const modules = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));
    h.ok(modules.includes('channels.ts'), 'the registry module exists');
    const offenders = modules.filter(file => {
      if (file === 'channels.ts') {
        return false;
      }
      const src = fs.readFileSync(path.join(dir, file), 'utf8');
      return ALL_CHANNELS.some(channel => src.includes(`'${channel}'`) || src.includes(`"${channel}"`));
    });
    h.eq(offenders, [], 'no seam module outside channels.ts writes a channel literal');
  });

  await h.test('every sensitive field name is redacted before the record is buffered', () => {
    const seam = createSeam({ console: false });
    for (const name of SENSITIVE_FIELD_NAMES) {
      h.ok(isSensitiveField(name.toUpperCase()), `${name} matches case-insensitively`);
    }
    const secret = 'SECRET-VALUE';
    const fields: Record<string, unknown> = { safe: 'kept' };
    for (const name of SENSITIVE_FIELD_NAMES) {
      fields[name] = secret;
    }
    fields.nested = { apiKey: secret, note: 'kept too' };
    seam.error(CHANNELS.gen, 'boom', fields);

    const [record] = seam.buffer.snapshot();
    h.eq(record.fields.safe, 'kept', 'a non-sensitive field survives');
    const leaked = SENSITIVE_FIELD_NAMES.filter(name => record.fields[name] !== REDACTED);
    h.eq(leaked, [], 'every sensitive field carries the marker');
    h.eq((record.fields.nested as Record<string, unknown>).apiKey, REDACTED, 'nested values are redacted too');
    h.eq((record.fields.nested as Record<string, unknown>).note, 'kept too', 'nested non-sensitive values survive');
    h.ok(!JSON.stringify(record).includes(secret), 'the original value appears nowhere in the record');
  });

  await h.test('the buffer reader and the sink reader observe the same redacted value', async () => {
    const sent: Sent[] = [];
    const seam = createSeam({
      console: false,
      sink: { enabled: true, baseUrl: BASE_URL, post: recordingPost(sent) },
    });
    seam.info(CHANNELS.gen, 'sending', { prompt: 'make me a timer', deviceId: 'device-abc' });
    await seam.sink.flush();

    const [record] = seam.buffer.snapshot();
    h.eq(record.fields.prompt, REDACTED, 'the overlay reader sees the marker');
    h.eq(sent.length, 1, 'one delivery');
    h.ok(!sent[0].body.includes('make me a timer'), 'the prompt text is in no sink');
    h.ok(!sent[0].body.includes('device-abc'), 'the device id is in no sink');
    h.eq((JSON.parse(sent[0].body).records[0].fields as Record<string, unknown>).prompt, REDACTED, 'the sink reader sees the marker');
    seam.sink.stop();
  });

  await h.test('the ring buffer evicts the oldest at capacity', () => {
    const ring = new LogRing(3);
    for (const n of [1, 2, 3, 4, 5]) {
      ring.push({ at: n, level: 'info', channel: CHANNELS.app, message: `m${n}`, fields: {} });
    }
    h.eq(ring.size, 3, 'the buffer holds exactly its capacity');
    h.eq(
      ring.snapshot().map(r => r.message),
      ['m3', 'm4', 'm5'],
      'the oldest are gone and the newest are in emission order',
    );
  });

  await h.test('a snapshot is stable and cannot be observed half-written', () => {
    const seam = createSeam({ console: false, capacity: 4 });
    seam.info(CHANNELS.app, 'first', { a: 1 });
    const snap = seam.buffer.snapshot();
    seam.info(CHANNELS.app, 'second');
    seam.info(CHANNELS.app, 'third');
    h.eq(snap.map(r => r.message), ['first'], 'the held snapshot is unchanged by later records');
    h.eq(seam.buffer.snapshot().length, 3, 'the buffer itself moved on');
    h.ok(Object.isFrozen(snap[0]) && Object.isFrozen(snap[0].fields), 'records and their fields are frozen');
    h.ok(
      snap[0].at > 0 && snap[0].level === 'info' && snap[0].channel === CHANNELS.app,
      'a record carries timestamp, level and channel',
    );
  });

  await h.test('the sink is off unless explicitly enabled', async () => {
    const sent: Sent[] = [];
    const post = recordingPost(sent);

    const offByDefault = createSeam({ console: false, sink: { baseUrl: BASE_URL, post } });
    h.ok(!offByDefault.sink.active, 'a sink with an address but no flag is inactive');
    offByDefault.error(CHANNELS.gen, 'never sent');
    await offByDefault.sink.flush();

    const noAddress = createSeam({ console: false, sink: { enabled: true, post } });
    h.ok(!noAddress.sink.active, 'an enabled sink with no persisted address is inactive');
    noAddress.error(CHANNELS.gen, 'never sent either');
    await noAddress.sink.flush();

    h.eq(sent.length, 0, 'no network request is made by the logging seam');
    h.eq(noAddress.sink.endpoint, undefined, 'no address means no endpoint');
  });

  await h.test('records are batched into one request bounded by count', async () => {
    const sent: Sent[] = [];
    const seam = createSeam({
      console: false,
      sink: {
        enabled: true,
        baseUrl: BASE_URL + '/',
        post: recordingPost(sent),
        maxBatch: 3,
        flushIntervalMs: 60_000,
      },
    });
    h.eq(seam.sink.endpoint, BASE_URL + '/dev/logs', 'the sink posts to the dev-log route on the persisted address');

    seam.info(CHANNELS.gen, 'one');
    seam.info(CHANNELS.gen, 'two');
    h.eq(sent.length, 0, 'below the count bound nothing is sent yet');
    seam.info(CHANNELS.gen, 'three');
    await settle();

    h.eq(sent.length, 1, 'the count bound flushed exactly one request');
    const batch = JSON.parse(sent[0].body);
    h.eq(batch.records.map((r: { message: string }) => r.message), ['one', 'two', 'three'], 'all three rode one body');
    h.ok(typeof batch.sentAt === 'number', 'the batch carries its send time');
    seam.sink.stop();
  });

  await h.test('the flush interval bounds delivery even below the count', async () => {
    const sent: Sent[] = [];
    const seam = createSeam({
      console: false,
      sink: {
        enabled: true,
        baseUrl: BASE_URL,
        post: recordingPost(sent),
        maxBatch: 100,
        flushIntervalMs: 5,
      },
    });
    seam.info(CHANNELS.gen, 'waiting');
    await new Promise<void>(resolve => setTimeout(resolve, 40));
    h.eq(sent.length, 1, 'the interval delivered the pending record');
    seam.sink.stop();
  });

  await h.test('a full pending queue drops the oldest rather than growing', async () => {
    const sent: Sent[] = [];
    const seam = createSeam({
      console: false,
      sink: {
        enabled: true,
        baseUrl: BASE_URL,
        post: recordingPost(sent),
        maxBatch: 100,
        maxPending: 2,
        flushIntervalMs: 60_000,
      },
    });
    seam.info(CHANNELS.gen, 'a');
    seam.info(CHANNELS.gen, 'b');
    seam.info(CHANNELS.gen, 'c');
    h.eq(seam.sink.dropped, 1, 'one pending record was dropped');
    await seam.sink.flush();
    h.eq(JSON.parse(sent[0].body).records.map((r: { message: string }) => r.message), ['b', 'c'], 'the OLDEST pending was the one dropped');
    h.eq(seam.buffer.snapshot().length, 3, 'the ring buffer still holds all three');
    seam.sink.stop();
  });

  await h.test('an unreachable sink buffers a failure, never throws, and does not retry', async () => {
    const sent: Sent[] = [];
    const seam = createSeam({
      console: false,
      sink: {
        enabled: true,
        baseUrl: 'http://127.0.0.1:1',
        post: recordingPost(sent, true),
        maxBatch: 1,
        flushIntervalMs: 60_000,
      },
    });

    // Fire-and-forget: the caller's stack must not see the rejection.
    seam.error(CHANNELS.gen, 'transport failed', { status: 0 });
    await settle();

    h.eq(sent.length, 1, 'exactly one delivery attempt');
    h.eq(seam.sink.attempts, 1, 'the failed batch is not retried');
    const failures = seam.buffer.snapshot().filter(r => r.channel === CHANNELS.sink);
    h.eq(failures.length, 1, 'the failure is recorded in the ring buffer');
    h.eq(failures[0].fields.detail, 'connect ECONNREFUSED', 'the failure record explains the silence');

    // The failure record itself must not become another delivery.
    await seam.sink.flush();
    await settle();
    h.eq(sent.length, 1, 'recording the failure triggered no further attempt');
    h.eq(seam.sink.attempts, 1, 'and no further batch was formed');
    seam.sink.stop();
  });

  await h.test('a non-2xx response is a recorded failure, not a throw', async () => {
    const sent: Sent[] = [];
    const seam = createSeam({
      console: false,
      sink: {
        enabled: true,
        baseUrl: BASE_URL,
        post: async (url, body) => {
          sent.push({ url, body });
          return { ok: false, status: 500 };
        },
        maxBatch: 100,
        flushIntervalMs: 60_000,
      },
    });
    seam.info(CHANNELS.gen, 'rejected');
    await seam.sink.flush();
    h.eq(sent.length, 1, 'the batch was attempted once');
    const failures = seam.buffer.snapshot().filter(r => r.channel === CHANNELS.sink);
    h.eq(failures.length, 1, 'the rejection is recorded');
    h.eq(failures[0].fields.status, 500, 'with the status as a named field');
    seam.sink.stop();
  });

  await h.test('disabling the sink drops what is pending and stops the timer', async () => {
    const sent: Sent[] = [];
    const seam = createSeam({
      console: false,
      sink: {
        enabled: true,
        baseUrl: BASE_URL,
        post: recordingPost(sent),
        maxBatch: 100,
        flushIntervalMs: 5,
      },
    });
    seam.info(CHANNELS.gen, 'pending');
    seam.sink.configure({ enabled: false });
    await new Promise<void>(resolve => setTimeout(resolve, 40));
    h.eq(sent.length, 0, 'a disabled sink sends nothing');
  });
}
