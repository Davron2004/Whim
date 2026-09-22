/**
 * Generate route acceptance (public-generation-server chain-10). Scaffolded here by chain-1
 * (task 2.5, pre-registered in acceptance.ts); chain-10 fills it in — this module is
 * chain-10's alone to edit.
 *
 * Covers `/v1/generate`'s admission (specs/server-admission-control "Admission checks run in a
 * fixed order", "A device runs at most one generation at a time", "Global concurrency caps protect
 * the server", "Per-device daily limits reset at UTC midnight", "Global daily ceilings bound total
 * spend", "The server refuses admission when the operator's provider credit is exhausted"), the
 * route-level content-policy scenarios (specs/content-policy), the stream's single teardown path on
 * every ending, ledger settlement and cost resolution, the mid-run `402` ending
 * (specs/generation-pipeline), and the data-directory scan (specs/generation-server "Server state
 * is the usage store and user-sent reports").
 *
 * Every wait is bounded: a stream read or a condition poll that never completes fails its check by
 * name instead of hanging the suite.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { check, caught, eq, section } from './harness';
import { ScriptedModelClient } from './scripted-model';
import { readSseResponse } from './sse-reader';
import { createApp } from '../src/app';
import { loadServerConfig, type ServerConfig } from '../src/config';
import { createStubPipeline, type Pipeline } from '../src/pipeline';
import {
  InMemoryUsageStore,
  NodeSqliteUsageStore,
  type AdmitParams,
  type AdmitResult,
  type CostState,
  type CostSweepCandidate,
  type CostSweepQuery,
  type RequestOutcome,
  type SummaryParams,
  type UsageStore,
  type UsageSummary,
} from '../src/usage-store';
import { NodeSqliteReportStore } from '../src/reports/store';
import { createSlotController, type AcquireResult, type SlotController, type SlotKind } from '../src/admission/slots';
import { invalidateCreditCache, type CreditLookupResponse, type CreditTransport } from '../src/admission/credit';
import { cachedPolicy, ModelContentPolicy, type ContentPolicy } from '../src/policy';
import { InFlightGenerations } from '../src/routes/generate';
import { ResolveTracker, type GenerationStats, type UsageAndCostTransport } from '../src/usage/resolve';
import type { Clock, RunTrace } from '../src/generation/machine';
import type { ModelClient, ModelDelta, ModelRequest, ModelRoster, ModelStream } from '../src/generation/model';
import {
  ControlledModelClient,
  RecordingUsageStore,
  STALL,
  TIMED_OUT,
  machinePipeline,
  waitFor,
  within,
} from './route-doubles';
import {
  ApiError,
  ServiceRefusalCode,
  type GenerateRequest,
  type GenerationEvent,
  type Usage,
  type WireAppRecord,
} from '@whim/contract';

const DEVICE_A = 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0';
const DEVICE_B = 'b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0';
const ROSTER: ModelRoster = { rewrite: 'vendor/rewrite-g', engineer: 'vendor/engineer-g' };
/** 22:00:00 UTC — two hours to the reset, so every knowable `Retry-After` is exactly 7200. */
const AT_2200_UTC = Date.UTC(2026, 0, 15, 22, 0, 0);
const PROMPT = { prompt: 'a tip splitter' };
const RUN_USAGE: Usage = { promptTokens: 40, completionTokens: 60, totalTokens: 100 };
const RESULT_APP: WireAppRecord = {
  name: 'Tip Splitter',
  source: "import { defineApp, Screen, Text } from 'vc-sdk'; export default defineApp({ render: () => <Screen><Text>Tip</Text></Screen> });",
  bundle: '(()=>{})();',
  manifest: { capabilities: [] },
  schema: {},
};
const FAST_RESOLVE_BOUNDS = { maxAttempts: 1, totalBudgetMs: 2000, retryDelayMs: 0, perAttemptTimeoutMs: 500 };
const WAIT_MS = 5000;
const EXPIRED_REASON = 'This took too long to build. Please try again.';
const CREDIT_EXHAUSTED_REASON = 'Whim has used up its generation budget for now. Try again later.';

// ─── Local doubles (route-specific, not shared) ─────────────────────────────

class SlotSpy {
  acquires = 0;
  readonly releaseCalls: number[] = [];
  readonly controller: SlotController;

  constructor(private readonly inner: SlotController) {
    this.controller = {
      acquire: (kind, deviceId) => this.acquire(kind, deviceId),
      startDraining: () => inner.startDraining(),
      isDraining: () => inner.isDraining(),
      counts: () => inner.counts(),
    };
  }

  get generations(): number {
    return this.inner.counts().generations;
  }

  private acquire(kind: SlotKind, deviceId: string): AcquireResult {
    this.acquires++;
    const result = this.inner.acquire(kind, deviceId);
    if (!result.ok) return result;
    const index = this.releaseCalls.push(0) - 1;
    const release = (): void => {
      this.releaseCalls[index]++;
      result.handle.release();
    };
    return { ok: true, handle: { kind: result.handle.kind, deviceId: result.handle.deviceId, release } };
  }
}

/** Yields `usage` then a `result` at once. */
function immediatePipeline(): Pipeline {
  return {
    async *run(): AsyncIterable<GenerationEvent> {
      yield { type: 'usage', usage: RUN_USAGE };
      yield { type: 'result', app: RESULT_APP };
    },
  };
}

/** Each run emits a `stage` event and then holds until `releaseOne()` lets it finish with
 *  `usage` + `result`, or its signal aborts (it then stops, as a conforming pipeline does). When
 *  `generationId` is set, the run records it on the trace before holding, as a model call would. */
class HeldPipeline implements Pipeline {
  runs = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly generationId?: string) {}

  async *run(_request: GenerateRequest, signal?: AbortSignal, trace?: RunTrace): AsyncIterable<GenerationEvent> {
    this.runs++;
    if (this.generationId) trace?.generationIds.push(this.generationId);
    yield { type: 'stage', stage: 'plan', status: 'start' };
    await this.hold(signal);
    if (signal?.aborted) return;
    yield { type: 'usage', usage: RUN_USAGE };
    yield { type: 'result', app: RESULT_APP };
  }

  releaseOne(): void {
    this.waiting.shift()?.();
  }

  private hold(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      this.waiting.push(resolve);
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
  }
}

