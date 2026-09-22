/**
 * Unary routes (clarify, rewrite) and report route acceptance (public-generation-server chain-9).
 * Scaffolded here by chain-1 (task 2.5, pre-registered in acceptance.ts); chain-9 fills it in —
 * this module is chain-9's alone to edit.
 *
 * Covers `createApp`'s admission wiring on `/v1/clarify`, `/v1/rewrite` and `/v1/report`
 * (specs/server-admission-control "Admission checks run in a fixed order", specs/content-policy,
 * specs/content-reports) and the anonymous `/healthz/sse` probe (specs/server-deployment).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { check, eq, section } from './harness';
import { captureLogs, withMessage } from './log-capture';
import { createApp } from '../src/app';
import { createStubPipeline } from '../src/pipeline';
import {
  InMemoryUsageStore,
  NodeSqliteUsageStore,
  type CostState,
  type RequestOutcome,
  type UsageStore,
} from '../src/usage-store';
import { InMemoryReportStore, type ReportStore } from '../src/reports/store';
import { loadServerConfig, type ServerConfig } from '../src/config';
import { createSlotController, DEFAULT_MAX_CONCURRENT_PROBES, type SlotController } from '../src/admission/slots';
import { invalidateCreditCache, type CreditLookupResponse, type CreditTransport } from '../src/admission/credit';
import { CLASSIFIER_SYSTEM_MARKER, cachedPolicy, ModelContentPolicy, StubContentPolicy, type ContentPolicy } from '../src/policy';
import type { ModelClient, ModelDelta, ModelRoster, ModelStream } from '../src/generation/model';
import { ResolveTracker, type GenerationStats, type UsageAndCostTransport } from '../src/usage/resolve';
import { ScriptedModelClient } from './scripted-model';
import { ApiError, ServiceRefusalCode, type Usage } from '@whim/contract';

const DEVICE_ID = '99999999-9999-4999-8999-999999999999';
const DEVICE_HEADER = { 'x-whim-device': DEVICE_ID };
const OTHER_DEVICE_HEADER = { 'x-whim-device': '88888888-8888-4888-8888-888888888888' };
const ROSTER: ModelRoster = { rewrite: 'vendor/rewrite-1', engineer: 'vendor/engineer-1' };
const FIXED_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
/** Whole seconds from `FIXED_NOW` (noon UTC) to the next 00:00 UTC — every ceiling refusal's
 *  `Retry-After`. */
const SECONDS_TO_UTC_MIDNIGHT = 43_200;

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return { ...loadServerConfig({}), now: () => FIXED_NOW, ...overrides };
}

interface TestAppOpts {
  config?: Partial<ServerConfig>;
  model?: ModelClient;
  policy?: ContentPolicy;
  creditTransport?: CreditTransport;
  slots?: SlotController;
  reportStore?: ReportStore;
  stub?: boolean;
  usageStore?: UsageStore;
  resolver?: { transport?: UsageAndCostTransport; tracker?: ResolveTracker };
  probeFrameIntervalMs?: number;
}

function testApp(opts: TestAppOpts = {}) {
  const usageStore = opts.usageStore ?? new InMemoryUsageStore();
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
    resolver: opts.resolver,
    probeFrameIntervalMs: opts.probeFrameIntervalMs,
  });
  return { app, usageStore, reportStore, config };
}

/** Wraps a real `InMemoryUsageStore`, recording every `credit`/`recordCost` call so a test can
 *  distinguish "credited/recorded once" from "credited/recorded twice with the same eventual sum"
 *  — the exact shape of the classifier-double-credit bug (fix chain 9c). */
class RecordingUsageStore implements UsageStore {
  private readonly inner = new InMemoryUsageStore();
  readonly creditCalls: Usage[] = [];
  readonly recordCostCalls: { requestId: string; state: CostState; costUsd?: number }[] = [];

  credit(deviceId: string, usage: Usage): Promise<void> {
    this.creditCalls.push(usage);
    return this.inner.credit(deviceId, usage);
  }
  read(deviceId: string) {
    return this.inner.read(deviceId);
  }
  admit(params: Parameters<UsageStore['admit']>[0]) {
    return this.inner.admit(params);
  }
  refund(requestId: string) {
    return this.inner.refund(requestId);
  }
  settle(requestId: string, p: Parameters<UsageStore['settle']>[1]) {
    return this.inner.settle(requestId, p);
  }
  recordCost(requestId: string, p: { state: CostState; costUsd?: number }): Promise<void> {
    this.recordCostCalls.push({ requestId, ...p });
    return this.inner.recordCost(requestId, p);
  }
  listUnresolvedCostRows(query: Parameters<UsageStore['listUnresolvedCostRows']>[0]) {
    return this.inner.listUnresolvedCostRows(query);
  }
  summary(params: Parameters<UsageStore['summary']>[0]) {
    return this.inner.summary(params);
  }
  purgeLedger(beforeUtcDay: string) {
    return this.inner.purgeLedger(beforeUtcDay);
  }
}

/** A `UsageAndCostTransport` double keyed by generation id — resolves instantly, so the resolver's
 *  retry loop never engages. */
function statsTransport(byId: Record<string, GenerationStats>): UsageAndCostTransport {
  return {
    async fetchStats(id: string): Promise<GenerationStats | null> {
      return byId[id] ?? null;
    },
  };
}

/** A device header nobody has used before — how a script defeats every per-device limit. */
function freshDeviceHeader(): Record<string, string> {
  return { 'x-whim-device': randomUUID() };
}

/** A store that admits and settles normally but cannot `credit` — the shape of a store blip
 *  inside `admitUnaryRequest`, after the slot was taken and the daily unit consumed. `admitted` and
 *  `settles` expose the ledger rows it opened and closed, so a test can tell "the row was settled"
 *  from "the row was left open forever". */
const STORE_BLIP_MESSAGE = 'usage store unavailable';

