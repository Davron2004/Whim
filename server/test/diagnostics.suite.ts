/**
 * POST /v1/diagnostics acceptance (developer-observability chain-2, task 2.5; specs/device-
 * diagnostics "The diagnostics route validates, bounds and logs without storing"). Every case goes
 * through `createApp`, so the device gate, the envelope and the consent practice run as in
 * production; the stores are the real SQLite ones on a temporary data directory, so "no database
 * writes" is read back from `usage.db` and `reports.db` themselves.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  APP_VERSION_HEADER,
  BUILD_HEADER,
  CONSENT_HEADER,
  DIAGNOSTICS_MAX_BODY_BYTES,
  PLATFORM_HEADER,
  type ApiError,
} from '@whim/contract';
import { createApp } from '../src/app';
import { loadServerConfig, type ServerConfig } from '../src/config';
import { createStubPipeline } from '../src/pipeline';
import { NodeSqliteUsageStore } from '../src/usage-store';
import { NodeSqliteReportStore } from '../src/reports/store';
import { check, eq, section } from './harness';
import { captureLogs, type LogCapture } from './log-capture';
import { TIMED_OUT, within } from './route-doubles';

const DEVICE_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const DEVICE_B = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';
/** 22:00 UTC; the next UTC day starts two hours later. */
const AT_2200_UTC = Date.UTC(2026, 8, 24, 22, 0, 0, 0);
const NEXT_DAY = Date.UTC(2026, 8, 25, 0, 0, 0, 0);

/** A phone on consent version 2, the first whose disclosure lists error details. */
const ENVELOPE: Readonly<Record<string, string>> = {
  [PLATFORM_HEADER]: 'android',
  [APP_VERSION_HEADER]: '1.2.0',
  [BUILD_HEADER]: '382000',
  [CONSENT_HEADER]: '2',
};

/** pino's numeric level for each record level. */
const PINO_LEVEL = { debug: 20, info: 30, warn: 40, error: 50 } as const;

type Level = keyof typeof PINO_LEVEL;

function record(level: Level, message: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { at: AT_2200_UTC - 1000, level, channel: 'whim:launcher', message, ...extra };
}

function batch(records: readonly Record<string, unknown>[]): { osVersion: string; records: readonly Record<string, unknown>[] } {
  return { osVersion: '14', records };
}

interface Harness {
  app: ReturnType<typeof createApp>;
  dataDir: string;
  now: { value: number };
  close(): void;
}

function harness(config: Partial<ServerConfig> = {}): Harness {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-diagnostics-'));
  const usageStore = new NodeSqliteUsageStore(path.join(dataDir, 'usage.db'));
  const reportStore = new NodeSqliteReportStore(path.join(dataDir, 'reports.db'));
  const now = { value: AT_2200_UTC };
  const app = createApp({
    pipeline: createStubPipeline(0),
    usageStore,
    reportStore,
    config: { ...loadServerConfig({}), ...config },
    clock: () => now.value,
  });
  return {
    app,
    dataDir,
    now,
    close(): void {
      usageStore.close();
      reportStore.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function post(h: Harness, body: string, deviceId = DEVICE_A, envelope: Readonly<Record<string, string>> = ENVELOPE): Promise<Response> {
  const res = await within(
    Promise.resolve(
      h.app.request('/v1/diagnostics', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-whim-device': deviceId, ...envelope },
        body,
      }),
    ),
  );
  if (res === TIMED_OUT) throw new Error('/v1/diagnostics did not answer in time');
  return res;
}

async function postBatch(h: Harness, records: readonly Record<string, unknown>[], deviceId = DEVICE_A): Promise<Response> {
  return post(h, JSON.stringify(batch(records)), deviceId);
}

/** The refusal code, or `undefined` for a body that is not an `ApiError` (a `204` has none). */
async function errorCode(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => null)) as ApiError | null;
  return body?.error;
}

function deviceLines(capture: LogCapture): Record<string, unknown>[] {
  return capture.records.filter((r) => r.scope === 'device');
}

