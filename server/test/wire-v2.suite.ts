/**
 * server/test/wire-v2.suite.ts — the shell-redesign-v2 wire seam: the clarify exchange, the
 * post-run summariser, the rewrite endpoint's plan rows, and the declared tile colour.
 *
 * Deterministic: no network, no Chromium, every model turn through `ScriptedModelClient`. The
 * tile-colour section is the one that reaches the real static checker (`createCheckStage`) — on
 * purpose, because the whole claim being tested is "the colour comes from the ONE extraction that
 * already yields capabilities", which a fake check stage could not falsify.
 */
import { check, deepEqual, eq, section } from './harness';
import { readSseResponse } from './sse-reader';
import { ScriptedModelClient, type ScriptedTurn } from './scripted-model';
import { createApp } from '../src/app';
import { createStubPipeline, type Pipeline } from '../src/pipeline';
import { InMemoryUsageStore } from '../src/usage-store';
import { createCheckStage } from '../src/generation/stages/check';
import {
  GenerationMachine,
  type BuildOutcome,
  type BuildStage,
  type CheckReport,
  type CheckStage,
  type Clock,
  type GenerationPipelineDeps,
  type RunOutcome,
  type RunStage,
} from '../src/generation/machine';
import {
  createModelSummariser,
  resolveMarks,
  shapeSummary,
  type SummariseResult,
  type Summariser,
  type SummariserInput,
} from '../src/generation/summarise';
import type { ModelRoster } from '../src/generation/model';
import type { PromptInputs } from '../src/generation/prompts/inputs';
import {
  ClarifyResponse,
  GenerateRequest,
  GenerationEvent,
  RewriteRequest,
  RewriteResponse,
  type GenerateRequest as GenerateRequestType,
  type RunSummary,
  type WireAppRecord,
} from '@whim/contract';

// ── Shared fixtures ──────────────────────────────────────────────────────────

const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const DEVICE_HEADER = { 'x-whim-device': DEVICE_ID };
const ROSTER: ModelRoster = { rewrite: 'vendor/rewrite-1', engineer: 'vendor/engineer-1' };
const TURN_USAGE = { promptTokens: 3, completionTokens: 5, totalTokens: 8 };

const WIRE_RECORD: WireAppRecord = {
  name: 'demo',
  source: 'export default {};',
  bundle: '(()=>{})();',
  manifest: { capabilities: [] },
  schema: {},
};

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

function appWithModel(turns: ScriptedTurn[], stub = false) {
  const model = new ScriptedModelClient(ROSTER, turns);
  const usageStore = new InMemoryUsageStore();
  const app = createApp({ pipeline: createStubPipeline(0), usageStore, model, roster: ROSTER, stub });
  return { app, model, usageStore };
}

// ── §1 Contract shapes (C1, C2, C3) ──────────────────────────────────────────

