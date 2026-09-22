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
import type { ModelClient, ModelDelta, ModelRequest, ModelStream } from '../src/generation/model';
import { loadContentPolicyDocument } from '../src/generation/prompts/inputs';
import {
  ModelContentPolicy,
  PolicyUnavailableError,
  cachedPolicy,
  buildClarifyPolicyInput,
  buildRewritePolicyInput,
  buildGeneratePolicyInput,
  type ContentPolicy,
  type PolicyCheckResult,
  type PolicyVerdict,
} from '../src/policy';

const repoRoot = path.resolve(process.cwd());
const CATEGORIES = loadContentPolicyDocument(repoRoot).categories;
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
      eq('prose reply keeps the completed classifier usage', err.usage, ZERO_USAGE);
      eq('prose reply keeps the completed classifier generation id', err.generationId, 'gen-policy-fake');
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
      eq('known-id transport error keeps the provider id', failure.generationId, 'gen-policy-failed');
      eq('known-id transport error has no completed usage', failure.usage, undefined);
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
    eq('a model verdict carries the call\'s usage', result.usage, CLASSIFIER_USAGE);
    eq('a model verdict carries the call\'s generation id', result.generationId, 'gen-classifier-1');
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
    check('setup: the fresh call carried usage', first.usage !== undefined);
    const second = await cached.check(input, 'generate');
    eq('a cached verdict carries no usage', second.usage, undefined);
    eq('a cached verdict carries no generation id', second.generationId, undefined);
  }

}

// ── §The classifier is a bounded call on the configured rewrite model ────────

async function testClassifierBounds(): Promise<void> {
  section('ModelContentPolicy — bounded call: model id, no reasoning, small output cap, document categories');

  const client = fakeClient(() => textStream('{"verdict":"allow"}'));
  await policyOn(client).check('hello there', 'generate');
  const req = client.lastRequest!;

  eq('the rewrite model id is used verbatim', req.model, REWRITE_MODEL_ID);
  eq('output is bounded: no reasoning stream requested', req.reasoning, false);
  check(
    'the classifier system message carries the document categories text verbatim',
    req.messages.some((m) => m.role === 'system' && m.content.includes(CATEGORIES)),
  );
  check(
    'the classified text reaches the user message, framed as data',
    req.messages.some((m) => m.role === 'user' && m.content.includes('hello there')),
  );
}

// ── §The check covers all user-authored text in the request; source is excluded ──

async function testInputCoverage(): Promise<void> {
  section('Canonical policy input — every route, source excluded');

  const clarifyInput = buildClarifyPolicyInput({ prompt: 'a habit tracker' });
  check('clarify input carries the prompt', clarifyInput.includes('a habit tracker'));

  const rewriteRequest: RewriteRequest = {
    prompt: 'add a streak count',
    clarifications: [{ id: 'q1', question: 'daily or weekly?', answer: 'daily, track drinking' }],
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
    clarifications: [{ id: 'q1', question: 'currency?', answer: 'USD, no gambling odds' }],
    app: { source: 'DO-NOT-SEND-THIS-SOURCE-TEXT', manifest: { capabilities: [] }, schema: {} },
  };
  const generateInput = buildGeneratePolicyInput(generateRequest);
  check('generate input carries the prompt', generateInput.includes('a tip splitter'));
  check('generate input carries the clarification answer', generateInput.includes('USD, no gambling odds'));
  check('generate input never carries app.source', !generateInput.includes('DO-NOT-SEND-THIS-SOURCE-TEXT'));

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
        return { verdict: await next() };
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

  {
    const { policy: inner } = countingPolicy(() => ({ refuse: 'graphic violence or gore' }));
    const cached = cachedPolicy(inner);
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
    eq('first record: carries the category', records[0]?.category, 'graphic violence or gore');
    eq('second record: cached-refuse verdict', records[1]?.verdict, 'cached-refuse');
    eq('second record: still carries the category', records[1]?.category, 'graphic violence or gore');
    check('the checked text never appears in the captured log output', capture.raw.every((line) => !line.includes(MARKER)));
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
  await testClassifierBounds();
  await testInputCoverage();
  await testCache();
  await testLogContent();
}
