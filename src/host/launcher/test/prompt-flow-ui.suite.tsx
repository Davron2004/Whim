/** The prompt flow driven through the rendered launcher: compose → clarify → plan → build → done,
 *  against a scripted server. Covers what the shell decides between the step screens: when a
 *  request is sent, what it carries, which request leaving a step cancels, where a response lands,
 *  and what the build screen shows while the stream runs. */
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import HomeScreen from '../HomeScreen';
import ComposeStep from '../ComposeStep';
import ClarifyStep from '../ClarifyStep';
import PlanStep from '../PlanStep';
import BuildStep from '../BuildStep';
import DoneStep from '../DoneStep';
import FailureScreen from '../FailureScreen';
import RunDetailsSheet from '../RunDetailsSheet';
import SettingsScreen from '../SettingsScreen';
import WhimProse from '../../ui/whim-prose/WhimProse';
import { COPY } from '../copy';
import { StoreAccess } from '../store-access';
import { RunJournalStore } from '../run-journal';
import type { InstalledApp } from '../app-index';
import { hardwareBack } from './native-host';
import { button, press, textOf } from './react-screen';
import { buildIt, composeAndContinue, hasInstalled, json, planLoaded, resultEvent, settle, sseStream, tap, waitFor, wasSent, withLauncher, type SentRequest, type Tree } from './rendered-launcher';

const QUESTION = { id: 'alert', question: 'How should it tell you?', options: ['Sound', 'Buzz'] };
const APP: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };

const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;
const home = (tree: Tree) => tree.root.findByType(HomeScreen);
const isSwitch = (node: TestRenderer.ReactTestInstance) => node.type === 'Switch';

/** Compose `text` and continue through a zero-question clarify to a loaded plan. */
async function composeToPlan(tree: Tree, text: string): Promise<void> {
  await composeAndContinue(tree, text);
  await waitFor(() => planLoaded(tree), 'the plan to load');
}

/** Build through a zero-question clarify and an empty plan, leaving the generate stream open. */
export async function startBuild(tree: Tree, text: string): Promise<void> {
  await composeToPlan(tree, text);
  await buildIt(tree);
  await waitFor(() => on(tree, BuildStep), 'the build screen');
}

/** A server whose clarify asks nothing, whose rewrite echoes, and whose every generation is a
 *  stream the test drives; `streams` holds them in request order. */
export function streamingServer(streams: ReturnType<typeof sseStream>[]) {
  return (r: SentRequest) => {
    if (r.path === '/v1/clarify') return json({ questions: [] });
    if (r.path === '/v1/rewrite') return json({ rewrittenPrompt: String(r.body?.prompt), plan: [] });
    const stream = sseStream(r.signal);
    streams.push(stream);
    return stream.response;
  };
}

/** A promise the test resolves by hand. */
function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

