/**
 * Provider breaker acceptance (generation-reliability chain-breaker, #66). Covers
 * `admission/provider-breaker.ts` on an injected clock: counting, the window, opening, the
 * Retry-After arithmetic, the lazy shared probe, the disabled setting, the model-client feed, and
 * what the log lines carry. Route wiring is `admission.suite.ts`; the alert is
 * `deploy-config.suite.ts`.
 *
 * Failures are the real producers' errors (`OpenRouter*Error`), classified by the real
 * `modelFailureOf`, so the suite fails if the breaker and the classifier disagree about what is
 * upstream. Nothing sleeps: time is a number the test moves, and the probe is a promise the test
 * holds.
 */
import { caught, check, eq, section } from './harness';
import { captureLogs, withMessage, type LogCapture } from './log-capture';
import { log } from '../src/logger';
import { loadServerConfig } from '../src/config';
import {
  createModelProbe,
  createProviderBreaker,
  guardModel,
  PROVIDER_BREAKER_CLOSED_MESSAGE,
  PROVIDER_BREAKER_OPEN_MESSAGE,
  PROVIDER_PROBE_FAILED_MESSAGE,
  withProviderBreaker,
  type ProviderBreaker,
  type ProviderProbe,
} from '../src/admission/provider-breaker';
import { modelFailureOf } from '../src/model-failure';
import { defaultModelRoster, type ModelClient, type ModelRequest, type ModelRoster } from '../src/generation/model';
import { OpenRouterAuthError, OpenRouterCreditError, OpenRouterNetworkError, OpenRouterRateLimitError } from '../src/openrouter';
import { ScriptedModelClient, type ScriptedTurn } from './scripted-model';

const WINDOW_MS = 180_000;
const COOLDOWN_MS = 60_000;
const ROSTER: ModelRoster = defaultModelRoster('vendor/rewrite-b', 'vendor/engineer-b');

interface Held {
  promise: Promise<void>;
  resolve(): void;
  reject(err: unknown): void;
}

