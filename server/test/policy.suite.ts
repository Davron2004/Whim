/**
 * Content policy acceptance (public-generation-server chain-4). Every scenario of
 * specs/content-policy that does not need a mounted route (task 5.5): fail-closed cases, input
 * coverage, source exclusion, model id and bounds, cache hit and no caching of unavailable, the
 * stub markers, and log content. Route-level scenarios (the actual `422`/`503` HTTP responses) are
 * chain-9/10's `routes-unary.suite.ts` / `routes-generate.suite.ts`.
 *
 * Deterministic throughout: every classifier call goes through a local fake `ModelClient` (never
 * `ScriptedModelClient`'s replay contract, which does not model an in-flight abort) or the real
 * network is never reached at all.
 */
import path from 'node:path';
import { check, eq, caught, section } from './harness';
import { captureLogs, withMessage } from './log-capture';
import type { GenerateRequest, RewriteRequest, Usage } from '@whim/contract';
import { openRouterModelClient, type ModelClient, type ModelDelta, type ModelRequest, type ModelStream } from '../src/generation/model';
import { OpenRouterClient, type FetchFn } from '../src/openrouter';
import { loadContentPolicyDocument } from '../src/generation/prompts/inputs';
import {
  ModelContentPolicy,
  PolicyUnavailableError,
  cachedPolicy,
  parseCategoryList,
  buildClarifyPolicyInput,
  buildRewritePolicyInput,
  buildGeneratePolicyInput,
  policyMetering,
  type ContentPolicy,
  type PolicyCheckResult,
  type PolicyVerdict,
} from '../src/policy';

const repoRoot = path.resolve(process.cwd());
const CATEGORIES = loadContentPolicyDocument(repoRoot).categories;
const KNOWN_CATEGORIES = parseCategoryList(CATEGORIES);
const REWRITE_MODEL_ID = 'test-vendor/rewrite-classifier-1';

// ── Fake ModelClient doubles — none of these ever touch the network ──────────

const ZERO_USAGE: Usage = { promptTokens: 3, completionTokens: 2, totalTokens: 5 };

function textStream(text: string): ModelStream {
  return {
    deltas: (async function* (): AsyncGenerator<ModelDelta> {
      yield { kind: 'text', text };
    })(),
    usage: Promise.resolve(ZERO_USAGE),
    id: Promise.resolve('gen-policy-fake'),
  };
}

/** An `AsyncIterable` whose first (and only) `next()` rejects with `err` — a plain iterator object
 *  rather than a `function*`, since a generator that never reaches a `yield` trips
 *  `sonarjs/generator-without-yield` even when the throw IS the point of the test double. */
function rejectingIterable<T>(err: unknown): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return { next: (): Promise<IteratorResult<T>> => Promise.reject(err) };
    },
  };
}

function erroringStream(err: unknown): ModelStream {
  return {
    deltas: rejectingIterable<ModelDelta>(err),
    usage: Promise.reject(err),
    id: Promise.resolve(undefined),
  };
}

/** Rejects (both the deltas iterable and `usage`) the moment `signal` aborts — the shape a real
 *  transport takes when its abort signal fires mid-request. Never resolves on its own, so a test
 *  using this MUST supply a short `timeoutMs` to `ModelContentPolicy`. */
function hangingStream(signal: AbortSignal): ModelStream {
  function abortRejection<T>(): Promise<T> {
    return new Promise<T>((_resolve, reject) => {
      const fail = (): void => reject(new Error('aborted'));
      if (signal.aborted) fail();
      else signal.addEventListener('abort', fail, { once: true });
    });
  }
  return {
    deltas: {
      [Symbol.asyncIterator](): AsyncIterator<ModelDelta> {
        return { next: (): Promise<IteratorResult<ModelDelta>> => abortRejection<never>() };
      },
    },
    usage: abortRejection<Usage>(),
    id: Promise.resolve(undefined),
  };
}

/** Replays `stream` (or invokes `behavior`) and records the last outgoing `ModelRequest`. */
function fakeClient(behavior: (req: ModelRequest, signal?: AbortSignal) => ModelStream): ModelClient & { lastRequest?: ModelRequest } {
  const client = {
    lastRequest: undefined as ModelRequest | undefined,
    stream(req: ModelRequest, signal?: AbortSignal): ModelStream {
      client.lastRequest = req;
      return behavior(req, signal);
    },
  };
  return client;
}

function policyOn(client: ModelClient, timeoutMs = 5000): ModelContentPolicy {
  return new ModelContentPolicy({ modelClient: client, rewriteModelId: REWRITE_MODEL_ID, categories: CATEGORIES, timeoutMs });
}

