/**
 * Admission core and identity acceptance (public-generation-server chain-3). Scaffolded here by chain-1
 * (task 2.5, pre-registered in acceptance.ts); chain-3 fills it in — this module is
 * chain-3's alone to edit.
 *
 * Covers the route-agnostic primitives: the slot controller (specs/server-admission-control "A device
 * runs at most one generation at a time", "Global concurrency caps protect the server"), the refusal
 * bodies ("Every refusal is a structured, user-facing ApiError"), the device verifier seam
 * (specs/generation-server "Device-identity middleware") and the operator credit check ("The server
 * refuses admission when the operator's provider credit is exhausted"). Route wiring is tested by
 * the route suites.
 */
import { ApiError, DeviceIdError, ServiceRefusalCode } from '@whim/contract';
import { check, eq, section } from './harness';
import { createSlotController, type SlotController, type SlotKind, type SlotRefusalReason } from '../src/admission/slots';
import {
  budgetExhaustedRefusal,
  contentPolicyRefusal,
  dailyLimitRefusal,
  deviceBusyRefusal,
  payloadTooLargeRefusal,
  policyUnavailableRefusal,
  serverBusyCeilingRefusal,
  serverBusyRefusal,
  slotRefusal,
  type ServiceRefusal,
} from '../src/admission/refusals';
import { shapeOnlyVerifier } from '../src/device-identity';
import {
  checkCredit,
  createOpenRouterCreditTransport,
  invalidateCreditCache,
  type CreditLookupResponse,
  type CreditTransport,
} from '../src/admission/credit';

// ---------------------------------------------------------------------------------------------
// Async helpers (local: wave-2 chains must not edit harness.ts)
// ---------------------------------------------------------------------------------------------

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const SETTLE_GUARD_MS = 2000;

/** Awaits `promise` under a ref'd guard timer, so a promise that never settles fails a named check
 *  instead of silently ending the process. */
async function settle<T>(promise: Promise<T>): Promise<{ settled: true; value: T } | { settled: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<{ settled: false }>((resolve) => {
    timer = setTimeout(() => resolve({ settled: false }), SETTLE_GUARD_MS);
  });
  try {
    return await Promise.race([promise.then((value) => ({ settled: true as const, value })), guard]);
  } finally {
    clearTimeout(timer);
  }
}

async function settledValue<T>(name: string, promise: Promise<T>): Promise<T | undefined> {
  const outcome = await settle(promise);
  check(`${name} settles`, outcome.settled, `did not settle within ${SETTLE_GUARD_MS}ms`);
  return outcome.settled ? outcome.value : undefined;
}

// ---------------------------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------------------------

function acquireOk(controller: SlotController, kind: SlotKind, deviceId: string) {
  const result = controller.acquire(kind, deviceId);
  return result.ok ? result.handle : undefined;
}

function refusalOf(controller: SlotController, kind: SlotKind, deviceId: string): SlotRefusalReason | 'admitted' {
  const result = controller.acquire(kind, deviceId);
  if (result.ok) {
    result.handle.release();
    return 'admitted';
  }
  return result.reason;
}

function runSlotBasics(): void {
  const slots = createSlotController({ maxConcurrentGenerations: 3, maxConcurrentUnary: 2 });

  const a = acquireOk(slots, 'generate', 'device-a');
  check('a device with no running generation is admitted', a !== undefined);
  eq('a second concurrent generation from the same device is refused device_busy', refusalOf(slots, 'generate', 'device-a'), 'device_busy');
  eq('a refused acquire takes no slot', slots.counts().generations, 1);
  eq('another device is not affected by device-a being busy', refusalOf(slots, 'generate', 'device-b'), 'admitted');
  eq('a device running a generation can still make a unary call', refusalOf(slots, 'unary', 'device-a'), 'admitted');

  a?.release();
  eq('a finished generation frees the device', refusalOf(slots, 'generate', 'device-a'), 'admitted');
  eq('all slots are free again', slots.counts(), { generations: 0, unary: 0, draining: false });
}

