/**
 * POST /v1/generate — validates GenerateRequest, admits it, and streams SSE events from the
 * injected pipeline.
 *
 * Admission (design D6a/D8; specs/server-admission-control "Admission checks run in a fixed
 * order"): raw body cap, body validation, prompt byte cap, operator credit, then one slot acquire
 * (drain, device exclusivity, global generation cap), the daily units with the global ceiling, and
 * the content policy check — all before the stream opens. Every refusal after a resource was taken
 * gives it back first.
 *
 * The line (beta-1 D8, specs/server-admission-control "A generation that finds every slot busy
 * waits in line on its stream"): when every slot is busy the acquire joins the controller's line
 * instead, refusing `server_busy` only once the line is full. A generation in line has its daily
 * unit CONFIRMED, not spent, and no ledger row: the unit is spent, and the row inserted, only when
 * it gets a slot. It waits on its open stream, which carries `queued{position}` on entry, on every
 * move and at least every `QUEUED_HEARTBEAT_MS`. Waiting `queueMaxWaitMs`, a drain, or a global
 * ceiling reached by the time the slot arrives ends the stream with one terminal `failure`; a client
 * abort ends it with none. None of these leaves a slot held, a unit spent or a ledger row.
 *
 * Once admitted, the stream has ONE teardown path: the end of the event source's iteration. A
 * terminal event, a client cancel of the SSE body, the request's own `Request.signal`, a pipeline
 * error, the run's wall-clock expiry, a drain abort (`InFlightGenerations.abortAll`) and the
 * machine's `402` ending all finish there, after the pipeline has actually stopped. The teardown
 * releases the generation slot, settles the ledger row from `RunTrace.outcome`, and hands every
 * recorded generation id to the resolver. `usage` stays credited in-stream before the terminal
 * event; the resolver credits reconciled tokens only for a run whose `usage` was never credited
 * (`creditOwned`), so no run is counted twice.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { GenerateRequest, GenerationEvent, type ApiError, type Usage } from '@whim/contract';
import type { Pipeline } from '../pipeline';
import type { AdmitResult, FailureReason, RequestOutcome, UsageStore } from '../usage-store';
import type { RunTrace } from '../generation/machine';
import type { ServerConfig } from '../config';
import type { LineOutcome, LineTicket, SlotController, SlotHandle } from '../admission/slots';
import { checkCredit, type CreditTransport } from '../admission/credit';
import {
  budgetExhaustedRefusal,
  contentPolicyRefusal,
  dailyLimitRefusal,
  payloadTooLargeRefusal,
  policyUnavailableRefusal,
  serverBusyCeilingRefusal,
  serverBusyRefusal,
  slotRefusal,
  type ServiceRefusal,
} from '../admission/refusals';
import { PolicyUnavailableError, type ContentPolicy, type PolicyCheckResult } from '../policy/policy';
import { buildGeneratePolicyInput } from '../policy/input';
import {
  resolveRequestUsage,
  type ResolveBounds,
  type ResolveDeps,
  type ResolveTracker,
  type UsageAndCostTransport,
} from '../usage/resolve';
import { buildSseStream } from '../sse';
import { eventForLevel, type WireEvent } from '../wire-level';
import type { ServerLogger } from '../logger';
import { envelopeLogFields, type V1Env } from '../request-edge';
import { consentPractice } from '../consent-practices';

/** `Pipeline.run` (`../pipeline.ts`) stays unchanged (design D1) — a real implementation MAY
 *  accept an optional third `trace` out-parameter (design D9) without it being part of that
 *  shared interface; a stub that ignores the extra argument stays conforming at runtime. This
 *  route always passes one, widening the call type locally rather than editing `pipeline.ts`. */
type PipelineRun = (request: GenerateRequest, signal?: AbortSignal, trace?: RunTrace) => AsyncIterable<GenerationEvent>;

/**
 * The generation streams still running, by abort handle — the hook a drain uses to end the
 * generations still in flight once its wait runs out. An aborted stream still ends through its own
 * teardown, so its slot is released and its ledger row settled there, never here.
 */
