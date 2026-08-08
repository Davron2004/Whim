/**
 * Server logging (obs-v1): the `pino` seam's redaction, the removal of the retired
 * `[whim-server]` console helpers, and the dev-only `/dev/logs` sink route.
 *
 * Spec: generation-server §"Server logging is structured and redacted at the serializer" and
 * §"A dev-only log-sink route persists batched device records".
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check, eq, section } from './harness';
import { createApp } from '../src/app';
import { createStubPipeline } from '../src/pipeline';
import { InMemoryUsageStore } from '../src/usage-store';
import { createServerLogger, REDACTED } from '../src/logger';
import { isDevLogBatch, type DevLogSinkOptions } from '../src/routes/dev-logs';
import type { DevLogBatch, DevLogRecord, DevLogSinkPath } from '@whim/contract';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_HEADER = { 'x-whim-device': DEVICE_ID };
const SINK_PATH: DevLogSinkPath = '/dev/logs';

/** Collect what a logger serializes, without touching the process's real stdout. */
function loggerInto(lines: string[]) {
  return createServerLogger({
    level: 'debug',
    destination: {
      write(line: string): void {
        lines.push(line);
      },
    },
  });
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whim-devlogs-'));
}

function record(overrides: Partial<DevLogRecord> = {}): DevLogRecord {
  return { at: 1_700_000_000_000, level: 'info', channel: 'whim:gen', message: 'm', fields: {}, ...overrides };
}

function batch(records: readonly DevLogRecord[]): DevLogBatch {
  return { sentAt: 1_700_000_000_001, records };
}

function sinkApp(sink: DevLogSinkOptions) {
  return createApp({ pipeline: createStubPipeline(0), usageStore: new InMemoryUsageStore(), devLogSink: sink });
}