function runGlobalCaps(): void {
  const slots = createSlotController({ maxConcurrentGenerations: 3, maxConcurrentUnary: 2 });
  const running = ['device-1', 'device-2', 'device-3'].map((d) => acquireOk(slots, 'generate', d));
  check('three generations from three devices run under a cap of 3', running.every((h) => h !== undefined));
  eq('a fourth device is refused at the generation cap', refusalOf(slots, 'generate', 'device-4'), 'at_capacity');
  eq('the capacity refusal takes no slot', slots.counts().generations, 3);
  eq('a busy device at the cap is refused device_busy, not at_capacity (order)', refusalOf(slots, 'generate', 'device-1'), 'device_busy');
  eq('unary calls are not bounded by the generation cap', refusalOf(slots, 'unary', 'device-4'), 'admitted');

  running[1]?.release();
  eq('capacity returns when a generation ends', refusalOf(slots, 'generate', 'device-4'), 'admitted');

  const u1 = acquireOk(slots, 'unary', 'device-x');
  const u2 = acquireOk(slots, 'unary', 'device-x');
  check('two unary calls run under a unary cap of 2, even from one device', u1 !== undefined && u2 !== undefined);
  eq('a third unary call is refused at the unary cap', refusalOf(slots, 'unary', 'device-y'), 'at_capacity');
  eq('generations are not bounded by the unary cap', refusalOf(slots, 'generate', 'device-5'), 'admitted');
  u1?.release();
  eq('unary capacity returns when a call ends', refusalOf(slots, 'unary', 'device-y'), 'admitted');

  const wide = createSlotController({ maxConcurrentGenerations: 15, maxConcurrentUnary: 15 });
  const fifteen = Array.from({ length: 15 }, (_, i) => acquireOk(wide, 'generate', `wide-${i}`));
  check('a raised cap of 15 admits 15 devices', fifteen.every((h) => h !== undefined));
  eq('the 16th device is refused at a cap of 15', refusalOf(wide, 'generate', 'wide-15'), 'at_capacity');
  fifteen.forEach((h) => h?.release());
  eq('all 15 slots free after release', wide.counts().generations, 0);

  const invalidCaps = [0, -1, 2.5, Number.NaN];
  check(
    'a non-positive-integer cap is refused at construction',
    invalidCaps.every((cap) => {
      try {
        createSlotController({ maxConcurrentGenerations: cap, maxConcurrentUnary: 2 });
        return false;
      } catch (err) {
        return err instanceof RangeError;
      }
    }),
  );
}

function runIdempotentRelease(): void {
  const slots = createSlotController({ maxConcurrentGenerations: 2, maxConcurrentUnary: 1 });
  const a = acquireOk(slots, 'generate', 'device-a');
  acquireOk(slots, 'generate', 'device-b');
  a?.release();
  a?.release();
  eq('releasing one handle twice frees exactly one generation slot', slots.counts().generations, 1);
  eq('the freed slot is taken by a new device', refusalOf(slots, 'generate', 'device-c'), 'admitted');
  acquireOk(slots, 'generate', 'device-c');
  eq('the double release did not free a second slot', refusalOf(slots, 'generate', 'device-d'), 'at_capacity');

  const mine = createSlotController({ maxConcurrentGenerations: 3, maxConcurrentUnary: 1 });
  const first = acquireOk(mine, 'generate', 'device-a');
  first?.release();
  const second = acquireOk(mine, 'generate', 'device-a');
  first?.release();
  eq("a stale handle's late release does not free the device's newer generation", refusalOf(mine, 'generate', 'device-a'), 'device_busy');
  eq('the newer generation still counts', mine.counts().generations, 1);
  second?.release();

  const u = acquireOk(slots, 'unary', 'device-a');
  u?.release();
  u?.release();
  acquireOk(slots, 'unary', 'device-b');
  eq('releasing a unary handle twice frees exactly one unary slot', refusalOf(slots, 'unary', 'device-c'), 'at_capacity');
}

