/**
 * diagnostics.suite — acceptance for the error-diagnostics path off the phone
 * (developer-observability chain-4; spec device-diagnostics).
 *
 * Records come from the real producers: the seam (`createSeam`), the transport's own error
 * breadcrumb (`httpErrorFrom` → `logMappedError`), and the crash hooks driven with fakes of
 * React Native's `ErrorUtils` and Hermes' rejection tracker. Every uploaded body is checked
 * against the contract's own `DiagnosticsBatch` schema, the one the server parses with.
 *
 * Covers:
 *   - "Only an allowlisted projection of an error record leaves the device" (every scenario)
 *   - "Error-level records are uploaded, batched, deduplicated and capped" (every scenario)
 *   - "Uploads require a current AI-data consent grant" (both scenarios, through the real gate)
 *   - "Uncaught host errors and fatal JS errors are captured" (the slot and both hooks)
 *
 * Runs under Node via `npm run launcher:test` (registered in `../../launcher/test/acceptance.ts`).
 */

import { DiagnosticRecord as DiagnosticRecordSchema, DiagnosticsBatch as DiagnosticsBatchSchema, REQUEST_ID_HEADER } from '@whim/contract';
import type { DevLogRecord, DiagnosticRecord, DiagnosticsBatch } from '@whim/contract';
import type { Harness } from '../../launcher/test/harness';
import { MapKVBackend } from '../../version-store/fs/kv-fs';
import { acceptTerms } from '../../launcher/terms-acceptance';
import { grantConsent, revokeConsent } from '../../launcher/ai-consent';
import { setErrorDetails } from '../../launcher/error-details';
import { saveServerUrl } from '../../launcher/server-address';
import { getDeviceId } from '../../launcher/device-id';
import { appInfoFrom } from '../../launcher/app-info';
import { diagnosticsTarget } from '../../launcher/diagnostics-target';
import { httpErrorFrom } from '../../launcher/transport-shared';
import { CHANNELS } from '../channels';
import { DIAGNOSTIC_FIELDS, toDiagnostic } from '../diagnostic';
import { DIAGNOSTICS_PATH } from '../diagnostics';
import type { DiagnosticsOptions, DiagnosticsTarget, PostDiagnostics } from '../diagnostics';
import { installCrashCapture, renderCrashRecorder } from '../crash-capture';
import type { GlobalErrorHandler, RejectionTracking } from '../crash-capture';
import { keepFatalRecord, readFatalRecord, sendFatalRecord } from '../fatal-slot';
import { createSeam, log } from '../index';
import type { Seam } from '../index';

interface Upload {
  url: string;
  headers: Readonly<Record<string, string>>;
  batch: DiagnosticsBatch;
  body: string;
}

const SERVER = 'http://127.0.0.1:8787';
const TARGET: DiagnosticsTarget = { baseUrl: SERVER, headers: { 'x-whim-device': 'device-1' } };
const APP_INFO = appInfoFrom('android', { version: '1.4.0', build: '381500' });

/** A post that records every body (parsed by the contract's schema) and answers `status`, or
 *  throws when `fail` is set. */
function recordingPost(uploads: Upload[], opts: { fail?: boolean; status?: number } = {}): PostDiagnostics {
  return async (url, headers, body) => {
    uploads.push({ url, headers, batch: JSON.parse(body) as DiagnosticsBatch, body });
    if (opts.fail) throw new Error('connect ECONNREFUSED');
    const status = opts.status ?? 204;
    return { ok: status >= 200 && status < 300, status };
  };
}

/** A seam whose diagnostics transport uploads to `uploads`; nothing is mirrored to the console. */
function uploadingSeam(uploads: Upload[], diagnostics: Partial<DiagnosticsOptions> = {}): Seam {
  return createSeam({
    console: false,
    diagnostics: { target: () => TARGET, osVersion: '15', post: recordingPost(uploads), ...diagnostics },
  });
}

/** The newest record the seam buffered. */
function lastRecord(seam: Seam): DevLogRecord {
  const records = seam.buffer.snapshot();
  return records[records.length - 1];
}

/** Every record of every upload. */
function uploaded(uploads: Upload[]): DiagnosticRecord[] {
  return uploads.flatMap(u => u.batch.records);
}

/** Polls until `predicate` holds or `budgetMs` expires; the caller asserts the property itself. */
async function waitUntil(predicate: () => boolean, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline && !predicate()) await new Promise<void>(resolve => setTimeout(resolve, 5));
}

