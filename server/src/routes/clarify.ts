/**
 * POST /v1/clarify — the pre-stream clarify exchange (design D1, spec "Clarify endpoint").
 *
 * Unary by construction: prompt in, at most three questions out. It is NOT a generation stage, it
 * opens no stream, and it holds no per-device state — the device carries the answers forward by
 * value inside the rewrite/generate request that follows. `GenerationEvent` is untouched.
 *
 * Zero questions is a first-class success (`200` with an empty list), never an error and never a
 * degraded mode: most prompts need nothing clarified. What is NOT dressed up as zero questions is
 * a broken model call — that stays an honest `502`, mirroring `/v1/rewrite`.
 *
 * Admission (design D6a/D8; specs/server-admission-control "Admission checks run in a fixed
 * order"): raw body cap, body validation, prompt byte cap, operator credit, drain state, the
 * global unary concurrency cap, the device's daily clarify allowance and the clarify+rewrite
 * global daily ceiling, then the content policy check — all before any model call.
 * `admitUnaryRequest` below is the ONE place that orders credit → slot → daily-unit → policy for
 * both `/v1/clarify` and `/v1/rewrite`, so the two routes cannot drift apart on ordering;
 * `routes/rewrite.ts` imports it from here rather than duplicating it (design D8 shares this exact
 * ordering across every unary route).
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ClarifyRequest, ClarifyResponse, type ApiError, type Usage } from '@whim/contract';
import { isCreditExhaustedError, type ModelClient, type ModelRoster } from '../generation/model';
import type { UsageStore, RequestKind, RequestOutcome } from '../usage-store';
import type { ServerConfig } from '../config';
import type { SlotController, SlotHandle } from '../admission/slots';
import { checkCredit, invalidateCreditCache, type CreditTransport } from '../admission/credit';
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
import { PolicyUnavailableError, type ContentPolicy, type PolicyRoute } from '../policy';
import { buildClarifyPolicyInput } from '../policy/input';
import {
  resolveRequestUsage,
  type ResolveBounds,
  type ResolveDeps,
  type UsageAndCostTransport,
  type ResolveTracker,
} from '../usage/resolve';
import { buildClarifyMessages } from '../generation/prompts';
import { parseJsonBlock } from '../generation/json-block';
import { log } from '../logger';

type Env = { Variables: { deviceId: string } };

/** The kinds the ONE global unary daily ceiling (`ServerConfig.limitUnaryPerDay`) is counted
 *  across. Clarify and rewrite share it rather than getting a ceiling each, so the pair's total
 *  spend is bounded by one number an operator can reason about. */
const UNARY_KINDS: readonly RequestKind[] = ['clarify', 'rewrite'];

const NOT_CONFIGURED: ApiError = {
  error: 'clarify_not_configured',
  hint: 'The server was started without a model client for /v1/clarify — set OPENROUTER_API_KEY and the model roster, or start it with WHIM_PIPELINE=stub.',
};

const MODEL_FAILURE: ApiError = {
  error: 'model_failure',
  hint: 'The clarify model call failed. Try again in a moment.',
};

/** The prompt marker that makes the stub answer "nothing to ask" — the deterministic twin of the
 *  stub pipeline's `[[fail]]`, so the device's skip path is reachable without a model. */
const STUB_NO_QUESTIONS_MARKER = '[[noclarify]]';

/** The stub's canned questions: fixed, prompt-independent, and deliberately generic — this exists
 *  so LAN UI work can drive the clarify screen without spending tokens, not to be a clarifier. */
const STUB_QUESTIONS: ClarifyResponse = {
  questions: [
    { id: 'scope', question: 'How much should it hold?', options: ['Just today', 'A few weeks', 'Everything'] },
    { id: 'entry', question: 'How do you add things?', options: ['Type it', 'Pick from a list'] },
    { id: 'done', question: 'What happens when something is done?', options: ['It disappears', 'It stays, ticked'] },
  ],
};