function runDraining(): void {
  const slots = createSlotController({ maxConcurrentGenerations: 3, maxConcurrentUnary: 3 });
  const held = acquireOk(slots, 'generate', 'device-a');
  const heldUnary = acquireOk(slots, 'unary', 'device-b');
  slots.startDraining();
  check('the controller reports draining', slots.isDraining() && slots.counts().draining);
  eq('a new generation is refused while draining', refusalOf(slots, 'generate', 'device-c'), 'draining');
  eq('a new unary call is refused while draining', refusalOf(slots, 'unary', 'device-c'), 'draining');
  eq('drain state precedes device exclusivity (order)', refusalOf(slots, 'generate', 'device-a'), 'draining');

  held?.release();
  held?.release();
  heldUnary?.release();
  eq('held slots release safely, exactly once, after drain began', slots.counts(), { generations: 0, unary: 0, draining: true });
  eq('draining is one-way: an emptied controller still refuses', refusalOf(slots, 'generate', 'device-a'), 'draining');
}

/** A route-shaped holder: acquire, release from an abort listener AND a `finally`, optionally refuse
 *  after taking the slot — every exit path calls `release()`, sometimes twice. */
async function holdGeneration(
  slots: SlotController,
  deviceId: string,
  work: Promise<void>,
  options: { signal?: AbortSignal; refuseAfterAcquire?: boolean } = {},
): Promise<'done' | 'threw' | 'refused' | SlotRefusalReason> {
  const result = slots.acquire('generate', deviceId);
  if (!result.ok) return result.reason;
  const { handle } = result;
  options.signal?.addEventListener('abort', () => handle.release(), { once: true });
  try {
    if (options.refuseAfterAcquire) {
      handle.release();
      return 'refused';
    }
    return await work.then(
      () => 'done' as const,
      () => 'threw' as const,
    );
  } finally {
    handle.release();
  }
}

async function runExitPaths(): Promise<void> {
  const slots = createSlotController({ maxConcurrentGenerations: 2, maxConcurrentUnary: 1 });

  const success = deferred<void>();
  const successRun = holdGeneration(slots, 'device-ok', success.promise);
  eq('while a generation is held open, the same device is refused device_busy', refusalOf(slots, 'generate', 'device-ok'), 'device_busy');
  success.resolve();
  eq('the held generation completes', await settledValue('success path', successRun), 'done');
  eq('the success path frees the device', refusalOf(slots, 'generate', 'device-ok'), 'admitted');

  const failure = deferred<void>();
  const failureRun = holdGeneration(slots, 'device-throw', failure.promise);
  failure.reject(new Error('pipeline threw'));
  eq('the throwing generation ends', await settledValue('throw path', failureRun), 'threw');
  eq('the throw path frees the device', refusalOf(slots, 'generate', 'device-throw'), 'admitted');
  eq('the throw path leaves no slot held', slots.counts().generations, 0);

  const aborted = new AbortController();
  const abortedWork = deferred<void>();
  const abortedRun = holdGeneration(slots, 'device-abort', abortedWork.promise, { signal: aborted.signal });
  const other = deferred<void>();
  const otherRun = holdGeneration(slots, 'device-other', other.promise);
  aborted.abort();
  eq('an abort frees its slot at once, before the run unwinds', slots.counts().generations, 1);
  const late = deferred<void>();
  const lateRun = holdGeneration(slots, 'device-late', late.promise);
  eq('the freed slot admits a new device', slots.counts().generations, 2);
  abortedWork.resolve();
  eq('the aborted run unwinds', await settledValue('abort path', abortedRun), 'done');
  eq("the aborted run's second release (finally) frees nothing more", slots.counts().generations, 2);
  eq('the cap still binds after the abort path double-released', refusalOf(slots, 'generate', 'device-extra'), 'at_capacity');
  other.resolve();
  late.resolve();
  await settledValue('other run', otherRun);
  await settledValue('late run', lateRun);

  const refusedRun = holdGeneration(slots, 'device-refused', Promise.resolve(), { refuseAfterAcquire: true });
  eq('a refusal after the slot was taken returns the refusal', await settledValue('refusal path', refusedRun), 'refused');
  eq('a refusal after acquisition frees the device (e.g. a policy refusal)', refusalOf(slots, 'generate', 'device-refused'), 'admitted');
  eq('every exit path leaves the controller empty', slots.counts(), { generations: 0, unary: 0, draining: false });
}