/** A non-conforming pipeline that ignores its signal: it holds until `release()`, then emits a
 *  full `usage` + `result` envelope regardless of any abort. */
class SignalIgnoringPipeline implements Pipeline {
  private releaseGate: () => void = () => undefined;
  private readonly gate = new Promise<void>((resolve) => {
    this.releaseGate = resolve;
  });

  async *run(): AsyncIterable<GenerationEvent> {
    yield { type: 'stage', stage: 'plan', status: 'start' };
    await this.gate;
    yield { type: 'usage', usage: RUN_USAGE };
    yield { type: 'result', app: RESULT_APP };
  }

  release(): void {
    this.releaseGate();
  }
}

/** The structural `402` `isCreditExhaustedError` detects, as `OpenRouterCreditError` carries. */
class FakeProviderCreditError extends Error {
  readonly status = 402;
}

/** A credit transport answering `limits` in order (the last one repeats), counting lookups. */
function sequencedCreditTransport(limits: ReadonlyArray<number | null>): { transport: CreditTransport; lookups: () => number } {
  let lookups = 0;
  return {
    lookups: () => lookups,
    transport: {
      async lookupKey(): Promise<CreditLookupResponse> {
        const limit = limits[Math.min(lookups, limits.length - 1)];
        lookups++;
        return { status: 200, bodyText: JSON.stringify({ data: { limit_remaining: limit } }) };
      },
    },
  };
}

/** A stats transport answering fixed records by generation id, counting every fetch. */
function statsTransport(records: Readonly<Record<string, GenerationStats>>): { transport: UsageAndCostTransport; fetches: () => number } {
  let fetches = 0;
  return {
    fetches: () => fetches,
    transport: {
      async fetchStats(generationId: string): Promise<GenerationStats | null> {
        fetches++;
        return records[generationId] ?? null;
      },
    },
  };
}

function modelPolicy(modelClient: ModelClient, timeoutMs = 5000): ContentPolicy {
  return cachedPolicy(new ModelContentPolicy({ modelClient, rewriteModelId: ROSTER.rewrite, categories: 'test category', timeoutMs }));
}


/** A clock whose timers fire only when the test says so. */
class ManualTimerClock implements Clock {
  private readonly timers: Array<() => void> = [];

  now(): number {
    return AT_2200_UTC;
  }

  setTimer(_delayMs: number, onFire: () => void): () => void {
    this.timers.push(onFire);
    return () => {
      const index = this.timers.indexOf(onFire);
      if (index >= 0) this.timers.splice(index, 1);
    };
  }

  fireAll(): void {
    for (const fire of this.timers.splice(0)) fire();
  }
}

// ─── App harness ─────────────────────────────────────────────────────────────

interface HarnessOpts {
  pipeline?: Pipeline;
  config?: Partial<ServerConfig>;
  slots?: SlotController;
  policy?: ContentPolicy;
  creditTransport?: CreditTransport;
  resolveTransport?: UsageAndCostTransport;
  usageStore?: RecordingUsageStore;
}

interface Harness {
  app: ReturnType<typeof createApp>;
  usageStore: RecordingUsageStore;
  slots: SlotSpy;
  inFlight: InFlightGenerations;
  tracker: ResolveTracker;
}

function harness(opts: HarnessOpts = {}): Harness {
  const config: ServerConfig = { ...loadServerConfig({}), now: () => AT_2200_UTC, ...opts.config };
  const usageStore = opts.usageStore ?? new RecordingUsageStore();
  const slots = new SlotSpy(
    opts.slots ??
      createSlotController({ maxConcurrentGenerations: config.maxConcurrentGenerations, maxConcurrentUnary: config.maxConcurrentUnary }),
  );
  const inFlight = new InFlightGenerations();
  const tracker = new ResolveTracker();
  const app = createApp({
    pipeline: opts.pipeline ?? immediatePipeline(),
    usageStore,
    config,
    slots: slots.controller,
    policy: opts.policy,
    creditTransport: opts.creditTransport,
    resolver: { transport: opts.resolveTransport, tracker, bounds: FAST_RESOLVE_BOUNDS },
    inFlight,
  });
  return { app, usageStore, slots, inFlight, tracker };
}

/** Bounded: admission that never answers fails loudly, naming the route, instead of leaving the
 *  suite on a promise only an unref'd timer (a policy timeout, say) could settle. */
async function postJson(app: Harness['app'], route: string, body: unknown, deviceId: string, signal?: AbortSignal): Promise<Response> {
  const res = await within(
    Promise.resolve(
      app.request(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-whim-device': deviceId },
        body: typeof body === 'string' ? body : JSON.stringify(body),
        signal,
      }),
    ),
  );
  if (res === TIMED_OUT) throw new Error(`POST ${route} did not answer within ${WAIT_MS} ms`);
  return res;
}

function postGenerate(app: Harness['app'], body: unknown, deviceId: string, signal?: AbortSignal): Promise<Response> {
  return postJson(app, '/v1/generate', body, deviceId, signal);
}

async function expectRefusal(
  label: string,
  res: Response,
  status: number,
  code: ServiceRefusalCode,
  retryAfter: string | null,
): Promise<void> {
  eq(`${label}: status`, res.status, status);
  check(`${label}: no SSE stream opened`, !(res.headers.get('content-type') ?? '').includes('text/event-stream'));
  const body = ApiError.safeParse(await res.json());
  check(`${label}: body validates as ApiError`, body.success);
  const error = body.success ? body.data.error : undefined;
  check(`${label}: code is in ServiceRefusalCode`, ServiceRefusalCode.safeParse(error).success);
  eq(`${label}: refusal code`, error, code);
  eq(`${label}: Retry-After`, res.headers.get('retry-after'), retryAfter);
}

/** Reads until `needle` appears in the decoded text (or the stream ends). */
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes(needle)) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text;
}