/**
 * Model output → a conforming `ClarifyResponse`, or `undefined` when it is unusable. Defensive
 * normalization only, never fabrication: a question past the third is dropped, as is one with no
 * options — both are the model exceeding a bound the contract sets, not content to invent.
 */
function shapeClarify(text: string): ClarifyResponse | undefined {
  const parsed = parseJsonBlock(text);
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const raw = (parsed as Record<string, unknown>).questions;
  if (!Array.isArray(raw)) return undefined;

  const questions = raw
    .filter((q): q is Record<string, unknown> => typeof q === 'object' && q !== null)
    .map((q, index) => ({
      id: typeof q.id === 'string' && q.id.trim().length > 0 ? q.id.trim() : `q${index + 1}`,
      question: typeof q.question === 'string' ? q.question.trim() : '',
      options: Array.isArray(q.options)
        ? q.options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0).map((o) => o.trim())
        : [],
    }))
    .filter((q) => q.question.length > 0 && q.options.length > 0)
    .slice(0, 3);

  const result = ClarifyResponse.safeParse({ questions });
  return result.success ? result.data : undefined;
}

/** Everything `admitUnaryRequest` needs to run the shared credit → slot → daily-unit → policy
 *  order for one clarify or rewrite request. `resolveTransport`/`resolveBounds`/`resolveTracker`
 *  are the same values the route's own post-response `finish()` uses — a policy refusal still
 *  needs them to resolve the classifier call's cost onto the request's ledger row. */
export interface UnaryAdmissionDeps {
  deviceId: string;
  kind: Extract<RequestKind, 'clarify' | 'rewrite'>;
  deviceLimit: number;
  /** `ServerConfig.limitUnaryPerDay` — ONE ceiling counted across clarify AND rewrite together. */
  globalLimit: number;
  usageStore: UsageStore;
  clock: () => number;
  slots: SlotController;
  creditTransport: CreditTransport | undefined;
  creditTtlMs: number;
  creditFloorUsd: number;
  policy: ContentPolicy;
  policyRoute: PolicyRoute;
  policyInput: string;
  resolveTransport: UsageAndCostTransport;
  resolveBounds: Partial<ResolveBounds> | undefined;
  resolveTracker: ResolveTracker;
  signal?: AbortSignal;
}

export type UnaryAdmissionOutcome =
  | { ok: true; requestId: string; release: () => void; policyGenerationId?: string }
  | { ok: false; refusal: ServiceRefusal };

/**
 * Resolves usage for a unary route's own post-model-call ending (`clarify.ts`'s and `rewrite.ts`'s
 * `finish()`), mirroring `routes/generate.ts`'s `resolveGenerationUsage`: cost for every recorded id
 * — the classifier call plus the route's own model call(s) — lands on the ledger row via ONE
 * `creditOwned: true` call, so the classifier's tokens (already credited the moment `policy.check`
 * returned) are never folded into a token-crediting call. Tokens are reconciled, in a SEPARATE call
 * with no classifier id, only for the route's own ids whose usage was never credited in-stream
 * (`!creditOwned`). With no classifier id at all, the caller's own ids/creditOwned pass straight
 * through unsplit.
 */
export function resolveUnaryUsage(
  requestId: string,
  deviceId: string,
  policyGenerationId: string | undefined,
  generationIds: readonly string[],
  creditOwned: boolean,
  resolveTracker: ResolveTracker,
  deps: ResolveDeps,
): void {
  if (policyGenerationId === undefined) {
    resolveTracker.track(resolveRequestUsage(requestId, deviceId, generationIds, creditOwned, deps));
    return;
  }
  resolveTracker.track(resolveRequestUsage(requestId, deviceId, [policyGenerationId, ...generationIds], true, deps));
  if (!creditOwned && generationIds.length > 0) {
    // requestId '' is the resolver's no-ledger sentinel: tokens only, the cost is recorded above.
    resolveTracker.track(resolveRequestUsage('', deviceId, generationIds, false, deps));
  }
}