function held(): Held {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const upstream503 = (): OpenRouterNetworkError => new OpenRouterNetworkError('provider unavailable', undefined, 503);

interface Rig {
  breaker: ProviderBreaker;
  advance(ms: number): void;
  now(): number;
  probeCalls: AbortSignal[];
  /** The next probe waits on this; replace it before the cooldown passes. */
  probeGate: { current: Held };
}

function rig(overrides: { failures?: number } = {}): Rig {
  let now = Date.UTC(2026, 0, 15, 12, 0, 0);
  const probeCalls: AbortSignal[] = [];
  const probeGate = { current: held() };
  const probe: ProviderProbe = (signal) => {
    probeCalls.push(signal);
    return probeGate.current.promise;
  };
  const breaker = createProviderBreaker({
    failures: overrides.failures ?? 4,
    windowMs: WINDOW_MS,
    cooldownMs: COOLDOWN_MS,
    clock: () => now,
    log: log.child({ scope: 'provider-breaker-test' }),
    probe,
  });
  return { breaker, advance: (ms) => (now += ms), now: () => now, probeCalls, probeGate };
}

function fail(r: Rig, err: unknown, signal?: AbortSignal): void {
  r.breaker.record(modelFailureOf(err, signal));
}

function failUpstream(r: Rig, times: number): void {
  for (let i = 0; i < times; i++) fail(r, upstream503());
}

function logged(capture: LogCapture, message: string): Record<string, unknown>[] {
  return withMessage(capture, message);
}

async function testOpenAndRetryAfter(): Promise<void> {
  section('Counting: four consecutive upstream failures open it, and Retry-After is the whole seconds left');

  {
    const r = rig();
    const capture = captureLogs();
    failUpstream(r, 3);
    eq('three failures leave it closed', await r.breaker.admit(), { ok: true });
    failUpstream(r, 1);
    capture.stop();
    eq('the fourth opens it: one warning', logged(capture, PROVIDER_BREAKER_OPEN_MESSAGE).length, 1);
  }

  {
    const r = rig();
    failUpstream(r, 4);
    eq('open: admit refuses with the full cooldown, 60 s', await r.breaker.admit(), { ok: false, retryAfterSeconds: 60 });
    r.advance(20_000);
    eq('20 s later: 40 s', await r.breaker.admit(), { ok: false, retryAfterSeconds: 40 });
    r.advance(500);
    eq('39.5 s left rounds up to 40', await r.breaker.admit(), { ok: false, retryAfterSeconds: 40 });
    r.advance(39_000);
    eq('500 ms from the end still reads 1 s, never 0', await r.breaker.admit(), { ok: false, retryAfterSeconds: 1 });
    check('no probe has run while the cooldown lasted', r.probeCalls.length === 0);
  }
}

async function testStreakRules(): Promise<void> {
  section('A success resets the count; failures that are not upstream change nothing');

  {
    const r = rig();
    failUpstream(r, 3);
    r.breaker.record('completed');
    failUpstream(r, 3);
    eq('three failures, a success, three failures: closed', await r.breaker.admit(), { ok: true });
    failUpstream(r, 1);
    check('... and the fourth after the success is the one that opens it', !(await r.breaker.admit()).ok);
  }

  {
    const r = rig();
    const cancelled = new AbortController();
    cancelled.abort();
    const kinds = [
      new OpenRouterAuthError('bad key'),
      new OpenRouterCreditError('out of credit'),
      new OpenRouterNetworkError('bad request', undefined, 400),
    ];
    for (const err of kinds) fail(r, err);
    fail(r, new OpenRouterNetworkError('connection closed'), cancelled.signal);
    for (let i = 0; i < 6; i++) fail(r, kinds[i % kinds.length]);
    eq('401, 402, 400 and a client cancel never open it, however many arrive', await r.breaker.admit(), { ok: true });
  }

  {
    const r = rig();
    const cancelled = new AbortController();
    cancelled.abort();
    failUpstream(r, 3);
    fail(r, new OpenRouterAuthError('bad key'));
    fail(r, new OpenRouterCreditError('out of credit'));
    fail(r, new OpenRouterNetworkError('connection closed'), cancelled.signal);
    eq('a 401, a 402 and a cancel between upstream failures do not reset the streak', await r.breaker.admit(), { ok: true });
    failUpstream(r, 1);
    check('... so the next upstream failure is the fourth', !(await r.breaker.admit()).ok);
  }

  {
    const r = rig();
    const timedOut = new AbortController();
    timedOut.abort(new DOMException('The operation timed out.', 'TimeoutError'));
    fail(r, new OpenRouterRateLimitError('slow down'));
    fail(r, new OpenRouterNetworkError('connection reset'));
    fail(r, upstream503());
    eq('a 429, a status-less network failure and a 5xx are three of four', await r.breaker.admit(), { ok: true });
    fail(r, new OpenRouterNetworkError('connection closed'), timedOut.signal);
    check('a call timeout counts as the fourth: it opens', !(await r.breaker.admit()).ok);
  }

  section('The window: the fourth failure must fall within it of the first');

  {
    const r = rig();
    failUpstream(r, 3);
    r.advance(WINDOW_MS + 1);
    failUpstream(r, 1);
    eq('a fourth failure past the window does not open it', await r.breaker.admit(), { ok: true });
    failUpstream(r, 2);
    eq('the streak restarted at that failure: two more make three, still closed', await r.breaker.admit(), { ok: true });
    failUpstream(r, 1);
    check('... and a fourth within the new window opens it', !(await r.breaker.admit()).ok);
  }

  {
    const r = rig();
    failUpstream(r, 3);
    r.advance(WINDOW_MS);
    failUpstream(r, 1);
    check('a fourth failure exactly at the window edge still opens it', !(await r.breaker.admit()).ok);
  }

  {
    const r = rig();
    failUpstream(r, 3);
    r.breaker.record('completed');
    r.advance(WINDOW_MS + 1);
    failUpstream(r, 3);
    eq('a success restarts the window too: three after it stay closed', await r.breaker.admit(), { ok: true });
  }

  section('A zero threshold disables it');

  {
    const r = rig({ failures: 0 });
    const capture = captureLogs();
    failUpstream(r, 20);
    capture.stop();
    eq('twenty upstream failures with failures:0 never refuse', await r.breaker.admit(), { ok: true });
    eq('... and nothing is logged', capture.records.filter((rec) => rec.scope === 'provider-breaker-test').length, 0);
    check('... and no probe runs', r.probeCalls.length === 0);
  }
}

async function testLogs(): Promise<void> {
  section('The log lines carry counts and the closed error vocabulary, never content');

  const r = rig();
  const capture = captureLogs();
  failUpstream(r, 3);
  fail(r, new OpenRouterNetworkError('provider said: the user prompt was "build me a secret app"', undefined, 502));
  r.advance(COOLDOWN_MS);
  const admitted = r.breaker.admit();
  r.probeGate.current.resolve();
  await admitted;
  capture.stop();

  const open = logged(capture, PROVIDER_BREAKER_OPEN_MESSAGE);
  eq('one open line', open.length, 1);
  eq('level warn (40)', open[0]?.level, 40);
  eq('it carries the count, window, cooldown, last errorKind and status', {
    failures: open[0]?.failures,
    windowMs: open[0]?.windowMs,
    cooldownMs: open[0]?.cooldownMs,
    errorKind: open[0]?.errorKind,
    status: open[0]?.status,
  }, { failures: 4, windowMs: WINDOW_MS, cooldownMs: COOLDOWN_MS, errorKind: 'server', status: 502 });

  const closed = logged(capture, PROVIDER_BREAKER_CLOSED_MESSAGE);
  eq('one closed line, at info (30), carrying how long it was open', [closed.length, closed[0]?.level, closed[0]?.openMs], [1, 30, COOLDOWN_MS]);

  const ours = capture.raw.filter((line) => line.includes('provider-breaker-test'));
  check('the error message text appears in no line', ours.every((line) => !line.includes('secret app') && !line.includes('provider said')));
  const fields = new Set(capture.records.filter((rec) => rec.scope === 'provider-breaker-test').flatMap((rec) => Object.keys(rec)));
  for (const standard of ['level', 'time', 'pid', 'hostname', 'msg', 'scope', 'severity']) fields.delete(standard);
  eq('the only fields beyond pino\'s own are the closed ones', [...fields].sort((a, b) => a.localeCompare(b)), ['cooldownMs', 'errorKind', 'failures', 'openMs', 'status', 'windowMs']);
}

async function testProbe(): Promise<void> {
  section('The lazy probe: one shared call after the cooldown decides');

  {
    const r = rig();
    const capture = captureLogs();
    failUpstream(r, 4);
    r.advance(COOLDOWN_MS - 1);
    eq('1 ms before the cooldown ends: still refused, no probe', [(await r.breaker.admit()).ok, r.probeCalls.length], [false, 0]);
    r.advance(1);
    const three = [r.breaker.admit(), r.breaker.admit(), r.breaker.admit()];
    eq('three concurrent admissions after the cooldown make exactly one probe call', r.probeCalls.length, 1);
    check('the probe was handed a live signal', r.probeCalls[0] instanceof AbortSignal && !r.probeCalls[0].aborted);
    r.probeGate.current.resolve();
    eq('resolving it admits all three', await Promise.all(three), [{ ok: true }, { ok: true }, { ok: true }]);
    eq('a later admission needs no probe', [(await r.breaker.admit()).ok, r.probeCalls.length], [true, 1]);
    capture.stop();
    eq('the breaker closed with one closed line', logged(capture, PROVIDER_BREAKER_CLOSED_MESSAGE).length, 1);
  }

  {
    const r = rig();
    const capture = captureLogs();
    failUpstream(r, 4);
    r.advance(COOLDOWN_MS);
    const three = [r.breaker.admit(), r.breaker.admit(), r.breaker.admit()];
    r.probeGate.current.reject(new OpenRouterNetworkError('bad gateway', undefined, 502));
    eq(
      'a probe that fails with a 502 refuses all three with the full cooldown',
      await Promise.all(three),
      [1, 2, 3].map(() => ({ ok: false, retryAfterSeconds: 60 })),
    );
    capture.stop();
    const failedLines = logged(capture, PROVIDER_PROBE_FAILED_MESSAGE);
    eq('one probe-failed warning with errorKind and status', failedLines.map((l) => [l.level, l.errorKind, l.status]), [[40, 'server', 502]]);
    eq('it did not log a second "open" for the re-open', logged(capture, PROVIDER_BREAKER_OPEN_MESSAGE).length, 1);

    r.advance(30_000);
    eq('during the new cooldown it refuses without probing', [await r.breaker.admit(), r.probeCalls.length], [{ ok: false, retryAfterSeconds: 30 }, 1]);
    r.advance(30_000);
    r.probeGate.current = held();
    const again = r.breaker.admit();
    eq('after the new cooldown a fresh probe runs', r.probeCalls.length, 2);
    r.probeGate.current.resolve();
    eq('and a completed one closes it', await again, { ok: true });
  }

  {
    const r = rig();
    failUpstream(r, 4);
    r.advance(COOLDOWN_MS);
    const waiting = r.breaker.admit();
    r.probeGate.current.reject(new OpenRouterAuthError('bad key'));
    eq('a probe failing for any reason (here a 401) re-opens it', await waiting, { ok: false, retryAfterSeconds: 60 });
  }

  section('Any completed call closes an open breaker');

  {
    const r = rig();
    const capture = captureLogs();
    failUpstream(r, 4);
    r.advance(10_000);
    r.breaker.record('completed');
    capture.stop();
    eq('a call that completed while it was open closes it with no probe', [(await r.breaker.admit()).ok, r.probeCalls.length], [true, 0]);
    eq('... logging the close with how long it was open', logged(capture, PROVIDER_BREAKER_CLOSED_MESSAGE).map((l) => l.openMs), [10_000]);
  }

  {
    const r = rig();
    failUpstream(r, 4);
    r.advance(COOLDOWN_MS);
    const waiting = r.breaker.admit();
    r.breaker.record('completed');
    r.probeGate.current.reject(upstream503());
    eq('a call that completes while the probe is out wins over a probe that then fails', await waiting, { ok: true });
    eq('... and the breaker stays closed', await r.breaker.admit(), { ok: true });
  }
}

async function testModelProbe(): Promise<void> {
  section('The probe call: one token from the engineer model, reasoning off');

  const ok = new ScriptedModelClient(ROSTER, [{ role: 'engineer', deltas: ['o'], usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 } }]);
  const signal = new AbortController().signal;
  await createModelProbe(ok, ROSTER)(signal);
  const sent = ok.requests[0]?.request;
  eq('the request names the engineer model, one token, reasoning off, role probe', {
    model: sent?.model,
    maxTokens: sent?.maxTokens,
    reasoning: sent?.reasoning,
    role: sent?.role,
  }, { model: ROSTER.engineer.model, maxTokens: 1, reasoning: 'off', role: 'probe' });
  eq('it is one short user message', sent?.messages.map((m) => m.role), ['user']);

  const failing = new ScriptedModelClient(ROSTER, [{ role: 'engineer', deltas: [], error: upstream503() }]);
  const err = await caught(() => createModelProbe(failing, ROSTER)(signal));
  eq('a failing probe call rejects with the provider error, which the breaker then classifies', modelFailureOf(err).errorKind, 'server');
}

