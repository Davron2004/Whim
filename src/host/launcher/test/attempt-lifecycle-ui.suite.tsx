/** A generation attempt's life on the rendered launcher once the user steps away from it: the
 *  ghost tile it leaves on Home, reattaching to it, its failure screen's exits, what each ending
 *  leaves in storage, and two attempts running at once. */
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import HomeScreen from '../HomeScreen';
import BuildStep from '../BuildStep';
import DoneStep from '../DoneStep';
import FailureScreen from '../FailureScreen';
import UpdateRequiredScreen from '../UpdateRequiredScreen';
import RunDetailsSheet from '../RunDetailsSheet';
import LauncherRoot from '../LauncherRoot';
import { PendingBuildStore, type PendingBuildRecord } from '../pending-builds';
import { JOURNAL_KEY, LAST_RUN_KEY, RunJournalStore } from '../run-journal';
import { GENERIC_STREAM_ERROR } from '../error-reason';
import type { InstalledApp } from '../app-index';
import { StoreAccess } from '../store-access';
import { PendingPurgeStore } from '../pending-purge';
import { renderRoot } from './home-rig';
import { revokeConsent } from '../ai-consent';
import { hardwareBack, openLink } from './native-host';
import { failNativeStorageRemovalsWhen, failNativeStorageWritesWhen } from './native-storage';
import AppLinkMissingScreen from '../AppLinkMissingScreen';
import { appLinkFor } from '../app-link';
import { button, press, renderScreen, textOf, unmountScreen } from './react-screen';
import { buildIt, composeAndContinue, hasInstalled, json, planLoaded, resultEvent, settle, sseStream, waitFor, withLauncher, type SentRequest, type Tree } from './rendered-launcher';
import { startBuild, streamingServer } from './prompt-flow-ui.suite';
import { stubFutureFrame } from '../../../../server/src/stub-markers';
import { serverBusyRefusal } from '../../../../server/src/admission/refusals';
import { testAppInfo, streamResponse } from './client-fixtures';

const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;
const home = (tree: Tree) => tree.root.findByType(HomeScreen);
const ghosts = (tree: Tree): PendingBuildRecord[] => home(tree).props.pending;
const ghostTitled = (tree: Tree, title: string) => ghosts(tree).find((ghost) => ghost.prompt === title)!;

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
  await press(button(tree, COPY.buildLeaveRunning));
}

async function openPending(tree: Tree, record: PendingBuildRecord): Promise<void> {
  await TestRenderer.act(async () => home(tree).props.onOpenPending(record));
}

