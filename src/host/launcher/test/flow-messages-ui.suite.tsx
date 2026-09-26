/** The prompt flow's beta-1 messages driven through the rendered launcher against a scripted
 *  server: the build's place in line, a restarted model turn, a clarify limit, the fallbacks of
 *  messages this build can't use, and the clarify answer modes (`prompt-flow` ADDED and MODIFIED
 *  requirements, beta-1 D8/D9/D10/D16/D18). Mid-build frames of a type this build can't know come
 *  from the stub's own producer (`server/src/stub-markers.ts`). */
import TestRenderer from 'react-test-renderer';
import { CLARIFICATION_OTHER_MAX_CHARS, Clarification } from '@whim/contract';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import ComposeStep from '../ComposeStep';
import ClarifyStep from '../ClarifyStep';
import BuildStep from '../BuildStep';
import DoneStep from '../DoneStep';
import FailureScreen from '../FailureScreen';
import UpdateRequiredScreen from '../UpdateRequiredScreen';
import { COPY, clarifyBuildInstead } from '../copy';
import { primaryActionLabel } from '../prompt-flow';
import { AppIndex } from '../app-index';
import { PendingBuildStore, type PendingBuildRecord } from '../pending-builds';
import { RunJournalStore } from '../run-journal';
import type { InstalledApp } from '../app-index';
import type { KVBackend } from '../../version-store/fs/kv-fs';
import { PROTOCOL_LEVEL } from '../wire-headers';
import { stubFutureFrame } from '../../../../server/src/stub-markers';
import { button, press, textOf } from './react-screen';
import { buildIt, composeAndContinue, hasInstalled, json, planLoaded, resultEvent, sseStream, tap, waitFor, withLauncher, type SentRequest, type Tree } from './rendered-launcher';
import { startBuild, streamingServer } from './prompt-flow-ui.suite';

type Stream = ReturnType<typeof sseStream>;

const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;
const home = (tree: Tree) => tree.root.findByType(HomeScreen);
const build = (tree: Tree) => tree.root.findByType(BuildStep);
const clarify = (tree: Tree) => tree.root.findByType(ClarifyStep);
const ghosts = (tree: Tree): PendingBuildRecord[] => home(tree).props.pending;
const records = (kv: KVBackend) => new PendingBuildStore(kv).list().map((record) => [record.state, record.failure?.reason]);
const generateSignal = (sent: readonly SentRequest[]) => sent.find((r) => r.path === '/v1/generate')?.signal;

const STAGE = { type: 'stage', stage: 'plan', status: 'start' };

/** A question's pills are buttons; "Decide for me" is on every question, so its pills are told
 *  apart by position, in question order. */
const decidePills = (tree: Tree) => tree.root.findAll((n) => String(n.type) === 'TouchableOpacity' && textOf(n) === COPY.clarifyDecide);
const picked = (node: TestRenderer.ReactTestInstance) => node.props.accessibilityState?.selected === true;
const otherField = (tree: Tree) => tree.root.find((n) => String(n.type) === 'TextInput');