interface CreditThrowingStore {
  store: UsageStore;
  admitted: string[];
  settles: { requestId: string; outcome: RequestOutcome }[];
}

function creditThrowingStore(): CreditThrowingStore {
  const inner = new InMemoryUsageStore();
  const admitted: string[] = [];
  const settles: { requestId: string; outcome: RequestOutcome }[] = [];
  const store: UsageStore = {
    credit: () => Promise.reject(new Error(STORE_BLIP_MESSAGE)),
    read: (deviceId) => inner.read(deviceId),
    admit: async (params) => {
      const result = await inner.admit(params);
      if (result.ok) admitted.push(result.requestId);
      return result;
    },
    refund: (requestId) => inner.refund(requestId),
    settle: async (requestId, params) => {
      settles.push({ requestId, outcome: params.outcome });
      await inner.settle(requestId, params);
    },
    recordCost: (requestId, params) => inner.recordCost(requestId, params),
    listUnresolvedCostRows: (query) => inner.listUnresolvedCostRows(query),
    summary: (params) => inner.summary(params),
    purgeLedger: (beforeUtcDay) => inner.purgeLedger(beforeUtcDay),
  };
  return { store, admitted, settles };
}

/** A report insert can fail after its separate daily-unit ledger row was admitted. Keep the
 * recorded settlement visible so the HTTP test can prove the handler did not strand that row. */
function reportInsertFailureStore(): {
  usageStore: UsageStore;
  reportStore: ReportStore;
  admitted: string[];
  settles: { requestId: string; outcome: RequestOutcome }[];
} {
  const inner = new InMemoryUsageStore();
  const admitted: string[] = [];
  const settles: { requestId: string; outcome: RequestOutcome }[] = [];
  const usageStore: UsageStore = {
    credit: (deviceId, usage) => inner.credit(deviceId, usage),
    read: (deviceId) => inner.read(deviceId),
    admit: async (params) => {
      const result = await inner.admit(params);
      if (result.ok) admitted.push(result.requestId);
      return result;
    },
    refund: (requestId) => inner.refund(requestId),
    settle: async (requestId, params) => {
      settles.push({ requestId, outcome: params.outcome });
      await inner.settle(requestId, params);
    },
    recordCost: (requestId, params) => inner.recordCost(requestId, params),
    listUnresolvedCostRows: (query) => inner.listUnresolvedCostRows(query),
    summary: (params) => inner.summary(params),
    purgeLedger: (beforeUtcDay) => inner.purgeLedger(beforeUtcDay),
  };
  const reports = new InMemoryReportStore();
  const reportStore: ReportStore = {
    insert: () => Promise.reject(new Error('report store unavailable')),
    list: (params) => reports.list(params),
    get: (reportId) => reports.get(reportId),
    purgeOlderThan: (beforeMs) => reports.purgeOlderThan(beforeMs),
  };
  return { usageStore, reportStore, admitted, settles };
}

/** The report itself may persist before the usage ledger's normal `ok` settlement throws. The
 * next settlement must close that already-admitted row as `error`. */
function reportOkSettlementFailureStore(): {
  usageStore: UsageStore;
  reportStore: ReportStore;
  settles: { requestId: string; outcome: RequestOutcome }[];
} {
  const inner = new InMemoryUsageStore();
  const settles: { requestId: string; outcome: RequestOutcome }[] = [];
  let failOkSettlement = true;
  const usageStore: UsageStore = {
    credit: (deviceId, usage) => inner.credit(deviceId, usage),
    read: (deviceId) => inner.read(deviceId),
    admit: (params) => inner.admit(params),
    refund: (requestId) => inner.refund(requestId),
    settle: async (requestId, params) => {
      settles.push({ requestId, outcome: params.outcome });
      if (params.outcome === 'ok' && failOkSettlement) {
        failOkSettlement = false;
        throw new Error('usage store unavailable');
      }
      await inner.settle(requestId, params);
    },
    recordCost: (requestId, params) => inner.recordCost(requestId, params),
    listUnresolvedCostRows: (query) => inner.listUnresolvedCostRows(query),
    summary: (params) => inner.summary(params),
    purgeLedger: (beforeUtcDay) => inner.purgeLedger(beforeUtcDay),
  };
  return { usageStore, reportStore: new InMemoryReportStore(), settles };
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

/** The structural shape `isCreditExhaustedError` (`../src/generation/model.ts`) detects — a
 *  `status: 402` error, matching the real `OpenRouterCreditError` (`../src/openrouter.ts`). */
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

/** In-process requests and the stalled model have no socket to keep Node alive while
 *  AbortSignal.timeout's unreferenced timer runs. This independent, referenced deadline
 *  keeps the test alive and fails it if the route never enforces its own timeout. */
async function withRequestDeadline<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Stalled unary request exceeded the 2s test deadline')), 2000);
  });
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
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

/**
 * specs/server-admission-control "Clarify and rewrite share one global daily ceiling". The
 * per-device clarify/rewrite limits bound nothing on their own: a script mints a fresh device UUID
 * per request. Only the shared ceiling stops it, so this drives rotating device ids — against BOTH
 * store implementations, because production runs the SQLite one and its ceiling is a different
 * query from the in-memory one's loop.
 */