const GENERATE_REQUEST: ModelRequest = { model: ROSTER.engineer.model, messages: [], reasoning: 'off', role: 'generate' };

/** Runs one call to its end and returns what it threw, if anything. */
async function consume(client: ModelClient, signal?: AbortSignal): Promise<unknown> {
  const stream = client.stream(GENERATE_REQUEST, signal);
  stream.usage.catch(() => undefined);
  return caught(async () => {
    const deltas = stream.deltas[Symbol.asyncIterator]();
    let step = await deltas.next();
    while (!step.done) step = await deltas.next();
  });
}

const failingTurn = (error: unknown): ScriptedTurn => ({ role: 'engineer', deltas: [], error });

async function testFeed(): Promise<void> {
  section('The feed: a wrapped model client reports each call to the breaker');

  {
    const r = rig();
    const turns: ScriptedTurn[] = [1, 2, 3, 4].map(() => ({ role: 'engineer', deltas: ['partial'], error: upstream503() }));
    const wrapped = withProviderBreaker(new ScriptedModelClient(ROSTER, [...turns, { role: 'engineer', deltas: ['done'] }]), r.breaker);
    for (let i = 0; i < 3; i++) await consume(wrapped);
    eq('three failed turns leave it closed', (await r.breaker.admit()).ok, true);
    const lastErr = await consume(wrapped);
    check('the wrapper rethrows the provider error unchanged', lastErr instanceof OpenRouterNetworkError && lastErr.status === 503);
    eq('the fourth failed turn opens the breaker', await r.breaker.admit(), { ok: false, retryAfterSeconds: 60 });
    const stream = wrapped.stream(GENERATE_REQUEST);
    const text: string[] = [];
    for await (const delta of stream.deltas) text.push(delta.text);
    eq('a completed turn passes its deltas and usage through', [text, await stream.usage], [['done'], { promptTokens: 0, completionTokens: 0, totalTokens: 0 }]);
    eq('... and closes the breaker with no probe', [(await r.breaker.admit()).ok, r.probeCalls.length], [true, 0]);
  }

  {
    const r = rig();
    const gone = new AbortController();
    gone.abort();
    const notUpstream = [
      new OpenRouterCreditError('out of credit'),
      new OpenRouterAuthError('bad key'),
      new OpenRouterNetworkError('bad request', undefined, 400),
    ];
    const turns = [...notUpstream, ...notUpstream].map(failingTurn);
    const wrapped = withProviderBreaker(new ScriptedModelClient(ROSTER, [...turns, failingTurn(new OpenRouterNetworkError('connection closed')), failingTurn(new OpenRouterNetworkError('connection closed'))]), r.breaker);
    for (let i = 0; i < turns.length; i++) await consume(wrapped);
    await consume(wrapped, gone.signal);
    await consume(wrapped, gone.signal);
    eq('a 402, a 401, a 400 and two client disconnects through the wrapper never open it', (await r.breaker.admit()).ok, true);
  }

  {
    const r = rig();
    failUpstream(r, 3);
    const client = new ScriptedModelClient(ROSTER, [{ role: 'engineer', deltas: ['a', 'b', 'c'] }]);
    const stream = withProviderBreaker(client, r.breaker).stream(GENERATE_REQUEST);
    for await (const delta of stream.deltas) {
      check('the consumer read the first delta', delta.text === 'a');
      break;
    }
    failUpstream(r, 1);
    check('a consumer that stops early is neither a success nor a failure: the streak survives it', !(await r.breaker.admit()).ok);
  }
}

