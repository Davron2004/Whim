/**
 * Unary routes (clarify, rewrite) and report route acceptance (public-generation-server chain-9).
 * Scaffolded here by chain-1 (task 2.5, pre-registered in acceptance.ts); chain-9 fills it in —
 * this module is chain-9's alone to edit.
 *
 * Covers `createApp`'s admission wiring on `/v1/clarify`, `/v1/rewrite` and `/v1/report`
 * (specs/server-admission-control "Admission checks run in a fixed order", specs/content-policy,
 * specs/content-reports) and the anonymous `/healthz/sse` probe (specs/server-deployment).
 */
import { check, eq, section } from './harness';
import { captureLogs, withMessage } from './log-capture';
import { createApp } from '../src/app';
import { createStubPipeline } from '../src/pipeline';
import { InMemoryUsageStore } from '../src/usage-store';
import { InMemoryReportStore } from '../src/reports/store';
import { loadServerConfig, type ServerConfig } from '../src/config';
import { createSlotController, type SlotController } from '../src/admission/slots';
import { invalidateCreditCache, type CreditLookupResponse, type CreditTransport } from '../src/admission/credit';
import { cachedPolicy, ModelContentPolicy, StubContentPolicy, type ContentPolicy } from '../src/policy';
import type { ModelClient, ModelDelta, ModelRoster, ModelStream } from '../src/generation/model';
import { ScriptedModelClient } from './scripted-model';
import { ApiError, ServiceRefusalCode } from '@whim/contract';

const DEVICE_ID = '99999999-9999-4999-8999-999999999999';
const DEVICE_HEADER = { 'x-whim-device': DEVICE_ID };
const OTHER_DEVICE_HEADER = { 'x-whim-device': '88888888-8888-4888-8888-888888888888' };
const ROSTER: ModelRoster = { rewrite: 'vendor/rewrite-1', engineer: 'vendor/engineer-1' };
const FIXED_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return { ...loadServerConfig({}), now: () => FIXED_NOW, ...overrides };
}

interface TestAppOpts {
  config?: Partial<ServerConfig>;
  model?: ModelClient;
  policy?: ContentPolicy;
  creditTransport?: CreditTransport;
  slots?: SlotController;
  reportStore?: InMemoryReportStore;
  stub?: boolean;
}

function testApp(opts: TestAppOpts = {}) {
  const usageStore = new InMemoryUsageStore();
  const reportStore = opts.reportStore ?? new InMemoryReportStore();
  const config = makeConfig(opts.config);
  const app = createApp({
    pipeline: createStubPipeline(0),
    usageStore,
    model: opts.model,
    roster: opts.model ? ROSTER : undefined,
    config,
    slots: opts.slots,
    policy: opts.policy,
    creditTransport: opts.creditTransport,
    reportStore,
    stub: opts.stub,
  });
  return { app, usageStore, reportStore, config };
}

async function post(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** A `CreditTransport` returning a fixed `limit_remaining`, counting how many times the key
 *  endpoint was actually queried — the way to distinguish "served from cache" from "invalidated,
 *  looked up again" (design D6a/D6b), since the admitted/refused outcome alone cannot. */
function countingCreditTransport(limitRemaining: number | null): { transport: CreditTransport; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    transport: {
      async lookupKey(): Promise<CreditLookupResponse> {
        calls++;
        return { status: 200, bodyText: JSON.stringify({ data: { limit_remaining: limitRemaining } }) };
      },
    },
  };
}

/** The structural shape `isProviderBudgetExhausted` (`../src/routes/clarify.ts`) detects — a
 *  `status: 402` error, matching chain-8's forthcoming `OpenRouterCreditError` (not yet mergeable
 *  into this worktree; see the chain-9 report's NOTES FOR DISPATCHER). */
class FakeProviderCreditError extends Error {
  readonly status = 402;
}

/** A hand-rolled `AsyncIterable` (not a generator function) whose one `next()` call rejects with
 *  `err` — mirrors `../openrouter.ts`'s real shape (the deltas iterator itself throws) without a
 *  generator that never yields. */
