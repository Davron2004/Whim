/**
 * Prompt-flow wiring (shell-redesign-v2, task D11) — everything between the `2a` screens and the
 * outside world.
 *
 * Behavioural where the code is pure or injectable: the server-address store, the `POST /v1/clarify`
 * and `POST /v1/rewrite` calls (against an injected `fetchImpl`, no HTTP server), the request
 * builder's clarification threading, and the `{v:2, text, summary?}` prompt envelope's round-trip
 * and backward reads. Static source assertions cover only `LauncherRoot.tsx`'s orchestration, which
 * pulls in `react-native`/`react-native-safe-area-context` and cannot be imported under Node.
 *
 * Scenarios (`specs/prompt-flow/spec.md`, `specs/app-launcher/spec.md`, `specs/mini-app-versioning/spec.md`):
 *   - the composer row and "Prompt again" open the compose step with the right scope; so does
 *     History's "Change it from here".
 *   - clarify is a pre-stream exchange: zero questions is a success, a 502 skips to the plan.
 *   - answers reach the rewrite and the generation request, by value.
 *   - nothing is generated before the plan's `Build it`.
 *   - `Leave it running` does not cancel; hardware back out of the build step does.
 *   - a delivered generation tracks `{v:2, text, summary?}`; v1 and raw strings still read.
 *   - the highlighting off-switch is mounted around the whole tree, or it is inert.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { COPY } from '../copy';
import { MapKVBackend } from '../../version-store';
import { loadServerUrl, saveServerUrl } from '../server-address';
import { clarifyPrompt, rewritePrompt } from '../generation-client';
import type { ClientOptions } from '../generation-client';
import { buildGenerateRequest } from '../generation-request';
import { isClarifySkip } from '../prompt-flow';
import { PROMPT_ENVELOPE_VERSION, parsePromptEnvelope, promptEnvelope } from '../prompt-envelope';
import { storedSummary } from '../history-logic';
import type { StoreAccess } from '../store-access';
import type { RunSummary } from '@whim/contract';

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src/host/launcher', file), 'utf8');
}

interface CapturedRequest {
  url: string;
  body: unknown;
}

/** A `fetchImpl` that records the request and answers with a canned status + JSON body. */
function stubFetch(status: number, body: unknown, captured: CapturedRequest[]): typeof fetch {
  return (async (url: string, init: { body: string }) => {
    captured.push({ url: String(url), body: JSON.parse(init.body) });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const OPTS = (fetchImpl: typeof fetch): ClientOptions => ({
  baseUrl: 'http://server.test',
  deviceId: '11111111-1111-4111-8111-111111111111',
  fetchImpl,
});

const SUMMARY: RunSummary = {
  text: 'It saves every brew now.',
  kind: 'Added',
  touched: ['History'],
  marks: [{ cls: 'chg', start: 3, end: 8 }],
};

export async function runPromptFlowWiringTests(h: Harness): Promise<void> {
  // ── server-address.ts: real behavior, not a static assertion (pure Node logic) ─────────────

  await h.test('server-address: absent key resolves to undefined ("not configured")', () => {
    const kv = new MapKVBackend();
    h.eq(loadServerUrl(kv), undefined, 'unset address must be undefined');
  });

  await h.test('server-address: a saved address round-trips exactly', () => {
    const kv = new MapKVBackend();
    saveServerUrl(kv, '192.168.1.20:4000');
    h.eq(loadServerUrl(kv), '192.168.1.20:4000', 'saved address must round-trip');
  });

  await h.test('server-address: whitespace is trimmed and a blank value clears to undefined', () => {
    const kv = new MapKVBackend();
    saveServerUrl(kv, '  host:4000  ');
    h.eq(loadServerUrl(kv), 'host:4000', 'must trim surrounding whitespace');
    saveServerUrl(kv, '   ');
    h.eq(loadServerUrl(kv), undefined, 'a blank/whitespace-only value must clear to undefined');
  });

  await h.test('server-address: never throws on a KVBackend returning null', () => {
    const kv = new MapKVBackend();
    // MapKVBackend.getString returns undefined for a missing key already, but the sanitizer must
    // also tolerate a backend that returns null (the documented KVBackend contract allows either).
    const nullish = { ...kv, getString: () => null } as unknown as MapKVBackend;
    h.eq(loadServerUrl(nullish), undefined, 'a null read must resolve to undefined, not throw');
  });

  // ── the clarify exchange, over an injected fetch ────────────────────────────────────────────

  await h.test('clarify: a request/response exchange, never a stream', async () => {
    const captured: CapturedRequest[] = [];
    const response = await clarifyPrompt(
      OPTS(stubFetch(200, { questions: [{ id: 'alert', question: 'How?', options: ['Sound', 'Buzz'] }] }, captured)),
      'a brew timer',
    );
    h.eq(captured[0].url, 'http://server.test/v1/clarify', 'the exchange is its own unary route');
    h.eq(captured[0].body, { prompt: 'a brew timer' }, 'it carries the prompt and nothing else');
    h.eq(response.questions.length, 1, 'the questions come back for the device to render');
  });

  await h.test('clarify: zero questions is a success, not a degraded mode', async () => {
    const response = await clarifyPrompt(OPTS(stubFetch(200, { questions: [] }, [])), 'a dice roller');
    h.eq(response.questions, [], 'an empty list parses as a normal answer');
  });

  await h.test('clarify: a 502 surfaces as the skip-to-plan signal', async () => {
    let caught: unknown = null;
    try {
      await clarifyPrompt(OPTS(stubFetch(502, { error: 'clarify_not_configured', hint: 'no key' }, [])), 'x');
    } catch (e) {
      caught = e;
    }
    h.ok(caught !== null, 'a 502 rejects rather than inventing questions');
    h.ok(isClarifySkip(caught), 'and the flow reads it as "skip to the plan step"');
  });

  await h.test('clarify: an unparseable answer is an error, never a silent empty list', async () => {
    let caught: unknown = null;
    try {
      await clarifyPrompt(OPTS(stubFetch(200, { questions: [{ id: 1 }] }, [])), 'x');
    } catch (e) {
      caught = e;
    }
    h.ok(caught !== null, 'a malformed question list is rejected');
    h.ok(!isClarifySkip(caught), 'and is not mistaken for the skip signal');
  });

  // ── answers reaching the requests that follow ───────────────────────────────────────────────

  await h.test('rewrite: the clarify answers ride with the rewrite request', async () => {
    const captured: CapturedRequest[] = [];
    await rewritePrompt(OPTS(stubFetch(200, { rewrittenPrompt: 'a brew timer' }, captured)), 'a timer', [
      { id: 'alert', question: 'How?', answer: 'Both' },
    ]);
    h.eq(
      captured[0].body,
      { prompt: 'a timer', clarifications: [{ id: 'alert', question: 'How?', answer: 'Both' }] },
      'the answers travel by value with the prompt',
    );
  });

  await h.test('rewrite: answering nothing sends no clarifications field at all', async () => {
    const captured: CapturedRequest[] = [];
    await rewritePrompt(OPTS(stubFetch(200, { rewrittenPrompt: 'a brew timer' }, captured)), 'a timer');
    h.eq(captured[0].body, { prompt: 'a timer' }, 'absent and empty mean the same thing, and absent is sent');
  });

  await h.test('generate: the request carries the clarifications for a new app', async () => {
    const noAccess = {} as unknown as StoreAccess;
    const withAnswers = await buildGenerateRequest(noAccess, () => ({}) as never, undefined, 'a brew timer', [
      { id: 'alert', question: 'How?', answer: 'Both' },
    ]);
    h.eq(
      withAnswers,
      { prompt: 'a brew timer', clarifications: [{ id: 'alert', question: 'How?', answer: 'Both' }] },
      'the answers reach generation',
    );
    const without = await buildGenerateRequest(noAccess, () => ({}) as never, undefined, 'a brew timer');
    h.eq(without, { prompt: 'a brew timer' }, 'and no empty field is sent when there are none');
  });

  // ── the v2 prompt envelope ──────────────────────────────────────────────────────────────────

  await h.test('envelope: a delivered generation tracks {v:2, text, summary?}', () => {
    const raw = promptEnvelope('a timer with my pour-over recipe', SUMMARY);
    h.eq(JSON.parse(raw).v, PROMPT_ENVELOPE_VERSION, 'the version is stamped');
    h.eq(JSON.parse(raw).v, 2, 'and it is v2');
    h.eq(parsePromptEnvelope(raw).text, 'a timer with my pour-over recipe', 'the verbatim prompt round-trips');
    h.eq(storedSummary(raw), SUMMARY, 'and the run’s summary rides beside it, unmodified');
  });

  await h.test('envelope: a run with no summary writes the prompt alone', () => {
    const raw = promptEnvelope('a dice roller');
    h.eq(JSON.parse(raw), { v: 2, text: 'a dice roller' }, 'no summary key is written at all');
    h.eq(storedSummary(raw), undefined, 'reading it back finds no summary — a legitimate state');
  });

  await h.test('envelope: a v1 envelope and a raw string still read, with no migration', () => {
    h.eq(parsePromptEnvelope('{"v":1,"text":"make a tip splitter"}'), { text: 'make a tip splitter' }, 'a v1 envelope resolves to its text');
    h.eq(storedSummary('{"v":1,"text":"make a tip splitter"}'), undefined, 'and carries no summary');
    h.eq(parsePromptEnvelope('Example: track water'), { text: 'Example: track water' }, 'a raw legacy string is its own text');
    h.eq(parsePromptEnvelope('{not json'), { text: '{not json' }, 'malformed JSON falls back unchanged');
  });

  await h.test('envelope: an unknown future version falls back rather than guessing', () => {
    h.eq(
      parsePromptEnvelope('{"v":9,"text":"future"}'),
      { text: '{"v":9,"text":"future"}' },
      'a version this build cannot read is not silently reinterpreted',
    );
  });

  await h.test('envelope: the lineage stamp stays out of the envelope', () => {
    h.ok(!promptEnvelope('a timer', SUMMARY).includes('lineage'), 'no lineage marker is written into the prompt');
  });

  // ── LauncherRoot.tsx / HomeScreen.tsx: static wiring assertions ─────────────────────────────

  const rootSrc = read('LauncherRoot.tsx');
  const homeSrc = read('HomeScreen.tsx');
  const settingsSrc = read('SettingsScreen.tsx');

  await h.test('home: the composer row and "Prompt again" both open the compose step', () => {
    h.ok(/onCreate=\{\(\) => openCompose\(\)\}/.test(rootSrc), 'the composer row opens compose with no app being edited');
    h.ok(/onPromptAgain=\{\(app\) => openCompose\(app\)\}/.test(rootSrc), '"Prompt again" opens compose scoped to that app');
    h.ok(homeSrc.includes('onCreate') && homeSrc.includes('COPY.homeComposerPlaceholder'), 'the home screen renders the composer entry row');
    h.ok(homeSrc.includes('onPromptAgain(a)') && homeSrc.includes('COPY.actionPromptAgain'), 'the action sheet still offers "Prompt again"');
    h.ok(homeSrc.includes('<AppTile'), 'the grid renders group F’s tile rather than its own');
  });

  await h.test('history: "Change it from here" opens the compose step for that app', () => {
    h.ok(/onChangeIt=\{\(app\) => openCompose\(app\)\}/.test(rootSrc), 'the history screen’s current-version action reaches the flow');
  });

  await h.test('approve-order: nothing is generated before the plan’s Build it', () => {
    const composeFn = rootSrc.slice(rootSrc.indexOf('const onComposeContinue'), rootSrc.indexOf('const onBuildIt'));
    h.ok(composeFn.includes('clarifyPrompt('), 'compose calls the clarify exchange');
    h.ok(!composeFn.includes('generateApp('), 'and never starts generation');
    const planFn = rootSrc.slice(rootSrc.indexOf('const openPlan'), rootSrc.indexOf('const onComposeContinue'));
    h.ok(planFn.includes('rewritePrompt('), 'the plan step is the rewrite endpoint’s surface');
    h.ok(!planFn.includes('generateApp('), 'and still starts no generation');
    const buildFn = rootSrc.slice(rootSrc.indexOf('const onBuildIt'), rootSrc.indexOf('const onLeaveRunning'));
    h.ok(buildFn.includes('generateApp('), 'only Build it starts generation');
  });

  await h.test('build: only `stage` reaches screen state — never token text or diagnostic fields', () => {
    const buildFn = rootSrc.slice(rootSrc.indexOf('const onBuildIt'), rootSrc.indexOf('const onLeaveRunning'));
    h.ok(/withStage\(s, event\.stage\)/.test(buildFn), 'a stage event is forwarded into screen state');
    h.ok(!/event\.text\b/.test(buildFn), 'a token event’s text is never read');
    h.ok(!/event\.diagnostic\.(kind|symbol)/.test(buildFn), 'a diagnostic’s kind/symbol is never read');
  });

  await h.test('leave-it-running does not cancel; hardware back out of the build step does', () => {
    const leaveFn = rootSrc.slice(rootSrc.indexOf('const onLeaveRunning'), rootSrc.indexOf('const onCancelGeneration'));
    h.ok(leaveFn.includes('detached = true') && leaveFn.includes('goHome()'), 'leaving detaches and returns to the shell');
    h.ok(!leaveFn.includes('abort()'), 'and never aborts the run');
    const cancelFn = rootSrc.slice(rootSrc.indexOf('const onCancelGeneration'), rootSrc.indexOf('// v2:'));
    h.ok(cancelFn.includes('ctl.cancelled = true') && cancelFn.includes('ctl.controller.abort()'), 'backing out marks intent and aborts');
    h.ok(cancelFn.includes('openCompose(editing, text)'), 'and returns to compose with the text preserved');
    h.ok(!cancelFn.includes('deliverResult'), 'cancel itself never delivers');
    const buildFn = rootSrc.slice(rootSrc.indexOf('const onBuildIt'), rootSrc.indexOf('const onLeaveRunning'));
    h.ok(/if \(ctl\.cancelled\) return;/.test(buildFn), 'the loop bails out on a cancelled run before delivering');
    h.ok(/if \(ctl\.detached\) return;/.test(buildFn), 'a detached run still delivers, it just does not take over the screen');
  });

  await h.test('delivery (D5): result routes through isAtTip to install / update / fork-then-update', () => {
    const deliverFn = rootSrc.slice(rootSrc.indexOf('async function deliverResult'), rootSrc.indexOf('export default function LauncherRoot'));
    h.ok(deliverFn.includes('access.install(') && deliverFn.includes('!editing'), 'new-app case must call access.install');
    h.ok(deliverFn.includes('await isAtTip(access, editing)'), 'edit case must decide via isAtTip');
    h.ok(deliverFn.includes('access.update(editing,'), 'at-tip case must call access.update on the same entry');
    h.ok(deliverFn.includes('access.fork(editing, undefined, { shareData: true })'), 'behind-tip case must fork with shareData:true and no question');
    h.ok(deliverFn.includes('access.update(fork,'), 'behind-tip case must then update the new fork');
    h.ok(deliverFn.includes('promptEnvelope(text, summary)'), 'every delivery writes the v2 envelope, summary included');
    h.ok(rootSrc.includes('terminal.summary'), 'the terminal event’s summary is what gets stored');
  });

  await h.test('delivery: the declared tile colour is lifted onto the host record', () => {
    h.ok(rootSrc.includes('liftManifestTileColor(wire.manifest)'), 'the wire manifest’s colour reaches the record through group F’s one mapping');
  });

  await h.test('highlighting: the off-switch is mounted around the whole launcher tree', () => {
    h.ok(/<HighlightingProvider enabled=\{highlighting\}>/.test(rootSrc), 'without this wrapper the switch is inert everywhere');
    h.ok(rootSrc.includes('loadHighlighting(kv)') && rootSrc.includes('saveHighlighting(kv, enabled)'), 'and it reads/persists the one flag');
  });

  await h.test('server address: every request is gated on clientOptions, device id attached once', () => {
    h.ok(rootSrc.includes('serverConfigured={clientOptions != null}'), 'the compose step is told whether a server is configured');
    h.ok(rootSrc.includes('if (!clientOptions) return;'), 'each forward step bails out honestly when unconfigured');
    h.ok(rootSrc.includes('getDeviceId(kv)'), 'the persisted device id is read once');
    h.ok(settingsSrc.includes('COPY.serverAddressSectionTitle') && settingsSrc.includes('onServerUrlChange'), 'Settings still owns the address field');
  });

  await h.test('the retired two-stage flow is gone, screens and strings together', () => {
    for (const file of ['PromptScreen.tsx', 'RewritePreviewScreen.tsx', 'GeneratingScreen.tsx']) {
      h.ok(!fs.existsSync(path.join(process.cwd(), 'src/host/launcher', file)), `${file} is retired`);
    }
    for (const key of ['promptTitleNew', 'rewritePreviewTitle', 'generatingTitle', 'generatingCancel', 'createTileLabel']) {
      h.ok(!(key in COPY), `COPY.${key} went with the screen that owned it`);
    }
    h.ok(!/rewrite-preview|kind: 'generating'/.test(rootSrc), 'no rewrite-preview or generating screen survives in the union');
  });
}