/** Rows in every table of one SQLite file. */
function rowCount(file: string): number {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    return tables.reduce((sum, { name }) => sum + (db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as { c: number }).c, 0);
  } finally {
    db.close();
  }
}

/** A valid batch whose JSON body is exactly `bytes` long: stacks padded across enough records. */
function batchOfExactly(bytes: number): string {
  const records = Array.from({ length: 10 }, (_unused, i) => record('error', `m${i}`, { stack: '' }));
  const base = JSON.stringify(batch(records)).length;
  let missing = bytes - base;
  for (const r of records) {
    const pad = Math.min(4096, missing);
    r.stack = 's'.repeat(pad);
    missing -= pad;
  }
  if (missing !== 0) throw new Error(`setup: cannot pad a batch to ${bytes} bytes`);
  const body = JSON.stringify(batch(records));
  if (Buffer.byteLength(body, 'utf8') !== bytes) throw new Error('setup: padded batch has the wrong length');
  return body;
}

async function testAcceptedRecordsBecomeLogLines(): Promise<void> {
  section('POST /v1/diagnostics — accepted records become log lines, not rows');

  const h = harness();
  const capture = captureLogs();
  let res: Response;
  try {
    res = await postBatch(h, [
      record('error', 'generation failed', { errorClass: 'TypeError', where: 'runtime', requestId: 'req-on-the-phone', route: '/v1/generate' }),
      record('warn', 'slow paint', { screen: 'Home', count: 2 }),
      record('info', 'mini-app failed', { observedRepairAttempts: 3 }),
    ]);
  } finally {
    capture.stop();
  }
  eq('a valid batch of three records → 204', res.status, 204);
  eq('  ... with an empty body', await res.text(), '');
  const lines = deviceLines(capture);
  eq('three scope: "device" lines are logged', lines.length, 3);
  eq('  ... each at its record\'s level', lines.map((l) => l.level), [PINO_LEVEL.error, PINO_LEVEL.warn, PINO_LEVEL.info]);
  eq('  ... each with its record\'s message', lines.map((l) => l.msg), ['generation failed', 'slow paint', 'mini-app failed']);
  eq(
    '  ... each carrying osVersion from the body and platform, version and build from the envelope',
    lines.map((l) => [l.osVersion, l.platform, l.appVersion, l.build]),
    Array.from({ length: 3 }, () => ['14', 'android', '1.2.0', 382000]),
  );
  eq(
    '  ... and the record\'s own allowlisted fields',
    { errorClass: lines[0]?.errorClass, where: lines[0]?.where, route: lines[0]?.route, requestId: lines[0]?.requestId, screen: lines[1]?.screen, count: lines[1]?.count },
    { errorClass: 'TypeError', where: 'runtime', route: '/v1/generate', requestId: 'req-on-the-phone', screen: 'Home', count: 2 },
  );
  check('the device id appears on no line', capture.raw.every((line) => !line.includes(DEVICE_A)));
  eq('usage.db gains no row', rowCount(path.join(h.dataDir, 'usage.db')), 0);
  eq('reports.db gains no row', rowCount(path.join(h.dataDir, 'reports.db')), 0);
  eq('the data directory holds only the two stores\' files', fs.readdirSync(h.dataDir).filter((f) => !/^(usage|reports)\.db(-wal|-shm)?$/.test(f)), []);
  h.close();
}