function rejectingDeltas(err: Error): AsyncIterable<ModelDelta> {
  return {
    [Symbol.asyncIterator]: () => ({ next: (): Promise<IteratorResult<ModelDelta>> => Promise.reject(err) }),
  };
}

/** A `ModelClient` whose stream throws the provider's own `402` (operator credit exhausted
 *  mid-call). */
function budgetExhaustedModelClient(): ModelClient {
  return {
    stream(): ModelStream {
      const err = new FakeProviderCreditError('insufficient credit');
      return { deltas: rejectingDeltas(err), usage: Promise.reject(err), id: Promise.resolve(undefined) };
    },
  };
}

/** Rejects once `signal` aborts, flagging `observed.aborted` first — the abort-observing half of
 *  `stallingDeltas` below, split out to keep that function's nesting shallow. */
function abortRejection(signal: AbortSignal | undefined, observed: { aborted: boolean }): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      observed.aborted = true;
      reject(new Error('stalling model client observed abort'));
    });
  });
}

/** A hand-rolled `AsyncIterable` whose one `next()` call hangs until `signal` aborts. */
function stallingDeltas(signal: AbortSignal | undefined, observed: { aborted: boolean }): AsyncIterable<ModelDelta> {
  return {
    [Symbol.asyncIterator]: () => ({ next: (): Promise<IteratorResult<ModelDelta>> => abortRejection(signal, observed) }),
  };
}

/** A `ModelClient` whose stream hangs until its signal aborts, recording whether it did — the
 *  double for "a stalled unary call times out" (specs/server-admission-control "Unary model calls
 *  have a bounded lifetime"). `ScriptedModelClient` ignores its `signal` argument entirely, so a
 *  scenario that needs the abort to be OBSERVED needs this instead. */
function stallingModelClient(observed: { aborted: boolean }): ModelClient {
  return {
    stream(_req, signal): ModelStream {
      return { deltas: stallingDeltas(signal, observed), usage: new Promise<never>(() => {}), id: Promise.resolve(undefined) };
    },
  };
}