export class InFlightGenerations {
  private readonly aborts = new Set<() => void>();

  /** Streams admitted whose teardown has not run yet. */
  get size(): number {
    return this.aborts.size;
  }

  /** Aborts every in-flight generation exactly as a client disconnect would. */
  abortAll(): void {
    for (const abort of [...this.aborts]) abort();
  }

  /** Registers one stream's abort; the returned function unregisters it. */
  track(abort: () => void): () => void {
    this.aborts.add(abort);
    return () => {
      this.aborts.delete(abort);
    };
  }
}

/** A generation waiting in line hears its place at least this often (beta-1 D8). */
const QUEUED_HEARTBEAT_MS = 5000;

/** The line's time source: the `queued` cadence, the longest wait, and the waited time it logs. */
export interface LineClock {
  now(): number;
  /** Arms a one-shot timer and returns its disarm function. */
  setTimer(delayMs: number, onFire: () => void): () => void;
}

const HOST_LINE_CLOCK: LineClock = {
  now: () => performance.now(),
  setTimer(delayMs, onFire) {
    const timer = setTimeout(onFire, delayMs);
    return () => clearTimeout(timer);
  },
};

export interface GenerateRouteOptions {
  keepaliveMs?: number;
  config: ServerConfig;
  clock: () => number;
  slots: SlotController;
  /** Already wrapped in `cachedPolicy` by the caller (`handoff/content-policy.md`). */
  policy: ContentPolicy;
  /** Absent ⇒ the operator-credit check is skipped (`handoff/app-options.md`). */
  creditTransport: CreditTransport | undefined;
  resolveTracker: ResolveTracker;
  resolveTransport: UsageAndCostTransport;
  resolveBounds: Partial<ResolveBounds> | undefined;
  inFlight: InFlightGenerations;
  /** The line's timers; the host's own when omitted. */
  lineClock?: LineClock;
}

interface AdmissionDeps extends GenerateRouteOptions {
  /** The request's id (`x-whim-request-id`) — the ledger row admission inserts takes it. */
  requestId: string;
  /** The request-scoped logger, bound to `requestId`. */
  log: ServerLogger;
  deviceId: string;
  request: GenerateRequest;
  usageStore: UsageStore;
  signal: AbortSignal;
}

/** A generation holding its slot, its daily unit and its ledger row. */
interface RunningGeneration {
  requestId: string;
  handle: SlotHandle;
  /** The classifier call's provider generation id, when the check actually called the model. */
  policyGenerationId: string | undefined;
}

/** A generation admitted to wait in line: its daily unit is confirmed but not spent, and it has no
 *  ledger row until it gets a slot. */
interface WaitingGeneration {
  ticket: LineTicket;
  policyGenerationId: string | undefined;
}

type AdmittedGeneration = { kind: 'running'; running: RunningGeneration } | { kind: 'waiting'; waiting: WaitingGeneration };

type Admission = { ok: true; admitted: AdmittedGeneration } | { ok: false; refusal: ServiceRefusal };

