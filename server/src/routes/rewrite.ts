/**
 * POST /v1/rewrite — validates RewriteRequest and returns a RewriteResponse produced by a real
 * call to the configured rewrite model (task 7.2, spec "Rewrite endpoint over the real rewrite
 * model"). Metered through the same `UsageStore` as generation. A model failure is a `502` with
 * an `ApiError` body — this route NEVER falls back to returning the input prompt disguised as a
 * rewrite (design D5: "a model failure can no longer be papered over").
 *
 * It is also the plan screen's endpoint (design D10): the request may carry the clarify exchange's
 * answers, and the response may carry the labelled `plan` rows the device renders as its approval
 * gate. Both are optional on the wire and optional here — one endpoint, one approval gate.
 *
 * A re-prompt additionally carries `app`, the display-name context of the app being changed. This
 * route neither builds nor edits it: `RewriteRequest` validates it (and strips anything else the
 * device put there), and the parsed request reaches `buildRewriteMessages` whole — the prompt
 * builder is the one place that decides how an edit is stated to the model.
 *
 * Admission runs the same ordered sequence `/v1/clarify` does — raw body cap, body validation,
 * prompt byte cap, then `admitUnaryRequest` (`./clarify`): operator credit, drain/global-unary-cap,
 * the device's daily rewrite allowance, content policy — all before any rewrite model call.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { RewriteRequest, RewriteResponse, type ApiError, type Clarification, type PlanRow, type Usage } from '@whim/contract';
import { isCreditExhaustedError, type ModelClient, type ModelMessage, type ModelRoster } from '../generation/model';
import type { FailureReason, UsageStore, RequestOutcome } from '../usage-store';
import type { ServerConfig } from '../config';
import type { SlotController } from '../admission/slots';
import type { CreditTransport } from '../admission/credit';
import { invalidateCreditCache } from '../admission/credit';
import { budgetExhaustedRefusal, payloadTooLargeRefusal } from '../admission/refusals';
import type { ContentPolicy } from '../policy';
import { buildRewritePolicyInput } from '../policy/input';
import { resolveRequestUsage, type ResolveBounds, type UsageAndCostTransport, type ResolveTracker } from '../usage/resolve';
import { buildRewriteMessages } from '../generation/prompts';
import { parseJsonBlock } from '../generation/json-block';
import { admitUnaryRequest, settleFailedUnaryRequest } from './clarify';
import type { V1Env } from '../request-edge';
import { consentPractice } from '../consent-practices';
import type { ServerLogger } from '../logger';
import { carriesStubPipelineMarker } from '../stub-markers';

const NOT_CONFIGURED: ApiError = {
  error: 'rewrite_not_configured',
  hint: 'The server was started without a model client for /v1/rewrite — set OPENROUTER_API_KEY and the model roster.',
};

const MODEL_FAILURE: ApiError = {
  error: 'model_failure',
  hint: 'The rewrite model call failed. Try again in a moment.',
};

/** The stub's canned plan (`WHIM_PIPELINE=stub`): fixed and prompt-independent like the stub
 *  clarify's questions, and a description of the app the stub pipeline builds
 *  (`pipeline.ts#STUB_APP_SOURCE`). Five rows, so editing the fourth and later rows of a plan can
 *  be tried without spending tokens. */
const STUB_PLAN: readonly PlanRow[] = [
  { label: 'What it is', text: 'A checklist for the day: tick things off as you go.' },
  { label: 'Main screen', text: 'Sixteen starter tasks, each with a tick box, and how many are done.' },
  { label: 'Adding', text: 'Type a task and tap Add to put it at the end of the list.' },
  { label: 'Progress', text: 'A bar that fills as tasks are ticked off.' },
  { label: 'Clearing', text: 'A button at the bottom clears every ticked task.' },
];

/** A clarify answer as a plan row, as the plan turn honours it: the question, then every picked
 *  choice and the user's own words, or that Whim decides when they asked it to. */