function testContractShapes(): void {
  section('Wire v2 — contract shapes');

  eq('an empty questions list validates', ClarifyResponse.safeParse({ questions: [] }).success, true);

  const three = {
    questions: [
      { id: 'a', question: 'How much?', options: ['A little', 'A lot'] },
      { id: 'b', question: 'When?', options: ['Now'] },
      { id: 'c', question: 'Where?', options: ['Here', 'There'] },
    ],
  };
  eq('three questions validate', ClarifyResponse.safeParse(three).success, true);
  eq(
    'a fourth question is rejected',
    ClarifyResponse.safeParse({ questions: [...three.questions, { id: 'd', question: 'Why?', options: ['Yes'] }] })
      .success,
    false,
  );
  eq(
    'a question with no options is rejected',
    ClarifyResponse.safeParse({ questions: [{ id: 'a', question: 'How much?', options: [] }] }).success,
    false,
  );

  // Clarify is an exchange, never a stage: the ratified enum is unchanged.
  check(
    'the stage enum has no clarify member',
    !GenerationEvent.safeParse({ type: 'stage', stage: 'clarify', status: 'start' }).success,
  );
  check(
    'there is no clarify event type',
    !GenerationEvent.safeParse({ type: 'clarify', questions: [] }).success,
  );

  const clarifications = [{ id: 'a', question: 'How much?', answer: 'A lot' }];
  eq(
    'GenerateRequest carries clarification answers',
    GenerateRequest.safeParse({ prompt: 'a tip splitter', clarifications }).success,
    true,
  );
  eq(
    'RewriteRequest carries clarification answers',
    RewriteRequest.safeParse({ prompt: 'a tip splitter', clarifications }).success,
    true,
  );
  eq('clarifications are optional', GenerateRequest.safeParse({ prompt: 'a tip splitter' }).success, true);

  eq(
    'a rewrite response with no plan validates',
    RewriteResponse.safeParse({ rewrittenPrompt: 'a detailed prompt' }).success,
    true,
  );
  eq(
    'a rewrite response with plan rows validates',
    RewriteResponse.safeParse({
      rewrittenPrompt: 'a detailed prompt',
      plan: [{ label: 'What it is', text: 'A tip splitter.' }],
    }).success,
    true,
  );

  const summary: RunSummary = {
    text: 'It now splits the bill evenly.',
    kind: 'Added',
    touched: ['the total'],
    marks: [{ cls: 'chg', start: 7, end: 27 }],
  };
  const withSummary = GenerationEvent.safeParse({ type: 'result', app: WIRE_RECORD, summary });
  eq('a result with a summary validates', withSummary.success, true);
  const withoutSummary = GenerationEvent.safeParse({ type: 'result', app: WIRE_RECORD });
  eq('a result without a summary validates', withoutSummary.success, true);
  check(
    'an absent summary stays absent (never defaulted)',
    withoutSummary.success && !('summary' in withoutSummary.data),
  );
  eq(
    'an out-of-set summary kind is rejected',
    GenerationEvent.safeParse({ type: 'result', app: WIRE_RECORD, summary: { ...summary, kind: 'Refactor' } }).success,
    false,
  );
}

// ── §2 The device gate covers the whole /v1 route table (C7) ─────────────────

async function testWholeRouteTableIsGated(): Promise<void> {
  section('Wire v2 — every /v1 route is gated, including new ones');

  const { app } = appWithModel([]);
  const mounted = app.routes.filter((r) => r.path.startsWith('/v1') && r.method !== 'ALL');
  const prefixMiddleware = app.routes.filter((r) => r.path === '/v1/*' && r.method === 'ALL');

  check('the /v1 route table is non-trivial', mounted.length >= 4, `found ${mounted.length}`);
  eq('the gate is mounted once, by prefix', prefixMiddleware.length, 1);
  check('the clarify route is mounted', mounted.some((r) => r.path === '/v1/clarify'));

  for (const route of mounted) {
    const res = await app.request(route.path, {
      method: route.method,
      headers: { 'content-type': 'application/json' },
      ...(route.method === 'POST' ? { body: JSON.stringify({ prompt: 'hello' }) } : {}),
    });
    eq(`${route.method} ${route.path} without a device header → 400`, res.status, 400);
    const contentType = res.headers.get('content-type') ?? '';
    check(`${route.path} rejects with JSON, not a stream`, !contentType.includes('text/event-stream'));
    const body = (await res.json()) as { error?: string; hint?: string };
    eq(`${route.path} error code`, body.error, 'missing_device_id');
    check(`${route.path} hint is non-empty`, typeof body.hint === 'string' && body.hint.length > 0);
  }
}

// ── §3 The clarify endpoint (C6) ─────────────────────────────────────────────

