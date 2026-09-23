/**
 * Server-core tests.
 * Driven by Hono's in-process app.request() and the test-side sse-reader.
 */
import * as vm from 'node:vm';
import { check, eq, section } from './harness';
import { readSseResponse } from './sse-reader';
import { captureLogs, withMessage } from './log-capture';
import { createApp } from '../src/app';
import { createStubPipeline, type Pipeline } from '../src/pipeline';
import { InMemoryUsageStore } from '../src/usage-store';
import { buildSseStream } from '../src/sse';
import { createSlotController } from '../src/admission/slots';
import { ScriptedModelClient } from './scripted-model';
import { TIMED_OUT, waitFor, within } from './route-doubles';
import { defaultModelRoster, type ModelRoster } from '../src/generation/model';
import type { RunTrace } from '../src/generation/machine';
import { ResolveTracker, type UsageAndCostTransport } from '../src/usage/resolve';
import type { GenerateRequest, GenerationEvent, Usage, WireAppRecord } from '@whim/contract';

// Rewrite is now real-model-backed (task 7.2) — a scripted client stands in for OpenRouter so
// §5.5's "same input → same output" assertion stays meaningful: two freshly-scripted apps, each
// given the same rewrite turns, must surface the same (non-echoed) response.
//
// The route re-asks once when a reply has no `plan` (a prose reply parses with `rewrittenPrompt`
// set but no structured rows), so a prose-only fixture must script TWO identical turns — the
// second is the one the route actually keeps.
const REWRITE_TEST_ROSTER: ModelRoster = defaultModelRoster('vendor/rewrite-test', 'vendor/engineer-test');
function scriptedRewriteApp() {
  const model = new ScriptedModelClient(REWRITE_TEST_ROSTER, [
    { role: 'rewrite', deltas: ['Build a todo list app with add, complete, and delete actions.'] },
    { role: 'rewrite', deltas: ['Build a todo list app with add, complete, and delete actions.'] },
  ]);
  return createApp({
    pipeline: createStubPipeline(0),
    usageStore: new InMemoryUsageStore(),
    model,
    roster: REWRITE_TEST_ROSTER,
  });
}

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_HEADER = { 'x-whim-device': DEVICE_ID };

/** Build a test app with 0 delay and no keepalive (fast + deterministic). */
function testApp() {
  return createApp({
    pipeline: createStubPipeline(0),
    usageStore: new InMemoryUsageStore(),
  });
}

/** Post JSON to an app.request() and return the Response. */
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

async function testDeviceIdentity(): Promise<void> {
  section('Device-identity middleware (SPEC §3)');

  // §3.3 — /healthz is exempt (no device header needed) and identifies the service
  {
    const app = testApp();
    const res = await app.request('/healthz');
    eq('/healthz anonymous (no x-whim-device) 200', res.status, 200);
    const body = (await res.json()) as { ok?: unknown; service?: unknown };
    eq('/healthz body ok field', body.ok, true);
    eq('/healthz body service field', body.service, 'whim-server');
  }


}

