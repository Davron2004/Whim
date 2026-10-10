/** The prompt flow's beta-1 messages driven through the rendered launcher against a scripted
 *  server: the build's place in line, a restarted model turn, a clarify limit, the fallbacks of
 *  messages this build can't use, and the clarify answer modes (`prompt-flow` ADDED and MODIFIED
 *  requirements, beta-1 D8/D9/D10/D16/D18). Mid-build frames of a type this build can't know come
 *  from the stub's own producer (`server/src/stub-markers.ts`). */
import TestRenderer from 'react-test-renderer';
import { CLARIFICATION_OTHER_MAX_CHARS, Clarification } from '@whim/contract';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import { DescribePage } from '../DescribePage';
import { PlanPage } from '../PlanPage';
import BuildStep from '../BuildStep';
import DoneStep from '../DoneStep';
import FailureScreen from '../FailureScreen';
import UpdateRequiredScreen from '../UpdateRequiredScreen';
import { COPY } from '../copy';
import { AppIndex } from '../app-index';
import { PendingBuildStore, type PendingBuildRecord } from '../pending-builds';
import { RunJournalStore } from '../run-journal';
import type { InstalledApp } from '../app-index';
import type { KVBackend } from '../../version-store/fs/kv-fs';
import { PROTOCOL_LEVEL } from '../wire-headers';
import { STUB_LIMIT, stubFutureFrame } from '../../../../server/src/stub-markers';
import { contentPolicyRefusal, serverBusyRefusal, type ServiceRefusal } from '../../../../server/src/admission/refusals';
import { button, press, textOf } from './react-screen';
import { buildIt, composeAndContinue, hasInstalled, json, onHome, planLoaded, questionsLanded, resultEvent, sseStream, tap, waitFor, withLauncher, type SentRequest, type Tree } from './rendered-launcher';
import { startBuild, streamingServer } from './prompt-flow-ui.suite';

type Stream = ReturnType<typeof sseStream>;

const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;
const home = (tree: Tree) => tree.root.findByType(HomeScreen);
const build = (tree: Tree) => tree.root.findByType(BuildStep);
const plan = (tree: Tree) => tree.root.findByType(PlanPage).props.screen;
const ghosts = (tree: Tree): PendingBuildRecord[] => home(tree).props.pending;
const records = (kv: KVBackend) => new PendingBuildStore(kv).list().map((record) => [record.state, record.failure?.reason]);
const generateSignal = (sent: readonly SentRequest[]) => sent.find((r) => r.path === '/v1/generate')?.signal;
const occurrences = (text: string, part: string) => text.split(part).length - 1;
/** The failure screen's two ways of suggesting the user reword the request, as far as they show. */
const rephraseAdvice = (tree: Tree) => [COPY.failureRowSayItDifferently, COPY.failureRephrase].filter((line) => textOf(tree.root).includes(line));
/** A refusal as the server's own builder makes it and its route answers it. */
const refused = (refusal: ServiceRefusal): Response =>
  new Response(JSON.stringify(refusal.body), { status: refusal.status, headers: { 'Content-Type': 'application/json', ...refusal.headers } });

const STAGE = { type: 'stage', stage: 'plan', status: 'start' };

/** A question's options are chips, radios or checkboxes; "Decide for me" is on every question, so
 *  its chips are told apart by position, in question order. */