async function testAdmissionOrder(): Promise<void> {
  section('Admission order (specs/server-admission-control "Admission checks run in a fixed order")');

  // Credit exhausted wins over drain — both violated at once.
  {
    invalidateCreditCache();
    const slots = createSlotController({ maxConcurrentGenerations: 1, maxConcurrentUnary: 1 });
    slots.startDraining();
    const credit = countingCreditTransport(0.1);
    const { app } = testApp({ slots, creditTransport: credit.transport, config: { minCreditUsd: 0.5 } });
    const res = await post(app, '/v1/clarify', { prompt: 'hi' }, DEVICE_HEADER);
    eq('credit-exhausted + draining → budget_exhausted, not server_busy', res.status, 503);
    const body = (await res.json()) as ApiError;
    eq('refusal code is budget_exhausted', body.error, 'budget_exhausted');
  }

  // Credit exhausted wins over the daily limit — both violated at once.
  {
    invalidateCreditCache();
    const credit = countingCreditTransport(0.1);
    const { app } = testApp({
      creditTransport: credit.transport,
      config: { minCreditUsd: 0.5, limitClarifyPerDeviceDay: 0 },
    });
    const res = await post(app, '/v1/clarify', { prompt: 'hi' }, DEVICE_HEADER);
    eq('credit-exhausted + daily-limit-exhausted → budget_exhausted, not daily_limit', res.status, 503);
  }

  // Draining wins over the daily limit — the slot acquire (drain check) runs before daily units.
  {
    invalidateCreditCache();
    const slots = createSlotController({ maxConcurrentGenerations: 1, maxConcurrentUnary: 1 });
    slots.startDraining();
    const { app } = testApp({ slots, config: { limitClarifyPerDeviceDay: 0 } });
    const res = await post(app, '/v1/clarify', { prompt: 'hi' }, DEVICE_HEADER);
    eq('draining + daily-limit-exhausted → server_busy, not daily_limit', res.status, 429);
    const body = (await res.json()) as ApiError;
    eq('refusal code is server_busy', body.error, 'server_busy');
    check('a draining refusal carries no Retry-After', res.headers.get('retry-after') === null);
  }

  // Global unary capacity wins over the daily limit — the slot acquire (capacity check) runs
  // before daily units.
  {
    invalidateCreditCache();
    const slots = createSlotController({ maxConcurrentGenerations: 1, maxConcurrentUnary: 1 });
    const held = slots.acquire('unary', 'someone-else');
    check('setup: the one unary slot is held', held.ok);
    const { app } = testApp({ slots, config: { limitClarifyPerDeviceDay: 0 } });
    const res = await post(app, '/v1/clarify', { prompt: 'hi' }, DEVICE_HEADER);
    eq('at-capacity + daily-limit-exhausted → server_busy, not daily_limit', res.status, 429);
    if (held.ok) held.handle.release();
  }

  // Daily limit wins over a content-policy refusal — admission's daily-unit step runs before the
  // policy check.
  {
    invalidateCreditCache();
    const policy = cachedPolicy(new StubContentPolicy());
    const { app } = testApp({ policy, config: { limitClarifyPerDeviceDay: 0 }, stub: true });
    const res = await post(app, '/v1/clarify', { prompt: '[[refuse]] please' }, DEVICE_HEADER);
    eq('daily-limit-exhausted + policy-refused → daily_limit, not content_policy', res.status, 429);
    const body = (await res.json()) as ApiError;
    eq('refusal code is daily_limit', body.error, 'daily_limit');
    check('a daily-limit refusal carries Retry-After', res.headers.get('retry-after') !== null);
  }

  // No model call precedes ANY admission refusal — a scripted client with zero turns proves it:
  // a stray call would throw ScriptedModelClientExhaustedError instead of answering the refusal.
  {
    invalidateCreditCache();
    const model = new ScriptedModelClient(ROSTER, []);
    const slots = createSlotController({ maxConcurrentGenerations: 1, maxConcurrentUnary: 1 });
    slots.startDraining();
    const { app } = testApp({ model, slots });
    const res = await post(app, '/v1/clarify', { prompt: 'hi' }, DEVICE_HEADER);
    eq('a draining refusal makes no model call', res.status, 429);
    eq('zero model calls recorded', model.requests.length, 0);
  }
  {
    invalidateCreditCache();
    const model = new ScriptedModelClient(ROSTER, []);
    const credit = countingCreditTransport(0.1);
    const { app } = testApp({ model, creditTransport: credit.transport, config: { minCreditUsd: 0.5 } });
    const res = await post(app, '/v1/rewrite', { prompt: 'hi' }, DEVICE_HEADER);
    eq('a budget_exhausted refusal makes no model call', res.status, 503);
    eq('zero model calls recorded', model.requests.length, 0);
  }
}

async function testChunkedBodyCap(): Promise<void> {
  section('Raw body cap on a chunked body without Content-Length');

  invalidateCreditCache();
  const { app, config } = testApp();
  const totalBytes = config.maxBodyBytesUnary + 10_000;
  const chunk = new TextEncoder().encode('a'.repeat(1024));
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const remaining = totalBytes - sent;
      const piece = remaining >= chunk.length ? chunk : chunk.slice(0, remaining);
      controller.enqueue(piece);
      sent += piece.length;
    },
  });

  const req = new Request('http://localhost/v1/clarify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...DEVICE_HEADER },
    body,
    duplex: 'half',
  } as RequestInit);
  check('setup: no Content-Length header was set', req.headers.get('content-length') === null);
  const res = await app.fetch(req);
  eq('an oversized chunked body → 413', res.status, 413);
  const parsed = (await res.json()) as ApiError;
  eq('refusal code is payload_too_large', parsed.error, 'payload_too_large');
}

