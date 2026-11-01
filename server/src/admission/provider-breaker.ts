/**
 * server/src/admission/provider-breaker.ts — the process-level provider circuit breaker
 * (generation-reliability D8; specs/server-admission-control "The provider breaker counts
 * consecutive upstream failures", "...opens for a cooldown and says so in the log", "An open
 * provider breaker refuses admission", "A lazy probe decides when the provider breaker closes").
 *
 * It counts consecutive upstream model failures (`../model-failure.ts`, fed at the model-client
 * seam by `withProviderBreaker`). `failures` of them within `windowMs` of the first open it for
 * `cooldownMs`; while open, admission refuses without touching the provider. There is no timer:
 * the first `admit()` after the cooldown runs one shared probe (the pattern of `./credit.ts`'s
 * in-flight lookup), and every admission arriving meanwhile awaits that same probe. A completed
 * call to the engineer model, or a probe that did not fail upstream, closes it; a probe that
 * failed upstream re-opens it. Only the engineer model's calls are counted (the probe checks that
 * model too): an outage of the model the policy, clarify, rewrite and summary roles use alone is
 * not the breaker's to see. State is in memory: the server runs as one Cloud Run instance.
 *
 * Logs carry counts, durations and the closed `errorKind`/`status` vocabulary, never content.
 */
import type { ServerConfig } from '../config';
import type { ModelClient, ModelDelta, ModelRequest, ModelRoster, ModelStream } from '../generation/model';
import type { ServerLogger } from '../logger';
import { modelFailureOf, type ModelFailure } from '../model-failure';

export const PROVIDER_BREAKER_OPEN_MESSAGE = 'provider breaker open';
export const PROVIDER_BREAKER_CLOSED_MESSAGE = 'provider breaker closed';
export const PROVIDER_PROBE_FAILED_MESSAGE = 'provider probe failed';

/** How long the probe may take before it counts as a failure. */
export const PROVIDER_PROBE_TIMEOUT_MS = 10_000;

/** What one model call came to, as the breaker reads it: it completed, or it failed (and the
 *  classifier says whether the provider was at fault). */
export type ProviderOutcome = 'completed' | ModelFailure;

export type BreakerAdmission = { ok: true } | { ok: false; retryAfterSeconds: number };

export interface ProviderBreaker {
  record(outcome: ProviderOutcome): void;
  /** Resolves at once unless the cooldown has just passed, when it resolves with the probe's result. */
  admit(): Promise<BreakerAdmission>;
}

/** One cheap call to the provider. Resolves when it completed, rejects when it failed. The signal
 *  aborts after `PROVIDER_PROBE_TIMEOUT_MS`; the breaker does not rely on the call honoring it. */
export type ProviderProbe = (signal: AbortSignal) => Promise<void>;

export interface ProviderBreakerOptions {
  /** Consecutive upstream failures that open the breaker; `0` disables it. */
  failures: number;
  windowMs: number;
  cooldownMs: number;
  /** Epoch milliseconds — `ServerConfig.now`. */
  clock: () => number;
  log: ServerLogger;
  probe: ProviderProbe;
  /** Starts the probe's time limit: a signal that aborts with a `TimeoutError` reason after
   *  `timeoutMs`, and a way to stop the timer. Defaults to a real timer; a test supplies its own. */
  probeDeadline?: (timeoutMs: number) => { signal: AbortSignal; cancel(): void };
}

type State =
  | { kind: 'closed'; count: number; firstAt: number }
  | { kind: 'open'; openedAt: number; until: number }
  | { kind: 'probing'; openedAt: number; result: Promise<BreakerAdmission> };