async function testSseFraming(): Promise<void> {
  section('SSE framing (SPEC §4)');

  // §4.1/4.2/4.4 — frame shape, monotonic ids, exactly one terminal last
  {
    const app = testApp();
    const res = await post(app, '/v1/generate', { prompt: 'hello' }, DEVICE_HEADER);
    eq('happy path generate → 200', res.status, 200);
    const ct = res.headers.get('content-type') ?? '';
    check('happy path content-type is event-stream', ct.includes('text/event-stream'));

    const { events, skippedFrames } = await readSseResponse(res);
    check('events is non-empty', events.length > 0);
    eq('happy path generate → 0 skipped frames', skippedFrames, 0);

    // §4.2 — strictly increasing ids
    let lastId = 0;
    let idsStrictlyIncreasing = true;
    for (const ev of events) {
      if (ev.id <= lastId) {
        idsStrictlyIncreasing = false;
        break;
      }
      lastId = ev.id;
    }
    check('SSE ids strictly increasing', idsStrictlyIncreasing);

    // §4.4 — exactly one terminal, always last
    const terminals = events.filter(
      (e) => e.data.type === 'result' || e.data.type === 'failure',
    );
    eq('exactly one terminal event', terminals.length, 1);
    const lastEvent = events.at(-1);
    check(
      'terminal event is last',
      lastEvent !== undefined &&
        (lastEvent.data.type === 'result' || lastEvent.data.type === 'failure'),
    );

    // §4.1 — event: field equals the data.type
    check(
      'all event: fields match their data.type',
      events.every((e) => e.event === e.data.type),
    );
  }

  // §4.3 — keepalive off → 0 keepalives
  {
    const app = createApp({
      pipeline: createStubPipeline(0),
      usageStore: new InMemoryUsageStore(),
      keepaliveMs: 0,
    });
    const res = await post(app, '/v1/generate', { prompt: 'hello' }, DEVICE_HEADER);
    const { keepaliveCount, skippedFrames } = await readSseResponse(res);
    eq('keepalive off → 0 keepalives', keepaliveCount, 0);
    eq('keepalive off → 0 skipped frames', skippedFrames, 0);
  }

  // §4.3 — keepalive on against a source that yields once and then holds → ≥1 keepalive
  {
    let releaseHold: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const holdingPipeline: Pipeline = {
      async *run(_request, signal) {
        yield { type: 'stage', stage: 'plan', status: 'start' };
        await hold;
        if (signal?.aborted) return;
        yield { type: 'usage', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
        yield { type: 'result', app: RACE_APP };
      },
    };
    const app = createApp({
      pipeline: holdingPipeline,
      usageStore: new InMemoryUsageStore(),
      keepaliveMs: 5,
    });
    const res = await post(app, '/v1/generate', { prompt: 'hello' }, DEVICE_HEADER);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const buffered = await within(readUntil(reader, decoder, (b) => b.includes(': keepalive')));
    check(
      'keepalive on → ≥1 keepalive while the source holds',
      buffered !== TIMED_OUT && buffered.includes(': keepalive'),
    );
    releaseHold();
    await reader.cancel();
  }

}

async function testStubPipelineEndpoints(): Promise<void> {
  section('Stub pipeline + endpoints (SPEC §5)');

  // §5.5 — a re-prompt's app context validates and reaches the model turn unchanged: the route
  // adds nothing and drops nothing (spec "A rewrite for an edit carries the app it is changing").
  // Two identical turns: a prose reply has no `plan`, which the route re-asks for once.
  {
    const model = new ScriptedModelClient(REWRITE_TEST_ROSTER, [
      { role: 'rewrite', deltas: ['Track habits and show a streak count.'] },
      { role: 'rewrite', deltas: ['Track habits and show a streak count.'] },
    ]);
    const app = createApp({
      pipeline: createStubPipeline(0),
      usageStore: new InMemoryUsageStore(),
      model,
      roster: REWRITE_TEST_ROSTER,
    });
    const res = await post(
      app,
      '/v1/rewrite',
      {
        prompt: 'add a streak count',
        app: { name: 'Habit Tracker', collections: [{ name: 'Completions', fields: ['Date'] }] },
      },
      DEVICE_HEADER,
    );
    eq('rewrite with an app context → 200', res.status, 200);
    const sent = model.requests[0]?.request.messages.map((m) => m.content).join('\n') ?? '';
    check('rewrite app context reaches the model turn (name)', sent.includes('Habit Tracker'));
    check('rewrite app context reaches the model turn (collection)', sent.includes('Completions'));
    check('rewrite app context reaches the model turn (field)', sent.includes('Date'));
  }

  // §5.5 — invalid rewrite body → 400
  {
    const app = scriptedRewriteApp();
    const res = await post(app, '/v1/rewrite', { notPrompt: 'oops' }, DEVICE_HEADER);
    eq('invalid rewrite body → 400', res.status, 400);
    const ct = res.headers.get('content-type') ?? '';
    check('invalid rewrite body → JSON', ct.includes('application/json'));
  }

  // §5.5 — rewrite unconfigured (no model/roster) → 502 ApiError, never a canned fallback
  {
    const app = testApp();
    const res = await post(app, '/v1/rewrite', { prompt: 'make a todo app' }, DEVICE_HEADER);
    eq('rewrite unconfigured → 502', res.status, 502);
    const body = (await res.json()) as { error: string; hint: string };
    check('rewrite unconfigured error has non-empty hint', body.hint.length > 0);
  }

}

async function testSseCancelClearsKeepalive(): Promise<void> {
  section('SSE cancel() clears keepalive interval (F1)');

  // F1 — cancel() on client disconnect must clear the keepalive interval immediately
  {
    const realSetInterval = globalThis.setInterval;
    const realClearInterval = globalThis.clearInterval;

    // stub state
    let intervalCb: (() => void) | null = null;
    let capturedHandle: ReturnType<typeof setInterval> | null = null;

    // Unique object so we can test identity in clearInterval
    const stubHandle = {} as ReturnType<typeof setInterval>;

    (globalThis as unknown as Record<string, unknown>).setInterval = (
      cb: () => void,
      _ms: number,
    ): ReturnType<typeof setInterval> => {
      intervalCb = cb;
      capturedHandle = stubHandle;
      return stubHandle;
    };

    (globalThis as unknown as Record<string, unknown>).clearInterval = (
      handle: ReturnType<typeof setInterval>,
    ): void => {
      if (handle === capturedHandle) intervalCb = null;
    };

    try {
      // Given: a source that never yields (simulates long-running generation).
      // Hand-rolled AsyncIterable (not a generator function) — its `next()` never resolves,
      // so there's no generator body for sonarjs's generator-without-yield rule to police.
      const neverYields: AsyncIterable<GenerationEvent> = {
        [Symbol.asyncIterator]: () => ({
          next: (): Promise<IteratorResult<GenerationEvent>> => new Promise(() => {}),
        }),
      };

      const stream = buildSseStream(neverYields, 50);

      // start() runs synchronously as part of stream construction — the interval should be
      // registered by the time getReader() returns (Node ReadableStream calls start() eagerly).
      // Allow one microtask tick for the async start() preamble to reach setInterval.
      await Promise.resolve();

      // Non-vacuity guard: interval must have been registered before we cancel
      check('non-vacuity: interval registered before cancel', intervalCb !== null);

      // When: client disconnects
      await stream.getReader().cancel();

      // Then: interval cleared within the same tick
      check('interval cleared by cancel', intervalCb === null);

    } finally {
      (globalThis as unknown as Record<string, unknown>).setInterval = realSetInterval;
      (globalThis as unknown as Record<string, unknown>).clearInterval = realClearInterval;
    }
  }
}

const RACE_USAGE: Usage = { promptTokens: 10, completionTokens: 20, totalTokens: 30 };
const RACE_APP: WireAppRecord = {
  name: 'race-app',
  source: "import { Screen, Text } from 'vc-sdk'; export default defineApp({ render: () => <Screen><Text>Hi</Text></Screen> });",
  bundle: '(()=>{ /* race-app bundle */ })();',
  sourceMap: undefined,
  manifest: { capabilities: [] },
  schema: {},
};

/** A transport that resolves the fixed `usage` for exactly one generation id, `null` otherwise —
 *  matches `UsageAndCostTransport`'s "not yet resolved" contract for any other id. */
function makeFixedTransport(generationId: string, usage: Usage): UsageAndCostTransport {
  return {
    fetchStats: async (id: string) => (id === generationId ? { usage, totalCostUsd: 0 } : null),
  };
}

/** Single-attempt, no-delay reconcile bounds — deterministic and fast for tests whose transport
 *  resolves synchronously. */
const FAST_RECONCILE_BOUNDS = { maxAttempts: 1, totalBudgetMs: 2000, retryDelayMs: 0 };

/** Reads response body chunks until `predicate(buffered)` is true (or the stream ends). */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  predicate: (buffered: string) => boolean,
): Promise<string> {
  let buffered = '';
  while (!predicate(buffered)) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
  }
  return buffered;
}