/**
 * The fixed admission order shared by `/v1/clarify` and `/v1/rewrite`, AFTER the raw body cap,
 * body validation and prompt byte cap the caller already ran (specs/server-admission-control
 * "Admission checks run in a fixed order"): operator credit → drain/global-unary-cap (one slot
 * acquire) → the device's daily allowance and the clarify+rewrite global daily ceiling → content
 * policy. Every refusal after a resource was taken (a slot, a daily unit) releases/refunds it
 * before returning, and so does anything thrown past the acquire.
 *
 * The classifier call's own usage is credited to the device the moment it comes back — allowed or
 * refused, since the call still happened either way (spec "The policy check is metered and
 * observable without content"). On `allow`, its generation id is returned as `policyGenerationId`
 * so the caller folds it into the request's own generation ids before resolving cost. On a refusal
 * (the request ends here, with no further model call), the row is settled with the classifier's
 * usage and its cost is resolved immediately, the same way the route's own `finish()` would.
 */
export async function admitUnaryRequest(deps: UnaryAdmissionDeps): Promise<UnaryAdmissionOutcome> {
  const { deviceId, clock, slots, creditTransport, creditTtlMs, creditFloorUsd, policyRoute } = deps;

  if (creditTransport) {
    const credit = await checkCredit({ transport: creditTransport, clock, ttlMs: creditTtlMs, floorUsd: creditFloorUsd });
    if (!credit.ok) return { ok: false, refusal: budgetExhaustedRefusal() };
    if (credit.lookupFailed) {
      log.warn({ lookupFailed: credit.lookupFailed, route: policyRoute }, 'operator credit lookup failed open');
    }
  }

  const acquired = slots.acquire('unary', deviceId);
  if (!acquired.ok) return { ok: false, refusal: slotRefusal(acquired.reason) };
  // Everything past the acquire gives back BOTH resources it may have taken before its error
  // propagates: the slot, and the ledger row — a throwing usage store (or policy) must not leave
  // the slot held for the life of the process, nor an eternally `pending` row that keeps consuming
  // the device's daily allowance and the global ceiling with nothing to show for it. `release()`
  // is idempotent, so a refusal below that already released is unaffected. Mirrors
  // `routes/generate.ts`'s `admitGeneration`.
  let admittedRequestId: string | undefined;
  try {
    return await admitUnaryWithSlot(acquired.handle, deps, (requestId) => {
      admittedRequestId = requestId;
    });
  } catch (err) {
    acquired.handle.release();
    if (admittedRequestId !== undefined) {
      await settleFailedAdmission(deps.usageStore, admittedRequestId, deps.clock, err);
    }
    throw err;
  }
}

/**
 * Closes the ledger row of an admission that threw past the daily-unit insert. The unit is NOT
 * refunded: the classifier call it paid for may well have happened, and a refund on every store
 * blip is a free retry an abusive client can farm — the row is simply marked `error` so it stops
 * being an open `pending` request nothing will ever settle. A `settle` that throws in turn (the
 * same store is, after all, the usual reason we are here) is logged and swallowed: the caller is
 * already unwinding with the original error, which is the one worth surfacing.
 */
async function settleFailedAdmission(
  usageStore: UsageStore,
  requestId: string,
  clock: () => number,
  cause: unknown,
): Promise<void> {
  try {
    await usageStore.settle(requestId, { outcome: 'error', now: clock() });
  } catch (settleErr) {
    log.error(
      {
        requestId,
        detail: settleErr instanceof Error ? settleErr.message : String(settleErr),
        cause: cause instanceof Error ? cause.message : String(cause),
      },
      'could not settle the ledger row of a failed admission',
    );
  }
}

/** The daily unit (device limit, then the clarify+rewrite global ceiling), then the content
 *  policy — the half of `admitUnaryRequest` that runs holding a slot. `onAdmitted` reports the
 *  ledger row the moment it exists, so the caller's `catch` can settle a row this function threw
 *  past instead of leaving it open. */