async function readToEnd(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return text;
    text += decoder.decode(chunk.value, { stream: true });
  }
}

function terminalCount(text: string): number {
  return (text.match(/^event: (result|failure)$/gm) ?? []).length;
}

async function readEvents(label: string, res: Response): Promise<GenerationEvent[]> {
  const read = await within(readSseResponse(res));
  check(`${label}: the stream ended`, read !== TIMED_OUT);
  return read === TIMED_OUT ? [] : read.events.map((e) => e.data);
}

// ─── Admission order ─────────────────────────────────────────────────────────

async function testCreditComesFirst(): Promise<void> {
  section('Generate admission: the operator credit check comes before drain, slots and daily units');

  const cases: { label: string; limitGenerationsPerDeviceDay: number; occupy: (slots: SlotController) => unknown }[] = [
    { label: 'credit exhausted + draining', limitGenerationsPerDeviceDay: 15, occupy: (slots) => slots.startDraining() },
    { label: 'credit exhausted + at the generation cap', limitGenerationsPerDeviceDay: 15, occupy: (slots) => slots.acquire('generate', DEVICE_B) },
    { label: 'credit exhausted + daily limit exhausted', limitGenerationsPerDeviceDay: 0, occupy: () => undefined },
  ];
  for (const { label, limitGenerationsPerDeviceDay, occupy } of cases) {
    invalidateCreditCache();
    const inner = createSlotController({ maxConcurrentGenerations: 1, maxConcurrentUnary: 1 });
    occupy(inner);
    const config: Partial<ServerConfig> = { minCreditUsd: 0.5, limitGenerationsPerDeviceDay };
    const classifier = new ScriptedModelClient(ROSTER, []);
    const pipeline = new HeldPipeline();
    const credit = sequencedCreditTransport([0.1]);
    const h = harness({ pipeline, slots: inner, config, creditTransport: credit.transport, policy: modelPolicy(classifier) });

    await expectRefusal(label, await postGenerate(h.app, PROMPT, DEVICE_A), 503, 'budget_exhausted', null);
    eq(`${label}: no slot acquire was attempted`, h.slots.acquires, 0);
    eq(`${label}: no classifier call`, classifier.requests.length, 0);
    eq(`${label}: the pipeline never ran`, pipeline.runs, 0);
    eq(`${label}: no daily unit consumed`, await h.usageStore.generationUnits(AT_2200_UTC), 0);
  }

  // Exhausted credit with room everywhere else is still refused before a slot is taken.
  {
    invalidateCreditCache();
    const credit = sequencedCreditTransport([0.1]);
    const h = harness({ config: { minCreditUsd: 0.5 }, creditTransport: credit.transport });
    await expectRefusal('credit exhausted, caps and allowance free', await postGenerate(h.app, PROMPT, DEVICE_A), 503, 'budget_exhausted', null);
    eq('credit exhausted, caps and allowance free: no slot acquired', h.slots.acquires, 0);
    eq('credit exhausted, caps and allowance free: the generation count stayed 0', h.slots.generations, 0);
  }

  // A key with no limit never refuses.
  {
    invalidateCreditCache();
    const credit = sequencedCreditTransport([null]);
    const h = harness({ creditTransport: credit.transport });
    const res = await postGenerate(h.app, PROMPT, DEVICE_A);
    eq('limit_remaining null → the generation is admitted', res.status, 200);
    await readEvents('limit_remaining null', res);
  }
}

async function testSizeAndValidationComeFirst(): Promise<void> {
  section('Generate admission: size caps and validation refuse before any other check');

  invalidateCreditCache();
  const credit = sequencedCreditTransport([10]);
  const h = harness({ creditTransport: credit.transport });

  await expectRefusal('a 2 MiB body', await postGenerate(h.app, JSON.stringify({ prompt: 'x'.repeat(2 * 1024 * 1024) }), DEVICE_A), 413, 'payload_too_large', null);
  await expectRefusal('a 20 KiB prompt', await postGenerate(h.app, { prompt: 'é'.repeat(10 * 1024) }, DEVICE_A), 413, 'payload_too_large', null);

  const invalid = await postGenerate(h.app, { notPrompt: 'oops' }, DEVICE_A);
  eq('an invalid GenerateRequest → 400', invalid.status, 400);
  check('an invalid GenerateRequest opens no stream', !(invalid.headers.get('content-type') ?? '').includes('text/event-stream'));

  eq('no credit lookup preceded the size and validation refusals', credit.lookups(), 0);
  eq('no slot acquire preceded them', h.slots.acquires, 0);
  eq('no daily unit was consumed', await h.usageStore.generationUnits(AT_2200_UTC), 0);
}