async function testClarifyEndpoint(): Promise<void> {
  section('Wire v2 — POST /v1/clarify');

  // The stub selector: deterministic, model-free, and it never spends a scripted turn.
  {
    const first = appWithModel([], true);
    const second = appWithModel([], true);
    const res1 = await post(first.app, '/v1/clarify', { prompt: 'a water tracker' }, DEVICE_HEADER);
    const res2 = await post(second.app, '/v1/clarify', { prompt: 'a water tracker' }, DEVICE_HEADER);
    eq('stub clarify → 200', res1.status, 200);
    const body1 = ClarifyResponse.parse(await res1.json());
    const body2 = ClarifyResponse.parse(await res2.json());
    check('stub clarify is deterministic', deepEqual(body1, body2));
    check('stub clarify asks at most three questions', body1.questions.length <= 3);
    check('stub clarify options are never empty', body1.questions.every((q) => q.options.length > 0));
    eq('stub clarify makes no model call', first.model.requests.length, 0);
  }

  // Zero questions is a success, not an error status.
  {
    const { app } = appWithModel([], true);
    const res = await post(app, '/v1/clarify', { prompt: 'a water tracker [[noclarify]]' }, DEVICE_HEADER);
    eq('nothing to ask → 200', res.status, 200);
    const body = ClarifyResponse.parse(await res.json());
    eq('nothing to ask → empty questions', body.questions.length, 0);
  }

  // A model-backed clarify: bounded, metered, and never a stream.
  {
    const over = {
      questions: [
        { id: 'a', question: 'How much?', options: ['A little', 'A lot'] },
        { id: 'b', question: 'When?', options: ['Now', 'Later'] },
        { id: 'c', question: 'Where?', options: ['Here', 'There'] },
        { id: 'd', question: 'Why?', options: ['Because'] },
      ],
    };
    const { app, model, usageStore } = appWithModel([
      { role: 'rewrite', deltas: ['```json\n', JSON.stringify(over), '\n```'], usage: TURN_USAGE },
    ]);
    const res = await post(app, '/v1/clarify', { prompt: 'a water tracker' }, DEVICE_HEADER);
    eq('model clarify → 200', res.status, 200);
    check('clarify is not a stream', !(res.headers.get('content-type') ?? '').includes('text/event-stream'));
    const parsed = ClarifyResponse.safeParse(await res.json());
    eq('model clarify body validates as ClarifyResponse', parsed.success, true);
    eq('a fourth question is dropped, not returned', parsed.success ? parsed.data.questions.length : -1, 3);
    eq('clarify used the small/fast model', model.requests[0]?.request.model, ROSTER.rewrite);
    const usage = await usageStore.read(DEVICE_ID);
    eq('clarify is metered to the calling device', usage.totalTokens, TURN_USAGE.totalTokens);
  }

  // Structural rejection before any model call.
  {
    const { app, model } = appWithModel([]);
    const res = await post(app, '/v1/clarify', { notPrompt: 'oops' }, DEVICE_HEADER);
    eq('invalid clarify body → 400', res.status, 400);
    const body = (await res.json()) as { error?: string; hint?: string };
    check('invalid clarify body → ApiError shape', typeof body.error === 'string' && (body.hint ?? '').length > 0);
    eq('invalid clarify body makes no model call', model.requests.length, 0);
  }

  // An unusable model answer is honest, never zero-questions-as-a-degraded-mode.
  {
    const { app } = appWithModel([{ role: 'rewrite', deltas: ['I am afraid I cannot do that.'], usage: TURN_USAGE }]);
    const res = await post(app, '/v1/clarify', { prompt: 'a water tracker' }, DEVICE_HEADER);
    eq('unusable clarify answer → 502', res.status, 502);
  }

  // Unconfigured, non-stub server.
  {
    const app = createApp({ pipeline: createStubPipeline(0), usageStore: new InMemoryUsageStore() });
    const res = await post(app, '/v1/clarify', { prompt: 'a water tracker' }, DEVICE_HEADER);
    eq('unconfigured clarify → 502', res.status, 502);
  }
}

// ── §4 Rewrite: clarifications in, plan rows out (C8) ────────────────────────