export function makeGenerateRoute(pipeline: Pipeline, usageStore: UsageStore, options: GenerateRouteOptions): Hono<V1Env> {
  const app = new Hono<V1Env>();
  const { config } = options;

  app.post(
    '/',
    consentPractice('request-material', 'required'),
    bodyLimit({
      maxSize: config.maxBodyBytesGenerate,
      onError: (c) => {
        const r = payloadTooLargeRefusal();
        return c.json(r.body, r.status, r.headers);
      },
    }),
    async (c) => {
      // Request logging: the stream's own body only finishes once it settles
      // (close/error/cancel) — the outer app-level middleware (`app.ts`) returns from `next()` as
      // soon as headers are sent, well before that, so this route logs itself exactly once, from
      // `buildSseStream`'s `onSettled` hook below, instead.
      const requestStart = performance.now();
      const method = c.req.method;
      const path = c.req.path;
      const deviceId = c.get('deviceId');
      const requestId = c.get('requestId');
      const requestLog = c.get('log');
      const envelopeFields = envelopeLogFields(c.get('envelope'));

      const body = await c.req.json().catch(() => null);
      const parsed = GenerateRequest.safeParse(body);
      if (!parsed.success) {
        return c.json(
          { error: 'invalid_request', hint: parsed.error.issues[0]?.message ?? 'Invalid request body' } satisfies ApiError,
          400,
        );
      }

      if (Buffer.byteLength(parsed.data.prompt, 'utf8') > config.maxPromptBytes) {
        const r = payloadTooLargeRefusal();
        return c.json(r.body, r.status, r.headers);
      }

      const requestSignal = c.req.raw.signal;
      const admission = await admitGeneration({
        ...options,
        requestId,
        log: requestLog,
        deviceId,
        request: parsed.data,
        usageStore,
        signal: requestSignal,
      });
      if (!admission.ok) {
        const r = admission.refusal;
        return c.json(r.body, r.status, r.headers);
      }

      const stream = openGenerationStream({
        ...options,
        pipeline,
        usageStore,
        log: requestLog,
        requestId,
        protocolLevel: c.get('protocolLevel'),
        deviceId,
        request: parsed.data,
        requestSignal,
        admitted: admission.admitted,
        onSettled: () => {
          // Status is always 200 here: the SSE response's headers are already committed by the
          // time this fires, whether the stream drained normally, errored mid-stream, or was
          // cancelled.
          requestLog.info(
            {
              scope: 'request',
              method,
              path,
              status: 200,
              durationMs: Math.round(performance.now() - requestStart),
              ...envelopeFields,
            },
            'request',
          );
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        },
      });
    },
  );

  return app;
}

/** Operator credit, then the slot. Anything thrown after the slot was taken gives it back before
 *  the error propagates; `release()` is idempotent, so a refusal that already released is fine. */
async function admitGeneration(deps: AdmissionDeps): Promise<Admission> {
  const { creditTransport, config, clock, slots, deviceId } = deps;

  if (creditTransport) {
    const credit = await checkCredit({ transport: creditTransport, clock, ttlMs: config.creditCacheTtlMs, floorUsd: config.minCreditUsd });
    if (!credit.ok) return { ok: false, refusal: budgetExhaustedRefusal() };
    if (credit.lookupFailed) {
      deps.log.warn({ lookupFailed: credit.lookupFailed, route: 'generate' }, 'operator credit lookup failed open');
    }
  }

  const entry = slots.acquireInLine(deviceId);
  if (entry.kind === 'refused') return { ok: false, refusal: slotRefusal(entry.reason) };
  if (entry.kind === 'line') {
    try {
      return await admitIntoLine(entry.ticket, deps);
    } catch (err) {
      // No ledger row exists yet, so leaving the line (which also gives back a slot handed over
      // meanwhile) is all there is to undo.
      entry.ticket.leave();
      throw err;
    }
  }
  const acquired = entry;
  let admittedRequestId: string | undefined;
  try {
    return await admitWithSlot(acquired.handle, deps, (requestId) => {
      admittedRequestId = requestId;
    });
  } catch (err) {
    // The ledger row goes back too, not just the slot: a row left `pending` by a throwing store
    // keeps consuming the device's daily allowance and the global ceiling with nothing to show for
    // it, and nothing ever settles it. The unit is deliberately NOT refunded — see
    // `routes/clarify.ts`'s `settleFailedAdmission`, whose reasoning this mirrors. The slot is
    // released first: nothing in `settleFailedAdmission` needs it held, and gating slot release on
    // the very store that just failed would hold the slot open for however long that settle takes.
    acquired.handle.release();
    if (admittedRequestId !== undefined) {
      await settleFailedAdmission(deps.usageStore, admittedRequestId, clock, err, deps.log);
    }
    throw err;
  }
}

