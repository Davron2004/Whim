/**
 * The `/v1` request edge (request-envelope): one request id per request, on every response, every
 * log line and the ledger row; the client envelope and its legacy default; the envelope fields on
 * the request log line; the consent practice table and its `consent_required` backstop, with the
 * static check that every route calling a model or storing data declares its practice; the
 * server's own traffic generators sending a real envelope; and the per-platform minimum-build gate
 * with the `/healthz` field that reports it.
 *
 * Spec: specs/request-envelope/spec.md (all requirements); specs/app-update-gate/spec.md "The
 * server refuses builds below a per-platform minimum". Every request and stream read is bounded,
 * so a regression fails its check by name instead of hanging the suite.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { getRequestListener } from '@hono/node-server';
import {
  ApiError,
  APP_VERSION_HEADER,
  BUILD_HEADER,
  CONSENT_HEADER,
  PLATFORM_HEADER,
  REQUEST_ID_HEADER,
  type GenerationEvent,
  type Usage,
} from '@whim/contract';
import { check, eq, section } from './harness';
import { captureLogs, withMessage, type LogCapture } from './log-capture';
import { readSseResponse } from './sse-reader';
import { ControlledModelClient, RecordingUsageStore, TIMED_OUT, machinePipeline, within } from './route-doubles';
import { createApp, type AppOptions } from '../src/app';
import { loadServerConfig, type ServerConfig } from '../src/config';
import { createStubPipeline } from '../src/pipeline';
import { InMemoryUsageStore } from '../src/usage-store';
import { InMemoryReportStore } from '../src/reports/store';
import { cachedPolicy, ModelContentPolicy } from '../src/policy';
import { defaultModelRoster, openRouterModelClient, type ModelClient, type ModelRoster, type ModelStream } from '../src/generation/model';
import { OpenRouterClient, type FetchFn } from '../src/openrouter';
import { PRACTICE_CATEGORIES, PRACTICES, permits, type PracticeTable } from '../src/consent-practices';
import { BENCH_APP_VERSION } from '../src/bench-envelope';
import { runDevice } from '../src/loadtest/drive';
import { parseNativeReleaseConfig } from '../../scripts/release/lib/native-config';

const DEVICE_ID = '12121212-1212-4121-8121-121212121212';
const ROSTER: ModelRoster = defaultModelRoster('vendor/rewrite-edge', 'vendor/engineer-edge');
const AT_NOON_UTC = Date.UTC(2026, 0, 15, 12, 0, 0);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROUTES_DIR = path.join(process.cwd(), 'server/src/routes');

/** A complete client envelope from build 381500. */
const ENVELOPE: Readonly<Record<string, string>> = {
  [PLATFORM_HEADER]: 'ios',
  [APP_VERSION_HEADER]: '1.0.0',
  [BUILD_HEADER]: '381500',
  [CONSENT_HEADER]: '1',
};

// ─── Doubles and helpers ─────────────────────────────────────────────────────

/** A model that must never be reached: every call is counted, then refused. */
class ForbiddenModel implements ModelClient {
  calls = 0;

  stream(): ModelStream {
    this.calls++;
    throw new Error('no model call was expected');
  }
}

/** A store whose `read` fails, so `GET /v1/usage` throws into the app's error handler. */
class ReadFailingStore extends InMemoryUsageStore {
  override async read(): Promise<Usage> {
    throw new Error('store blip');
  }
}

function testApp(options: Omit<Partial<AppOptions>, 'config'> & { config?: Partial<ServerConfig> } = {}): ReturnType<typeof createApp> {
  const { config, ...rest } = options;
  return createApp({
    pipeline: createStubPipeline(0),
    usageStore: new RecordingUsageStore(),
    ...rest,
    config: { ...loadServerConfig({}), now: () => AT_NOON_UTC, ...config },
  });
}

/** An app whose every model — the classifier, the route's own turn, the pipeline — is one
 *  `ForbiddenModel`, over a recording ledger: for refusals that must land before any model work or
 *  admission. */
function forbiddenModelApp(config?: Partial<ServerConfig>): { app: ReturnType<typeof createApp>; model: ForbiddenModel; usageStore: RecordingUsageStore } {
  const model = new ForbiddenModel();
  const usageStore = new RecordingUsageStore();
  const app = testApp({
    usageStore,
    model,
    roster: ROSTER,
    pipeline: machinePipeline(model, { now: () => AT_NOON_UTC }, ROSTER),
    policy: cachedPolicy(new ModelContentPolicy({ modelClient: model, rewriteModelId: ROSTER.rewrite.model, categories: 'test', timeoutMs: 1000 })),
    config,
  });
  return { app, model, usageStore };
}

