/**
 * app-busy — the home grid's per-app wait affordances (`app-launcher`: "Opening an app shows an
 * immediate busy affordance", "Fork and delete show a busy state and cannot be re-triggered
 * mid-operation").
 *
 * Behavioural against the real `runAppOp`/`AppBusy` the shell runs: an operation publishes its
 * busy state before the version-store call resolves, a second invocation for the same app while
 * one is in flight never reaches the version store at all, and the state clears on success, on a
 * handled failure and on a thrown one. Static source assertions cover only the call sites in
 * `LauncherRoot.tsx` / `HomeScreen.tsx` / `app-tile.tsx`, which import `react-native` and cannot
 * be imported under Node.
 *
 * Every `await` here is on a deferred this file resolves itself — a bare unresolved `await` would
 * hang the whole launcher suite rather than fail one test.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { AppBusy, isAppBusy, runAppOp } from '../app-busy';
import type { AppBusyMap } from '../app-busy';
import { COPY } from '../copy';

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src/host/launcher', file), 'utf8');
}

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

  await h.test('open: a failed open clears the busy state (the alert path still runs)', async () => {
    const registry = new AppBusy();
    const rec = recorder();
    const gate = deferred();
    let alerted: string | null = null;

    // The shipped handler catches its own failure and raises `Alert.alert` — the busy state must
    // clear all the same, so the tile is launchable again after a failure.
    const run = runAppOp(registry, rec.publish, 'a1', 'open', async () => {
      try {
        await gate.promise;
      } catch (e) {
        alerted = (e as Error).message;
      }
    });
    gate.reject(new Error('no active bundle'));
    await run;

    h.eq(alerted, 'no active bundle', 'the failure reached the handler’s alert path, message intact');
    h.eq(rec.latest(), {}, 'and the busy state cleared');
    h.eq(registry.opFor('a1'), undefined, 'so the app is tappable again');
  });

  await h.test('fork: a second fork for the same app while one is in flight never runs', async () => {
    const registry = new AppBusy();
    const rec = recorder();
    const gate = deferred();
    let forks = 0;

    const first = runAppOp(registry, rec.publish, 'a1', 'fork', async () => {
      forks++;
      await gate.promise;
    });
    const second = await runAppOp(registry, rec.publish, 'a1', 'fork', async () => {
      forks++;
    });

    h.eq(second, false, 'the re-trigger is refused');
    h.eq(forks, 1, 'exactly one fork reached the version store');
    h.eq(rec.latest(), { a1: 'fork' }, 'and the row is still busy with the first fork');

    gate.resolve();
    await first;
    h.eq(rec.latest(), {}, 'once it completes the busy state clears');
    h.eq(
      await runAppOp(registry, rec.publish, 'a1', 'fork', async () => { forks++; }),
      true,
      'and a later fork is allowed again',
    );
    h.eq(forks, 2, 'that later fork ran');
  });

  await h.test('delete: a second delete for the same app while one is in flight never runs', async () => {
    const registry = new AppBusy();
    const rec = recorder();
    const gate = deferred();
    let deletes = 0;

    const first = runAppOp(registry, rec.publish, 'a1', 'delete', async () => {
      deletes++;
      await gate.promise;
    });
    h.eq(
      await runAppOp(registry, rec.publish, 'a1', 'delete', async () => { deletes++; }),
      false,
      'the re-trigger is refused',
    );
    h.eq(deletes, 1, 'exactly one delete reached the version store');
    gate.resolve();
    await first;
    h.eq(rec.latest(), {}, 'and the busy state clears when it settles');
  });

  await h.test('delete: a failed delete clears the busy state', async () => {
    const registry = new AppBusy();
    const rec = recorder();
    const gate = deferred();
    let alerted: string | null = null;

    const run = runAppOp(registry, rec.publish, 'a1', 'delete', async () => {
      try {
        await gate.promise;
      } catch (e) {
        alerted = (e as Error).message;
      }
    });
    gate.reject(new Error('remove failed'));
    await run;
    h.eq(alerted, 'remove failed', 'the failure reached the handler’s alert path, message intact');
    h.eq(rec.latest(), {}, 'and the app is no longer stuck busy');
  });

  await h.test('busy: an operation that throws still releases the slot', async () => {
    // Belt-and-braces on the shipped `finally`: even a failure the handler did NOT catch must not
    // strand a tile in a permanent busy state.
    const registry = new AppBusy();
    const rec = recorder();
    await h.throws(
      () => runAppOp(registry, rec.publish, 'a1', 'fork', async () => { throw new Error('boom'); }),
      'boom',
      'an uncaught failure propagates to the caller',
    );
    h.eq(rec.latest(), {}, 'and the busy state is still cleared');
  });

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

  // ── LauncherRoot.tsx / HomeScreen.tsx / app-tile.tsx: static wiring assertions ───────────────
  // The guard and the affordance are exercised for real above; what these pin is that the shell's
  // three handlers and the two surfaces are actually wired to them. Their failure mode is a
  // missing wire, which leaves every behavioural assertion above green.

  const rootSrc = read('LauncherRoot.tsx');
  const homeSrc = read('HomeScreen.tsx');
  const tileSrc = read('app-tile.tsx');

  await h.test('wiring: open, fork and delete all run under the per-app registry', () => {
    for (const [handler, op] of [['onOpen', 'open'], ['onFork', 'fork'], ['onDelete', 'delete']] as const) {
      const re = new RegExp(`const ${handler} = [\\s\\S]{0,200}?runAppOp\\(appOps, setAppBusy, app\\.id, '${op}'`);
      h.ok(re.test(rootSrc), `${handler} runs under runAppOp as '${op}'`);
    }
    h.ok(/const appOps = useRef\(new AppBusy\(\)\)\.current/.test(rootSrc), 'the registry is a ref, so two taps in one frame cannot both claim the slot');
    h.ok(/appBusy=\{appBusy\}/.test(rootSrc), 'and the published snapshot reaches the home screen');
  });

  await h.test('wiring: the grid tile shows the open affordance and the sheet rows disable', () => {
    h.ok(/busy=\{isAppBusy\(appBusy, app\.id\)\}/.test(homeSrc), 'a tile whose app has an operation in flight renders the busy tile treatment');
    h.ok(/const selectedBusy = selected \? appBusy\?\.\[selected\.id\] : undefined/.test(homeSrc), 'the sheet reads the long-pressed app’s in-flight operation');
    const row = (busyKey: string) => homeSrc.split('\n').find(l => l.includes('SheetRow') && l.includes(busyKey)) ?? '';
    h.ok(row('COPY.actionForkBusy').includes('disabled={selectedBusy != null}'), 'the Fork row is disabled while an operation runs');
    h.ok(row('COPY.actionDeleteBusy').includes('disabled={selectedBusy != null}'), 'so is the Delete row');
    h.ok(/disabled \? styles\.sheetRowDisabled : null/.test(homeSrc) && /disabled=\{disabled\}/.test(homeSrc), 'a disabled row neither fires nor reads as tappable');
  });

  await h.test('wiring: the busy tile treatment is opacity-based, not an iOS-only shadow', () => {
    h.ok(/busy \? styles\.tileBusy : null/.test(tileSrc), 'the tile applies its own busy style');
    const busyStyle = tileSrc.slice(tileSrc.indexOf('tileBusy: {'), tileSrc.indexOf('tileBusy: {') + 60);
    h.ok(busyStyle.includes('opacity'), 'and it is an opacity treatment — `shadow*` props render as nothing on Android');
    h.ok(!/tileBusy: \{[^}]*shadow/.test(tileSrc), 'no shadow props in the busy treatment');
  });

  await h.test('copy: the busy rows say what is happening, in product verbs', () => {
    h.eq(COPY.actionForkBusy, 'Forking…', 'the Fork row names the fork it is running');
    h.eq(COPY.actionDeleteBusy, 'Deleting…', 'and the Delete row the delete');
  });
}