// ---------------------------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------------------------

const AT_2200_UTC = Date.UTC(2026, 8, 14, 22, 0, 0);

const DESIGN_HINTS = {
  payload_too_large: 'That request is too long. Try a shorter description.',
  daily_limit: "You've reached today's limit on this device. It resets at midnight UTC.",
  device_busy: 'This device is already building an app. Try again when it finishes.',
  server_busy_capacity: 'Whim is busy right now. Please try again in a few minutes.',
  server_busy_ceiling: "Whim has reached today's building capacity. Please try again after midnight UTC.",
  content_policy: "Whim can't make that kind of app. Try describing something else.",
  policy_unavailable: "We couldn't check this request right now. Please try again in a moment.",
  budget_exhausted: 'Whim has used up its generation budget for now. Try again later.',
};

/** Internal identifiers a user-facing hint must never carry: snake_case or camelCase tokens, env
 *  variable or header names, the provider, numbers (limits, dollar amounts), or a refusal code. */
function internalIdentifierIn(hint: string): string | undefined {
  const patterns: Array<[string, RegExp]> = [
    ['snake_case token', /\b[a-z]+_[a-z_]+\b/i],
    ['camelCase token', /\b[a-z]+[A-Z]\w*\b/],
    ['env variable', /WHIM_|OPENROUTER|API_KEY|NODE_ENV/],
    ['header name', /x-whim/i],
    ['provider name', /openrouter|deepseek|anthropic|openai|gemini|claude|gpt/i],
    ['number or amount', /[\d$]/],
  ];
  const hit = patterns.find(([, re]) => re.test(hint));
  if (hit) return hit[0];
  return ServiceRefusalCode.options.find((code) => hint.includes(code));
}