// ── §Fail-closed cases ────────────────────────────────────────────────────────

async function testFailClosed(): Promise<void> {
  section('ModelContentPolicy — every failure mode throws PolicyUnavailableError, never allow');

  // A timeout is not an allow. The policy's own AbortSignal.timeout timer is unref'd and nothing
  // else keeps Node alive here, so race a ref'd deadline: a policy that never times out fails this
  // check by name instead of ending the process with exit 13.
  {
    const client = fakeClient((_req, signal) => hangingStream(signal!));
    const policy = policyOn(client, 30);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<'no answer within 2s'>((resolve) => {
      timer = setTimeout(() => resolve('no answer within 2s'), 2000);
    });
    const err = await Promise.race([caught(async () => { await policy.check('some text', 'generate'); }), deadline]).finally(() =>
      clearTimeout(timer),
    );
    check('timeout: throws PolicyUnavailableError', err instanceof PolicyUnavailableError, String(err));
  }

  // Malformed classifier output (prose) is not an allow.
  {
    const client = fakeClient(() => textStream('Sure, this looks fine'));
    const policy = policyOn(client);
    const err = await caught(async () => { await policy.check('some text', 'generate'); });
    check('prose reply: throws PolicyUnavailableError', err instanceof PolicyUnavailableError);
    if (err instanceof PolicyUnavailableError) {
      eq('prose reply keeps each completed classifier call: usage and generation id', err.calls[0], { usage: ZERO_USAGE, generationId: 'gen-policy-fake' });
    }
  }

  // An unknown verdict value is not an allow.
  {
    const client = fakeClient(() => textStream('{"verdict":"maybe"}'));
    const policy = policyOn(client);
    const err = await caught(async () => { await policy.check('some text', 'generate'); });
    check('unknown verdict value: throws PolicyUnavailableError', err instanceof PolicyUnavailableError);
  }

  // A refuse verdict with no usable category is malformed, not a legitimate refusal.
  {
    const client = fakeClient(() => textStream('{"verdict":"refuse"}'));
    const policy = policyOn(client);
    const err = await caught(async () => { await policy.check('some text', 'generate'); });
    check('refuse with no category: throws PolicyUnavailableError', err instanceof PolicyUnavailableError);
  }

  // A refuse verdict with an UNKNOWN (off-list) category is still a legitimate refusal.
  {
    const client = fakeClient(() => textStream('{"verdict":"refuse","category":"not-a-listed-category"}'));
    const policy = policyOn(client);
    const result = await policy.check('some text', 'generate');
    eq('refuse with an off-list category: still a refusal', result.verdict, { refuse: 'not-a-listed-category' });
  }

  // A model transport error is not an allow.
  {
    const client = fakeClient(() => erroringStream(new Error('connection reset')));
    const policy = policyOn(client);
    const err = await caught(async () => { await policy.check('some text', 'generate'); });
    check('transport error: throws PolicyUnavailableError', err instanceof PolicyUnavailableError);
  }

  // The provider id can arrive with the first streamed chunk while the stream fails before its
  // final usage record. Preserve that id so route-level reconciliation can recover the cost.
  {
    const err = new Error('connection reset');
    const client = fakeClient(() => ({
      deltas: rejectingIterable<ModelDelta>(err),
      usage: Promise.reject(err),
      id: Promise.resolve('gen-policy-failed'),
    }));
    const failure = await caught(async () => { await policyOn(client).check('some text', 'generate'); });
    check('known-id transport error: throws PolicyUnavailableError', failure instanceof PolicyUnavailableError);
    if (failure instanceof PolicyUnavailableError) {
      eq('known-id transport error keeps the provider id and no completed usage', failure.calls, [{ generationId: 'gen-policy-failed' }]);
    }
  }

  // Every allow/refuse verdict still resolves normally.
  {
    const allowClient = fakeClient(() => textStream('{"verdict":"allow"}'));
    eq('allow verdict resolves', (await policyOn(allowClient).check('fine text', 'clarify')).verdict, 'allow');

    const refuseClient = fakeClient(() => textStream(JSON.stringify({ verdict: 'refuse', category: 'graphic violence or gore' })));
    eq('refuse verdict resolves with category', (await policyOn(refuseClient).check('bad text', 'rewrite')).verdict, {
      refuse: 'graphic violence or gore',
    });
  }

  // A ```json fenced reply still parses (json-block.ts is reused, not re-implemented).
  {
    const client = fakeClient(() => textStream('```json\n{"verdict":"allow"}\n```'));
    eq('fenced allow reply parses', (await policyOn(client).check('fine text', 'generate')).verdict, 'allow');
  }
}