/**
 * server/src/routes/generate.ts — closing the completed-run double-credit race (reviewer finding:
 * `makeGenerateRoute` had zero direct coverage). A run that completes NORMALLY credits usage from
 * its `usage` event before its terminal event is ever observed. If the client
 * disconnects in the gap between those two events — a real disconnect window, not a contrived
 * one — the resolver must not re-credit the same run's tokens.
 */
async function testAbortDoubleCreditRace(): Promise<void> {
  section('Completed-run double-credit race on client disconnect (generate.ts)');

  // A run that completed normally (its `usage` event was credited) but whose client disconnects
  // before the terminal event was ever observed must credit usage exactly once, not twice.
  {
    const generationId = 'race-completed-1';
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let terminalEmitted = false;

    // Mirrors `GenerationMachine.emitCompletion`'s exact envelope: usage, then an abort check,
    // then the terminal — gated under test control so the disconnect can be placed deterministically
    // in that window instead of racing real timers.
    const pipeline: Pipeline = {
      async *run(_request: GenerateRequest, signal?: AbortSignal, trace?: RunTrace) {
        if (signal?.aborted) return;
        trace?.generationIds.push(generationId);
        yield { type: 'usage', usage: RACE_USAGE };
        await gate;
        if (signal?.aborted) return;
        terminalEmitted = true;
        yield { type: 'result', app: RACE_APP };
      },
    };

    const usageStore = new InMemoryUsageStore();
    const transport = makeFixedTransport(generationId, RACE_USAGE);
    const tracker = new ResolveTracker();
    const slots = createSlotController({ maxConcurrentGenerations: 3, maxConcurrentUnary: 3 });
    const app = createApp({
      pipeline,
      usageStore,
      slots,
      resolver: { transport, tracker, bounds: FAST_RECONCILE_BOUNDS },
    });

    const res = await post(app, '/v1/generate', { prompt: 'hello' }, DEVICE_HEADER);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const buffered = await readUntil(reader, decoder, (b) => b.includes('event: usage'));
    check('usage frame observed before disconnect', buffered.includes('event: usage'));

    // The client disconnects here: after usage was credited, before any terminal event.
    await reader.cancel();
    releaseGate();

    // The generation slot is released synchronously at the start of teardown, before the
    // resolver's tracked promise is registered — waiting for it first (as routes-generate.suite.ts
    // does) means the drain below is never racing a teardown that hasn't started yet.
    check('the generation slot frees once teardown runs', await waitFor(() => slots.counts().generations === 0));
    await tracker.drain(FAST_RECONCILE_BOUNDS.totalBudgetMs);

    check('a run that disconnects after usage never emits a terminal event', !terminalEmitted);
    const total = await usageStore.read(DEVICE_ID);
    eq(
      'a run that completed normally, disconnected before its terminal event, credits usage exactly once (not the doubled 20/40/60)',
      total,
      RACE_USAGE,
    );
  }

}