export async function runAttemptLifecycleUiTests(h: Harness): Promise<void> {
  await h.test('ghosts: a build still marked building from a previous launch shows as interrupted', async () => {
    await withLauncher({
      prepare: (kv) => new PendingBuildStore(kv).create({ id: 'orphan', prompt: 'A tea timer', workingTitle: 'Tea timer' }),
      server: () => json({}),
    }, async ({ tree }) => {
      h.eq(ghosts(tree).map((g) => [g.id, g.state]), [['orphan', 'interrupted']], 'the ghost reads interrupted, since no stream survived the restart');
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      h.eq(tree.root.findByType(FailureScreen).props.reason, COPY.interruptedBuildReason, 'tapping it explains the build was interrupted');
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
      const shown = textOf(tree.root.findByType(FailureScreen));
      h.ok(shown.includes(COPY.timelineTitle), 'the failure screen shows what happened');
      h.ok(shown.includes(`${COPY.timelineStageGenerate} · ${COPY.timelineDidNotFinish}`), 'the stage the build was in when the app closed didn’t finish');
      h.ok(!shown.includes(COPY.timelineStillGoing), 'and nothing on it is still going');
      h.ok(!shown.includes(COPY.failureRowSayItDifferently) && !shown.includes(COPY.failureRephrase), 'rewording the request is not offered: the interruption wasn’t the request’s doing');
      h.ok(button(tree, COPY.screenErrorRetry) != null, 'Try again is');
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
        const failure = tree.root.findByType(FailureScreen).props;
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
      await waitFor(() => tree.root.findByType(BuildStep).props.stage === 'generate', 'the stage');
      await leaveRunning(tree);
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      h.ok(on(tree, BuildStep), 'the ghost reopens the build screen');
      h.eq(tree.root.findByType(BuildStep).props.stage, 'generate', 'at the stage the run reached');
      h.eq(paths().filter((p) => p === '/v1/generate').length, 1, 'no second generation was sent');
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => on(tree, DoneStep), 'the result to land on the done step, as if the user never left');
    });
  });

  await h.test('ghosts: an app link arriving on the build screen leaves the run running, and returning finds the Details sheet closed', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, sent }) => {
      await startBuild(tree, 'A tea timer');
      await press(button(tree, COPY.buildDetails));
      h.eq(tree.root.findByType(RunDetailsSheet).props.open, true, 'Details is open');
      await TestRenderer.act(async () => openLink(appLinkFor('missing')));
      h.ok(on(tree, AppLinkMissingScreen), 'the link takes the user to its screen');
      h.eq(sent.find((r) => r.path === '/v1/generate')?.signal?.aborted, false, 'without cancelling the run');
      await press(button(tree, COPY.appLinkMissingBack));
      h.eq(ghosts(tree).map((g) => g.state), ['building'], 'which is still building');
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      h.eq(tree.root.findByType(RunDetailsSheet).props.open, false, 'reattaching opens the build screen with the sheet closed');
      streams[0].push(resultEvent('Tea Timer'));
      streams[0].end();
      await waitFor(() => on(tree, DoneStep), 'the run to deliver');
    });
  });

  await h.test('ghosts: a failed build’s Back keeps its record and journal; its ghost reopens the saved failure, and Discard deletes both', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].push({ type: 'failure', reason: 'The app did not build.', attempts: 2, diagnostics: [{ kind: 'type', symbol: 'x', message: 'm', hint: 'Try fewer screens.' }] });
      streams[0].end();
      await waitFor(() => on(tree, FailureScreen), 'the failure screen');
      const id = new PendingBuildStore(kv).list()[0]?.id ?? '';
      h.ok(id != null, 'the failed attempt is kept as a record');
      const journal = new RunJournalStore(kv).get(id) ?? [];
      h.eq(journal.at(-1)?.failure?.reason, 'The app did not build.', 'its journal ends with the failure');
      await press(button(tree, COPY.failureBack));
      h.ok(on(tree, HomeScreen), 'Back returns to Home');
      h.eq(ghosts(tree).map((g) => [g.id, g.state]), [[id, 'failed']], 'the failed ghost stays');
      h.ok(kv.getString(JOURNAL_KEY(id)) != null, 'and its journal is still readable');
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      const hydrated = tree.root.findByType(FailureScreen).props;
      h.eq([hydrated.reason, hydrated.diagnostics], ['The app did not build.', [{ hint: 'Try fewer screens.' }]], 'the ghost reopens the saved reason and hints');
      h.eq(hydrated.retryable, true, 'with Retry as its primary action');
      await TestRenderer.act(async () => { hardwareBack(); });
      h.eq(ghosts(tree).length, 1, 'hardware back is Back: nothing is deleted');
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      await press(button(tree, COPY.failureDismiss));
      h.ok(on(tree, HomeScreen), 'Discard returns to Home');
      h.eq(ghosts(tree), [], 'the ghost is gone');
      h.eq([kv.getString(`pending:${id}`) ?? null, kv.getString(JOURNAL_KEY(id)) ?? null], [null, null], 'record and journal are both deleted');
    });
  });

  await h.test('ghosts: Retry on a failed ghost re-runs its prompt as the same ghost, not a second one', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv, sent }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].end();
      await waitFor(() => on(tree, FailureScreen), 'the failure screen');
      await press(button(tree, COPY.failureBack));
      const [failed] = ghosts(tree);
      await TestRenderer.act(async () => home(tree).props.onOpenPending(failed));
      await press(button(tree, COPY.screenErrorRetry));
      await waitFor(() => on(tree, BuildStep), 'the retried build');
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
      await waitFor(() => on(tree, FailureScreen), 'the initial failed build');
      const initialRequests = sent.filter((request) => request.path === '/v1/generate').length;
      const failedId = new PendingBuildStore(kv).list()[0]!.id;
      const oldPending = kv.getString(`pending:${failedId}`);
      const oldJournal = kv.getString(JOURNAL_KEY(failedId));
      revokeConsent(kv);
      await press(button(tree, COPY.failureBack));
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      const clearWriteFailure = failNativeStorageWritesWhen(({ id, key }) =>
        id === 'whim.launcher' && key === JOURNAL_KEY(failedId));
      try {
        await press(button(tree, COPY.screenErrorRetry));
        await waitFor(() => textOf(tree.root).includes(COPY.consentTitle), 'the retry consent step');
        await press(button(tree, COPY.consentAgree));
        await waitFor(() => on(tree, FailureScreen), 'the rejected retry setup');

        h.eq(sent.filter((request) => request.path === '/v1/generate').length, initialRequests, 'the failed setup sends zero new generation requests beyond the initial run');
        h.eq([kv.getString(`pending:${failedId}`), kv.getString(JOURNAL_KEY(failedId))], [oldPending, oldJournal], 'the failed setup restores the prior pending and journal bytes before activation');
        await press(button(tree, COPY.failureBack));
        h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.state]), [[failedId, 'failed']], 'the prior current failed ghost remains the one actionable entry');
      } finally {
        clearWriteFailure();
      }

      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      await press(button(tree, COPY.screenErrorRetry));
      await waitFor(() => streams.length === initialRequests + 1 && on(tree, BuildStep), 'the recovered retry to activate');
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
      await waitFor(() => on(tree, FailureScreen), 'the setup failure screen');

      h.eq(sent.filter((request) => request.path === '/v1/generate').length, 0, 'the failed setup sends no generation request');
      h.eq(new PendingBuildStore(kv).list(), [], 'the partial record is removed instead of becoming a building ghost');
      h.eq(kv.getAllKeys().filter((key) => key.startsWith('pending:')), [], 'no hidden pending record survives outside the order list');
      h.eq(kv.getAllKeys().filter((key) => key.startsWith('journal:')), [], 'no sibling journal remains for the partial record');
      h.eq(tree.root.findByType(FailureScreen).props.reason, GENERIC_STREAM_ERROR, 'the user sees the established generic failure');
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
        rejectTerminalWrite && id === 'whim.launcher' && key === JOURNAL_KEY('failed') && value.includes(GENERIC_STREAM_ERROR));
      try {
        const failed = new PendingBuildStore(kv).get('failed');
        await TestRenderer.act(async () => home(tree).props.onOpenPending(failed));
        await press(button(tree, COPY.screenErrorRetry));
        await waitFor(() => textOf(tree.root).includes(COPY.consentTitle), 'the retry consent step');
        await press(button(tree, COPY.consentAgree));
        await waitFor(() => streams.length === 1, 'the retried stream request');
        await waitFor(() => on(tree, BuildStep), 'the retried build');

        rejectTerminalWrite = true;
        streams[0].end();
        await settle();

        h.eq(unhandled, [], 'the consent-resumed retry handles a terminal-persistence rejection');
        await waitFor(() => on(tree, FailureScreen), 'the generic terminal-persistence failure');
        h.eq(sent.filter((request) => request.path === '/v1/generate').length, 1, 'the retry sends exactly one generation request');
        h.eq(tree.root.findByType(FailureScreen).props.reason, GENERIC_STREAM_ERROR, 'the user sees the established generic failure');
        h.ok(!textOf(tree.root).includes('native storage write failed'), 'the storage error stays out of the failure screen');
        h.eq([kv.getString('pending:failed'), kv.getString(JOURNAL_KEY('failed'))], [pendingBefore, journalBefore], 'the old pending record and journal are restored exactly');
        await press(button(tree, COPY.failureBack));
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
          key === JOURNAL_KEY('failed') && value.includes(GENERIC_STREAM_ERROR)
          || key === 'pending:failed' && value === pendingBefore
        ));
      try {
        await TestRenderer.act(async () => home(tree).props.onOpenPending(new PendingBuildStore(kv).get('failed')));
        await press(button(tree, COPY.screenErrorRetry));
        await waitFor(() => textOf(tree.root).includes(COPY.consentTitle), 'the retry consent step');
        await press(button(tree, COPY.consentAgree));
        await waitFor(() => streams.length === 1 && on(tree, BuildStep), 'the retried build');

        rejectTerminalWrite = true;
        streams[0].end();
        await waitFor(() => on(tree, FailureScreen), 'the generic terminal-persistence failure');

        const failed = new PendingBuildStore(kv).get('failed');
        h.eq(unhandled, [], 'the partial recovery does not reject its retry continuation');
        h.eq(sent.filter((request) => request.path === '/v1/generate').length, 1, 'the retry sends exactly one generation request');
        h.eq([failed?.state, failed?.failure?.reason], ['failed', GENERIC_STREAM_ERROR], 'the persisted record truthfully says the ended retry failed');
        h.ok(kv.getString('pending:failed') !== pendingBefore, 'the failed restore is never claimed as an old-pair rollback');
        h.eq(kv.getString(JOURNAL_KEY('failed')), journalBefore, 'the restored old journal is never wiped for the generic record fallback');
        const failure = tree.root.findByType(FailureScreen).props;
        h.eq([failure.onDismiss != null, failure.attemptStarted, failure.journal], [true, false, null], 'the verified record is discardable without claiming the old report');
        await press(button(tree, COPY.failureBack));
        h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.state]), [['failed', 'failed']], 'Back never exposes the ended retry as building');
        await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
        const reopened = tree.root.findByType(FailureScreen).props;
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
          key === JOURNAL_KEY('failed') && value.includes(GENERIC_STREAM_ERROR)
          || key === 'pending:failed' && value === oldPending
        ));
      let fresh: Tree | undefined;
      try {
        await TestRenderer.act(async () => home(tree).props.onOpenPending(new PendingBuildStore(kv).get('failed')));
        await press(button(tree, COPY.screenErrorRetry));
        await waitFor(() => streams.length === 1 && on(tree, BuildStep), 'the retried build');
        rejectTerminalWrite = true;
        streams[0].end();
        await waitFor(() => on(tree, FailureScreen), 'the generic failure');
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
        const failure = fresh.root.findByType(FailureScreen).props;
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
        await press(button(tree, COPY.screenErrorRetry));
        await waitFor(() => textOf(tree.root).includes(COPY.consentTitle), 'the retry consent step');
        await press(button(tree, COPY.consentAgree));
        await waitFor(() => streams.length === 1 && on(tree, BuildStep), 'the retried build');

        rejectTerminalWrite = true;
        streams[0].push(update);
        await waitFor(() => on(tree, FailureScreen), 'the generic update-persistence failure');

        h.eq(sent.filter((request) => request.path === '/v1/generate').length, 1, 'the retry sends exactly one generation request');
        h.eq(tree.root.findByType(FailureScreen).props.reason, GENERIC_STREAM_ERROR, 'the update write failure stays generic');
        h.ok(!on(tree, UpdateRequiredScreen), 'the update screen does not claim a failed terminal settlement');
        h.eq([kv.getString('pending:failed'), kv.getString(JOURNAL_KEY('failed'))], [pendingBefore, journalBefore], 'the old pair is restored exactly');
        await press(button(tree, COPY.failureBack));
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
        await press(button(tree, COPY.screenErrorRetry));
        await waitFor(() => textOf(tree.root).includes(COPY.consentTitle), 'the retry consent step');
        rejectTerminalWrite = true;
        await press(button(tree, COPY.consentAgree));
        await waitFor(() => on(tree, FailureScreen), 'the generic refusal-persistence failure');
        await settle();

        h.eq(unhandled, [], 'the refusal settlement does not reject its continuation');
        h.eq(sent.filter((request) => request.path === '/v1/generate').length, 1, 'the retry sends exactly one generation request');
        h.eq(tree.root.findByType(FailureScreen).props.reason, GENERIC_STREAM_ERROR, 'the storage failure stays generic');
        h.eq([kv.getString('pending:failed'), kv.getString(JOURNAL_KEY('failed'))], [pendingBefore, journalBefore], 'the old pair is restored exactly');
        await press(button(tree, COPY.failureBack));
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
        await press(button(tree, COPY.screenErrorRetry));
        await waitFor(() => textOf(tree.root).includes(COPY.consentTitle), 'the retry consent step');
        await press(button(tree, COPY.consentAgree));
        await waitFor(() => on(tree, FailureScreen), 'the setup failure screen');

        h.eq(sent.filter((request) => request.path === '/v1/generate').length, 0, 'the journal failure sends no generation request');
        h.eq([kv.getString('pending:failed'), kv.getString(JOURNAL_KEY('failed'))], [pendingBefore, journalBefore], 'the pre-retry record and journal are restored exactly');
        h.eq(tree.root.findByType(FailureScreen).props.reason, GENERIC_STREAM_ERROR, 'the setup failure stays generic');
      } finally {
        clearFailure();
      }
    });
  });

  await h.test('ghosts: Discard on the live failure screen deletes the attempt it just saved', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv }) => {
      await startBuild(tree, 'A tea timer');
      streams[0].end();
      await waitFor(() => on(tree, FailureScreen), 'the failure screen for a stream that ended with no result');
      const id = new PendingBuildStore(kv).list()[0]?.id;
      h.ok(id != null, 'the attempt was saved as failed');
      await press(button(tree, COPY.failureDismiss));
      h.eq(ghosts(tree), [], 'Discard leaves no ghost');
      h.eq(kv.getString(JOURNAL_KEY(id!)) ?? null, null, 'and no journal');
    });
  });

  await h.test('ghosts: a native false-return pending removal keeps the failed ghost actionable through Back and reopen', async () => {
    await withLauncher({
      prepare: (kv) => {
        const pending = new PendingBuildStore(kv);
        pending.create({ id: 'failed', prompt: 'A tea timer', workingTitle: 'Tea timer' });
        pending.setJournalAvailability('failed', 'verified');
        pending.setFailed('failed', { reason: 'The earlier build stopped.' });
        new RunJournalStore(kv).create('failed');
      },
      server: () => json({}),
    }, async ({ tree, kv }) => {
      const clearRemovalFailure = failNativeStorageRemovalsWhen(({ id, key }) =>
        id === 'whim.launcher' && key === 'pending:failed' ? 'return-false' : undefined);
      try {
        const failed = home(tree).props.pending[0];
        await TestRenderer.act(async () => home(tree).props.onOpenPending(failed));
        await press(button(tree, COPY.failureDismiss));
        h.ok(on(tree, FailureScreen), 'a failed removal leaves the failure screen available for Back');
        await press(button(tree, COPY.failureBack));
        h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.state]), [['failed', 'failed']], 'Home retains exactly one actionable ghost');
        await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
        h.eq(tree.root.findByType(FailureScreen).props.reason, GENERIC_STREAM_ERROR, 'reopening reaches the retained generic failure');
        h.ok(kv.getString('pending:failed') != null, 'the false-returning native removal retained the pending key');
      } finally {
        clearRemovalFailure();
      }
    });
  });

  await h.test('ghosts: a thrown journal removal retains a partial Discard until a later verified retry clears it', async () => {
    await withLauncher({
      prepare: (kv) => {
        const pending = new PendingBuildStore(kv);
        pending.create({ id: 'failed', prompt: 'A tea timer', workingTitle: 'Tea timer' });
        pending.setJournalAvailability('failed', 'verified');
        pending.setFailed('failed', { reason: 'The earlier build stopped.' });
        new RunJournalStore(kv).create('failed');
      },
      server: () => json({}),
    }, async ({ tree, kv }) => {
      const clearRemovalFailure = failNativeStorageRemovalsWhen(({ id, key }) =>
        id === 'whim.launcher' && key === JOURNAL_KEY('failed') ? 'throw' : undefined);
      try {
        await TestRenderer.act(async () => home(tree).props.onOpenPending(home(tree).props.pending[0]));
        await press(button(tree, COPY.failureDismiss));
        await press(button(tree, COPY.failureBack));
        h.eq(ghosts(tree).map((ghost) => ghost.id), ['failed'], 'a partial sibling removal retains one ghost');
        h.eq([kv.getString('pending:failed') ?? null, kv.getString(JOURNAL_KEY('failed')) ?? null], [null, '[]'], 'the successful sibling stays removed while the thrown journal remains');
      } finally {
        clearRemovalFailure();
      }
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      await press(button(tree, COPY.failureDismiss));
      h.eq(ghosts(tree), [], 'a recovered Discard clears the retained entry after every readback succeeds');
      h.eq(kv.getString(JOURNAL_KEY('failed')) ?? null, null, 'the remaining journal is deleted on the recovered attempt');
    });
  });

  await h.test('ghosts: Retry after a partial Discard keeps one same-id building ghost', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({
      prepare: (kv) => {
        const pending = new PendingBuildStore(kv);
        pending.create({ id: 'failed', prompt: 'A tea timer', workingTitle: 'Tea timer' });
        pending.setJournalAvailability('failed', 'verified');
        pending.setFailed('failed', { reason: 'The earlier build stopped.' });
        new RunJournalStore(kv).create('failed');
      },
      server: streamingServer(streams),
    }, async ({ tree, kv, sent }) => {
      const clearWriteFailure = failNativeStorageWritesWhen(({ id, key }) =>
        id === 'whim.launcher' && key === 'pending:order');
      try {
        await TestRenderer.act(async () => home(tree).props.onOpenPending(home(tree).props.pending[0]));
        await press(button(tree, COPY.failureDismiss));
        await press(button(tree, COPY.failureBack));
        h.eq(ghosts(tree).map((ghost) => ghost.id), ['failed'], 'the dangling raw order does not erase the retained ghost');
        h.eq([kv.getString('pending:failed') ?? null, kv.getString('pending:order'), kv.getString(JOURNAL_KEY('failed')) ?? null], [null, JSON.stringify(['failed']), null], 'independent siblings leave the raw order for recovery');
      } finally {
        clearWriteFailure();
      }
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      await press(button(tree, COPY.screenErrorRetry));
      await waitFor(() => streams.length === 1 && on(tree, BuildStep), 'the same-id Retry to activate before a recovered Discard');
      h.eq(sent.filter((request) => request.path === '/v1/generate').length, 1, 'Retry sends exactly one new generation request');
      h.eq(new PendingBuildStore(kv).listCurrent().map((view) => [view.record.id, view.record.state]), [['failed', 'building']], 'the raw dangling order and retained view produce one current building ghost');
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
        await waitFor(() => on(tree, FailureScreen), 'the volatile live failure');
        const shown = tree.root.findByType(FailureScreen).props;
        h.ok(shown.onDismiss != null, 'the live volatile failure still offers Discard');
        h.eq([shown.attemptStarted, shown.journal], [false, null], 'it claims neither a saved record nor a report');
        const raw = new PendingBuildStore(kv).list()[0];
        h.eq(raw?.state, 'building', 'raw bytes remain building while the live failure owns the current view');
        await press(button(tree, COPY.failureBack));
        h.eq(ghosts(tree).map((ghost) => ghost.state), ['failed'], 'Back exposes the volatile failed ghost once');
        await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
        h.eq(tree.root.findByType(FailureScreen).props.journal, null, 'reopen never borrows an unverified journal');
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
        await waitFor(() => on(tree, FailureScreen), 'the thrown-stream generic failure');

        const failure = tree.root.findByType(FailureScreen).props;
        h.eq(unhandled, [], 'the active stream rejection stays inside the attempt flow');
        h.eq([failure.onDismiss != null, failure.retryable, failure.attemptStarted, failure.journal], [true, true, false, null], 'the retained volatile failure still offers Retry and Discard without claiming a saved record or report');
        await press(button(tree, COPY.failureBack));
        h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.state]), [[id, 'failed']], 'Back leaves the retained failure as one ghost');
        await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
        h.eq([tree.root.findByType(FailureScreen).props.attemptStarted, tree.root.findByType(FailureScreen).props.journal], [false, null], 'reopening keeps the unverified report unavailable');
      } finally {
        clearWriteFailure();
      }
      });
    } finally {
      process.off('unhandledRejection', captureRejection);
    }
  });

  await h.test('ghosts: a stale same-id stream failure cannot borrow the newer volatile failure actions', async () => {
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
        const started = new PendingBuildStore(kv).get(id)!;
        kv.set(`pending:${id}`, JSON.stringify({
          ...started,
          prompt: 'A dice roller',
          workingTitle: 'Dice roller',
          state: 'failed',
          failure: { reason: 'Retry this instead.' },
        }));
        await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
        await press(button(tree, COPY.screenErrorRetry));
        await settle();
        h.eq(throwStreams.length, 2, 'the newer same-id retry has its own active stream');

        rejectTerminalWrites = true;
        throwStreams[1]!();
        await waitFor(() => on(tree, FailureScreen), 'the newer volatile failure');
        const newer = tree.root.findByType(FailureScreen).props;
        h.eq(newer.onDismiss != null, true, 'the completion that retained the current view remains discardable');

        throwStreams[0]!();
        await settle();
        const current = tree.root.findByType(FailureScreen).props;
        h.eq([current.onDismiss != null, current.retryable, current.attemptStarted, current.journal], [true, true, false, null], 'the stale completion leaves the newer retained failure actions unchanged');
        h.eq(current.onRephrase, newer.onRephrase, 'the stale completion does not replace the newer failure screen');
        await press(button(tree, COPY.failureBack));
        h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.prompt, ghost.state]), [[id, 'A dice roller', 'failed']], 'the stale stream error leaves the newer volatile ghost unchanged');
      } finally {
        clearWriteFailure();
      }
    });
  });

  await h.test('ghosts: a stale same-id stream failure keeps the active retry reattachable and cancellable', async () => {
    const throwStreams: (() => void)[] = [];
    await withLauncher({ server: activeThrowingStreamsServer(throwStreams) }, async ({ tree, kv, sent }) => {
      await startBuild(tree, 'A tea timer');
      await settle();
      const id = new PendingBuildStore(kv).list()[0]!.id;
      await leaveRunning(tree);
      const started = new PendingBuildStore(kv).get(id)!;
      kv.set(`pending:${id}`, JSON.stringify({
        ...started,
        prompt: 'A dice roller',
        workingTitle: 'Dice roller',
        state: 'failed',
        failure: { reason: 'Retry this instead.' },
      }));
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      await press(button(tree, COPY.screenErrorRetry));
      await settle();
      const requests = sent.filter((request) => request.path === '/v1/generate');
      h.eq(requests.length, 2, 'the same-id retry is active before the stale stream fails');
      await leaveRunning(tree);

      throwStreams[0]!();
      await settle();
      const retried = ghosts(tree)[0]!;
      h.eq([retried.id, retried.prompt, retried.state], [id, 'A dice roller', 'building'], 'the newer retry remains the building ghost');
      await TestRenderer.act(async () => home(tree).props.onOpenPending(retried));
      h.ok(on(tree, BuildStep), 'the stale completion leaves the active retry reattachable');
      await leaveRunning(tree);
      await TestRenderer.act(async () => home(tree).props.onCancelPending(ghosts(tree)[0]!));
      h.eq(requests[1]?.signal?.aborted, true, 'cancelling the reattached retry aborts its live request');
      h.eq(ghosts(tree), [], 'Cancel removes the record only after aborting the retry');
    });
  });

  await h.test('ghosts: a stale same-id stage cannot replace or journal the active retry', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, kv }) => {
      await startBuild(tree, 'A tea timer');
      const id = new PendingBuildStore(kv).list()[0]!.id;
      await leaveRunning(tree);
      const started = new PendingBuildStore(kv).get(id)!;
      kv.set(`pending:${id}`, JSON.stringify({
        ...started,
        prompt: 'A dice roller',
        workingTitle: 'Dice roller',
        state: 'failed',
        failure: { reason: 'Retry this instead.' },
      }));
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      await press(button(tree, COPY.screenErrorRetry));
      streams[1].push({ type: 'stage', stage: 'check', status: 'start' });
      await waitFor(() => tree.root.findByType(BuildStep).props.stage === 'check', 'the active retry stage');

      streams[0].push({ type: 'stage', stage: 'generate', status: 'start' });
      await settle();
      h.eq(tree.root.findByType(BuildStep).props.stage, 'check', 'the stale stage does not replace the active retry progress');

      streams[1].push({ type: 'failure', reason: 'The retry did not build.', attempts: 0, diagnostics: [] });
      streams[1].end();
      await waitFor(() => on(tree, FailureScreen), 'the active retry failure');
      h.eq(new RunJournalStore(kv).get(id)?.filter((entry) => entry.kind === 'stage').map((entry) => entry.stage), ['check'], 'the verified retry journal excludes the stale stage');
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
      await waitFor(() => tree.root.findByType(BuildStep).props.stage === 'check', 'the selected build stage');

      streams[0].keepalive();
      streams[0].push({ type: 'stage', stage: 'generate', status: 'start' });
      await settle();
      h.eq(tree.root.findByType(BuildStep).props.stage, 'check', 'the older frame and keepalive leave the selected progress unchanged');
      h.eq(new RunJournalStore(kv).get(firstId)?.filter((entry) => entry.kind === 'stage').map((entry) => entry.stage), ['generate'], 'the older run still records its own stage');

      await leaveRunning(tree);
      await openPending(tree, ghosts(tree).find((ghost) => ghost.id === secondId)!);
      h.eq(tree.root.findByType(BuildStep).props.stage, 'check', 'the selected ghost reattaches to its own run');
      streams[0].push({ type: 'failure', reason: 'The first build did not complete.', attempts: 0, diagnostics: [] });
      streams[0].end();
      await settle();
      h.eq([new PendingBuildStore(kv).get(firstId)?.state, new PendingBuildStore(kv).get(secondId)?.state], ['failed', 'building'], 'the independent completion persists without replacing the selected run');
      h.eq(tree.root.findByType(BuildStep).props.stage, 'check', 'the independent failure leaves the selected screen intact');
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
        await waitFor(() => tree.root.findByType(BuildStep).props.stage === 'check', 'the selected second build');

        delayed.release();
        await waitFor(delayed.finished, 'the independent delivery to return from the real install boundary');
        await waitFor(() => new PendingBuildStore(kv).get(firstId) == null, 'the first delivery to settle');
        h.eq(new PendingBuildStore(kv).get(secondId)?.state, 'building', 'the selected build remains pending');
        h.ok(new RunJournalStore(kv).getLastRun(firstId) != null, 'the independent delivery promotes its own report');
        h.eq(tree.root.findByType(BuildStep).props.stage, 'check', 'the independent delivery does not take over the selected screen');
      });
    } finally {
      delayed.restore();
    }
  });

  await h.test('ghosts: a superseded delivery cannot delete the newer same-id pending record', async () => {
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
        await press(button(tree, COPY.screenErrorRetry));
        await waitFor(() => streams.length === 2 && on(tree, BuildStep), 'the newer same-id retry to activate before the older delivery resumes');

        delayed.release();
        await waitFor(delayed.finished, 'the superseded delivery to return from the real install boundary');
        await settle();
        h.eq(new PendingBuildStore(kv).get(id)?.state, 'building', 'the superseded delivery does not delete the newer pending record');
        h.eq(kv.getString(JOURNAL_KEY(id)), '[]', 'the superseded delivery leaves the newer journal untouched');
        await TestRenderer.act(async () => homeActions.onCancelPending(new PendingBuildStore(kv).get(id)!));
      });
    } finally {
      delayed.restore();
    }
  });

  await h.test('ghosts: a stale same-id refusal keeps the active retry reattachable', async () => {
    const releaseRefusals: (() => void)[] = [];
    await withLauncher({ server: delayedRefusalThenActiveStream(releaseRefusals) }, async ({ tree, kv }) => {
      await startBuild(tree, 'A tea timer');
      await settle();
      const id = new PendingBuildStore(kv).list()[0]!.id;
      await leaveRunning(tree);
      const started = new PendingBuildStore(kv).get(id)!;
      kv.set(`pending:${id}`, JSON.stringify({
        ...started,
        prompt: 'A dice roller',
        workingTitle: 'Dice roller',
        state: 'failed',
        failure: { reason: 'Retry this instead.' },
      }));
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]));
      await press(button(tree, COPY.screenErrorRetry));
      await settle();
      await leaveRunning(tree);

      await TestRenderer.act(async () => {
        releaseRefusals[0]!();
        await settle();
      });
      await TestRenderer.act(async () => home(tree).props.onOpenPending(ghosts(tree)[0]!));
      h.ok(on(tree, BuildStep), 'the stale refusal leaves the active retry reattachable');
      await leaveRunning(tree);
      await TestRenderer.act(async () => home(tree).props.onCancelPending(ghosts(tree)[0]!));
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
        await waitFor(() => on(tree, FailureScreen), 'the retained live failure');
        h.eq(new PendingBuildStore(kv).get(id)?.state, 'building', 'the raw record still says building before the link arrives');

        await TestRenderer.act(async () => openLink(appLinkFor(id)));
        const failure = tree.root.findByType(FailureScreen).props;
        h.eq([failure.onDismiss != null, failure.attemptStarted, failure.journal], [true, false, null], 'the native app-link handler opens the retained failed entry with pending actions and no report');
        await press(button(tree, COPY.failureBack));
        h.eq(ghosts(tree).map((ghost) => [ghost.id, ghost.state]), [[id, 'failed']], 'Back from the linked failure leaves exactly one retained ghost');
      } finally {
        clearWriteFailure();
      }
    });
  });

  await h.test('ghosts: a clarify failure has no attempt to discard, so its failure screen offers no Discard', async () => {
    await withLauncher({ server: () => json({ error: 'internal' }, 500) }, async ({ tree }) => {
      await composeAndContinue(tree, 'A tea timer');
      await waitFor(() => on(tree, FailureScreen), 'the failure screen');
      h.ok(tree.root.findByType(FailureScreen).props.onDismiss === undefined, 'no discard action is wired');
      await h.throws(() => button(tree, COPY.failureDismiss), 'Expected one visible button', 'and no Discard button renders');
      await press(button(tree, COPY.failureBack));
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
      h.ok(on(tree, BuildStep), 'the newer ghost still reattaches after the older run settled');
      await leaveRunning(tree);
      await TestRenderer.act(async () => home(tree).props.onCancelPending(byTitle('A dice roller')));
      h.eq(newer?.signal?.aborted, true, 'and cancelling it still aborts its request');
      h.eq(ghosts(tree).map((g) => g.prompt), ['A tea timer'], 'only the cancelled ghost is removed');
    });
  });

  await h.test('ghosts: cancelling the newer of two live runs leaves the older one running', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ server: streamingServer(streams) }, async ({ tree, sent, kv }) => {
      await startBuild(tree, 'A tea timer');
      await leaveRunning(tree);
      await startBuild(tree, 'A dice roller');
      await leaveRunning(tree);
      const [older, newer] = sent.filter((r) => r.path === '/v1/generate');
      const cancelled = ghosts(tree).find((g) => g.prompt === 'A dice roller')!;
      await TestRenderer.act(async () => home(tree).props.onCancelPending(cancelled));
      h.eq([older?.signal?.aborted, newer?.signal?.aborted], [false, true], 'only the cancelled run is aborted');
      h.eq(ghosts(tree).map((g) => g.prompt), ['A tea timer'], 'the older ghost stays');
      h.eq(kv.getString(JOURNAL_KEY(cancelled.id)) ?? null, null, 'the cancelled run’s journal is deleted with its record');
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
      await waitFor(() => on(tree, DoneStep), 'the done step');
      const app = tree.root.findByType(DoneStep).props.app as InstalledApp;
      h.ok(kv.getString(LAST_RUN_KEY(app.id)) != null, 'the delivered app has a last-run report');
      await press(button(tree, COPY.doneBackToApps));
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