async function testSlotAndUnitOrder(): Promise<void> {
  section('Generate admission: drain, device exclusivity and the cap come before daily units and policy');

  // Draining wins over device exclusivity.
  {
    const pipeline = new HeldPipeline();
    const h = harness({ pipeline });
    eq('setup: device A is generating', (await postGenerate(h.app, PROMPT, DEVICE_A)).status, 200);
    h.slots.controller.startDraining();
    await expectRefusal('draining + device busy', await postGenerate(h.app, PROMPT, DEVICE_A), 429, 'server_busy', null);
    h.inFlight.abortAll();
    check('cleanup: the held generation ended', await waitFor(() => h.slots.generations === 0));
  }

  // A busy device is refused as device_busy, not charged, even with its allowance used up; the
  // first stream is unaffected.
  {
    const classifier = new ScriptedModelClient(ROSTER, [{ role: 'rewrite', deltas: ['{"verdict":"allow"}'] }]);
    const pipeline = new HeldPipeline();
    const h = harness({ pipeline, config: { limitGenerationsPerDeviceDay: 1 }, policy: modelPolicy(classifier) });
    const first = await postGenerate(h.app, PROMPT, DEVICE_A);
    eq('setup: the first generation is admitted', first.status, 200);
    await expectRefusal('a second concurrent generation', await postGenerate(h.app, PROMPT, DEVICE_A), 429, 'device_busy', null);
    eq('the busy device was not charged', await h.usageStore.generationUnits(AT_2200_UTC), 1);
    eq('only the first request reached the classifier', classifier.requests.length, 1);
    pipeline.releaseOne();
    const events = await readEvents('the first stream', first);
    eq('the first stream still ends in its result', events.at(-1)?.type, 'result');
  }

  // The global cap wins over an exhausted device allowance.
  {
    const pipeline = new HeldPipeline();
    const h = harness({ pipeline, config: { maxConcurrentGenerations: 1, limitGenerationsPerDeviceDay: 1 } });
    await h.usageStore.admit({ deviceId: DEVICE_A, kind: 'generate', now: AT_2200_UTC, deviceLimit: 1 });
    eq('setup: device B holds the only generation slot', (await postGenerate(h.app, PROMPT, DEVICE_B)).status, 200);
    await expectRefusal('at the cap + daily limit exhausted', await postGenerate(h.app, PROMPT, DEVICE_A), 429, 'server_busy', null);
    h.inFlight.abortAll();
    check('cleanup: the held generation ended', await waitFor(() => h.slots.generations === 0));
  }

  // The daily unit wins over a policy refusal, and no classifier call is made.
  {
    const classifier = new ScriptedModelClient(ROSTER, []);
    const h = harness({ config: { limitGenerationsPerDeviceDay: 0 }, policy: modelPolicy(classifier) });
    await expectRefusal('daily limit + a prompt the policy would refuse', await postGenerate(h.app, PROMPT, DEVICE_A), 429, 'daily_limit', '7200');
    eq('the daily refusal made no classifier call', classifier.requests.length, 0);
    eq('the daily refusal released its slot', h.slots.generations, 0);
  }
}

// ─── Concurrency cap ─────────────────────────────────────────────────────────

async function testGenerationCap(): Promise<void> {
  section('Generate admission: the global generation cap (specs/server-admission-control "Global concurrency caps")');

  const cap = 3;
  const pipeline = new HeldPipeline();
  const h = harness({ pipeline, config: { maxConcurrentGenerations: cap } });
  const statuses: number[] = [];
  for (let i = 0; i < cap; i++) statuses.push((await postGenerate(h.app, PROMPT, randomUUID())).status);
  check(`cap ${cap}: ${cap} generations from ${cap} devices are admitted`, statuses.every((s) => s === 200), JSON.stringify(statuses));

  const extraDevice = randomUUID();
  await expectRefusal(`cap ${cap}: one more device`, await postGenerate(h.app, PROMPT, extraDevice), 429, 'server_busy', null);
  eq(`cap ${cap}: the refused request consumed no daily unit`, await h.usageStore.generationUnits(AT_2200_UTC), cap);

  pipeline.releaseOne();
  check(`cap ${cap}: a finished generation frees capacity`, await waitFor(() => h.slots.generations === cap - 1));
  eq(`cap ${cap}: the retry is admitted past the cap`, (await postGenerate(h.app, PROMPT, extraDevice)).status, 200);

  h.inFlight.abortAll();
  check(`cap ${cap}: cleanup — every held generation ended`, await waitFor(() => h.slots.generations === 0));
}

// ─── Daily limits and the global ceiling ─────────────────────────────────────

async function testDailyLimitAndCeiling(): Promise<void> {
  section('Generate admission: daily limit, day rollover and the global ceiling');

  // The limit is enforced with a knowable retry time, and the day rolls over.
  {
    let now = AT_2200_UTC;
    const h = harness({ config: { limitGenerationsPerDeviceDay: 1, now: () => now } });
    await readEvents('the day\'s one generation', await postGenerate(h.app, PROMPT, DEVICE_A));
    await expectRefusal('a device over its daily limit at 22:00 UTC', await postGenerate(h.app, PROMPT, DEVICE_A), 429, 'daily_limit', '7200');
    now = Date.UTC(2026, 0, 16, 0, 0, 1);
    const nextDay = await postGenerate(h.app, PROMPT, DEVICE_A);
    eq('00:00:01 UTC the next day → admitted', nextDay.status, 200);
    await readEvents('the next day\'s generation', nextDay);
  }

  // The device limit wins when both it and the ceiling are exhausted.
  {
    const h = harness({ config: { limitGenerationsPerDeviceDay: 1, limitGenerationsPerDay: 1 } });
    await readEvents('the day\'s only generation', await postGenerate(h.app, PROMPT, DEVICE_A));
    await expectRefusal('device limit and ceiling both exhausted', await postGenerate(h.app, PROMPT, DEVICE_A), 429, 'daily_limit', '7200');
  }

  // Rotating device ids does not bypass the ceiling, and the ceiling closes the day for everyone —
  // the same property routes-unary.suite.ts's testUnaryGlobalCeiling tests with a ceiling of 3.
  {
    const h = harness({ config: { limitGenerationsPerDay: 3 } });
    let admitted = 0;
    let unfinished = 0;
    const refusals = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const res = await postGenerate(h.app, PROMPT, randomUUID());
      if (res.status === 200) {
        admitted++;
        if ((await within(readSseResponse(res))) === TIMED_OUT) unfinished++;
      } else {
        const body = (await res.json()) as ApiError;
        refusals.add(`${res.status} ${body.error} ${res.headers.get('retry-after')}`);
      }
    }
    eq('5 fresh device ids against a ceiling of 3 → exactly 3 admitted', admitted, 3);
    eq('every admitted stream ended', unfinished, 0);
    eq('every other request is the ceiling server_busy with Retry-After to midnight', [...refusals], ['429 server_busy 7200']);
  }
}

// ─── Content policy ──────────────────────────────────────────────────────────