export async function runPromptFlowUiTests(h: Harness): Promise<void> {
  await h.test('flow: nothing is generated until the plan’s Build it, and then exactly once, with the answers', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({
      server: (r: SentRequest) => {
        if (r.path === '/v1/clarify') return json({ questions: [QUESTION] });
        if (r.path === '/v1/rewrite') return json({ rewrittenPrompt: 'A tea timer that buzzes', plan: [] });
        return streamingServer(streams)(r);
      },
    }, async ({ tree, paths, sent }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => on(tree, ClarifyStep) && !tree.root.findByType(ClarifyStep).props.loading, 'the question');
      await TestRenderer.act(async () => tree.root.findByType(ClarifyStep).props.onAnswer('alert', 'Buzz'));
      await tap(() => tree.root.findByType(ClarifyStep).props.onContinue());
      await waitFor(() => planLoaded(tree), 'the plan');
      await settle();
      h.eq(paths(), ['/v1/clarify', '/v1/rewrite'], 'before Build it, only the clarify and rewrite requests were sent');
      await buildIt(tree);
      await settle();
      h.eq(paths(), ['/v1/clarify', '/v1/rewrite', '/v1/generate'], 'Build it sends the one generation request');
      const generate = sent.find((r) => r.path === '/v1/generate');
      h.eq(generate?.body?.prompt, 'A tea timer that buzzes', 'generation builds the rewritten prompt');
      h.eq(generate?.body?.clarifications, [{ id: 'alert', question: QUESTION.question, answer: 'Buzz' }], 'with the answer given on the clarify step');
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => on(tree, DoneStep), 'the delivered app to land on the done step');
      h.eq(paths().filter((p) => p === '/v1/generate').length, 1, 'and no second generation was started');
    });
  });

  for (const leave of ['clarify', 'plan'] as const) {
    await h.test(`flow: leaving the loading ${leave} step aborts its own request, and the late answer cannot move the screen`, async () => {
      const clarify = held<Response>();
      const rewrite = held<Response>();
      await withLauncher({
        server: (r) => (r.path === '/v1/clarify' ? clarify.promise : rewrite.promise),
      }, async ({ tree, sent }) => {
        await composeAndContinue(tree, 'A tea timer');
        if (leave === 'plan') {
          await TestRenderer.act(async () => { clarify.resolve(json({ questions: [] })); });
          await waitFor(() => on(tree, PlanStep), 'the plan step');
        }
        const own = sent.find((r) => r.path === (leave === 'clarify' ? '/v1/clarify' : '/v1/rewrite'));
        const screen = leave === 'clarify' ? ClarifyStep : PlanStep;
        h.eq(own?.signal?.aborted, false, 'the request is live while its step is showing');
        await TestRenderer.act(async () => tree.root.findByType(screen).props.onBack());
        h.eq(own?.signal?.aborted, true, `leaving ${leave} aborts the request it was waiting on`);
        h.ok(on(tree, ComposeStep), 'back lands on compose');
        await TestRenderer.act(async () => {
          clarify.resolve(json({ questions: [QUESTION] }));
          rewrite.resolve(json({ rewrittenPrompt: 'late', plan: [] }));
        });
        await settle();
        h.ok(on(tree, ComposeStep), 'the late response leaves the user on compose');
        h.eq(tree.root.findAllByType(FailureScreen).length, 0, 'and an abandoned request never shows a failure');
      });
    });
  }

  await h.test('flow: Prompt again sends the app’s name and current description with clarify and rewrite, even when the description resolves after Continue', async () => {
    const original = StoreAccess.prototype.activeDescription;
    try {
      const late = held<string | undefined>();
      StoreAccess.prototype.activeDescription = () => late.promise;
      const clarify = held<Response>();
      await withLauncher({
        apps: [APP],
        server: (r) => (r.path === '/v1/clarify' ? clarify.promise : json({ rewrittenPrompt: 'Timer with laps', plan: [] })),
      }, async ({ tree, sent }) => {
        await TestRenderer.act(async () => home(tree).props.onPromptAgain(APP));
        await TestRenderer.act(async () => tree.root.findByType(ComposeStep).props.onChangeText('Add laps'));
        await tap(() => tree.root.findByType(ComposeStep).props.onContinue());
        h.eq(sent[0]?.body?.app, { name: 'Timer' }, 'clarify, sent before the description resolved, carries the app’s name');
        await TestRenderer.act(async () => { late.resolve('  A stopwatch for tea  '); });
        await TestRenderer.act(async () => { clarify.resolve(json({ questions: [] })); });
        await waitFor(() => wasSent(sent, '/v1/rewrite'), 'the rewrite request');
        h.eq(sent.find((r) => r.path === '/v1/rewrite')?.body?.app, { name: 'Timer', description: 'A stopwatch for tea' },
          'the rewrite carries the description that resolved while clarify was in flight, trimmed');
      });
      const early = held<string | undefined>();
      StoreAccess.prototype.activeDescription = () => early.promise;
      await withLauncher({ apps: [APP], server: () => json({ questions: [] }) }, async ({ tree, sent }) => {
        await TestRenderer.act(async () => home(tree).props.onPromptAgain(APP));
        await TestRenderer.act(async () => { early.resolve('A stopwatch for tea'); });
        await TestRenderer.act(async () => tree.root.findByType(ComposeStep).props.onChangeText('Add laps'));
        await tap(() => tree.root.findByType(ComposeStep).props.onContinue());
        h.eq(sent[0]?.body?.app, { name: 'Timer', description: 'A stopwatch for tea' }, 'a description resolved before Continue rides with clarify');
      });
    } finally {
      StoreAccess.prototype.activeDescription = original;
    }
  });

  for (const from of ['compose', 'clarify'] as const) {
    await h.test(`flow: a busy-server refusal of the rewrite sent from ${from} lands back on ${from}, with the words and the hint`, async () => {
      await withLauncher({
        server: (r) => r.path === '/v1/clarify'
          ? json({ questions: from === 'clarify' ? [QUESTION] : [] })
          : json({ error: 'server_busy', hint: 'Whim is busy right now.' }, 429),
      }, async ({ tree }) => {
        await composeAndContinue(tree, 'A dice roller');
        if (from === 'clarify') {
          await waitFor(() => on(tree, ClarifyStep) && !tree.root.findByType(ClarifyStep).props.loading, 'the question');
          await TestRenderer.act(async () => tree.root.findByType(ClarifyStep).props.onAnswer('alert', 'Sound'));
          await tap(() => tree.root.findByType(ClarifyStep).props.onContinue());
        }
        await waitFor(() => textOf(tree.root).includes('Whim is busy right now.'), 'the refusal to land');
        const landed = from === 'compose' ? ComposeStep : ClarifyStep;
        const other = from === 'compose' ? ClarifyStep : ComposeStep;
        h.ok(on(tree, landed), `the refusal lands on ${from}`);
        h.eq(tree.root.findAllByType(other).length + tree.root.findAllByType(PlanStep).length, 0, 'not on a step that did not send it');
        if (from === 'compose') h.eq(tree.root.findByType(ComposeStep).props.text, 'A dice roller', 'the user’s words are kept');
        else h.eq(tree.root.findByType(ClarifyStep).props.answers, { alert: 'Sound' }, 'the answers are kept');
      });
    });
  }

  await h.test('flow: the build screen shows stages, never streamed text or diagnostic detail', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push({ type: 'stage', stage: 'generate', status: 'start' });
      streams[0].push({ type: 'token', text: 'SENTINEL_TOKEN_TEXT' });
      streams[0].push({ type: 'thinking', chars: 40 });
      streams[0].push({ type: 'diagnostic', diagnostic: { kind: 'type', symbol: 'SENTINEL_SYMBOL', message: 'SENTINEL_MESSAGE', hint: 'SENTINEL_HINT' } });
      streams[0].push({ type: 'stage', stage: 'check', status: 'start' });
      await waitFor(() => tree.root.findByType(BuildStep).props.stage === 'check', 'the stages to reach the screen');
      const shown = textOf(tree.root);
      for (const secret of ['SENTINEL_TOKEN_TEXT', 'SENTINEL_SYMBOL', 'SENTINEL_MESSAGE', 'SENTINEL_HINT']) {
        h.ok(!shown.includes(secret), `the build screen never shows "${secret}"`);
      }
    });
  });

  await h.test('flow: turning highlighting off in Settings renders the plan’s prose flat', async () => {
    const styledSpans = (tree: Tree) => tree.root.findByType(WhimProse).findAll((n) => n.type === 'Text').length - 1;
    await withLauncher({
      server: (r) => r.path === '/v1/clarify'
        ? json({ questions: [] })
        : json({ rewrittenPrompt: 'A timer', plan: [{ label: 'Timer', text: 'Counts down 5 minutes' }] }),
    }, async ({ tree }) => {
      await composeToPlan(tree, 'A timer');
      h.ok(styledSpans(tree) > 0, 'with highlighting on (the default), the duration in the plan row is styled');
      await TestRenderer.act(async () => tree.root.findByType(PlanStep).props.onBack());
      await TestRenderer.act(async () => tree.root.findByType(ComposeStep).props.onBack());
      await TestRenderer.act(async () => home(tree).props.onSettings());
      await TestRenderer.act(async () => tree.root.find(isSwitch).props.onValueChange(false));
      await TestRenderer.act(async () => tree.root.findByType(SettingsScreen).props.onBack());
      await composeToPlan(tree, 'A timer');
      h.eq(styledSpans(tree), 0, 'after switching it off, the same row renders as plain text');
      h.eq(textOf(tree.root.findByType(WhimProse)), 'Counts down 5 minutes', 'with its words unchanged');
    });
  });

  await h.test('flow: Details reads the journal when opened; back closes it, then leaves the run running, which still delivers', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, sent, kv }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push({ type: 'stage', stage: 'plan', status: 'start' });
      await waitFor(() => tree.root.findByType(BuildStep).props.stage === 'plan', 'the first stage');
      await press(button(tree, COPY.buildDetails));
      const opened = tree.root.findByType(RunDetailsSheet).props;
      h.eq(opened.open, true, 'Details opens the sheet');
      const count = opened.entries?.length ?? 0;
      h.ok(count > 0, `with the journal’s entries so far (got ${count})`);
      streams[0].push({ type: 'stage', stage: 'generate', status: 'start' });
      await waitFor(() => tree.root.findByType(BuildStep).props.stage === 'generate', 'the next stage');
      h.eq(tree.root.findByType(RunDetailsSheet).props.entries.length, count, 'the open sheet is not re-read as the stream moves');
      const generate = sent.find((r) => r.path === '/v1/generate');
      await TestRenderer.act(async () => { hardwareBack(); });
      h.eq(tree.root.findByType(RunDetailsSheet).props.open, false, 'hardware back closes the sheet');
      h.ok(on(tree, BuildStep), 'and stays on the build screen');
      h.eq(generate?.signal?.aborted, false, 'without cancelling the run');
      await TestRenderer.act(async () => { hardwareBack(); });
      h.ok(on(tree, HomeScreen), 'a second back leaves the build screen');
      h.eq(generate?.signal?.aborted, false, 'and still does not cancel');
      h.eq(home(tree).props.pending.map((p: { state: string }) => p.state), ['building'], 'the run shows as a building ghost');
      streams[0].push({ type: 'token', text: 'abc' });
      streams[0].push({ type: 'token', text: 'defg' });
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => hasInstalled(tree, 'Tea Timer'), 'the detached run to deliver');
      h.ok(on(tree, HomeScreen), 'delivered silently: the user stays on Home');
      h.eq(home(tree).props.pending, [], 'and the ghost is gone');
      const delivered = home(tree).props.apps.find((a: InstalledApp) => a.name === 'Tea Timer') as InstalledApp;
      const report = new RunJournalStore(kv).getLastRun(delivered.id) ?? [];
      h.eq(report.at(-1)?.kind, 'terminal', 'the journal became the delivered app’s last-run report, ending in its terminal entry');
      h.eq(report.at(-1)?.aggregates, { chars: 7, tokens: 2 }, 'which flushes the final output counts, too recent for any throttled entry');
      h.eq(kv.getAllKeys().filter((k) => k.startsWith('journal:')), [], 'and no attempt journal is left behind');
    });
  });
}
