/**
 * app-busy — the home grid's per-app wait affordances (`app-launcher`: "Opening an app shows an
 * immediate busy affordance", "Fork and delete show a busy state and cannot be re-triggered
 * mid-operation").
 *
 * Behavioural against the real `runAppOp`/`AppBusy` the shell runs: an operation publishes its
 * busy state before the version-store call resolves, a second invocation for the same app while
 * one is in flight never reaches the version store at all, and the state clears on success, on a
 * handled failure and on a thrown one. The last test drives the rendered launcher: a fork held
 * open leaves the tile busy and the sheet's Fork row disabled.
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
import type { AppBusyMap } from '../app-busy';
import { StyleSheet } from './native-host';
import { resetNativeStorage } from './native-storage';
import { button, press, renderScreen, textOf, unmountScreen } from './react-screen';

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
  for (const [op, failure] of [['open', 'caught'], ['delete', 'caught'], ['fork', 'thrown']] as const) {
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

  for (const op of ['fork', 'delete'] as const) {
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

    const first = runAppOp(registry, rec.publish, 'a1', 'delete', () => gate.promise);
    h.eq(
      await runAppOp(registry, rec.publish, 'a2', 'open', async () => { openedOther = true; }),
      true,
      'a different app opens while the first is deleting',
    );
    h.ok(openedOther, 'and its work ran');
    h.eq(rec.latest(), { a1: 'delete' }, 'the first app is still the only busy one');
    gate.resolve();
    await first;
  });

  // Scenario: fork and delete are triggered from sheets that are already dismissed when their
  // version-store call starts, so the tile is the ONLY control left to carry their wait.
  await h.test('busy: the tile affordance covers fork and delete, not only open', async () => {
    const registry = new AppBusy();
    const rec = recorder();
    for (const op of ['open', 'fork', 'delete'] as const) {
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

  await h.test('launcher: while a fork runs, the tile reads busy and Fork cannot be chosen again', async () => {
    const app: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };
    resetNativeStorage();
    const index = new AppIndex(createMmkvBackend('whim.launcher'));
    index.markSeeded(SEED_VERSION);
    index.put(app);
    const originalFork = StoreAccess.prototype.fork;
    const gate = deferred();
    let forks = 0;
    StoreAccess.prototype.fork = async function () { forks++; await gate.promise; return { ...app, id: 'timer-copy' }; } as typeof originalFork;
    const tree = await renderScreen(React.createElement(LauncherRoot));
    try {
      const tile = () => tree.root.find((n) => n.type === 'TouchableOpacity' && typeof n.props.onLongPress === 'function' && textOf(n).includes('Timer'));
      await TestRenderer.act(async () => tile().props.onLongPress());
      await press(button(tree, COPY.actionFork));
      await press(button(tree, COPY.forkShareData));
      h.eq(forks, 1, 'the fork started');
      const faded = tile().findAll((n) => n.type === 'View' && typeof (StyleSheet.flatten(n.props.style) as { opacity?: number }).opacity === 'number');
      h.ok(faded.some((n) => ((StyleSheet.flatten(n.props.style) as { opacity: number }).opacity) < 1), 'the tile reads as busy (faded, not a shadow, which Android does not draw)');
      await TestRenderer.act(async () => tile().props.onLongPress());
      await h.throws(() => press(button(tree, COPY.actionForkBusy)), 'Cannot press a disabled control', 'the sheet’s Fork row says a fork is running and cannot be chosen');
      await h.throws(() => press(button(tree, COPY.actionDelete)), 'Cannot press a disabled control', 'nor can Delete');
      h.eq(forks, 1, 'so no second fork started');
    } finally {
      await TestRenderer.act(async () => { gate.resolve(); });
      await unmountScreen(tree);
      StoreAccess.prototype.fork = originalFork;
    }
  });
}