async function testRewriteClarificationsAndPlan(): Promise<void> {
  section('Wire v2 — POST /v1/rewrite carries answers in and plan rows out');

  const planned = {
    rewrittenPrompt: 'A water tracker that counts glasses and resets each morning.',
    plan: [
      { label: 'What it is', text: 'A tracker for glasses of water.' },
      { label: 'The screen', text: 'One screen with a big count.' },
      { label: '', text: 'dropped: no label' },
    ],
  };

  {
    const { app, model } = appWithModel([
      { role: 'rewrite', deltas: [JSON.stringify(planned)], usage: TURN_USAGE },
    ]);
    const res = await post(
      app,
      '/v1/rewrite',
      {
        prompt: 'a water tracker',
        clarifications: [{ id: 'reset', question: 'When does it reset?', answer: 'Every morning' }],
      },
      DEVICE_HEADER,
    );
    eq('rewrite with clarifications → 200', res.status, 200);
    const body = RewriteResponse.parse(await res.json());
    const sent = model.requests[0]?.request.messages.map((m) => m.content).join('\n') ?? '';
    check('the answer text reaches the model', sent.includes('Every morning'));
    check('the question text reaches the model', sent.includes('When does it reset?'));
    eq('plan rows come back', body.plan?.length, 2);
    eq('plan row label', body.plan?.[0]?.label, 'What it is');
    check('a malformed plan row is dropped', !(body.plan ?? []).some((row) => row.label === ''));
  }

  // A model that answers in plain prose still conforms: no rows, the prose is the rewrite.
  {
    const { app } = appWithModel([
      { role: 'rewrite', deltas: ['A water tracker that counts glasses.'], usage: TURN_USAGE },
    ]);
    const res = await post(app, '/v1/rewrite', { prompt: 'a water tracker' }, DEVICE_HEADER);
    const body = RewriteResponse.parse(await res.json());
    eq('plain prose becomes the rewritten prompt', body.rewrittenPrompt, 'A water tracker that counts glasses.');
    eq('plain prose yields no plan rows', body.plan, undefined);
  }
}

// ── §5 tileColor rides through the one extraction (C5) ───────────────────────

function sourceWithTileColor(declaration: string): string {
  return [
    "import { defineApp, Screen, Text } from 'vc-sdk';",
    'function Home() { return null; }',
    'export default defineApp({',
    "  name: 'demo',",
    "  initial: 'Home',",
    '  screens: { Home },',
    '  capabilities: [],',
    declaration,
    '});',
  ].join('\n');
}

function testTileColorExtraction(): void {
  section('Wire v2 — the declared tile colour comes from the one extraction');

  const stage = createCheckStage();
  const manifestFor = (declaration: string): Record<string, unknown> | undefined => {
    const report = stage.check(sourceWithTileColor(declaration), {}) as CheckReport;
    return report.manifest?.manifest;
  };

  const declared = manifestFor("  tileColor: '#2563eb',");
  eq('a declared colour reaches the manifest verbatim', declared?.tileColor, '#2563eb');
  check('capabilities still ride in the same manifest', Array.isArray(declared?.capabilities));

  eq('no declaration → no tile colour', manifestFor("  // no colour")?.tileColor, undefined);
  eq('a malformed colour is dropped', manifestFor("  tileColor: 'blue',")?.tileColor, undefined);
  eq('a short hex is dropped', manifestFor("  tileColor: '#abc',")?.tileColor, undefined);
  eq('a non-literal declaration is not extracted', manifestFor('  tileColor: someHue,')?.tileColor, undefined);

  // Reserved hues: the three status meanings, the accent and `yours` — case-insensitively.
  eq('the broken hue is dropped', manifestFor("  tileColor: '#b91c1c',")?.tileColor, undefined);
  eq('the working hue is dropped', manifestFor("  tileColor: '#0d9488',")?.tileColor, undefined);
  eq('the waiting hue is dropped', manifestFor("  tileColor: '#c9c3b8',")?.tileColor, undefined);
  eq('the accent is dropped', manifestFor("  tileColor: '#3F3D8F',")?.tileColor, undefined);
  eq('the yours brown is dropped', manifestFor("  tileColor: '#a15c07',")?.tileColor, undefined);

  const dropped = manifestFor("  tileColor: '#b91c1c',");
  check('dropping a colour leaves the rest of the manifest intact', Array.isArray(dropped?.capabilities));
}

// ── §6 The summariser's own shaping (C9) ─────────────────────────────────────