// ── §The policy check is metered and observable without content (usage carriage) ──

async function testCheckResultUsage(): Promise<void> {
  section('ContentPolicy.check — the classifier call\'s own usage is carried on the result');

  const CLASSIFIER_USAGE: Usage = { promptTokens: 11, completionTokens: 4, totalTokens: 15 };

  // A fresh model call carries the classifier's own usage and generation id.
  {
    const client = fakeClient(() => ({
      deltas: (async function* (): AsyncGenerator<ModelDelta> {
        yield { kind: 'text', text: '{"verdict":"allow"}' };
      })(),
      usage: Promise.resolve(CLASSIFIER_USAGE),
      id: Promise.resolve('gen-classifier-1'),
    }));
    const result = await policyOn(client).check('some text', 'generate');
    eq('a model verdict carries the call\'s usage and generation id', result.calls, [{ usage: CLASSIFIER_USAGE, generationId: 'gen-classifier-1' }]);
  }

  // A cache hit makes no classifier call: no usage, no generation id.
  {
    const client = fakeClient(() => ({
      deltas: (async function* (): AsyncGenerator<ModelDelta> {
        yield { kind: 'text', text: '{"verdict":"allow"}' };
      })(),
      usage: Promise.resolve(CLASSIFIER_USAGE),
      id: Promise.resolve('gen-classifier-2'),
    }));
    const cached = cachedPolicy(policyOn(client));
    const input = JSON.stringify({ prompt: 'cache-usage-check' });
    const first = await cached.check(input, 'generate');
    check('setup: the fresh call carried usage', first.calls[0]?.usage !== undefined);
    const second = await cached.check(input, 'generate');
    eq('a cached verdict carries no classifier call', second.calls, []);
  }

}

// ── §A transient classifier failure is retried once inside the policy deadline ──

const NO_ANSWER = Symbol('no answer');

/** Settles with `promise`'s outcome, or `NO_ANSWER` once `ms` pass. The policy's own timers are
 *  unref'd, so a ref'd one here keeps a check that never settles from ending the suite silently. */
