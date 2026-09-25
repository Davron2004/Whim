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
import { captureLogs, withMessage } from './log-capture';
import { ScriptedModelClient, type ScriptedTurn } from './scripted-model';
import { createApp } from '../src/app';
import { createStubPipeline, type Pipeline } from '../src/pipeline';
import { InMemoryUsageStore } from '../src/usage-store';
import { createCheckStage } from '../src/generation/stages/check';
import { SHELL_COLORS, STATUS_COLORS, STATUS_COLORS_ON_INK } from '../../src/sdk/theme';
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
  type RunTrace,
} from '../src/generation/machine';
import {
  createModelSummariser,
  resolveMarks,
  shapeSummary,
  type SummariseResult,
  type Summariser,
  type SummariserInput,
} from '../src/generation/summarise';
import { defaultModelRoster, openRouterModelClient, type ModelDelta, type ModelRoster } from '../src/generation/model';
import { OpenRouterClient, type FetchFn } from '../src/openrouter';
import { PROTOCOL_HEADERS } from './route-doubles';
import type { DeviceVerifier } from '../src/device-identity';
import type { PromptInputs } from '../src/generation/prompts/inputs';
import {
  ClarifyResponse,
  GenerationEvent,
  RewriteResponse,
  type GenerateRequest as GenerateRequestType,
  type RunSummary,
  type WireAppRecord,
} from '@whim/contract';

// ── Shared fixtures ──────────────────────────────────────────────────────────

const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const DEVICE_HEADER = { 'x-whim-device': DEVICE_ID, ...PROTOCOL_HEADERS };
const ROSTER: ModelRoster = defaultModelRoster('vendor/rewrite-1', 'vendor/engineer-1');
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

// ── §2 The device gate covers the whole /v1 route table (C7) ─────────────────