function timerDeadline(timeoutMs: number): { signal: AbortSignal; cancel(): void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), timeoutMs);
  timer.unref();
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export function createProviderBreaker(options: ProviderBreakerOptions): ProviderBreaker {
  const { failures, windowMs, cooldownMs, clock, log, probe, probeDeadline = timerDeadline } = options;
  let state: State = { kind: 'closed', count: 0, firstAt: 0 };

  const refusal = (until: number): BreakerAdmission => ({
    ok: false,
    retryAfterSeconds: Math.ceil((until - clock()) / 1000),
  });

  const close = (openedAt: number, probeFailure?: ModelFailure): void => {
    state = { kind: 'closed', count: 0, firstAt: 0 };
    log.info(
      {
        openMs: clock() - openedAt,
        ...(probeFailure ? { errorKind: probeFailure.errorKind } : {}),
        ...(probeFailure?.status !== undefined ? { status: probeFailure.status } : {}),
      },
      PROVIDER_BREAKER_CLOSED_MESSAGE,
    );
  };

  const recordFailure = (failure: ModelFailure): void => {
    if (!failure.upstream || state.kind !== 'closed') return;
    const now = clock();
    const restart = state.count === 0 || now - state.firstAt > windowMs;
    const count = restart ? 1 : state.count + 1;
    const firstAt = restart ? now : state.firstAt;
    if (count < failures) {
      state = { kind: 'closed', count, firstAt };
      return;
    }
    state = { kind: 'open', openedAt: now, until: now + cooldownMs };
    log.warn(
      { failures: count, windowMs, cooldownMs, errorKind: failure.errorKind, ...(failure.status !== undefined ? { status: failure.status } : {}) },
      PROVIDER_BREAKER_OPEN_MESSAGE,
    );
  };

  /** What a waiter on a probe that is no longer the breaker's current one is told: how things stand. */
  const currentVerdict = (): BreakerAdmission | Promise<BreakerAdmission> => {
    if (state.kind === 'closed') return { ok: true };
    return state.kind === 'open' ? refusal(state.until) : state.result;
  };

  const onProbeSettled = (
    openedAt: number,
    isCurrent: () => boolean,
    failure: ModelFailure | undefined,
  ): BreakerAdmission | Promise<BreakerAdmission> => {
    if (failure !== undefined) {
      log.warn(
        { errorKind: failure.errorKind, ...(failure.status !== undefined ? { status: failure.status } : {}) },
        PROVIDER_PROBE_FAILED_MESSAGE,
      );
    }
    // A call that completed while the probe was out has already closed the breaker, and it may have
    // opened again since: a probe that is no longer the current state has no say.
    if (!isCurrent()) return currentVerdict();
    // Only an upstream failure says the provider is still down. A probe refused for any other
    // reason (a 402, a 401, a 400) would fail the same way every time, and an open breaker refuses
    // before the credit check: it would hide `budget_exhausted` and its alert until a restart.
    if (failure === undefined || !failure.upstream) {
      close(openedAt, failure);
      return { ok: true };
    }
    const until = clock() + cooldownMs;
    state = { kind: 'open', openedAt, until };
    log.warn(
      { reopened: true, windowMs, cooldownMs, errorKind: failure.errorKind, ...(failure.status !== undefined ? { status: failure.status } : {}) },
      PROVIDER_BREAKER_OPEN_MESSAGE,
    );
    return refusal(until);
  };

  const startProbe = (openedAt: number): Promise<BreakerAdmission> => {
    const deadline = probeDeadline(PROVIDER_PROBE_TIMEOUT_MS);
    const { signal } = deadline;
    const expired = new Promise<never>((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    // An async function runs the probe at once, and turns a synchronous throw into a failed probe.
    const attempt = (async () => probe(signal))();
    const isCurrent = (): boolean => state.kind === 'probing' && state.result === result;
    const result: Promise<BreakerAdmission> = Promise.race([attempt, expired])
      .then(
        () => onProbeSettled(openedAt, isCurrent, undefined),
        (err: unknown) => onProbeSettled(openedAt, isCurrent, modelFailureOf(err, signal)),
      )
      .finally(deadline.cancel);
    state = { kind: 'probing', openedAt, result };
    return result;
  };

  return {
    record(outcome) {
      if (failures === 0) return;
      if (outcome !== 'completed') {
        recordFailure(outcome);
      } else if (state.kind === 'closed') {
        state = { kind: 'closed', count: 0, firstAt: 0 };
      } else {
        close(state.openedAt);
      }
    },

    admit() {
      if (failures === 0 || state.kind === 'closed') return Promise.resolve({ ok: true });
      if (state.kind === 'probing') return state.result;
      if (clock() < state.until) return Promise.resolve(refusal(state.until));
      return startProbe(state.openedAt);
    },
  };
}

/** Streams `deltas` through, then records how the call came to an end: the iterator finishing is a
 *  completed call, a throw is a failure classified under the signal the call ran with. A consumer
 *  that stops early ends the call as neither. */
async function* observeDeltas(deltas: AsyncIterable<ModelDelta>, signal: AbortSignal | undefined, breaker: ProviderBreaker): AsyncGenerator<ModelDelta> {
  try {
    yield* deltas;
  } catch (err) {
    breaker.record(modelFailureOf(err, signal));
    throw err;
  }
  breaker.record('completed');
}

/** The feed (D8): wraps the one client every role shares, so each call to the engineer model
 *  reaches the breaker. A call to any other model neither counts nor resets, and every stream
 *  passes through untouched. */
export function withProviderBreaker(inner: ModelClient, breaker: ProviderBreaker, engineerModel: string): ModelClient {
  return {
    stream(req: ModelRequest, signal?: AbortSignal): ModelStream {
      const stream = inner.stream(req, signal);
      if (req.model !== engineerModel) return stream;
      return { ...stream, deltas: observeDeltas(stream.deltas, signal, breaker) };
    },
  };
}

const PROBE_PROMPT = 'Reply with one word: ok.';

/** The probe: one output token from the engineer model, reasoning off, through the inner client
 *  the decorator does not wrap, so the probe's own outcome is not counted twice. It has its own
 *  `model call` line and writes no ledger row. */
export function createModelProbe(client: ModelClient, roster: ModelRoster): ProviderProbe {
  return async (signal) => {
    const stream = client.stream(
      {
        model: roster.engineer.model,
        messages: [{ role: 'user', content: PROBE_PROMPT }],
        maxTokens: 1,
        reasoning: 'off',
        role: 'probe',
      },
      signal,
    );
    const drained = (async (): Promise<void> => {
      const deltas = stream.deltas[Symbol.asyncIterator]();
      let step = await deltas.next();
      while (!step.done) step = await deltas.next();
    })();
    await Promise.all([drained, stream.usage]);
  };
}

export interface GuardedModel {
  model: { client: ModelClient; roster: ModelRoster };
  breaker: ProviderBreaker;
}

/** The composition root's one step (D8): builds the breaker from the configuration and wraps the
 *  client every role shares; the calls to the roster's engineer model feed it.
 *  The probe goes through the client as given, not the wrapped one. */
export function guardModel(
  model: { client: ModelClient; roster: ModelRoster },
  config: Pick<ServerConfig, 'providerBreakerFailures' | 'providerBreakerWindowMs' | 'providerBreakerCooldownMs' | 'now'>,
  breakerLog: ServerLogger,
): GuardedModel {
  const breaker = createProviderBreaker({
    failures: config.providerBreakerFailures,
    windowMs: config.providerBreakerWindowMs,
    cooldownMs: config.providerBreakerCooldownMs,
    clock: config.now,
    log: breakerLog,
    probe: createModelProbe(model.client, model.roster),
  });
  return { model: { client: withProviderBreaker(model.client, breaker, model.roster.engineer.model), roster: model.roster }, breaker };
}