async function testRefusedBatchesLogNothing(): Promise<void> {
  section('POST /v1/diagnostics — validation, size and consent refusals log no record');

  const h = harness();
  const capture = captureLogs();
  try {
    const unknownKey = await postBatch(h, [record('error', 'fine'), record('error', 'leaky', { detail: 'Alice owes 40' })]);
    eq('a record with a detail field → 400', [unknownKey.status, await errorCode(unknownKey)], [400, 'invalid_request']);

    const bodyKey = await post(h, JSON.stringify({ ...batch([record('error', 'm')]), deviceId: DEVICE_A }));
    eq('a body key beside osVersion and records → 400', bodyKey.status, 400);

    const fifty = await postBatch(h, Array.from({ length: 50 }, (_unused, i) => record('error', `m${i}`)));
    eq('a batch of 50 records → 204', fifty.status, 204);
    const fiftyOne = await postBatch(h, Array.from({ length: 51 }, (_unused, i) => record('error', `m${i}`)));
    eq('a batch of 51 records → 400', fiftyOne.status, 400);

    const atCap = await post(h, batchOfExactly(DIAGNOSTICS_MAX_BODY_BYTES));
    eq('a 32 KB body → 204', atCap.status, 204);
    const overCap = await post(h, batchOfExactly(DIAGNOSTICS_MAX_BODY_BYTES + 1));
    eq('a body one byte over 32 KB → 413 payload_too_large', [overCap.status, await errorCode(overCap)], [413, 'payload_too_large']);

    const v1 = await post(h, JSON.stringify(batch([record('error', 'm')])), DEVICE_A, { ...ENVELOPE, [CONSENT_HEADER]: '1' });
    eq('consent version 1, which lists no error details → 403 consent_required', [v1.status, await errorCode(v1)], [403, 'consent_required']);
    const legacy = await post(h, JSON.stringify(batch([record('error', 'm')])), DEVICE_A, {});
    eq('a legacy client (no envelope) → 403 consent_required', [legacy.status, await errorCode(legacy)], [403, 'consent_required']);
  } finally {
    capture.stop();
  }
  const lines = deviceLines(capture);
  eq('only the two accepted batches were logged (50 + 10 records)', lines.length, 60);
  check('no record of a refused batch was logged', lines.every((l) => l.msg !== 'leaky' && l.msg !== 'fine'));
  check('the refused detail text appears nowhere', capture.raw.every((line) => !line.includes('Alice')));
  h.close();
}

async function testDailyAllowances(): Promise<void> {
  section('POST /v1/diagnostics — a per-device daily allowance and a global ceiling, reset at UTC midnight');

  {
    const h = harness({ limitDiagnosticsPerDeviceDay: 5, limitDiagnosticsPerDay: 1000 });
    const three = (): Record<string, unknown>[] => [record('error', 'a'), record('error', 'b'), record('error', 'c')];
    eq('3 of 5 records → 204', (await postBatch(h, three())).status, 204);
    const over = await postBatch(h, three());
    eq('3 more would make 6 of 5 → 429 daily_limit', [over.status, await errorCode(over)], [429, 'daily_limit']);
    eq('  ... with Retry-After until UTC midnight', over.headers.get('retry-after'), String(2 * 60 * 60));
    eq('exactly the remaining 2 → 204', (await postBatch(h, [record('error', 'd'), record('error', 'e')])).status, 204);
    eq('one more on the same day → 429', (await postBatch(h, [record('error', 'f')])).status, 429);
    eq('another device is not cut off', (await postBatch(h, [record('error', 'g')], DEVICE_B)).status, 204);
    h.now.value = NEXT_DAY;
    eq('the next UTC day the device is allowed again', (await postBatch(h, three())).status, 204);
    h.close();
  }

  {
    const h = harness({ limitDiagnosticsPerDeviceDay: 100, limitDiagnosticsPerDay: 4 });
    eq('device A sends 3 of the 4 global records → 204', (await postBatch(h, [record('error', 'a'), record('error', 'b'), record('error', 'c')])).status, 204);
    const over = await postBatch(h, [record('error', 'd'), record('error', 'e')], DEVICE_B);
    eq('device B\'s 2 would cross the ceiling → 429 server_busy', [over.status, await errorCode(over)], [429, 'server_busy']);
    eq('device B\'s last 1 fits → 204', (await postBatch(h, [record('error', 'f')], DEVICE_B)).status, 204);
    h.now.value = NEXT_DAY;
    eq('the ceiling resets at UTC midnight', (await postBatch(h, [record('error', 'g'), record('error', 'h')], DEVICE_B)).status, 204);
    h.close();
  }
}

export async function runDiagnosticsTests(): Promise<void> {
  await testAcceptedRecordsBecomeLogLines();
  await testRefusedBatchesLogNothing();
  await testDailyAllowances();
}
