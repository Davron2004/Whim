/**
 * Server-core tests (SPEC.md §3, §4, §5).
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
import { ScriptedModelClient } from './scripted-model';
import type { ModelRoster } from '../src/generation/model';
import type { RunTrace } from '../src/generation/machine';
import type { GenerationStatsTransport } from '../src/generation/reconcile';
import type { GenerateRequest, GenerationEvent, Usage, WireAppRecord } from '@whim/contract';

// Rewrite is now real-model-backed (task 7.2) — a scripted client stands in for OpenRouter so
// §5.5's "same input → same output" assertion stays meaningful: two freshly-scripted apps, each
// given the same rewrite turns, must surface the same (non-echoed) response.
//
// The route re-asks once when a reply has no `plan` (a prose reply parses with `rewrittenPrompt`
// set but no structured rows), so a prose-only fixture must script TWO identical turns — the
// second is the one the route actually keeps.
const REWRITE_TEST_ROSTER: ModelRoster = { rewrite: 'vendor/rewrite-test', engineer: 'vendor/engineer-test' };
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

/** Returns true if for every stage, the start event precedes the done event. */
function checkStageOrder(events: GenerationEvent[]): boolean {
  const stageStart = new Map<string, number>();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === 'stage') {
      if (ev.status === 'start') {
        stageStart.set(ev.stage, i);
      } else if (ev.status === 'done') {
        const startIdx = stageStart.get(ev.stage);
        if (startIdx === undefined || startIdx >= i) return false;
      }
    }
  }
  return true;
}

