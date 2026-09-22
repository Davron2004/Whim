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
import RunDetailsSheet from '../RunDetailsSheet';
import { PendingBuildStore, type PendingBuildRecord } from '../pending-builds';
import { JOURNAL_KEY, LAST_RUN_KEY, RunJournalStore } from '../run-journal';
import type { InstalledApp } from '../app-index';
import { StoreAccess } from '../store-access';
import { hardwareBack, openLink } from './native-host';
import AppLinkMissingScreen from '../AppLinkMissingScreen';
import { appLinkFor } from '../app-link';
import { button, press } from './react-screen';
import { composeAndContinue, hasInstalled, json, resultEvent, sseStream, waitFor, withLauncher, type Tree } from './rendered-launcher';
import { startBuild, streamingServer } from './prompt-flow-ui.suite';

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