/** Closes the ledger row of an admission that threw past the daily-unit insert (the twin of
 *  `routes/clarify.ts`'s helper of the same name — same rule: no refund, and a `settle` that throws
 *  in turn is logged, never raised over the original error). `requestLog` is bound to the request
 *  id, which is also the row's id. */
async function settleFailedAdmission(
  usageStore: UsageStore,
  requestId: string,
  clock: () => number,
  cause: unknown,
  requestLog: ServerLogger,
): Promise<void> {
  try {
    await usageStore.settle(requestId, { outcome: 'error', failureReason: 'internal_error', now: clock() });
  } catch (settleErr) {
    requestLog.error(
      {
        detail: settleErr instanceof Error ? settleErr.message : String(settleErr),
        cause: cause instanceof Error ? cause.message : String(cause),
      },
      'could not settle the ledger row of a failed admission',
    );
  }
}

/** The daily unit (device limit, then the global ceiling), then the content policy. `onAdmitted`
 *  reports the ledger row the moment it exists, so a throw past it can still be settled. */
async function admitWithSlot(
  handle: SlotHandle,
  deps: AdmissionDeps,
  onAdmitted: (requestId: string) => void,
): Promise<Admission> {
  const { usageStore, config, clock, deviceId } = deps;

  const unit = await usageStore.admit({
    requestId: deps.requestId,
    deviceId,
    kind: 'generate',
    now: clock(),
    deviceLimit: config.limitGenerationsPerDeviceDay,
    globalLimit: config.limitGenerationsPerDay,
  });
  if (!unit.ok) {
    handle.release();
    return { ok: false, refusal: unitRefusal(unit.reason, clock) };
  }
  const { requestId } = unit;
  onAdmitted(requestId);

  const { checked, unavailable } = await checkPolicy(deps);
  if (!checked) {
    if (unavailable?.usage) await usageStore.credit(deviceId, unavailable.usage);
    await usageStore.settle(requestId, { outcome: 'unavailable', failureReason: 'policy_unavailable', usage: unavailable?.usage, now: clock() });
    await usageStore.refund(requestId);
    handle.release();
    const ids = unavailable?.generationId ? [unavailable.generationId] : [];
    deps.resolveTracker.track(resolveRequestUsage(requestId, deviceId, ids, unavailable?.usage !== undefined, resolveDeps(deps)));
    return { ok: false, refusal: policyUnavailableRefusal() };
  }

  // The classifier call happened either way, so its usage is the device's the moment it returns.
  if (checked.usage) await usageStore.credit(deviceId, checked.usage);

  if (checked.verdict !== 'allow') {
    await usageStore.settle(requestId, { outcome: 'refused', failureReason: 'content_policy', usage: checked.usage, now: clock() });
    handle.release();
    const ids = checked.generationId ? [checked.generationId] : [];
    deps.resolveTracker.track(resolveRequestUsage(requestId, deviceId, ids, true, resolveDeps(deps)));
    return { ok: false, refusal: contentPolicyRefusal() };
  }

  return { ok: true, admitted: { kind: 'running', running: { requestId, handle, policyGenerationId: checked.generationId } } };
}

/**
 * `admitWithSlot` for a generation in line: the daily unit is confirmed without being spent, then
 * the content policy runs, all with no ledger row — the row, and the unit with it, come only once
 * the generation gets a slot. Every refusal leaves the line, which also gives back a slot handed
 * over meanwhile. The classifier's tokens are the device's either way; with no row, its cost has
 * nowhere to land.
 */