const LIMIT = { reason: 'Mini-apps can’t fetch live weather.', alternative: 'a packing list you fill in yourself' };

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
      h.ok(button(tree, COPY.actionCancelBuild) != null && button(tree, COPY.buildLeaveRunning) != null, 'with Cancel and Leave it running');
      streams[0].push({ type: 'queued', position: 1 });
      await waitFor(() => textOf(tree.root).includes(COPY.buildQueuedNext), 'the front of the line');
      streams[0].push(STAGE);
      await waitFor(() => build(tree).props.stage === 'plan', 'the first stage');
      h.ok(!textOf(tree.root).includes('in line'), 'the in-line message is replaced by normal progress');
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
      h.ok(on(tree, HomeScreen), 'the user lands on Home');
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
      h.ok(on(tree, HomeScreen), 'delivered silently, the user still on Home');
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

  await h.test('limit: the reason and the alternative show and nothing is sent; Build … instead asks clarify about the alternative', async () => {
    const streams: Stream[] = [];
    await withLauncher({ server: limitServer(streams) }, async ({ tree, sent, paths }) => {
      await composeAndContinue(tree, 'What to wear today');
      await waitFor(() => on(tree, ClarifyStep) && clarify(tree).props.limit !== undefined, 'the limit');
      h.ok(textOf(tree.root).includes(LIMIT.reason), 'the user sees why it can’t be built');
      const instead = button(tree, clarifyBuildInstead(LIMIT.alternative));
      h.ok(textOf(instead).includes(LIMIT.alternative), 'and a one-tap option to build the alternative');
      h.eq(paths(), ['/v1/clarify'], 'nothing more is sent on its own — no plan, no build');
      await tap(() => instead.props.onPress());
      await waitFor(() => on(tree, ClarifyStep) && !clarify(tree).props.loading && clarify(tree).props.questions.length === 1, 'clarify about the alternative');
      h.eq(sent.filter((r) => r.path === '/v1/clarify').map((r) => r.body?.prompt), ['What to wear today', LIMIT.alternative], 'a new clarify call, about the alternative');
      h.eq([clarify(tree).props.prompt, clarify(tree).props.limit], [LIMIT.alternative, undefined], 'the alternative is now the prompt, with its own question');
      h.ok(!paths().includes('/v1/generate'), 'and still nothing is built');
    });
  });

  await h.test('limit: Change my idea returns to compose with the original words, editable', async () => {
    await withLauncher({ server: limitServer([]) }, async ({ tree, paths }) => {
      await composeAndContinue(tree, 'What to wear today');
      await waitFor(() => on(tree, ClarifyStep) && clarify(tree).props.limit !== undefined, 'the limit');
      await press(button(tree, COPY.clarifyLimitChangeIdea));
      h.ok(on(tree, ComposeStep), 'back on compose');
      h.eq(tree.root.findByType(ComposeStep).props.text, 'What to wear today', 'with the original prompt');
      await TestRenderer.act(async () => tree.root.findByType(ComposeStep).props.onChangeText('A packing list'));
      h.eq(tree.root.findByType(ComposeStep).props.text, 'A packing list', 'which the user can edit');
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
        h.eq(tree.root.findByType(ComposeStep).props.text, 'A tea timer', 'the typed prompt is not lost');
      });
    });

    await h.test(`fallback: a fail fallback on ${route} ends on the failure screen with the notice, and starts no build`, async () => {
      await withLauncher({ server: server('fail') }, async ({ tree, kv, paths }) => {
        await composeAndContinue(tree, 'A tea timer');
        await waitFor(() => on(tree, FailureScreen), 'the failure screen');
        h.eq(tree.root.findByType(FailureScreen).props.reason, UNARY_NOTICE, 'the notice is the reason');
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

  await h.test('answers: one pick moves, several picks toggle, and Decide for me clears the picks and the typed answer', async () => {
    await withLauncher({ server: answeringServer([]) }, async ({ tree }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => on(tree, ClarifyStep) && !clarify(tree).props.loading, 'the questions');
      await press(button(tree, 'Sound'));
      await press(button(tree, 'Buzz'));
      h.eq([picked(button(tree, 'Sound')), picked(button(tree, 'Buzz'))], [false, true], 'a second tap on a one-pick question moves the pick');
      await press(button(tree, 'Honey'));
      await press(button(tree, 'Lemon'));
      await press(button(tree, 'Honey'));
      h.eq(['Honey', 'Lemon', 'Milk'].map((option) => picked(button(tree, option))), [false, true, false], 'a several-picks question toggles');
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

  await h.test('answers: several picks, a typed answer and Decide for me reach the rewrite and the generation', async () => {
    const streams: Stream[] = [];
    await withLauncher({ server: answeringServer(streams) }, async ({ tree, sent }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => on(tree, ClarifyStep) && !clarify(tree).props.loading, 'the questions');
      await press(button(tree, 'Honey'));
      await press(button(tree, 'Milk'));
      await press(button(tree, 'Large'));
      await TestRenderer.act(async () => otherField(tree).props.onChangeText('  a travel mug  '));
      await press(button(tree, 'Sound'));
      await press(decidePills(tree)[2]);
      await tap(() => button(tree, primaryActionLabel('clarify', false)).props.onPress());
      await waitFor(() => planLoaded(tree), 'the plan');
      const expected = [
        { id: 'extras', question: 'What goes in it?', choices: ['Honey', 'Milk'] },
        { id: 'cup', question: 'What size is the cup?', choices: ['Large'], other: 'a travel mug' },
        { id: 'alert', question: 'How should it tell you?', choices: [], decide: true },
      ];
      h.eq(sent.find((r) => r.path === '/v1/rewrite')?.body?.clarifications, expected, 'the rewrite carries choices, the trimmed other, and decide alone');
      for (const clarification of expected) h.ok(Clarification.safeParse(clarification).success, `${clarification.id} is a contract Clarification`);
      await buildIt(tree);
      await waitFor(() => streams.length === 1, 'the generation request');
      h.eq(sent.find((r) => r.path === '/v1/generate')?.body?.clarifications, expected, 'and so does the generation');
      streams[0].end();
    });
  });

  await h.test('answers: questions from a server that sends no answer modes are one pick each, with no Other field', async () => {
    const older = ANSWER_QUESTIONS.map(({ id, question, options }) => ({ id, question, options }));
    await withLauncher({ server: (r) => (r.path === '/v1/clarify' ? json({ questions: older }) : streamingServer([])(r)) }, async ({ tree }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => on(tree, ClarifyStep) && !clarify(tree).props.loading, 'the questions');
      await press(button(tree, 'Honey'));
      await press(button(tree, 'Lemon'));
      h.eq([picked(button(tree, 'Honey')), picked(button(tree, 'Lemon'))], [false, true], 'a second pick moves the first, as on a one-pick question');
      h.eq(tree.root.findAll((n) => String(n.type) === 'TextInput').length, 0, 'and no question offers an Other field');
    });
  });

  await h.test('answers: skipping the questions sends no answers with the rewrite or the generation', async () => {
    const streams: Stream[] = [];
    await withLauncher({ server: answeringServer(streams) }, async ({ tree, sent }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => on(tree, ClarifyStep) && !clarify(tree).props.loading, 'the questions');
      await press(button(tree, 'Honey'));
      await press(button(tree, 'Honey'));
      await tap(() => button(tree, primaryActionLabel('clarify', false)).props.onPress());
      await waitFor(() => planLoaded(tree), 'the plan');
      await buildIt(tree);
      await waitFor(() => streams.length === 1, 'the generation request');
      const carried = sent.filter((r) => r.path === '/v1/rewrite' || r.path === '/v1/generate').map((r) => [r.path, r.body?.clarifications]);
      h.eq(carried, [['/v1/rewrite', undefined], ['/v1/generate', undefined]],
        'a question picked and unpicked again is no answer, and neither request carries answers');
      streams[0].end();
    });
  });
}