async function testStalledRewriteTimesOut(): Promise<void> {
  section('specs/server-admission-control "Unary model calls have a bounded lifetime"');

  invalidateCreditCache();
  const observed = { aborted: false };
  const model = stallingModelClient(observed);
  const slots = createSlotController({ maxConcurrentGenerations: 1, maxConcurrentUnary: 1 });
  const { app } = testApp({ model, slots, config: { unaryModelTimeoutMs: 40 } });

  const started = Date.now();
  const res = await post(app, '/v1/rewrite', { prompt: 'hi' }, DEVICE_HEADER);
  const elapsedMs = Date.now() - started;
  eq('a stalled rewrite times out honestly → 502', res.status, 502);
  const body = (await res.json()) as ApiError;
  check('the failure body has a non-empty hint', body.hint.length > 0);
  check('the transport observed the abort', observed.aborted);
  check('the global unary in-flight count is back to its prior value', slots.counts().unary === 0);
  check('the timeout bounded the response (well under 2s)', elapsedMs < 2000, `took ${elapsedMs}ms`);
}

async function testRefusedRewriteMakesOnlyTheClassifierCall(): Promise<void> {
  section('specs/content-policy "A refused rewrite makes no rewrite call"');

  invalidateCreditCache();
  const model = new ScriptedModelClient(ROSTER, [
    { role: 'rewrite', deltas: ['{"verdict":"refuse","category":"test"}'] },
  ]);
  const policy = cachedPolicy(
    new ModelContentPolicy({ modelClient: model, rewriteModelId: ROSTER.rewrite, categories: 'test category', timeoutMs: 5000 }),
  );
  const { app } = testApp({ model, policy });
  const res = await post(app, '/v1/rewrite', { prompt: 'something bad' }, DEVICE_HEADER);
  eq('a policy-refused rewrite → 422', res.status, 422);
  const body = (await res.json()) as ApiError;
  eq('refusal code is content_policy', body.error, 'content_policy');
  eq('exactly one model call recorded (the classifier)', model.requests.length, 1);
}

async function testBudgetExhaustedMidCall(): Promise<void> {
  section('design D6b "A 402 mid-flight ends the request and invalidates the cache"');

  // Clarify.
  {
    invalidateCreditCache();
    const credit = countingCreditTransport(10);
    const model = budgetExhaustedModelClient();
    const { app } = testApp({ model, creditTransport: credit.transport });

    const res1 = await post(app, '/v1/clarify', { prompt: 'hi' }, DEVICE_HEADER);
    eq('a mid-call 402 on clarify → 503 budget_exhausted', res1.status, 503);
    const body1 = (await res1.json()) as ApiError;
    eq('refusal code is budget_exhausted', body1.error, 'budget_exhausted');
    eq('setup: exactly one credit lookup so far', credit.calls(), 1);

    // A second request, same TTL window, healthy model this time — the cache must have been
    // invalidated by the 402 above, so the credit endpoint is queried again (the admitted/refused
    // outcome alone would look identical either way, since 10 is above the floor regardless).
    const healthyModel = new ScriptedModelClient(ROSTER, [{ role: 'rewrite', deltas: ['{"questions":[]}'] }]);
    const { app: app2 } = testApp({ model: healthyModel, creditTransport: credit.transport });
    const res2 = await post(app2, '/v1/clarify', { prompt: 'hi' }, OTHER_DEVICE_HEADER);
    eq('a follow-up clarify after the 402 succeeds', res2.status, 200);
    eq('the credit cache was invalidated: a second lookup happened', credit.calls(), 2);
  }

  // Rewrite.
  {
    invalidateCreditCache();
    const credit = countingCreditTransport(10);
    const model = budgetExhaustedModelClient();
    const { app } = testApp({ model, creditTransport: credit.transport });

    const res1 = await post(app, '/v1/rewrite', { prompt: 'hi' }, DEVICE_HEADER);
    eq('a mid-call 402 on rewrite → 503 budget_exhausted', res1.status, 503);
    const body1 = (await res1.json()) as ApiError;
    eq('refusal code is budget_exhausted', body1.error, 'budget_exhausted');

    const healthyModel = new ScriptedModelClient(ROSTER, [
      {
        role: 'rewrite',
        deltas: [JSON.stringify({ rewrittenPrompt: 'a detailed prompt', plan: [{ label: 'What it is', text: 'A detailed one.' }] })],
      },
    ]);
    const { app: app2 } = testApp({ model: healthyModel, creditTransport: credit.transport });
    const res2 = await post(app2, '/v1/rewrite', { prompt: 'hi' }, OTHER_DEVICE_HEADER);
    eq('a follow-up rewrite after the 402 succeeds', res2.status, 200);
    eq('the credit cache was invalidated: a second lookup happened', credit.calls(), 2);
  }
}

