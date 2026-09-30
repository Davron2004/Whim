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
import { hardwareBack, openLink } from './native-host';
import { failNativeStorageRemovalsWhen, failNativeStorageWritesWhen } from './native-storage';
import AppLinkMissingScreen from '../AppLinkMissingScreen';
import { appLinkFor } from '../app-link';
import { button, press, renderScreen, textOf, unmountScreen } from './react-screen';
import { buildIt, composeAndContinue, hasInstalled, json, planLoaded, resultEvent, settle, sseStream, waitFor, withLauncher, type Tree } from './rendered-launcher';
import { startBuild, streamingServer } from './prompt-flow-ui.suite';
import { stubFutureFrame } from '../../../../server/src/stub-markers';
import { serverBusyRefusal } from '../../../../server/src/admission/refusals';
import { testAppInfo } from './client-fixtures';

const on = (tree: Tree, type: Parameters<Tree['root']['findAllByType']>[0]) => tree.root.findAllByType(type).length === 1;
const home = (tree: Tree) => tree.root.findByType(HomeScreen);
const ghosts = (tree: Tree): PendingBuildRecord[] => home(tree).props.pending;
const ghostTitled = (tree: Tree, title: string) => ghosts(tree).find((ghost) => ghost.prompt === title)!;

/** Leave the build screen the way the button does: the run keeps going. */
async function leaveRunning(tree: Tree): Promise<void> {
  await press(button(tree, COPY.buildLeaveRunning));
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
            internalBuild
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

  await h.test('ghosts: a pending-order write failure after key removal retains the ghost until a recovered Discard removes the dangling order', async () => {
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
      await press(button(tree, COPY.failureDismiss));
      h.eq(ghosts(tree), [], 'the recovered Discard removes the retained ghost');
      h.eq(kv.getString('pending:order'), JSON.stringify([]), 'the dangling order entry is removed only after its write verifies');
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
      await waitFor(() => on(tree, FailureScreen), 'the older run to fail');
      await press(button(tree, COPY.failureBack));
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

  await h.test('ghosts: deleting a delivered app deletes its last-run report with it', async () => {
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
        await TestRenderer.act(async () => { await home(tree).props.onDelete(installed); });
        h.ok(kv.getString(LAST_RUN_KEY(app.id)) != null, 'a removal that failed keeps the report of the app still installed');
        StoreAccess.prototype.remove = async () => {};
        await TestRenderer.act(async () => { await home(tree).props.onDelete(installed); });
        h.eq(kv.getString(LAST_RUN_KEY(app.id)) ?? null, null, 'a removal that succeeded takes the report with it');
      } finally {
        StoreAccess.prototype.remove = originalRemove;
      }
    });
  });
}