function testSummaryShaping(): void {
  section('Wire v2 — summary shaping');

  const shaped = shapeSummary(
    {
      text: 'It now remembers your glasses between days!',
      kind: 'added',
      touched: ['the count', ' the count ', '', 'the reset'],
      chg: 'remembers your glasses',
      hedge: 'between days',
    },
    'Start',
  );
  check('a summary is produced', shaped !== undefined);
  if (shaped) {
    eq('the exclamation mark is gone', shaped.text.includes('!'), false);
    eq('the kind is canonicalised into the closed set', shaped.kind, 'Added');
    eq('touched entries are deduped and trimmed', shaped.touched.length, 2);
    eq('one chg and one hedge', shaped.marks.length, 2);
    check(
      'every mark resolves inside the text',
      shaped.marks.every((m) => m.start >= 0 && m.end <= shaped.text.length && m.start < m.end),
    );
    check(
      'the chg mark covers the phrase it named',
      shaped.marks.some((m) => m.cls === 'chg' && shaped.text.slice(m.start, m.end) === 'remembers your glasses'),
    );
    check(
      'no two marks overlap',
      shaped.marks.every((a, i) => shaped.marks.every((b, j) => i === j || a.end <= b.start || b.end <= a.start)),
    );
  }

  // One sentence only, and the mark budget holds per sentence.
  const twoSentences = shapeSummary(
    { text: 'It counts glasses. It also resets each morning.', kind: 'Changed', touched: [], chg: 'counts glasses' },
    'Start',
  );
  check('only the first sentence survives', twoSentences?.text === 'It counts glasses.');

  eq('an unknown kind falls back', shapeSummary({ text: 'It works.', kind: 'Refactor' }, 'Changed')?.kind, 'Changed');
  eq('empty prose yields no summary', shapeSummary({ text: '   ' }, 'Start'), undefined);
  eq('a non-object yields no summary', shapeSummary('nope', 'Start'), undefined);

  // A phrase the model invented (not present in the text) is dropped rather than mis-anchored.
  const marks = resolveMarks('It counts glasses.', [
    { cls: 'chg', phrase: 'counts glasses' },
    { cls: 'hedge', phrase: 'never written' },
  ]);
  eq('an unresolvable phrase is dropped', marks.length, 1);
  eq('the resolved mark is the chg', marks[0]?.cls, 'chg');
  eq(
    'a mark that would overlap an existing one is dropped',
    resolveMarks('It counts glasses.', [
      { cls: 'chg', phrase: 'counts glasses' },
      { cls: 'hedge', phrase: 'glasses' },
    ]).length,
    1,
  );
}

async function testModelSummariser(): Promise<void> {
  section('Wire v2 — the model-backed summariser');

  const input: SummariserInput = {
    prompt: 'a water tracker',
    isEdit: false,
    appName: 'demo',
    capabilities: [],
    attempts: 1,
    diagnostics: [],
  };

  {
    const model = new ScriptedModelClient(ROSTER, [
      {
        role: 'rewrite',
        deltas: [JSON.stringify({ text: 'It counts your glasses.', kind: 'Start', touched: ['the count'], chg: 'counts your glasses' })],
        usage: TURN_USAGE,
      },
    ]);
    const summariser = createModelSummariser({ model, roster: ROSTER, timeoutMs: 2_000 });
    const result = await summariser.summarise(input);
    eq('the summariser produced a summary', result.summary?.text, 'It counts your glasses.');
    eq('its usage comes back for crediting', result.usage?.totalTokens, TURN_USAGE.totalTokens);
    check('no stage name leaked into the prose', !/\b(plan|generate|check|repair)\b/i.test(result.summary?.text ?? ''));
  }

  // A transport failure is not a summariser failure the run can see.
  {
    const model = new ScriptedModelClient(ROSTER, [
      { role: 'rewrite', deltas: [], usage: TURN_USAGE, error: new Error('transport exploded') },
    ]);
    const summariser = createModelSummariser({ model, roster: ROSTER, timeoutMs: 2_000 });
    const result = await summariser.summarise(input);
    eq('a model failure yields no summary and no throw', result.summary, undefined);
  }

  // A hanging model is bounded by the summariser's own timeout, not by the run.
  {
    const hanging = {
      stream: () => ({
        deltas: (async function* () {
          await new Promise<void>(() => {});
          yield '';
        })(),
        usage: new Promise<never>(() => {}),
        id: Promise.resolve(undefined),
      }),
    };
    const summariser = createModelSummariser({ model: hanging, roster: ROSTER, timeoutMs: 20 });
    const raced = await Promise.race([
      summariser.summarise(input),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 2_000)),
    ]);
    check('a hanging summariser times out', raced !== 'hung');
    eq('a timed-out summariser yields no summary', raced === 'hung' ? undefined : raced.summary, undefined);
  }
}