async function testPolicyOutcomes(): Promise<void> {
  section('Generate admission: content policy (specs/content-policy, route-level)');

  // A refused generation opens no stream, frees its slot, and keeps its unit.
  {
    const pipeline = new HeldPipeline();
    const h = harness({ pipeline, config: { maxConcurrentGenerations: 1 } });
    await expectRefusal('a policy-refused generation', await postGenerate(h.app, { prompt: '[[refuse]] this' }, DEVICE_A), 422, 'content_policy', null);
    eq('the pipeline was never invoked', pipeline.runs, 0);
    eq('the refusal released its slot exactly once', h.slots.releaseCalls, [1]);
    eq('the ledger row settled as refused', h.usageStore.settlesFor(h.usageStore.admitted[0]).map((s) => s.outcome), ['refused']);
    eq('a policy refusal is not refunded', await h.usageStore.generationUnits(AT_2200_UTC), 1);
    const next = await postGenerate(h.app, PROMPT, DEVICE_A);
    eq('the device\'s next generation is not refused as device_busy', next.status, 200);
    h.inFlight.abortAll();
    check('cleanup: the held generation ended', await waitFor(() => h.slots.generations === 0));
  }

  // An unavailable check refunds the unit and frees the slot.
  {
    const pipeline = new HeldPipeline();
    const h = harness({ pipeline, config: { limitGenerationsPerDeviceDay: 1 } });
    await expectRefusal('a generation whose policy check is down', await postGenerate(h.app, { prompt: '[[policy-down]] please' }, DEVICE_A), 503, 'policy_unavailable', null);
    eq('the pipeline was never invoked', pipeline.runs, 0);
    eq('the unavailable check released its slot', h.slots.generations, 0);
    eq('the unit was refunded', await h.usageStore.generationUnits(AT_2200_UTC), 0);
    const retry = await postGenerate(h.app, PROMPT, DEVICE_A);
    eq('the retry after recovery is admitted, not daily_limit', retry.status, 200);
    h.inFlight.abortAll();
    check('cleanup: the held generation ended', await waitFor(() => h.slots.generations === 0));
  }

  // A classifier timeout is not an allow.
  {
    const classifier = new ControlledModelClient([STALL], 'gen-policy-timeout');
    const pipeline = new HeldPipeline();
    const h = harness({ pipeline, policy: modelPolicy(classifier, 30) });
    await expectRefusal('a classifier that never answers', await postGenerate(h.app, PROMPT, DEVICE_A), 503, 'policy_unavailable', null);
    eq('the pipeline was never invoked', pipeline.runs, 0);
    eq('the device\'s daily count is unchanged', await h.usageStore.generationUnits(AT_2200_UTC), 0);
  }
}

// ─── The stream's single teardown path ──────────────────────────────────────

async function expectTornDown(label: string, h: Harness, outcome: RequestOutcome): Promise<void> {
  check(`${label}: the generation slot is free`, await waitFor(() => h.slots.generations === 0));
  eq(`${label}: the slot was released exactly once`, h.slots.releaseCalls, [1]);
  eq(`${label}: the ledger row settled once, as ${outcome}`, h.usageStore.settlesFor(h.usageStore.admitted[0]).map((s) => s.outcome), [outcome]);
  eq(`${label}: the in-flight registry is empty`, h.inFlight.size, 0);
}

async function testTerminalAndCancel(): Promise<void> {
  section('Generate teardown: terminal event, stream cancel, Request.signal');

  // Terminal.
  {
    const h = harness({ config: { maxConcurrentGenerations: 1 } });
    const events = await readEvents('a delivered run', await postGenerate(h.app, PROMPT, DEVICE_A));
    eq('a delivered run ends in one result', events.filter((e) => e.type === 'result' || e.type === 'failure').length, 1);
    await expectTornDown('terminal', h, 'delivered');
    const next = await postGenerate(h.app, PROMPT, DEVICE_A);
    eq('terminal: the device immediately generates again', next.status, 200);
    await readEvents('the follow-up run', next);
  }

  // Client cancel of the SSE body.
  {
    const pipeline = new HeldPipeline();
    const h = harness({ pipeline });
    const res = await postGenerate(h.app, PROMPT, DEVICE_A);
    const reader = res.body!.getReader();
    check('cancel: a first frame arrived', (await within(readUntil(reader, '\n\n'))) !== TIMED_OUT);
    await reader.cancel();
    await expectTornDown('cancel', h, 'aborted');
    eq('cancel: the device generates again', (await postGenerate(h.app, PROMPT, DEVICE_A)).status, 200);
    h.inFlight.abortAll();
  }

  // Request.signal alone, with the SSE body never cancelled.
  {
    const pipeline = new HeldPipeline();
    const h = harness({ pipeline });
    const client = new AbortController();
    const res = await postGenerate(h.app, PROMPT, DEVICE_A, client.signal);
    const reader = res.body!.getReader();
    check('Request.signal: a first frame arrived', (await within(readUntil(reader, '\n\n'))) !== TIMED_OUT);
    client.abort();
    await expectTornDown('Request.signal', h, 'aborted');
    const rest = await within(readToEnd(reader));
    check('Request.signal: the stream closed with no terminal event', rest !== TIMED_OUT && terminalCount(rest) === 0);
  }
}

async function testAbortSuppressesEvents(): Promise<void> {
  section('Generate stream: at most one terminal event, and none after an abort');

  // A pipeline that ignores its signal still gets nothing forwarded once the request aborted.
  {
    const pipeline = new SignalIgnoringPipeline();
    const h = harness({ pipeline });
    const client = new AbortController();
    const res = await postGenerate(h.app, PROMPT, DEVICE_A, client.signal);
    const reader = res.body!.getReader();
    check('ignored abort: a first frame arrived', (await within(readUntil(reader, '\n\n'))) !== TIMED_OUT);
    client.abort();
    pipeline.release();
    const rest = await within(readToEnd(reader));
    check('ignored abort: no event is forwarded after the abort', rest !== TIMED_OUT && !rest.includes('event: '));
    await expectTornDown('ignored abort', h, 'aborted');
  }

  // A pipeline that emits two terminals gets exactly one through.
  {
    const pipeline: Pipeline = {
      async *run(): AsyncIterable<GenerationEvent> {
        yield { type: 'usage', usage: RUN_USAGE };
        yield { type: 'result', app: RESULT_APP };
        yield { type: 'failure', reason: 'a second terminal', attempts: 1, diagnostics: [] };
      },
    };
    const h = harness({ pipeline });
    const events = await readEvents('two terminals', await postGenerate(h.app, PROMPT, DEVICE_A));
    eq('two terminals from the pipeline → exactly one on the wire', events.filter((e) => e.type === 'result' || e.type === 'failure').length, 1);
    eq('the first terminal is the one delivered', events.at(-1)?.type, 'result');
    await expectTornDown('two terminals', h, 'delivered');
  }
}