async function testUnaryGlobalCeiling(): Promise<void> {
  section('specs/server-admission-control "Clarify and rewrite share one global daily ceiling"');

  const stores: { label: string; store: UsageStore; close?: () => void }[] = [
    { label: 'in-memory store', store: new InMemoryUsageStore() },
  ];
  const sqlite = new NodeSqliteUsageStore(':memory:');
  stores.push({ label: 'sqlite store', store: sqlite, close: () => sqlite.close() });

  for (const { label, store, close } of stores) {
    invalidateCreditCache();
    const { app } = testApp({ usageStore: store, stub: true, config: { limitUnaryPerDay: 3 } });

    const first = await post(app, '/v1/clarify', { prompt: 'hi' }, freshDeviceHeader());
    const second = await post(app, '/v1/rewrite', { prompt: '[[fail]] hi' }, freshDeviceHeader());
    const third = await post(app, '/v1/clarify', { prompt: 'hi' }, freshDeviceHeader());
    eq(
      `${label}: three requests from three fresh devices are admitted under a ceiling of 3`,
      [first.status, second.status, third.status],
      [200, 200, 200],
    );

    const fourth = await post(app, '/v1/clarify', { prompt: 'hi' }, freshDeviceHeader());
    eq(`${label}: a fourth fresh device is refused at the ceiling`, fourth.status, 429);
    const body = (await fourth.json()) as ApiError;
    eq(`${label}: the ceiling refusal code is server_busy`, body.error, 'server_busy');
    check(`${label}: the refusal body validates as ApiError`, ApiError.safeParse(body).success);
    check(`${label}: its code is a ServiceRefusalCode`, ServiceRefusalCode.safeParse(body.error).success);
    eq(
      `${label}: the ceiling refusal carries Retry-After to the next UTC midnight`,
      fourth.headers.get('retry-after'),
      String(SECONDS_TO_UTC_MIDNIGHT),
    );

    // One ceiling for the pair, not one each: rewrite is refused by units clarify consumed.
    const rewriteOver = await post(app, '/v1/rewrite', { prompt: '[[fail]] hi' }, freshDeviceHeader());
    eq(`${label}: the ceiling counts clarify and rewrite together`, rewriteOver.status, 429);

    close?.();
  }
}

/**
 * specs/server-admission-control "A refused, failed, or policy-rejected admission SHALL release any
 * slot it took": every path out of `admitUnaryRequest` past the slot acquire gives back BOTH
 * resources it may have taken — including on a THROW from the usage store, which no refusal path
 * covers. Leak the slot and a single store blip permanently shrinks the unary pool; leave the
 * ledger row `pending` and that blip silently ate one of the device's daily units and one unit of
 * the global ceiling, with nothing that will ever settle the row. The client meanwhile must still
 * get this server's one error shape, not Hono's plain-text 500.
 */
async function testThrowingStoreReleasesTheSlot(): Promise<void> {
  section('A throwing usage store does not leak the unary slot or the ledger row');

  invalidateCreditCache();
  const slots = createSlotController({ maxConcurrentGenerations: 1, maxConcurrentUnary: 1 });
  const meteredPolicy: ContentPolicy = {
    async check() {
      return { verdict: 'allow', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } };
    },
  };
  const blipping = creditThrowingStore();
  const { app } = testApp({ slots, usageStore: blipping.store, policy: meteredPolicy, stub: true });

  const capture = captureLogs();
  let status = 0;
  // Read the body as TEXT: without the app-level error handler it is Hono's plain-text 500, and
  // this test must then fail as an assertion rather than as a JSON parse error mid-suite.
  let raw = '';
  let thrown: unknown;
  try {
    const res = await post(app, '/v1/clarify', { prompt: 'hi' }, DEVICE_HEADER);
    status = res.status;
    raw = await res.text();
  } catch (err) {
    thrown = err;
  } finally {
    capture.stop();
  }

  eq('the store blip answers 500, not 200', status, 500);
  check(`nothing escaped the app (${String(thrown)})`, thrown === undefined);
  const parsed = ApiError.safeParse(parseJsonOrUndefined(raw));
  check('the body is this server\'s ApiError shape', parsed.success, raw.slice(0, 200));
  eq('the error code is internal_error', parsed.success ? parsed.data.error : undefined, 'internal_error');
  check('the internal message never reaches the client', !raw.includes(STORE_BLIP_MESSAGE), raw.slice(0, 200));

  const logged = withMessage(capture, 'unhandled route error');
  eq('exactly one unhandled-error record', logged.length, 1);
  eq('the log carries the REAL error message', logged[0]?.detail, STORE_BLIP_MESSAGE);
  eq('the log names the route that failed', logged[0]?.path, '/v1/clarify');

  eq('the slot count is back to zero', slots.counts().unary, 0);
  eq('the daily unit was taken exactly once', blipping.admitted.length, 1);
  eq(
    'the ledger row it opened was settled, as an error',
    blipping.settles.filter((s) => s.requestId === blipping.admitted[0]).map((s) => s.outcome),
    ['error'],
  );

  // The proof that matters: the pool still admits work afterwards.
  const { app: healthy } = testApp({ slots, stub: true });
  const after = await post(healthy, '/v1/clarify', { prompt: 'hi' }, DEVICE_HEADER);
  eq('the unary pool still admits a later request', after.status, 200);
}