function runRefusals(): void {
  const clock = () => AT_2200_UTC;
  const cases: Array<{ name: string; refusal: ServiceRefusal; status: number; code: ServiceRefusalCode; hint: string; retryAfter?: string }> = [
    { name: 'payload_too_large', refusal: payloadTooLargeRefusal(), status: 413, code: 'payload_too_large', hint: DESIGN_HINTS.payload_too_large },
    { name: 'daily_limit', refusal: dailyLimitRefusal(clock), status: 429, code: 'daily_limit', hint: DESIGN_HINTS.daily_limit, retryAfter: '7200' },
    { name: 'device_busy', refusal: deviceBusyRefusal(), status: 429, code: 'device_busy', hint: DESIGN_HINTS.device_busy },
    { name: 'server_busy (capacity)', refusal: serverBusyRefusal(), status: 429, code: 'server_busy', hint: DESIGN_HINTS.server_busy_capacity },
    { name: 'server_busy (global ceiling)', refusal: serverBusyCeilingRefusal(clock), status: 429, code: 'server_busy', hint: DESIGN_HINTS.server_busy_ceiling, retryAfter: '7200' },
    { name: 'content_policy', refusal: contentPolicyRefusal(), status: 422, code: 'content_policy', hint: DESIGN_HINTS.content_policy },
    { name: 'policy_unavailable', refusal: policyUnavailableRefusal(), status: 503, code: 'policy_unavailable', hint: DESIGN_HINTS.policy_unavailable },
    { name: 'budget_exhausted', refusal: budgetExhaustedRefusal(), status: 503, code: 'budget_exhausted', hint: DESIGN_HINTS.budget_exhausted },
  ];

  for (const c of cases) {
    const { refusal } = c;
    const api = ApiError.safeParse(refusal.body);
    const code = ServiceRefusalCode.safeParse(refusal.body.error);
    check(`${c.name}: body validates as ApiError with a ServiceRefusalCode`, api.success && code.success && refusal.body.error === c.code);
    eq(`${c.name}: status`, refusal.status, c.status);
    eq(`${c.name}: hint is the design table's user-facing text`, refusal.body.hint, c.hint);
    const leak = internalIdentifierIn(refusal.body.hint);
    check(`${c.name}: hint is free of internal identifiers`, refusal.body.hint.length > 0 && leak === undefined, leak);
    const retryAfterLabel = c.retryAfter ? 'is ' + c.retryAfter + 's at 22:00:00 UTC' : 'is absent';
    eq(`${c.name}: Retry-After ${retryAfterLabel}`, refusal.headers['Retry-After'], c.retryAfter);
  }

  const covered = new Set(cases.map((c) => c.code));
  check('every ServiceRefusalCode has a builder', ServiceRefusalCode.options.every((code) => covered.has(code)));

  const onlyKnowable = [deviceBusyRefusal(), serverBusyRefusal(), dailyLimitRefusal(clock)].map((r) => 'Retry-After' in r.headers);
  eq('of device_busy, concurrency server_busy and daily_limit, only daily_limit carries Retry-After', onlyKnowable, [false, false, true]);

  const midnight = Date.UTC(2026, 8, 15, 0, 0, 0);
  eq('exactly at UTC midnight the next reset is a full day away', dailyLimitRefusal(() => midnight).headers['Retry-After'], '86400');
  eq('a fraction of a second before midnight rounds up to 1s, never 0', dailyLimitRefusal(() => midnight - 1).headers['Retry-After'], '1');
  eq('Retry-After rounds up, so a client never retries early', dailyLimitRefusal(() => AT_2200_UTC + 500).headers['Retry-After'], '7200');

  const fromSlots: Array<[SlotRefusalReason, ServiceRefusal]> = [
    ['device_busy', slotRefusal('device_busy')],
    ['at_capacity', slotRefusal('at_capacity')],
    ['draining', slotRefusal('draining')],
  ];
  eq(
    'slot refusals map to 429 device_busy / server_busy / server_busy with no Retry-After',
    fromSlots.map(([, r]) => [r.status, r.body.error, r.body.hint, Object.keys(r.headers).length]),
    [
      [429, 'device_busy', DESIGN_HINTS.device_busy, 0],
      [429, 'server_busy', DESIGN_HINTS.server_busy_capacity, 0],
      [429, 'server_busy', DESIGN_HINTS.server_busy_capacity, 0],
    ],
  );
}

// ---------------------------------------------------------------------------------------------
// Device verifier
// ---------------------------------------------------------------------------------------------

async function runVerifier(): Promise<void> {
  const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  const missing = await shapeOnlyVerifier.verify(new Headers());
  eq('missing x-whim-device → 400 missing_device_id', missing, {
    ok: false,
    status: 400,
    body: { error: 'missing_device_id', hint: 'Include a UUID in the x-whim-device request header.' },
  });
  check('the missing-header body validates as DeviceIdError and ApiError', !missing.ok && DeviceIdError.safeParse(missing.body).success && ApiError.safeParse(missing.body).success);

  const empty = await shapeOnlyVerifier.verify(new Headers({ 'x-whim-device': '' }));
  check('an empty x-whim-device is treated as missing', !empty.ok && empty.body.error === 'missing_device_id');

  const invalidBody = {
    error: 'invalid_device_id',
    hint: 'The x-whim-device header must be a valid UUID (e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).',
  };
  for (const bad of ['not-a-uuid', `${uuid}0`, `x${uuid}`, '3f2504e0-4f89-41d3-9a0c-0305e82c330g']) {
    const refused = await shapeOnlyVerifier.verify(new Headers({ 'x-whim-device': bad }));
    eq(`malformed x-whim-device "${bad}" → 400 invalid_device_id`, refused, { ok: false, status: 400, body: invalidBody });
  }

  eq('a UUID is verified as the device id', await shapeOnlyVerifier.verify(new Headers({ 'x-whim-device': uuid })), { ok: true, deviceId: uuid });
  const upper = uuid.toUpperCase();
  eq('an upper-case UUID is accepted as today', await shapeOnlyVerifier.verify(new Headers({ 'x-whim-device': upper })), { ok: true, deviceId: upper });
}