async function admitIntoLine(ticket: LineTicket, deps: AdmissionDeps): Promise<Admission> {
  const { usageStore, config, clock, deviceId } = deps;

  const unit = await usageStore.unitAvailable({
    deviceId,
    kind: 'generate',
    now: clock(),
    deviceLimit: config.limitGenerationsPerDeviceDay,
    globalLimit: config.limitGenerationsPerDay,
  });
  if (!unit.ok) {
    ticket.leave();
    return { ok: false, refusal: unitRefusal(unit.reason, clock) };
  }

  const { checked, unavailable } = await checkPolicy(deps);
  if (!checked) {
    if (unavailable?.usage) await usageStore.credit(deviceId, unavailable.usage);
    ticket.leave();
    // requestId '' is the resolver's no-ledger sentinel: tokens only, for a call whose usage never arrived.
    if (unavailable?.generationId) {
      deps.resolveTracker.track(resolveRequestUsage('', deviceId, [unavailable.generationId], unavailable.usage !== undefined, resolveDeps(deps)));
    }
    return { ok: false, refusal: policyUnavailableRefusal() };
  }
  if (checked.usage) await usageStore.credit(deviceId, checked.usage);
  if (checked.verdict !== 'allow') {
    ticket.leave();
    return { ok: false, refusal: contentPolicyRefusal() };
  }
  return { ok: true, admitted: { kind: 'waiting', waiting: { ticket, policyGenerationId: checked.generationId } } };
}

/** The content policy's verdict, or `checked: undefined` when there is none. Any failure to produce
 *  a verdict is `policy_unavailable` (specs/content-policy "The policy check fails closed");
 *  `cachedPolicy` has already logged it as `unavailable`. */
async function checkPolicy(deps: AdmissionDeps): Promise<{ checked: PolicyCheckResult | undefined; unavailable: PolicyUnavailableError | undefined }> {
  let unavailable: PolicyUnavailableError | undefined;
  const checked = await deps.policy.check(buildGeneratePolicyInput(deps.request), 'generate', deps.signal, deps.log).then(
    (result): PolicyCheckResult | undefined => result,
    (err): undefined => {
      unavailable = err instanceof PolicyUnavailableError ? err : undefined;
      return undefined;
    },
  );
  return { checked, unavailable };
}

/** The refusal for a daily unit that is not there: the device's own limit, or the global ceiling. */
function unitRefusal(reason: 'device' | 'global', clock: () => number): ServiceRefusal {
  return reason === 'device' ? dailyLimitRefusal(clock) : serverBusyCeilingRefusal(clock);
}

interface StreamDeps extends GenerateRouteOptions {
  pipeline: Pipeline;
  usageStore: UsageStore;
  log: ServerLogger;
  /** The request's id: a generation that waited in line inserts its ledger row under it. */
  requestId: string;
  /** The client's protocol level (`c.get('protocolLevel')`) the events this route makes go out at. */
  protocolLevel: number;
  deviceId: string;
  request: GenerateRequest;
  requestSignal: AbortSignal;
  admitted: AdmittedGeneration;
  onSettled: () => void;
}

/** What the event source observed, read by the teardown once the source has stopped. */
interface StreamEnding {
  /** The run's `usage` event was credited in-stream. */
  creditOwned: boolean;
  usage: Usage | undefined;
  terminal: 'result' | 'failure' | undefined;
}

function openGenerationStream(deps: StreamDeps): ReadableStream<Uint8Array> {
  const { requestSignal, admitted, inFlight } = deps;

  // One AbortController per request, wired to every cancellation surface: the SSE stream's own
  // cancel(), the request's Request.signal, and a drain's abortAll(). abort() is idempotent.
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (requestSignal.aborted) abort();
  else requestSignal.addEventListener('abort', abort, { once: true });
  const untrack = inFlight.track(abort);
  // Idempotent: a run's teardown detaches first, and a stream that waited in line again at its end.
  const detach = (): void => {
    requestSignal.removeEventListener('abort', abort);
    untrack();
  };

  const source =
    admitted.kind === 'running'
      ? runGeneration(deps, admitted.running, controller.signal, detach)
      : waitThenRun(deps, admitted.waiting, controller.signal, detach);
  return buildSseStream(source, deps.keepaliveMs, abort, deps.onSettled);
}

/** The pipeline run of a generation holding its slot and its ledger row, ending in the stream's ONE
 *  teardown: it releases the slot, settles the row and resolves the usage. */