/**
 * Per-request logging — one structured record per request carrying method, path, status and
 * duration as NAMED FIELDS (obs-v1; spec "A request line carries fields"), so "arrived and
 * completed" is distinguishable from "never arrived", without a log call per SSE frame and without
 * leaking bodies/prompts/device ids.
 */
async function testRequestLogging(): Promise<void> {
  section('Per-request logging (spec "A request line carries fields")');

  const capture = captureLogs();
  try {
    // Non-streaming: a plain 200 logs exactly once, on the way out of the middleware chain.
    {
      capture.records.length = 0;
      const app = testApp();
      await app.request('/healthz');
      const matches = withMessage(capture, 'request');
      eq('healthz logs exactly one record', matches.length, 1);
      eq('healthz record scope', matches[0]!.scope, 'request');
      eq('healthz record method field', matches[0]!.method, 'GET');
      eq('healthz record path field', matches[0]!.path, '/healthz');
      eq('healthz record status field', matches[0]!.status, 200);
      check('healthz record carries a duration field', typeof matches[0]!.durationMs === 'number');
    }

    // Non-streaming error path: a validation 400 still logs exactly once with the real status.
    {
      capture.records.length = 0;
      const app = testApp();
      await post(app, '/v1/generate', { notPrompt: 'oops' }, DEVICE_HEADER);
      const matches = withMessage(capture, 'request');
      eq('invalid generate body logs exactly one record', matches.length, 1);
      eq('invalid generate body record status', matches[0]!.status, 400);
    }

    // Streaming: the record must not fire while the SSE body is still open — only once it settles
    // — and even then exactly once (not once per frame). That is what the duration measures.
    {
      capture.records.length = 0;
      capture.raw.length = 0;
      const app = testApp();
      const res = await post(app, '/v1/generate', { prompt: 'hello' }, DEVICE_HEADER);
      eq('no request record before the SSE stream has been drained', withMessage(capture, 'request').length, 0);

      const { events } = await readSseResponse(res);
      check('sanity: the stream actually produced events', events.length > 0);

      const matches = withMessage(capture, 'request');
      eq('generate stream logs exactly one record once settled (not once per frame)', matches.length, 1);
      eq('generate stream record method', matches[0]!.method, 'POST');
      eq('generate stream record path', matches[0]!.path, '/v1/generate');
      eq('generate stream record status', matches[0]!.status, 200);
      check('generate stream record carries a duration field', typeof matches[0]!.durationMs === 'number');

      // Privacy floor: never the prompt text or the device id in an emitted record.
      check(
        'no emitted record contains the prompt text',
        !capture.raw.some((l) => l.includes('hello')),
      );
      check(
        'no emitted record contains the device id',
        !capture.raw.some((l) => l.includes(DEVICE_ID)),
      );
    }
  } finally {
    capture.stop();
  }
}

/**
 * F4 — the stub-delivered bundle must actually DEFINE the app module, not blank-screen. Drives a
 * real `/v1/generate` to completion, then executes the result's `bundle` through `node:vm` with a
 * minimal `window` global mirroring how `src/runtime/web/loader.js` wraps a delivered bundle (a
 * bare `require` resolving the closed {vc-sdk, react, react-dom} allowlist, top-level `var`
 * landing on `window`). RED at BASE: the old stub bundle was `(()=>{ /* stub bundle *\/ })();` —
 * it defines nothing, so `window.__WHIM_APP_MODULE__` stays undefined.
 */