function stubAnswerRow(c: Clarification): PlanRow {
  if (c.decide === true) return { label: c.question, text: 'Whim decides this one.' };
  const own = c.other === undefined ? [] : [`in your words: “${c.other}”`];
  return { label: c.question, text: [...c.choices, ...own].join(', ') };
}

/** What the stub rewrite answers: the canned rows, then one row per clarify answer, with the rows
 *  as the rewritten prompt (the `label: text` lines an edited plan is built from on the device). */
function stubRewriteResponse(request: RewriteRequest): RewriteResponse {
  const plan = [...STUB_PLAN, ...(request.clarifications ?? []).map(stubAnswerRow)];
  return { rewrittenPrompt: plan.map((row) => `${row.label}: ${row.text}`).join('\n'), plan };
}

/**
 * The model is asked for `{ rewrittenPrompt, plan: [{label, text}] }` (design D10). A model that
 * answers with plain prose instead is NOT a failure: its whole reply becomes `rewrittenPrompt` with
 * no plan, and the device renders that single row. Rows are kept only when both fields are
 * non-empty strings; an empty row list is dropped entirely, since "no rows" and "zero rows" mean
 * the same thing to the device and the contract prefers the absent form.
 */
function shapeRewrite(text: string): RewriteResponse {
  const parsed = parseJsonBlock(text);
  if (typeof parsed !== 'object' || parsed === null) return { rewrittenPrompt: text.trim() };
  const v = parsed as Record<string, unknown>;
  const rewrittenPrompt = typeof v.rewrittenPrompt === 'string' ? v.rewrittenPrompt.trim() : '';
  if (rewrittenPrompt.length === 0) return { rewrittenPrompt: text.trim() };

  const rows: PlanRow[] = Array.isArray(v.plan)
    ? v.plan
        .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
        .map((row) => ({
          label: (typeof row.label === 'string' ? row.label : '').trim(),
          text: (typeof row.text === 'string' ? row.text : '').trim(),
        }))
        .filter((row) => row.label.length > 0 && row.text.length > 0)
    : [];

  return rows.length > 0 ? { rewrittenPrompt, plan: rows } : { rewrittenPrompt };
}

type RewriteAttemptOutcome = {
  generationIds: string[];
  creditedGenerationIds: Set<string>;
  usage: Usage;
} & (
  | { outcome: 'ok'; response: RewriteResponse }
  | { outcome: 'budget_exhausted' }
  | { outcome: 'failed' }
);

/** The pieces of `rewriteWithRetry`'s call that stay fixed across both attempts — grouped so the
 *  function itself takes few enough parameters for S107 (max 7), never a behaviour change. */
interface RewriteRetryContext {
  model: ModelClient;
  roster: ModelRoster;
  usageStore: UsageStore;
  deviceId: string;
  requestLog: ServerLogger;
}

/**
 * Runs the rewrite turn, re-asking once when the reply shapes to no plan. The plan step cannot
 * render without rows, so any reply with no usable `plan` — an empty stream, JSON truncated before
 * `rewrittenPrompt`/`plan` ever appear, or plain prose with no structured rows — costs one extra
 * model call BY DESIGN: that is cheaper than showing the device an empty or malformed plan screen.
 * A second such reply is still returned rather than tried a third time: retrying forever on a
 * model that keeps answering the same way just delays the response for no better outcome.
 *
 * Each attempt is individually bounded by `timeoutMs` (spec "Unary model calls have a bounded
 * lifetime"). A `402` from the provider on either attempt ends the retry immediately — a repair
 * spends more of an already-exhausted budget (design D6b) — rather than trying the second attempt.
 * `creditedGenerationIds` records which attempts credited tokens in-stream, so a failed retry
 * can still recover its own usage without crediting an earlier successful attempt twice.
 */