function runGeneration(deps: StreamDeps, running: RunningGeneration, signal: AbortSignal, detach: () => void): AsyncGenerator<GenerationEvent> {
  const { pipeline, usageStore, deviceId, request } = deps;

  // The pipeline appends each model call's provider generation id and the run's outcome here, and
  // logs every run line under the request's id (== the ledger row id).
  const trace: RunTrace = { generationIds: [], requestId: running.requestId };
  const ending: StreamEnding = { creditOwned: false, usage: undefined, terminal: undefined };

  const teardown = async (): Promise<void> => {
    detach();
    running.handle.release();
    const outcome = ledgerOutcome(trace, ending, signal.aborted);
    const settlement = { outcome, failureReason: ledgerFailureReason(outcome, trace), usage: ending.usage, now: deps.clock() };
    // Retry a transient write once. Ledger cleanup must neither replace a pipeline error nor
    // break a terminal event already delivered to the client, and reconciliation still runs.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await usageStore.settle(running.requestId, settlement);
        break;
      } catch (err) {
        deps.log.warn({
          scope: 'request',
          outcome,
          attempt,
          detail: err instanceof Error ? err.message : String(err),
        }, 'generation ledger settlement failed');
      }
    }
    resolveGenerationUsage(deps, running, trace.generationIds, ending.creditOwned);
  };

  const run = (): AsyncIterable<GenerationEvent> => (pipeline.run as PipelineRun)(request, signal, trace);
  return forwardEvents(run, signal, ending, (usage) => usageStore.credit(deviceId, usage), teardown);
}

/** A generation admitted into the line: its wait, then, once it holds a slot and its daily unit,
 *  its run. */
async function* waitThenRun(deps: StreamDeps, waiting: WaitingGeneration, signal: AbortSignal, detach: () => void): AsyncGenerator<WireEvent> {
  try {
    const running = yield* takeSlot(deps, waiting, signal);
    if (running) yield* runGeneration(deps, running, signal, detach);
  } finally {
    detach();
  }
}

/** How a wait in line ended. */
type LineEnd = { kind: 'slot'; handle: SlotHandle } | { kind: 'timeout' | 'abort' | 'drain' };

/** How a generation left the line, as its `queue leave` log line names it. */
type LeaveOutcome = 'slot' | 'timeout' | 'abort' | 'drain' | 'ceiling';

function lineEnd(outcome: LineOutcome): LineEnd {
  if (outcome.ok) return { kind: 'slot', handle: outcome.handle };
  return { kind: outcome.reason === 'draining' ? 'drain' : 'abort' };
}

/** The one terminal event of a generation that leaves the line without running. */
function lineFailure(reason: string, protocolLevel: number): WireEvent {
  const failure: GenerationEvent = { type: 'failure', reason, attempts: 0, diagnostics: [] };
  return eventForLevel(failure, protocolLevel);
}

/**
 * Waits in line on the open stream, then spends the daily unit on the slot it gets, which inserts
 * the ledger row. Returns the running generation, or `undefined` once the stream has had its ending:
 * nothing for a client that left, otherwise one terminal `failure`. Logs the wait without content:
 * `queue join` (position, line length) and `queue leave` (outcome, waited time).
 */