// ---------------------------------------------------------------------------------------------
// Operator credit
// ---------------------------------------------------------------------------------------------

const keyBody = (limitRemaining: unknown): string =>
  JSON.stringify({ data: { label: 'sk-or-v1-abc...xyz', limit: 50, usage: 1, limit_remaining: limitRemaining } });

/** Answers every lookup with `next()`; counts calls. */
function answeringTransport(next: () => Promise<CreditLookupResponse>): CreditTransport & { calls: number } {
  const transport = {
    calls: 0,
    lookupKey() {
      transport.calls++;
      return next();
    },
  };
  return transport;
}

/** Holds every lookup open until the test resolves it. */
function heldTransport(): CreditTransport & { held: Array<Deferred<CreditLookupResponse>> } {
  const held: Array<Deferred<CreditLookupResponse>> = [];
  return {
    held,
    lookupKey() {
      const d = deferred<CreditLookupResponse>();
      held.push(d);
      return d.promise;
    },
  };
}

const ok200 = (limitRemaining: unknown): Promise<CreditLookupResponse> => Promise.resolve({ status: 200, bodyText: keyBody(limitRemaining) });

async function runCreditDecisions(): Promise<void> {
  const t0 = AT_2200_UTC;
  let now = t0;
  const clock = () => now;
  const ttlMs = 60_000;
  const floorUsd = 0.5;

  invalidateCreditCache();
  const low = answeringTransport(() => ok200(0.1));
  eq('limit_remaining 0.10 under a 0.50 floor refuses budget_exhausted', await checkCredit({ transport: low, clock, ttlMs, floorUsd }), { ok: false, reason: 'budget_exhausted' });

  invalidateCreditCache();
  const atFloor = answeringTransport(() => ok200(0.5));
  eq('limit_remaining exactly at the floor is not below it', await checkCredit({ transport: atFloor, clock, ttlMs, floorUsd }), { ok: true });

  invalidateCreditCache();
  const unlimited = answeringTransport(() => ok200(null));
  const unlimitedFirst = await checkCredit({ transport: unlimited, clock, ttlMs, floorUsd: 1e9 });
  now = t0 + ttlMs;
  const unlimitedRequeried = await checkCredit({ transport: unlimited, clock, ttlMs, floorUsd: 1e9 });
  eq('a key with no limit (null) never refuses, cached or re-queried', [unlimitedFirst, unlimitedRequeried], [{ ok: true }, { ok: true }]);
  eq('the unlimited key was re-queried after the TTL', unlimited.calls, 2);

  invalidateCreditCache();
  now = t0;
  const plenty = answeringTransport(() => ok200(5));
  const first = await checkCredit({ transport: plenty, clock, ttlMs, floorUsd });
  now = t0 + ttlMs - 1;
  const second = await checkCredit({ transport: plenty, clock, ttlMs, floorUsd });
  eq('two admissions inside the TTL both pass', [first, second], [{ ok: true }, { ok: true }]);
  eq('two admissions inside the TTL query the key endpoint once', plenty.calls, 1);
  now = t0 + ttlMs;
  await checkCredit({ transport: plenty, clock, ttlMs, floorUsd });
  eq('an admission at the TTL boundary re-queries', plenty.calls, 2);

  invalidateCreditCache();
  now = t0;
  let remaining = 0.1;
  const toppedUp = answeringTransport(() => ok200(remaining));
  await checkCredit({ transport: toppedUp, clock, ttlMs, floorUsd });
  remaining = 40;
  now = t0 + 10;
  eq('a cached below-floor value keeps refusing inside the TTL', await checkCredit({ transport: toppedUp, clock, ttlMs, floorUsd }), { ok: false, reason: 'budget_exhausted' });
  eq('the cached refusal made no second lookup', toppedUp.calls, 1);

  invalidateCreditCache();
  now = t0;
  let credit = 5;
  const refilled = answeringTransport(() => ok200(credit));
  await checkCredit({ transport: refilled, clock, ttlMs, floorUsd });
  credit = 0;
  now = t0 + 1;
  invalidateCreditCache();
  eq('after invalidateCreditCache() the next check re-queries inside the TTL and sees the new value', await checkCredit({ transport: refilled, clock, ttlMs, floorUsd }), { ok: false, reason: 'budget_exhausted' });
  eq('invalidation forced exactly one extra lookup', refilled.calls, 2);
}