async function testReportRoute(): Promise<void> {
  section('POST /v1/report (specs/content-reports)');

  // A full report is accepted.
  {
    const { app, reportStore } = testApp();
    const res = await post(
      app,
      '/v1/report',
      { reason: 'offensive', note: 'rude jokes', appName: 'Joke Box', prompt: 'a prompt', source: 'a source' },
      DEVICE_HEADER,
    );
    eq('a full report → 202', res.status, 202);
    const body = (await res.json()) as { reportId: string };
    check('the response carries a reportId', typeof body.reportId === 'string' && body.reportId.length > 0);
    const row = await reportStore.get(body.reportId);
    check('the row exists', row !== undefined);
    eq('the row holds exactly what was sent', row?.note, 'rude jokes');
  }

  // A minimal report is accepted.
  {
    const { app } = testApp();
    const res = await post(app, '/v1/report', { reason: 'broken' }, DEVICE_HEADER);
    eq('a minimal report → 202', res.status, 202);
  }

  // An over-long note is a shape error.
  {
    const { app, reportStore } = testApp();
    const res = await post(app, '/v1/report', { reason: 'other', note: 'x'.repeat(1001) }, DEVICE_HEADER);
    eq('an over-long note → 400', res.status, 400);
    const body = (await res.json()) as ApiError;
    check('the body is an ApiError', typeof body.error === 'string' && body.hint.length > 0);
    eq('nothing is stored', (await reportStore.list({ now: FIXED_NOW })).length, 0);
  }

  // An oversized source is refused whole.
  {
    const { app, reportStore } = testApp();
    const res = await post(app, '/v1/report', { reason: 'other', source: 'x'.repeat(300 * 1024) }, DEVICE_HEADER);
    eq('an oversized source → 413', res.status, 413);
    const body = (await res.json()) as ApiError;
    eq('refusal code is payload_too_large', body.error, 'payload_too_large');
    eq('no report row exists', (await reportStore.list({ now: FIXED_NOW })).length, 0);
  }

  // An oversized prompt is refused whole.
  {
    const { app } = testApp();
    const res = await post(app, '/v1/report', { reason: 'other', prompt: 'x'.repeat(20 * 1024) }, DEVICE_HEADER);
    eq('an oversized prompt → 413', res.status, 413);
  }

  // Per-device daily limit, with Retry-After.
  {
    const { app } = testApp({ config: { limitReportsPerDeviceDay: 0 } });
    const res = await post(app, '/v1/report', { reason: 'other' }, DEVICE_HEADER);
    eq('a device over its daily report limit → 429 daily_limit', res.status, 429);
    const body = (await res.json()) as ApiError;
    eq('refusal code is daily_limit', body.error, 'daily_limit');
    check('carries Retry-After', res.headers.get('retry-after') !== null);
  }

  // Global daily ceiling, with Retry-After.
  {
    const { app } = testApp({ config: { limitReportsPerDay: 0, limitReportsPerDeviceDay: 100 } });
    const res = await post(app, '/v1/report', { reason: 'other' }, DEVICE_HEADER);
    eq('the global report ceiling → 429 server_busy', res.status, 429);
    const body = (await res.json()) as ApiError;
    eq('refusal code is server_busy', body.error, 'server_busy');
    check('carries Retry-After', res.headers.get('retry-after') !== null);
  }

  // Draining refuses reports too, with no Retry-After.
  {
    const slots = createSlotController({ maxConcurrentGenerations: 1, maxConcurrentUnary: 1 });
    slots.startDraining();
    const { app } = testApp({ slots });
    const res = await post(app, '/v1/report', { reason: 'other' }, DEVICE_HEADER);
    eq('a draining report → 429 server_busy', res.status, 429);
    check('no Retry-After while draining', res.headers.get('retry-after') === null);
  }

  // Gating: no device header.
  {
    const { app } = testApp();
    const res = await post(app, '/v1/report', { reason: 'other' });
    eq('a report with no device header → 400', res.status, 400);
    const body = (await res.json()) as { error?: string };
    eq('error code is missing_device_id', body.error, 'missing_device_id');
  }

  // Report handling logs no content.
  {
    const { app } = testApp();
    const capture = captureLogs();
    let reportId: string;
    try {
      const res = await post(
        app,
        '/v1/report',
        { reason: 'offensive', note: 'MARKER-NOTE', appName: 'MARKER-APP', prompt: 'MARKER-PROMPT', source: 'MARKER-SOURCE' },
        DEVICE_HEADER,
      );
      ({ reportId } = (await res.json()) as { reportId: string });
    } finally {
      capture.stop();
    }
    const accepted = withMessage(capture, 'report accepted');
    eq('exactly one "report accepted" record', accepted.length, 1);
    eq('the record carries the reportId', accepted[0]?.reportId, reportId!);
    eq('the record carries the reason', accepted[0]?.reason, 'offensive');
    check('the record carries promptBytes and sourceBytes', typeof accepted[0]?.promptBytes === 'number' && typeof accepted[0]?.sourceBytes === 'number');
    check('no marker text anywhere in the log output', !capture.raw.some((l) => l.includes('MARKER-')));
    check('no device id anywhere in the log output', !capture.raw.some((l) => l.includes(DEVICE_ID)));
  }

  // Every refusal code validates against the closed vocabulary.
  {
    const { app } = testApp({ config: { limitReportsPerDeviceDay: 0 } });
    const res = await post(app, '/v1/report', { reason: 'other' }, DEVICE_HEADER);
    const body = (await res.json()) as ApiError;
    eq('the refusal code validates as ServiceRefusalCode', ServiceRefusalCode.safeParse(body.error).success, true);
  }
}

