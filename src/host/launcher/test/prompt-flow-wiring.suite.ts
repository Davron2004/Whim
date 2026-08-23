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
 *   - leaving compose or plan cancels that step's own in-flight request, and a response to a
 *     request the user has left cannot move the screen.
 *   - a delivered generation tracks `{v:2, text, summary?}`; v1 and raw strings still read.
 *   - the highlighting off-switch is mounted around the whole tree, or it is inert.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { COPY } from '../copy';
import { MapKVBackend } from '../../version-store';
import { PendingBuildStore } from '../pending-builds';
import { RunJournalStore } from '../run-journal';
import { dropPendingBuild } from '../build-lifecycle';
import { loadServerUrl, saveServerUrl } from '../server-address';
import { clarifyPrompt, rewritePrompt } from '../generation-client';
import type { ClientOptions } from '../generation-client';
import { buildGenerateRequest } from '../generation-request';
import { isClarifySkip } from '../prompt-flow';
import { FlowRequests, onlyOnStep } from '../flow-request';
import { PROMPT_ENVELOPE_VERSION, parsePromptEnvelope, promptEnvelope } from '../prompt-envelope';
import { loadHighlighting, saveHighlighting } from '../highlighting';
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

  await h.test('server-address: a trailing slash is stripped on save round-trip', () => {
    const kv = new MapKVBackend();
    saveServerUrl(kv, '10.0.2.2:8787/');
    h.eq(loadServerUrl(kv), '10.0.2.2:8787', 'a single trailing slash must not survive the round-trip');
  });

  await h.test('server-address: multiple trailing slashes are all stripped', () => {
    const kv = new MapKVBackend();
    saveServerUrl(kv, 'host:8787///');
    h.eq(loadServerUrl(kv), 'host:8787', 'repeated trailing slashes collapse away entirely');
  });

  await h.test('server-address: a previously-persisted trailing slash heals on load', () => {
    const kv = new MapKVBackend();
    kv.set('whim.server-url:v1', '10.0.2.2:8787/');
    h.eq(loadServerUrl(kv), '10.0.2.2:8787', 'an old install’s stored value is sanitized on read, not just on save');
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

  // ── flow-request.ts: leaving a step cancels its request, and a late response is discarded ──
  // (`prompt-flow` "Leaving clarify or rewrite cancels the in-flight request cleanly" and "A
  // response to a request the user has left cannot move the screen".) Behavioural: both halves of
  // the pattern are pure, so they run here for real; only their call sites are asserted statically.

  await h.test('cancel: leaving compose aborts the clarify request it started', () => {
    const requests = new FlowRequests();
    const clarify = requests.start('compose');
    h.eq(clarify.controller.signal.aborted, false, 'the request starts live');
    requests.abort('compose');
    h.eq(clarify.controller.signal.aborted, true, 'leaving compose aborts the underlying request');
    h.eq(clarify.cancelled, true, 'and records the intent, since an abort and a failure look alike to the caller');
  });

  await h.test('cancel: leaving plan aborts rewrite and nothing else', () => {
    const requests = new FlowRequests();
    const clarify = requests.start('compose');
    const rewrite = requests.start('plan');
    requests.abort('plan');
    h.eq(rewrite.controller.signal.aborted, true, 'leaving plan aborts the rewrite request');
    h.eq(clarify.controller.signal.aborted, false, 'per-step controllers: the clarify request is untouched');
    h.eq(clarify.cancelled, false, 'and is not marked cancelled');
  });

  await h.test('cancel: a settled request releases only its own slot', () => {
    const requests = new FlowRequests();
    const first = requests.start('compose');
    const second = requests.start('compose');
    h.eq(first.controller.signal.aborted, true, 'a superseding request cancels the one it replaces');
    requests.release('compose', first);
    requests.abort('compose');
    h.eq(second.controller.signal.aborted, true, 'the stale request’s release did not strand the newer one');
  });

  await h.test('cancel: a late clarify response cannot move the screen off Home', () => {
    // The user backed out of compose to Home while clarify was in flight; the response lands
    // afterwards. It must be discarded, and Home must stay put.
    const toClarify = onlyOnStep<{ kind: string }, 'compose'>('compose', () => ({ kind: 'clarify' }));
    const home = { kind: 'home' };
    h.ok(toClarify(home) === home, 'the late response leaves the current screen untouched, by reference');
    h.eq(toClarify({ kind: 'compose' }).kind, 'clarify', 'while a compose step that never left still advances');
  });

  await h.test('cancel: a late rewrite response cannot move a screen the user already left', () => {
    const applied = onlyOnStep<{ kind: string }, 'plan'>('plan', () => ({ kind: 'plan-with-rows' }));
    const settings = { kind: 'settings' };
    h.ok(applied(settings) === settings, 'a rewrite that resolves after the plan step is gone is discarded');
    h.eq(applied({ kind: 'plan' }).kind, 'plan-with-rows', 'and still applies while the plan step is current');
  });

  // ── LauncherRoot.tsx / HomeScreen.tsx: static wiring assertions ─────────────────────────────

  const rootSrc = read('LauncherRoot.tsx');
  const homeSrc = read('HomeScreen.tsx');
  const settingsSrc = read('SettingsScreen.tsx');
  /** The shell's one generation runner (`runAttempt`), which the plan's `Build it` and a ghost's
   *  Retry both enter through — the stream loop and its settlements all live inside it. */
  const attemptFn = rootSrc.slice(rootSrc.indexOf('const runAttempt'), rootSrc.indexOf('const onBuildIt'));

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
    const composeFn = rootSrc.slice(rootSrc.indexOf('const onComposeContinue'), rootSrc.indexOf('const settleFailed'));
    h.ok(composeFn.includes('clarifyPrompt('), 'compose calls the clarify exchange');
    h.ok(!composeFn.includes('generateApp('), 'and never starts generation');
    const planFn = rootSrc.slice(rootSrc.indexOf('const openPlan'), rootSrc.indexOf('const onComposeContinue'));
    h.ok(planFn.includes('rewritePrompt('), 'the plan step is the rewrite endpoint’s surface');
    h.ok(!planFn.includes('generateApp('), 'and still starts no generation');
    // `runAttempt` is the shell's ONE generation call site; the plan's `Build it` and a ghost's
    // Retry are its only two entries, so "generation starts at Build it" is now the stronger
    // claim that nothing else in the shell can start one at all.
    h.eq((rootSrc.match(/generateApp\(/g) ?? []).length, 1, 'exactly one generateApp call site exists in the shell');
    h.ok(attemptFn.includes('generateApp('), 'and it is inside runAttempt');
    const buildFn = rootSrc.slice(rootSrc.indexOf('const onBuildIt'), rootSrc.indexOf('const onLeaveRunning'));
    h.ok(buildFn.includes('runAttempt(buildStep(from))'), 'Build it reaches generation only through that one runner');
  });

  await h.test('cancel-wiring: the flow’s leave-handlers abort clarify and rewrite', () => {
    // Only the call SITES are static here — the pattern itself runs for real above. Their one
    // failure mode is a missing wire: the request is never cancelled and every other assertion
    // in this file stays green.
    const composeFn = rootSrc.slice(rootSrc.indexOf('const onComposeContinue'), rootSrc.indexOf('const settleFailed'));
    const planFn = rootSrc.slice(rootSrc.indexOf('const openPlan'), rootSrc.indexOf('const onComposeContinue'));
    h.ok(/clarifyPrompt\([\s\S]*?request\.controller\.signal/.test(composeFn), 'the clarify call carries its own abort signal');
    h.ok(/rewritePrompt\([\s\S]*?request\.controller\.signal/.test(planFn), 'so does the rewrite call');
    h.ok(composeFn.includes("flowRequests.start('compose')"), 'compose owns a compose-scoped request');
    h.ok(planFn.includes("flowRequests.start('plan')"), 'and the plan step a plan-scoped one — never one flow-wide controller');
    const leaveFn = rootSrc.slice(rootSrc.indexOf('const leaveFlowStep'), rootSrc.indexOf('const onServerUrlChange'));
    h.ok(leaveFn.includes("flowRequests.abort('compose')") && leaveFn.includes("flowRequests.abort('plan')"), 'the leave-handler aborts the step being left');
    h.ok(/const goHome = \(\) => \{\s*leaveFlowStep\(screen\.kind\);/.test(rootSrc), 'going Home leaves the current step');
    h.ok(/const goBack = \(from: FlowScreen\) => \{\s*leaveFlowStep\(from\.kind\);/.test(rootSrc), 'and so does a back press — which is what the hardware back button calls');
    h.ok(/onOpenSettings=\{\(\) => \{\s*leaveFlowStep\('compose'\);/.test(rootSrc), 'opening Settings out of compose leaves it too');
  });

  await h.test('rewrite-wiring: the plan step tells the rewrite which app it is changing', () => {
    // Same failure mode as the cancel wires above, and the same reason it is asserted statically:
    // drop `buildRewriteAppContext(plan.editing)` from the call and the request simply stops
    // carrying the app context — the builder's own suite still passes, the rewrite still
    // succeeds, and the model quietly loses the names it was supposed to keep.
    const planFn = rootSrc.slice(rootSrc.indexOf('const openPlan'), rootSrc.indexOf('const onComposeContinue'));
    h.ok(
      /rewritePrompt\([\s\S]*?buildRewriteAppContext\(plan\.editing\)/.test(planFn),
      'the rewrite call carries the app context built from the app being edited',
    );
  });

  await h.test('cancel-wiring: every post-await screen write in the flow is guarded', () => {
    // The B1 fix: aborting alone cannot stop a promise that had already resolved when the user
    // navigated away, so each write after an `await` re-checks the step that started it.
    const composeFn = rootSrc.slice(rootSrc.indexOf('const onComposeContinue'), rootSrc.indexOf('const settleFailed'));
    const planFn = rootSrc.slice(rootSrc.indexOf('const openPlan'), rootSrc.indexOf('const onComposeContinue'));
    const writes = (src: string) => src.match(/setScreen\(/g) ?? [];
    const guarded = (src: string) => src.match(/setScreen\(onlyOnStep</g) ?? [];
    h.eq(guarded(composeFn).length, writes(composeFn).length, 'no unguarded setScreen survives in onComposeContinue');
    h.eq(guarded(planFn).length, writes(planFn).length, 'nor in openPlan');
    h.ok(composeFn.includes('if (request.cancelled) return;'), 'a cancelled clarify returns before touching busy or the screen');
    h.ok(planFn.includes('if (request.cancelled) return;'), 'and a cancelled rewrite before showing any failure');
    h.ok(composeFn.indexOf('if (request.cancelled) return;') < composeFn.indexOf("logGenError('clarify failed'"), 'the abort is swallowed before any failure breadcrumb is logged');
    h.ok(planFn.indexOf('if (request.cancelled) return;') < planFn.indexOf("logGenError('rewrite failed'"), 'on the rewrite path too');
    const leaveFn = rootSrc.slice(rootSrc.indexOf('const leaveFlowStep'), rootSrc.indexOf('const onServerUrlChange'));
    h.ok(leaveFn.includes('setBusy(false)'), 'leaving compose clears the busy primary action the guarded reset can no longer clear');
  });

  await h.test('build: only `stage` reaches screen state — never token text or diagnostic fields', () => {
    h.ok(/withStage\(s, event\.stage\)/.test(attemptFn), 'a stage event is forwarded into screen state');
    h.ok(!/event\.text\b/.test(attemptFn), 'a token event’s text is never read');
    h.ok(!/event\.diagnostic\.(kind|symbol)/.test(attemptFn), 'a diagnostic’s kind/symbol is never read');
  });

  await h.test('leave-it-running does not cancel; hardware back out of the build step does', () => {
    const leaveFn = rootSrc.slice(rootSrc.indexOf('const onLeaveRunning'), rootSrc.indexOf('const onCancelGeneration'));
    h.ok(leaveFn.includes('detached = true') && leaveFn.includes('goHome()'), 'leaving detaches and returns to the shell');
    h.ok(!leaveFn.includes('abort()'), 'and never aborts the run');
    const abortFn = rootSrc.slice(rootSrc.indexOf('const abortLiveAttempt'), rootSrc.indexOf('const showStreamFailure'));
    h.ok(abortFn.includes('ctl.cancelled = true') && abortFn.includes('ctl.controller.abort()'), 'backing out marks intent and aborts');
    // Bounded by the next CODE declaration, never by the decorative banner that happens to sit
    // between them: `indexOf` on a reworded banner returns -1, `slice(start, -1)` silently widens
    // the region to the rest of the file, and `onCancelPending`'s own `abortLiveAttempt()` would
    // keep the assertion below green while it tested nothing.
    const cancelFn = rootSrc.slice(rootSrc.indexOf('const onCancelGeneration'), rootSrc.indexOf('const failureFromRecord'));
    // The wiring link, not just the helper's existence: the assertions above prove `abortLiveAttempt`
    // marks intent and aborts, and this proves the hardware-back handler is what reaches it.
    h.ok(cancelFn.includes('abortLiveAttempt()'), 'the hardware-back handler is what invokes that abort');
    h.ok(cancelFn.includes('openCompose(editing, text)'), 'and returns to compose with the text preserved');
    h.ok(!cancelFn.includes('deliverAndSettle'), 'cancel itself never delivers');
    h.ok(/if \(ctl\.cancelled\) return;/.test(attemptFn), 'the loop bails out on a cancelled run before delivering');
    h.ok(/if \(ctl\.detached\) return;/.test(attemptFn), 'a detached run still delivers, it just does not take over the screen');
  });

  await h.test('delivery (D5): result routes through isAtTip to install / update / fork-then-update', () => {
    const deliverSrc = read('build-lifecycle.ts');
    const deliverFn = deliverSrc.slice(deliverSrc.indexOf('export async function deliverResult'), deliverSrc.indexOf('export async function deliverAndSettle'));
    h.ok(deliverFn.includes('access.install(') && deliverFn.includes('!editing'), 'new-app case must call access.install');
    h.ok(deliverFn.includes('await isAtTip(access, editing)'), 'edit case must decide via isAtTip');
    h.ok(deliverFn.includes('access.update(editing,'), 'at-tip case must call access.update on the same entry');
    h.ok(deliverFn.includes('access.fork(editing, undefined, { shareData: true })'), 'behind-tip case must fork with shareData:true and no question');
    h.ok(deliverFn.includes('access.update(fork,'), 'behind-tip case must then update the new fork');
    h.ok(deliverFn.includes('promptEnvelope(spec.text, spec.summary)'), 'every delivery writes the v2 envelope, summary included');
    h.ok(rootSrc.includes('terminal.summary'), 'the terminal event’s summary is what gets stored');
  });

  await h.test('delivery: the declared tile colour is lifted onto the host record', () => {
    h.ok(read('build-lifecycle.ts').includes('liftManifestTileColor(wire.manifest)'), 'the wire manifest’s colour reaches the record through group F’s one mapping');
  });

  // ── the shell half of the ghost-tile feature (launcher-ghost-tiles) ─────────────────────────
  // `build-lifecycle.ts` is exercised for real in `build-lifecycle.suite.ts`; what CANNOT be run
  // here is the wiring in `LauncherRoot.tsx`, which imports `react-native`. These pin the call
  // sites — each of which is deletable today with every behavioural suite still green.

  /** The shell's mount effect: the one whose body ends the launch sequence with `setReady(true)`.
   *  Sliced from that code landmark outwards, not from a banner comment. */
  const mountEffect = (() => {
    const readyAt = rootSrc.indexOf('setReady(true);');
    return rootSrc.slice(rootSrc.lastIndexOf('useEffect(', readyAt), rootSrc.indexOf('}, []);', readyAt));
  })();

  await h.test('launch: a surviving `building` record is demoted to interrupted before the first render', () => {
    // `pending-builds` spec: "A live `building` record is demoted to `interrupted` at launch."
    // The store method is exercised directly in `pending-builds.suite.ts`; the REQUIREMENT is the
    // call site. Without it a `building` ghost outlives the process that owned its stream, and
    // `onOpenPending` can never reattach it — a permanently un-tappable tile.
    const at = (needle: string): number => mountEffect.indexOf(needle);
    h.ok(at('pending.demoteBuildingToInterrupted()') >= 0, 'the shell demotes at launch, in its mount effect');
    h.ok(at('pending.demoteBuildingToInterrupted()') < at('seedFirstRun('), 'before first-run seeding');
    h.ok(at('seedFirstRun(') < at('refresh();'), 'which is before the state the grid renders is read');
    h.ok(at('refresh();') < at('setReady(true)'), 'and the whole sequence completes before the shell reports ready');
    h.eq((rootSrc.match(/demoteBuildingToInterrupted\(/g) ?? []).length, 1, 'exactly once per process — not per refresh');
    h.ok(/if \(!ready\) \{/.test(rootSrc), 'and the grid is gated on `ready`, so no record renders before the demotion');
  });

  await h.test('reattach: tapping a `building` ghost reads the live run back out — it never starts a second one', () => {
    // `prompt-flow` spec: "tapping a `building` ghost reattaches, without starting a new request."
    const openPendingFn = rootSrc.slice(rootSrc.indexOf('const onOpenPending'), rootSrc.indexOf('const onCancelPending'));
    h.ok(openPendingFn.includes('liveRef.current'), 'the reattach reads the in-flight attempt out of liveRef');
    h.ok(openPendingFn.includes('setScreen(live.screen)'), 'and is a screen-state change onto that run’s own build screen');
    h.ok(!openPendingFn.includes('generateApp(') && !openPendingFn.includes('runAttempt('), 'no new generation is started');
    h.ok(openPendingFn.includes('genRef.current.detached = false'), 'and reattaching un-detaches the run, so its done step still lands');
    h.ok(openPendingFn.includes('setScreen(failureFromRecord(rec))'), 'a failed/interrupted ghost opens the hydrated failure screen instead');
    h.ok(/onOpenPending=\{onOpenPending\}/.test(rootSrc), 'and the grid is actually handed the handler');
  });

  await h.test('failure hydration: a ghost’s failure screen is built from the PERSISTED payload, with Retry and Dismiss', () => {
    // `prompt-flow` spec: "failure screens hydrate from the persisted payload, offering Retry and
    // Dismiss." `hydratedDiagnostics`/`pendingFailure` round-trip for real in
    // `build-lifecycle.suite.ts`; these pin that the shell actually reads them back into a screen.
    const hydrateFn = rootSrc.slice(rootSrc.indexOf('const failureFromRecord'), rootSrc.indexOf('const onOpenPending'));
    h.ok(hydrateFn.includes('hydratedDiagnostics(rec.failure)'), 'the hint rows come from the record’s own payload');
    h.ok(hydrateFn.includes('rec.failure?.reason ?? COPY.interruptedBuildReason'), 'as does the reason — an interrupted record, which has none, says so instead');
    h.ok(hydrateFn.includes('pendingId: rec.id'), 'and the screen remembers which record it came from');
    h.ok(hydrateFn.includes('observedRepairAttempts: 0'), 'no live stream, so no repair count is invented');

    const actionsFn = rootSrc.slice(rootSrc.indexOf('const failureActions'), rootSrc.indexOf('const statusBarStyle'));
    h.ok(actionsFn.includes('pending.get(s.pendingId)'), 'the actions are decided by whether the record is still there');
    h.ok(actionsFn.includes('retryable: true'), 'a still-present record makes the primary action a Retry');
    h.ok(actionsFn.includes('onRetryPending(ghost)') && actionsFn.includes('onDismissPending(ghost)'), 'wired to Retry and Discard on that record');
    h.ok(actionsFn.includes('retryable: false'), 'and a record dismissed in the meantime falls back to the live Rephrase/Back shape');
    h.ok(rootSrc.includes('{...failureActions(screen)}'), 'the failure screen is rendered with those actions — without this the wiring is inert');
    h.ok(/\{retryable \? COPY\.screenErrorRetry : COPY\.failureRephrase\}/.test(read('FailureScreen.tsx')), 'and `retryable` is what relabels the primary action');

    const retryFn = rootSrc.slice(rootSrc.indexOf('const onRetryPending'), rootSrc.indexOf('const failureActions'));
    h.ok(retryFn.includes('runAttempt(retryBuildScreen(rec, edited ?? undefined), rec.id)'), 'Retry re-runs the stored prompt under the SAME launcher id — one ghost, not a second');
  });

  await h.test('failure exits: Back keeps the record and its journal readable, Discard deletes both', () => {
    // `prompt-flow`: "Back leaves the record in place" / "Discard removes the record".
    // Two halves, and they claim different things. The first drives a real store pair to show
    // what the two OPERATIONS do — that `dropPendingBuild` + `journal.delete` really is a paired
    // delete, and that a record left alone stays readable; it is evidence about the stores, NOT
    // about the shell, which cannot be imported here. The second half is the source lock that ties
    // each exit to one of those operations: the leave handler touches no store at all, and Discard
    // is the shell's single `dropAttempt` path.
    const kv = new MapKVBackend();
    const pending = new PendingBuildStore(kv);
    const journal = new RunJournalStore(kv);
    const rec = pending.create({ id: 'run-back', prompt: 'a tip splitter', workingTitle: 'Tip splitter' });
    journal.create(rec.id);
    journal.appendTerminal(rec.id, { failure: { reason: 'it did not build', diagnostics: [{ hint: 'say it differently' }] } });

    // Left alone — which is all the leave path does — the record and its journal are exactly as
    // the failure left them.
    h.eq(pending.get(rec.id)?.id, rec.id, 'the pending-build record survives leaving');
    h.eq(pending.list().map(r => r.id), [rec.id], 'so its ghost tile still renders');
    h.eq((journal.get(rec.id) ?? []).length, 1, 'and its run journal is still readable');

    // Discard: `dropAttempt`'s two calls, in the shell's own order.
    dropPendingBuild(pending, rec.id);
    journal.delete(rec.id);
    h.eq(pending.get(rec.id), null, 'discarding deletes the record');
    h.eq(pending.list().map(r => r.id), [], 'so the ghost tile stops rendering');
    h.eq(journal.get(rec.id), null, 'and takes the journal with it');

    const leaveFn = rootSrc.slice(rootSrc.indexOf('const onLeaveFailure'), rootSrc.indexOf('const onRetryPending'));
    h.ok(leaveFn.includes('goHome();'), 'the leave handler is a plain navigation home');
    h.ok(
      !/dropAttempt\(|dropPendingBuild\(|journal\.|pending\./.test(leaveFn),
      'and calls NOTHING on the stores — no record, journal or pending-build call on the leave path',
    );
    const actionsFn = rootSrc.slice(rootSrc.indexOf('const failureActions'), rootSrc.indexOf('const statusBarStyle'));
    h.eq(
      (actionsFn.match(/onBack: onLeaveFailure/g) ?? []).length,
      2,
      'both entry points — ghost-opened and live-failure — get the same non-destructive Back',
    );
    h.ok(
      /onBack: \(\) => void;/.test(read('FailureScreen.tsx')),
      'and the screen actually takes it, so the wiring is not inert',
    );
  });

  await h.test('failure exits: a LIVE failure’s Discard deletes the record it just settled — never bare navigation', () => {
    // A live failure screen is not action-free: every ending that went through `settleFailed` has
    // already persisted a `failed` record, so the Discard it offers must delete that record. A
    // branch that wired Discard to `goHome` would render a danger-styled control that silently
    // does nothing — the same label/effect mismatch this change exists to remove, the other way
    // round.
    const actionsFn = rootSrc.slice(rootSrc.indexOf('const failureActions'), rootSrc.indexOf('const statusBarStyle'));
    h.ok(
      actionsFn.includes('const settled = s.recordId != null ? pending.get(s.recordId) : null;'),
      'the live branch asks whether this failure already settled a record',
    );
    h.ok(
      actionsFn.includes('...(settled != null ? { onDismiss: () => onDismissPending(settled) } : {})'),
      'and when it did, Discard goes through the SAME onDismissPending → dropAttempt path the ghost branch uses',
    );
    h.ok(!/onDismiss: goHome/.test(actionsFn), 'no branch offers a Discard that is merely navigation');
    h.eq(
      (rootSrc.match(/dropPendingBuild\(/g) ?? []).length,
      1,
      'and the live path opens no second deletion call site — record and journal still die together',
    );

    // Which live endings carry a record: the three that settle one, and only those.
    const failureFn = rootSrc.slice(rootSrc.indexOf('const failure = ('), rootSrc.indexOf('const openCompose'));
    h.ok(
      failureFn.includes('...(settledAttemptId != null ? { journalId: settledAttemptId, recordId: settledAttemptId } : {})'),
      'the failure-screen builder names the settled attempt only when it was given one',
    );
    h.ok(
      /setScreen\(failure\(editing, building\.text, e, 'build failed', counts\.repair, attemptId\)\)/.test(rootSrc),
      'the build-threw ending passes the attempt `settleFailed` just persisted',
    );
    h.ok(/failure\(plan\.editing, plan\.text, e, 'rewrite failed'\)/.test(rootSrc), 'rewrite passes none — it fails before any attempt exists');
    h.ok(/failure\(from\.editing, from\.text, e, 'clarify failed'\)/.test(rootSrc), 'and clarify passes none either');

    const streamFn = rootSrc.slice(rootSrc.indexOf('const showStreamFailure'), rootSrc.indexOf('const runAttempt'));
    h.ok(streamFn.includes('recordId: input.attemptId'), 'both stream-failure endings carry the record they settled');
    h.ok(
      streamFn.indexOf('settleFailed(') < streamFn.indexOf('recordId: input.attemptId'),
      'and only after that record has actually been persisted',
    );

    // The other side of the same requirement: with nothing to discard the button is not rendered.
    // `FailureScreen.tsx` is source-checked in `failure-screen.suite.ts`; what belongs here is that
    // the shell can express the absence at all.
    h.ok(/onDismiss\?: \(\) => void;/.test(read('FailureScreen.tsx')), 'the screen’s discard callback is optional');
    h.ok(
      read('FailureScreen.tsx').includes('{onDismiss != null && ('),
      'so a clarify/rewrite failure — handed no onDismiss — renders no Discard button at all',
    );
  });

  await h.test('concurrent attempts: a settling attempt only ever clears refs that still point at itself', () => {
    // Two attempts can overlap: "Leave it running" and then a Retry or a new build. An
    // unconditional `genRef.current = null` / `liveRef.current = null` in the older attempt's
    // settlement strands the newer one — uncancellable, and its `building` ghost taps into the
    // "no live run to reattach to" branch forever.
    const releases = rootSrc.slice(rootSrc.indexOf('const releaseGenRef'), rootSrc.indexOf('const settleFailed'));
    h.ok(releases.includes('if (genRef.current === ctl) genRef.current = null;'), 'the abort controller is released only by the attempt that owns it');
    h.ok(releases.includes('if (liveRef.current?.id === attemptId) liveRef.current = null;'), 'and the live build screen only by the attempt whose id it holds');
    h.ok(attemptFn.includes('releaseGenRef(ctl)') && attemptFn.includes('releaseLiveRef(attemptId)'), 'runAttempt settles through those guarded releases');
    h.ok(!/(?:genRef|liveRef)\.current = null;/.test(attemptFn), 'and never clears either ref unconditionally');
    const settleFn = rootSrc.slice(rootSrc.indexOf('const settleFailed'), rootSrc.indexOf('const abortLiveAttempt'));
    h.ok(settleFn.includes('releaseLiveRef(id)'), 'a failure settles only its own attempt’s live ref');
    h.ok(!/(?:genRef|liveRef)\.current = null;/.test(settleFn), 'not whichever attempt happens to be live');
    // The deliberate exception, asserted so it reads as a decision rather than an oversight: an
    // explicit user cancel clears whatever is live, because that is exactly what was asked for.
    const abortFn2 = rootSrc.slice(rootSrc.indexOf('const abortLiveAttempt'), rootSrc.indexOf('const showStreamFailure'));
    h.ok(/genRef\.current = null;/.test(abortFn2) && /liveRef\.current = null;/.test(abortFn2), 'cancel remains the one unguarded clear');
  });

  // ── the run journal's call sites (generation-observability) ─────────────────────────────────
  // The store and the per-event fold are exercised for real in `run-journal.suite.ts` and
  // `build-lifecycle.suite.ts`; what cannot be run here is WHERE the shell calls them. Each
  // assertion below is a requirement whose only failure mode is a missing call site — the journal
  // silently never being written, moved or deleted, with every behavioural suite still green.

  await h.test('journal: it is created at the same point as the pending-build record', () => {
    // `generation-run-journal`: "A run journal is created alongside its pending-build record."
    const startAt = attemptFn.indexOf('const attemptId = startPendingBuild(');
    const createAt = attemptFn.indexOf('journal.create(attemptId)');
    h.ok(startAt >= 0 && createAt > startAt, 'the journal is created with the record, before the request goes out');
    h.ok(createAt < attemptFn.indexOf('generateApp('), 'and never after the stream has already started');
    h.ok(/journal: new RunJournalStore\(launcherKv\)/.test(rootSrc), 'over the SAME backend instance the pending store uses');
  });

  await h.test('journal: every stream event goes through the one fold, at one clock reading', () => {
    h.ok(
      attemptFn.includes('signals = journalStreamEvent(journal, attemptId, signals, event, Date.now());'),
      'the loop folds each event into the journal and the derived signals through build-lifecycle',
    );
    h.eq((attemptFn.match(/journal\.appendStage\(|journal\.appendAggregate\(/g) ?? []).length, 0, 'the shell never writes stage/aggregate entries itself — one writer, one cadence');
    h.ok(!/event\.text\b/.test(attemptFn), 'and still never reads a token’s text');
  });

  await h.test('journal: a terminal entry is written on every ending the stream can have', () => {
    // `generation-run-journal`: "A terminal entry is always written immediately." A `result` writes
    // it where the stream ends; the three failure endings all pass through `settleFailed`.
    const terminalAt = attemptFn.indexOf('journal.appendTerminal(attemptId, terminalCounts())');
    h.ok(terminalAt >= 0, 'a delivered result journals its terminal entry');
    h.ok(terminalAt < attemptFn.indexOf('deliverAndSettle('), 'at the end of the stream, before delivery runs');
    const settleFn = rootSrc.slice(rootSrc.indexOf('const settleFailed'), rootSrc.indexOf('const abortLiveAttempt'));
    h.ok(
      settleFn.includes('journal.appendTerminal(id, { failure: { reason, diagnostics }, ...observed })'),
      'and every failure ending — terminal failure, stream error, throw — journals one with its detail',
    );
    h.ok(
      settleFn.indexOf('journal.appendTerminal(') < settleFn.indexOf('failPendingBuild('),
      'written as part of the same settlement that persists the failed record',
    );
  });

  await h.test('journal: the terminal entry flushes the counts no aggregate entry can hold', () => {
    // The throttle's LAST window is never closed by another aggregate, so without this flush the
    // persisted growth figure silently stops at the last window boundary.
    h.ok(
      attemptFn.includes('const terminalCounts = (): RunTerminalCounts => ({') &&
        attemptFn.includes('aggregates: signals.aggregates') &&
        attemptFn.includes('observedDiagnostics: counts.diagnostic'),
      'the flush is the loop’s own in-memory totals and its diagnostics tally, read where the stream ends',
    );
    h.eq(
      (attemptFn.match(/terminalCounts\(\)/g) ?? []).length,
      4,
      'and every one of the four endings — result, terminal failure, stream error, throw — carries it',
    );
    h.ok(
      !/observedDiagnostics: (?!counts\.diagnostic)/.test(attemptFn),
      'the tally is the loop’s own counter — a number — and never a diagnostic object',
    );
  });

  await h.test('journal: success moves it to the app’s last-run report, after delivery', () => {
    // `generation-run-journal`: "On success, the journal moves to a per-app last-run report."
    const deliverAt = attemptFn.indexOf('await deliverAndSettle(');
    const moveAt = attemptFn.indexOf('journal.moveToLastRun(attemptId, delivered.id)');
    h.ok(moveAt > deliverAt, 'the move happens only once install/update has resolved');
    h.ok(
      attemptFn.indexOf('journal.moveToLastRun(') < attemptFn.indexOf('if (ctl.detached) return;'),
      'and on the detached path too — a run delivered while the user is elsewhere still keeps its report',
    );
  });

  await h.test('journal: cancel and dismiss delete it in the same operation as the record', () => {
    // `generation-run-journal`: "Dismissing a ghost deletes its journal."
    const dropFn = rootSrc.slice(rootSrc.indexOf('const dropAttempt'), rootSrc.indexOf('const settleFailed'));
    h.ok(dropFn.includes('dropPendingBuild(pending, id)') && dropFn.includes('journal.delete(id)'), 'the two deletions are one operation');
    h.eq(
      (rootSrc.match(/dropPendingBuild\(/g) ?? []).length,
      1,
      'and it is the shell’s ONLY record-deletion call site, so no path can delete a record and orphan its journal',
    );
    h.ok(rootSrc.includes('const onDismissPending = (rec: PendingBuildRecord) => {\n    dropAttempt(rec.id);'), 'dismiss goes through it');
    h.ok(rootSrc.includes('if (live) dropAttempt(live.id);'), 'so does cancel');
  });

  await h.test('journal: deleting an app reclaims its last-run report in the same operation', () => {
    // `lastrun:<appId>` is the one journal key that outlives its attempt. Nothing ever revisits a
    // deleted app's id, so a report not reclaimed here is leaked in MMKV forever.
    const deleteFn = rootSrc.slice(rootSrc.indexOf('const onDelete ='), rootSrc.indexOf('const goHome ='));
    h.ok(deleteFn.includes('await access.remove(app);'), 'the app removal is still the first thing that happens');
    h.ok(deleteFn.includes('journal.deleteLastRun(app.id);'), 'and its last-run report goes with it');
    h.ok(
      deleteFn.indexOf('journal.deleteLastRun(') > deleteFn.indexOf('await access.remove(app)'),
      'after the removal resolved — a failed removal must not orphan the app from its own report',
    );
    h.eq(
      (rootSrc.match(/deleteLastRun\(/g) ?? []).length,
      1,
      'exactly one call site, so a report can never be dropped out from under a live app',
    );
  });

  await h.test('journal: the build screen’s liveness signals are in-memory, and the tick never reads the store', () => {
    // design D6: elapsed/counter/heartbeat are derived from in-memory state on a render tick.
    h.ok(rootSrc.includes('const signalsRef = useRef<RunSignals | null>(null);'), 'the attempt’s signals live in a ref, so a token arrival is not a re-render');
    h.ok(rootSrc.includes('signals={signalsRef.current}') && rootSrc.includes('now={Date.now()}'), 'and reach the build screen as props');
    const tickEffect = rootSrc.slice(rootSrc.indexOf('useEffect(() => {\n    if (screen.kind !== \'build\')'), rootSrc.indexOf('const refresh ='));
    h.ok(tickEffect.includes('RUN_SIGNAL_TICK_MS'), 'a live build screen re-renders on the shared tick constant');
    h.ok(!tickEffect.includes('journal.'), 'and the tick reads nothing out of the journal — it moves a clock, not the store');
  });

  await h.test('highlighting: the off-switch is mounted around the whole launcher tree', () => {
    h.ok(/<HighlightingProvider enabled=\{highlighting\}>/.test(rootSrc), 'without this wrapper the switch is inert everywhere');
    h.ok(rootSrc.includes('loadHighlighting(kv)') && rootSrc.includes('saveHighlighting(kv, enabled)'), 'and it reads/persists the one flag');
  });

  // ── highlighting.ts: real behavior against a fake KVBackend (pattern: server-address above) ──

  await h.test('highlighting: default is ON when the key was never set', () => {
    const kv = new MapKVBackend();
    h.eq(loadHighlighting(kv), true, 'an absent key must resolve to ON');
  });

  await h.test('highlighting: save-off then load round-trips to off, and back on again', () => {
    const kv = new MapKVBackend();
    saveHighlighting(kv, false);
    h.eq(loadHighlighting(kv), false, 'saved OFF must read back OFF');
    saveHighlighting(kv, true);
    h.eq(loadHighlighting(kv), true, 'saved ON must read back ON');
  });

  await h.test('highlighting: a corrupt stored value defaults to ON, never throws', () => {
    const kv = new MapKVBackend();
    kv.set('highlighting', 'not-a-flag');
    let threw = false;
    let result: boolean | undefined;
    try {
      result = loadHighlighting(kv);
      // eslint-disable-next-line no-restricted-syntax -- intentional: the assertion IS "did it throw"; the thrown value is deliberately discarded and h.ok below reports the outcome
    } catch {
      threw = true;
    }
    h.ok(!threw, 'loadHighlighting must never throw on a corrupt stored value');
    h.eq(result, true, 'only the literal "0" reads as OFF — anything else, corrupt included, defaults ON');
  });

  await h.test('highlighting: never throws on a KVBackend returning null', () => {
    const kv = new MapKVBackend();
    const nullish = { ...kv, getString: () => null } as unknown as MapKVBackend;
    let threw = false;
    try {
      loadHighlighting(nullish);
      // eslint-disable-next-line no-restricted-syntax -- intentional: the assertion IS "did it throw"; the thrown value is deliberately discarded and h.ok below reports the outcome
    } catch {
      threw = true;
    }
    h.ok(!threw, 'loadHighlighting must never throw on a null read');
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