async function runCreditFailOpen(): Promise<void> {
  const clock = () => AT_2200_UTC;
  const ttlMs = 60_000;
  const floorUsd = 0.5;
  const failures: Array<[string, () => Promise<CreditLookupResponse>, string]> = [
    ['a transport error', () => Promise.reject(new TypeError('fetch failed')), 'transport_error'],
    ['a non-2xx status', () => Promise.resolve({ status: 500, bodyText: keyBody(0) }), 'http_status'],
    ['a 401 whose body would refuse', () => Promise.resolve({ status: 401, bodyText: keyBody(0) }), 'http_status'],
    ['an unparseable body', () => Promise.resolve({ status: 200, bodyText: '<html>bad gateway</html>' }), 'malformed_body'],
    ['a body without limit_remaining', () => Promise.resolve({ status: 200, bodyText: JSON.stringify({ data: { limit: 50 } }) }), 'malformed_body'],
    ['a non-numeric limit_remaining', () => Promise.resolve({ status: 200, bodyText: keyBody('0.10') }), 'malformed_body'],
    ['a non-object body', () => Promise.resolve({ status: 200, bodyText: 'null' }), 'malformed_body'],
  ];
  for (const [name, answer, failure] of failures) {
    invalidateCreditCache();
    const transport = answeringTransport(answer);
    eq(`${name} fails open with its warning flag set`, await checkCredit({ transport, clock, ttlMs, floorUsd }), { ok: true, lookupFailed: failure });
  }

  invalidateCreditCache();
  let broken = true;
  const flaky = answeringTransport(() => (broken ? Promise.reject(new Error('ECONNRESET')) : ok200(0.1)));
  await checkCredit({ transport: flaky, clock, ttlMs, floorUsd });
  broken = false;
  eq('a failed lookup caches nothing: the next check re-queries and can refuse', await checkCredit({ transport: flaky, clock, ttlMs, floorUsd }), { ok: false, reason: 'budget_exhausted' });
  eq('the failed and the retried lookup were two calls', flaky.calls, 2);

  invalidateCreditCache();
  let now = AT_2200_UTC;
  let lookupBroken = false;
  const stale = answeringTransport(() => (lookupBroken ? Promise.reject(new Error('timeout')) : ok200(0.1)));
  await checkCredit({ transport: stale, clock: () => now, ttlMs, floorUsd });
  now += ttlMs;
  lookupBroken = true;
  eq(
    'a failed re-query after expiry fails open rather than reusing the stale below-floor value',
    await checkCredit({ transport: stale, clock: () => now, ttlMs, floorUsd }),
    { ok: true, lookupFailed: 'transport_error' },
  );
}