async function testDeviceIdentity(): Promise<void> {
  section('Device-identity middleware (SPEC §3)');

  // §3.3 — /healthz is exempt (no device header needed)
  {
    const app = testApp();
    const res = await app.request('/healthz');
    eq('/healthz anonymous 200', res.status, 200);
  }

  // §3.1 — missing x-whim-device → 400 JSON, no stream (generate)
  {
    const app = testApp();
    const res = await post(app, '/v1/generate', { prompt: 'hello' });
    eq('missing device header → 400', res.status, 400);
    const ct = res.headers.get('content-type') ?? '';
    check(
      'missing device header → JSON not SSE',
      ct.includes('application/json') && !ct.includes('text/event-stream'),
    );
    const body = (await res.json()) as { error: string; hint: string };
    eq('missing device header error code', body.error, 'missing_device_id');
    check(
      'missing device header hint non-empty',
      typeof body.hint === 'string' && body.hint.length > 0,
    );
  }

  // §3.2 — malformed x-whim-device → 400 JSON
  {
    const app = testApp();
    const res = await post(
      app,
      '/v1/generate',
      { prompt: 'hello' },
      { 'x-whim-device': 'not-a-uuid' },
    );
    eq('malformed device header → 400', res.status, 400);
    const body = (await res.json()) as { error: string; hint: string };
    eq('malformed device header error code', body.error, 'invalid_device_id');
    check(
      'malformed device header hint non-empty',
      typeof body.hint === 'string' && body.hint.length > 0,
    );
  }

  // §3.1 — missing device header on /v1/rewrite too
  {
    const app = testApp();
    const res = await post(app, '/v1/rewrite', { prompt: 'hello' });
    eq('missing device on rewrite → 400', res.status, 400);
    const body = (await res.json()) as { error: string };
    eq('missing device on rewrite error code', body.error, 'missing_device_id');
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

  // §4.3 — keepalive on against a deliberately delayed source → ≥1 keepalive
  {
    // Each event is delayed 80 ms; keepalive fires every 20 ms → multiple per event gap
    const app = createApp({
      pipeline: createStubPipeline(80),
      usageStore: new InMemoryUsageStore(),
      keepaliveMs: 20,
    });
    const res = await post(app, '/v1/generate', { prompt: 'hello' }, DEVICE_HEADER);
    const { keepaliveCount, skippedFrames } = await readSseResponse(res);
    check('keepalive on → ≥1 keepalive', keepaliveCount >= 1, `got ${keepaliveCount}`);
    eq('keepalive on → 0 skipped frames', skippedFrames, 0);
  }

}

async function testStubPipelineEndpoints(): Promise<void> {
  section('Stub pipeline + endpoints (SPEC §5)');

  // §5.1 — happy path event order
  {
    const app = testApp();
    const res = await post(app, '/v1/generate', { prompt: 'build me a counter' }, DEVICE_HEADER);
    const { events, skippedFrames } = await readSseResponse(res);
    const types = events.map((e) => e.data.type);
    eq('happy path stub pipeline → 0 skipped frames', skippedFrames, 0);

    // Each stage: start before done
    const orderedStages = checkStageOrder(events.map((e) => e.data));
    check('each stage start precedes its done', orderedStages);

    // ≥1 token inside generate
    const tokenCount = events.filter((e) => e.data.type === 'token').length;
    check('≥1 token event in happy path', tokenCount >= 1);

    // usage before result
    const usageIdx = types.lastIndexOf('usage');
    const resultIdx = types.indexOf('result');
    check(
      'usage event before result terminal',
      usageIdx !== -1 && resultIdx !== -1 && usageIdx < resultIdx,
    );

    // result is last
    const lastType = types.at(-1);
    eq('result is last event', lastType, 'result');

    // result carries a WireAppRecord with expected fields
    const resultEvent = events.at(-1)!.data;
    check(
      'result event has app field',
      resultEvent.type === 'result' && typeof resultEvent.app === 'object',
    );
  }

  // §5.2 — failure path
  {
    const app = testApp();
    const res = await post(
      app,
      '/v1/generate',
      { prompt: 'do something [[fail]] please' },
      DEVICE_HEADER,
    );
    const { events, skippedFrames } = await readSseResponse(res);
    const types = events.map((e) => e.data.type);
    eq('failure path → 0 skipped frames', skippedFrames, 0);

    const terminalCount = events.filter(
      (e) => e.data.type === 'result' || e.data.type === 'failure',
    ).length;
    eq('failure path: exactly one terminal', terminalCount, 1);

    const lastType = types.at(-1);
    eq('failure path: terminal is failure', lastType, 'failure');

    const failEvent = events.at(-1)!.data;
    if (failEvent.type === 'failure') {
      check(
        'failure has non-empty reason',
        typeof failEvent.reason === 'string' && failEvent.reason.length > 0,
      );
      check('failure has numeric attempts', typeof failEvent.attempts === 'number');
      check('failure has diagnostics array', Array.isArray(failEvent.diagnostics));
    } else {
      check('failure path terminal is failure type', false);
    }

    // no result event
    check('failure path has no result event', !types.includes('result'));

    // usage precedes failure
    const usageIdx = types.lastIndexOf('usage');
    const failureIdx = types.indexOf('failure');
    check(
      'usage before failure terminal',
      usageIdx !== -1 && failureIdx !== -1 && usageIdx < failureIdx,
    );
  }

  // §5.3 — invalid body → 400 JSON not SSE
  {
    const app = testApp();
    const res = await post(app, '/v1/generate', { notPrompt: 'oops' }, DEVICE_HEADER);
    eq('invalid generate body → 400', res.status, 400);
    const ct = res.headers.get('content-type') ?? '';
    check('invalid generate body → JSON not SSE', !ct.includes('text/event-stream'));
    const body = (await res.json()) as { error: string };
    check('invalid generate body has error field', typeof body.error === 'string');
  }

  // §5.5 — rewrite: same input against the same scripted response → same output, never the
  // input prompt echoed back
  {
    const res1 = await post(scriptedRewriteApp(), '/v1/rewrite', { prompt: 'make a todo app' }, DEVICE_HEADER);
    const res2 = await post(scriptedRewriteApp(), '/v1/rewrite', { prompt: 'make a todo app' }, DEVICE_HEADER);
    eq('rewrite status 200', res1.status, 200);
    const body1 = (await res1.json()) as { rewrittenPrompt: string };
    const body2 = (await res2.json()) as { rewrittenPrompt: string };
    check(
      'rewrite rewrittenPrompt is non-empty',
      typeof body1.rewrittenPrompt === 'string' && body1.rewrittenPrompt.length > 0,
    );
    check('rewrite never echoes the input prompt verbatim', body1.rewrittenPrompt !== 'make a todo app');
    eq('rewrite is deterministic against the same scripted response', body1.rewrittenPrompt, body2.rewrittenPrompt);
  }

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

      // Drive the callback 3 more times to confirm it's no longer referenced
      let firesAfterCancel = 0;
      for (let i = 0; i < 3; i++) {
        if (intervalCb !== null) {
          firesAfterCancel++;
          (intervalCb as () => void)();
        }
      }
      eq('keepalive fires 0 times after cancel', firesAfterCancel, 0);
    } finally {
      (globalThis as unknown as Record<string, unknown>).setInterval = realSetInterval;
      (globalThis as unknown as Record<string, unknown>).clearInterval = realClearInterval;
    }
  }
}

