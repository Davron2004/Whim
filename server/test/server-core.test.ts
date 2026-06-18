/**
 * Server-core tests (SPEC.md §3, §4, §5).
 * Driven by Hono's in-process app.request() and the test-side sse-reader.
 */
import { check, eq, section } from './harness';
import { readSseResponse } from './sse-reader';
import { createApp } from '../src/app';
import { createStubPipeline } from '../src/pipeline';
import { InMemoryUsageStore } from '../src/usage-store';
import type { GenerationEvent } from '@whim/contract';

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

export async function runServerCoreTests(): Promise<void> {
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

  section('SSE framing (SPEC §4)');

  // §4.1/4.2/4.4 — frame shape, monotonic ids, exactly one terminal last
  {
    const app = testApp();
    const res = await post(app, '/v1/generate', { prompt: 'hello' }, DEVICE_HEADER);
    eq('happy path generate → 200', res.status, 200);
    const ct = res.headers.get('content-type') ?? '';
    check('happy path content-type is event-stream', ct.includes('text/event-stream'));

    const { events } = await readSseResponse(res);
    check('events is non-empty', events.length > 0);

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
    const lastEvent = events[events.length - 1];
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
    const { keepaliveCount } = await readSseResponse(res);
    eq('keepalive off → 0 keepalives', keepaliveCount, 0);
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
    const { keepaliveCount } = await readSseResponse(res);
    check('keepalive on → ≥1 keepalive', keepaliveCount >= 1, `got ${keepaliveCount}`);
  }

  section('Stub pipeline + endpoints (SPEC §5)');

  // §5.1 — happy path event order
  {
    const app = testApp();
    const res = await post(app, '/v1/generate', { prompt: 'build me a counter' }, DEVICE_HEADER);
    const { events } = await readSseResponse(res);
    const types = events.map((e) => e.data.type);

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
    const lastType = types[types.length - 1];
    eq('result is last event', lastType, 'result');

    // result carries a WireAppRecord with expected fields
    const resultEvent = events[events.length - 1].data;
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
    const { events } = await readSseResponse(res);
    const types = events.map((e) => e.data.type);

    const terminalCount = events.filter(
      (e) => e.data.type === 'result' || e.data.type === 'failure',
    ).length;
    eq('failure path: exactly one terminal', terminalCount, 1);

    const lastType = types[types.length - 1];
    eq('failure path: terminal is failure', lastType, 'failure');

    const failEvent = events[events.length - 1].data;
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

  // §5.5 — deterministic rewrite: same input → same output
  {
    const app = testApp();
    const res1 = await post(app, '/v1/rewrite', { prompt: 'make a todo app' }, DEVICE_HEADER);
    const res2 = await post(app, '/v1/rewrite', { prompt: 'make a todo app' }, DEVICE_HEADER);
    eq('rewrite status 200', res1.status, 200);
    const body1 = (await res1.json()) as { rewrittenPrompt: string };
    const body2 = (await res2.json()) as { rewrittenPrompt: string };
    check(
      'rewrite rewrittenPrompt is non-empty',
      typeof body1.rewrittenPrompt === 'string' && body1.rewrittenPrompt.length > 0,
    );
    eq('rewrite is deterministic', body1.rewrittenPrompt, body2.rewrittenPrompt);
  }

  // §5.5 — invalid rewrite body → 400
  {
    const app = testApp();
    const res = await post(app, '/v1/rewrite', { notPrompt: 'oops' }, DEVICE_HEADER);
    eq('invalid rewrite body → 400', res.status, 400);
    const ct = res.headers.get('content-type') ?? '';
    check('invalid rewrite body → JSON', ct.includes('application/json'));
  }
}