async function testComposition(): Promise<void> {
  section('The composition root guards the shared client from the configuration');

  let now = Date.UTC(2026, 0, 15, 12, 0, 0);
  const config = { ...loadServerConfig({ WHIM_PROVIDER_BREAKER_FAILURES: '2', WHIM_PROVIDER_BREAKER_COOLDOWN_MS: '30000' }), now: () => now };
  const unguarded = new ScriptedModelClient(ROSTER, [failingTurn(upstream503()), failingTurn(upstream503()), { role: 'engineer', deltas: ['o'] }]);
  const { model, breaker } = guardModel({ client: unguarded, roster: ROSTER }, config, log.child({ scope: 'provider-breaker-test' }));

  eq('the roster passes through untouched', model.roster, ROSTER);
  await consume(model.client);
  eq('one failure of the configured two leaves it closed', (await breaker.admit()).ok, true);
  await consume(model.client);
  eq('the second opens it, for the configured cooldown (30 s, not the default 60)', await breaker.admit(), { ok: false, retryAfterSeconds: 30 });

  now += 30_000;
  eq('after the cooldown the probe closes it', await breaker.admit(), { ok: true });
  const probe = unguarded.requests[2]?.request;
  eq('... and went to the unguarded client as an engineer-model probe', [unguarded.requests.length, probe?.role, probe?.model], [3, 'probe', ROSTER.engineer.model]);
}

export async function runProviderBreakerTests(): Promise<void> {
  await testOpenAndRetryAfter();
  await testStreakRules();
  await testLogs();
  await testProbe();
  await testModelProbe();
  await testFeed();
  await testComposition();
}
