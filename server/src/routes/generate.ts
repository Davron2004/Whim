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
import type { RequestOutcome, UsageStore } from '../usage-store';
import type { RunTrace } from '../generation/machine';
import type { ServerConfig } from '../config';
import type { SlotController, SlotHandle } from '../admission/slots';
import { checkCredit, type CreditTransport } from '../admission/credit';
import {
  budgetExhaustedRefusal,
  contentPolicyRefusal,
  dailyLimitRefusal,
  payloadTooLargeRefusal,
  policyUnavailableRefusal,
  serverBusyCeilingRefusal,
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

interface AdmittedGeneration {
  requestId: string;
  handle: SlotHandle;
  /** The classifier call's provider generation id, when the check actually called the model. */
  policyGenerationId: string | undefined;
}

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

  const acquired = slots.acquire('generate', deviceId);
  if (!acquired.ok) return { ok: false, refusal: slotRefusal(acquired.reason) };
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
    await usageStore.settle(requestId, { outcome: 'error', now: clock() });
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
  const { usageStore, config, clock, deviceId, policy, request, signal } = deps;

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
    return { ok: false, refusal: unit.reason === 'device' ? dailyLimitRefusal(clock) : serverBusyCeilingRefusal(clock) };
  }
  const { requestId } = unit;
  onAdmitted(requestId);

  // Any failure to produce a verdict is `policy_unavailable` (specs/content-policy "The policy
  // check fails closed"); `cachedPolicy` has already logged it as `unavailable`.
  let unavailable: PolicyUnavailableError | undefined;
  const checked = await policy.check(buildGeneratePolicyInput(request), 'generate', signal, deps.log).then(
    (result): PolicyCheckResult | undefined => result,
    (err): undefined => {
      unavailable = err instanceof PolicyUnavailableError ? err : undefined;
      return undefined;
    },
  );
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

  return { ok: true, admitted: { requestId, handle, policyGenerationId: checked.generationId } };
}

interface StreamDeps extends GenerateRouteOptions {
  pipeline: Pipeline;
  usageStore: UsageStore;
  log: ServerLogger;
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
  const { pipeline, usageStore, deviceId, request, requestSignal, admitted, inFlight } = deps;

  // One AbortController per request, wired to every cancellation surface: the SSE stream's own
  // cancel(), the request's Request.signal, and a drain's abortAll(). abort() is idempotent.
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (requestSignal.aborted) abort();
  else requestSignal.addEventListener('abort', abort, { once: true });
  const untrack = inFlight.track(abort);

  // The pipeline appends each model call's provider generation id and the run's outcome here, and
  // logs every run line under the request's id (== the ledger row id).
  const trace: RunTrace = { generationIds: [], requestId: admitted.requestId };
  const ending: StreamEnding = { creditOwned: false, usage: undefined, terminal: undefined };

  const teardown = async (): Promise<void> => {
    requestSignal.removeEventListener('abort', abort);
    untrack();
    admitted.handle.release();
    const outcome = ledgerOutcome(trace, ending, controller.signal.aborted);
    const failureReason = outcome === 'failed' || outcome === 'expired' ? trace.failureCode : undefined;
    const settlement = { outcome, failureReason, usage: ending.usage, now: deps.clock() };
    // Retry a transient write once. Ledger cleanup must neither replace a pipeline error nor
    // break a terminal event already delivered to the client, and reconciliation still runs.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await usageStore.settle(admitted.requestId, settlement);
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
    resolveGenerationUsage(deps, trace.generationIds, ending.creditOwned);
  };

  const run = (): AsyncIterable<GenerationEvent> => (pipeline.run as PipelineRun)(request, controller.signal, trace);
  const source = forwardEvents(run, controller.signal, ending, (usage) => usageStore.credit(deviceId, usage), teardown);
  return buildSseStream(source, deps.keepaliveMs, abort, deps.onSettled);
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
function resolveGenerationUsage(deps: StreamDeps, pipelineIds: readonly string[], creditOwned: boolean): void {
  const { admitted, deviceId, resolveTracker } = deps;
  const { requestId, policyGenerationId } = admitted;
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