async function testWholeRouteTableIsGated(): Promise<void> {
  section('Wire v2 — every /v1 route is gated, including new ones');

  const { app } = appWithModel([]);
  const mounted = app.routes.filter((r) => r.path.startsWith('/v1') && r.method !== 'ALL');
  const prefixMiddleware = app.routes.filter((r) => r.path === '/v1/*' && r.method === 'ALL');
  const routeLevelMiddleware = app.routes.filter((r) => r.path.startsWith('/v1/') && r.path !== '/v1/*' && r.method === 'ALL');

  check('the /v1 route table is non-trivial', mounted.length >= 4, `found ${mounted.length}`);
  eq('the five /v1 edge middlewares are mounted by prefix: request id, device gate, envelope, protocol level, minimum build', prefixMiddleware.length, 5);
  eq('no /v1 route mounts middleware of its own', routeLevelMiddleware.map((r) => r.path), []);
  check('the clarify route is mounted', mounted.some((r) => r.path === '/v1/clarify'));

  for (const route of mounted) {
    const res = await app.request(route.path, {
      method: route.method,
      headers: { 'content-type': 'application/json', ...PROTOCOL_HEADERS },
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

// ── §2b A substituted verifier gates every route with no route change (generation-server spec) ──

const VERIFIER_REFUSED_UUID = '55555555-5555-4555-8555-555555555555';
const VERIFIER_OTHER_UUID = '66666666-6666-4666-8666-666666666666';

/** Refuses exactly one UUID with its own `403` `ApiError`, admits everything else with the header
 *  value verbatim — design D15's "an App Attest or Play Integrity verifier can turn the shape
 *  check into a verified identity without any route change" made concrete for the test. */
function testVerifier(): DeviceVerifier {
  return {
    async verify(headers) {
      const deviceHeader = headers.get('x-whim-device');
      if (deviceHeader === VERIFIER_REFUSED_UUID) {
        return { ok: false, status: 403, body: { error: 'device_blocked', hint: 'This device is blocked.' } };
      }
      return { ok: true, deviceId: deviceHeader ?? '' };
    },
  };
}

async function testSubstitutedVerifier(): Promise<void> {
  section('Wire v2 — a substituted verifier gates every route with no route change (generation-server spec)');

  const model = new ScriptedModelClient(ROSTER, []);
  const app = createApp({
    pipeline: createStubPipeline(0),
    usageStore: new InMemoryUsageStore(),
    model,
    roster: ROSTER,
    deviceVerifier: testVerifier(),
  });

  const mounted = app.routes.filter((r) => r.path.startsWith('/v1') && r.method !== 'ALL');
  check('setup: the /v1 route table is non-trivial', mounted.length >= 4, `found ${mounted.length}`);

  for (const route of mounted) {
    const res = await app.request(route.path, {
      method: route.method,
      headers: { 'content-type': 'application/json', 'x-whim-device': VERIFIER_REFUSED_UUID, ...PROTOCOL_HEADERS },
      ...(route.method === 'POST' ? { body: JSON.stringify({ prompt: 'hello' }) } : {}),
    });
    eq(`${route.method} ${route.path} with the refused UUID → 403`, res.status, 403);
    const body = (await res.json()) as { error?: string; hint?: string };
    eq(`${route.path} carries the verifier's own error code`, body.error, 'device_blocked');
    check(`${route.path} carries the verifier's own hint`, typeof body.hint === 'string' && body.hint.length > 0);
  }
  eq('the substituted verifier made no model call', model.requests.length, 0);

  // Every other UUID is served as before, with no route change.
  const res = await app.request('/v1/usage', { headers: { 'x-whim-device': VERIFIER_OTHER_UUID, ...PROTOCOL_HEADERS } });
  eq('a non-refused UUID is served as before', res.status, 200);
}

// ── §3 The clarify endpoint (C6) ─────────────────────────────────────────────

async function testClarifyEndpoint(): Promise<void> {
  section('Wire v2 — POST /v1/clarify');

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
      { role: 'clarify', deltas: ['```json\n', JSON.stringify(over), '\n```'], usage: TURN_USAGE },
    ]);
    const res = await post(app, '/v1/clarify', { prompt: 'a water tracker' }, DEVICE_HEADER);
    eq('model clarify → 200', res.status, 200);
    check('clarify is not a stream', !(res.headers.get('content-type') ?? '').includes('text/event-stream'));
    const parsed = ClarifyResponse.safeParse(await res.json());
    eq('model clarify body validates as ClarifyResponse', parsed.success, true);
    eq('a fourth question is dropped, not returned', parsed.success ? parsed.data.questions.length : -1, 3);
    eq(
      'a question the model gives no answer mode is single-select with no typed answer',
      parsed.success ? parsed.data.questions.map((q) => [q.select, q.other]) : [],
      [['one', false], ['one', false], ['one', false]],
    );
    eq('clarify used the clarify role\'s model', model.requests[0]?.request.model, ROSTER.clarify.model);
    const usage = await usageStore.read(DEVICE_ID);
    eq('clarify is metered to the calling device', usage.totalTokens, TURN_USAGE.totalTokens);
  }

  // The model's own answer modes are kept; anything else it writes there reads as the default.
  {
    const modes = {
      questions: [
        { id: 'days', question: 'Which days?', options: ['Mon', 'Tue'], select: 'many', other: true },
        { id: 'time', question: 'What time?', options: ['Morning', 'Evening'], select: 'several', other: 'yes' },
      ],
    };
    const { app } = appWithModel([{ role: 'clarify', deltas: [JSON.stringify(modes)], usage: TURN_USAGE }]);
    const res = await post(app, '/v1/clarify', { prompt: 'a habit tracker' }, DEVICE_HEADER);
    const parsed = ClarifyResponse.safeParse(await res.json());
    eq(
      'the model’s select and other are kept, and a value outside the contract reads as the default',
      parsed.success ? parsed.data.questions.map((q) => [q.id, q.select, q.other]) : parsed.error.issues,
      [['days', 'many', true], ['time', 'one', false]],
    );
  }

  await testClarifyLimit();

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
    const { app } = appWithModel([{ role: 'clarify', deltas: ['I am afraid I cannot do that.'], usage: TURN_USAGE }]);
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

/** One clarify call answered with `reply`, read back as a validated `ClarifyResponse`. */
async function clarifyWith(reply: unknown): Promise<{ status: number; body: ClarifyResponse | undefined; logs: Record<string, unknown>[] }> {
  const { app } = appWithModel([{ role: 'clarify', deltas: ['```json\n', JSON.stringify(reply), '\n```'], usage: TURN_USAGE }]);
  const capture = captureLogs();
  let res: Response;
  try {
    res = await post(app, '/v1/clarify', { prompt: 'a weather app' }, DEVICE_HEADER);
  } finally {
    capture.stop();
  }
  const parsed = res.status === 200 ? ClarifyResponse.safeParse(await res.json()) : undefined;
  return { status: res.status, body: parsed?.success ? parsed.data : undefined, logs: withMessage(capture, 'clarify limit kept, questions dropped') };
}

async function testClarifyLimit(): Promise<void> {
  section('Wire v2 — clarify answers a limit when the request’s core needs what a mini-app cannot do (beta-1 D9)');

  const limit = { reason: 'A mini-app cannot get live weather.', alternative: 'A bike-or-train checklist you fill in each morning' };
  const question = { id: 'when', question: 'When do you ride?', options: ['Mornings', 'Evenings'] };

  const alone = await clarifyWith({ questions: [], limit });
  eq('a limit reply → 200', alone.status, 200);
  eq('the limit is returned as the model wrote it, with no questions', alone.body, { questions: [], limit });

  const both = await clarifyWith({ questions: [question], limit: { reason: `  ${limit.reason}  `, alternative: limit.alternative } });
  eq('a limit beside questions keeps the limit (trimmed) and drops the questions', both.body, { questions: [], limit });
  eq('the dropped questions are logged once, by count only', both.logs.map((r) => r.droppedQuestions), [1]);
  check('the log line carries no question or limit text', !JSON.stringify(both.logs).includes('ride') && !JSON.stringify(both.logs).includes('weather'));

  const noQuestionsKey = await clarifyWith({ limit });
  eq('a limit with no questions key at all is still a limit', noQuestionsKey.body, { questions: [], limit });

  const malformed = [
    { label: 'an empty reason', limit: { reason: '   ', alternative: limit.alternative } },
    { label: 'a 201-character alternative', limit: { reason: limit.reason, alternative: 'x'.repeat(201) } },
    { label: 'a missing alternative', limit: { reason: limit.reason } },
    { label: 'a string instead of an object', limit: 'no weather' },
  ];
  for (const entry of malformed) {
    const read = await clarifyWith({ questions: [question], limit: entry.limit });
    eq(`${entry.label}: the reply is read as its questions, with no limit`, read.body, { questions: [{ ...question, select: 'one', other: false }] });
  }
  const malformedAlone = await clarifyWith({ limit: { reason: '', alternative: '' } });
  eq('a malformed limit with no questions is an unusable reply → 502, as without a limit', malformedAlone.status, 502);

  const boundary = await clarifyWith({ questions: [], limit: { reason: 'r'.repeat(200), alternative: 'a'.repeat(200) } });
  eq('200 characters after trimming is still a limit', boundary.body?.limit, { reason: 'r'.repeat(200), alternative: 'a'.repeat(200) });
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
        clarifications: [{ id: 'reset', question: 'When does it reset?', choices: ['Every morning', 'At noon'] }],
      },
      DEVICE_HEADER,
    );
    eq('rewrite with clarifications → 200', res.status, 200);
    const body = RewriteResponse.parse(await res.json());
    const sent = model.requests[0]?.request.messages.map((m) => m.content).join('\n') ?? '';
    check('the answer text reaches the model', sent.includes('Every morning'));
    check('every picked option reaches the model, joined', sent.includes('Every morning, At noon'));
    check('the question text reaches the model', sent.includes('When does it reset?'));
    eq('plan rows come back', body.plan?.length, 2);
    eq('plan row label', body.plan?.[0]?.label, 'What it is');
    check('a malformed plan row is dropped', !(body.plan ?? []).some((row) => row.label === ''));
  }

  // A model that answers in plain prose still conforms: no rows, the prose is the rewrite. A
  // prose reply has no `plan`, so the route re-asks once (§rewrite retry) — two identical turns.
  {
    const { app } = appWithModel([
      { role: 'rewrite', deltas: ['A water tracker that counts glasses.'], usage: TURN_USAGE },
      { role: 'rewrite', deltas: ['A water tracker that counts glasses.'], usage: TURN_USAGE },
    ]);
    const res = await post(app, '/v1/rewrite', { prompt: 'a water tracker' }, DEVICE_HEADER);
    const body = RewriteResponse.parse(await res.json());
    eq('plain prose becomes the rewritten prompt', body.rewrittenPrompt, 'A water tracker that counts glasses.');
    eq('plain prose yields no plan rows', body.plan, undefined);
  }
}