async function send(
  app: ReturnType<typeof createApp>,
  route: string,
  headers: Readonly<Record<string, string>>,
  body?: unknown,
): Promise<Response> {
  const res = await within(
    Promise.resolve(
      app.request(route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    ),
  );
  if (res === TIMED_OUT) throw new Error(`${route} did not answer in time`);
  return res;
}

async function drain(label: string, res: Response): Promise<GenerationEvent[]> {
  const read = await within(readSseResponse(res));
  check(`${label}: the stream ended`, read !== TIMED_OUT);
  return read === TIMED_OUT ? [] : read.events.map((e) => e.data);
}

/** The per-request log records for `route`. */
function requestLines(capture: LogCapture, route: string): Record<string, unknown>[] {
  return withMessage(capture, 'request').filter((r) => r.path === route);
}

async function refusalCode(res: Response): Promise<string | undefined> {
  const body = ApiError.safeParse(await res.json());
  return body.success ? body.data.error : undefined;
}

// ─── One request id follows a /v1 request everywhere ─────────────────────────

async function testRequestIdOnEveryResponse(): Promise<void> {
  section('Request id — minted per /v1 request, on every response and its request line');

  const capture = captureLogs();
  try {
    {
      capture.records.length = 0;
      const res = await send(testApp(), '/v1/generate', {}, { prompt: 'a timer' });
      const id = res.headers.get(REQUEST_ID_HEADER);
      eq('a request with no device header is refused by the device gate', res.status, 400);
      check('the device-gate refusal still carries a UUID request id', UUID_RE.test(id ?? ''), String(id));
      eq('its request line carries the same requestId', requestLines(capture, '/v1/generate').map((r) => [r.status, r.requestId]), [[400, id]]);
    }

    {
      capture.records.length = 0;
      const app = testApp({ config: { limitGenerationsPerDeviceDay: 0 } });
      const res = await send(app, '/v1/generate', { 'x-whim-device': DEVICE_ID }, { prompt: 'a timer' });
      const id = res.headers.get(REQUEST_ID_HEADER);
      eq('an exhausted daily allowance refuses 429', res.status, 429);
      eq('the refusal is daily_limit', await refusalCode(res), 'daily_limit');
      check('the 429 carries a request id', UUID_RE.test(id ?? ''), String(id));
      eq('the refusal line carries the same requestId', requestLines(capture, '/v1/generate').map((r) => [r.status, r.requestId]), [[429, id]]);
    }

    {
      capture.records.length = 0;
      const res = await send(testApp(), '/v1/generate', { 'x-whim-device': DEVICE_ID }, { prompt: 'a timer' });
      const id = res.headers.get(REQUEST_ID_HEADER);
      check('the SSE open carries a request id before the body is read', res.status === 200 && UUID_RE.test(id ?? ''), String(id));
      const events = await drain('streamed generate', res);
      eq('sanity: the stream ends in its result', events.at(-1)?.type, 'result');
      eq('the settled stream logs one request line with the same requestId', requestLines(capture, '/v1/generate').map((r) => r.requestId), [id]);
    }

    {
      capture.records.length = 0;
      const res = await send(testApp({ usageStore: new ReadFailingStore() }), '/v1/usage', { 'x-whim-device': DEVICE_ID });
      const id = res.headers.get(REQUEST_ID_HEADER);
      eq('a throwing route answers 500', res.status, 500);
      check('the 500 carries a request id', UUID_RE.test(id ?? ''), String(id));
      eq('the error log line carries the same requestId', withMessage(capture, 'unhandled route error').map((r) => r.requestId), [id]);
    }

    {
      const app = testApp();
      const first = await send(app, '/v1/usage', { 'x-whim-device': DEVICE_ID });
      const second = await send(app, '/v1/usage', { 'x-whim-device': DEVICE_ID });
      check('two requests get two ids', first.headers.get(REQUEST_ID_HEADER) !== second.headers.get(REQUEST_ID_HEADER));
      eq('a route outside /v1 carries no request id', (await send(app, '/healthz', {})).headers.get(REQUEST_ID_HEADER), null);
    }
  } finally {
    capture.stop();
  }
}

/** Spec "A failed generation joins up": the header, the ledger row and the pipeline's lines — the
 *  terminal line and the step-level stage lines — all carry one id. */
async function testFailedGenerationJoinsUp(): Promise<void> {
  section('Request id — a failed generation: header, ledger row and run lines agree');

  const usageStore = new RecordingUsageStore();
  const model = new ControlledModelClient(['not a plan', 'still not a plan'], 'gen-edge');
  const app = testApp({ usageStore, pipeline: machinePipeline(model, { now: () => AT_NOON_UTC }, ROSTER) });
  const capture = captureLogs();
  let id: string | null = null;
  try {
    const res = await send(app, '/v1/generate', { 'x-whim-device': DEVICE_ID }, { prompt: 'a timer' });
    id = res.headers.get(REQUEST_ID_HEADER);
    const events = await drain('failed generation', res);
    eq('the run ends in a failure terminal', events.at(-1)?.type, 'failure');
  } finally {
    capture.stop();
  }

  check('the response carries a request id', UUID_RE.test(id ?? ''), String(id));
  eq('the ledger row id is the request id', usageStore.admitted, [id]);
  eq('the ledger row settled as failed', usageStore.settlesFor(id ?? undefined).map((s) => s.outcome), ['failed']);
  eq('the terminal failure line carries the request id', withMessage(capture, 'terminal failure').map((r) => r.requestId), [id]);
  const stageLines = withMessage(capture, 'stage');
  check('the run logged its stage transitions', stageLines.length >= 2, `${stageLines.length} stage lines`);
  check('every stage line carries the request id', stageLines.every((r) => r.requestId === id), JSON.stringify(stageLines.map((r) => r.requestId)));
  eq('the run start line carries the request id', withMessage(capture, 'run start').map((r) => r.requestId), [id]);
}

/** One SSE `data:` line built from a frame object — avoids hand-escaping nested JSON. */
function sseFrame(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * A fetch double that answers successive calls IN ORDER (repeating the last reply once the list is
 * exhausted), each over a real SSE stream — so calls made through the REAL `OpenRouterClient`
 * (the classifier's own call, then the route's/pipeline's own model turn(s)) each still log their
 * own "model call" line, unlike `ControlledModelClient`/`ScriptedModelClient`.
 */
function sequencedModelFetch(replies: ReadonlyArray<{ id: string; text: string }>): FetchFn {
  let index = 0;
  return (async () => {
    const reply = replies[Math.min(index, replies.length - 1)]!;
    index += 1;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseFrame({ id: reply.id, choices: [{ index: 0, delta: { content: reply.text } }] })));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as FetchFn;
}

/** The REAL model client answering `replies` in order, and the policy cache classifying through it. */
function realModelStack(replies: ReadonlyArray<{ id: string; text: string }>) {
  const client = openRouterModelClient(new OpenRouterClient(sequencedModelFetch(replies)));
  const policy = cachedPolicy(
    new ModelContentPolicy({ modelClient: client, rewriteModelId: ROSTER.rewrite.model, categories: 'test', timeoutMs: 5000 }),
  );
  return { client, policy };
}

/** The captured `model call` lines as pino serialized them. pino writes a duplicate key twice and
 *  `JSON.parse` keeps only the last, so only the raw text can show a second `scope`. */
function rawModelCallLines(capture: LogCapture): string[] {
  return capture.raw.filter((_, index) => capture.records[index]?.msg === 'model call');
}

/** Per raw `model call` line: how many `scope` keys it carries, and whether it carries `requestId`. */
function scopeAndRequestId(capture: LogCapture, requestId: string | null): Array<[number, boolean]> {
  return rawModelCallLines(capture).map((line) => [line.split('"scope":').length - 1, line.includes(`"requestId":"${requestId}"`)]);
}

/** Checks the model call lines and the policy line of one request against its `id`: every model
 *  call line carries it and exactly one `scope` key, and the one policy line carries it. */
function checkProviderAndPolicyLines(label: string, capture: LogCapture, id: string | null, modelCalls: number): void {
  const modelCallLines = withMessage(capture, 'model call');
  check(
    `${label}: every model call line carries the request id`,
    modelCallLines.every((r) => r.requestId === id),
    JSON.stringify(modelCallLines.map((r) => r.requestId)),
  );
  eq(
    `${label}: every raw model call line holds one scope key and the request id`,
    scopeAndRequestId(capture, id),
    Array.from({ length: modelCalls }, () => [1, true]),
  );
  const policyLines = withMessage(capture, 'content policy check');
  eq(`${label}: exactly one content policy check line`, policyLines.length, 1);
  eq(`${label}: the content policy check line carries the request id`, policyLines[0]?.requestId, id);
}

/**
 * request-envelope chain-1b: OpenRouter's own "model call" line and the policy cache's "content
 * policy check" line are emitted deep inside the model client and the policy cache respectively —
 * chain-1 bound every OTHER line (the request line, the ledger row, every pipeline run line) to the
 * request id but stopped at these two. Uses the REAL `OpenRouterClient`, not `ControlledModelClient`
 * / `ScriptedModelClient`, since only the real adapter logs a "model call" line at all. Red-check:
 * fails naming the line whose `requestId` is `undefined` if any one call site (the classifier, the
 * clarify turn, the rewrite turn, the pipeline's plan turn, or `cachedPolicy`) stops forwarding its
 * request-bound logger, and fails on the raw line if a caller hands the model client a logger that
 * already carries a `scope` (the run logger did, so plan lines carried `"scope"` twice).
 */
async function testProviderAndPolicyLinesCarryRequestId(): Promise<void> {
  section('Request id — the model client\'s "model call" line and the policy cache\'s "content policy check" line agree with the response header');

  // Clarify and rewrite: the classifier's own call (admission) and the route's own model turn.
  const unaryCases = [
    ['/v1/clarify', 'clarify', '{"questions":[]}'],
    ['/v1/rewrite', 'rewrite', JSON.stringify({ rewrittenPrompt: 'a timer', plan: [{ label: 'What', text: 'A timer.' }] })],
  ] as const;
  for (const [route, role, reply] of unaryCases) {
    const { client, policy } = realModelStack([
      { id: `gen-edge-policy-${role}`, text: '{"verdict":"allow"}' },
      { id: `gen-edge-${role}`, text: reply },
    ]);
    const app = testApp({ model: client, roster: ROSTER, policy });
    const capture = captureLogs();
    let res: Response;
    try {
      res = await send(app, route, { 'x-whim-device': DEVICE_ID }, { prompt: 'a timer' });
    } finally {
      capture.stop();
    }
    const id = res.headers.get(REQUEST_ID_HEADER);
    eq(`${route} setup: the route answered 200 on its first model turn`, res.status, 200);
    check(`${route} setup: a real request id was minted`, UUID_RE.test(id ?? ''), String(id));
    eq(
      `${route}: exactly two model call lines, attributed to the classifier and the ${role} turn`,
      withMessage(capture, 'model call').map((r) => r.role),
      ['policy', role],
    );
    checkProviderAndPolicyLines(route, capture, id, 2);
  }

  // Generate: the classifier's own call (admission) and the pipeline's own plan turn(s), through
  // `machinePipeline`'s real `GenerationMachine` (stages past the plan call are unreachable — an
  // unparsable plan, twice, ends the run in a failure, which is all this needs to observe).
  {
    const { client, policy } = realModelStack([
      { id: 'gen-edge-policy-generate', text: '{"verdict":"allow"}' },
      { id: 'gen-edge-plan-1', text: 'not a plan' },
      { id: 'gen-edge-plan-2', text: 'still not a plan' },
    ]);
    const app = testApp({ policy, pipeline: machinePipeline(client, { now: () => AT_NOON_UTC }, ROSTER) });
    const capture = captureLogs();
    let id: string | null;
    try {
      const res = await send(app, '/v1/generate', { 'x-whim-device': DEVICE_ID }, { prompt: 'a timer' });
      id = res.headers.get(REQUEST_ID_HEADER);
      const events = await drain('provider-lines generate', res);
      eq('setup: the run ends in a failure (an unparsable plan, twice)', events.at(-1)?.type, 'failure');
    } finally {
      capture.stop();
    }
    eq(
      '/v1/generate: exactly three model call lines, the classifier and two plan attempts',
      withMessage(capture, 'model call').map((r) => r.role),
      ['policy', 'plan', 'plan'],
    );
    checkProviderAndPolicyLines('/v1/generate', capture, id, 3);
  }
}

// ─── The envelope, its legacy default, and the request line ──────────────────

async function testEnvelopeOnTheRequestLine(): Promise<void> {
  section('Envelope — a legacy client is served, and the request line carries the envelope, never the device');

  const capture = captureLogs();
  try {
    {
      capture.records.length = 0;
      const res = await send(testApp(), '/v1/generate', { 'x-whim-device': DEVICE_ID }, { prompt: 'a timer' });
      const events = await drain('legacy generate', res);
      eq('a request with no envelope is served as before', [res.status, events.at(-1)?.type], [200, 'result']);
      check('the legacy response still carries a request id', UUID_RE.test(res.headers.get(REQUEST_ID_HEADER) ?? ''));
      const [line] = requestLines(capture, '/v1/generate');
      eq(
        'its request line records the legacy envelope',
        { platform: line?.platform, appVersion: line?.appVersion, build: line?.build, consent: line?.consent },
        { platform: 'unknown', appVersion: 'unknown', build: 0, consent: 1 },
      );
    }

    // Both paths that write a request line: the app middleware (unary) and the SSE route's own.
    for (const [route, body] of [['/v1/usage', undefined], ['/v1/generate', { prompt: 'a timer' }]] as const) {
      capture.records.length = 0;
      capture.raw.length = 0;
      const res = await send(testApp(), route, { 'x-whim-device': DEVICE_ID, ...ENVELOPE }, body);
      if (route === '/v1/generate') await drain('enveloped generate', res);
      const lines = requestLines(capture, route);
      eq(`${route}: one request line`, lines.length, 1);
      const [line] = lines;
      eq(
        `${route}: the line carries requestId and the envelope`,
        { requestId: line?.requestId, platform: line?.platform, appVersion: line?.appVersion, build: line?.build, consent: line?.consent },
        { requestId: res.headers.get(REQUEST_ID_HEADER), platform: 'ios', appVersion: '1.0.0', build: 381500, consent: 1 },
      );
      check(`${route}: no emitted line carries the device id`, !capture.raw.some((l) => l.includes(DEVICE_ID)));
    }
  } finally {
    capture.stop();
  }
}

async function testEnvelopeRefusals(): Promise<void> {
  section('Envelope — a half or malformed envelope is refused 400 before any admission');

  const expectRefused = async (label: string, headers: Record<string, string>, names: string): Promise<void> => {
    const { app, model, usageStore } = forbiddenModelApp();
    const res = await send(app, '/v1/generate', { 'x-whim-device': DEVICE_ID, ...headers }, { prompt: 'a timer' });
    const body = ApiError.safeParse(await res.json());
    eq(`${label}: refused 400`, res.status, 400);
    eq(`${label}: an invalid_envelope ApiError`, body.success ? body.data.error : body.error.issues, 'invalid_envelope');
    check(`${label}: the hint names ${names}`, body.success && body.data.hint.includes(names), body.success ? body.data.hint : '');
    check(`${label}: the refusal carries a request id`, UUID_RE.test(res.headers.get(REQUEST_ID_HEADER) ?? ''));
    eq(`${label}: no ledger row was admitted`, usageStore.admitted, []);
    eq(`${label}: no model was called`, model.calls, 0);
  };

  await expectRefused('build without platform', { [BUILD_HEADER]: '381500' }, PLATFORM_HEADER);
  await expectRefused('an unknown platform', { ...ENVELOPE, [PLATFORM_HEADER]: 'windows' }, PLATFORM_HEADER);
  await expectRefused('a malformed build', { ...ENVELOPE, [BUILD_HEADER]: '38.15' }, BUILD_HEADER);
  await expectRefused('a malformed consent', { ...ENVELOPE, [CONSENT_HEADER]: '0' }, CONSENT_HEADER);
  await expectRefused('an empty app version', { ...ENVELOPE, [APP_VERSION_HEADER]: '' }, APP_VERSION_HEADER);

  const noDevice = await send(testApp(), '/v1/generate', { [BUILD_HEADER]: '381500' }, { prompt: 'a timer' });
  eq('the device gate runs before the envelope check', await refusalCode(noDevice), 'missing_device_id');
}

// ─── The minimum-build gate ──────────────────────────────────────────────────

/** `ENVELOPE` (build 381500) from an Android phone. */
const ANDROID_ENVELOPE: Readonly<Record<string, string>> = { ...ENVELOPE, [PLATFORM_HEADER]: 'android' };

/** The minimums `loadServerConfig` reads from these operator variables — the same path production
 *  takes, so a variable that stopped reaching the gate fails here too. */
function minimumsFrom(env: NodeJS.ProcessEnv): Partial<ServerConfig> {
  const { minBuildIos, minBuildAndroid } = loadServerConfig(env);
  return { minBuildIos, minBuildAndroid };
}

async function testOldBuildTurnedAway(): Promise<void> {
  section('Minimum build — an old build is refused 426 before admission; the other platform is served');

  const usageStore = new RecordingUsageStore();
  const app = testApp({ usageStore, stub: true, config: minimumsFrom({ WHIM_MIN_BUILD_ANDROID: '382000' }) });
  const device = { 'x-whim-device': DEVICE_ID };
  const capture = captureLogs();
  try {
    const refused = await send(app, '/v1/clarify', { ...device, ...ANDROID_ENVELOPE }, { prompt: 'a timer' });
    const id = refused.headers.get(REQUEST_ID_HEADER);
    eq('Android build 381500 against an Android minimum of 382000 → 426', refused.status, 426);
    eq('refused update_required', await refusalCode(refused), 'update_required');
    eq('with no Retry-After (only an update clears it)', refused.headers.get('retry-after'), null);
    check('the 426 carries a request id', UUID_RE.test(id ?? ''), String(id));
    eq(
      'its request line carries the same requestId and the refused envelope',
      requestLines(capture, '/v1/clarify').map((r) => [r.status, r.requestId, r.platform, r.build]),
      [[426, id, 'android', 381500]],
    );
    eq('no ledger row was admitted for it', usageStore.admitted, []);

    const served = await send(app, '/v1/clarify', { ...device, ...ENVELOPE }, { prompt: 'a timer' });
    eq('iOS build 381500 on the same server is served', served.status, 200);
    eq('... and admitted, so admission was reachable all along', usageStore.admitted, [served.headers.get(REQUEST_ID_HEADER)]);

    const atMinimum = await send(app, '/v1/clarify', { ...device, ...ANDROID_ENVELOPE, [BUILD_HEADER]: '382000' }, { prompt: 'a timer' });
    eq('an Android build exactly at the minimum is served', atMinimum.status, 200);
  } finally {
    capture.stop();
  }
}

async function testEveryV1RouteGated(): Promise<void> {
  section('Minimum build — every /v1 route is gated by prefix, before any model work, after the device and envelope checks');

  const routes = [
    ['/v1/generate', { prompt: 'a timer' }],
    ['/v1/rewrite', { prompt: 'a timer' }],
    ['/v1/clarify', { prompt: 'a timer' }],
    ['/v1/report', { reason: 'broken' }],
    ['/v1/usage', undefined],
  ] as const;
  for (const [route, body] of routes) {
    const { app, model, usageStore } = forbiddenModelApp(minimumsFrom({ WHIM_MIN_BUILD_ANDROID: '382000' }));
    const res = await send(app, route, { 'x-whim-device': DEVICE_ID, ...ANDROID_ENVELOPE }, body);
    eq(`${route}: an old Android build → 426 update_required`, [res.status, await refusalCode(res)], [426, 'update_required']);
    eq(`${route}: no model was called (classifier included)`, model.calls, 0);
    eq(`${route}: no ledger row was admitted`, usageStore.admitted, []);
  }

  const raised = minimumsFrom({ WHIM_MIN_BUILD_ANDROID: '382000' });
  const noDevice = await send(testApp({ config: raised }), '/v1/clarify', ANDROID_ENVELOPE, { prompt: 'a timer' });
  eq('the device gate runs before the minimum-build gate', [noDevice.status, await refusalCode(noDevice)], [400, 'missing_device_id']);
  const halfEnvelope = await send(testApp({ config: raised }), '/v1/clarify', { 'x-whim-device': DEVICE_ID, [PLATFORM_HEADER]: 'android', [BUILD_HEADER]: '381500' }, { prompt: 'a timer' });
  eq('the envelope check runs before the minimum-build gate', [halfEnvelope.status, await refusalCode(halfEnvelope)], [400, 'invalid_envelope']);
}

async function testLegacyAndDefaults(): Promise<void> {
  section('Minimum build — a legacy client is build 0 on both platforms; minimums off by default');

  const legacy = { 'x-whim-device': DEVICE_ID };
  for (const variable of ['WHIM_MIN_BUILD_IOS', 'WHIM_MIN_BUILD_ANDROID']) {
    const app = testApp({ stub: true, config: minimumsFrom({ [variable]: '1' }) });
    const res = await send(app, '/v1/clarify', legacy, { prompt: 'a timer' });
    eq(`only ${variable} raised (to 1): a legacy client is refused 426 update_required`, [res.status, await refusalCode(res)], [426, 'update_required']);
    const enveloped = await send(app, '/v1/clarify', { ...legacy, ...ENVELOPE, [PLATFORM_HEADER]: variable === 'WHIM_MIN_BUILD_IOS' ? 'android' : 'ios', [BUILD_HEADER]: '1' }, { prompt: 'a timer' });
    eq(`only ${variable} raised: build 1 of the other platform is served`, enveloped.status, 200);
  }

  const app = testApp({ stub: true, config: minimumsFrom({}) });
  const legacyServed = await send(app, '/v1/clarify', legacy, { prompt: 'a timer' });
  eq('neither minimum configured: a legacy client is served', legacyServed.status, 200);
  for (const platform of ['ios', 'android']) {
    const res = await send(app, '/v1/clarify', { ...legacy, ...ENVELOPE, [PLATFORM_HEADER]: platform, [BUILD_HEADER]: '1' }, { prompt: 'a timer' });
    eq(`neither minimum configured: ${platform} build 1 is served`, res.status, 200);
  }
  eq('neither minimum configured: /healthz reports both as 0', await (await send(app, '/healthz', {})).json(), { ok: true, service: 'whim-server', minBuild: { ios: 0, android: 0 } });
}

async function testHealthzReportsMinimums(): Promise<void> {
  section('Minimum build — /healthz reports the live minimums, anonymously and outside /v1');

  const app = testApp({ config: minimumsFrom({ WHIM_MIN_BUILD_IOS: '381000', WHIM_MIN_BUILD_ANDROID: '382000' }) });
  const res = await send(app, '/healthz', {});
  eq('no device header or envelope needed: 200', res.status, 200);
  eq('the body carries both minimums, every other field unchanged', await res.json(), { ok: true, service: 'whim-server', minBuild: { ios: 381000, android: 382000 } });
  const junkEnvelope = await send(app, '/healthz', { [BUILD_HEADER]: 'junk' });
  eq('a malformed envelope header does not reach /healthz (no envelope is read there)', junkEnvelope.status, 200);
}

// ─── Consent practices ───────────────────────────────────────────────────────

function testPermits(): void {
  section('Consent practices — permits() reads the append-only table');

  for (const category of PRACTICE_CATEGORIES) {
    check(`version 1 covers ${category}`, permits(1, category));
    check(`consent none covers no ${category}`, !permits('none', category));
    eq(`a version above the highest known reads as it for ${category}`, permits(99, category), permits(1, category));
  }

  const table: PracticeTable = {
    1: new Set(['request-material']),
    2: new Set(['request-material', 'reports']),
  };
  check('a version grants what its own set covers', permits(2, 'reports', table));
  check('an older version does not gain a category added later', !permits(1, 'reports', table));
  check('a newer phone gets the highest known version and no more', permits(9, 'reports', table) && !permits(9, 'usage-records', table));
  check('a version below every known one covers nothing', !permits(1, 'request-material', { 2: new Set(['request-material']) }));
  check('the live table starts at version 1', Object.keys(PRACTICES).includes('1'));
}

async function testConsentBackstop(): Promise<void> {
  section('Consent practices — consent none is refused on AI routes before any model work; report needs no grant');

  const noGrant = { 'x-whim-device': DEVICE_ID, ...ENVELOPE, [CONSENT_HEADER]: 'none' };
  for (const route of ['/v1/clarify', '/v1/rewrite', '/v1/generate']) {
    const { app, model, usageStore } = forbiddenModelApp();
    const res = await send(app, route, noGrant, { prompt: 'a timer' });
    eq(`${route}: consent none → 403`, res.status, 403);
    eq(`${route}: refused consent_required`, await refusalCode(res), 'consent_required');
    eq(`${route}: no model was called (classifier included)`, model.calls, 0);
    eq(`${route}: no ledger row was admitted`, usageStore.admitted, []);
  }

  const reportStore = new InMemoryReportStore();
  const reportRes = await send(testApp({ reportStore }), '/v1/report', noGrant, { reason: 'broken' });
  eq('report with consent none is accepted', reportRes.status, 202);

  const newer = await send(testApp({ stub: true }), '/v1/clarify', { 'x-whim-device': DEVICE_ID, ...ENVELOPE, [CONSENT_HEADER]: '7' }, { prompt: 'a timer' });
  eq('a consent version above the highest known is served', newer.status, 200);
}

/** A route file that calls a model or stores data, but declares no consent practice. Comments are
 *  stripped first, so prose naming a type cannot trip or satisfy it. */
const CALLS_A_MODEL = /\b(ModelClient|Pipeline|ContentPolicy)\b/;
const STORES_DATA = /\b\w*Store\.(?!read\b)\w+\(/;
const DECLARES_A_PRACTICE = /\bconsentPractice\(/;

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function undeclaredPracticeRoutes(files: ReadonlyArray<{ name: string; text: string }>): string[] {
  return files
    .filter(({ text }) => {
      const code = withoutComments(text);
      return (CALLS_A_MODEL.test(code) || STORES_DATA.test(code)) && !DECLARES_A_PRACTICE.test(code);
    })
    .map(({ name }) => name);
}

function routeFiles(): Array<{ name: string; text: string }> {
  return fs
    .readdirSync(ROUTES_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, text: fs.readFileSync(path.join(ROUTES_DIR, name), 'utf8') }));
}

function testEveryDataRouteDeclaresAPractice(): void {
  section('Consent practices — every route that calls a model or stores data declares its category');

  const files = routeFiles();
  check('the scan reaches the routes that call a model', ['clarify.ts', 'generate.ts', 'rewrite.ts'].every((n) => files.some((f) => f.name === n)));
  eq('every real route that calls a model or stores data declares a practice', undeclaredPracticeRoutes(files), []);

  const planted = `import type { ModelClient } from '../generation/model';
// consentPractice( — a comment naming it does not count
export function makeSummaryRoute(model: ModelClient) {
  return model.stream({ model: 'm', messages: [], reasoning: 'off', role: 'rewrite' });
}`;
  eq('a planted route that calls a model without a practice fails, named', undeclaredPracticeRoutes([...files, { name: 'planted.ts', text: planted }]), ['planted.ts']);
  const storing = `export function makeNoteRoute(noteStore: { insert(v: string): void }) { noteStore.insert('x'); }`;
  eq('a planted route that stores data without a practice fails, named', undeclaredPracticeRoutes([{ name: 'notes.ts', text: storing }]), ['notes.ts']);
  const declared = `${planted}\nconst gate = consentPractice('request-material', 'required');`;
  eq('the same route declaring its practice passes', undeclaredPracticeRoutes([{ name: 'planted.ts', text: declared }]), []);
}

// ─── The traffic generators send a real envelope ─────────────────────────────

async function testDriversSendAnEnvelope(): Promise<void> {
  section("Envelope — the load-test driver's traffic reads like the app's in the request log");

  const release = parseNativeReleaseConfig(fs.readFileSync(path.join(process.cwd(), 'release/whim-release.xcconfig'), 'utf8'));
  eq("the drivers claim the release config's marketing version", BENCH_APP_VERSION, release.WHIM_MARKETING_VERSION);

  const app = testApp();
  const server = http.createServer(getRequestListener((request) => app.fetch(request)));
  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
  const capture = captureLogs();
  try {
    const outcome = await within(runDevice({ baseUrl: `http://127.0.0.1:${port}`, prompt: 'a load test timer', timeoutMs: 5000 }));
    check('the driven generation ended in its result', outcome !== TIMED_OUT && outcome.terminal === 'result', JSON.stringify(outcome));
  } finally {
    capture.stop();
    server.closeAllConnections();
    await within(new Promise<void>((resolve) => server.close(() => resolve())));
  }
  const [line] = requestLines(capture, '/v1/generate');
  check('its request line names a real platform, not the legacy one', line?.platform === 'android' || line?.platform === 'ios', String(line?.platform));
  check('its request line carries a positive build number', typeof line?.build === 'number' && line.build > 0, String(line?.build));
  eq('its request line carries the release version and a granted consent', [line?.appVersion, line?.consent], [release.WHIM_MARKETING_VERSION, 1]);
}

export async function runRequestEdgeTests(): Promise<void> {
  await testRequestIdOnEveryResponse();
  await testFailedGenerationJoinsUp();
  await testProviderAndPolicyLinesCarryRequestId();
  await testEnvelopeOnTheRequestLine();
  await testEnvelopeRefusals();
  await testOldBuildTurnedAway();
  await testEveryV1RouteGated();
  await testLegacyAndDefaults();
  await testHealthzReportsMinimums();
  testPermits();
  await testConsentBackstop();
  testEveryDataRouteDeclaresAPractice();
  await testDriversSendAnEnvelope();
}