async function* takeSlot(deps: StreamDeps, waiting: WaitingGeneration, signal: AbortSignal): AsyncGenerator<WireEvent, RunningGeneration | undefined> {
  const { ticket } = waiting;
  const lineClock = deps.lineClock ?? HOST_LINE_CLOCK;
  const joinedAt = lineClock.now();
  // A ticket already out of the line was handed its slot, or sent away by a drain, during the
  // checks before the stream opened: it never waited on this stream, so it logs no place in line.
  const position = ticket.position();
  if (position > 0) deps.log.info({ scope: 'queue', position, lineLength: deps.slots.counts().queued }, 'queue join');
  // What a stream whose reader stops mid-wait amounts to.
  let left: LeaveOutcome = 'abort';
  let waitedMs: number | undefined;
  try {
    const end = position > 0 ? yield* waitInLine(ticket, signal, lineClock, deps) : lineEnd(await ticket.outcome);
    waitedMs = Math.round(lineClock.now() - joinedAt);
    if (end.kind !== 'slot') {
      left = end.kind;
      if (end.kind !== 'abort') yield lineFailure(serverBusyRefusal().body.hint, deps.protocolLevel);
      return undefined;
    }
    if (signal.aborted) {
      end.handle.release();
      return undefined;
    }

    let unit: AdmitResult;
    try {
      unit = await deps.usageStore.admit({
        requestId: deps.requestId,
        deviceId: deps.deviceId,
        kind: 'generate',
        now: deps.clock(),
        deviceLimit: deps.config.limitGenerationsPerDeviceDay,
        globalLimit: deps.config.limitGenerationsPerDay,
      });
    } catch (err) {
      end.handle.release();
      throw err;
    }
    // Only the global ceiling can refuse here: the device has run nothing else since its check.
    if (!unit.ok) {
      end.handle.release();
      left = 'ceiling';
      yield lineFailure(unitRefusal(unit.reason, deps.clock).body.hint, deps.protocolLevel);
      return undefined;
    }
    left = 'slot';
    return { requestId: unit.requestId, handle: end.handle, policyGenerationId: waiting.policyGenerationId };
  } finally {
    if (position > 0) {
      deps.log.info({ scope: 'queue', outcome: left, waitedMs: waitedMs ?? Math.round(lineClock.now() - joinedAt) }, 'queue leave');
    }
  }
}

type LineWake = 'move' | 'tick' | 'timeout' | 'abort';

/** What woke a waiting generation, gathered between the turns of its wait. */
class LineWakes {
  readonly pending = new Set<LineWake>();
  outcome: LineOutcome | undefined;
  private wake: (() => void) | undefined;

  constructor(outcome: Promise<LineOutcome>) {
    outcome.then((settled) => {
      this.outcome = settled;
      this.wake?.();
    });
  }

  raise(reason: LineWake): void {
    this.pending.add(reason);
    this.wake?.();
  }

  /** Resolves once something is pending or the ticket's outcome has arrived. */
  async next(): Promise<void> {
    if (this.pending.size === 0 && this.outcome === undefined) {
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
    this.wake = undefined;
  }
}

/** What a wake means, in priority order: a client that left, then the ticket's outcome (its slot,
 *  or a drain), then the timeout; `undefined` to keep waiting. */
async function lineEndAfterWake(ticket: LineTicket, wakes: LineWakes): Promise<LineEnd | undefined> {
  if (wakes.pending.has('abort')) return { kind: 'abort' };
  // Out of the line with its outcome not yet delivered: it is a microtask away.
  const outcome = wakes.outcome ?? (ticket.position() === 0 ? await ticket.outcome : undefined);
  if (outcome !== undefined) return lineEnd(outcome);
  if (wakes.pending.has('timeout')) return { kind: 'timeout' };
  wakes.pending.clear();
  return undefined;
}

/**
 * The wait itself: `queued{position}` on entry, on every move and at least every
 * `QUEUED_HEARTBEAT_MS`, until the ticket is handed its slot or sent away by a drain, the client
 * leaves, or `queueMaxWaitMs` passes. Whatever ends it, a ticket that did not come away with a slot
 * has left the line, including when the stream's reader stops mid-wait.
 */
async function* waitInLine(ticket: LineTicket, signal: AbortSignal, lineClock: LineClock, deps: StreamDeps): AsyncGenerator<WireEvent, LineEnd> {
  const wakes = new LineWakes(ticket.outcome);
  const stopMoves = ticket.onMove(() => wakes.raise('move'));
  const onAbort = (): void => wakes.raise('abort');
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) wakes.raise('abort');
  const stopTimeout = lineClock.setTimer(deps.config.queueMaxWaitMs, () => wakes.raise('timeout'));
  let stopTick = (): void => undefined;
  let end: LineEnd | undefined;
  try {
    while (end === undefined) {
      const position = ticket.position();
      if (position > 0 && !wakes.pending.has('abort')) {
        stopTick();
        stopTick = lineClock.setTimer(QUEUED_HEARTBEAT_MS, () => wakes.raise('tick'));
        const queued: GenerationEvent = { type: 'queued', position };
        yield eventForLevel(queued, deps.protocolLevel);
      }
      await wakes.next();
      end = await lineEndAfterWake(ticket, wakes);
    }
    return end;
  } finally {
    stopMoves();
    stopTick();
    stopTimeout();
    signal.removeEventListener('abort', onAbort);
    if (end?.kind !== 'slot') ticket.leave();
  }
}

