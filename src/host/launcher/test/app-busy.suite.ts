/**
 * app-busy — the home grid's per-app wait affordances (`app-launcher`: "Opening an app shows an
 * immediate busy affordance", "Fork and delete show a busy state and cannot be re-triggered
 * mid-operation").
 *
 * Behavioural against the real `runAppOp`/`AppBusy` the shell runs: an operation publishes its
 * busy state before the version-store call resolves, a second invocation for the same app while
 * one is in flight never reaches the version store at all, and the state clears on success, on a
 * handled failure and on a thrown one. The last test drives the rendered launcher: a fork held
 * open leaves the tile busy and its menu closed.
 *
 * Every `await` here is on a deferred this file resolves itself — a bare unresolved `await` would
 * hang the whole launcher suite rather than fail one test.
 */

import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import LauncherRoot from '../LauncherRoot';
import { StoreAccess } from '../store-access';
import { AppIndex, type InstalledApp } from '../app-index';
import { SEED_VERSION } from '../seed';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import { AppBusy, isAppBusy, runAppOp } from '../app-busy';
import { runFork } from '../fork-op';
import { PurgeWindows } from '../soft-delete';
import { PendingPurgeStore, type PurgeMarker } from '../pending-purge';
import { MapKVBackend } from '../../version-store';
import type { AppBusyMap } from '../app-busy';
import { resetNativeStorage } from './native-storage';
import { press, unmountScreen } from './react-screen';
import { chooseRow, longPress, menuCard, renderRoot, sheetRows, tile } from './home-rig';

/** A promise the test resolves/rejects by hand, so an in-flight operation can be inspected. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** The shell's `setAppBusy` mirror: keeps the latest published snapshot. */
function recorder(): { latest: () => AppBusyMap; publish: (b: AppBusyMap) => void } {
  let latest: AppBusyMap = {};
  return { latest: () => latest, publish: (b) => { latest = b; } };
}