// ── §4b Rewrite: retries once on an empty or plan-less reply, never a third time ─────────────

async function testRewriteRetry(): Promise<void> {
  section('Wire v2 — POST /v1/rewrite retries once on an empty or plan-less reply');

  const goodPlanned = {
    rewrittenPrompt: 'A pomodoro timer that tracks focus sessions.',
    plan: [{ label: 'What it is', text: 'A focus timer.' }],
  };

  // First reply is an empty stream (renders as an empty rewrittenPrompt) — retried once, and the
  // second (good, plan-carrying) reply wins. Usage is credited for BOTH calls.
  {
    const { app, model, usageStore } = appWithModel([
      { role: 'rewrite', deltas: [], usage: TURN_USAGE },
      { role: 'rewrite', deltas: [JSON.stringify(goodPlanned)], usage: TURN_USAGE },
    ]);
    const res = await post(app, '/v1/rewrite', { prompt: 'a pomodoro timer' }, DEVICE_HEADER);
    eq('empty-then-good rewrite → 200', res.status, 200);
    const body = RewriteResponse.parse(await res.json());
    eq('the good reply wins', body.rewrittenPrompt, goodPlanned.rewrittenPrompt);
    eq("the good reply's plan comes back", body.plan?.length, 1);
    eq('exactly two model calls were made', model.requests.length, 2);
    const usage = await usageStore.read(DEVICE_ID);
    eq('usage is credited for both calls', usage.totalTokens, TURN_USAGE.totalTokens * 2);
  }

  // Two bad (plan-less) replies in a row: the route returns the LAST shaped reply rather than
  // trying a third time — a third call would throw ScriptedModelClientExhaustedError, proving it
  // never happens.
  {
    const { app, model } = appWithModel([
      { role: 'rewrite', deltas: ['I cannot help with that.'], usage: TURN_USAGE },
      { role: 'rewrite', deltas: ['I still cannot help with that.'], usage: TURN_USAGE },
    ]);
    const res = await post(app, '/v1/rewrite', { prompt: 'a pomodoro timer' }, DEVICE_HEADER);
    eq('two bad replies → still 200', res.status, 200);
    const body = RewriteResponse.parse(await res.json());
    eq('the LAST shaped reply is returned', body.rewrittenPrompt, 'I still cannot help with that.');
    eq('exactly two model calls were made, no third', model.requests.length, 2);
  }

  // Good prose first, then an empty stream on the retry: the retry is worse (empty), so the
  // BEST attempt (the first) wins rather than the last — regression guard for the "kept only the
  // last attempt" bug where a decent first reply was clobbered by a bad second one.
  {
    const { app, model } = appWithModel([
      { role: 'rewrite', deltas: ['A pomodoro timer that tracks focus sessions.'], usage: TURN_USAGE },
      { role: 'rewrite', deltas: [], usage: TURN_USAGE },
    ]);
    const res = await post(app, '/v1/rewrite', { prompt: 'a pomodoro timer' }, DEVICE_HEADER);
    eq('good-prose-then-empty → 200', res.status, 200);
    const body = RewriteResponse.parse(await res.json());
    eq('the first (best) reply is kept', body.rewrittenPrompt, 'A pomodoro timer that tracks focus sessions.');
    eq('exactly two model calls were made', model.requests.length, 2);
  }

  // A client that has already disconnected (an aborted signal) never gets a model call — not even
  // the first one. No turns are scripted at all: a model call here would throw
  // ScriptedModelClientExhaustedError, proving the abort check runs before the call is constructed.
  {
    const { app, model } = appWithModel([]);
    const controller = new AbortController();
    controller.abort();
    const res = await app.request(
      '/v1/rewrite',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...DEVICE_HEADER },
        body: JSON.stringify({ prompt: 'a pomodoro timer' }),
        signal: controller.signal,
      },
    );
    eq('an already-aborted request → 502', res.status, 502);
    eq('no model call was made', model.requests.length, 0);
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

  // Reserved hues: the three status meanings (both backgrounds), the accent and `yours` — read
  // from the SDK's own token module (as check.ts's RESERVED_HUES does), never re-typed as a
  // literal palette here, so a token edit can never leave this test pinned to a stale one.
  const reservedHues = [
    ...Object.values(STATUS_COLORS),
    ...Object.values(STATUS_COLORS_ON_INK),
    SHELL_COLORS.accent,
    SHELL_COLORS.yours,
    SHELL_COLORS.yoursOnDark,
  ];
  for (const hue of reservedHues) {
    eq(`the reserved hue ${hue} is dropped`, manifestFor(`  tileColor: '${hue}',`)?.tileColor, undefined);
    // Case-insensitively.
    eq(`the reserved hue ${hue} is dropped uppercased`, manifestFor(`  tileColor: '${hue.toUpperCase()}',`)?.tileColor, undefined);
  }

  const dropped = manifestFor(`  tileColor: '${reservedHues[0]}',`);
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