async function admitUnaryWithSlot(
  handle: SlotHandle,
  deps: UnaryAdmissionDeps,
  onAdmitted: (requestId: string) => void,
): Promise<UnaryAdmissionOutcome> {
  const {
    deviceId,
    kind,
    deviceLimit,
    globalLimit,
    usageStore,
    clock,
    policy,
    policyRoute,
    policyInput,
    resolveTransport,
    resolveBounds,
    resolveTracker,
    signal,
  } = deps;

  const admitted = await usageStore.admit({
    deviceId,
    kind,
    now: clock(),
    deviceLimit,
    globalLimit,
    globalKinds: UNARY_KINDS,
  });
  if (!admitted.ok) {
    handle.release();
    return {
      ok: false,
      refusal: admitted.reason === 'device' ? dailyLimitRefusal(clock) : serverBusyCeilingRefusal(clock),
    };
  }
  const { requestId } = admitted;
  onAdmitted(requestId);

  try {
    const result = await policy.check(policyInput, policyRoute, signal);
    if (result.usage) {
      await usageStore.credit(deviceId, result.usage);
    }
    if (result.verdict !== 'allow') {
      await usageStore.settle(requestId, { outcome: 'refused', usage: result.usage, now: clock() });
      handle.release();
      const ids = result.generationId ? [result.generationId] : [];
      resolveTracker.track(
        resolveRequestUsage(requestId, deviceId, ids, true, {
          transport: resolveTransport,
          usageStore,
          bounds: resolveBounds,
        }),
      );
      return { ok: false, refusal: contentPolicyRefusal() };
    }
    return { ok: true, requestId, release: () => handle.release(), policyGenerationId: result.generationId };
  } catch (err) {
    if (err instanceof PolicyUnavailableError) {
      await usageStore.settle(requestId, { outcome: 'unavailable', now: clock() });
      await usageStore.refund(requestId);
      handle.release();
      return { ok: false, refusal: policyUnavailableRefusal() };
    }
    throw err;
  }
}

export interface ClarifyRouteOptions {
  /** True when the server was started under the stub selector (`WHIM_PIPELINE=stub`): the route
   *  answers deterministically and makes no model call, exactly as the stub pipeline does. */
  stub?: boolean;
  config: ServerConfig;
  clock: () => number;
  slots: SlotController;
  policy: ContentPolicy;
  creditTransport: CreditTransport | undefined;
  resolveTracker: ResolveTracker;
  resolveTransport: UsageAndCostTransport;
  resolveBounds: Partial<ResolveBounds> | undefined;
}

/**
 * `model`/`roster` are optional for the same reason `/v1/rewrite`'s are: a caller that only
 * exercises the pipeline need not supply one. An unconfigured, non-stub server answers `502`.
 */
export function makeClarifyRoute(
  model: ModelClient | undefined,
  roster: ModelRoster | undefined,
  usageStore: UsageStore,
  options: ClarifyRouteOptions,
): Hono<Env> {
  const app = new Hono<Env>();
  const { config, clock, slots, policy, creditTransport, resolveTracker, resolveTransport, resolveBounds } = options;

  app.post(
    '/',
    bodyLimit({
      maxSize: config.maxBodyBytesUnary,
      onError: (c) => {
        const r = payloadTooLargeRefusal();
        return c.json(r.body, r.status, r.headers);
      },
    }),
    async (c) => {
      const deviceId = c.get('deviceId');
      const body = await c.req.json().catch(() => null);
      const parsed = ClarifyRequest.safeParse(body);
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

      const admission = await admitUnaryRequest({
        deviceId,
        kind: 'clarify',
        deviceLimit: config.limitClarifyPerDeviceDay,
        globalLimit: config.limitUnaryPerDay,
        usageStore,
        clock,
        slots,
        creditTransport,
        creditTtlMs: config.creditCacheTtlMs,
        creditFloorUsd: config.minCreditUsd,
        policy,
        policyRoute: 'clarify',
        policyInput: buildClarifyPolicyInput(parsed.data),
        resolveTransport,
        resolveBounds,
        resolveTracker,
        signal: c.req.raw.signal,
      });
      if (!admission.ok) {
        const r = admission.refusal;
        return c.json(r.body, r.status, r.headers);
      }
      const { requestId, release, policyGenerationId } = admission;

      const finish = async (
        outcome: RequestOutcome,
        usage: Usage | undefined,
        generationIds: string[],
        creditOwned: boolean,
      ): Promise<void> => {
        await usageStore.settle(requestId, { outcome, usage, now: clock() });
        release();
        resolveUnaryUsage(requestId, deviceId, policyGenerationId, generationIds, creditOwned, resolveTracker, {
          transport: resolveTransport,
          usageStore,
          bounds: resolveBounds,
        });
      };

      return runClarifyWork(model, roster, parsed.data, config, c.req.raw.signal, deviceId, usageStore, finish, options.stub);
    },
  );

  return app;
}