async function testStubBundleDefinesAppModule(): Promise<void> {
  section('Stub-delivered bundle actually defines the app module (F4)');

  const app = testApp();
  const res = await post(app, '/v1/generate', { prompt: 'make a todo app' }, DEVICE_HEADER);
  const { events } = await readSseResponse(res);
  const resultEvent = events.at(-1)!.data;
  if (resultEvent.type !== 'result') {
    check('F4: terminal event is result', false);
    return;
  }

  check('F4: bundle is non-empty', typeof resultEvent.app.bundle === 'string' && resultEvent.app.bundle.length > 0);

  const fakeRequire = (name: string): unknown => {
    if (name === 'vc-sdk') return { Screen: 'Screen', Text: 'Text', defineApp: (spec: unknown) => spec };
    if (name === 'react') return { createElement: () => ({}) };
    if (name === 'react-dom') return {};
    throw new Error(`unexpected require: ${name}`);
  };

  const window: Record<string, unknown> = { require: fakeRequire };
  window.window = window;
  vm.createContext(window);
  // Intentional: executing the server's OWN just-built stub bundle inside an isolated
  // node:vm sandbox context, mirroring how the trusted loader (src/runtime/web/loader.js)
  // executes a delivered bundle — this is the test, not a runtime code-injection path.
  // eslint-disable-next-line sonarjs/code-eval
  vm.runInContext(resultEvent.app.bundle, window);

  check('F4: window.__WHIM_APP_MODULE__ is defined and truthy', Boolean(window.__WHIM_APP_MODULE__));
}

/**
 * F5 — `/v1/rewrite` under WHIM_PIPELINE=stub must pass a `[[fail]]`-marked prompt through raw,
 * with no model call, so the marker survives into the `/v1/generate` request that follows (the
 * plan→rewrite→generate flow otherwise loses it: the pipeline only ever sees the REWRITTEN
 * prompt, and a paraphrasing rewrite model drops the marker before the stub pipeline can see it).
 * RED at BASE: no `stub` option existed, so the scripted model was always called and the
 * marker was lost.
 */
async function testStubRewritePreservesFailMarker(): Promise<void> {
  section('Stub rewrite passes the [[fail]] marker through untouched (F5)');

  const model = new ScriptedModelClient(REWRITE_TEST_ROSTER, [
    { role: 'rewrite', deltas: ['Build a todo list app with add, complete, and delete actions.'] },
  ]);
  const app = createApp({
    pipeline: createStubPipeline(0),
    usageStore: new InMemoryUsageStore(),
    model,
    roster: REWRITE_TEST_ROSTER,
    stub: true,
  });

  const rewriteRes = await post(app, '/v1/rewrite', { prompt: 'do something [[fail]] please' }, DEVICE_HEADER);
  eq('F5: stub rewrite status 200', rewriteRes.status, 200);
  const rewriteBody = (await rewriteRes.json()) as { rewrittenPrompt: string };
  check(
    'F5: rewrittenPrompt still contains the [[fail]] marker',
    rewriteBody.rewrittenPrompt.includes('[[fail]]'),
  );
  eq('F5: stub rewrite makes zero model calls', model.requests.length, 0);

  // The short-circuit is keyed on the marker alone: a re-prompt of an installed app carries an
  // `app` context, and that must not push it onto the model path.
  const editRes = await post(
    app,
    '/v1/rewrite',
    { prompt: 'do something [[fail]] please', app: { name: 'Habit Tracker' } },
    DEVICE_HEADER,
  );
  eq('F5: stub rewrite of an existing app status 200', editRes.status, 200);
  check(
    'F5: an app-carrying stub rewrite still passes the marker through',
    ((await editRes.json()) as { rewrittenPrompt: string }).rewrittenPrompt.includes('[[fail]]'),
  );
  eq('F5: an app-carrying stub rewrite still makes zero model calls', model.requests.length, 0);

  const generateRes = await post(app, '/v1/generate', { prompt: rewriteBody.rewrittenPrompt }, DEVICE_HEADER);
  const { events } = await readSseResponse(generateRes);
  const lastType = events.at(-1)!.data.type;
  eq('F5: terminal event for the rewritten prompt is failure', lastType, 'failure');
}

export async function runServerCoreTests(): Promise<void> {
  await testDeviceIdentity();
  await testSseFraming();
  await testStubPipelineEndpoints();
  await testSseCancelClearsKeepalive();
  await testAbortDoubleCreditRace();
  await testRequestLogging();
  await testStubBundleDefinesAppModule();
  await testStubRewritePreservesFailMarker();
}
