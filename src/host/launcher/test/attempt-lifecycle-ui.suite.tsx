/** A generation attempt's life on the rendered launcher once the user steps away from it: the
 *  ghost tile it leaves on Home, reattaching to it, its failure screen's exits, what each ending
 *  leaves in storage, and two attempts running at once. */
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import HomeScreen from '../HomeScreen';
import MakingPage from '../MakingPage';
import ReadyPage from '../ReadyPage';
import FailurePage from '../FailurePage';
import UpdateRequiredScreen from '../UpdateRequiredScreen';
import LauncherRoot from '../LauncherRoot';
import { PendingBuildStore, type PendingBuildRecord } from '../pending-builds';
import { JOURNAL_KEY, LAST_RUN_KEY, RunJournalStore } from '../run-journal';
import { GENERIC_STREAM_ERROR } from '../error-reason';
import { AppIndex, type InstalledApp } from '../app-index';
import { StoreAccess } from '../store-access';
import { PendingPurgeStore } from '../pending-purge';
import { chooseRow, longPress, pressToastAction, renderRoot, tileLabels, toastOf } from './home-rig';
import { revokeConsent } from '../ai-consent';
import { openLink } from './native-host';
import { failNativeStorageRemovalsWhen, failNativeStorageWritesWhen } from './native-storage';
import AppLinkMissingScreen from '../AppLinkMissingScreen';
import { appLinkFor } from '../app-link';
import { androidBack, button, press, renderScreen, textOf, unmountScreen } from './react-screen';
import { buildIt, composeAndContinue, failureTryAgain, hasInstalled, json, onHome, planLoaded, resultEvent, settle, sseStream, tap, waitFor, withLauncher, type Launcher, type LauncherSetup, type SentRequest, type Tree } from './rendered-launcher';
import { DescribePage } from '../DescribePage';
import { stateLine, tileAccessibilityLabel } from '../../ui/AppTile-states';
import { startBuild, streamingServer } from './prompt-flow-ui.suite';
import { stubFutureFrame } from '../../../../server/src/stub-markers';
import { serverBusyRefusal } from '../../../../server/src/admission/refusals';
import { testAppInfo, streamResponse } from './client-fixtures';

const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;
const home = (tree: Tree) => tree.root.findByType(HomeScreen);
const ghosts = (tree: Tree): PendingBuildRecord[] => home(tree).props.pending;
const runOf = (rec: PendingBuildRecord) => [rec.id, rec.prompt, rec.state];
const ghostTitled =(tree: Tree, title: string) => ghosts(tree).find((ghost) => ghost.prompt === title)!;

function activeThrowingServer(setThrowStream: (throwStream: () => void) => void) {
  return (request: SentRequest) => {
    if (request.path === '/v1/clarify') return json({ questions: [] });
    if (request.path === '/v1/rewrite') return json({ rewrittenPrompt: String(request.body?.prompt), plan: [] });
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => { setThrowStream(() => controller.error(new Error('active stream failed'))); },
    });
    return streamResponse(body, { headers: { 'Content-Type': 'text/event-stream' } });
  };
}

function activeThrowingStreamsServer(throwStreams: (() => void)[]) {
  return (request: SentRequest) => {
    if (request.path === '/v1/clarify') return json({ questions: [] });
    if (request.path === '/v1/rewrite') return json({ rewrittenPrompt: String(request.body?.prompt), plan: [] });
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => { throwStreams.push(() => controller.error(new Error('active stream failed'))); },
    });
    return streamResponse(body, { headers: { 'Content-Type': 'text/event-stream' } });
  };
}

function delayedRefusalThenActiveStream(releaseRefusals: (() => void)[]) {
  let generateCount = 0;
  const refusal = serverBusyRefusal();
  return (request: SentRequest) => {
    if (request.path === '/v1/clarify') return json({ questions: [] });
    if (request.path === '/v1/rewrite') return json({ rewrittenPrompt: String(request.body?.prompt), plan: [] });
    if (generateCount++ === 0) {
      return new Promise<Response>((resolve) => {
        releaseRefusals.push(() => resolve(new Response(JSON.stringify(refusal.body), {
          status: refusal.status,
          headers: { 'Content-Type': 'application/json', ...refusal.headers },
        })));
      });
    }
    return streamResponse(new ReadableStream<Uint8Array>(), { headers: { 'Content-Type': 'text/event-stream' } });
  };
}

type KeepaliveStream = {
  response: Response;
  push: (event: unknown) => void;
  end: () => void;
  keepalive: () => void;
};

function keepaliveStreamingServer(streams: KeepaliveStream[]) {
  return (request: SentRequest) => {
    if (request.path === '/v1/clarify') return json({ questions: [] });
    if (request.path === '/v1/rewrite') return json({ rewrittenPrompt: String(request.body?.prompt), plan: [] });
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let open = true;
    const body = new ReadableStream<Uint8Array>({ start: (next) => { controller = next; } });
    request.signal?.addEventListener('abort', () => {
      if (!open) return;
      open = false;
      controller.error(new DOMException('The operation was aborted.', 'AbortError'));
    });
    const stream: KeepaliveStream = {
      response: streamResponse(body, { headers: { 'Content-Type': 'text/event-stream' } }),
      push: (event) => { if (open) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); },
      end: () => { if (open) { open = false; controller.close(); } },
      keepalive: () => { if (open) controller.enqueue(encoder.encode(': keepalive\n\n')); },
    };
    streams.push(stream);
    return stream.response;
  };
}

function delayInstalls() {
  let release!: () => void;
  let started = false;
  let finished = false;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const original = StoreAccess.prototype.install;
  StoreAccess.prototype.install = async function (...args) {
    started = true;
    await gate;
    const installed = await original.apply(this, args);
    finished = true;
    return installed;
  };
  return { release, started: () => started, finished: () => finished, restore: () => { StoreAccess.prototype.install = original; } };
}

/** Leave the build screen the way the button does: the run keeps going. */
async function leaveRunning(tree: Tree): Promise<void> {
  await press(button(tree, COPY.sheetClose));
}

/** Rewrites the record of a run still going as a failed one — a false claim — and presses Try again on
 *  the Failure page its ghost opens. Returns the forged record's bytes. */
async function tryAgainWhileRunning(tree: Tree, kv: Launcher['kv'], id: string): Promise<string> {
  const started = new PendingBuildStore(kv).get(id)!;
  const forged = JSON.stringify({ ...started, prompt: 'A dice roller', workingTitle: 'Dice roller', state: 'failed', failure: { reason: 'Retry this instead.' } });
  kv.set(`pending:${id}`, forged);
  await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
  await press(failureTryAgain(tree));
  await settle();
  return forged;
}

async function openPending(tree: Tree, record: PendingBuildRecord): Promise<void> {
  await TestRenderer.act(async () => home(tree).props.onOpenPending(record));
}

/** A failed attempt an earlier launch saved, written through the stores in the order a run writes
 *  it: the record, its journal (then marked readable), a stage, the failure. */
const savedFailure: NonNullable<LauncherSetup['prepare']> = (kv) => {
  const pending = new PendingBuildStore(kv);
  pending.create({ id: 'failed', prompt: 'A tea timer', workingTitle: 'Tea timer' });
  const journal = new RunJournalStore(kv);
  journal.create('failed');
  pending.setJournalAvailability('failed', 'verified');
  journal.appendStage('failed', 'generate');
  journal.appendTerminal('failed', { failure: { reason: 'The earlier build stopped.' } });
  pending.setFailed('failed', { reason: 'The earlier build stopped.' });
};

/** The Discard toast's 6 s run out: its window ends and the purge runs, to the end or to a failure. */
async function runOutUndo(tree: Tree, clock: Launcher['clock']): Promise<void> {
  await TestRenderer.act(async () => { clock.fire(6_000); });
  await waitFor(() => toastOf(tree) === null, 'the Undo toast to leave');
  await settle();
}

/** Start a change of `app` from Home with `words`, through a zero-question plan, onto its Making page. */
async function startChange(tree: Tree, app: InstalledApp, words: string): Promise<void> {
  await TestRenderer.act(async () => home(tree).props.onPromptAgain(app));
  await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText(words));
  await tap(() => tree.root.findByType(DescribePage).props.onContinue());
  await waitFor(() => planLoaded(tree), 'the change’s plan');
  await buildIt(tree);
  await waitFor(() => on(tree, MakingPage), 'the change’s making page');
}

/** A change of the example Tip Splitter that failed, discarded from its Failure page: the Undo toast
 *  is still up and the discard armed when this resolves. */
async function discardFailedChange(tree: Tree, streams: ReturnType<typeof sseStream>[], from: 'page' | 'home'): Promise<InstalledApp> {
  await waitFor(() => onHome(tree) && hasInstalled(tree, 'Tip Splitter'), 'the example apps');
  const app = (home(tree).props.apps as InstalledApp[]).find((a) => a.name === 'Tip Splitter')!;
  await startChange(tree, app, 'Add a tip slider');
  await waitFor(() => streams.length === 1, 'the change’s stream');
  streams[0].push({ type: 'failure', reason: 'The change did not build.', attempts: 1, diagnostics: [] });
  streams[0].end();
  await waitFor(() => on(tree, FailurePage), 'the failed change’s page');
  if (from === 'page') {
    await press(button(tree, COPY.actionDiscard));
  } else {
    await press(button(tree, COPY.sheetClose));
    await longPress(tree, 'Tip Splitter');
    await chooseRow(tree, COPY.actionDiscardChange);
  }
  return app;
}