async function rewriteWithRetry(
  ctx: RewriteRetryContext,
  messages: ModelMessage[],
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<RewriteAttemptOutcome> {
  const { model, roster, usageStore, deviceId, requestLog } = ctx;
  let best: RewriteResponse | undefined;
  const generationIds: string[] = [];
  const creditedGenerationIds = new Set<string>();
  const usage: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) return { outcome: 'failed', generationIds, creditedGenerationIds, usage };

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const step = await applyRewriteAttempt(model, roster, messages, combined, usageStore, deviceId, generationIds, best, creditedGenerationIds, usage, requestLog);
    if (step.outcome) return step.outcome;
    best = step.best;
    if (step.stop) break;
  }
  // `best` is always set: attempt 0 always runs (the loop bound is fixed at 2, not data-dependent)
  // and the first shaped reply always satisfies `!best`.
  return { outcome: 'ok', response: best!, generationIds, creditedGenerationIds, usage };
}

type RewriteAttempt =
  | { ok: true; shaped: RewriteResponse; usage: Usage; generationId?: string }
  | { ok: false; budgetExhausted: boolean; generationId?: string };

type RewriteAttemptStep =
  | { outcome: RewriteAttemptOutcome; stop?: never; best?: never }
  | { outcome?: never; stop: boolean; best: RewriteResponse };

/**
 * Runs one attempt and folds it into the retry loop's running state: a failure/budget-exhaustion
 * is a terminal `outcome`; a success reports the new `best` reply and whether the loop should
 * `stop` (a usable plan came back). Accumulates generation ids and usage in place
 * so every completed attempt reaches request settlement, even if a later retry fails. Extracted so `rewriteWithRetry`'s loop
 * body carries none of this branching itself.
 */
async function applyRewriteAttempt(
  model: ModelClient,
  roster: ModelRoster,
  messages: ModelMessage[],
  combined: AbortSignal,
  usageStore: UsageStore,
  deviceId: string,
  generationIds: string[],
  best: RewriteResponse | undefined,
  creditedGenerationIds: Set<string>,
  usage: Usage,
  requestLog: ServerLogger,
): Promise<RewriteAttemptStep> {
  const result = await runRewriteAttempt(model, roster, messages, combined, requestLog);
  if (result.generationId) generationIds.push(result.generationId);

  if (!result.ok) {
    return { outcome: { outcome: result.budgetExhausted ? 'budget_exhausted' : 'failed', generationIds, creditedGenerationIds, usage } };
  }

  await usageStore.credit(deviceId, result.usage);
  if (result.generationId) creditedGenerationIds.add(result.generationId);
  usage.promptTokens += result.usage.promptTokens;
  usage.completionTokens += result.usage.completionTokens;
  usage.totalTokens += result.usage.totalTokens;
  const { shaped } = result;
  const nextBest = !best || shaped.rewrittenPrompt.length > 0 ? shaped : best;
  return { stop: shaped.rewrittenPrompt.length > 0 && Boolean(shaped.plan), best: nextBest };
}

/** One rewrite model call: streams the reply, shapes it, and reports its own generation id and
 *  usage — extracted so the retry loop above (`rewriteWithRetry`) only orchestrates attempts,
 *  never the stream-consumption branching itself. */
async function runRewriteAttempt(
  model: ModelClient,
  roster: ModelRoster,
  messages: ModelMessage[],
  signal: AbortSignal,
  requestLog: ServerLogger,
): Promise<RewriteAttempt> {
  const stream = model.stream(
    { model: roster.rewrite.model, messages, reasoning: roster.rewrite.reasoning, role: 'rewrite', logger: requestLog },
    signal,
  );
  // See `../routes/clarify.ts`'s identical guard: a throw from `deltas` rejects `usage` too
  // without anyone awaiting it — discarded here so it never surfaces as an unhandled rejection.
  stream.usage.catch(() => {});
  try {
    let raw = '';
    for await (const delta of stream.deltas) if (delta.kind === 'text') raw += delta.text;
    const usage = await stream.usage;
    const generationId = await stream.id;
    return { ok: true, shaped: shapeRewrite(raw), usage, generationId };
  } catch (err) {
    const generationId = await stream.id.catch(() => undefined);
    return { ok: false, budgetExhausted: isCreditExhaustedError(err), generationId };
  }
}