async function testHealthzSse(): Promise<void> {
  section('GET /healthz/sse (specs/server-deployment "An anonymous stream probe verifies proxy flushing")');

  // Three frames, roughly one second apart, then close — no device header needed.
  {
    const { app } = testApp();
    const started = Date.now();
    const res = await app.request('/healthz/sse');
    eq('the probe answers 200', res.status, 200);
    const ct = res.headers.get('content-type') ?? '';
    check('the probe is an SSE stream', ct.includes('text/event-stream'));

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let frameCount = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      frameCount = (buffered.match(/\n\n/g) ?? []).length;
    }
    const elapsedMs = Date.now() - started;
    eq('exactly three frames', frameCount, 3);
    check('the frames were spaced roughly one second apart (~2s total)', elapsedMs >= 1800 && elapsedMs < 6000, `took ${elapsedMs}ms`);
  }

  // Concurrent probes count against the global unary cap.
  {
    const slots = createSlotController({ maxConcurrentGenerations: 1, maxConcurrentUnary: 1 });
    const { app } = testApp({ slots });
    const first = await app.request('/healthz/sse');
    eq('the first probe is admitted', first.status, 200);
    const second = await app.request('/healthz/sse');
    eq('a second concurrent probe is refused at the unary cap', second.status, 429);
    const body = (await second.json()) as ApiError;
    eq('refusal code is server_busy', body.error, 'server_busy');

    await first.body!.cancel();
    eq('cancelling the first probe frees its slot', slots.counts().unary, 0);
  }
}

export async function runRoutesUnaryTests(): Promise<void> {
  await testAdmissionOrder();
  await testChunkedBodyCap();
  await testStalledRewriteTimesOut();
  await testRefusedRewriteMakesOnlyTheClassifierCall();
  await testBudgetExhaustedMidCall();
  await testReportRoute();
  await testHealthzSse();
}