/** Whim launched again over the same storage, once Home is drawn. */
async function afterRelaunch(body: (tree: Tree) => Promise<void>): Promise<void> {
  const next = await renderRoot(<LauncherRoot appInfo={testAppInfo} deviceLocale={() => 'en-US'} />);
  try {
    await waitFor(() => on(next, HomeScreen), 'the relaunched Home');
    await body(next);
  } finally {
    await unmountScreen(next);
  }
}

export async function runAttemptLifecycleUiTests(h: Harness): Promise<void> {
  await h.test('ghosts: a build still marked building from a previous launch shows as interrupted', async () => {
    await withLauncher({
      prepare: (kv) => new PendingBuildStore(kv).create({ id: 'orphan', prompt: 'A tea timer', workingTitle: 'Tea timer' }),
      server: () => json({}),
    }, async ({ tree }) => {
      h.eq(ghosts(tree).map((g) => [g.id, g.state]), [['orphan', 'interrupted']], 'the ghost reads interrupted, since no stream survived the restart');
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      h.eq(tree.root.findByType(FailurePage).props.reason, COPY.interruptedBuildReason, 'tapping it explains the build was interrupted');
    });
  });

  await h.test('ghosts: an interrupted build’s failure screen says its last stage didn’t finish, and offers no rewording advice', async () => {
    await withLauncher({
      prepare: (kv) => {
        // What a live run had written when its process died, in the order it writes it: the record,
        // its journal (then marked readable), and two stage starts with no terminal entry.
        const pending = new PendingBuildStore(kv);
        pending.create({ id: 'orphan', prompt: 'A tea timer', workingTitle: 'Tea timer' });
        const journal = new RunJournalStore(kv);
        journal.create('orphan');
        pending.setJournalAvailability('orphan', 'verified');
        journal.appendStage('orphan', 'plan');
        journal.appendStage('orphan', 'generate');
      },
      server: () => json({}),
    }, async ({ tree }) => {
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      h.ok(textOf(tree.root.findByType(FailurePage)).includes(COPY.interruptedBuildReason), 'the page says making stopped when Whim closed');
      await press(button(tree, COPY.timelineTitle));
      const shown = textOf(tree.root.findByType(FailurePage));
      h.ok(shown.includes(`${COPY.timelineStageGenerate} · ${COPY.timelineDidNotFinish}`), 'what happened: the stage the build was in when the app closed didn’t finish');
      h.ok(!shown.includes(COPY.timelineStillGoing), 'and nothing on it is still going');
      h.ok(!shown.includes(COPY.failureChangeDescription) && !shown.includes(COPY.failureTryAgainAsIs) && !/describing it differently/i.test(shown), 'rewording the request is not offered: the interruption wasn’t the request’s doing');
      h.ok(button(tree, COPY.actionTryAgain) != null, 'Try again is');
    });
  });

  await h.test('ghosts: cold recovery retains an unwritable interruption while recovering the other building record', async () => {
    let clearWriteFailure: (() => void) | undefined;
    await withLauncher({
      prepare: (kv) => {
        const pending = new PendingBuildStore(kv);
        pending.create({ id: 'unwritable', prompt: 'A tea timer', workingTitle: 'Tea timer' });
        pending.create({ id: 'recoverable', prompt: 'A dice roller', workingTitle: 'Dice roller' });
        const journal = new RunJournalStore(kv);
        journal.create('unwritable');
        journal.appendTerminal('unwritable', { failure: { reason: 'An old report must stay unavailable.' } });
        clearWriteFailure = failNativeStorageWritesWhen(({ id, key }) => id === 'whim.launcher' && key === 'pending:unwritable');
      },
      server: () => json({}),
    }, async ({ tree, kv }) => {
      try {
        h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.state]), [['recoverable', 'interrupted'], ['unwritable', 'interrupted']], 'Home is ready with both cold attempts interrupted');
        h.eq([new PendingBuildStore(kv).get('unwritable')?.state, new PendingBuildStore(kv).get('unwritable')?.journalUnavailable], ['building', true], 'the unwritable raw record remains a flagged building snapshot');
        h.eq(new PendingBuildStore(kv).get('recoverable')?.state, 'interrupted', 'the independent record persists its interruption despite the sibling outage');
        const retained = ghosts(tree).find((ghost) => ghost.id === 'unwritable')!;
        await TestRenderer.act(async () => home(tree).props.onOpenPending(retained));
        const failure = tree.root.findByType(FailurePage).props;
        h.eq([failure.reason, failure.attemptStarted, failure.journal], [COPY.interruptedBuildReason, false, null], 'the retained cold interruption withholds its old report');
      } finally {
        clearWriteFailure?.();
      }
    });
  });

  await h.test('ghosts: tapping a building ghost returns to its run without a second request, and the result still lands', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, paths }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push({ type: 'stage', stage: 'generate', status: 'start' });
      await waitFor(() => tree.root.findByType(MakingPage).props.stage === 'generate', 'the stage');
      await leaveRunning(tree);
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      h.ok(on(tree, MakingPage), 'the ghost reopens the build screen');
      h.eq(tree.root.findByType(MakingPage).props.stage, 'generate', 'at the stage the run reached');
      h.eq(paths().filter((p) => p === '/v1/generate').length, 1, 'no second generation was sent');
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => on(tree, ReadyPage), 'the result to land on the done step, as if the user never left');
    });
  });

  await h.test('ghosts: an app link arriving on the Making page leaves the run running, and its tile reopens the run’s page', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, sent }) => {
      await startBuild(tree, 'A tea timer');
      await TestRenderer.act(async () => openLink(appLinkFor('missing')));
      h.ok(on(tree, AppLinkMissingScreen), 'the link takes the user to its screen');
      h.eq(sent.find((r) => r.path === '/v1/generate')?.signal?.aborted, false, 'without cancelling the run');
      await press(button(tree, COPY.appLinkMissingBack));
      h.eq(ghosts(tree).map((g) => g.state), ['building'], 'which is still building');
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      h.ok(on(tree, MakingPage), 'its tile reopens the Making page');
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => on(tree, ReadyPage), 'the run to deliver');
    });
  });

  await h.test('ghosts: a failed build’s Back keeps its record and journal; its ghost reopens the saved failure, and Discard deletes both', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv, clock }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push({ type: 'failure', reason: 'The app did not build.', attempts: 2, diagnostics: [{ kind: 'type', symbol: 'x', message: 'm', hint: 'Try fewer screens.' }] });
      streams[0].end();
      await waitFor(() => on(tree, FailurePage), 'the failure screen');
      const id = new PendingBuildStore(kv).list()[0]?.id ?? '';
      h.ok(id != null, 'the failed attempt is kept as a record');
      const journal = new RunJournalStore(kv).get(id) ?? [];
      h.eq(journal.at(-1)?.failure?.reason, 'The app did not build.', 'its journal ends with the failure');
      await press(button(tree, COPY.sheetClose));
      h.ok(on(tree, HomeScreen), 'Back returns to Home');
      h.eq(ghosts(tree).map((g) => [g.id, g.state]), [[id, 'failed']], 'the failed ghost stays');
      h.ok(kv.getString(JOURNAL_KEY(id)) != null, 'and its journal is still readable');
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      const hydrated = tree.root.findByType(FailurePage).props;
      h.eq([hydrated.reason, hydrated.diagnostics], ['The app did not build.', [{ hint: 'Try fewer screens.' }]], 'the ghost reopens the saved reason and hints');
      h.ok(typeof hydrated.onRetry === 'function', 'with Try again');
      await androidBack(tree);
      h.ok(on(tree, HomeScreen), 'Android back closes the page');
      h.eq(ghosts(tree).length, 1, 'and is the close: nothing is deleted');
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      await press(button(tree, COPY.actionDiscard));
      h.ok(on(tree, HomeScreen) && !on(tree, FailurePage), 'Discard closes the page onto Home');
      h.eq(tileLabels(tree), [], 'the ghost is gone at once');
      await runOutUndo(tree, clock);
      h.eq(ghosts(tree), [], 'and stays gone once its Undo window ends');
      h.eq([kv.getString(`pending:${id}`) ?? null, kv.getString(JOURNAL_KEY(id)) ?? null], [null, null], 'record and journal are both deleted');
    });
  });

  await h.test('ghosts: Retry on a failed ghost re-runs its prompt as the same ghost, not a second one', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv, sent }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].end();
      await waitFor(() => on(tree, FailurePage), 'the failure screen');
      await press(button(tree, COPY.sheetClose));
      const [failed] = ghosts(tree);
      await TestRenderer.act(async () => home(tree).props.onOpenPending(failed));
      await press(failureTryAgain(tree));
      await waitFor(() => on(tree, MakingPage), 'the retried build');
      const generates = sent.filter((r) => r.path === '/v1/generate');
      h.eq(generates.length, 2, 'Retry sends a new generation request');
      h.eq(generates[1]?.body?.prompt, 'A tea timer', 'for the stored prompt');
      h.eq(new PendingBuildStore(kv).list().map((r) => [r.id, r.state]), [[failed.id, 'building']], 'under the same record, now building again');
    });
  });

  await h.test('ghosts: a failed Retry sends no new request until setup recovers and then reuses its id once', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv, sent }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].end();
      await waitFor(() => on(tree, FailurePage), 'the initial failed build');
      const initialRequests = sent.filter((request) => request.path === '/v1/generate').length;
      const failedId = new PendingBuildStore(kv).list()[0]!.id;
      const oldPending = kv.getString(`pending:${failedId}`);
      const oldJournal = kv.getString(JOURNAL_KEY(failedId));
      revokeConsent(kv);
      await press(button(tree, COPY.sheetClose));
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      const clearWriteFailure = failNativeStorageWritesWhen(({ id, key }) =>
        id === 'whim.launcher' && key === JOURNAL_KEY(failedId));
      try {
        await press(failureTryAgain(tree));
        await waitFor(() => textOf(tree.root).includes(COPY.consentTitle), 'the retry consent step');
        await press(button(tree, COPY.consentAgree));
        await waitFor(() => on(tree, FailurePage), 'the rejected retry setup');

        h.eq(sent.filter((request) => request.path === '/v1/generate').length, initialRequests, 'the failed setup sends zero new generation requests beyond the initial run');
        h.eq([kv.getString(`pending:${failedId}`), kv.getString(JOURNAL_KEY(failedId))], [oldPending, oldJournal], 'the failed setup restores the prior pending and journal bytes before activation');
        await press(button(tree, COPY.sheetClose));
        h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.state]), [[failedId, 'failed']], 'the prior current failed ghost remains the one actionable entry');
      } finally {
        clearWriteFailure();
      }

      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      await press(failureTryAgain(tree));
      await waitFor(() => streams.length === initialRequests + 1 && on(tree, MakingPage), 'the recovered retry to activate');
      h.eq(sent.filter((request) => request.path === '/v1/generate').length, initialRequests + 1, 'the verified recovered setup sends exactly one new generation request');
      h.eq(new PendingBuildStore(kv).list().map((record) => [record.id, record.state]), [[failedId, 'building']], 'the recovered retry activates the same launcher id only after setup verification');
    });
  });

  await h.test('ghosts: a pending-order MMKV write failure after a fresh record is written leaves no building ghost or request', async () => {
    await withLauncher({ server: streamingServer([]) }, async ({ tree, kv, sent }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => planLoaded(tree), 'the plan to load');
      const clearFailure = failNativeStorageWritesWhen(({ id, key }) => id === 'whim.launcher' && key === 'pending:order');
    try {
      await buildIt(tree);
      await waitFor(() => on(tree, FailurePage), 'the setup failure screen');

      h.eq(sent.filter((request) => request.path === '/v1/generate').length, 0, 'the failed setup sends no generation request');
      h.eq(new PendingBuildStore(kv).list(), [], 'the partial record is removed instead of becoming a building ghost');
      h.eq(kv.getAllKeys().filter((key) => key.startsWith('pending:')), [], 'no hidden pending record survives outside the order list');
      h.eq(kv.getAllKeys().filter((key) => key.startsWith('journal:')), [], 'no sibling journal remains for the partial record');
      h.eq(tree.root.findByType(FailurePage).props.reason, GENERIC_STREAM_ERROR, 'the user sees the established generic failure');
    } finally {
      clearFailure();
    }
  });
  });

  await h.test('ghosts: a consent-resumed Retry whose terminal write fails returns to generic failure and restores its old pair', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    let rejectTerminalWrite = false;
    await withLauncher({
      consent: false,
      prepare: (kv) => {
        const pending = new PendingBuildStore(kv);
        pending.create({ id: 'failed', prompt: 'A tea timer', workingTitle: 'Tea timer' });
        pending.setFailed('failed', { reason: 'The earlier build stopped.', diagnostics: 'Try again.' });
        const journal = new RunJournalStore(kv);
        journal.create('failed');
        journal.appendTerminal('failed', { failure: { reason: 'The earlier build stopped.' } });
      },
      server: streamingServer(streams),
    }, async ({ tree, kv, sent }) => {
      const pendingBefore = kv.getString('pending:failed');
      const journalBefore = kv.getString(JOURNAL_KEY('failed'));
      const unhandled: unknown[] = [];
      const captureRejection = (reason: unknown) => { unhandled.push(reason); };
      process.on('unhandledRejection', captureRejection);
      const clearFailure = failNativeStorageWritesWhen(({ id, key, value }) =>
        rejectTerminalWrite && id === 'whim.launcher' && key === JOURNAL_KEY('failed') && value.includes(COPY.failureConnection));
      try {
        const failed = new PendingBuildStore(kv).get('failed');
        await TestRenderer.act(async () => home(tree).props.onOpenPending(failed));
        await press(failureTryAgain(tree));
        await waitFor(() => textOf(tree.root).includes(COPY.consentTitle), 'the retry consent step');
        await press(button(tree, COPY.consentAgree));
        await waitFor(() => streams.length === 1, 'the retried stream request');
        await waitFor(() => on(tree, MakingPage), 'the retried build');

        rejectTerminalWrite = true;
        streams[0].end();
        await settle();

        h.eq(unhandled, [], 'the consent-resumed retry handles a terminal-persistence rejection');
        await waitFor(() => on(tree, FailurePage), 'the generic terminal-persistence failure');
        h.eq(sent.filter((request) => request.path === '/v1/generate').length, 1, 'the retry sends exactly one generation request');
        h.eq(tree.root.findByType(FailurePage).props.reason, GENERIC_STREAM_ERROR, 'the user sees the established generic failure');
        h.ok(!textOf(tree.root).includes('native storage write failed'), 'the storage error stays out of the failure screen');
        h.eq([kv.getString('pending:failed'), kv.getString(JOURNAL_KEY('failed'))], [pendingBefore, journalBefore], 'the old pending record and journal are restored exactly');
        await press(button(tree, COPY.sheetClose));
        h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.state]), [['failed', 'failed']], 'the restored ghost is never shown as building');
      } finally {
        clearFailure();
        process.off('unhandledRejection', captureRejection);
      }
    });
  });

  await h.test('ghosts: a consent-resumed Retry whose old pending record cannot be restored persists a generic failed record instead of a dead build', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    let rejectTerminalWrite = false;
    await withLauncher({
      consent: false,
      prepare: (kv) => {
        const pending = new PendingBuildStore(kv);
        pending.create({ id: 'failed', prompt: 'A tea timer', workingTitle: 'Tea timer' });
        pending.setFailed('failed', { reason: 'The earlier build stopped.', diagnostics: 'Try again.' });
        const journal = new RunJournalStore(kv);
        journal.create('failed');
        journal.appendTerminal('failed', { failure: { reason: 'The earlier build stopped.' } });
      },
      server: streamingServer(streams),
    }, async ({ tree, kv, sent }) => {
      const pendingBefore = kv.getString('pending:failed')!;
      const journalBefore = kv.getString(JOURNAL_KEY('failed'));
      const unhandled: unknown[] = [];
      const captureRejection = (reason: unknown) => { unhandled.push(reason); };
      process.on('unhandledRejection', captureRejection);
      const clearFailure = failNativeStorageWritesWhen(({ id, key, value }) =>
        rejectTerminalWrite && id === 'whim.launcher' && (
          key === JOURNAL_KEY('failed') && value.includes(COPY.failureConnection)
          || key === 'pending:failed' && value === pendingBefore
        ));
      try {
        await TestRenderer.act(async () => home(tree).props.onOpenPending(new PendingBuildStore(kv).get('failed')));
        await press(failureTryAgain(tree));
        await waitFor(() => textOf(tree.root).includes(COPY.consentTitle), 'the retry consent step');
        await press(button(tree, COPY.consentAgree));
        await waitFor(() => streams.length === 1 && on(tree, MakingPage), 'the retried build');

        rejectTerminalWrite = true;
        streams[0].end();
        await waitFor(() => on(tree, FailurePage), 'the generic terminal-persistence failure');

        const failed = new PendingBuildStore(kv).get('failed');
        h.eq(unhandled, [], 'the partial recovery does not reject its retry continuation');
        h.eq(sent.filter((request) => request.path === '/v1/generate').length, 1, 'the retry sends exactly one generation request');
        h.eq([failed?.state, failed?.failure?.reason], ['failed', GENERIC_STREAM_ERROR], 'the persisted record truthfully says the ended retry failed');
        h.ok(kv.getString('pending:failed') !== pendingBefore, 'the failed restore is never claimed as an old-pair rollback');
        h.eq(kv.getString(JOURNAL_KEY('failed')), journalBefore, 'the restored old journal is never wiped for the generic record fallback');
        const failure = tree.root.findByType(FailurePage).props;
        h.eq([failure.onDismiss != null, failure.attemptStarted, failure.journal], [true, false, null], 'the verified record is discardable without claiming the old report');
        await press(button(tree, COPY.sheetClose));
        h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.state]), [['failed', 'failed']], 'Back never exposes the ended retry as building');
        await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
        const reopened = tree.root.findByType(FailurePage).props;
        h.eq([reopened.reason, reopened.attemptStarted, reopened.journal], [GENERIC_STREAM_ERROR, false, null], 'reopening the generic ghost still withholds the old report');
      } finally {
        clearFailure();
        process.off('unhandledRejection', captureRejection);
      }
    });
  });

  await h.test('ghosts: a fresh launcher over the same MMKV withholds an old journal from a generic failed retry', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    let rejectTerminalWrite = false;
    await withLauncher({
      prepare: (kv) => {
        const pending = new PendingBuildStore(kv);
        pending.create({ id: 'failed', prompt: 'A tea timer', workingTitle: 'Tea timer' });
        pending.setFailed('failed', { reason: 'The earlier build stopped.' });
        const journal = new RunJournalStore(kv);
        journal.create('failed');
        journal.appendTerminal('failed', { failure: { reason: 'The earlier build stopped.' } });
      },
      server: streamingServer(streams),
    }, async ({ tree, kv }) => {
      const oldJournal = kv.getString(JOURNAL_KEY('failed'));
      const oldPending = kv.getString('pending:failed')!;
      const clearFailure = failNativeStorageWritesWhen(({ id, key, value }) =>
        rejectTerminalWrite && id === 'whim.launcher' && (
          key === JOURNAL_KEY('failed') && value.includes(COPY.failureConnection)
          || key === 'pending:failed' && value === oldPending
        ));
      let fresh: Tree | undefined;
      try {
        await TestRenderer.act(async () => home(tree).props.onOpenPending(new PendingBuildStore(kv).get('failed')));
        await press(failureTryAgain(tree));
        await waitFor(() => streams.length === 1 && on(tree, MakingPage), 'the retried build');
        rejectTerminalWrite = true;
        streams[0].end();
        await waitFor(() => on(tree, FailurePage), 'the generic failure');
        h.eq(kv.getString(JOURNAL_KEY('failed')), oldJournal, 'the raw old journal survives recovery');
        await unmountScreen(tree);
        fresh = await renderScreen(
          <LauncherRoot
            appInfo={testAppInfo}
            deviceLocale={() => 'en-US'}
            ageSignal={() => Promise.resolve('unavailable')}
          />,
        );
        await waitFor(() => fresh!.root.findAllByType(HomeScreen).length === 1, 'the fresh launcher home screen');
        const freshGhost = fresh.root.findByType(HomeScreen).props.pending[0];
        await TestRenderer.act(async () => fresh!.root.findByType(HomeScreen).props.onOpenPending(freshGhost));
        const failure = fresh.root.findByType(FailurePage).props;
        h.eq([failure.reason, failure.attemptStarted, failure.journal], [GENERIC_STREAM_ERROR, false, null], 'a cold launcher cannot borrow the old report');
      } finally {
        if (fresh) await unmountScreen(fresh);
        clearFailure();
      }
    });
  });

  await h.test('ghosts: a consent-resumed Retry whose update fallback cannot persist restores its old pair and shows generic failure', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    const update = stubFutureFrame('update');
    const notice = update.compat?.notice ?? '';
    let rejectTerminalWrite = false;
    await withLauncher({
      consent: false,
      prepare: (kv) => {
        const pending = new PendingBuildStore(kv);
        pending.create({ id: 'failed', prompt: 'A tea timer', workingTitle: 'Tea timer' });
        pending.setFailed('failed', { reason: 'The earlier build stopped.', diagnostics: 'Try again.' });
        const journal = new RunJournalStore(kv);
        journal.create('failed');
        journal.appendTerminal('failed', { failure: { reason: 'The earlier build stopped.' } });
      },
      server: streamingServer(streams),
    }, async ({ tree, kv, sent }) => {
      const pendingBefore = kv.getString('pending:failed');
      const journalBefore = kv.getString(JOURNAL_KEY('failed'));
      const clearFailure = failNativeStorageWritesWhen(({ id, key, value }) =>
        rejectTerminalWrite && id === 'whim.launcher' && key === JOURNAL_KEY('failed') && value.includes(notice));
      try {
        await TestRenderer.act(async () => home(tree).props.onOpenPending(new PendingBuildStore(kv).get('failed')));
        await press(failureTryAgain(tree));
        await waitFor(() => textOf(tree.root).includes(COPY.consentTitle), 'the retry consent step');
        await press(button(tree, COPY.consentAgree));
        await waitFor(() => streams.length === 1 && on(tree, MakingPage), 'the retried build');

        rejectTerminalWrite = true;
        streams[0].push(update);
        await waitFor(() => on(tree, FailurePage), 'the generic update-persistence failure');

        h.eq(sent.filter((request) => request.path === '/v1/generate').length, 1, 'the retry sends exactly one generation request');
        h.eq(tree.root.findByType(FailurePage).props.reason, GENERIC_STREAM_ERROR, 'the update write failure stays generic');
        h.ok(!on(tree, UpdateRequiredScreen), 'the update screen does not claim a failed terminal settlement');
        h.eq([kv.getString('pending:failed'), kv.getString(JOURNAL_KEY('failed'))], [pendingBefore, journalBefore], 'the old pair is restored exactly');
        await press(button(tree, COPY.sheetClose));
        h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.state]), [['failed', 'failed']], 'Back returns to the old failed ghost');
      } finally {
        clearFailure();
      }
    });
  });

  await h.test('ghosts: a consent-resumed Retry whose service refusal cannot persist restores its old pair without rejecting', async () => {
    const refusal = serverBusyRefusal();
    let rejectTerminalWrite = false;
    await withLauncher({
      consent: false,
      prepare: (kv) => {
        const pending = new PendingBuildStore(kv);
        pending.create({ id: 'failed', prompt: 'A tea timer', workingTitle: 'Tea timer' });
        pending.setFailed('failed', { reason: 'The earlier build stopped.', diagnostics: 'Try again.' });
        const journal = new RunJournalStore(kv);
        journal.create('failed');
        journal.appendTerminal('failed', { failure: { reason: 'The earlier build stopped.' } });
      },
      server: () => new Response(JSON.stringify(refusal.body), {
        status: refusal.status,
        headers: { 'Content-Type': 'application/json', ...refusal.headers },
      }),
    }, async ({ tree, kv, sent }) => {
      const pendingBefore = kv.getString('pending:failed');
      const journalBefore = kv.getString(JOURNAL_KEY('failed'));
      const unhandled: unknown[] = [];
      const captureRejection = (reason: unknown) => { unhandled.push(reason); };
      process.on('unhandledRejection', captureRejection);
      const clearFailure = failNativeStorageWritesWhen(({ id, key, value }) =>
        rejectTerminalWrite && id === 'whim.launcher' && key === JOURNAL_KEY('failed') && value.includes(refusal.body.hint));
      try {
        await TestRenderer.act(async () => home(tree).props.onOpenPending(new PendingBuildStore(kv).get('failed')));
        await press(failureTryAgain(tree));
        await waitFor(() => textOf(tree.root).includes(COPY.consentTitle), 'the retry consent step');
        rejectTerminalWrite = true;
        await press(button(tree, COPY.consentAgree));
        await waitFor(() => on(tree, FailurePage), 'the generic refusal-persistence failure');
        await settle();

        h.eq(unhandled, [], 'the refusal settlement does not reject its continuation');
        h.eq(sent.filter((request) => request.path === '/v1/generate').length, 1, 'the retry sends exactly one generation request');
        h.eq(tree.root.findByType(FailurePage).props.reason, GENERIC_STREAM_ERROR, 'the storage failure stays generic');
        h.eq([kv.getString('pending:failed'), kv.getString(JOURNAL_KEY('failed'))], [pendingBefore, journalBefore], 'the old pair is restored exactly');
        await press(button(tree, COPY.sheetClose));
        h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.state]), [['failed', 'failed']], 'Back returns to the old failed ghost');
      } finally {
        clearFailure();
        process.off('unhandledRejection', captureRejection);
      }
    });
  });

  await h.test('ghosts: a consent-resumed Retry whose journal write throws after recreating its record restores the old pair', async () => {
    await withLauncher({
      consent: false,
      prepare: (kv) => {
        const pending = new PendingBuildStore(kv);
        pending.create({ id: 'failed', prompt: 'A tea timer', workingTitle: 'Tea timer' });
        pending.setFailed('failed', { reason: 'The earlier build stopped.', diagnostics: '' });
        new RunJournalStore(kv).create('failed');
      },
      server: () => { throw new Error('a retry request must not be sent'); },
    }, async ({ tree, kv, sent }) => {
      const pendingBefore = kv.getString('pending:failed');
      const journalBefore = kv.getString(JOURNAL_KEY('failed'));
      const clearFailure = failNativeStorageWritesWhen(({ id, key }) => id === 'whim.launcher' && key === JOURNAL_KEY('failed'));
      try {
        const failed = new PendingBuildStore(kv).get('failed');
        await TestRenderer.act(async () => home(tree).props.onOpenPending(failed));
        await press(failureTryAgain(tree));
        await waitFor(() => textOf(tree.root).includes(COPY.consentTitle), 'the retry consent step');
        await press(button(tree, COPY.consentAgree));
        await waitFor(() => on(tree, FailurePage), 'the setup failure screen');

        h.eq(sent.filter((request) => request.path === '/v1/generate').length, 0, 'the journal failure sends no generation request');
        h.eq([kv.getString('pending:failed'), kv.getString(JOURNAL_KEY('failed'))], [pendingBefore, journalBefore], 'the pre-retry record and journal are restored exactly');
        h.eq(tree.root.findByType(FailurePage).props.reason, GENERIC_STREAM_ERROR, 'the setup failure stays generic');
      } finally {
        clearFailure();
      }
    });
  });

  await h.test('ghosts: Discard on the live failure screen deletes the attempt it just saved', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv, clock }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].end();
      await waitFor(() => on(tree, FailurePage), 'the failure screen for a stream that ended with no result');
      const id = new PendingBuildStore(kv).list()[0]?.id;
      h.ok(id != null, 'the attempt was saved as failed');
      await press(button(tree, COPY.actionDiscard));
      await runOutUndo(tree, clock);
      h.eq(ghosts(tree), [], 'Discard leaves no ghost');
      h.eq(kv.getString(JOURNAL_KEY(id!)) ?? null, null, 'and no journal');
    });
  });

  await h.test('discard: the Failure page closes with 6 s to Undo; Undo brings back the tile, its record, its journal and its Failure page', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv, clock }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push({ type: 'failure', reason: 'The app did not build.', attempts: 1, diagnostics: [{ kind: 'type', symbol: 'x', message: 'm', hint: 'Try fewer screens.' }] });
      streams[0].end();
      await waitFor(() => on(tree, FailurePage), 'the failure page');
      const id = new PendingBuildStore(kv).list()[0]!.id;
      await press(button(tree, COPY.sheetClose));
      const tilesBefore = tileLabels(tree);
      h.eq(tilesBefore.length, 1, 'the failed attempt has its tile');
      await openPending(tree, ghosts(tree)[0]);
      const shownBefore = tree.root.findByType(FailurePage).props;
      const stored = [kv.getString(`pending:${id}`), kv.getString(JOURNAL_KEY(id))];
      await press(button(tree, COPY.actionDiscard));
      h.ok(!on(tree, FailurePage) && on(tree, HomeScreen), 'Discard closes the page onto Home');
      h.eq(tileLabels(tree), [], 'the tile leaves at once');
      h.eq(toastOf(tree), { message: COPY.discardedToast, action: COPY.toastUndo }, 'a toast offers Undo');
      h.ok(clock.count(6_000) >= 1, 'for 6 s');
      h.eq([kv.getString(`pending:${id}`), kv.getString(JOURNAL_KEY(id))], stored, 'nothing is deleted while Undo is offered');
      h.ok(new PendingPurgeStore(kv).has('attempt', id), 'the discard is armed on its marker');
      await pressToastAction(tree);
      h.eq(tileLabels(tree), tilesBefore, 'Undo brings the tile back');
      h.eq([kv.getString(`pending:${id}`), kv.getString(JOURNAL_KEY(id))], stored, 'with its record and journal exactly as they were');
      h.eq(new PendingPurgeStore(kv).list(), [], 'and no discard left armed');
      await openPending(tree, ghosts(tree)[0]);
      const shown = tree.root.findByType(FailurePage).props;
      h.eq([shown.kind, shown.reason, shown.diagnostics, shown.journal], [shownBefore.kind, shownBefore.reason, shownBefore.diagnostics, shownBefore.journal], 'its Failure page reopens as it was, journal included');
      h.ok(Array.isArray(shown.journal) && shown.journal.length > 0, 'with the run’s journal readable');
    });
  });

  await h.test('discard: when the Failure page’s 6 s Undo runs out the record, its journal and the marker are gone, and the tile with them', async () => {
    await withLauncher({ prepare: savedFailure, server: () => json({}) }, async ({ tree, kv, clock }) => {
      await openPending(tree, ghosts(tree)[0]);
      await press(button(tree, COPY.actionDiscard));
      h.ok(kv.getString('pending:failed') != null && kv.getString(JOURNAL_KEY('failed')) != null, 'nothing is deleted while Undo is offered');
      await runOutUndo(tree, clock);
      await waitFor(() => kv.getString('pending:failed') == null, 'the discard to finish');
      h.eq(kv.getString(JOURNAL_KEY('failed')) ?? null, null, 'its journal goes with it');
      h.eq(new PendingPurgeStore(kv).list(), [], 'and its marker');
      h.eq([tileLabels(tree), ghosts(tree)], [[], []], 'the tile stays gone');
      h.eq(toastOf(tree), null, 'and the toast has left');
    });
  });

  await h.test('discard: closing Whim during the Failure page’s Undo window still completes the discard at the next launch, before the grid is drawn', async () => {
    await withLauncher({ prepare: savedFailure, server: () => json({}) }, async ({ tree, kv }) => {
      await openPending(tree, ghosts(tree)[0]);
      await press(button(tree, COPY.actionDiscard));
      await unmountScreen(tree);
      h.ok(kv.getString('pending:failed') != null, 'the closed process had not finished it');
      h.ok(new PendingPurgeStore(kv).has('attempt', 'failed'), 'closing the toast’s host did not end the window: the marker waits for the next launch');
      await afterRelaunch(async (next) => {
        h.eq([tileLabels(next), home(next).props.pending], [[], []], 'the attempt does not reappear');
        h.eq([kv.getString('pending:failed') ?? null, kv.getString(JOURNAL_KEY('failed')) ?? null], [null, null], 'its record and journal are gone');
        h.eq(new PendingPurgeStore(kv).list(), [], 'and its marker with them');
      });
    });
  });

  await h.test('discard: a failure this process could not save goes through the same 6 s Undo, and its end leaves nothing of it', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    let rejectTerminalWrites = false;
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv, clock }) => {
      const clearWriteFailure = failNativeStorageWritesWhen(({ id, key }) =>
        rejectTerminalWrites && id === 'whim.launcher' && (key.startsWith('pending:') || key.startsWith('journal:')));
      try {
        await startBuild(tree, 'A tea timer');
        rejectTerminalWrites = true;
        streams[0].end();
        await waitFor(() => on(tree, FailurePage), 'the volatile live failure');
        h.eq(new PendingBuildStore(kv).list()[0]?.state, 'building', 'the failure lives only in this process: the saved record still says building');
      } finally {
        clearWriteFailure();
      }
      await press(button(tree, COPY.actionDiscard));
      h.eq([tileLabels(tree), toastOf(tree)?.action], [[], COPY.toastUndo], 'it leaves at once, with Undo offered');
      await pressToastAction(tree);
      h.eq(ghosts(tree).map((ghost) => ghost.state), ['failed'], 'Undo brings back the failed tile, not the stale saved one');
      await openPending(tree, ghosts(tree)[0]);
      await press(button(tree, COPY.actionDiscard));
      await runOutUndo(tree, clock);
      h.eq([tileLabels(tree), ghosts(tree), new PendingBuildStore(kv).list(), new PendingPurgeStore(kv).list()], [[], [], [], []], 'the end of the window removes the in-memory failure and the saved record behind it, then the marker');
    });
  });

  await h.test('discard: a Discard whose marker cannot be written leaves the Failure page and the attempt as they were', async () => {
    await withLauncher({ prepare: savedFailure, server: () => json({}) }, async ({ tree, kv }) => {
      await openPending(tree, ghosts(tree)[0]);
      const clearWriteFailure = failNativeStorageWritesWhen(({ id, key }) => id === 'whim.launcher' && key.startsWith('purge:'));
      try {
        await press(button(tree, COPY.actionDiscard));
        h.ok(on(tree, FailurePage), 'the page stays');
        h.eq(toastOf(tree), null, 'no Undo is offered for a discard that was never armed');
        h.eq(new PendingPurgeStore(kv).list(), [], 'nothing is armed');
      } finally {
        clearWriteFailure();
      }
      await press(button(tree, COPY.sheetClose));
      h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.state]), [['failed', 'failed']], 'its tile is still there');
      h.ok(kv.getString('pending:failed') != null && kv.getString(JOURNAL_KEY('failed')) != null, 'with its record and journal');
    });
  });

  await h.test('discard: a native false-return pending removal keeps the discarded tile hidden on its marker, and the next launch finishes it', async () => {
    await withLauncher({ prepare: savedFailure, server: () => json({}) }, async ({ tree, kv, clock }) => {
      const clearRemovalFailure = failNativeStorageRemovalsWhen(({ id, key }) =>
        id === 'whim.launcher' && key === 'pending:failed' ? 'return-false' : undefined);
      try {
        await openPending(tree, ghosts(tree)[0]);
        await press(button(tree, COPY.actionDiscard));
        await runOutUndo(tree, clock);
        h.ok(kv.getString('pending:failed') != null, 'the false-returning native removal retained the pending key');
        h.ok(new PendingPurgeStore(kv).has('attempt', 'failed'), 'so the purge did not finish, and its marker stays armed');
        h.eq(tileLabels(tree), [], 'the discarded tile does not come back');
      } finally {
        clearRemovalFailure();
      }
      await unmountScreen(tree);
      await afterRelaunch(async (next) => {
        h.eq([tileLabels(next), home(next).props.pending], [[], []], 'the next launch finishes the discard before the grid is drawn');
        h.eq([kv.getString('pending:failed') ?? null, kv.getString(JOURNAL_KEY('failed')) ?? null], [null, null], 'record and journal gone');
        h.eq(new PendingPurgeStore(kv).list(), [], 'and the marker cleared last');
      });
    });
  });

  await h.test('discard: a thrown journal removal keeps the partial discard armed until the next launch finishes it', async () => {
    await withLauncher({ prepare: savedFailure, server: () => json({}) }, async ({ tree, kv, clock }) => {
      const clearRemovalFailure = failNativeStorageRemovalsWhen(({ id, key }) =>
        id === 'whim.launcher' && key === JOURNAL_KEY('failed') ? 'throw' : undefined);
      try {
        await openPending(tree, ghosts(tree)[0]);
        await press(button(tree, COPY.actionDiscard));
        await runOutUndo(tree, clock);
        h.eq([kv.getString('pending:failed') ?? null, kv.getString(JOURNAL_KEY('failed')) != null], [null, true], 'the record went; the thrown journal removal left the journal');
        h.ok(new PendingPurgeStore(kv).has('attempt', 'failed'), 'the marker stays armed for what remains');
        h.eq(tileLabels(tree), [], 'and the tile stays gone');
      } finally {
        clearRemovalFailure();
      }
      await unmountScreen(tree);
      await afterRelaunch(async (next) => {
        h.eq(home(next).props.pending, [], 'the next launch leaves no ghost');
        h.eq(kv.getString(JOURNAL_KEY('failed')) ?? null, null, 'the remaining journal is deleted');
        h.eq(new PendingPurgeStore(kv).list(), [], 'and the marker cleared');
      });
    });
  });

  await h.test('discard: an unwritable pending order keeps the discard armed, and the next launch leaves one clean order', async () => {
    await withLauncher({ prepare: savedFailure, server: () => json({}) }, async ({ tree, kv, clock }) => {
      const clearWriteFailure = failNativeStorageWritesWhen(({ id, key }) => id === 'whim.launcher' && key === 'pending:order');
      try {
        await openPending(tree, ghosts(tree)[0]);
        await press(button(tree, COPY.actionDiscard));
        await runOutUndo(tree, clock);
        h.eq([kv.getString('pending:failed') ?? null, kv.getString('pending:order'), kv.getString(JOURNAL_KEY('failed')) ?? null], [null, JSON.stringify(['failed']), null], 'independent siblings leave the raw order behind');
        h.ok(new PendingPurgeStore(kv).has('attempt', 'failed'), 'the dangling order keeps the marker armed');
        h.eq(tileLabels(tree), [], 'and the tile hidden');
      } finally {
        clearWriteFailure();
      }
      await unmountScreen(tree);
      await afterRelaunch(async (next) => {
        h.eq([home(next).props.pending, kv.getString('pending:order')], [[], '[]'], 'the next launch drops the dangling order entry');
        h.eq(new PendingPurgeStore(kv).list(), [], 'and clears the marker');
      });
    });
  });

  for (const from of ['page', 'home'] as const) {
    await h.test(`discard: a change discarded (${from === 'page' ? 'Failure page' : 'Home’s Discard the change'}) and made again during its Undo window: the window’s end leaves the new run, which delivers with its last-run report`, async () => {
      const streams: ReturnType<typeof sseStream>[] = [];
      await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv, clock }) => {
        const app = await discardFailedChange(tree, streams, from);
        h.ok(new PendingPurgeStore(kv).has('attempt', app.id) && toastOf(tree)?.action === COPY.toastUndo, 'the discard is armed, its Undo offered');
        await startChange(tree, app, 'Add a tip jar');
        await waitFor(() => streams.length === 2, 'the new change’s stream');
        streams[1].push({ type: 'stage', stage: 'generate', status: 'start' });
        await leaveRunning(tree);
        h.eq(tileLabels(tree).filter((label) => label.startsWith('Tip Splitter')), [tileAccessibilityLabel('Tip Splitter', stateLine('changing'))], 'Home shows the app being changed: the old discard hides nothing of the new run');
        await runOutUndo(tree, clock);
        h.eq(new PendingBuildStore(kv).get(app.id)?.prompt, 'Add a tip jar', 'the end of the old window leaves the new run’s record');
        h.ok((new RunJournalStore(kv).get(app.id) ?? []).length > 0, 'and its journal');
        h.eq(new PendingPurgeStore(kv).list(), [], 'the stale marker is cleared');
        streams[1].push(resultEvent('Tip Splitter'));
        streams[1].end();
        await waitFor(() => kv.getString(`pending:${app.id}`) == null, 'the change to deliver');
        h.ok((JSON.parse(kv.getString(LAST_RUN_KEY(app.id)) ?? '[]') as unknown[]).length > 0, 'with its last-run report');
      });
    });
  }

  await h.test('discard: a change made again during its discard’s Undo window survives Whim closing; the next launch keeps it and drops the stale marker', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv }) => {
      const app = await discardFailedChange(tree, streams, 'page');
      await startChange(tree, app, 'Add a tip jar');
      await waitFor(() => streams.length === 2, 'the new change’s stream');
      streams[1].push({ type: 'stage', stage: 'generate', status: 'start' });
      await settle();
      await unmountScreen(tree);
      await afterRelaunch(async (next) => {
        h.eq(ghosts(next).map(runOf), [[app.id, 'Add a tip jar', 'interrupted']], 'the new run comes back as interrupted, not purged');
        h.ok((new RunJournalStore(kv).get(app.id) ?? []).length > 0, 'with its journal');
        h.eq(new PendingPurgeStore(kv).list(), [], 'and the old discard’s marker is gone');
      });
    });
  });

  await h.test('ghosts: a fully unwritable terminal settlement keeps a volatile live failure actionable', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    let rejectTerminalWrites = false;
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv }) => {
      const clearWriteFailure = failNativeStorageWritesWhen(({ id, key }) =>
        rejectTerminalWrites && id === 'whim.launcher' && (key.startsWith('pending:') || key.startsWith('journal:')));
      try {
        await startBuild(tree, 'A tea timer');
        rejectTerminalWrites = true;
        streams[0].end();
        await waitFor(() => on(tree, FailurePage), 'the volatile live failure');
        const shown = tree.root.findByType(FailurePage).props;
        h.ok(shown.onDismiss != null, 'the live volatile failure still offers Discard');
        h.eq([shown.attemptStarted, shown.journal], [false, null], 'it claims neither a saved record nor a report');
        const raw = new PendingBuildStore(kv).list()[0];
        h.eq(raw?.state, 'building', 'raw bytes remain building while the live failure owns the current view');
        await press(button(tree, COPY.sheetClose));
        h.eq(ghosts(tree).map((ghost) => ghost.state), ['failed'], 'Back exposes the volatile failed ghost once');
        await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
        h.eq(tree.root.findByType(FailurePage).props.journal, null, 'reopen never borrows an unverified journal');
      } finally {
        clearWriteFailure();
      }
    });
  });

  await h.test('ghosts: a thrown active stream failure keeps its volatile live failure actionable', async () => {
    let throwStream!: () => void;
    let rejectTerminalWrites = false;
    const unhandled: unknown[] = [];
    const captureRejection = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', captureRejection);
    try {
      await withLauncher({
        server: activeThrowingServer((trigger) => { throwStream = trigger; }),
      }, async ({ tree, kv, sent }) => {
      const clearWriteFailure = failNativeStorageWritesWhen(({ id, key }) =>
        rejectTerminalWrites && id === 'whim.launcher' && (key.startsWith('pending:') || key.startsWith('journal:')));
      try {
        await startBuild(tree, 'A tea timer');
        await settle();
        h.eq(sent.filter((request) => request.path === '/v1/generate').length, 1, 'the active generation request began before its iterator threw');
        const id = new PendingBuildStore(kv).list()[0]!.id;
        rejectTerminalWrites = true;
        throwStream();
        await waitFor(() => on(tree, FailurePage), 'the thrown-stream generic failure');

        const failure = tree.root.findByType(FailurePage).props;
        h.eq(unhandled, [], 'the active stream rejection stays inside the attempt flow');
        h.eq([failure.onDismiss != null, failure.onRetry != null, failure.attemptStarted, failure.journal], [true, true, false, null], 'the retained volatile failure still offers Retry and Discard without claiming a saved record or report');
        await press(button(tree, COPY.sheetClose));
        h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.state]), [[id, 'failed']], 'Back leaves the retained failure as one ghost');
        await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
        h.eq([tree.root.findByType(FailurePage).props.attemptStarted, tree.root.findByType(FailurePage).props.journal], [false, null], 'reopening keeps the unverified report unavailable');
      } finally {
        clearWriteFailure();
      }
      });
    } finally {
      process.off('unhandledRejection', captureRejection);
    }
  });

  await h.test('ghosts: Try again on a ghost whose run is still going starts nothing; that run’s own failure later keeps its volatile actions', async () => {
    const throwStreams: (() => void)[] = [];
    let rejectTerminalWrites = false;
    await withLauncher({ server: activeThrowingStreamsServer(throwStreams) }, async ({ tree, kv }) => {
      const clearWriteFailure = failNativeStorageWritesWhen(({ id, key }) =>
        rejectTerminalWrites && id === 'whim.launcher' && (key.startsWith('pending:') || key.startsWith('journal:')));
      try {
        await startBuild(tree, 'A tea timer');
        await settle();
        const id = new PendingBuildStore(kv).list()[0]!.id;
        await leaveRunning(tree);
        const forged = await tryAgainWhileRunning(tree, kv, id);
        h.eq(throwStreams.length, 1, 'the Try again sent no second request');
        h.eq(kv.getString(`pending:${id}`), forged, 'and wrote nothing over the record');
        h.ok(on(tree, MakingPage), 'the run still going shows instead');

        rejectTerminalWrites = true;
        throwStreams[0]!();
        await waitFor(() => on(tree, FailurePage), 'the run’s own volatile failure');
        const current = tree.root.findByType(FailurePage).props;
        h.eq([current.onDismiss != null, current.onRetry != null, current.attemptStarted, current.journal], [true, true, false, null], 'its retained failure offers Retry and Discard without claiming a saved record or report');
        await press(button(tree, COPY.sheetClose));
        h.eq(ghosts(tree).map(runOf), [[id, 'A tea timer', 'failed']], 'the one ghost is that run’s failure, in its own words');
      } finally {
        clearWriteFailure();
      }
    });
  });

  await h.test('ghosts: a refused Try again leaves the run still going reattached and cancellable', async () => {
    const throwStreams: (() => void)[] = [];
    await withLauncher({ server: activeThrowingStreamsServer(throwStreams) }, async ({ tree, kv, sent }) => {
      await startBuild(tree, 'A tea timer');
      await settle();
      const id = new PendingBuildStore(kv).list()[0]!.id;
      await leaveRunning(tree);
      await tryAgainWhileRunning(tree, kv, id);
      const requests = sent.filter((request) => request.path === '/v1/generate');
      h.eq(requests.length, 1, 'the Try again sent no second request');
      h.ok(on(tree, MakingPage), 'the run still going is reattached instead');
      h.eq(tree.root.findByType(MakingPage).props.words, 'A tea timer', 'its own page, its own words');
      await leaveRunning(tree);
      await TestRenderer.act(async () => home(tree).props.onCancelPending(ghosts(tree)[0]!));
      h.eq(requests[0]?.signal?.aborted, true, 'Stop aborts that run’s request');
      h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.state]), [[id, 'interrupted']], 'Stop leaves the one record, stopped');
    });
  });

  await h.test('ghosts: a refused Try again leaves the running attempt’s progress and journal its own', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv }) => {
      await startBuild(tree, 'A tea timer');
      const id = new PendingBuildStore(kv).list()[0]!.id;
      await leaveRunning(tree);
      await tryAgainWhileRunning(tree, kv, id);
      h.eq(streams.length, 1, 'the Try again opened no second stream');
      streams[0].push({ type: 'stage', stage: 'check', status: 'start' });
      await waitFor(() => tree.root.findByType(MakingPage).props.stage === 'check', 'the run’s own stage');
      h.eq(tree.root.findByType(MakingPage).props.words, 'A tea timer', 'on the run’s own page');

      streams[0].push({ type: 'failure', reason: 'The build did not complete.', attempts: 0, diagnostics: [] });
      streams[0].end();
      await waitFor(() => on(tree, FailurePage), 'the run’s failure');
      h.eq(new RunJournalStore(kv).get(id)?.filter((entry) => entry.kind === 'stage').map((entry) => entry.stage), ['check'], 'its journal is the one it began, never reset by the Try again');
    });
  });

  await h.test('ghosts: an independent background stream keeps its own journal without replacing the selected build', async () => {
    const streams: KeepaliveStream[] = [];
    await withLauncher({ server: keepaliveStreamingServer(streams) }, async ({ tree, kv }) => {
      await startBuild(tree, 'A tea timer');
      const firstId = new PendingBuildStore(kv).list()[0]!.id;
      await leaveRunning(tree);
      await startBuild(tree, 'A dice roller');
      const secondId = new PendingBuildStore(kv).list().find((record) => record.id !== firstId)!.id;
      streams[1].push({ type: 'stage', stage: 'check', status: 'start' });
      await waitFor(() => tree.root.findByType(MakingPage).props.stage === 'check', 'the selected build stage');

      streams[0].keepalive();
      streams[0].push({ type: 'stage', stage: 'generate', status: 'start' });
      await settle();
      h.eq(tree.root.findByType(MakingPage).props.stage, 'check', 'the older frame and keepalive leave the selected progress unchanged');
      h.eq(new RunJournalStore(kv).get(firstId)?.filter((entry) => entry.kind === 'stage').map((entry) => entry.stage), ['generate'], 'the older run still records its own stage');

      await leaveRunning(tree);
      await openPending(tree, ghosts(tree).find((ghost) => ghost.id === secondId)!);
      h.eq(tree.root.findByType(MakingPage).props.stage, 'check', 'the selected ghost reattaches to its own run');
      streams[0].push({ type: 'failure', reason: 'The first build did not complete.', attempts: 0, diagnostics: [] });
      streams[0].end();
      await settle();
      h.eq([new PendingBuildStore(kv).get(firstId)?.state, new PendingBuildStore(kv).get(secondId)?.state], ['failed', 'building'], 'the independent completion persists without replacing the selected run');
      h.eq(tree.root.findByType(MakingPage).props.stage, 'check', 'the independent failure leaves the selected screen intact');
    });
  });

  await h.test('ghosts: delivery settles an independent run without taking over the selected build', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    const delayed = delayInstalls();
    try {
      await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv }) => {
        await startBuild(tree, 'A tea timer');
        const firstId = new PendingBuildStore(kv).list()[0]!.id;
        await leaveRunning(tree);
        streams[0].push(resultEvent('Tea Timer'));
        streams[0].end();
        await waitFor(delayed.started, 'the first delivery to reach the real install boundary');
        await startBuild(tree, 'A dice roller');
        const secondId = new PendingBuildStore(kv).list().find((record) => record.id !== firstId)!.id;
        streams[1].push({ type: 'stage', stage: 'check', status: 'start' });
        await waitFor(() => tree.root.findByType(MakingPage).props.stage === 'check', 'the selected second build');

        delayed.release();
        await waitFor(delayed.finished, 'the independent delivery to return from the real install boundary');
        await waitFor(() => new PendingBuildStore(kv).get(firstId) == null, 'the first delivery to settle');
        h.eq(new PendingBuildStore(kv).get(secondId)?.state, 'building', 'the selected build remains pending');
        h.ok(new RunJournalStore(kv).getLastRun(firstId) != null, 'the independent delivery promotes its own report');
        h.eq(tree.root.findByType(MakingPage).props.stage, 'check', 'the independent delivery does not take over the selected screen');
      });
    } finally {
      delayed.restore();
    }
  });

  await h.test('ghosts: a Try again while the run is delivering is refused; the delivery lands and settles its own record and report', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    const delayed = delayInstalls();
    try {
      await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv }) => {
        await startBuild(tree, 'A tea timer');
        const id = new PendingBuildStore(kv).list()[0]!.id;
        await leaveRunning(tree);
        streams[0].push(resultEvent('Tea Timer'));
        streams[0].end();
        await waitFor(delayed.started, 'the first delivery to reach the real install boundary');
        await TestRenderer.act(async () => openLink(appLinkFor('missing')));
        await waitFor(() => on(tree, AppLinkMissingScreen), 'the temporary app-link screen');
        await press(button(tree, COPY.appLinkMissingBack));
        await waitFor(() => on(tree, HomeScreen), 'Home after leaving the delayed delivery');
        const homeActions = home(tree).props;
        const started = new PendingBuildStore(kv).get(id)!;
        kv.set(`pending:${id}`, JSON.stringify({
          ...started,
          prompt: 'A dice roller',
          workingTitle: 'Dice roller',
          state: 'failed',
          failure: { reason: 'Retry this instead.' },
        }));
        await TestRenderer.act(async () => homeActions.onOpenPending(new PendingBuildStore(kv).get(id)!));
        await press(failureTryAgain(tree));
        await settle();
        h.eq(streams.length, 1, 'the Try again sent no second request');
        h.ok(on(tree, MakingPage) && tree.root.findByType(MakingPage).props.delivering != null, 'the delivering run shows instead');

        delayed.release();
        await waitFor(delayed.finished, 'the delivery to return from the real install boundary');
        await waitFor(() => on(tree, ReadyPage), 'the delivered app’s Ready page');
        h.eq(kv.getString(`pending:${id}`) ?? null, null, 'the delivery deleted its own record');
        h.ok(hasInstalled(tree, 'Tea Timer') && new RunJournalStore(kv).getLastRun(id) != null && kv.getString(JOURNAL_KEY(id)) == null, 'the app is installed with its run as its report');
      });
    } finally {
      delayed.restore();
    }
  });

  await h.test('stop: once delivery started, Stop on the Making page is gone and a tap already on its way changes nothing', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    const delayed = delayInstalls();
    try {
      await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv }) => {
        await startBuild(tree, 'A tea timer');
        const id = new PendingBuildStore(kv).list()[0]!.id;
        const stop = tree.root.findByType(MakingPage).props.onStop;
        streams[0].push(resultEvent('Tea Timer'));
        streams[0].end();
        await waitFor(delayed.started, 'the delivery to reach the real install boundary');
        await waitFor(() => tree.root.findByType(MakingPage).props.delivering === true, 'the Making page to show the delivery');
        const stopShown = tree.root.findAll((node) => node.props.accessibilityLabel === COPY.actionStop && typeof node.props.onPress === 'function');
        h.eq(stopShown.length, 0, 'putting it on the home screen offers no Stop');

        // A tap that left the finger in the frame before the page re-rendered still reaches the handler.
        await TestRenderer.act(async () => stop());
        delayed.release();
        await waitFor(delayed.finished, 'the delivery to return from the real install boundary');
        await settle();
        h.eq(new AppIndex(kv).list().map((app) => [app.id, app.name]), [[id, 'Tea Timer']], 'exactly one app is installed, under the attempt id');
        h.eq(new PendingBuildStore(kv).get(id), null, 'no pending or stopped record shares its id');
        h.eq(ghosts(tree).length, 0, 'Home shows no stopped tile beside it');
        h.ok(new RunJournalStore(kv).getLastRun(id) != null && kv.getString(JOURNAL_KEY(id)) == null, 'the journal became the app’s last-run report');
        h.ok(on(tree, ReadyPage), 'the delivery lands on Ready, as if Stop had never been tapped');
      });
    } finally {
      delayed.restore();
    }
  });

  await h.test('stop: a tile’s Stop during delivery, after closing the sheet mid-delivery, changes nothing', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    const delayed = delayInstalls();
    try {
      await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv }) => {
        await startBuild(tree, 'A tea timer');
        const id = new PendingBuildStore(kv).list()[0]!.id;
        streams[0].push(resultEvent('Tea Timer'));
        streams[0].end();
        await waitFor(delayed.started, 'the delivery to reach the real install boundary');
        await leaveRunning(tree);
        const tile = ghosts(tree).find((ghost) => ghost.id === id)!;
        h.eq(tile.state, 'building', 'the tile is still being made while the install runs');
        await TestRenderer.act(async () => home(tree).props.onCancelPending(tile));
        delayed.release();
        await waitFor(delayed.finished, 'the delivery to return from the real install boundary');
        await settle();
        h.eq(new AppIndex(kv).list().map((app) => [app.id, app.name]), [[id, 'Tea Timer']], 'exactly one app is installed, under the attempt id');
        h.eq(new PendingBuildStore(kv).get(id), null, 'no pending or stopped record shares its id');
        h.eq(ghosts(tree).length, 0, 'Home shows no stopped tile beside it');
        h.ok(new RunJournalStore(kv).getLastRun(id) != null && kv.getString(JOURNAL_KEY(id)) == null, 'the journal became the app’s last-run report');
        h.eq(toastOf(tree), { message: 'Tea Timer is ready', action: COPY.actionOpen }, 'Home says it is ready, as for any delivery with the sheet closed');
      });
    } finally {
      delayed.restore();
    }
  });

  await h.test('ghosts: a refused Try again leaves the run still waiting on its request to settle its own refusal', async () => {
    const releaseRefusals: (() => void)[] = [];
    await withLauncher({ server: delayedRefusalThenActiveStream(releaseRefusals) }, async ({ tree, kv, sent }) => {
      await startBuild(tree, 'A tea timer');
      await settle();
      const id = new PendingBuildStore(kv).list()[0]!.id;
      await leaveRunning(tree);
      await tryAgainWhileRunning(tree, kv, id);
      h.eq(sent.filter((request) => request.path === '/v1/generate').length, 1, 'the Try again sent no second request');
      await leaveRunning(tree);

      await TestRenderer.act(async () => {
        releaseRefusals[0]!();
        await settle();
      });
      h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.state, ghost.failure?.reason]), [[id, 'failed', serverBusyRefusal().body.hint]], 'the run’s own refusal settles its one record');
    });
  });

  await h.test('ghosts: an app link resolves a retained current failure instead of its raw building record', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    let rejectTerminalWrites = false;
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv }) => {
      const clearWriteFailure = failNativeStorageWritesWhen(({ id, key }) =>
        rejectTerminalWrites && id === 'whim.launcher' && (key.startsWith('pending:') || key.startsWith('journal:')));
      try {
        await startBuild(tree, 'A tea timer');
        const id = new PendingBuildStore(kv).list()[0]!.id;
        rejectTerminalWrites = true;
        streams[0].end();
        await waitFor(() => on(tree, FailurePage), 'the retained live failure');
        h.eq(new PendingBuildStore(kv).get(id)?.state, 'building', 'the raw record still says building before the link arrives');

        await TestRenderer.act(async () => openLink(appLinkFor(id)));
        const failure = tree.root.findByType(FailurePage).props;
        h.eq([failure.onDismiss != null, failure.attemptStarted, failure.journal], [true, false, null], 'the native app-link handler opens the retained failed entry with pending actions and no report');
        await press(button(tree, COPY.sheetClose));
        h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.state]), [[id, 'failed']], 'Back from the linked failure leaves exactly one retained ghost');
      } finally {
        clearWriteFailure();
      }
    });
  });

  await h.test('ghosts: a clarify failure has no attempt to discard, so the plan page keeps its words, offers Try again and leaves no ghost', async () => {
    await withLauncher({ server: () => json({ error: 'internal' }, 500) }, async ({ tree }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => button(tree, COPY.planTryAgain) != null, 'the notice with Try again');
      h.eq(tree.root.findAllByType(FailurePage).length, 0, 'no failure page: nothing was started');
      await press(button(tree, COPY.sheetClose));
      h.eq(ghosts(tree), [], 'no ghost was ever created');
    });
  });

  await h.test('ghosts: with two runs going, the older one failing leaves the newer one reattachable and cancellable', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, sent }) => {
      await startBuild(tree, 'A tea timer');
      await leaveRunning(tree);
      await startBuild(tree, 'A dice roller');
      await leaveRunning(tree);
      const newer = sent.filter((r) => r.path === '/v1/generate')[1];
      const byTitle = (title: string) => ghostTitled(tree, title);
      h.eq(ghosts(tree).map((g) => g.state), ['building', 'building'], 'both runs show as building ghosts');
      // The older run settles first: its settlement must not release the newer run's handles.
      streams[0].end();
      await settle();
      await TestRenderer.act(async () => home(tree).props.onOpenPending(byTitle('A dice roller')));
      h.ok(on(tree, MakingPage), 'the newer ghost still reattaches after the older run settled');
      await leaveRunning(tree);
      await TestRenderer.act(async () => home(tree).props.onCancelPending(byTitle('A dice roller')));
      h.eq(newer?.signal?.aborted, true, 'and stopping it still aborts its request');
      h.eq([byTitle('A dice roller').state, byTitle('A tea timer').state], ['interrupted', 'failed'], 'the stopped run is a stopped tile; the older one keeps its own failure');
    });
  });

  await h.test('ghosts: stopping the newer of two live runs leaves the older one running', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, sent, kv }) => {
      await startBuild(tree, 'A tea timer');
      await leaveRunning(tree);
      await startBuild(tree, 'A dice roller');
      await leaveRunning(tree);
      const [older, newer] = sent.filter((r) => r.path === '/v1/generate');
      const stopped = ghosts(tree).find((g) => g.prompt === 'A dice roller')!;
      await TestRenderer.act(async () => home(tree).props.onCancelPending(stopped));
      h.eq([older?.signal?.aborted, newer?.signal?.aborted], [false, true], 'only the stopped run is aborted');
      h.eq([ghostTitled(tree, 'A tea timer').state, ghostTitled(tree, 'A dice roller').state], ['building', 'interrupted'], 'the older one is still being made, the stopped one is a stopped tile');
      h.ok(kv.getString(JOURNAL_KEY(stopped.id)) != null, 'which keeps its journal for What happened');
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => hasInstalled(tree, 'Tea Timer'), 'the older run to still deliver');
    });
  });

  await h.test('ghosts: deleting a delivered app deletes its last-run report with it, at the purge — a purge that failed is finished at the next launch', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => on(tree, ReadyPage), 'the done step');
      const app = tree.root.findByType(ReadyPage).props.app as InstalledApp;
      h.ok(kv.getString(LAST_RUN_KEY(app.id)) != null, 'the delivered app has a last-run report');
      await press(button(tree, COPY.readyDone));
      const installed = home(tree).props.apps.find((a: InstalledApp) => a.id === app.id);
      // The device's user-data store (SQLite) does not exist under Node, so removal is scripted:
      // first it fails, then it succeeds.
      const originalRemove = StoreAccess.prototype.remove;
      try {
        StoreAccess.prototype.remove = async () => { throw new Error('storage busy'); };
        await TestRenderer.act(async () => { home(tree).props.onDelete(installed); });
        await TestRenderer.act(async () => { home(tree).props.onSettleDelete(installed); });
        await settle();
        h.ok(kv.getString(LAST_RUN_KEY(app.id)) != null, 'a removal that failed keeps the report of the app still installed');
        h.ok(new PendingPurgeStore(kv).has('app', app.id), 'and keeps the purge armed for the next launch');
        StoreAccess.prototype.remove = async () => {};
        await unmountScreen(tree);
        const relaunched = await renderRoot(<LauncherRoot appInfo={testAppInfo} deviceLocale={() => 'en-US'} />);
        try {
          await waitFor(() => on(relaunched, HomeScreen), 'the relaunched Home');
          h.eq(kv.getString(LAST_RUN_KEY(app.id)) ?? null, null, 'a removal that succeeded takes the report with it');
          h.eq(new PendingPurgeStore(kv).list(), [], 'and clears the marker');
        } finally {
          await unmountScreen(relaunched);
        }
      } finally {
        StoreAccess.prototype.remove = originalRemove;
      }
    });
  });
}