export interface RewriteRouteOptions {
  /** True when the server was started under the stub selector (`WHIM_PIPELINE=stub`): the route
   *  makes no model call, mirroring `/v1/clarify`'s stub short-circuit. A prompt carrying a marker
   *  the stub pipeline reads (`[[fail]]`, `[[future:*]]`) is passed through raw, so the marker
   *  survives into `/v1/generate`; any other prompt gets the canned plan (`stubRewriteResponse`). */
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
 * `model`/`roster` are optional so a caller that only exercises `/v1/generate` (e.g. the
 * pre-existing server-core/metering suites) need not supply one — an unconfigured server
 * responds `502` to every rewrite request rather than silently falling back to a canned rewrite.
 */
export function makeRewriteRoute(
  model: ModelClient | undefined,
  roster: ModelRoster | undefined,
  usageStore: UsageStore,
  options: RewriteRouteOptions,
): Hono<V1Env> {
  const app = new Hono<V1Env>();
  const { config, clock, slots, policy, creditTransport, resolveTracker, resolveTransport, resolveBounds } = options;

  app.post(
    '/',
    consentPractice('request-material', 'required'),
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
      const parsed = RewriteRequest.safeParse(body);
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

      const requestLog = c.get('log');
      const admission = await admitUnaryRequest({
        requestId: c.get('requestId'),
        log: requestLog,
        deviceId,
        kind: 'rewrite',
        deviceLimit: config.limitRewritePerDeviceDay,
        globalLimit: config.limitUnaryPerDay,
        usageStore,
        clock,
        slots,
        creditTransport,
        creditTtlMs: config.creditCacheTtlMs,
        creditFloorUsd: config.minCreditUsd,
        policy,
        policyRoute: 'rewrite',
        policyInput: buildRewritePolicyInput(parsed.data),
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

      let settlementUsage: Usage | undefined;
      const finish = async (
        outcome: RequestOutcome,
        generationIds: string[],
        creditedGenerationIds: Set<string>,
        usage?: Usage,
        failureReason?: FailureReason,
      ): Promise<void> => {
        settlementUsage = usage;
        await usageStore.settle(requestId, { outcome, failureReason, usage, now: clock() });
        if (policyGenerationId !== undefined) {
          generationIds = [policyGenerationId, ...generationIds];
          creditedGenerationIds.add(policyGenerationId);
        }
        resolveTracker.track(resolveRequestUsage(requestId, deviceId, generationIds, creditedGenerationIds, {
          transport: resolveTransport,
          usageStore,
          bounds: resolveBounds,
        }));
      };

      try {
        if (options.stub) {
          await finish('ok', [], new Set());
          const stubbed = carriesStubPipelineMarker(parsed.data.prompt) ? { rewrittenPrompt: parsed.data.prompt } : stubRewriteResponse(parsed.data);
          return c.json(stubbed satisfies RewriteResponse, 200);
        }

        if (!model || !roster) {
          await finish('error', [], new Set(), undefined, 'internal_error');
          return c.json(NOT_CONFIGURED, 502);
        }

        const messages = buildRewriteMessages({ request: parsed.data });
        const result = await rewriteWithRetry(
          { model, roster, usageStore, deviceId, requestLog },
          messages,
          c.req.raw.signal,
          config.unaryModelTimeoutMs,
        );

        if (result.outcome === 'budget_exhausted') {
          invalidateCreditCache();
          await finish('error', result.generationIds, result.creditedGenerationIds, result.usage, 'budget_exhausted');
          const r = budgetExhaustedRefusal();
          return c.json(r.body, r.status, r.headers);
        }
        if (result.outcome === 'failed') {
          await finish('error', result.generationIds, result.creditedGenerationIds, result.usage, 'model_failure');
          return c.json(MODEL_FAILURE, 502);
        }

        await finish('ok', result.generationIds, result.creditedGenerationIds, result.usage);
        return c.json(result.response, 200);
      } catch (err) {
        await settleFailedUnaryRequest(usageStore, requestId, clock, err, requestLog, settlementUsage);
        throw err;
      } finally {
        release();
      }
    },
  );

  return app;
}