// ── §7 The summary rides on the terminal result event (C9) ───────────────────

const FAKE_INPUTS: PromptInputs = { sdkReference: 'fake sdk reference', fewShotExamples: [] };
const FAKE_CLOCK: Clock = { now: () => 0 };
const VALID_PLAN_JSON = JSON.stringify({
  screens: [{ name: 'Home', purpose: 'the only screen' }],
  initial: 'Home',
  state: [],
  capabilities: [],
  storageKeys: [],
});
const CHECKED = { name: 'demo', manifest: { capabilities: [] }, schema: {} };

function onceStage<T>(value: T): () => T {
  return () => value;
}

function deliveringDeps(summariser: Summariser | undefined): GenerationPipelineDeps {
  const model = new ScriptedModelClient(ROSTER, [
    { role: 'engineer', deltas: [VALID_PLAN_JSON], usage: TURN_USAGE },
    { role: 'engineer', deltas: ['export default defineApp({});'], usage: TURN_USAGE },
  ]);
  const checkReport: CheckReport = { diagnostics: [], manifest: CHECKED };
  const buildOutcome: BuildOutcome = { ok: true, result: { bundle: '(()=>{})();' } };
  const runOutcome: RunOutcome = { contained: true, diagnostics: [], record: WIRE_RECORD };
  const checkStage: CheckStage = { check: onceStage(checkReport) };
  const buildStage: BuildStage = { build: onceStage(buildOutcome) };
  const runStage: RunStage = { run: onceStage(runOutcome) };
  return {
    model,
    roster: ROSTER,
    promptInputs: FAKE_INPUTS,
    check: checkStage,
    build: buildStage,
    run: runStage,
    clock: FAKE_CLOCK,
    summariser,
  };
}

async function collect(iter: AsyncIterable<GenerationEvent>): Promise<GenerationEvent[]> {
  const out: GenerationEvent[] = [];
  for await (const event of iter) out.push(event);
  return out;
}

const REQUEST: GenerateRequestType = { prompt: 'a water tracker' };