export async function runAppBusyTests(h: Harness): Promise<void> {
  console.log('\n— app-busy: per-app open/fork/delete wait affordances —');

  await h.test('open: the tile is busy from the tap until the bundle read settles', async () => {
    const registry = new AppBusy();
    const rec = recorder();
    const gate = deferred();

    const run = runAppOp(registry, rec.publish, 'a1', 'open', () => gate.promise);
    h.eq(rec.latest(), { a1: 'open' }, 'the busy state is published before the bundle read resolves');
    h.eq(registry.opFor('a1'), 'open', 'and the registry names the operation the tile is showing');

    gate.resolve();
    h.eq(await run, true, 'the operation ran');
    h.eq(rec.latest(), {}, 'a successful open clears the busy state');
  });

  // The shipped handlers catch their own failure and raise `Alert.alert`; a failure they do NOT
  // catch must not strand the tile either.
  for (const [op, failure] of [['open', 'caught'], ['fork', 'thrown']] as const) {
    await h.test(`busy: a ${failure} failure of ${op} clears the busy state`, async () => {
      const registry = new AppBusy();
      const rec = recorder();
      const gate = deferred();
      let alerted: string | null = null;
      const run = runAppOp(registry, rec.publish, 'a1', op, async () => {
        if (failure === 'thrown') {
          await gate.promise;
          return;
        }
        try {
          await gate.promise;
        } catch (e) {
          alerted = (e as Error).message;
        }
      });
      h.eq(rec.latest(), { a1: op }, `the ${op} is busy while it runs`);
      gate.reject(new Error(`${op} failed`));
      if (failure === 'thrown') {
        await h.throws(() => run, `${op} failed`, 'an uncaught failure propagates to the caller');
      } else {
        await run;
        h.eq(alerted, `${op} failed`, 'the failure reached the handler’s alert path, message intact');
      }
      h.eq(rec.latest(), {}, 'and the busy state cleared');
      h.ok(registry.opFor('a1') === undefined, 'so the app is tappable again');
    });
  }

  for (const op of ['fork', 'open'] as const) {
    await h.test(`${op}: a second ${op} for the same app while one is in flight never runs`, async () => {
      const registry = new AppBusy();
      const rec = recorder();
      const gate = deferred();
      let runs = 0;

      const first = runAppOp(registry, rec.publish, 'a1', op, async () => {
        runs++;
        await gate.promise;
      });
      h.eq(await runAppOp(registry, rec.publish, 'a1', op, async () => { runs++; }), false, 'the re-trigger is refused');
      h.eq(runs, 1, `exactly one ${op} reached the version store`);
      h.eq(rec.latest(), { a1: op }, `and the app is still busy with the first ${op}`);

      gate.resolve();
      await first;
      h.eq(rec.latest(), {}, 'once it completes the busy state clears');
      h.eq(await runAppOp(registry, rec.publish, 'a1', op, async () => { runs++; }), true, `and a later ${op} is allowed again`);
      h.eq(runs, 2, `that later ${op} ran`);
    });
  }

  await h.test('busy: one app’s operation never disables another app', async () => {
    const registry = new AppBusy();
    const rec = recorder();
    const gate = deferred();
    let openedOther = false;

    const first = runAppOp(registry, rec.publish, 'a1', 'fork', () => gate.promise);
    h.eq(
      await runAppOp(registry, rec.publish, 'a2', 'open', async () => { openedOther = true; }),
      true,
      'a different app opens while the first is being copied',
    );
    h.ok(openedOther, 'and its work ran');
    h.eq(rec.latest(), { a1: 'fork' }, 'the first app is still the only busy one');
    gate.resolve();
    await first;
  });

  // Scenario: fork is triggered from a menu that is already dismissed when its version-store call
  // starts, so the tile is the ONLY control left to carry its wait.
  await h.test('busy: the tile affordance covers fork, not only open', async () => {
    const registry = new AppBusy();
    const rec = recorder();
    for (const op of ['open', 'fork'] as const) {
      const gate = deferred();
      const running = runAppOp(registry, rec.publish, 'a1', op, () => gate.promise);
      h.eq(isAppBusy(rec.latest(), 'a1'), true, `a tile with a '${op}' in flight reads as busy`);
      gate.resolve();
      await running;
      h.eq(isAppBusy(rec.latest(), 'a1'), false, `and idle again once the '${op}' settles`);
    }
    h.eq(isAppBusy(rec.latest(), 'other'), false, 'an app with nothing in flight is never busy');
    h.eq(isAppBusy(undefined, 'a1'), false, 'no published snapshot at all reads as idle');
  });

  await h.test('launcher: while a fork runs, the tile reads busy and opens no menu, so a second copy cannot start', async () => {
    const app: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };
    resetNativeStorage();
    const index = new AppIndex(createMmkvBackend('whim.launcher'));
    index.markSeeded(SEED_VERSION);
    index.put(app);
    const originalFork = StoreAccess.prototype.fork;
    const gate = deferred();
    let forks = 0;
    StoreAccess.prototype.fork = async function () { forks++; await gate.promise; return { ...app, id: 'timer-copy' }; } as typeof originalFork;
    const tree = await renderRoot(React.createElement(LauncherRoot));
    try {
      await longPress(tree, 'Timer');
      await chooseRow(tree, COPY.actionMakeCopy);
      await press(sheetRows(tree, COPY.copyQuestionTitle).find((r) => String(r.props.accessibilityLabel).startsWith(COPY.copyQuestionFresh))!);
      h.eq(forks, 1, 'the fork started');
      h.eq(tile(tree, 'Timer').props.accessibilityState, { busy: true }, 'the tile reads busy');
      await longPress(tree, 'Timer');
      h.eq(menuCard(tree), undefined, 'and opens no menu while it runs');
      h.eq(forks, 1, 'so no second fork started');
    } finally {
      await TestRenderer.act(async () => { gate.resolve(); });
      await unmountScreen(tree);
      StoreAccess.prototype.fork = originalFork;
    }
  });

  await h.test('make a copy: the copy runs in the app’s busy slot — a taken slot starts nothing, a failure reaches the caller after being logged, and the slot is free again', async () => {
    const app: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };
    const busy = new AppBusy();
    const published: AppBusyMap[] = [];
    const run = (work: () => Promise<void>) => runAppOp(busy, (m) => { published.push(m); }, app.id, 'fork', work);
    const gate = deferred();
    let started = 0;
    const slow = runFork(run, async () => { started++; await gate.promise; return { ...app, id: 'copy' }; }, () => {});
    const refused = await runFork(run, async () => { started++; return app; }, () => {});
    h.eq([refused, started], [null, 1], 'a second copy of the same app starts nothing and says so with null');
    h.eq(isAppBusy(busy.snapshot(), app.id), true, 'the app reads busy while the first runs');
    h.ok(published.some((m) => isAppBusy(m, app.id)), 'and that was published for the tile');
    gate.resolve();
    h.eq((await slow)?.id, 'copy', 'the first resolves the new entry');
    const seen: unknown[] = [];
    const failing = runFork(run, async () => { throw new Error('no room'); }, (e) => seen.push((e as Error).message));
    await h.throws(() => failing, 'no room', 'a failed copy rejects with its own error');
    h.eq(seen, ['no room'], 'after the shell had the chance to log it');
    h.eq(isAppBusy(busy.snapshot(), app.id), false, 'and the slot is free again');
  });

  await h.test('undo windows: Undo cancels the purge; the window’s end runs it once; Undo no longer applies once it is running; closing keeps the markers', async () => {
    const purges = new PendingPurgeStore(new MapKVBackend());
    const completed: string[] = [];
    const release = deferred();
    let changes = 0;
    const windows = new PurgeWindows({
      purges,
      complete: async (m: PurgeMarker) => { completed.push(`${m.kind}:${m.id}`); await release.promise; purges.cancel(m.kind, m.id); },
      changed: () => { changes += 1; },
      failed: () => {},
    });
    const app: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };

    windows.armApp(app);
    h.ok(purges.has('app', 'timer') && changes === 1, 'armed, and Home is told it is hidden');
    h.eq(windows.undo('app', 'timer'), true, 'Undo while the window is open');
    h.ok(!purges.has('app', 'timer') && changes === 2, 'clears the marker and tells Home');
    h.eq(windows.undo('app', 'timer'), false, 'a second Undo finds nothing');
    await windows.finish('app', 'timer');
    h.eq(completed, [], 'the end of an undone window purges nothing');

    windows.armApp(app);
    windows.armAttempt('draft');
    h.eq(completed, [], 'arming alone purges nothing: no clock runs a window out');
    const running = windows.finish('app', 'timer');
    h.eq(completed, ['app:timer'], 'the window’s end runs the purge, and only that one');
    h.eq(windows.undo('app', 'timer'), false, 'too late to undo a purge that is running');
    h.ok(purges.has('app', 'timer'), 'the marker stays until the purge finishes');
    await windows.finish('app', 'timer');
    h.eq(completed, ['app:timer'], 'ending it twice runs it once');
    release.resolve();
    await running;
    h.ok(!purges.has('app', 'timer'), 'the finished purge cleared its marker');
    windows.dispose();
    await windows.finish('attempt', 'draft');
    h.eq(completed, ['app:timer'], 'closing forgets the windows that remain; their purges wait for the next launch');
    h.ok(purges.has('attempt', 'draft'), 'the discard is still armed');
  });
}