const decidePills = (tree: Tree) => tree.root.findAll((n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === COPY.clarifyDecide);
const picked = (node: TestRenderer.ReactTestInstance) => node.props.accessibilityState?.checked === true;
const otherField = (tree: Tree) => tree.root.find((n) => String(n.type) === 'TextInput');

/** The limit the server's own stub clarify answers with (`WHIM_PIPELINE=stub`, prompt marker `[[limit]]`). */
const LIMIT = STUB_LIMIT.limit!;

const ANSWER_QUESTIONS = [
  { id: 'extras', question: 'What goes in it?', options: ['Honey', 'Lemon', 'Milk'], select: 'many', other: false },
  { id: 'cup', question: 'What size is the cup?', options: ['Small', 'Large'], select: 'one', other: true },
  { id: 'alert', question: 'How should it tell you?', options: ['Sound', 'Buzz'], select: 'one', other: false },
];

/** A server whose clarify asks `ANSWER_QUESTIONS`, whose rewrite echoes, and whose generations are
 *  streams the test drives. */
function answeringServer(streams: Stream[]) {
  return (r: SentRequest) => (r.path === '/v1/clarify' ? json({ questions: ANSWER_QUESTIONS }) : streamingServer(streams)(r));
}

/** The notice a unary reply this build can't use carries, and the reply itself: a success body
 *  from a later level (`compat.min` above this build's), which the route sends for it. */
const UNARY_NOTICE = 'Update Whim to answer this one.';
const futureBody = (body: Record<string, unknown>, fallback: 'fail' | 'update') =>
  json({ ...body, compat: { min: PROTOCOL_LEVEL + 1, fallback, notice: UNARY_NOTICE } });

export async function runFlowMessagesUiTests(h: Harness): Promise<void> {
  // ── the line (4.1) ────────────────────────────────────────────────────────────────────────────

  await h.test('line: waiting behind two builds shows the place in line with Cancel and Leave it running; the first stage replaces it', async () => {
    const streams: Stream[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push({ type: 'queued', position: 3 });
      await waitFor(() => build(tree).props.queuedPosition === 3, 'the place in line');
      h.ok(textOf(tree.root).includes('2 builds ahead'), 'the build screen says it is in line with 2 ahead');
      h.ok(textOf(tree.root).includes('Waiting in line · ') && !textOf(tree.root).includes('waiting for a reply'), 'and its status line says it is waiting in line, not for a reply');
      h.ok(button(tree, COPY.actionCancelBuild) != null && button(tree, COPY.buildLeaveRunning) != null, 'with Cancel and Leave it running');
      streams[0].push({ type: 'queued', position: 1 });
      await waitFor(() => textOf(tree.root).includes(COPY.buildQueuedNext), 'the front of the line');
      streams[0].push(STAGE);
      await waitFor(() => build(tree).props.stage === 'plan', 'the first stage');
      h.ok(!textOf(tree.root).includes('in line'), 'the in-line message is replaced by normal progress');
      streams[0].push({ type: 'stage', stage: 'check', status: 'start' });
      await waitFor(() => build(tree).props.stage === 'check', 'the check stage');
      h.ok(textOf(tree.root).includes('Running the checks · ') && !textOf(tree.root).includes('waiting for a reply'), 'while the app is checked, the status line names the checks');
      await h.throws(() => { button(tree, COPY.actionCancelBuild); }, 'Expected one visible button', 'and Cancel goes with it');
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => on(tree, DoneStep), 'the build to deliver');
    });
  });

  await h.test('line: Cancel while in line aborts the request and leaves no ghost and no journal', async () => {
    const streams: Stream[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, sent, kv }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push({ type: 'queued', position: 2 });
      await waitFor(() => build(tree).props.queuedPosition === 2, 'the place in line');
      await press(button(tree, COPY.actionCancelBuild));
      h.eq(sent.find((r) => r.path === '/v1/generate')?.signal?.aborted, true, 'the generation request is aborted');
      h.ok(onHome(tree), 'the user lands on Home');
      h.eq(ghosts(tree), [], 'with no ghost left behind');
      h.eq(new PendingBuildStore(kv).list(), [], 'no pending record');
      h.eq(kv.getAllKeys().filter((k) => k.startsWith('journal:')), [], 'and no journal');
    });
  });

  await h.test('line: a build left running while in line resolves like any other background build', async () => {
    const streams: Stream[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push({ type: 'queued', position: 2 });
      await waitFor(() => build(tree).props.queuedPosition === 2, 'the place in line');
      await press(button(tree, COPY.buildLeaveRunning));
      h.eq(ghosts(tree).map((g) => g.state), ['building'], 'it waits as a building ghost');
      streams[0].push({ type: 'queued', position: 1 });
      streams[0].push(STAGE);
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => hasInstalled(tree, 'Tea Timer'), 'the detached build to deliver');
      h.ok(onHome(tree), 'delivered silently, the user still on Home');
      h.eq(ghosts(tree), [], 'and its ghost is gone');
    });
  });

  // ── a restarted model turn (4.2) ──────────────────────────────────────────────────────────────

  await h.test('restart: a stream that writes, restarts, then delivers counts the resent turn from zero, with no failure', async () => {
    const streams: Stream[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push({ type: 'stage', stage: 'generate', status: 'start' });
      for (let i = 0; i < 12; i++) streams[0].push({ type: 'token', text: 'x'.repeat(100) });
      // en-CA, matching buildLivenessLine's own fixed locale (#89): the phone's locale must not
      // change this comparison (see run-signals.suite.ts's LANG=fr_CA.UTF-8 red-check).
      const written = `${(1_200).toLocaleString('en-CA')} characters`;
      await waitFor(() => textOf(tree.root).includes(written), 'the 1,200 characters written to show');
      streams[0].push({ type: 'restart' });
      await waitFor(() => build(tree).props.signals?.aggregates.chars === 0, 'the restart to reach the screen');
      h.ok(!textOf(tree.root).includes(written), 'the voided characters are no longer counted');
      h.eq(tree.root.findAllByType(FailureScreen).length, 0, 'and no failure is shown');
      h.ok(on(tree, BuildStep), 'the build carries on');
      streams[0].push({ type: 'token', text: 'abc' });
      await waitFor(() => textOf(tree.root).includes('3 characters'), 'the resent turn to count from zero');
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => on(tree, DoneStep), 'the build to deliver');
      const app = tree.root.findByType(DoneStep).props.app as InstalledApp;
      const report = new RunJournalStore(kv).getLastRun(app.id) ?? [];
      h.eq(report.at(-1)?.aggregates, { chars: 3, tokens: 1 }, 'the run’s record counts only what was kept');
      h.eq(report.filter((entry) => entry.failure != null).length, 0, 'and holds no failure');
    });
  });

  // ── a request Whim can't build (4.3) ─────────────────────────────────────────────────────────

  const limitServer = (streams: Stream[]) => (r: SentRequest) => {
    if (r.path === '/v1/clarify') {
      return r.body?.prompt === LIMIT.alternative ? json({ questions: [ANSWER_QUESTIONS[2]] }) : json({ questions: [], limit: LIMIT });
    }
    return streamingServer(streams)(r);
  };

  await h.test('limit: the reason and the alternative show and nothing is sent; Make that instead asks clarify about the alternative', async () => {
    const streams: Stream[] = [];
    await withLauncher({ server: limitServer(streams) }, async ({ tree, sent, paths }) => {
      await composeAndContinue(tree, 'What to wear today');
      await waitFor(() => on(tree, PlanPage) && plan(tree).limit !== undefined, 'the limit');
      h.ok(textOf(tree.root).includes(COPY.planLimitHeadline), 'the page says it can’t be made as asked');
      h.ok(textOf(tree.root).includes(LIMIT.reason), 'the user sees why it can’t be made');
      h.ok(textOf(tree.root).includes(LIMIT.alternative), 'and the nearest thing that could be, in a card');
      h.eq(paths(), ['/v1/clarify'], 'nothing more is sent on its own — no plan, no build');
      await tap(() => button(tree, COPY.planMakeInstead).props.onPress());
      await waitFor(() => on(tree, PlanPage) && !plan(tree).asking && plan(tree).questions.length === 1, 'clarify about the alternative');
      h.eq(sent.filter((r) => r.path === '/v1/clarify').map((r) => r.body?.prompt), ['What to wear today', LIMIT.alternative], 'a new clarify call, about the alternative');
      h.eq([plan(tree).text, plan(tree).limit], [LIMIT.alternative, undefined], 'the alternative is now the prompt, with its own question');
      h.ok(!paths().includes('/v1/generate'), 'and still nothing is made');
    });
  });

  await h.test('limit: Change my idea returns to describe with the original words, editable', async () => {
    await withLauncher({ server: limitServer([]) }, async ({ tree, paths }) => {
      await composeAndContinue(tree, 'What to wear today');
      await waitFor(() => on(tree, PlanPage) && plan(tree).limit !== undefined, 'the limit');
      await press(button(tree, COPY.planChangeIdea));
      h.ok(on(tree, DescribePage), 'back on describe');
      h.eq(tree.root.findByType(DescribePage).props.text, 'What to wear today', 'with the original prompt');
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('A packing list'));
      h.eq(tree.root.findByType(DescribePage).props.text, 'A packing list', 'which the user can edit');
      h.eq(paths(), ['/v1/clarify'], 'and nothing else was sent');
    });
  });

  // ── messages this build can't use (4.4) ──────────────────────────────────────────────────────

  await h.test('fallback: an update fallback mid-build fails the record, installs nothing, and the update screen shows the notice', async () => {
    const streams: Stream[] = [];
    const notice = stubFutureFrame('update').compat?.notice ?? '';
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv, sent }) => {
      await startBuild(tree, 'A tip splitter');
      streams[0].push(STAGE);
      streams[0].push(stubFutureFrame('update'));
      streams[0].push(resultEvent('Tip Splitter'));
      await waitFor(() => on(tree, UpdateRequiredScreen), 'the update screen');
      h.eq(generateSignal(sent)?.aborted, true, 'the generation request is aborted, so the server stops building');
      h.ok(notice.length > 0 && textOf(tree.root).includes(notice), 'showing the notice');
      h.ok(!textOf(tree.root).includes(COPY.updateBody), 'in place of the standard body');
      h.eq(records(kv), [['failed', notice]], 'the pending record resolves as failed');
      h.eq(new AppIndex(kv).list(), [], 'and the result after the frame installs nothing');
      await press(button(tree, COPY.updateNotNow));
      h.eq(ghosts(tree).map((g) => g.state), ['failed'], 'Home keeps the failed ghost for a Retry');
      h.ok(!hasInstalled(tree, 'Tip Splitter'), 'and no new app');
      streams[0].end();
    });
  });

  await h.test('fallback: a fail fallback mid-build ends on the failure screen with the notice as its reason, and installs nothing', async () => {
    const streams: Stream[] = [];
    const notice = stubFutureFrame('fail').compat?.notice ?? '';
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv, sent }) => {
      await startBuild(tree, 'A tip splitter');
      streams[0].push(STAGE);
      streams[0].push(stubFutureFrame('fail'));
      streams[0].push(resultEvent('Tip Splitter'));
      await waitFor(() => on(tree, FailureScreen), 'the failure screen');
      h.eq(generateSignal(sent)?.aborted, true, 'the generation request is aborted, so the server stops building');
      h.eq(tree.root.findByType(FailureScreen).props.reason, notice, 'the notice is the reason, as plain text');
      h.eq(records(kv), [['failed', notice]], 'the pending record resolves as failed');
      h.eq(new AppIndex(kv).list(), [], 'and nothing is installed');
      streams[0].end();
    });
  });

  await h.test('fallback: a fail fallback mid-build shows its notice once and offers no rephrasing, live and reopened from its ghost', async () => {
    const streams: Stream[] = [];
    const notice = stubFutureFrame('fail').compat?.notice ?? '';
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      await startBuild(tree, 'A tip splitter');
      streams[0].push(STAGE);
      streams[0].push(stubFutureFrame('fail'));
      await waitFor(() => on(tree, FailureScreen), 'the failure screen');
      h.ok(notice.length > 0, 'the stub sends a notice');
      h.eq(occurrences(textOf(tree.root), notice), 1, 'the notice reads once');
      h.eq(rephraseAdvice(tree), [], 'and nothing suggests rephrasing');
      await press(button(tree, COPY.failureBack));
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      h.ok(on(tree, FailureScreen), 'its ghost reopens the failure');
      h.eq(occurrences(textOf(tree.root), notice), 1, 'with the notice once');
      h.eq(rephraseAdvice(tree), [], 'and still no rephrasing advice');
      streams[0].end();
    });
  });

  await h.test('failure: a build the model couldn’t finish still advises rephrasing, and states its reason once', async () => {
    const streams: Stream[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      await startBuild(tree, 'A tip splitter');
      streams[0].push(STAGE);
      streams[0].push({ type: 'failure', reason: 'The app did not build.', attempts: 0, diagnostics: [] });
      streams[0].end();
      await waitFor(() => on(tree, FailureScreen), 'the failure screen');
      h.eq(rephraseAdvice(tree), [COPY.failureRowSayItDifferently, COPY.failureRephrase], 'describing it differently is advised');
      h.eq(occurrences(textOf(tree.root), 'The app did not build.'), 1, 'and the reason reads once');
    });
  });

  for (const [name, refusal, advised] of [['capacity', serverBusyRefusal(), false], ['content policy', contentPolicyRefusal(), true]] as const) {
    await h.test(`refusal: a ${name} refusal on a Retry ${advised ? 'keeps' : 'drops'} the rephrase advice, and its reopened ghost agrees`, async () => {
      await withLauncher({
        prepare: (kv) => {
          const pending = new PendingBuildStore(kv);
          pending.create({ id: 'failed', prompt: 'A tea timer', workingTitle: 'Tea timer' });
          pending.setFailed('failed', { reason: 'The app did not build.' });
        },
        server: () => refused(refusal),
      }, async ({ tree, kv }) => {
        await TestRenderer.act(async () => home(tree).props.onOpenPending(new PendingBuildStore(kv).get('failed')));
        h.eq(rephraseAdvice(tree), [COPY.failureRowSayItDifferently], 'a failed generation advises rephrasing');
        await press(button(tree, COPY.screenErrorRetry));
        await waitFor(() => tree.root.findAllByType(FailureScreen)[0]?.props.notice != null, 'the refused Retry');
        h.eq(occurrences(textOf(tree.root), refusal.body.hint), 1, 'the refusal reads once');
        h.eq(rephraseAdvice(tree).length > 0, advised, advised ? 'a refusal about the words keeps the advice' : 'a busy server gets no rephrasing advice');
        await press(button(tree, COPY.failureBack));
        await TestRenderer.act(async () => home(tree).props.onOpenPending(new PendingBuildStore(kv).get('failed')));
        h.eq(rephraseAdvice(tree).length > 0, advised, 'and its ghost reopens the same way');
      });
    });
  }

  await h.test('fallback: an update fallback’s ghost reopens to the update screen with its notice, never the failure screen', async () => {
    const streams: Stream[] = [];
    const notice = stubFutureFrame('update').compat?.notice ?? '';
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      await startBuild(tree, 'A tip splitter');
      streams[0].push(STAGE);
      streams[0].push(stubFutureFrame('update'));
      await waitFor(() => on(tree, UpdateRequiredScreen), 'the update screen');
      await press(button(tree, COPY.updateNotNow));
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      h.ok(on(tree, UpdateRequiredScreen) && !on(tree, FailureScreen), 'the ghost reopens the update screen');
      h.ok(notice.length > 0 && textOf(tree.root).includes(notice), 'showing the notice');
      h.ok(!textOf(tree.root).includes(COPY.updateBody), 'in place of the standard body, as it did live');
      await press(button(tree, COPY.updateNotNow));
      h.eq(ghosts(tree).map((g) => g.state), ['failed'], 'and Not now leaves the ghost where it was');
      streams[0].end();
    });
  });

  await h.test('fallback: once this build is past the level an update fallback ended on, its ghost reopens to the failure screen with Retry', async () => {
    const streams: Stream[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv }) => {
      await startBuild(tree, 'A tip splitter');
      streams[0].push(STAGE);
      streams[0].push(stubFutureFrame('update'));
      await waitFor(() => on(tree, UpdateRequiredScreen), 'the update screen');
      await press(button(tree, COPY.updateNotNow));
      // The record as this build wrote it, read by a build one level on: the update has happened.
      const [written] = new PendingBuildStore(kv).list();
      const remedy = written.failure?.remedy;
      h.eq(remedy, { kind: 'update', protocolLevel: PROTOCOL_LEVEL }, 'the record keeps the level the fallback ended on');
      kv.set(`pending:${written.id}`, JSON.stringify({ ...written, failure: { ...written.failure, remedy: { kind: 'update', protocolLevel: PROTOCOL_LEVEL - 1 } } }));
      await TestRenderer.act(async () => home(tree).props.onOpenPending(new PendingBuildStore(kv).get(written.id)));
      h.ok(on(tree, FailureScreen) && !on(tree, UpdateRequiredScreen), 'the ghost reopens the failure screen');
      h.eq(tree.root.findByType(FailureScreen).props.retryable, true, 'with Retry');
      h.eq(rephraseAdvice(tree), [], 'and no rephrasing advice');
      streams[0].end();
    });
  });

  await h.test('fallback: an update fallback on a build left running still fails its record, and opens the update screen over Home', async () => {
    const streams: Stream[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv }) => {
      await startBuild(tree, 'A tip splitter');
      await press(button(tree, COPY.buildLeaveRunning));
      streams[0].push(STAGE);
      streams[0].push(stubFutureFrame('update'));
      await waitFor(() => on(tree, UpdateRequiredScreen), 'the update screen, over Home');
      h.eq(records(kv).map(([state]) => state), ['failed'], 'the record resolves as failed');
      h.eq(new AppIndex(kv).list(), [], 'and nothing is installed');
      streams[0].end();
    });
  });

  await h.test('fallback: a skip frame mid-build is passed over and the build delivers', async () => {
    const streams: Stream[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push(STAGE);
      streams[0].push(stubFutureFrame('skip'));
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => on(tree, DoneStep), 'the delivered build');
    });
  });

  for (const route of ['clarify', 'rewrite'] as const) {
    const server = (fallback: 'fail' | 'update') => (r: SentRequest) => {
      if (r.path === '/v1/clarify') return route === 'clarify' ? futureBody({ questions: [] }, fallback) : json({ questions: [] });
      return futureBody({ rewrittenPrompt: 'A tea timer', plan: [] }, fallback);
    };
    const sentPaths = route === 'clarify' ? ['/v1/clarify'] : ['/v1/clarify', '/v1/rewrite'];

    await h.test(`fallback: an update fallback on ${route} opens the update screen with the notice, holds the prompt, and starts no build`, async () => {
      await withLauncher({ server: server('update') }, async ({ tree, kv, paths }) => {
        await composeAndContinue(tree, 'A tea timer');
        await waitFor(() => on(tree, UpdateRequiredScreen), 'the update screen');
        h.ok(textOf(tree.root).includes(UNARY_NOTICE), 'showing the notice');
        h.eq(paths(), sentPaths, 'no build was started');
        h.eq(new PendingBuildStore(kv).list(), [], 'and no attempt exists');
        await press(button(tree, COPY.updateNotNow));
        await TestRenderer.act(async () => home(tree).props.onCreate());
        h.eq(tree.root.findByType(DescribePage).props.text, 'A tea timer', 'the typed prompt is not lost');
      });
    });

    await h.test(`fallback: a fail fallback on ${route} stays on the plan page with the notice and Try again, and starts no build`, async () => {
      await withLauncher({ server: server('fail') }, async ({ tree, kv, paths }) => {
        await composeAndContinue(tree, 'A tea timer');
        await waitFor(() => on(tree, PlanPage) && plan(tree).problem !== undefined, 'the notice');
        h.eq(plan(tree).problem?.reason, UNARY_NOTICE, 'the notice is the reason');
        h.ok(textOf(tree.root).includes(UNARY_NOTICE) && button(tree, COPY.planTryAgain) != null, 'shown with Try again');
        h.eq(tree.root.findAllByType(FailureScreen).length, 0, 'never the failure page, which is for a run');
        h.eq(paths(), sentPaths, 'no build was started');
        h.eq(new PendingBuildStore(kv).list(), [], 'and no attempt exists to discard');
      });
    });
  }

  await h.test('fallback: an update fallback on a report opens the update screen with the notice', async () => {
    const streams: Stream[] = [];
    const deliver = streamingServer(streams);
    await withLauncher({ server: (r) => (r.path === '/v1/report' ? futureBody({ reportId: 'report-1' }, 'update') : deliver(r)) }, async ({ tree, paths }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => on(tree, DoneStep), 'the done step');
      await TestRenderer.act(async () => tree.root.findByType(DoneStep).props.onReport());
      await waitFor(() => textOf(tree.root).includes(COPY.reportReasonBroken), 'the report draft');
      await press(button(tree, COPY.reportReasonBroken));
      await press(button(tree, COPY.reportSend));
      await waitFor(() => on(tree, UpdateRequiredScreen), 'the update screen');
      h.ok(paths().includes('/v1/report'), 'after the report was sent');
      h.ok(textOf(tree.root).includes(UNARY_NOTICE), 'showing the notice');
      h.ok(!textOf(tree.root).includes(COPY.updateBody), 'in place of the standard body');
    });
  });

  // ── answer modes (4.5) ───────────────────────────────────────────────────────────────────────

  await h.test('answers: every question starts on Decide for me; one pick moves, several picks toggle, and Decide for me clears the picks and the typed answer', async () => {
    await withLauncher({ server: answeringServer([]) }, async ({ tree }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => questionsLanded(tree), 'the questions');
      h.eq(decidePills(tree).map(picked), [true, true, true], 'each question starts delegated');
      await press(button(tree, 'Sound'));
      await press(button(tree, 'Buzz'));
      h.eq([picked(button(tree, 'Sound')), picked(button(tree, 'Buzz')), picked(decidePills(tree)[2])], [false, true, false], 'a second tap on a one-pick question moves the pick, and picking clears Decide for me');
      await press(button(tree, 'Honey'));
      await press(button(tree, 'Lemon'));
      h.eq(picked(decidePills(tree)[0]), false, 'on a several-picks question picking clears Decide for me too');
      await press(button(tree, 'Honey'));
      h.eq(['Honey', 'Lemon', 'Milk'].map((option) => picked(button(tree, option))), [false, true, false], 'a several-picks question toggles');
      await press(decidePills(tree)[0]);
      h.eq([['Honey', 'Lemon', 'Milk'].map((option) => picked(button(tree, option))), picked(decidePills(tree)[0])], [[false, false, false], true], 'Decide for me clears every pick, and is exclusive');
      await press(button(tree, 'Lemon'));
      await press(button(tree, 'Lemon'));
      h.eq(picked(decidePills(tree)[0]), true, 'emptying the last pick falls back to Decide for me');
      h.eq(otherField(tree).props.maxLength, CLARIFICATION_OTHER_MAX_CHARS, 'the Other field is capped as the contract caps it');
      await TestRenderer.act(async () => otherField(tree).props.onChangeText('a travel mug'));
      await press(button(tree, 'Small'));
      await press(decidePills(tree)[1]);
      h.eq([picked(button(tree, 'Small')), otherField(tree).props.value, picked(decidePills(tree)[1])], [false, '', true],
        'Decide for me clears the pick and the typed answer');
      await TestRenderer.act(async () => otherField(tree).props.onChangeText('a'));
      h.ok(!picked(decidePills(tree)[1]), 'and typing afterwards clears Decide for me');
    });
  });

  await h.test('answers: the rewrite is sent at once with every question delegated, and the generation carries what was answered meanwhile', async () => {
    const streams: Stream[] = [];
    await withLauncher({ server: answeringServer(streams) }, async ({ tree, sent }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => planLoaded(tree), 'the plan');
      const delegated = ANSWER_QUESTIONS.map((q) => ({ id: q.id, question: q.question, choices: [], decide: true }));
      h.eq(sent.find((r) => r.path === '/v1/rewrite')?.body?.clarifications, delegated, 'the rewrite delegates every question, before the person has touched one');
      await press(button(tree, 'Honey'));
      await press(button(tree, 'Milk'));
      await press(button(tree, 'Large'));
      await TestRenderer.act(async () => otherField(tree).props.onChangeText('  a travel mug  '));
      h.ok(!picked(button(tree, 'Large')), 'on a one-pick question, typing an answer takes the pick back');
      await press(button(tree, 'Sound'));
      await press(decidePills(tree)[2]);
      await buildIt(tree);
      await waitFor(() => streams.length === 1, 'the generation request');
      const expected = [
        { id: 'extras', question: 'What goes in it?', choices: ['Honey', 'Milk'] },
        { id: 'cup', question: 'What size is the cup?', choices: [], other: 'a travel mug' },
        { id: 'alert', question: 'How should it tell you?', choices: [], decide: true },
      ];
      for (const clarification of expected) h.ok(Clarification.safeParse(clarification).success, `${clarification.id} is a contract Clarification`);
      h.eq(sent.find((r) => r.path === '/v1/generate')?.body?.clarifications, expected, 'the generation carries choices, the trimmed other alone for the one-pick question, and decide alone');
      h.eq(sent.filter((r) => r.path === '/v1/rewrite').length, 1, 'answering did not send the rewrite again');
      streams[0].end();
    });
  });

  await h.test('answers: questions from a server that sends no answer modes are one pick each, with no Other field', async () => {
    const older = ANSWER_QUESTIONS.map(({ id, question, options }) => ({ id, question, options }));
    await withLauncher({ server: (r) => (r.path === '/v1/clarify' ? json({ questions: older }) : streamingServer([])(r)) }, async ({ tree }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => questionsLanded(tree), 'the questions');
      await press(button(tree, 'Honey'));
      await press(button(tree, 'Lemon'));
      h.eq([picked(button(tree, 'Honey')), picked(button(tree, 'Lemon'))], [false, true], 'a second pick moves the first, as on a one-pick question');
      h.eq(tree.root.findAll((n) => String(n.type) === 'TextInput').length, 0, 'and no question offers an Other field');
    });
  });

  await h.test('answers: making without touching a choice sends every question delegated', async () => {
    const streams: Stream[] = [];
    await withLauncher({ server: answeringServer(streams) }, async ({ tree, sent }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => planLoaded(tree), 'the plan');
      await buildIt(tree);
      await waitFor(() => streams.length === 1, 'the generation request');
      const delegated = ANSWER_QUESTIONS.map((q) => ({ id: q.id, question: q.question, choices: [], decide: true }));
      h.eq(sent.find((r) => r.path === '/v1/generate')?.body?.clarifications, delegated, 'each question goes out as decide: true');
      streams[0].end();
    });
  });
}