async function testSummaryOnTerminalEvent(): Promise<void> {
  section('Wire v2 — the summary rides on the single terminal result');

  const SUMMARY: RunSummary = {
    text: 'It counts your glasses.',
    kind: 'Start',
    touched: ['the count'],
    marks: [{ cls: 'chg', start: 3, end: 22 }],
  };

  {
    const seen: SummariserInput[] = [];
    const summariser: Summariser = {
      summarise: async (received): Promise<SummariseResult> => {
        seen.push(received);
        return { summary: SUMMARY, usage: TURN_USAGE };
      },
    };
    const events = await collect(new GenerationMachine(deliveringDeps(summariser)).run(REQUEST));
    const terminals = events.filter((e) => e.type === 'result' || e.type === 'failure');
    eq('exactly one terminal event', terminals.length, 1);
    eq('the terminal is last', events.at(-1)?.type, 'result');
    const result = terminals[0];
    check('the summary rides on the result', result?.type === 'result' && deepEqual(result.summary, SUMMARY));
    check('no separate summary event exists', !events.some((e) => !['stage', 'token', 'diagnostic', 'usage', 'result'].includes(e.type)));
    check('every event still validates', events.every((e) => GenerationEvent.safeParse(e).success));
    eq('the summariser saw the run once', seen.length, 1);
    check('the summariser was handed no app record', !('record' in (seen[0] ?? {})) && !('bundle' in (seen[0] ?? {})));
    const usage = events.find((e) => e.type === 'usage');
    check(
      "the summariser's tokens are inside the run's usage",
      usage?.type === 'usage' && usage.usage.totalTokens >= TURN_USAGE.totalTokens * 3,
    );
  }

  // A summariser that throws cannot fail the run, and cannot alter what is delivered.
  {
    const summariser: Summariser = {
      summarise: async (): Promise<SummariseResult> => {
        throw new Error('summariser exploded');
      },
    };
    const events = await collect(new GenerationMachine(deliveringDeps(summariser)).run(REQUEST));
    const terminal = events.at(-1);
    eq('a throwing summariser still yields result', terminal?.type, 'result');
    check('the summary is simply absent', terminal?.type === 'result' && terminal.summary === undefined);
    check('the delivered record is untouched', terminal?.type === 'result' && deepEqual(terminal.app, WIRE_RECORD));
  }

  // A run that stays broken gets shorter prose, not warmer prose — and never a summary, because a
  // summary describes a delivered app and nothing was delivered.
  {
    const model = new ScriptedModelClient(ROSTER, [
      { role: 'engineer', deltas: ['not a plan at all'], usage: TURN_USAGE },
      { role: 'engineer', deltas: ['still not a plan'], usage: TURN_USAGE },
    ]);
    const deps: GenerationPipelineDeps = {
      ...deliveringDeps({ summarise: async (): Promise<SummariseResult> => ({ summary: SUMMARY }) }),
      model,
    };
    const events = await collect(new GenerationMachine(deps).run(REQUEST));
    const terminal = events.at(-1);
    eq('a plan that never parses ends in failure', terminal?.type, 'failure');
    if (terminal?.type === 'failure') {
      check('staying-broken prose carries no exclamation mark', !terminal.reason.includes('!'));
      check(
        'staying-broken prose carries no whim-words',
        !/\b(oops|sorry|whoops|yikes|magic|magical|poof|hooray)\b/i.test(terminal.reason),
      );
    }
    check('a failed run carries no summary', !events.some((e) => e.type === 'result'));
  }

  // No summariser at all is a conforming pipeline.
  {
    const events = await collect(new GenerationMachine(deliveringDeps(undefined)).run(REQUEST));
    const terminal = events.at(-1);
    eq('no summariser → still a result', terminal?.type, 'result');
    check('no summary is synthesized', terminal?.type === 'result' && terminal.summary === undefined);
  }
}

// ── §8 The SSE route frames the summary through unmodified (C10) ─────────────

async function testSseFramesSummaryUnmodified(): Promise<void> {
  section('Wire v2 — the SSE route neither synthesizes nor strips a summary');

  const SUMMARY: RunSummary = {
    text: 'It now resets each morning.',
    kind: 'Changed',
    touched: ['the reset', 'the count'],
    marks: [
      { cls: 'chg', start: 3, end: 25 },
      { cls: 'hedge', start: 0, end: 2 },
    ],
  };

  const pipelineWith = (summary?: RunSummary): Pipeline => ({
    async *run(): AsyncIterable<GenerationEvent> {
      yield { type: 'usage', usage: TURN_USAGE };
      yield { type: 'result', app: WIRE_RECORD, ...(summary ? { summary } : {}) };
    },
  });

  {
    const app = createApp({ pipeline: pipelineWith(SUMMARY), usageStore: new InMemoryUsageStore() });
    const res = await post(app, '/v1/generate', { prompt: 'a water tracker' }, DEVICE_HEADER);
    const { events } = await readSseResponse(res);
    const terminal = events.at(-1)?.data;
    check('the framed summary is byte-equal, marks included', terminal?.type === 'result' && deepEqual(terminal.summary, SUMMARY));
    eq('the terminal frame is named by its type', events.at(-1)?.event, 'result');
  }

  {
    const app = createApp({ pipeline: pipelineWith(), usageStore: new InMemoryUsageStore() });
    const res = await post(app, '/v1/generate', { prompt: 'a water tracker' }, DEVICE_HEADER);
    const { events } = await readSseResponse(res);
    const terminal = events.at(-1)?.data;
    check('a missing summary is not synthesized', terminal?.type === 'result' && !('summary' in terminal));
  }
}

export async function runWireV2Tests(): Promise<void> {
  testContractShapes();
  await testWholeRouteTableIsGated();
  await testClarifyEndpoint();
  await testRewriteClarificationsAndPlan();
  testTileColorExtraction();
  testSummaryShaping();
  await testModelSummariser();
  await testSummaryOnTerminalEvent();
  await testSseFramesSummaryUnmodified();
}