async function testTerminalSettlementRecovery(persistent: boolean): Promise<void> {
  const label = persistent ? 'persistent settlement failure' : 'transient settlement failure';
  section(`Generate teardown: ${label}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-generate-settle-'));
  const dbPath = path.join(dir, 'usage.sqlite');
  const sqlite = new NodeSqliteUsageStore(dbPath);
  const usageStore = new RecordingUsageStore(sqlite);
  const settle = usageStore.settle.bind(usageStore);
  let settleCalls = 0;
  usageStore.settle = async (requestId, params) => {
    settleCalls++;
    if (persistent || settleCalls === 1) throw new Error('injected settlement failure');
    await settle(requestId, params);
  };
  const stats = statsTransport({ 'gen-settlement': { usage: RUN_USAGE, totalCostUsd: 0.125 } });
  const pipeline: Pipeline = {
    async *run(_request: GenerateRequest, _signal?: AbortSignal, trace?: RunTrace): AsyncIterable<GenerationEvent> {
      trace?.generationIds.push('gen-settlement');
      yield { type: 'usage', usage: RUN_USAGE };
      yield { type: 'result', app: RESULT_APP };
    },
  };
  const h = harness({ pipeline, usageStore, resolveTransport: stats.transport });
  try {
    const events = await readEvents(label, await postGenerate(h.app, PROMPT, DEVICE_A));
    eq(`${label}: the delivered result remains readable without an extra terminal`, events.map((e) => e.type), ['usage', 'result']);
    eq(`${label}: settlement stops after one retry`, settleCalls, 2);
    eq(`${label}: capacity is released once`, h.slots.releaseCalls, [1]);
    eq(`${label}: no generation remains active`, [h.slots.generations, h.inFlight.size], [0, 0]);
    await drained(label, h.tracker);
    eq(`${label}: provider reconciliation still runs once`, stats.fetches(), 1);
    eq(`${label}: tokens are credited once`, await sqlite.read(DEVICE_A), RUN_USAGE);
    const reader = new DatabaseSync(dbPath);
    try {
      const row = reader.prepare('SELECT ended_at, outcome, prompt_tokens, completion_tokens, cost_state, cost_usd FROM requests').get();
      eq(`${label}: cost resolves and recoverable settlement preserves its original outcome`, { ...row }, {
        ended_at: persistent ? null : AT_2200_UTC,
        outcome: persistent ? null : 'delivered',
        prompt_tokens: persistent ? 0 : RUN_USAGE.promptTokens,
        completion_tokens: persistent ? 0 : RUN_USAGE.completionTokens,
        cost_state: 'resolved',
        cost_usd: 0.125,
      });
    } finally {
      reader.close();
    }
  } finally {
    await h.tracker.drain(WAIT_MS);
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testErrorExpiryAndDrain(): Promise<void> {
  section('Generate teardown: pipeline error, wall-clock expiry, drain abort');

  // A pipeline error.
  {
    const pipeline: Pipeline = {
      async *run(): AsyncIterable<GenerationEvent> {
        yield { type: 'stage', stage: 'plan', status: 'start' };
        throw new Error('pipeline exploded');
      },
    };
    const h = harness({ pipeline });
    const res = await postGenerate(h.app, PROMPT, DEVICE_A);
    check('error: the stream errors', (await within(caught(() => readSseResponse(res).then(() => undefined)))) instanceof Error);
    await expectTornDown('error', h, 'failed');
  }

  // The run's wall-clock budget, on the real machine.
  {
    const model = new ControlledModelClient([STALL], 'gen-expiry');
    const clock = new ManualTimerClock();
    const h = harness({ pipeline: machinePipeline(model, clock, ROSTER) });
    const res = await postGenerate(h.app, PROMPT, DEVICE_A);
    check('expiry: the model call started', await waitFor(() => model.calls.length === 1));
    clock.fireAll();
    const events = await readEvents('expiry', res);
    eq('expiry: the stream ends with usage then one failure', events.slice(-2).map((e) => e.type), ['usage', 'failure']);
    eq('expiry: exactly one terminal event', events.filter((e) => e.type === 'result' || e.type === 'failure').length, 1);
    const last = events.at(-1);
    eq('expiry: the failure says it took too long', last?.type === 'failure' ? last.reason : undefined, EXPIRED_REASON);
    check('expiry: the model transport observed the abort', model.calls[0]?.aborted === true);
    await expectTornDown('expiry', h, 'expired');
  }

  // A drain abort.
  {
    const pipeline = new HeldPipeline();
    const h = harness({ pipeline });
    const res = await postGenerate(h.app, PROMPT, DEVICE_A);
    eq('drain: the generation is registered in flight', h.inFlight.size, 1);
    h.inFlight.abortAll();
    await expectTornDown('drain', h, 'aborted');
    const text = await within(readToEnd(res.body!.getReader()));
    check('drain: the aborted stream carries no terminal event', text !== TIMED_OUT && terminalCount(text) === 0);
  }
}

async function testMidRunCreditExhaustion(): Promise<void> {
  section('Generate: a mid-run 402 ends in one failure and invalidates the credit cache');

  invalidateCreditCache();
  const credit = sequencedCreditTransport([10, 0.1]);
  const model = new ScriptedModelClient(ROSTER, [
    { role: 'engineer', deltas: [], error: new FakeProviderCreditError('insufficient credit') },
  ]);
  const h = harness({ pipeline: machinePipeline(model, new ManualTimerClock(), ROSTER), config: { minCreditUsd: 0.5 }, creditTransport: credit.transport });

  const events = await readEvents('402', await postGenerate(h.app, PROMPT, DEVICE_A));
  const terminals = events.filter((e) => e.type === 'result' || e.type === 'failure');
  eq('402: exactly one terminal event', terminals.length, 1);
  const last = events.at(-1);
  eq('402: it is a failure naming the budget', last?.type === 'failure' ? last.reason : undefined, CREDIT_EXHAUSTED_REASON);
  eq('402: no repair attempt followed', model.requests.length, 1);
  await expectTornDown('402', h, 'failed');

  await expectRefusal('402: the same device immediately generates again', await postGenerate(h.app, PROMPT, DEVICE_A), 503, 'budget_exhausted', null);
  eq('402: the cached credit was invalidated, so the key was looked up again', credit.lookups(), 2);
}

// ─── Cost and token reconciliation ──────────────────────────────────────────

const STATS_USAGE: Usage = { promptTokens: 7, completionTokens: 11, totalTokens: 18 };

function sumUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

async function drained(label: string, tracker: ResolveTracker): Promise<void> {
  await tracker.drain(WAIT_MS);
  eq(`${label}: every resolution finished`, tracker.pendingCount, 0);
}

async function testCostAndReconciliation(): Promise<void> {
  section('Generate: cost resolution and aborted-run reconciliation on the ledger row');

  // A delivered run's three model calls are costed; tokens are credited once, from `usage`.
  {
    const stats = statsTransport({
      'gen-1': { usage: STATS_USAGE, totalCostUsd: 0.012 },
      'gen-2': { usage: STATS_USAGE, totalCostUsd: 0.03 },
      'gen-3': { usage: STATS_USAGE, totalCostUsd: 0.004 },
    });
    const pipeline: Pipeline = {
      async *run(_request: GenerateRequest, _signal?: AbortSignal, trace?: RunTrace): AsyncIterable<GenerationEvent> {
        trace?.generationIds.push('gen-1', 'gen-2', 'gen-3');
        yield { type: 'usage', usage: RUN_USAGE };
        yield { type: 'result', app: RESULT_APP };
      },
    };
    const h = harness({ pipeline, resolveTransport: stats.transport });
    await readEvents('delivered cost', await postGenerate(h.app, PROMPT, DEVICE_A));
    await drained('delivered cost', h.tracker);
    const cost = h.usageStore.costFor(h.usageStore.admitted[0]);
    eq('delivered cost: resolved', cost?.state, 'resolved');
    check('delivered cost: 0.012 + 0.030 + 0.004 = 0.046', Math.abs((cost?.costUsd ?? 0) - 0.046) < 1e-9, JSON.stringify(cost));
    eq('delivered cost: the device was credited exactly once, from the usage event', await h.usageStore.read(DEVICE_A), RUN_USAGE);
  }

  // A run cancelled after an uncached classifier call and one model call: both are costed, the
  // classifier's tokens count once, and the run's tokens are reconciled once.
  {
    const CLASSIFIER_USAGE: Usage = { promptTokens: 3, completionTokens: 2, totalTokens: 5 };
    const classifier = new ScriptedModelClient(ROSTER, [
      { role: 'rewrite', deltas: ['{"verdict":"allow"}'], usage: CLASSIFIER_USAGE, id: 'gen-policy' },
    ]);
    const stats = statsTransport({
      'gen-policy': { usage: CLASSIFIER_USAGE, totalCostUsd: 0.001 },
      'gen-run': { usage: STATS_USAGE, totalCostUsd: 0.02 },
    });
    const pipeline = new HeldPipeline('gen-run');
    const h = harness({ pipeline, policy: modelPolicy(classifier), resolveTransport: stats.transport });
    const res = await postGenerate(h.app, PROMPT, DEVICE_A);
    const reader = res.body!.getReader();
    check('cancelled cost: a first frame arrived', (await within(readUntil(reader, '\n\n'))) !== TIMED_OUT);
    await reader.cancel();
    await expectTornDown('cancelled cost', h, 'aborted');
    await drained('cancelled cost', h.tracker);
    const cost = h.usageStore.costFor(h.usageStore.admitted[0]);
    check('cancelled cost: the classifier and the run call are both costed', cost?.state === 'resolved' && Math.abs((cost.costUsd ?? 0) - 0.021) < 1e-9, JSON.stringify(cost));
    eq('cancelled cost: classifier tokens once + reconciled run tokens once', await h.usageStore.read(DEVICE_A), sumUsage(CLASSIFIER_USAGE, STATS_USAGE));
  }

  // A stream cancelled before any model call credits nothing and asks the provider for nothing.
  {
    const stats = statsTransport({});
    const pipeline = new HeldPipeline();
    const h = harness({ pipeline, resolveTransport: stats.transport });
    const res = await postGenerate(h.app, PROMPT, DEVICE_A);
    const reader = res.body!.getReader();
    check('no model call: a first frame arrived', (await within(readUntil(reader, '\n\n'))) !== TIMED_OUT);
    await reader.cancel();
    await expectTornDown('no model call', h, 'aborted');
    await drained('no model call', h.tracker);
    eq('no model call: no generation-stats request was issued', stats.fetches(), 0);
    eq('no model call: nothing was credited', (await h.usageStore.read(DEVICE_A)).totalTokens, 0);
  }
}

// ─── Server state ────────────────────────────────────────────────────────────

function fileContains(filePath: string, marker: string): boolean {
  return fs.readFileSync(filePath).includes(Buffer.from(marker, 'utf8'));
}

async function testDataDirectoryHoldsOnlyTheTwoStores(): Promise<void> {
  section('specs/generation-server "Nothing but the two stores persists"');

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-datadir-'));
  const markers = {
    clarify: 'MARKER-CLARIFY-5b1f',
    rewrite: 'MARKER-REWRITE-9c2e',
    generate: 'MARKER-GENERATE-3d7a',
    report: 'MARKER-REPORT-8e4c',
  };
  try {
    const usageStore = new NodeSqliteUsageStore(path.join(dataDir, 'usage.db'));
    const reportStore = new NodeSqliteReportStore(path.join(dataDir, 'reports.db'));
    const tracker = new ResolveTracker();
    const rewriteModel = new ScriptedModelClient(ROSTER, [
      {
        role: 'rewrite',
        deltas: [JSON.stringify({ rewrittenPrompt: `a detailed ${markers.rewrite}`, plan: [{ label: 'What it is', text: markers.rewrite }] })],
      },
    ]);
    const app = createApp({
      pipeline: createStubPipeline(0),
      usageStore,
      reportStore,
      model: rewriteModel,
      roster: ROSTER,
      stub: true,
      config: { ...loadServerConfig({}), now: () => AT_2200_UTC },
      resolver: { tracker, bounds: FAST_RESOLVE_BOUNDS },
    });
    const post = (route: string, body: unknown): Promise<Response> => postJson(app, route, body, DEVICE_A);

    eq('clarify with a marker → 200', (await post('/v1/clarify', { prompt: `a tracker ${markers.clarify}` })).status, 200);
    eq('rewrite with a marker → 200', (await post('/v1/rewrite', { prompt: `a tracker ${markers.rewrite}` })).status, 200);
    const generated = await post('/v1/generate', { prompt: `a tracker ${markers.generate}` });
    eq('generate with a marker → 200', generated.status, 200);
    const events = await readEvents('generate with a marker', generated);
    eq('the marker generation delivers exactly one result', events.filter((e) => e.type === 'result' || e.type === 'failure').map((e) => e.type), ['result']);
    const report = {
      reason: 'other',
      note: `${markers.report}-note`,
      appName: `${markers.report}-app`,
      prompt: `${markers.report}-prompt`,
      source: `${markers.report}-source`,
    };
    const reported = await post('/v1/report', report);
    eq('report with markers in every content field → 202', reported.status, 202);
    const { reportId } = await reported.json() as { reportId: string };
    check('the accepted report has an id', typeof reportId === 'string' && reportId.length > 0);
    eq('the stored report preserves every supplied field', await reportStore.get(reportId), {
      reportId,
      receivedAt: AT_2200_UTC,
      deviceId: DEVICE_A,
      ...report,
    });
    await drained('data directory', tracker);
    usageStore.close();
    reportStore.close();

    const entries = fs.readdirSync(dataDir).sort((a, b) => a.localeCompare(b));
    check('the directory holds only the usage and report databases and their sidecars', entries.every((e) => /^(usage|reports)\.db(-wal|-shm)?$/.test(e)), JSON.stringify(entries));
    check('both databases exist', entries.includes('usage.db') && entries.includes('reports.db'), JSON.stringify(entries));
    const usageFiles = entries.filter((e) => e.startsWith('usage.db')).map((e) => path.join(dataDir, e));
    const reportFiles = entries.filter((e) => e.startsWith('reports.db')).map((e) => path.join(dataDir, e));
    for (const [kind, marker] of Object.entries(markers)) {
      check(`the usage database holds no ${kind} marker`, !usageFiles.some((f) => fileContains(f, marker)));
    }
    for (const field of ['note', 'appName', 'prompt', 'source'] as const) {
      check(`the report database holds the ${field} marker`, reportFiles.some((f) => fileContains(f, report[field])));
    }
    for (const kind of ['clarify', 'rewrite', 'generate'] as const) {
      check(`the report database holds no ${kind} marker`, !reportFiles.some((f) => fileContains(f, markers[kind])));
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

/** JSON, or `undefined` when the body is not JSON at all — a plain-text 500, say. */
function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  // eslint-disable-next-line no-restricted-syntax -- intentional: "not JSON" is the answer this helper exists to give
  } catch {
    return undefined;
  }
}

/**
 * The generate twin of `routes-unary.suite.ts`'s store-blip case. `admitGeneration` releases the
 * slot when anything past the acquire throws — it must also settle the ledger row it had already
 * inserted, or a store blip quietly burns one of the device's daily generations and one unit of the
 * global ceiling on a row nothing will ever close. And the client gets this server's one error
 * shape, not Hono's plain-text 500.
 */
async function testThrowingStoreSettlesTheLedgerRow(): Promise<void> {
  section('Generate: a store blip during admission settles its ledger row and answers an ApiError');

  invalidateCreditCache();
  const meteredPolicy: ContentPolicy = {
    async check() {
      return { verdict: 'allow', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } };
    },
  };
  const h = harness({ policy: meteredPolicy });
  h.usageStore.creditFailure = new Error('usage store unavailable');

  const res = await postGenerate(h.app, PROMPT, DEVICE_A);
  eq('the store blip answers 500', res.status, 500);
  // Read defensively: without the app-level handler this body is Hono's plain TEXT 500, and a
  // red-check must fail as an assertion, not as a JSON parse error that aborts the suite.
  const raw = await res.text();
  const body = ApiError.safeParse(parseJsonOrUndefined(raw));
  check('the body is the ApiError shape', body.success, raw.slice(0, 200));
  eq('the error code is internal_error', body.success ? body.data.error : undefined, 'internal_error');
  check('the internal message never reaches the client', !raw.includes('usage store unavailable'), raw.slice(0, 200));

  eq('one daily unit was taken', h.usageStore.admitted.length, 1);
  eq(
    'and its row was settled as an error, not left pending',
    h.usageStore.settlesFor(h.usageStore.admitted[0]).map((s) => s.outcome),
    ['error'],
  );
  eq('the generation slot was released', h.slots.controller.counts().generations, 0);
  eq('the unit is NOT refunded — the classifier call it paid for already happened', await h.usageStore.generationUnits(AT_2200_UTC), 1);
}

export async function runRoutesGenerateTests(): Promise<void> {
  section('Generate route');
  await testCreditComesFirst();
  await testSizeAndValidationComeFirst();
  await testSlotAndUnitOrder();
  await testGenerationCap();
  await testDailyLimitAndCeiling();
  await testPolicyOutcomes();
  await testTerminalAndCancel();
  await testAbortSuppressesEvents();
  await testTerminalSettlementRecovery(false);
  await testTerminalSettlementRecovery(true);
  await testErrorExpiryAndDrain();
  await testMidRunCreditExhaustion();
  await testCostAndReconciliation();
  await testThrowingStoreSettlesTheLedgerRow();
  await testDataDirectoryHoldsOnlyTheTwoStores();
}