type FinishFn = (
  outcome: RequestOutcome,
  usage: Usage | undefined,
  generationIds: string[],
  creditOwned: boolean,
) => Promise<void>;

/**
 * The route's actual work, once admission has allowed it through: the stub short-circuit, the
 * unconfigured-server refusal, or a real bounded model call — extracted so `makeClarifyRoute`'s
 * handler only orchestrates admission, never the model-call branching too.
 */
async function runClarifyWork(
  model: ModelClient | undefined,
  roster: ModelRoster | undefined,
  parsed: ClarifyRequest,
  config: ServerConfig,
  requestSignal: AbortSignal | undefined,
  deviceId: string,
  usageStore: UsageStore,
  finish: FinishFn,
  stub: boolean | undefined,
): Promise<Response> {
  if (stub) {
    const stubbed = parsed.prompt.includes(STUB_NO_QUESTIONS_MARKER) ? { questions: [] } : STUB_QUESTIONS;
    await finish('ok', undefined, [], true);
    return Response.json(stubbed satisfies ClarifyResponse, { status: 200 });
  }

  if (!model || !roster) {
    await finish('error', undefined, [], true);
    return Response.json(NOT_CONFIGURED, { status: 502 });
  }

  const timeoutSignal = AbortSignal.timeout(config.unaryModelTimeoutMs);
  const combined = requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal;

  // The small/fast model — clarify asks two short questions, it does not write code.
  const stream = model.stream({ model: roster.rewrite, messages: buildClarifyMessages({ request: parsed }) }, combined);
  // A throw from the `deltas` iterator (below) rejects `usage` too without anyone ever awaiting
  // it — observed-but-discarded here so that never surfaces as an unhandled rejection, mirroring
  // `ModelContentPolicy.check`'s identical guard (`../policy/policy.ts`).
  stream.usage.catch(() => {});

  try {
    let raw = '';
    for await (const delta of stream.deltas) if (delta.kind === 'text') raw += delta.text;
    const usage = await stream.usage;
    const generationId = await stream.id;
    await usageStore.credit(deviceId, usage);
    const ids = generationId ? [generationId] : [];

    const shaped = shapeClarify(raw);
    if (!shaped) {
      await finish('error', usage, ids, true);
      return Response.json(MODEL_FAILURE, { status: 502 });
    }
    await finish('ok', usage, ids, true);
    return Response.json(shaped satisfies ClarifyResponse, { status: 200 });
  } catch (err) {
    const generationId = await stream.id.catch(() => undefined);
    const ids = generationId ? [generationId] : [];
    if (isCreditExhaustedError(err)) {
      invalidateCreditCache();
      await finish('error', undefined, ids, false);
      const r = budgetExhaustedRefusal();
      return Response.json(r.body, { status: r.status, headers: r.headers });
    }
    await finish('error', undefined, ids, false);
    return Response.json(MODEL_FAILURE, { status: 502 });
  }
}