/**
 * SRV cancellation — cancelling the SSE stream aborts the underlying pipeline (design.md D1-D4).
 * Replaces the F1 `neverYields` source (structurally unable to detect a leaked pipeline, per
 * research.md §7) with the REAL stub pipeline wired through an `AbortController`, wrapped in a
 * counting generator so we can observe whether the pipeline keeps producing events after cancel.
 * Also instruments `setTimeout`/`clearTimeout` (the stub's `delay()` primitive) to assert no
 * timer is left dangling once the pipeline observes the abort.
 */
async function testSseCancelAbortsPipeline(): Promise<void> {
  section('SSE cancel() aborts the stub pipeline (SRV-1)');

  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;

  // Track every timer the stub pipeline's delay() schedules, and whether it gets cleared —
  // backed by the REAL timer so pacing behavior is unaffected, only bookkeeping is added.
  const liveTimers = new Set<ReturnType<typeof setTimeout>>();

  (globalThis as unknown as Record<string, unknown>).setTimeout = (
    cb: () => void,
    ms?: number,
  ): ReturnType<typeof setTimeout> => {
    const handle = realSetTimeout(() => {
      liveTimers.delete(handle);
      cb();
    }, ms);
    liveTimers.add(handle);
    return handle;
  };

  (globalThis as unknown as Record<string, unknown>).clearTimeout = (
    handle: ReturnType<typeof setTimeout>,
  ): void => {
    if (liveTimers.has(handle)) {
      realClearTimeout(handle);
      liveTimers.delete(handle);
    }
  };

  try {
    const controller = new AbortController();
    const pipeline = createStubPipeline(15); // non-zero inter-event delay (scenario requirement)

    let eventCount = 0;
    let sawEventAfterCancel = false;
    let cancelled = false;

    // Instrumented source: counts every event actually pulled from the pipeline, and flags
    // whether any of them arrive after the stream was cancelled.
    async function* countingSource(): AsyncGenerator<GenerationEvent> {
      for await (const event of pipeline.run({ prompt: 'hello' }, controller.signal)) {
        eventCount++;
        if (cancelled) sawEventAfterCancel = true;
        yield event;
      }
    }

    const stream = buildSseStream(countingSource(), 0, () => controller.abort());
    const reader = stream.getReader();

    // Read the first frame (well before the pipeline's `usage`/terminal events).
    await reader.read();
    check('at least one event observed before cancel', eventCount > 0);

    // Non-vacuity guard: give the pipeline's next delay() a moment to register its timer
    // (it's scheduled a few microtask hops after the read resolves) before asserting it exists.
    await new Promise((r) => realSetTimeout(r, 5));
    check('a delay timer is pending before cancel', liveTimers.size > 0);

    const eventsBeforeCancel = eventCount;
    cancelled = true;
    await reader.cancel();

    // Give the (potentially unfixed) pipeline ample real time to keep running if the abort
    // didn't actually stop it — long enough for the full stub sequence (~14 events * 15ms).
    await new Promise((r) => realSetTimeout(r, 300));

    check('no further events after cancel', eventCount === eventsBeforeCancel);
    check('no event observed with the cancelled flag set', !sawEventAfterCancel);
    eq('no delay timers left dangling after cancel', liveTimers.size, 0);
  } finally {
    (globalThis as unknown as Record<string, unknown>).setTimeout = realSetTimeout;
    (globalThis as unknown as Record<string, unknown>).clearTimeout = realClearTimeout;
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
 *  matches `GenerationStatsTransport`'s "not yet resolved" contract for any other id. */
function makeFixedTransport(generationId: string, usage: Usage): GenerationStatsTransport {
  return {
    fetchStats: async (id: string) => (id === generationId ? usage : null),
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
 * `makeGenerateRoute` had zero direct coverage). A run that completes NORMALLY credits usage via
 * `interceptUsage`'s `usage` event before its terminal event is ever observed. If the client
 * disconnects in the gap between those two events — a real disconnect window, not a contrived
 * one — the abort listener must not re-credit the same run from `reconcileAbortedUsage`.
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
    const app = createApp({
      pipeline,
      usageStore,
      reconcile: { transport, bounds: FAST_RECONCILE_BOUNDS },
    });

    const res = await post(app, '/v1/generate', { prompt: 'hello' }, DEVICE_HEADER);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const buffered = await readUntil(reader, decoder, (b) => b.includes('event: usage'));
    check('usage frame observed before disconnect', buffered.includes('event: usage'));

    // The client disconnects here: after usage was credited, before any terminal event.
    await reader.cancel();
    releaseGate();
    await new Promise((r) => setTimeout(r, 50));

    check('a run that disconnects after usage never emits a terminal event', !terminalEmitted);
    const total = await usageStore.read(DEVICE_ID);
    eq(
      'a run that completed normally, disconnected before its terminal event, credits usage exactly once (not the doubled 20/40/60)',
      total,
      RACE_USAGE,
    );
  }

  // A run aborted mid-run — before any `usage` event was ever observed — must still reconcile
  // and credit exactly once from the reconciliation path (the case reconciliation exists for).
  {
    const generationId = 'race-midrun-2';
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let terminalEmitted = false;

    const pipeline: Pipeline = {
      async *run(_request: GenerateRequest, signal?: AbortSignal, trace?: RunTrace) {
        if (signal?.aborted) return;
        trace?.generationIds.push(generationId);
        yield { type: 'stage', stage: 'plan', status: 'start' };
        await gate;
        if (signal?.aborted) return;
        yield { type: 'usage', usage: RACE_USAGE };
        if (signal?.aborted) return;
        terminalEmitted = true;
        yield { type: 'result', app: RACE_APP };
      },
    };

    const usageStore = new InMemoryUsageStore();
    const transport = makeFixedTransport(generationId, RACE_USAGE);
    const app = createApp({
      pipeline,
      usageStore,
      reconcile: { transport, bounds: FAST_RECONCILE_BOUNDS },
    });

    const res = await post(app, '/v1/generate', { prompt: 'hello' }, DEVICE_HEADER);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const buffered = await readUntil(reader, decoder, (b) => b.includes('event: stage'));
    check('a stage frame arrived before the mid-run disconnect', buffered.includes('event: stage'));
    check('no usage frame arrived before the mid-run disconnect', !buffered.includes('event: usage'));

    await reader.cancel();
    releaseGate();
    await new Promise((r) => setTimeout(r, 50));

    check('a run aborted mid-run never emits a terminal event', !terminalEmitted);
    const total = await usageStore.read(DEVICE_ID);
    eq('a run aborted before any usage event still reconciles exactly once', total, RACE_USAGE);
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
  await testSseCancelAbortsPipeline();
  await testAbortDoubleCreditRace();
  await testRequestLogging();
  await testStubBundleDefinesAppModule();
  await testStubRewritePreservesFailMarker();
}