interface RecoveryCase {
  kind: 'clarify' | 'rewrite';
  failure: 'settle' | 'persistent-settle' | 'credit' | 'model';
  stub?: boolean;
  /** How many times cleanup tries `usageStore.settle`. */
  settleCalls: number;
  /** The "could not settle" secondary-failure log, or none. */
  secondaryLog: Array<{ cause: string; detail: string }>;
  /** The original ledger row's ended_at/outcome once cleanup has run. */
  row: { endedAt: number | null; outcome: 'error' | null };
  /** Tokens recorded on that row. */
  recordedTokens: { promptTokens: number; completionTokens: number; totalTokens: number };
  /** The device's usage total after a healthy request following recovery. */
  finalRead: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/** One row per (route, failure, stub) combination — the expected status/row/settle-count/credited
 *  total written out literally, so a failing row can be read without re-deriving the branching
 *  logic that used to compute these from the test's own parameters. */
const RECOVERY_CASES: RecoveryCase[] = (['clarify', 'rewrite'] as const).flatMap((kind) => [
  {
    kind, failure: 'settle',
    settleCalls: 2, secondaryLog: [],
    row: { endedAt: FIXED_NOW, outcome: 'error' },
    recordedTokens: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    finalRead: { promptTokens: 2, completionTokens: 4, totalTokens: 6 },
  },
  {
    kind, failure: 'persistent-settle',
    settleCalls: 2, secondaryLog: [{ cause: STORE_BLIP_MESSAGE, detail: 'secondary settlement failure' }],
    row: { endedAt: null, outcome: null },
    recordedTokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    finalRead: { promptTokens: 2, completionTokens: 4, totalTokens: 6 },
  },
  {
    kind, failure: 'credit',
    settleCalls: 1, secondaryLog: [],
    row: { endedAt: FIXED_NOW, outcome: 'error' },
    recordedTokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    finalRead: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
  },
  {
    kind, failure: 'model',
    settleCalls: 1, secondaryLog: [],
    row: { endedAt: FIXED_NOW, outcome: 'error' },
    recordedTokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    finalRead: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
  },
  {
    kind, failure: 'settle', stub: true,
    settleCalls: 2, secondaryLog: [],
    row: { endedAt: FIXED_NOW, outcome: 'error' },
    recordedTokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    finalRead: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  },
]);

async function testUnaryFailureRecovery(recoveryCase: RecoveryCase): Promise<void> {
  const { kind, failure, stub = false } = recoveryCase;
  invalidateCreditCache();
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'whim-unary-recovery-'));
  const dbPath = nodePath.join(dir, 'usage.sqlite');
  const usageStore = new NodeSqliteUsageStore(dbPath);
  const reader = new DatabaseSync(dbPath);
  const tracker = new ResolveTracker();
  const capture = captureLogs();
  try {
    const settle = usageStore.settle.bind(usageStore);
    let settleCalls = 0;
    usageStore.settle = async (id, params) => {
      settleCalls++;
      if (failure === 'persistent-settle' || (failure === 'settle' && settleCalls === 1)) {
        throw new Error(settleCalls === 1 ? STORE_BLIP_MESSAGE : 'secondary settlement failure');
      }
      await settle(id, params);
    };
    const credit = usageStore.credit.bind(usageStore);
    if (failure === 'credit') usageStore.credit = () => Promise.reject(new Error(STORE_BLIP_MESSAGE));
    const reply = kind === 'clarify' ? { questions: [] } : {
      rewrittenPrompt: 'A counter', plan: [{ label: 'Count', text: 'Show the count' }],
    };
    const usage = { promptTokens: 1, completionTokens: 2, totalTokens: 3 };
    const model = new ScriptedModelClient(ROSTER, [
      { role: 'rewrite', deltas: [JSON.stringify(reply)], usage },
      { role: 'rewrite', deltas: [JSON.stringify(reply)], usage },
    ]);
    const stream = model.stream.bind(model);
    if (failure === 'model') model.stream = () => { throw new Error(STORE_BLIP_MESSAGE); };
    const slots = createSlotController({ maxConcurrentGenerations: 1, maxConcurrentUnary: 1 });
    const { app } = testApp({ usageStore, slots, model, stub, resolver: { tracker } });
    const label = `${kind} (${failure}${stub ? ', stub' : ''})`;
    const body = { prompt: stub ? '[[fail]] counter' : 'counter' };
    const first = await post(app, `/v1/${kind}`, body, DEVICE_HEADER);
    eq(`${label}: unexpected errors remain server errors`, first.status, 500);
    eq(`${label}: capacity is released after the error`, slots.counts().unary, 0);
    eq(`${label}: original error is preserved in the app log`, withMessage(capture, 'unhandled route error').map((r) => r.detail), [STORE_BLIP_MESSAGE]);
    const secondary = withMessage(capture, 'could not settle the ledger row of a failed unary request');
    eq(`${label}: only a failed cleanup is logged separately`, secondary.map((r) => ({ cause: r.cause, detail: r.detail })), recoveryCase.secondaryLog);
    eq(`${label}: cleanup tries settlement exactly once`, settleCalls, recoveryCase.settleCalls);
    const row = reader.prepare('SELECT ended_at, outcome, refunded, prompt_tokens, completion_tokens, prompt_tokens + completion_tokens AS total_tokens FROM requests').get();
    eq(`${label}: recovered store closes the original row without refunding it`, { ...row }, {
      ended_at: recoveryCase.row.endedAt,
      outcome: recoveryCase.row.outcome,
      refunded: 0,
      prompt_tokens: recoveryCase.recordedTokens.promptTokens,
      completion_tokens: recoveryCase.recordedTokens.completionTokens,
      total_tokens: recoveryCase.recordedTokens.totalTokens,
    });
    usageStore.settle = settle;
    usageStore.credit = credit;
    model.stream = stream;
    const second = await post(app, `/v1/${kind}`, body, DEVICE_HEADER);
    eq(`${label}: a healthy request is admitted after recovery`, second.status, 200);
    eq(`${label}: no capacity remains held`, slots.counts().unary, 0);
    eq(`${label}: error cleanup never credits tokens again`, await usageStore.read(DEVICE_ID), recoveryCase.finalRead);
  } finally {
    capture.stop();
    await tracker.drain(2000);
    reader.close();
    usageStore.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testSettlementFailureReleasesCapacity(): Promise<void> {
  section('Unary failures preserve the error, close recoverable ledger rows and free capacity');
  for (const recoveryCase of RECOVERY_CASES) {
    await testUnaryFailureRecovery(recoveryCase);
  }
}

async function testRewriteLedgerEnding(ending: 'single' | 'retry' | 'failed-retry'): Promise<void> {
  const firstUsage = { promptTokens: 11, completionTokens: 7, totalTokens: 18 };
  const retryUsage = { promptTokens: 13, completionTokens: 5, totalTokens: 18 };
  const plan = JSON.stringify({ rewrittenPrompt: 'A counter', plan: [{ label: 'Count', text: 'Show the count' }] });
  invalidateCreditCache();
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'whim-rewrite-ledger-'));
  const dbPath = nodePath.join(dir, 'usage.sqlite');
  const store = new NodeSqliteUsageStore(dbPath);
  const tracker = new ResolveTracker();
  const creditCalls: Usage[] = [];
  const credit = store.credit.bind(store);
  store.credit = (deviceId, usage) => {
    creditCalls.push(usage);
    return credit(deviceId, usage);
  };
  const resolvedIds: string[] = [];
  const stats = statsTransport({
    'rewrite-first': { usage: firstUsage, totalCostUsd: 0.125 },
    'rewrite-retry': { usage: retryUsage, totalCostUsd: 0.25 },
  });
  try {
    const model = new ScriptedModelClient(ROSTER, [
      { role: 'rewrite', deltas: [ending === 'single' ? plan : 'A counter'], usage: firstUsage, id: 'rewrite-first' },
      ...(ending === 'single' ? [] : [{
        role: 'rewrite' as const, deltas: [plan], usage: retryUsage, id: 'rewrite-retry',
        error: ending === 'failed-retry' ? new Error('provider failed') : undefined,
      }]),
    ]);
    const { app } = testApp({ usageStore: store, model, resolver: { tracker, transport: {
      fetchStats(id, signal) {
        resolvedIds.push(id);
        return stats.fetchStats(id, signal);
      },
    } } });
    const response = await post(app, '/v1/rewrite', { prompt: 'counter' }, DEVICE_HEADER);
    eq(`${ending}: expected route status`, response.status, ending === 'failed-retry' ? 502 : 200);
    await tracker.drain(2000);
    const expected = ending !== 'single'
      ? { promptTokens: 24, completionTokens: 12, totalTokens: 36 }
      : firstUsage;
    eq(`${ending}: device usage includes the identified failed retry`, await store.read(DEVICE_ID), expected);
    eq(`${ending}: each attempt is credited once`, creditCalls, ending === 'single' ? [firstUsage] : [firstUsage, retryUsage]);
    const expectedIds = ending === 'single' ? ['rewrite-first'] : ['rewrite-first', 'rewrite-retry'];
    eq(`${ending}: each provider id is fetched once`, resolvedIds.sort((a, b) => a.localeCompare(b)), expectedIds);
    const settledUsage = ending === 'retry' ? expected : firstUsage;
    const reader = new DatabaseSync(dbPath);
    try {
      const rows = reader.prepare('SELECT prompt_tokens, completion_tokens, outcome, cost_state, cost_usd FROM requests WHERE kind = ?').all('rewrite');
      eq(`${ending}: ledger retains in-stream tokens and the complete resolved cost`, rows.map((row) => ({ ...row })), [{
        prompt_tokens: settledUsage.promptTokens,
        completion_tokens: settledUsage.completionTokens,
        outcome: ending === 'failed-retry' ? 'error' : 'ok',
        cost_state: 'resolved',
        cost_usd: ending === 'single' ? 0.125 : 0.375,
      }]);
    } finally {
      reader.close();
    }
  } finally {
    await tracker.drain(2000);
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testRewriteLedgerUsage(): Promise<void> {
  section('Rewrite credits each attempt once and resolves cost even when the retry fails');
  for (const ending of ['single', 'retry', 'failed-retry'] as const) await testRewriteLedgerEnding(ending);
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
  const res = await withRequestDeadline(post(app, '/v1/rewrite', { prompt: 'hi' }, DEVICE_HEADER));
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
  // The classifier's own usage, distinct from any rewrite usage, so crediting it is observable —
  // the rewrite model is never called at all (specs/content-policy "The policy check is metered
  // and observable without content").
  const CLASSIFIER_USAGE: Usage = { promptTokens: 8, completionTokens: 4, totalTokens: 12 };
  const model = new ScriptedModelClient(ROSTER, [
    { role: 'rewrite', deltas: ['{"verdict":"refuse","category":"test"}'], usage: CLASSIFIER_USAGE, id: 'gen-policy-rewrite' },
  ]);
  const policy = cachedPolicy(
    new ModelContentPolicy({ modelClient: model, rewriteModelId: ROSTER.rewrite, categories: 'test category', timeoutMs: 5000 }),
  );
  const { app, usageStore } = testApp({ model, policy });
  const res = await post(app, '/v1/rewrite', { prompt: 'something bad' }, DEVICE_HEADER);
  eq('a policy-refused rewrite → 422', res.status, 422);
  const body = (await res.json()) as ApiError;
  eq('refusal code is content_policy', body.error, 'content_policy');
  eq('exactly one model call recorded (the classifier)', model.requests.length, 1);
  const total = await usageStore.read(DEVICE_ID);
  eq('a refused request still meters the classifier', total, CLASSIFIER_USAGE);
}

function sumUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

async function testCachedVerdictAddsNoClassifierUsage(): Promise<void> {
  section('specs/content-policy "The policy check is metered and observable without content" — cached verdict');

  const CLASSIFIER_USAGE: Usage = { promptTokens: 7, completionTokens: 3, totalTokens: 10 };
  const CLARIFY_USAGE: Usage = { promptTokens: 20, completionTokens: 15, totalTokens: 35 };

  // A cached verdict makes no classifier call, so it adds no further usage to the ledger.
  invalidateCreditCache();
  const model = new ScriptedModelClient(ROSTER, [
    { role: 'rewrite', deltas: ['{"verdict":"allow"}'], usage: CLASSIFIER_USAGE, id: 'gen-policy-cache' },
    { role: 'rewrite', deltas: ['{"questions":[]}'], usage: CLARIFY_USAGE, id: 'gen-clarify-1' },
    { role: 'rewrite', deltas: ['{"questions":[]}'], usage: CLARIFY_USAGE, id: 'gen-clarify-2' },
  ]);
  const policy = cachedPolicy(
    new ModelContentPolicy({ modelClient: model, rewriteModelId: ROSTER.rewrite, categories: 'test category', timeoutMs: 5000 }),
  );
  const { app, usageStore } = testApp({ model, policy });
  const SAME_PROMPT = { prompt: 'the exact same prompt text' };
  const first = await post(app, '/v1/clarify', SAME_PROMPT, DEVICE_HEADER);
  eq('first clarify succeeds', first.status, 200);
  const afterFirst = await usageStore.read(DEVICE_ID);
  eq('first check: classifier + clarify usage', afterFirst, sumUsage(CLASSIFIER_USAGE, CLARIFY_USAGE));

  const second = await post(app, '/v1/clarify', SAME_PROMPT, DEVICE_HEADER);
  eq('second clarify (cached verdict) succeeds', second.status, 200);
  const afterSecond = await usageStore.read(DEVICE_ID);
  eq(
    'the cache hit added no extra classifier usage — only the second clarify call\'s usage',
    afterSecond,
    sumUsage(afterFirst, CLARIFY_USAGE),
  );
  // Classifier calls are identified by their own system message marker — never by the internal
  // token-budget constant (48) that happens to be unique to them today.
  const classifierCalls = model.requests.filter((r) =>
    r.request.messages.some((m) => m.role === 'system' && m.content.includes(CLASSIFIER_SYSTEM_MARKER)),
  );
  eq('exactly one classifier call was ever made', classifierCalls.length, 1);
}

async function testMalformedClassifierVerdictKeepsAccounting(): Promise<void> {
  section('Malformed classifier verdicts fail closed while retaining their metering');

  const classifierUsage: Usage = { promptTokens: 6, completionTokens: 3, totalTokens: 9 };
  const classifierId = 'gen-policy-malformed-unary';
  for (const route of ['clarify', 'rewrite'] as const) {
    invalidateCreditCache();
    const usageStore = new RecordingUsageStore();
    const tracker = new ResolveTracker();
    const model = new ScriptedModelClient(ROSTER, [
      { role: 'rewrite', deltas: ['{"verdict":"maybe"}'], usage: classifierUsage, id: classifierId },
    ]);
    const policy = cachedPolicy(
      new ModelContentPolicy({ modelClient: model, rewriteModelId: ROSTER.rewrite, categories: 'test category', timeoutMs: 5000 }),
    );
    const { app } = testApp({
      model,
      policy,
      usageStore,
      resolver: { tracker, transport: statsTransport({ [classifierId]: { usage: classifierUsage, totalCostUsd: 0.006 } }) },
    });
    const res = await post(app, `/v1/${route}`, { prompt: 'a habit tracker' }, DEVICE_HEADER);
    eq(`${route}: malformed classifier verdict → 503 policy_unavailable`, res.status, 503);
    const body = (await res.json()) as ApiError;
    eq(`${route}: refusal remains policy_unavailable`, body.error, 'policy_unavailable');
    await tracker.drain(2000);
    eq(`${route}: classifier usage is credited despite malformed output`, await usageStore.read(DEVICE_ID), classifierUsage);
    const countByKind = (await usageStore.summary({ days: 1, now: FIXED_NOW })).days[0]?.countByKind;
    eq(`${route}: policy_unavailable still refunds its daily unit`, countByKind?.[route], undefined);
    const resolved = usageStore.recordCostCalls.filter((entry) => entry.state === 'resolved');
    eq(`${route}: classifier cost resolves despite the refunded unit`, resolved.length, 1);
    eq(`${route}: classifier cost amount is retained`, resolved[0]?.costUsd, 0.006);
  }
}

async function testFailedClassifierUsageStillResolvesById(): Promise<void> {
  section('Classifier IDs survive a stream failure before usage');

  const classifierId = 'gen-policy-failed-unary';
  const reconciledUsage: Usage = { promptTokens: 4, completionTokens: 5, totalTokens: 9 };
  for (const route of ['clarify', 'rewrite'] as const) {
    invalidateCreditCache();
    const usageStore = new RecordingUsageStore();
    const tracker = new ResolveTracker();
    const model = new ScriptedModelClient(ROSTER, [
      { role: 'rewrite', deltas: [], error: new Error('classifier connection reset'), id: classifierId },
    ]);
    const policy = cachedPolicy(
      new ModelContentPolicy({ modelClient: model, rewriteModelId: ROSTER.rewrite, categories: 'test category', timeoutMs: 5000 }),
    );
    const { app } = testApp({
      model,
      policy,
      usageStore,
      resolver: { tracker, transport: statsTransport({ [classifierId]: { usage: reconciledUsage, totalCostUsd: 0.007 } }) },
    });
    const res = await post(app, `/v1/${route}`, { prompt: 'a habit tracker' }, DEVICE_HEADER);
    eq(`${route}: classifier stream failure → 503 policy_unavailable`, res.status, 503);
    await tracker.drain(2000);
    eq(`${route}: resolver credits usage from the known classifier id`, await usageStore.read(DEVICE_ID), reconciledUsage);
    const resolved = usageStore.recordCostCalls.filter((entry) => entry.state === 'resolved');
    eq(`${route}: resolver records the known classifier cost`, resolved[0]?.costUsd, 0.007);
  }
}

/**
 * Fix chain 9c: `admitUnaryRequest` credits the classifier's usage the moment `policy.check`
 * returns. On an allow, its generation id is folded into the route's own ids and resolved for cost
 * (`resolveUnaryUsage`, `routes/clarify.ts`) — but NEVER for tokens a second time, on every ending a
 * clarify/rewrite request can reach after that credit already happened: success, a generic model
 * failure, a stalled call that times out, and a mid-call 402. The pre-fix code folded the
 * classifier's id into a single `creditOwned: false` resolve call on every ending except success,
 * so an uncached classifier call's tokens were credited twice (once in-stream, once at resolve).
 */
async function testClassifierCreditedOnceOnUnaryEndings(): Promise<void> {
  section('fix chain 9c: an uncached classifier call is never credited twice on a unary ending');

  const CLASSIFIER_USAGE: Usage = { promptTokens: 5, completionTokens: 2, totalTokens: 7 };
  const CLASSIFIER_COST = 0.001;
  const CLASSIFIER_ID = 'gen-policy-9c';
  const MODEL_USAGE: Usage = { promptTokens: 11, completionTokens: 4, totalTokens: 15 };
  const MODEL_COST = 0.002;
  const MODEL_ID = 'gen-model-9c';
  const FULL_TRANSPORT = statsTransport({
    [CLASSIFIER_ID]: { usage: CLASSIFIER_USAGE, totalCostUsd: CLASSIFIER_COST },
    [MODEL_ID]: { usage: MODEL_USAGE, totalCostUsd: MODEL_COST },
  });
  const CLASSIFIER_ONLY_TRANSPORT = statsTransport({
    [CLASSIFIER_ID]: { usage: CLASSIFIER_USAGE, totalCostUsd: CLASSIFIER_COST },
  });

  /** Asserts the device ended up credited for `expected` tokens exactly once each, and that the
   *  ledger row's one resolved cost record includes `expectedCostUsd`. */
  async function assertResolvedOnce(
    label: string,
    usageStore: RecordingUsageStore,
    tracker: ResolveTracker,
    expected: Usage,
    expectedCostUsd: number,
  ): Promise<void> {
    await tracker.drain(2000);
    const total = await usageStore.read(DEVICE_ID);
    eq(`${label}: tokens credited exactly once each`, total, expected);
    const resolved = usageStore.recordCostCalls.filter((c) => c.state === 'resolved');
    eq(`${label}: exactly one resolved cost record`, resolved.length, 1);
    check(
      `${label}: the resolved cost includes the classifier call`,
      Math.abs((resolved[0]?.costUsd ?? 0) - expectedCostUsd) < 1e-9,
    );
  }

  for (const route of ['clarify', 'rewrite'] as const) {
    const okDelta = route === 'clarify' ? '{"questions":[]}' : JSON.stringify({ rewrittenPrompt: 'a plan', plan: [{ label: 'What', text: 'A plan.' }] });

    // (a) success — both calls credit in-stream; the resolver only ever adds cost.
    {
      invalidateCreditCache();
      const usageStore = new RecordingUsageStore();
      const tracker = new ResolveTracker();
      const model = new ScriptedModelClient(ROSTER, [
        { role: 'rewrite', deltas: ['{"verdict":"allow"}'], usage: CLASSIFIER_USAGE, id: CLASSIFIER_ID },
        { role: 'rewrite', deltas: [okDelta], usage: MODEL_USAGE, id: MODEL_ID },
      ]);
      const policy = cachedPolicy(
        new ModelContentPolicy({ modelClient: model, rewriteModelId: ROSTER.rewrite, categories: 'test category', timeoutMs: 5000 }),
      );
      const { app } = testApp({ model, policy, usageStore, resolver: { transport: FULL_TRANSPORT, tracker } });
      const res = await post(app, `/v1/${route}`, { prompt: 'a habit tracker' }, DEVICE_HEADER);
      eq(`${route} success → 200`, res.status, 200);
      await assertResolvedOnce(`${route} success`, usageStore, tracker, sumUsage(CLASSIFIER_USAGE, MODEL_USAGE), CLASSIFIER_COST + MODEL_COST);
    }

    // (b) a generic model failure after the model call started (its id is known, its usage never
    // arrives).
    {
      invalidateCreditCache();
      const usageStore = new RecordingUsageStore();
      const tracker = new ResolveTracker();
      const model = new ScriptedModelClient(ROSTER, [
        { role: 'rewrite', deltas: ['{"verdict":"allow"}'], usage: CLASSIFIER_USAGE, id: CLASSIFIER_ID },
        { role: 'rewrite', deltas: [], error: new Error('model boom'), id: MODEL_ID },
      ]);
      const policy = cachedPolicy(
        new ModelContentPolicy({ modelClient: model, rewriteModelId: ROSTER.rewrite, categories: 'test category', timeoutMs: 5000 }),
      );
      const { app } = testApp({ model, policy, usageStore, resolver: { transport: FULL_TRANSPORT, tracker } });
      const res = await post(app, `/v1/${route}`, { prompt: 'a habit tracker' }, DEVICE_HEADER);
      eq(`${route} model failure → 502`, res.status, 502);
      await assertResolvedOnce(`${route} model failure`, usageStore, tracker, sumUsage(CLASSIFIER_USAGE, MODEL_USAGE), CLASSIFIER_COST + MODEL_COST);
    }

    // (c) a stalled model call that times out — it never got far enough to have its own id, so
    // only the classifier's own id is at risk of a second credit.
    {
      invalidateCreditCache();
      const usageStore = new RecordingUsageStore();
      const tracker = new ResolveTracker();
      const classifierModel = new ScriptedModelClient(ROSTER, [
        { role: 'rewrite', deltas: ['{"verdict":"allow"}'], usage: CLASSIFIER_USAGE, id: CLASSIFIER_ID },
      ]);
      const policy = cachedPolicy(
        new ModelContentPolicy({ modelClient: classifierModel, rewriteModelId: ROSTER.rewrite, categories: 'test category', timeoutMs: 5000 }),
      );
      const observed = { aborted: false };
      const routeModel = stallingModelClient(observed);
      const { app } = testApp({
        model: routeModel,
        policy,
        usageStore,
        resolver: { transport: CLASSIFIER_ONLY_TRANSPORT, tracker },
        config: { unaryModelTimeoutMs: 40 },
      });
      const res = await withRequestDeadline(post(app, `/v1/${route}`, { prompt: 'a habit tracker' }, DEVICE_HEADER));
      eq(`${route} timeout → 502`, res.status, 502);
      await assertResolvedOnce(`${route} timeout`, usageStore, tracker, CLASSIFIER_USAGE, CLASSIFIER_COST);
    }

    // (d) a mid-call 402 — the model's id is known (the provider had already started), its usage
    // never arrives either.
    {
      invalidateCreditCache();
      const usageStore = new RecordingUsageStore();
      const tracker = new ResolveTracker();
      const model = new ScriptedModelClient(ROSTER, [
        { role: 'rewrite', deltas: ['{"verdict":"allow"}'], usage: CLASSIFIER_USAGE, id: CLASSIFIER_ID },
        { role: 'rewrite', deltas: [], error: new FakeProviderCreditError('insufficient credit'), id: MODEL_ID },
      ]);
      const policy = cachedPolicy(
        new ModelContentPolicy({ modelClient: model, rewriteModelId: ROSTER.rewrite, categories: 'test category', timeoutMs: 5000 }),
      );
      const { app } = testApp({ model, policy, usageStore, resolver: { transport: FULL_TRANSPORT, tracker } });
      const res = await post(app, `/v1/${route}`, { prompt: 'a habit tracker' }, DEVICE_HEADER);
      eq(`${route} mid-call 402 → 503`, res.status, 503);
      await assertResolvedOnce(`${route} mid-call 402`, usageStore, tracker, sumUsage(CLASSIFIER_USAGE, MODEL_USAGE), CLASSIFIER_COST + MODEL_COST);
    }
  }
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

  // Storage can fail after admission. The device gets the normal internal-error response, while
  // the accepted report row must stop consuming daily/global allowance as a forever-pending row.
  {
    const failing = reportInsertFailureStore();
    const { app } = testApp({ usageStore: failing.usageStore, reportStore: failing.reportStore });
    const res = await post(app, '/v1/report', { reason: 'broken' }, DEVICE_HEADER);
    eq('a report store failure → 500', res.status, 500);
    const body = (await res.json()) as ApiError;
    eq('the storage failure remains an internal error', body.error, 'internal_error');
    eq('one report ledger row was admitted', failing.admitted.length, 1);
    eq('the admitted report row settles as error', failing.settles, [{ requestId: failing.admitted[0], outcome: 'error' }]);
    eq('the failed report remains charged to the report daily allowance', (await failing.usageStore.summary({ days: 1, now: FIXED_NOW })).days[0]?.countByKind.report, 1);
  }

  // The report write can succeed before the first `ok` settlement fails. Its fallback settlement
  // must still close the accepted ledger row rather than leaving it pending.
  {
    const failing = reportOkSettlementFailureStore();
    const { app, reportStore } = testApp({ usageStore: failing.usageStore, reportStore: failing.reportStore });
    const res = await post(app, '/v1/report', { reason: 'broken' }, DEVICE_HEADER);
    eq('an ok-settlement failure after report persistence → 500', res.status, 500);
    eq('the report remains stored after the failed settlement', (await reportStore.list({ now: FIXED_NOW })).length, 1);
    eq('the failed ok settlement is followed by error cleanup', failing.settles.map((entry) => entry.outcome), ['ok', 'error']);
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

}

async function testHealthzSse(): Promise<void> {
  section('GET /healthz/sse (specs/server-deployment "An anonymous stream probe verifies proxy flushing")');

  // Three frames, spaced `probeFrameIntervalMs` apart, then close — no device header needed. The
  // production spacing is `PROBE_FRAME_INTERVAL_MS` (one second); the test injects a small value
  // via the app option so the spacing assertion costs milliseconds, not real seconds.
  {
    const intervalMs = 20;
    const { app } = testApp({ probeFrameIntervalMs: intervalMs });
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
    // Three frames means two gaps: a lower bound loose enough not to flake, an upper bound loose
    // enough for CI jitter but tight enough to catch a spacing that silently reverted to a much
    // larger (or absent) interval.
    check(
      `the frames were spaced roughly ${intervalMs}ms apart (~${intervalMs * 2}ms total)`,
      elapsedMs >= intervalMs * 1.8 && elapsedMs < intervalMs * 20,
      `took ${elapsedMs}ms`,
    );
  }

  // Concurrent probes count against the probe's OWN cap, never the paid unary pool — the
  // probe is anonymous and holds its slot for seconds, so sharing the unary pool would let a few
  // anonymous requests per second wedge every device's clarify and rewrite calls.
  {
    invalidateCreditCache();
    const slots = createSlotController({ maxConcurrentGenerations: 1, maxConcurrentUnary: 1 });
    const { app } = testApp({ slots, stub: true });
    const held: Response[] = [];
    for (let i = 0; i < DEFAULT_MAX_CONCURRENT_PROBES; i++) held.push(await app.request('/healthz/sse'));
    check('probes up to the probe cap are admitted', held.every((res) => res.status === 200));

    const over = await app.request('/healthz/sse');
    eq('one probe past the probe cap is refused', over.status, 429);
    const body = (await over.json()) as ApiError;
    eq('refusal code is server_busy', body.error, 'server_busy');

    eq('probes consume no unary slot', slots.counts().unary, 0);
    const clarify = await post(app, '/v1/clarify', { prompt: 'hi' }, DEVICE_HEADER);
    eq('a full probe pool still admits a paid clarify request', clarify.status, 200);

    await Promise.all(held.map((res) => res.body!.cancel()));
    eq('cancelling the probes frees their slots', slots.counts().probes, 0);
  }
}

export async function runRoutesUnaryTests(): Promise<void> {
  await testAdmissionOrder();
  await testUnaryGlobalCeiling();
  await testThrowingStoreReleasesTheSlot();
  await testSettlementFailureReleasesCapacity();
  await testRewriteLedgerUsage();
  await testChunkedBodyCap();
  await testStalledRewriteTimesOut();
  await testRefusedRewriteMakesOnlyTheClassifierCall();
  await testCachedVerdictAddsNoClassifierUsage();
  await testMalformedClassifierVerdictKeepsAccounting();
  await testFailedClassifierUsageStillResolvesById();
  await testClassifierCreditedOnceOnUnaryEndings();
  await testBudgetExhaustedMidCall();
  await testReportRoute();
  await testHealthzSse();
}