/** A stand-in for React Native's `ErrorUtils` global: `raise` throws at the installed handler the
 *  way the runtime does. */
function fakeErrorUtils(previous: GlobalErrorHandler) {
  let handler = previous;
  return {
    getGlobalHandler: () => handler,
    setGlobalHandler: (next: GlobalErrorHandler) => {
      handler = next;
    },
    raise: (error: unknown, isFatal: boolean) => handler(error, isFatal),
  };
}

/** A launcher store as the phone holds it after a user accepted the terms and agreed to AI use. */
function consentedStore(): MapKVBackend {
  const kv = new MapKVBackend();
  acceptTerms(kv, '2026-09-24T00:00:00.000Z');
  grantConsent(kv, '2026-09-24T00:00:00.000Z');
  saveServerUrl(kv, SERVER);
  return kv;
}

/** A seam uploading through the real gate over `kv` (an internal build, so the saved address is
 *  honoured and the upload lands at `SERVER`). */
function gatedSeam(kv: MapKVBackend, uploads: Upload[]): Seam {
  return createSeam({
    console: false,
    diagnostics: { target: diagnosticsTarget(kv, () => APP_INFO, true), osVersion: '15', post: recordingPost(uploads) },
  });
}

export async function runDiagnosticsTests(h: Harness): Promise<void> {
  // ── Only an allowlisted projection of an error record leaves the device ──────────────────

  await h.test('projection: the allowlist is exactly the contract record’s keys', () => {
    h.eq(
      Object.keys(DiagnosticRecordSchema.shape).sort((a, b) => a.localeCompare(b)),
      ['at', 'level', 'channel', 'message', ...DIAGNOSTIC_FIELDS].sort((a, b) => a.localeCompare(b)),
      'the device projects onto the same closed set the server accepts',
    );
  });

  await h.test('projection: unknown fields are dropped', () => {
    const seam = createSeam({ console: false });
    seam.error(CHANNELS.gen, 'transport failed', { detail: 'Alice owes 40', url: 'https://api.example/v1/generate', appId: 'tip-splitter', errorClass: 'TypeError' });
    const projected = toDiagnostic(lastRecord(seam));
    h.eq(projected.errorClass, 'TypeError', 'errorClass is carried');
    h.ok(!('detail' in projected) && !('url' in projected) && !('appId' in projected), 'detail, url and appId are not');
    h.ok(DiagnosticRecordSchema.safeParse(projected).success, 'the projection is a record the server accepts');
  });

  await h.test('projection: a reason travels only as a closed code; a sentence in it is dropped', () => {
    const seam = createSeam({ console: false });
    seam.error(CHANNELS.gen, 'failure screen shown', { reason: "Screen names must be unique — repeated: Alice's Lisbon Tab.", stage: 'terminal failure event' });
    const sentence = toDiagnostic(lastRecord(seam));
    seam.error(CHANNELS.gen, 'failure screen shown', { reason: 'terminal_failure', stage: 'terminal failure event' });
    const code = toDiagnostic(lastRecord(seam));
    h.ok(!('reason' in sentence) && !JSON.stringify(sentence).includes('Alice'), 'a sentence in reason never reaches the projection');
    h.eq(code.reason, 'terminal_failure', 'a closed code does');
  });

  await h.test('fatal slot: a kept record whose reason is not a closed code is never sent', async () => {
    const kv = consentedStore();
    kv.set('whim.fatal-error:v1', JSON.stringify({ at: 1, level: 'error', channel: 'whim', message: 'uncaught error', reason: 'Alice owes 40' }));
    const uploads: Upload[] = [];
    await sendFatalRecord(kv, gatedSeam(kv, uploads).diagnostics);
    h.eq(uploads.length, 0, 'nothing is sent');
  });

  await h.test('projection: a host stack loses its message line, even a message spanning lines', () => {
    const seam = createSeam({ console: false });
    const single = new TypeError("cannot read 'total' of undefined");
    const multi = new Error('Alice\nowes 40');
    seam.error(CHANNELS.gen, 'generation step failed', { errorClass: single.name, stack: single.stack });
    const one = toDiagnostic(lastRecord(seam));
    seam.error(CHANNELS.gen, 'generation step failed', { errorClass: multi.name, stack: multi.stack });
    const two = toDiagnostic(lastRecord(seam));
    h.ok(typeof one.stack === 'string' && /^\s+at /.test(one.stack), 'the projected stack starts at the first frame');
    h.ok(!JSON.stringify(one).includes('cannot read'), 'and the message text appears nowhere in the projection');
    h.ok(typeof two.stack === 'string' && !JSON.stringify(two).includes('owes 40'), 'a second message line is dropped too');
  });

  await h.test('projection: strings are capped at 128 characters and a stack at 4 KB', () => {
    const seam = createSeam({ console: false });
    const frames = Array.from({ length: 400 }, (_, i) => `    at frame${i} (index.android.bundle:1:${i})`).join('\n');
    seam.error(CHANNELS.gen, 'generation step failed', { stage: 's'.repeat(300), stack: `Error: boom\n${frames}` });
    const projected = toDiagnostic(lastRecord(seam));
    h.eq(String(projected.stage).length, 128, 'stage is cut to 128 characters');
    h.eq(String(projected.stack).length, 4096, 'the stack is cut to 4096 characters');
    h.ok(DiagnosticRecordSchema.safeParse(projected).success, 'and the result is within the server’s caps');
  });

  await h.test('projection: a full URL is reduced to its path', () => {
    const seam = createSeam({ console: false });
    seam.error(CHANNELS.gen, 'transport failed', { route: 'https://api.example/v1/generate?x=1', kind: 'network' });
    h.eq(toDiagnostic(lastRecord(seam)).route, '/v1/generate', 'route is /v1/generate');
  });

  await h.test('projection: a transport error breadcrumb carries its route and request id, never the host', async () => {
    const before = log.buffer.size;
    const response = new Response(JSON.stringify({ error: 'server_busy', hint: 'Try again soon' }), { status: 429, headers: { [REQUEST_ID_HEADER]: 'req-42' } });
    await httpErrorFrom(response, '/v1/generate', 'https://api.example');
    const record = log.buffer.snapshot().slice(before).find(r => r.message === 'transport failed');
    h.ok(record !== undefined, 'the mapping site logged its breadcrumb');
    if (!record) return;
    const projected = toDiagnostic(record);
    h.eq([projected.route, projected.requestId, projected.status, projected.kind], ['/v1/generate', 'req-42', 429, 'http'], 'route, request id, status and kind travel');
    h.ok(!JSON.stringify(projected).includes('api.example') && !JSON.stringify(projected).includes('Try again'), 'the host and the hint do not');
  });

  await h.test('projection: a mini-app record keeps only its site and a built-in class', () => {
    const seam = createSeam({ console: false });
    seam.error(CHANNELS.page, 'mini-app failed', { where: 'mount', errorClass: 'TypeError', appId: 'tip-splitter', stack: 'TypeError: Alice\n    at x (y:1:1)', reason: 'Alice' });
    const builtIn = toDiagnostic(lastRecord(seam));
    seam.error(CHANNELS.page, 'mini-app error', { where: 'runtime', errorClass: 'Alice owes 40', appId: 'tip-splitter' });
    const custom = toDiagnostic(lastRecord(seam));
    h.eq(builtIn, { at: builtIn.at, level: 'error', channel: CHANNELS.page, message: 'mini-app failed', where: 'mount', errorClass: 'TypeError' }, 'no stack, no reason, no app id');
    h.eq([custom.where, custom.errorClass], ['runtime', 'Other'], 'a name outside the built-in set travels as Other');
  });

  await h.test('projection: a failure the host computes on the page channel keeps its own class', () => {
    const seam = createSeam({ console: false });
    seam.error(CHANNELS.page, 'mini-app failed', { where: 'paint-timeout', errorClass: 'StartupDeadline', appId: 'tip-splitter' });
    h.eq(toDiagnostic(lastRecord(seam)).errorClass, 'StartupDeadline', 'the watchdog’s class is Whim’s own, not the app’s');
  });

  // ── Error-level records are uploaded, batched, deduplicated and capped ───────────────────

  await h.test('upload: a repeating error is one record with its count', async () => {
    const uploads: Upload[] = [];
    const seam = uploadingSeam(uploads);
    for (let i = 0; i < 300; i++) seam.error(CHANNELS.page, 'mini-app error', { where: 'runtime', errorClass: 'TypeError', appId: 'a' });
    await seam.diagnostics.flush();
    h.eq(uploads.length, 1, 'one request');
    h.eq(uploaded(uploads).map(r => [r.message, r.count]), [['mini-app error', 300]], 'carrying the error once, with count 300');
    h.eq(uploads[0].url, SERVER + DIAGNOSTICS_PATH, 'to the diagnostics route of the server address');
    h.eq(uploads[0].headers, TARGET.headers, 'with the gate’s headers');
    h.ok(DiagnosticsBatchSchema.safeParse(uploads[0].batch).success, 'and a body the server’s schema accepts');
    h.eq(Object.keys(uploads[0].batch).sort((a, b) => a.localeCompare(b)), ['osVersion', 'records'], 'the body carries the OS version and nothing else beside its records');
  });

  await h.test('upload: repeats after a flush report only the new count, and still count as one of the 50', async () => {
    const uploads: Upload[] = [];
    const seam = uploadingSeam(uploads, { maxBatch: 100 });
    const repeat = () => seam.error(CHANNELS.gen, 'transport failed', { kind: 'network', route: '/v1/generate' });
    for (let i = 0; i < 5; i++) repeat();
    await seam.diagnostics.flush();
    for (let i = 0; i < 3; i++) repeat();
    for (let i = 0; i < 49; i++) seam.error(CHANNELS.gen, 'generation step failed', { where: `site-${i}` });
    seam.error(CHANNELS.gen, 'generation step failed', { where: 'the 51st' });
    await seam.diagnostics.flush();
    h.eq(uploaded(uploads.slice(0, 1)).map(r => r.count), [5], 'the first flush carries count 5');
    const second = uploaded(uploads.slice(1));
    h.eq(second.filter(r => r.message === 'transport failed').map(r => r.count), [3], 'the next carries it once with count 3');
    h.eq(second.length, 50, 'it plus 49 others fill the session’s 50');
    h.ok(!second.some(r => r.where === 'the 51st'), 'so the 51st distinct record is dropped');
    h.eq(seam.diagnostics.dropped, 1, 'and counted as dropped');
  });

  await h.test('upload: warnings stay on the phone', async () => {
    const uploads: Upload[] = [];
    const seam = uploadingSeam(uploads);
    seam.warn(CHANNELS.gen, 'service refusal', { code: 'server_busy' });
    seam.info(CHANNELS.gen, 'stage', {});
    await seam.diagnostics.flush();
    h.eq(uploads.length, 0, 'no upload includes a warn- or info-level record');
    h.eq(seam.buffer.size, 2, 'though the ring buffer holds both');
  });

  await h.test('upload: the 20th distinct record flushes at once; fewer wait for the interval', async () => {
    const uploads: Upload[] = [];
    const seam = uploadingSeam(uploads, { flushIntervalMs: 60_000 });
    for (let i = 0; i < 19; i++) seam.error(CHANNELS.gen, 'generation step failed', { where: `s${i}` });
    h.eq(uploads.length, 0, '19 distinct records do not flush');
    seam.error(CHANNELS.gen, 'generation step failed', { where: 's19' });
    h.eq(uploads.length, 1, 'the 20th flushes them as one request');
    h.eq(uploads[0].batch.records.length, 20, 'carrying all 20');
    seam.diagnostics.stop();

    const timed: Upload[] = [];
    const slow = uploadingSeam(timed, { flushIntervalMs: 20 });
    slow.error(CHANNELS.gen, 'generation step failed', { stage: 'alone' });
    h.eq(timed.length, 0, 'one record waits');
    await waitUntil(() => timed.length > 0, 2000);
    h.eq(uploaded(timed).map(r => r.stage), ['alone'], 'and goes when the interval elapses');
  });

  await h.test('upload: a batch never exceeds the server’s body limit; what does not fit goes next time', async () => {
    const uploads: Upload[] = [];
    const seam = uploadingSeam(uploads, { maxBatch: 100 });
    const frames = Array.from({ length: 150 }, (_, i) => `    at frame${i} (index.android.bundle:1:${i})`).join('\n');
    for (let i = 0; i < 12; i++) seam.error(CHANNELS.gen, 'generation step failed', { where: `s${i}`, stack: `Error: x\n${frames}` });
    await seam.diagnostics.flush();
    await seam.diagnostics.flush();
    h.ok(uploads.length >= 2, `the records are split over more than one flush (${uploads.length})`);
    h.ok(uploads.every(u => Buffer.byteLength(u.body, 'utf8') <= 32 * 1024), 'every body is within 32 KB');
    h.eq(uploaded(uploads).map(r => r.where), Array.from({ length: 12 }, (_, i) => `s${i}`), 'and every record is sent exactly once, in order');
    seam.diagnostics.stop();
  });

  await h.test('upload: a failed upload is recorded on the sink channel, not retried, and does not recurse', async () => {
    const uploads: Upload[] = [];
    const seam = createSeam({
      console: false,
      diagnostics: { target: () => TARGET, osVersion: '15', post: recordingPost(uploads, { fail: true }) },
    });
    seam.error(CHANNELS.gen, 'transport failed', { kind: 'network' });
    await seam.diagnostics.flush();
    await seam.diagnostics.flush();
    h.eq(seam.diagnostics.attempts, 1, 'one attempt, and a second flush retries nothing');
    const failures = seam.buffer.snapshot().filter(r => r.channel === CHANNELS.sink);
    h.eq(failures.map(r => r.message), ['diagnostics upload failed'], 'one delivery-failure record is in the ring buffer');
    h.eq(uploads.length, 1, 'recording it made no further request');
  });

  await h.test('upload: a refused upload is recorded with its status', async () => {
    const uploads: Upload[] = [];
    const seam = uploadingSeam(uploads, { post: recordingPost(uploads, { status: 403 }) });
    seam.error(CHANNELS.gen, 'transport failed', { kind: 'network' });
    await seam.diagnostics.flush();
    const failure = seam.buffer.snapshot().find(r => r.channel === CHANNELS.sink);
    h.eq([failure?.message, failure?.fields.status], ['diagnostics upload rejected', 403], 'the refusal and its status are in the ring buffer');
  });

  await h.test('upload: a 429 with no delta-seconds Retry-After stops uploads for the rest of the session, discarding what it refused', async () => {
    for (const retryAfter of [null, 'Wed, 21 Oct 2026 07:28:00 GMT']) {
      const uploads: Upload[] = [];
      let clock = 1_000_000;
      const refuseFirst: PostDiagnostics = async (url, headers, body) => {
        uploads.push({ url, headers, batch: JSON.parse(body) as DiagnosticsBatch, body });
        return uploads.length === 1 ? { ok: false, status: 429, retryAfter } : { ok: true, status: 204 };
      };
      const seam = uploadingSeam(uploads, { post: refuseFirst, now: () => clock });
      seam.error(CHANNELS.gen, 'transport failed', { where: 'refused' });
      await seam.diagnostics.flush();
      seam.error(CHANNELS.gen, 'transport failed', { where: 'after-429' });
      await seam.diagnostics.flush();
      clock += 24 * 60 * 60 * 1000;
      seam.error(CHANNELS.gen, 'transport failed', { where: 'a-day-later' });
      await seam.diagnostics.flush();
      h.eq(uploads.length, 1, `Retry-After ${String(retryAfter)}: no request after the 429, however long the session runs`);
      h.eq(seam.diagnostics.attempts, 1, `Retry-After ${String(retryAfter)}: one upload attempt in all: the refused batch was not retried`);
      seam.diagnostics.stop();
    }
  });

  await h.test('upload: a 429 with Retry-After stops uploads until the window has passed; nothing from the pause is sent after it', async () => {
    const uploads: Upload[] = [];
    let clock = 1_000_000;
    const refuseFirst: PostDiagnostics = async (url, headers, body) => {
      uploads.push({ url, headers, batch: JSON.parse(body) as DiagnosticsBatch, body });
      return uploads.length === 1 ? { ok: false, status: 429, retryAfter: '60' } : { ok: true, status: 204 };
    };
    const seam = uploadingSeam(uploads, { post: refuseFirst, now: () => clock });
    seam.error(CHANNELS.gen, 'transport failed', { where: 'refused' });
    await seam.diagnostics.flush();
    clock += 59_000;
    seam.error(CHANNELS.gen, 'transport failed', { where: 'inside-window' });
    await seam.diagnostics.flush();
    h.eq(uploads.length, 1, 'no request inside the Retry-After window');
    clock += 2_000;
    seam.error(CHANNELS.gen, 'transport failed', { where: 'after-window' });
    await seam.diagnostics.flush();
    h.eq(uploaded(uploads.slice(1)).map(r => r.where), ['after-window'], 'after it, only a record logged after the window is sent');
    seam.diagnostics.stop();
  });

  await h.test('upload: a gate that logs an error itself neither recurses nor uploads', async () => {
    const uploads: Upload[] = [];
    let asked = 0;
    const seam: Seam = uploadingSeam(uploads, {
      target: () => {
        asked++;
        seam.error(CHANNELS.gen, 'transport failed', { kind: 'client' });
        return TARGET;
      },
    });
    seam.error(CHANNELS.gen, 'generation step failed', { stage: 'x' });
    await seam.diagnostics.flush();
    h.ok(asked <= 3, `the gate was asked a bounded number of times (${asked})`);
    h.eq(uploaded(uploads).map(r => r.message), ['generation step failed'], 'the record it logged while deciding was not taken');
  });

  // ── Uploads require a current AI-data consent grant ───────────────────────────────────────

  await h.test('consent: with a grant and the switch on, the upload carries the current envelope', async () => {
    const kv = consentedStore();
    const uploads: Upload[] = [];
    const seam = gatedSeam(kv, uploads);
    seam.error(CHANNELS.gen, 'transport failed', { kind: 'network' });
    await seam.diagnostics.flush();
    h.eq(uploads.length, 1, 'one upload');
    const headers = uploads[0]?.headers ?? {};
    h.eq(uploads[0]?.url, SERVER + DIAGNOSTICS_PATH, 'to the saved server address');
    h.eq(
      [headers['x-whim-device'], headers['x-whim-platform'], headers['x-whim-app-version'], headers['x-whim-build']],
      [getDeviceId(kv), 'android', '1.4.0', '381500'],
      'with the device id and the installed app',
    );
    h.eq(headers['x-whim-consent'], String(JSON.parse(kv.getString('whim.ai-consent:v1') ?? '{}').version), 'under the grant’s consent version');
  });

  await h.test('consent: no grant, no upload — and the record is not sent after a later grant', async () => {
    const kv = new MapKVBackend();
    acceptTerms(kv, '2026-09-24T00:00:00.000Z');
    saveServerUrl(kv, SERVER);
    const uploads: Upload[] = [];
    const seam = gatedSeam(kv, uploads);
    seam.error(CHANNELS.gen, 'transport failed', { kind: 'before-grant' });
    await seam.diagnostics.flush();
    h.eq(uploads.length, 0, 'no request without a grant');
    grantConsent(kv, '2026-09-24T00:00:00.000Z');
    await seam.diagnostics.flush();
    h.eq(uploads.length, 0, 'nothing was queued for the grant');
    seam.error(CHANNELS.gen, 'transport failed', { kind: 'after-grant' });
    await seam.diagnostics.flush();
    h.eq(uploaded(uploads).map(r => r.kind), ['after-grant'], 'only a record emitted under the grant goes');
  });

  await h.test('consent: turning AI features off stops uploads, including what was waiting', async () => {
    const kv = consentedStore();
    const uploads: Upload[] = [];
    const seam = gatedSeam(kv, uploads);
    seam.error(CHANNELS.gen, 'transport failed', { kind: 'waiting' });
    revokeConsent(kv);
    seam.error(CHANNELS.gen, 'transport failed', { kind: 'after-revoke' });
    await seam.diagnostics.flush();
    grantConsent(kv, '2026-09-24T00:00:00.000Z');
    await seam.diagnostics.flush();
    h.eq(uploads.length, 0, 'no request after revoking, and none of it resurfaces after a new grant');
  });

  await h.test('consent: a grant without a terms acceptance is not enough', async () => {
    const kv = new MapKVBackend();
    grantConsent(kv, '2026-09-24T00:00:00.000Z');
    saveServerUrl(kv, SERVER);
    const uploads: Upload[] = [];
    const seam = gatedSeam(kv, uploads);
    seam.error(CHANNELS.gen, 'transport failed', { kind: 'network' });
    await seam.diagnostics.flush();
    h.eq(uploads.length, 0, 'no request');
  });

  await h.test('consent: with "Send error details" off there is no upload, and the record is not sent when it is turned back on', async () => {
    const kv = consentedStore();
    setErrorDetails(kv, false);
    const uploads: Upload[] = [];
    const seam = gatedSeam(kv, uploads);
    seam.error(CHANNELS.gen, 'transport failed', { kind: 'switch-off' });
    await seam.diagnostics.flush();
    h.eq(uploads.length, 0, 'no request while the switch is off');
    setErrorDetails(kv, true);
    await seam.diagnostics.flush();
    h.eq(uploads.length, 0, 'the record was discarded, not queued');
    seam.error(CHANNELS.gen, 'transport failed', { kind: 'switch-on' });
    await seam.diagnostics.flush();
    h.eq(uploaded(uploads).map(r => r.kind), ['switch-on'], 'the next record goes, read fresh at the decision');
  });

  // ── Uncaught host errors and fatal JS errors are captured ─────────────────────────────────

  await h.test('crash capture: an uncaught error is an error record, then reaches the previous handler', () => {
    const seam = createSeam({ console: false });
    const previousCalls: Array<[unknown, boolean | undefined]> = [];
    const errorUtils = fakeErrorUtils((error, isFatal) => { previousCalls.push([error, isFatal]); });
    const kept: DiagnosticRecord[] = [];
    installCrashCapture({ errorUtils, hermes: undefined, seam, keepFatal: r => kept.push(r) });
    const err = new RangeError('Alice owes 40');
    errorUtils.raise(err, false);
    h.eq(previousCalls, [[err, false]], 'the previous handler got the same error and flag');
    h.eq([lastRecord(seam).level, lastRecord(seam).fields.where, lastRecord(seam).fields.errorClass], ['error', 'uncaught', 'RangeError'], 'an error-level record was emitted first');
    h.eq(kept.length, 0, 'a non-fatal error is not kept for the next launch');
  });

  await h.test('crash capture: a fatal error keeps its projection, without the message, before the process ends', () => {
    const seam = createSeam({ console: false });
    const order: string[] = [];
    const errorUtils = fakeErrorUtils(() => { order.push('previous'); });
    const kept: DiagnosticRecord[] = [];
    installCrashCapture({ errorUtils, hermes: undefined, seam, keepFatal: r => { order.push('kept'); kept.push(r); } });
    errorUtils.raise(new TypeError("cannot read 'Alice' of undefined"), true);
    h.eq(order, ['kept', 'previous'], 'the record is kept before the previous handler runs');
    h.eq([kept[0]?.where, kept[0]?.errorClass], ['fatal', 'TypeError'], 'the kept record names the site and class');
    h.ok(!JSON.stringify(kept).includes('Alice'), 'and not the message');
  });

  await h.test('crash capture: a failing record keeper still reaches the previous handler', () => {
    const seam = createSeam({ console: false });
    let reached = false;
    const errorUtils = fakeErrorUtils(() => { reached = true; });
    installCrashCapture({ errorUtils, hermes: undefined, seam, keepFatal: () => { throw new Error('store is gone'); } });
    errorUtils.raise(new Error('x'), true);
    h.ok(reached, 'the previous handler still ran');
  });

  await h.test('crash capture: an unhandled rejection is an error record, and the previous tracking still hears of it', () => {
    const seam = createSeam({ console: false });
    let tracking: RejectionTracking | undefined;
    const previous: number[] = [];
    installCrashCapture({
      errorUtils: undefined,
      hermes: { enablePromiseRejectionTracker: options => { tracking = options; } },
      previousRejectionTracking: { onUnhandled: id => previous.push(id) },
      seam,
      keepFatal: () => undefined,
    });
    h.ok(tracking?.allRejections === true, 'the tracker watches every rejection');
    tracking?.onUnhandled(7, new TypeError('no'));
    h.eq([lastRecord(seam).level, lastRecord(seam).fields.where, lastRecord(seam).fields.errorClass], ['error', 'unhandled-rejection', 'TypeError'], 'an error-level record is emitted');
    h.eq(previous, [7], 'and the previous tracking is called with the same id');
  });

  await h.test('crash capture: an engine without the rejection tracker says so once, on a channel that is never uploaded', async () => {
    const uploads: Upload[] = [];
    for (const hermes of [undefined, null, {}]) {
      const seam = uploadingSeam(uploads);
      installCrashCapture({ errorUtils: undefined, hermes, seam, keepFatal: () => undefined });
      const said = seam.buffer.snapshot().filter(r => r.message === 'promise rejection tracker unavailable');
      h.eq(said.map(r => [r.level, r.channel]), [['warn', CHANNELS.sink]], `${JSON.stringify(hermes) ?? 'undefined'}: one warning on the sink channel`);
      await seam.diagnostics.flush();
    }
    h.eq(uploads.length, 0, 'and none of them is uploaded');
    const tracked = createSeam({ console: false });
    installCrashCapture({ errorUtils: undefined, hermes: { enablePromiseRejectionTracker: () => undefined }, seam: tracked, keepFatal: () => undefined });
    h.eq(tracked.buffer.size, 0, 'an engine with the tracker says nothing');
  });

  await h.test('crash capture: a render error the root boundary rethrows is recorded and kept like a fatal error', () => {
    const seam = createSeam({ console: false });
    const kept: DiagnosticRecord[] = [];
    const record = renderCrashRecorder({ seam, keepFatal: r => kept.push(r) });
    record(new TypeError("cannot read 'Alice' of undefined"));
    h.eq([lastRecord(seam).level, lastRecord(seam).fields.where, lastRecord(seam).fields.errorClass], ['error', 'render', 'TypeError'], 'an error-level record names the site and class');
    h.eq([kept.length, kept[0]?.where, kept[0]?.errorClass], [1, 'render', 'TypeError'], 'and its projection is kept for the next launch');
    h.ok(!JSON.stringify(kept).includes('Alice'), 'without the message');
    const failing = renderCrashRecorder({ seam, keepFatal: () => { throw new Error('store is gone'); } });
    let thrown: unknown;
    try {
      failing(new Error('x'));
    } catch (err) {
      thrown = err;
    }
    h.eq(thrown, undefined, 'a failing record keeper never stops the boundary from rethrowing');
  });

  await h.test('fatal slot: a fatal error is uploaded on the next launch, then the stored copy is gone', async () => {
    const kv = consentedStore();
    // The launch that crashes.
    const crashing = gatedSeam(kv, []);
    const errorUtils = fakeErrorUtils(() => undefined);
    installCrashCapture({ errorUtils, hermes: undefined, seam: crashing, keepFatal: r => keepFatalRecord(kv, crashing.diagnostics, r) });
    errorUtils.raise(new TypeError('Alice owes 40'), true);
    crashing.diagnostics.stop();
    h.ok(readFatalRecord(kv) !== undefined, 'the projection is stored');
    // The next launch.
    const uploads: Upload[] = [];
    const next = gatedSeam(kv, uploads);
    await sendFatalRecord(kv, next.diagnostics);
    h.eq(uploaded(uploads).map(r => [r.where, r.errorClass, r.count]), [['fatal', 'TypeError', 1]], 'the next upload carries that error');
    h.ok(!uploads.some(u => u.body.includes('Alice')), 'without its message');
    h.eq(readFatalRecord(kv), undefined, 'and the stored copy is gone');
  });

  await h.test('fatal slot: nothing is kept without consent, and a kept record is deleted, not sent, when consent is gone', async () => {
    const kv = consentedStore();
    const record: DiagnosticRecord = { at: 1, level: 'error', channel: CHANNELS.app, message: 'uncaught error', where: 'fatal', errorClass: 'Error' };
    revokeConsent(kv);
    keepFatalRecord(kv, gatedSeam(kv, []).diagnostics, record);
    h.eq(readFatalRecord(kv), undefined, 'a crash without a grant keeps nothing');
    grantConsent(kv, '2026-09-24T00:00:00.000Z');
    keepFatalRecord(kv, gatedSeam(kv, []).diagnostics, record);
    revokeConsent(kv);
    const uploads: Upload[] = [];
    await sendFatalRecord(kv, gatedSeam(kv, uploads).diagnostics);
    h.eq(uploads.length, 0, 'no request when the next launch has no grant');
    h.eq(readFatalRecord(kv), undefined, 'and the slot is cleared');
  });

  await h.test('fatal slot: a corrupted or widened slot is never sent, and is cleared', async () => {
    for (const [what, raw] of [
      ['not JSON', '{"at":'],
      ['a field outside the allowlist', JSON.stringify({ at: 1, level: 'error', channel: 'whim', message: 'uncaught error', detail: 'Alice owes 40' })],
      ['a route that is a full URL', JSON.stringify({ at: 1, level: 'error', channel: 'whim', message: 'm', route: 'https://api.example/v1/x' })],
    ] as const) {
      const kv = consentedStore();
      kv.set('whim.fatal-error:v1', raw);
      const uploads: Upload[] = [];
      await sendFatalRecord(kv, gatedSeam(kv, uploads).diagnostics);
      h.eq(uploads.length, 0, `${what}: nothing is sent`);
      h.eq(kv.getString('whim.fatal-error:v1'), undefined, `${what}: the slot is cleared`);
    }
  });
}