/** One SSE `data:` line built from a frame object — avoids hand-escaping nested JSON. */
function sseFrame(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** A fetch double that answers one summary reply over a real SSE stream and captures the outgoing
 *  request body — the wire the summariser's call actually reaches, through the REAL
 *  `OpenRouterClient` rather than `ScriptedModelClient`. */
function summaryWireFetch(captured: { body?: Record<string, unknown> }): FetchFn {
  return (async (_input, init) => {
    captured.body = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>;
    const summaryJson = JSON.stringify({ text: 'It counts your glasses.', kind: 'Start', touched: [] });
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseFrame({ id: 'gen-summary-wire', choices: [{ index: 0, delta: { content: summaryJson } }] })));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as FetchFn;
}

/**
 * Red-check target (design D1): the summariser's wire request explicitly disables reasoning by
 * default, through the REAL `OpenRouterClient` rather than `ScriptedModelClient`. Fails against the
 * pre-change wire mapping `...(options.reasoning ? { reasoning: { enabled: true } } : {})`, because
 * `'off'` is a non-empty (truthy) string: that mapping would send `{enabled:true}` instead.
 */
async function testSummariserWireReasoningIsExplicitlyOff(): Promise<void> {
  section("Wire v2 — the summariser's OWN wire request explicitly disables reasoning by default (design D1)");

  const input: SummariserInput = { prompt: 'a water tracker', isEdit: false, appName: 'demo', capabilities: [], attempts: 1, diagnostics: [] };
  const captured: { body?: Record<string, unknown> } = {};
  const model = openRouterModelClient(new OpenRouterClient(summaryWireFetch(captured)));
  const summariser = createModelSummariser({ model, roster: ROSTER, timeoutMs: 2_000 });
  const result = await summariser.summarise(input);

  eq('the summariser call still resolves normally', result.summary?.text, 'It counts your glasses.');
  check('setup: the outgoing wire body was captured', captured.body !== undefined);
  eq('the wire body explicitly disables reasoning', captured.body?.reasoning, { enabled: false });
}

/**
 * request-envelope chain-1b: the summariser's own "model call" line (emitted deep inside the REAL
 * `OpenRouterClient`, never through `ScriptedModelClient`) carries the run's request id — chain-1
 * bound every OTHER run line to it via `state.log`, but stopped short of the summariser's own model
 * turn. Red-check: fails naming the "model call" line if `machine.ts#summariseDelivery` stops
 * forwarding `state.modelLog` into `summariser.summarise`, or if `createModelSummariser` stops
 * forwarding it onward into its own `model.stream` call — either regression leaves
 * `summaryLine.requestId` `undefined` instead of the trace's id. The raw line check fails if the
 * summariser is handed the run logger, whose `scope` would sit beside the model client's own.
 */
async function testSummariserModelCallCarriesRequestId(): Promise<void> {
  section("Wire v2 — the summariser's own model-call line carries the run's request id (request-envelope)");

  const captured: { body?: Record<string, unknown> } = {};
  const summariserModel = openRouterModelClient(new OpenRouterClient(summaryWireFetch(captured)));
  const summariser = createModelSummariser({ model: summariserModel, roster: ROSTER, timeoutMs: 2_000 });
  const trace: RunTrace = { generationIds: [], requestId: 'req-summary-line-9f2c' };

  const capture = captureLogs();
  let events: GenerationEvent[];
  try {
    events = await collect(new GenerationMachine(deliveringDeps(summariser)).run(REQUEST, undefined, trace));
  } finally {
    capture.stop();
  }

  eq('setup: the run delivered', events.at(-1)?.type, 'result');
  const modelCallLines = withMessage(capture, 'model call');
  const summaryLine = modelCallLines.find((r) => r.role === 'summary');
  check('setup: the summariser made its own model call', summaryLine !== undefined, JSON.stringify(modelCallLines));
  eq("the summariser's model call line carries the run's request id", summaryLine?.requestId, trace.requestId);
  const rawSummaryLine = capture.raw.find((_, index) => capture.records[index] === summaryLine) ?? '';
  eq("the summariser's raw model call line holds one scope key (pino writes a duplicate twice)", rawSummaryLine.split('"scope":').length - 1, 1);
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
        role: 'summary',
        deltas: [JSON.stringify({ text: 'It counts your glasses.', kind: 'Start', touched: ['the count'], chg: 'counts your glasses' })],
        usage: TURN_USAGE,
      },
    ]);
    const summariser = createModelSummariser({ model, roster: ROSTER, timeoutMs: 2_000 });
    const result = await summariser.summarise(input);
    eq('the summariser produced a summary', result.summary?.text, 'It counts your glasses.');
    eq('its usage comes back for crediting', result.usage?.totalTokens, TURN_USAGE.totalTokens);
    eq('the summary role defaults to reasoning off', model.requests[0]?.request.reasoning, 'off');
    eq('the summariser call is labeled summary', model.requests[0]?.request.role, 'summary');
  }

  // A transport failure is not a summariser failure the run can see.
  {
    const model = new ScriptedModelClient(ROSTER, [
      { role: 'summary', deltas: [], usage: TURN_USAGE, error: new Error('transport exploded') },
    ]);
    const summariser = createModelSummariser({ model, roster: ROSTER, timeoutMs: 2_000 });
    const result = await summariser.summarise(input);
    eq('a model failure yields no summary and no throw', result.summary, undefined);
  }

  // A hanging model is bounded by the summariser's own timeout, not by the run.
  {
    const hanging = {
      stream: () => ({
        deltas: (async function* (): AsyncGenerator<ModelDelta> {
          await new Promise<void>(() => {});
          yield { kind: 'text', text: '' };
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
    { role: 'plan', deltas: [VALID_PLAN_JSON], usage: TURN_USAGE },
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

    const capture = captureLogs();
    let events: GenerationEvent[];
    try {
      events = await collect(new GenerationMachine(deliveringDeps(summariser)).run(REQUEST));
    } finally {
      capture.stop();
    }

    const terminal = events.at(-1);
    eq('a throwing summariser still yields result', terminal?.type, 'result');
    check('the summary is simply absent', terminal?.type === 'result' && terminal.summary === undefined);
    check('the delivered record is untouched', terminal?.type === 'result' && deepEqual(terminal.app, WIRE_RECORD));

    check(
      'a throwing summariser logs its error class and detail as named fields',
      withMessage(capture, 'summariser failed').some(
        (r) => r.errorClass === 'Error' && r.detail === 'summariser exploded',
      ),
    );
  }

  // A run that stays broken gets shorter prose, not warmer prose — and never a summary, because a
  // summary describes a delivered app and nothing was delivered.
  {
    const model = new ScriptedModelClient(ROSTER, [
      { role: 'plan', deltas: ['not a plan at all'], usage: TURN_USAGE },
      { role: 'plan', deltas: ['still not a plan'], usage: TURN_USAGE },
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
  await testWholeRouteTableIsGated();
  await testSubstitutedVerifier();
  await testClarifyEndpoint();
  await testRewriteClarificationsAndPlan();
  await testRewriteRetry();
  testTileColorExtraction();
  testSummaryShaping();
  await testModelSummariser();
  await testSummariserWireReasoningIsExplicitlyOff();
  await testSummariserModelCallCarriesRequestId();
  await testSummaryOnTerminalEvent();
  await testSseFramesSummaryUnmodified();
}