async function runCreditConcurrency(): Promise<void> {
  const clock = () => AT_2200_UTC;
  const ttlMs = 60_000;
  const floorUsd = 0.5;

  invalidateCreditCache();
  const shared = heldTransport();
  const a = checkCredit({ transport: shared, clock, ttlMs, floorUsd });
  const b = checkCredit({ transport: shared, clock, ttlMs, floorUsd });
  eq('two concurrent checks with an empty cache share one in-flight lookup', shared.held.length, 1);
  shared.held[0]?.resolve({ status: 200, bodyText: keyBody(0.1) });
  eq(
    'both concurrent checks get the shared lookup result',
    [await settledValue('concurrent check a', a), await settledValue('concurrent check b', b)],
    [{ ok: false, reason: 'budget_exhausted' }, { ok: false, reason: 'budget_exhausted' }],
  );

  invalidateCreditCache();
  const raced = heldTransport();
  const before = checkCredit({ transport: raced, clock, ttlMs, floorUsd });
  invalidateCreditCache();
  const after = checkCredit({ transport: raced, clock, ttlMs, floorUsd });
  eq('a check after invalidation does not join the lookup that started before it', raced.held.length, 2);
  raced.held[1]?.resolve({ status: 200, bodyText: keyBody(0.1) });
  eq('the post-invalidation check sees its own lookup', await settledValue('post-invalidation check', after), { ok: false, reason: 'budget_exhausted' });
  raced.held[0]?.resolve({ status: 200, bodyText: keyBody(100) });
  eq('the pre-invalidation check still settles with its own lookup', await settledValue('pre-invalidation check', before), { ok: true });
  eq(
    'a lookup that started before invalidation cannot overwrite the newer cached value when it lands late',
    await settledValue('check after the late landing', checkCredit({ transport: raced, clock, ttlMs, floorUsd })),
    { ok: false, reason: 'budget_exhausted' },
  );
  eq('that last check was served from the cache', raced.held.length, 2);
  invalidateCreditCache();
}

async function runCreditTransport(): Promise<void> {
  const clock = () => AT_2200_UTC;
  const requests: Array<{ url: string; method: string | undefined; authorization: string | null; hasSignal: boolean }> = [];
  let status = 200;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method,
      authorization: new Headers(init?.headers).get('authorization'),
      hasSignal: init?.signal instanceof AbortSignal,
    });
    return new Response(keyBody(12.5), { status });
  }) as typeof globalThis.fetch;

  invalidateCreditCache();
  const transport = createOpenRouterCreditTransport({ apiKey: 'sk-test-key', fetchFn });
  eq('the real transport admits on a healthy key', await checkCredit({ transport, clock, ttlMs: 60_000, floorUsd: 0.5 }), { ok: true });
  eq('it queries GET https://openrouter.ai/api/v1/key with the operator key, under a signal', requests, [
    { url: 'https://openrouter.ai/api/v1/key', method: 'GET', authorization: 'Bearer sk-test-key', hasSignal: true },
  ]);

  invalidateCreditCache();
  status = 402;
  eq('a non-2xx from the real transport fails open', await checkCredit({ transport, clock, ttlMs: 60_000, floorUsd: 0.5 }), { ok: true, lookupFailed: 'http_status' });

  invalidateCreditCache();
  const hanging = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })) as typeof globalThis.fetch;
  const bounded = createOpenRouterCreditTransport({ apiKey: 'sk-test-key', fetchFn: hanging, timeoutMs: 20 });
  eq(
    'a hanging key endpoint is cut off by the lookup timeout and fails open',
    await settledValue('hanging lookup', checkCredit({ transport: bounded, clock, ttlMs: 60_000, floorUsd: 0.5 })),
    { ok: true, lookupFailed: 'transport_error' },
  );
  invalidateCreditCache();
}

export async function runAdmissionTests(): Promise<void> {
  section('Admission core and identity');

  section('  slots');
  runSlotBasics();
  runGlobalCaps();
  runIdempotentRelease();
  runDraining();
  await runExitPaths();

  section('  refusals');
  runRefusals();

  section('  device verifier');
  await runVerifier();

  section('  operator credit');
  await runCreditDecisions();
  await runCreditFailOpen();
  await runCreditConcurrency();
  await runCreditTransport();
}