async function settledWithin<T>(promise: Promise<T>, ms: number): Promise<{ value: T } | { error: unknown } | typeof NO_ANSWER> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof NO_ANSWER>((resolve) => {
    timer = setTimeout(() => resolve(NO_ANSWER), ms);
  });
  try {
    return await Promise.race([promise.then((value) => ({ value }), (error: unknown) => ({ error })), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Answers each call with the next of `plan`, recording each call's signal. */
function plannedClient(plan: ReadonlyArray<(signal: AbortSignal) => ModelStream>): ModelClient & { signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  return {
    signals,
    stream(_req: ModelRequest, signal?: AbortSignal): ModelStream {
      const step = plan[signals.length];
      if (!signal || !step) throw new Error(`plannedClient: call ${signals.length + 1} was not planned`);
      signals.push(signal);
      return step(signal);
    },
  };
}

function hangingWithId(id: string): (signal: AbortSignal) => ModelStream {
  return (signal) => ({ ...hangingStream(signal), id: Promise.resolve(id) });
}

function answering(text: string, usage: Usage, id: string): () => ModelStream {
  return () => ({ ...textStream(text), usage: Promise.resolve(usage), id: Promise.resolve(id) });
}

function failingWith(err: unknown): () => ModelStream {
  return () => erroringStream(err);
}

function retryPolicy(client: ModelClient, timeoutMs: number, attemptTimeoutMs: number, clock?: SteppedClock): ModelContentPolicy {
  return new ModelContentPolicy({ modelClient: client, rewriteModelId: REWRITE_MODEL_ID, categories: CATEGORIES, timeoutMs, attemptTimeoutMs, clock });
}

/** A policy clock that moves only when the test steps it: each `timeout` signal aborts once the
 *  clock reaches its due time, as `AbortSignal.timeout` would, with no wall-clock margin involved. */
class SteppedClock {
  private at = 0;
  private readonly timers: Array<{ due: number; controller: AbortController }> = [];

  now(): number {
    return this.at;
  }

  timeout(ms: number): AbortSignal {
    const controller = new AbortController();
    this.timers.push({ due: this.at + ms, controller });
    return controller.signal;
  }

  advanceTo(at: number): void {
    this.at = at;
    for (const { due, controller } of this.timers) {
      if (due <= at && !controller.signal.aborted) controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    }
  }
}

/** Polls `condition` until it holds or `ms` of real time pass; answers whether it held. */
async function eventually(condition: () => boolean, ms = 2000): Promise<boolean> {
  const stopAt = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > stopAt) return false;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  return true;
}

async function testBoundedRetry(): Promise<void> {
  section('ModelContentPolicy — a transient failure is retried once inside WHIM_POLICY_TIMEOUT_MS (#119)');

  const SECOND_USAGE: Usage = { promptTokens: 9, completionTokens: 1, totalTokens: 10 };

  // A hung first attempt no longer fails the check: its attempt bound cuts it, and the second
  // attempt's verdict stands, well inside the deadline.
  {
    const client = plannedClient([hangingWithId('gen-hung'), answering('{"verdict":"allow"}', SECOND_USAGE, 'gen-second')]);
    const capture = captureLogs();
    const startedAt = performance.now();
    let outcome;
    try {
      outcome = await settledWithin(cachedPolicy(retryPolicy(client, 2000, 500)).check('hung then allow', 'generate'), 4000);
    } finally {
      capture.stop();
    }
    const elapsedMs = performance.now() - startedAt;
    const result = outcome !== NO_ANSWER && 'value' in outcome ? outcome.value : undefined;
    eq('hung first attempt: the second attempt\'s allow is the verdict', result?.verdict, 'allow');
    eq('hung first attempt: exactly two classifier calls', client.signals.length, 2);
    check('hung first attempt: the hung call was cancelled', client.signals[0]?.aborted === true);
    check('hung first attempt: answered within the deadline', elapsedMs < 2000, `${Math.round(elapsedMs)} ms`);
    eq('hung first attempt: both calls are carried, usage only where it arrived', result?.calls, [{ generationId: 'gen-hung' }, { usage: SECOND_USAGE, generationId: 'gen-second' }]);
    const metering = policyMetering(result?.calls ?? []);
    eq('hung first attempt: the delivered usage is credited', metering.usage, SECOND_USAGE);
    eq('hung first attempt: both ids land on the row, the hung one left to reconcile', [metering.generationIds, [...metering.creditedGenerationIds]], [['gen-hung', 'gen-second'], ['gen-second']]);
    eq('hung first attempt: the log record says attempts: 2', withMessage(capture, 'content policy check').map((r) => [r.verdict, r.attempts]), [['allow', 2]]);
  }

  // Two hung attempts fail closed, and the second is cut to what is left of the deadline: 1500 ms,
  // then the remaining 1100 ms rather than another 1500. On a stepped clock, so the check must be
  // over once the clock reaches the deadline (2600), never only at a full second bound (3000).
  {
    const clock = new SteppedClock();
    const client = plannedClient([hangingWithId('gen-hung-1'), hangingWithId('gen-hung-2')]);
    const capture = captureLogs();
    let outcome;
    try {
      const checking = cachedPolicy(retryPolicy(client, 2600, 1500, clock)).check('hung twice', 'generate');
      clock.advanceTo(1500);
      check('two timeouts: the first attempt\'s bound starts the second attempt', await eventually(() => client.signals.length === 2));
      clock.advanceTo(2600);
      // Settles on microtasks alone once the clock is at the deadline; the real-time cap only names a
      // check that did not.
      outcome = await settledWithin(checking, 4000);
    } finally {
      capture.stop();
    }
    const error = outcome !== NO_ANSWER && 'error' in outcome ? outcome.error : undefined;
    check('two timeouts: answered by the deadline, not a full attempt bound past it', outcome !== NO_ANSWER, 'still pending with the clock at the deadline');
    check('two timeouts: fails closed with PolicyUnavailableError', error instanceof PolicyUnavailableError, String(error));
    eq('two timeouts: exactly two classifier calls', client.signals.length, 2);
    check('two timeouts: the second call was cancelled at the deadline', client.signals[1]?.aborted === true);
    eq('two timeouts: both calls\' ids are carried for reconciliation', error instanceof PolicyUnavailableError ? error.calls : undefined, [{ generationId: 'gen-hung-1' }, { generationId: 'gen-hung-2' }]);
    eq('two timeouts: the log record says unavailable after 2 attempts', withMessage(capture, 'content policy check').map((r) => [r.verdict, r.attempts]), [['unavailable', 2]]);
  }

  // Less than 1000 ms of the deadline left after the first attempt: no second one.
  {
    const client = plannedClient([hangingWithId('gen-late'), answering('{"verdict":"allow"}', SECOND_USAGE, 'gen-unused')]);
    const outcome = await settledWithin(retryPolicy(client, 1400, 600).check('too little time left', 'generate'), 4000);
    check('too little time left: fails closed', outcome !== NO_ANSWER && 'error' in outcome && outcome.error instanceof PolicyUnavailableError);
    eq('too little time left: one classifier call', client.signals.length, 1);
  }

  // A verdict is final: a refusal is never retried.
  {
    const client = plannedClient([
      answering(JSON.stringify({ verdict: 'refuse', category: 'graphic violence or gore' }), SECOND_USAGE, 'gen-refuse'),
      answering('{"verdict":"allow"}', SECOND_USAGE, 'gen-unused'),
    ]);
    const outcome = await settledWithin(retryPolicy(client, 5000, 500).check('refused text', 'generate'), 4000);
    eq('refusal: the refusal stands', outcome !== NO_ANSWER && 'value' in outcome ? outcome.value.verdict : outcome, { refuse: 'graphic violence or gore' });
    eq('refusal: exactly one classifier call', client.signals.length, 1);
  }

  // A client that left is not retried for.
  {
    const request = new AbortController();
    const client = plannedClient([
      (signal) => {
        queueMicrotask(() => request.abort());
        return hangingWithId('gen-left')(signal);
      },
      answering('{"verdict":"allow"}', SECOND_USAGE, 'gen-unused'),
    ]);
    const outcome = await settledWithin(retryPolicy(client, 5000, 4500).check('client left', 'generate', request.signal), 4000);
    check('aborted request: fails closed', outcome !== NO_ANSWER && 'error' in outcome && outcome.error instanceof PolicyUnavailableError);
    eq('aborted request: no second attempt', client.signals.length, 1);
  }

  // An upstream failure (a provider 5xx) is retried; an auth failure, which a retry cannot fix, is not.
  {
    const upstream = Object.assign(new Error('OpenRouter: HTTP 503'), { kind: 'network', status: 503 });
    const client = plannedClient([failingWith(upstream), answering('{"verdict":"allow"}', SECOND_USAGE, 'gen-after-5xx')]);
    const outcome = await settledWithin(retryPolicy(client, 5000, 500).check('provider blip', 'generate'), 4000);
    eq('provider 5xx: retried, and the retry\'s allow stands', outcome !== NO_ANSWER && 'value' in outcome ? outcome.value.verdict : outcome, 'allow');

    const auth = Object.assign(new Error('OpenRouter: unauthorized (401)'), { kind: 'auth' });
    const authClient = plannedClient([failingWith(auth), answering('{"verdict":"allow"}', SECOND_USAGE, 'gen-unused')]);
    const authOutcome = await settledWithin(retryPolicy(authClient, 5000, 500).check('bad key', 'generate'), 4000);
    check('auth error: fails closed', authOutcome !== NO_ANSWER && 'error' in authOutcome && authOutcome.error instanceof PolicyUnavailableError);
    eq('auth error: exactly one classifier call', authClient.signals.length, 1);
  }
}

// ── §The classifier is a bounded call on the configured rewrite model ────────

async function testClassifierBounds(): Promise<void> {
  section('ModelContentPolicy — bounded call: model id, no reasoning, small output cap, document categories');

  const client = fakeClient(() => textStream('{"verdict":"allow"}'));
  await policyOn(client).check('hello there', 'generate');
  const req = client.lastRequest!;

  eq('the rewrite model id is used verbatim', req.model, REWRITE_MODEL_ID);
  eq('output is bounded: no reasoning stream requested', req.reasoning, 'off');
  eq('the call is labeled policy (design D4)', req.role, 'policy');
  check(
    'the classifier system message carries the document categories text verbatim',
    req.messages.some((m) => m.role === 'system' && m.content.includes(CATEGORIES)),
  );
  check(
    'the classified text reaches the user message, framed as data',
    req.messages.some((m) => m.role === 'user' && m.content.includes('hello there')),
  );
}

/** A fetch double that answers an allow verdict over a real SSE stream and captures the outgoing
 *  request body — the wire the classifier's call actually reaches, through the REAL
 *  `OpenRouterClient` rather than `ModelContentPolicy`'s injected fake. */
function allowVerdictWireFetch(captured: { body?: Record<string, unknown> }): FetchFn {
  return (async (_input, init) => {
    captured.body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"id":"gen-classifier-wire","choices":[{"index":0,"delta":{"content":"{\\"verdict\\":\\"allow\\"}"}}]}\n\n'),
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as FetchFn;
}

/**
 * Red-check target (design D1): the classifier's wire request explicitly disables reasoning
 * through the REAL `OpenRouterClient`, never `ModelContentPolicy`'s injected fake. Fails against
 * the pre-change wire mapping `...(options.reasoning ? { reasoning: { enabled: true } } : {})`,
 * because `'off'` is a non-empty (truthy) string: that mapping would send `{enabled:true}` instead.
 */
async function testClassifierWireReasoningIsExplicitlyOff(): Promise<void> {
  section("ModelContentPolicy — the classifier's OWN wire request explicitly disables reasoning (design D1)");

  const captured: { body?: Record<string, unknown> } = {};
  const client = openRouterModelClient(new OpenRouterClient(allowVerdictWireFetch(captured)));
  const policy = new ModelContentPolicy({ modelClient: client, rewriteModelId: REWRITE_MODEL_ID, categories: CATEGORIES, timeoutMs: 5000 });
  const result = await policy.check('hello there', 'generate');

  eq('the classifier call still resolves normally', result.verdict, 'allow');
  check('setup: the outgoing wire body was captured', captured.body !== undefined);
  eq('the wire body explicitly disables reasoning', captured.body?.reasoning, { enabled: false });
}

// ── §The check covers all user-authored text in the request; source is excluded ──

async function testInputCoverage(): Promise<void> {
  section('Canonical policy input — every route, source excluded');

  const clarifyInput = buildClarifyPolicyInput({ prompt: 'a habit tracker' });
  check('clarify input carries the prompt', clarifyInput.includes('a habit tracker'));

  const rewriteRequest: RewriteRequest = {
    prompt: 'add a streak count',
    clarifications: [{ id: 'q1', question: 'daily or weekly?', choices: ['daily, track drinking'] }],
    app: { name: 'Habit Tracker', collections: [{ name: 'Completions', fields: ['Date', 'Note'] }] },
  };
  const rewriteInput = buildRewritePolicyInput(rewriteRequest);
  check('rewrite input carries the prompt', rewriteInput.includes('add a streak count'));
  check('rewrite input carries the clarification question', rewriteInput.includes('daily or weekly?'));
  check('rewrite input carries the clarification answer', rewriteInput.includes('daily, track drinking'));
  check('rewrite input carries the app name', rewriteInput.includes('Habit Tracker'));
  check('rewrite input carries collection and field display names', rewriteInput.includes('Completions') && rewriteInput.includes('Date') && rewriteInput.includes('Note'));

  const generateRequest: GenerateRequest = {
    prompt: 'a tip splitter',
    clarifications: [{ id: 'q1', question: 'currency?', choices: ['USD, no gambling odds'] }],
    app: { source: 'DO-NOT-SEND-THIS-SOURCE-TEXT', manifest: { capabilities: [] }, schema: {} },
  };
  const generateInput = buildGeneratePolicyInput(generateRequest);
  check('generate input carries the prompt', generateInput.includes('a tip splitter'));
  check('generate input carries the clarification answer', generateInput.includes('USD, no gambling odds'));
  check('generate input never carries app.source', !generateInput.includes('DO-NOT-SEND-THIS-SOURCE-TEXT'));

  // beta-1 D18: a typed `other` answer is judged in the same input as the prompt, on both routes,
  // and a delegated question adds no marker of its own.
  const typedOther = 'TYPED-OTHER-ANSWER-4c1d';
  const withOther = [{ id: 'q2', question: 'anything else?', choices: ['Metric'], other: typedOther }];
  check('rewrite input carries a typed other answer', buildRewritePolicyInput({ prompt: 'a converter', clarifications: withOther }).includes(typedOther));
  check('generate input carries a typed other answer', buildGeneratePolicyInput({ prompt: 'a converter', clarifications: withOther }).includes(typedOther));
  eq(
    'a delegated question adds nothing beyond the question itself',
    buildRewritePolicyInput({ prompt: 'a converter', clarifications: [{ id: 'q3', question: 'which units?', choices: [], decide: true }] }),
    buildRewritePolicyInput({ prompt: 'a converter', clarifications: [{ id: 'q3', question: 'which units?', choices: [] }] }),
  );

  // "Source is not sent to the classifier": the OUTGOING classifier request for a GenerateRequest
  // with a source carries the prompt/clarification text and no part of the source.
  const client = fakeClient(() => textStream('{"verdict":"allow"}'));
  await policyOn(client).check(generateInput, 'generate');
  const sentContent = client.lastRequest!.messages.map((m) => m.content).join('\n');
  check('classifier request carries the prompt', sentContent.includes('a tip splitter'));
  check('classifier request carries the clarification text', sentContent.includes('USD, no gambling odds'));
  check('classifier request carries no part of app.source', !sentContent.includes('DO-NOT-SEND-THIS-SOURCE-TEXT'));

}

// ── §Verdicts are cached in memory only ───────────────────────────────────────

function countingPolicy(next: () => PolicyVerdict | Promise<PolicyVerdict>): { policy: ContentPolicy; calls: () => number } {
  let calls = 0;
  return {
    policy: {
      async check(): Promise<PolicyCheckResult> {
        calls += 1;
        return { verdict: await next(), calls: [{}] };
      },
    },
    calls: () => calls,
  };
}

function countingUnavailablePolicy(message: string): { policy: ContentPolicy; calls: () => number } {
  let calls = 0;
  return {
    policy: {
      async check(): Promise<PolicyCheckResult> {
        calls += 1;
        throw new PolicyUnavailableError(message);
      },
    },
    calls: () => calls,
  };
}

async function testCache(): Promise<void> {
  section('cachedPolicy — same input checks once, unavailable is never cached, TTL and LRU bounds hold');

  // Clarify then rewrite of the SAME input checks once, regardless of route.
  {
    const { policy: inner, calls } = countingPolicy(() => 'allow');
    const cached = cachedPolicy(inner);
    const input = JSON.stringify({ prompt: 'same prompt text' });
    eq('first check (clarify route): allow', (await cached.check(input, 'clarify')).verdict, 'allow');
    eq('second check, same input (rewrite route): allow, no new classifier call', (await cached.check(input, 'rewrite')).verdict, 'allow');
    eq('exactly one classifier call across both requests', calls(), 1);
  }

  // A refuse verdict is cached the same way.
  {
    const { policy: inner, calls } = countingPolicy(() => ({ refuse: 'gore' }));
    const cached = cachedPolicy(inner);
    const input = JSON.stringify({ prompt: 'refused text' });
    await cached.check(input, 'generate');
    await cached.check(input, 'generate');
    eq('a cached refuse verdict is served without a second classifier call', calls(), 1);
  }

  // An unavailable result is retried, never remembered.
  {
    const { policy: inner, calls } = countingUnavailablePolicy('down');
    const cached = cachedPolicy(inner);
    const input = JSON.stringify({ prompt: 'flaky text' });
    await caught(async () => { await cached.check(input, 'generate'); });
    await caught(async () => { await cached.check(input, 'generate'); });
    eq('an unavailable result is never cached: the classifier is called every time', calls(), 2);
  }

  // The cache is keyed by input alone, not (route, input) — a different route with DIFFERENT input
  // still calls the classifier.
  {
    const { policy: inner, calls } = countingPolicy(() => 'allow');
    const cached = cachedPolicy(inner);
    await cached.check(JSON.stringify({ prompt: 'a' }), 'clarify');
    await cached.check(JSON.stringify({ prompt: 'b' }), 'rewrite');
    eq('different input calls the classifier again', calls(), 2);
  }

  // TTL: an injected clock lets the test move time forward deterministically.
  {
    let clock = 0;
    const { policy: inner, calls } = countingPolicy(() => 'allow');
    const cached = cachedPolicy(inner, { ttlMs: 1000, now: () => clock });
    const input = JSON.stringify({ prompt: 'ttl text' });
    await cached.check(input, 'generate');
    clock += 999;
    await cached.check(input, 'generate');
    eq('within the TTL: still one classifier call', calls(), 1);
    clock += 2;
    await cached.check(input, 'generate');
    eq('past the TTL: the classifier is called again', calls(), 2);
  }

  // Bounded entry count: the least-recently-used entry is evicted first.
  {
    const { policy: inner, calls } = countingPolicy(() => 'allow');
    const cached = cachedPolicy(inner, { maxEntries: 2 });
    await cached.check(JSON.stringify({ prompt: 'lru-a' }), 'generate');
    await cached.check(JSON.stringify({ prompt: 'lru-b' }), 'generate');
    await cached.check(JSON.stringify({ prompt: 'lru-a' }), 'generate');
    eq('refreshing A is a cache hit', calls(), 2);
    await cached.check(JSON.stringify({ prompt: 'lru-c' }), 'generate');
    eq('adding C calls the classifier once', calls(), 3);
    await cached.check(JSON.stringify({ prompt: 'lru-a' }), 'generate');
    eq('recently used A survives eviction when C is added', calls(), 3);
    await cached.check(JSON.stringify({ prompt: 'lru-b' }), 'generate');
    eq('least recently used B was evicted and is classified again', calls(), 4);
  }
}

// ── §The policy check is metered and observable without content ─────────────

async function testLogContent(): Promise<void> {
  section('cachedPolicy — one content-free log record per check');

  const MARKER = 'DISTINCTIVE-POLICY-LOG-MARKER-1234';

  {
    const { policy: inner } = countingPolicy(() => 'allow');
    const cached = cachedPolicy(inner);
    const capture = captureLogs();
    let records;
    try {
      await cached.check(`{"prompt":"${MARKER}"}`, 'generate');
      records = withMessage(capture, 'content policy check');
    } finally {
      capture.stop();
    }
    check('allow: exactly one log record', records.length === 1);
    check('allow: log carries the route', records[0]?.route === 'generate');
    check('allow: log carries the verdict', records[0]?.verdict === 'allow');
    check('allow: log carries a duration', typeof records[0]?.durationMs === 'number');
    check('allow: log carries no category', records[0]?.category === undefined);
    check('the checked text never appears in the captured log output', capture.raw.every((line) => !line.includes(MARKER)));
  }

  // A category that matches the policy document's own list (case-insensitively) is logged as
  // itself — `cachedPolicy` is wired with `knownCategories`, as the real composition root does.
  {
    const { policy: inner } = countingPolicy(() => ({ refuse: 'graphic violence or gore' }));
    const cached = cachedPolicy(inner, { knownCategories: KNOWN_CATEGORIES });
    const capture = captureLogs();
    let records;
    const input = `{"prompt":"${MARKER}-refuse"}`;
    try {
      await cached.check(input, 'rewrite');
      await cached.check(input, 'rewrite'); // second: served from cache
      records = withMessage(capture, 'content policy check');
    } finally {
      capture.stop();
    }
    eq('refuse then cache hit: two log records', records.length, 2);
    eq('first record: fresh refuse verdict', records[0]?.verdict, 'refuse');
    eq('first record: a known category is logged as itself', records[0]?.category, 'graphic violence or gore');
    eq('second record: cached-refuse verdict', records[1]?.verdict, 'cached-refuse');
    eq('second record: still carries the category', records[1]?.category, 'graphic violence or gore');
    check('the checked text never appears in the captured log output', capture.raw.every((line) => !line.includes(MARKER)));
  }

  // A classifier can echo arbitrary user-derived text as `category` (`parseVerdict` accepts any
  // non-empty string — `policy.suite.ts`'s own "off-list category: still a refusal" case above).
  // That free text MUST NOT reach the log: it is folded to `'other'`, and none of it appears on any
  // captured line, even though the verdict itself still refuses (spec "unknown category as a
  // refusal" governs the verdict only).
  {
    const leakedText = 'Alice owes 40 for Lisbon';
    const { policy: inner } = countingPolicy(() => ({ refuse: leakedText }));
    const cached = cachedPolicy(inner, { knownCategories: KNOWN_CATEGORIES });
    const capture = captureLogs();
    let records;
    try {
      await cached.check(`{"prompt":"${MARKER}-offlist"}`, 'generate');
      records = withMessage(capture, 'content policy check');
    } finally {
      capture.stop();
    }
    eq('off-list category: one log record', records.length, 1);
    eq('off-list category: verdict is still refuse', records[0]?.verdict, 'refuse');
    eq('off-list category logs as "other"', records[0]?.category, 'other');
    check('the off-list category text never appears in the captured log output', capture.raw.every((line) => !line.includes('Alice')));
  }

  {
    const { policy: inner } = countingUnavailablePolicy('classifier down');
    const cached = cachedPolicy(inner);
    const capture = captureLogs();
    let records;
    try {
      await caught(async () => { await cached.check(`{"prompt":"${MARKER}-unavailable"}`, 'clarify'); });
      records = withMessage(capture, 'content policy check');
    } finally {
      capture.stop();
    }
    eq('unavailable: one log record', records.length, 1);
    eq('unavailable: verdict is "unavailable"', records[0]?.verdict, 'unavailable');
    check('unavailable: no category field', records[0]?.category === undefined);
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

export async function runPolicyTests(): Promise<void> {
  section('Content policy');
  await testFailClosed();
  await testCheckResultUsage();
  await testBoundedRetry();
  await testClassifierBounds();
  await testClassifierWireReasoningIsExplicitlyOff();
  await testInputCoverage();
  await testCache();
  await testLogContent();
}