/**
 * Forwards the pipeline's events and runs `teardown` exactly once, when iteration ends for any
 * reason. Nothing is forwarded once the request was aborted, and nothing after the first terminal
 * event, so a stream carries at most one terminal and none after an abort. A `usage` event is
 * credited before it is forwarded, which is before the terminal event.
 */
async function* forwardEvents(
  run: () => AsyncIterable<GenerationEvent>,
  signal: AbortSignal,
  ending: StreamEnding,
  credit: (usage: Usage) => Promise<void>,
  teardown: () => Promise<void>,
): AsyncGenerator<GenerationEvent> {
  try {
    for await (const event of run()) {
      if (event.type === 'usage') {
        ending.creditOwned = true;
        ending.usage = event.usage;
        await credit(event.usage);
      }
      if (signal.aborted) return;
      if (event.type === 'result' || event.type === 'failure') ending.terminal = event.type;
      yield event;
      if (ending.terminal) return;
    }
  } finally {
    await teardown();
  }
}

/** A failed or expired row's code: the run's own terminal code, or, when the run ended without one
 *  (the pipeline threw, or the request was aborted after the run expired), the closed code for that
 *  outcome. */
function ledgerFailureReason(outcome: RequestOutcome, trace: RunTrace): FailureReason | undefined {
  if (outcome === 'expired') return trace.failureCode ?? 'expired';
  if (outcome === 'failed') return trace.failureCode ?? 'internal_error';
  return undefined;
}

/** `RunTrace.outcome` when the pipeline recorded one; otherwise what the stream observed. */
function ledgerOutcome(trace: RunTrace, ending: StreamEnding, aborted: boolean): RequestOutcome {
  if (trace.outcome) return trace.outcome;
  if (ending.terminal === 'result') return 'delivered';
  if (ending.terminal === 'failure') return 'failed';
  return aborted ? 'aborted' : 'failed';
}

/**
 * Cost for every recorded id — the classifier call and every pipeline call — lands on the ledger
 * row. Tokens are reconciled only for pipeline calls whose `usage` was never credited in-stream:
 * the classifier's tokens were credited when the check returned, so they never go through
 * reconciliation a second time.
 */
function resolveGenerationUsage(deps: StreamDeps, running: RunningGeneration, pipelineIds: readonly string[], creditOwned: boolean): void {
  const { deviceId, resolveTracker } = deps;
  const { requestId, policyGenerationId } = running;
  const rDeps = resolveDeps(deps);

  if (policyGenerationId === undefined) {
    resolveTracker.track(resolveRequestUsage(requestId, deviceId, pipelineIds, creditOwned, rDeps));
    return;
  }
  resolveTracker.track(resolveRequestUsage(requestId, deviceId, [policyGenerationId, ...pipelineIds], true, rDeps));
  if (!creditOwned && pipelineIds.length > 0) {
    // requestId '' is the resolver's no-ledger sentinel: tokens only, the cost is recorded above.
    resolveTracker.track(resolveRequestUsage('', deviceId, pipelineIds, false, rDeps));
  }
}

function resolveDeps(deps: GenerateRouteOptions & { usageStore: UsageStore }): ResolveDeps {
  return { transport: deps.resolveTransport, usageStore: deps.usageStore, bounds: deps.resolveBounds };
}