function postJson(app: ReturnType<typeof createApp>, url: string, body: unknown, headers?: Record<string, string>) {
  return app.request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function readLines(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Spec: "A sensitive field cannot be logged" — the value is replaced with a fixed marker and
 *  appears nowhere in the serialized output, at the top level and nested inside `fields`. */
function testRedactionAtTheSerializer(): void {
  section('logging — the serializer redacts, so a call site cannot leak');

  const lines: string[] = [];
  const log = loggerInto(lines);
  log.info(
    {
      prompt: 'PROMPT-SECRET',
      generatedSource: 'SOURCE-SECRET',
      'x-whim-device': DEVICE_ID,
      apiKey: 'API-KEY-SECRET',
      fields: { prompt: 'NESTED-PROMPT-SECRET', deviceId: DEVICE_ID, detail: { apiKey: 'DEEP-KEY-SECRET' } },
      status: 200,
    },
    'sensitive',
  );

  eq('exactly one record was serialized', lines.length, 1);
  const out = lines[0]!;
  const parsed = JSON.parse(out) as Record<string, unknown>;
  eq('top-level prompt is the marker', parsed.prompt, REDACTED);
  eq('generated source is the marker', parsed.generatedSource, REDACTED);
  eq('the x-whim-device value is the marker', parsed['x-whim-device'], REDACTED);
  eq('the api key is the marker', parsed.apiKey, REDACTED);
  const nested = parsed.fields as Record<string, unknown>;
  eq('a nested prompt is the marker', nested.prompt, REDACTED);
  eq('a nested device id is the marker', nested.deviceId, REDACTED);
  eq('a twice-nested api key is the marker', (nested.detail as Record<string, unknown>).apiKey, REDACTED);
  eq('a non-sensitive field is untouched', parsed.status, 200);

  for (const secret of [
    'PROMPT-SECRET',
    'SOURCE-SECRET',
    'API-KEY-SECRET',
    'NESTED-PROMPT-SECRET',
    'DEEP-KEY-SECRET',
    DEVICE_ID,
  ]) {
    check(`the raw value ${secret} appears nowhere in the output`, !out.includes(secret));
  }
}

/** Spec: "A sensitive field cannot be logged" — the device seam matches field names
 *  case-insensitively to depth 4, so the server's exact-match paths must not be defeated by a
 *  capitalized spelling or by one more level of nesting. */
function testRedactionSurvivesCasingAndDepth(): void {
  section('logging — redaction is not defeated by casing or by one more level of nesting');

  const lines: string[] = [];
  const log = loggerInto(lines);
  log.info(
    {
      Prompt: 'CAPITALIZED-PROMPT-SECRET',
      DeviceId: 'CAPITALIZED-DEVICE-SECRET',
      ApiKey: 'CAPITALIZED-KEY-SECRET',
      Source: 'CAPITALIZED-SOURCE-SECRET',
      fields: { detail: { headers: { apiKey: 'DEPTH-THREE-KEY-SECRET', status: 401 } } },
    },
    'sensitive casing',
  );

  eq('exactly one record was serialized', lines.length, 1);
  const out = lines[0]!;
  const parsed = JSON.parse(out) as Record<string, unknown>;
  eq('a capitalized prompt is the marker', parsed.Prompt, REDACTED);
  eq('a capitalized device id is the marker', parsed.DeviceId, REDACTED);
  eq('a capitalized api key is the marker', parsed.ApiKey, REDACTED);
  eq('a capitalized source is the marker', parsed.Source, REDACTED);

  const headers = ((parsed.fields as Record<string, unknown>).detail as Record<string, unknown>)
    .headers as Record<string, unknown>;
  eq('a thrice-nested api key is the marker', headers.apiKey, REDACTED);
  eq('its non-sensitive sibling survives', headers.status, 401);

  for (const secret of [
    'CAPITALIZED-PROMPT-SECRET',
    'CAPITALIZED-DEVICE-SECRET',
    'CAPITALIZED-KEY-SECRET',
    'CAPITALIZED-SOURCE-SECRET',
    'DEPTH-THREE-KEY-SECRET',
  ]) {
    check(`the raw value ${secret} appears nowhere in the output`, !out.includes(secret));
  }
}

/** Spec: "The old helpers are gone" — `[whim-server]` console logging is neither defined nor
 *  called anywhere under `server/src`, and its module no longer exists. */
function testRetiredHelpersAreGone(): void {
  section('logging — the retired [whim-server] console helpers are gone');

  const srcRoot = path.join(process.cwd(), 'server', 'src');
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) files.push(full);
    }
  };
  walk(srcRoot);

  check('server/src/dev-log.ts no longer exists', !fs.existsSync(path.join(srcRoot, 'dev-log.ts')));
  check('the source tree was actually scanned', files.length > 5);

  const offenders = files.filter((f) => {
    const text = fs.readFileSync(f, 'utf8');
    return /\[whim-server\]/.test(text) || /\blogRun\s*\(/.test(text) || /\blogRequest\s*\(/.test(text);
  });
  eq('no server source defines or calls a retired helper', offenders.map((f) => path.relative(srcRoot, f)), []);
}

/** Spec: "Disabled by default" + "The route is not under the device gate's prefix". */
async function testSinkIsOffByDefaultAndOutsideV1(): Promise<void> {
  section('log sink — disabled by default, and never under /v1');

  const dir = tempDir();
  const file = path.join(dir, 'device.jsonl');

  const disabled = createApp({ pipeline: createStubPipeline(0), usageStore: new InMemoryUsageStore() });
  const res = await postJson(disabled, SINK_PATH, batch([record()]));
  eq('a disabled sink answers 404', res.status, 404);
  check('a disabled sink creates no file', !fs.existsSync(file));

  const enabled = sinkApp({ filePath: file });
  const underV1 = await postJson(enabled, `/v1${SINK_PATH}`, batch([record()]), DEVICE_HEADER);
  eq('the sink is not reachable under the /v1 prefix', underV1.status, 404);

  // …and the /v1 gate itself is untouched: an ungated /v1 request is still refused.
  const ungated = await postJson(enabled, '/v1/generate', { prompt: 'hello' });
  eq('every /v1 route still requires x-whim-device', ungated.status, 400);

  fs.rmSync(dir, { recursive: true, force: true });
}

/** Spec: "A batch is appended" — one JSON line per record, in order, after redaction. */
async function testSinkAppendsInOrder(): Promise<void> {
  section('log sink — a batch is appended, in order, redacted');

  const dir = tempDir();
  const file = path.join(dir, 'device.jsonl');
  const app = sinkApp({ filePath: file });

  const first = await postJson(
    app,
    SINK_PATH,
    batch([
      record({ message: 'one', level: 'debug' }),
      record({ message: 'two', level: 'error', fields: { prompt: 'DEVICE-PROMPT-SECRET', status: 500 } }),
    ]),
  );
  eq('a valid batch is accepted with no body content', first.status, 204);
  eq('the response body is empty', await first.text(), '');

  let lines = readLines(file);
  eq('one line per record', lines.length, 2);
  eq('records keep the order they were sent', lines.map((l) => l.message), ['one', 'two']);
  eq('each line keeps its own level', lines.map((l) => l.level), ['debug', 'error']);
  eq('each line keeps its channel', lines[0]!.channel, 'whim:gen');
  eq('each line keeps its timestamp', lines[0]!.at, 1_700_000_000_000);
  const fields = lines[1]!.fields as Record<string, unknown>;
  eq('a sensitive record field is redacted on disk', fields.prompt, REDACTED);
  eq('a non-sensitive record field survives', fields.status, 500);
  check(
    'the raw sensitive value is nowhere in the file',
    !fs.readFileSync(file, 'utf8').includes('DEVICE-PROMPT-SECRET'),
  );

  // A second batch appends rather than truncating.
  await postJson(app, SINK_PATH, batch([record({ message: 'three' })]));
  lines = readLines(file);
  eq('a second batch appends after the first', lines.map((l) => l.message), ['one', 'two', 'three']);

  fs.rmSync(dir, { recursive: true, force: true });
}

/** Spec: "An over-large batch is refused whole" + "A malformed batch writes nothing". */
async function testSinkRejectsWhole(): Promise<void> {
  section('log sink — an over-large or malformed batch is refused whole');

  const dir = tempDir();
  const file = path.join(dir, 'device.jsonl');
  const app = sinkApp({ filePath: file, maxRecords: 2, maxBodyBytes: 400 });

  await postJson(app, SINK_PATH, batch([record({ message: 'kept' })]));
  const before = fs.readFileSync(file, 'utf8');
  eq('the accepted baseline batch wrote one line', readLines(file).length, 1);

  const tooMany = await postJson(app, SINK_PATH, batch([record(), record(), record()]));
  eq('a batch over the record bound is refused', tooMany.status, 413);
  eq('the refusal is a structured error', ((await tooMany.json()) as { error: string }).error, 'batch_too_large');
  eq('an over-count batch left the file unchanged', fs.readFileSync(file, 'utf8'), before);

  const tooBig = await postJson(app, SINK_PATH, batch([record({ message: 'x'.repeat(500) })]));
  eq('a batch over the byte bound is refused', tooBig.status, 413);
  eq('an over-size batch left the file unchanged', fs.readFileSync(file, 'utf8'), before);

  const notJson = await postJson(app, SINK_PATH, 'not json at all');
  eq('a non-JSON body is refused', notJson.status, 400);
  eq('the refusal is a structured error', ((await notJson.json()) as { error: string }).error, 'invalid_batch');
  eq('a non-JSON body left the file unchanged', fs.readFileSync(file, 'utf8'), before);

  for (const [name, body] of [
    ['a batch with no records array', { sentAt: 1 }],
    ['a batch with a non-numeric sentAt', { sentAt: 'now', records: [] }],
    ['a record with an unknown level', { sentAt: 1, records: [{ ...record(), level: 'trace' }] }],
    ['a record with no fields object', { sentAt: 1, records: [{ ...record(), fields: 'nope' }] }],
    ['a record with a missing message', { sentAt: 1, records: [{ at: 1, level: 'info', channel: 'c', fields: {} }] }],
    ['a record with an empty channel', { sentAt: 1, records: [{ ...record(), channel: '' }] }],
    ['a record with a non-numeric at', { sentAt: 1, records: [{ ...record(), at: 'yesterday' }] }],
    ['a record that is not an object', { sentAt: 1, records: ['just a string'] }],
  ] as const) {
    const res = await postJson(app, SINK_PATH, body);
    eq(`${name} is refused`, res.status, 400);
    eq(`${name} left the file unchanged`, fs.readFileSync(file, 'utf8'), before);
  }

  // The guard is the thing being relied on — check it directly too.
  check('the guard accepts a well-formed batch', isDevLogBatch(batch([record()])));
  check('the guard rejects a bare array', !isDevLogBatch([record()]));

  fs.rmSync(dir, { recursive: true, force: true });
}

export async function runLoggingTests(): Promise<void> {
  testRedactionAtTheSerializer();
  testRedactionSurvivesCasingAndDepth();
  testRetiredHelpersAreGone();
  await testSinkIsOffByDefaultAndOutsideV1();
  await testSinkAppendsInOrder();
  await testSinkRejectsWhole();
}
