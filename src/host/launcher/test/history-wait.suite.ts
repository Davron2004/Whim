/**
 * history-wait — the history screen's three wait states (`version-history`: "History's first load
 * shows a loading state, never fake-empty", "The confirm sheet's Restore and Copy actions disable
 * while in flight", "The restore-diff reassurance line shows a pending state while it loads").
 *
 * Behavioural against the real `runHistoryLoad` / `runConfirmOp` the screen runs: the loading flag
 * is true until the first read resolves and false afterwards (empty result included), a second
 * confirm tap while one is in flight never reaches `rollback`/`fork` at all, and the in-flight flag
 * clears when the operation fails. Static source assertions cover only the wiring inside
 * `HistoryScreen.tsx`, which imports `react-native` and cannot be imported under Node.
 *
 * Every `await` here is on a deferred this file resolves itself — a bare unresolved `await` would
 * hang the whole launcher suite rather than fail one test.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import {
  ConfirmFlight,
  HISTORY_LOADING,
  RESTORE_DIFF_NONE,
  restoreDiffLine,
  runConfirmOp,
  runHistoryLoad,
  type HistoryLoadState,
  type PublishHistoryLoad,
} from '../history-wait';
import { COPY } from '../copy';

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src/host/launcher', file), 'utf8');
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Snapshot rows only ever reach this module as opaque payload, so ids are enough. */
function snaps(ids: string[]): HistoryLoadState['snapshots'] {
  return ids.map(id => ({ id })) as unknown as HistoryLoadState['snapshots'];
}

/** The screen's `setState` mirror: it applies value-and-updater publishes over the previous state
 *  exactly as React's setter does, so `latest` is what `HistoryScreen` would render. */
function publisher(initial: HistoryLoadState = HISTORY_LOADING): { latest: () => HistoryLoadState; publish: PublishHistoryLoad } {
  let state = initial;
  return {
    latest: () => state,
    publish: (next) => { state = typeof next === 'function' ? next(state) : next; },
  };
}

/** Guard against the bare-await hang: a promise that must settle within `ms`. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} never settled within ${ms}ms`)), ms).unref?.()),
  ]);
}

export async function runHistoryWaitTests(h: Harness): Promise<void> {
  console.log('\n— history-wait: first-load skeleton, confirm double-submit guard, diff pending —');

  // ── first load ─────────────────────────────────────────────────────────────────────────────

  await h.test('load: the screen starts loading, so an empty list is never mistaken for empty history', () => {
    h.eq(HISTORY_LOADING, { loading: true, snapshots: [], activeId: null }, 'the initial state is loading with nothing to show');
  });

  await h.test('load: loading stays true until the first read resolves, then the rows land together', async () => {
    const gate = deferred<{ snapshots: HistoryLoadState['snapshots']; activeId: string | null }>();
    const pub = publisher();

    const run = runHistoryLoad(() => gate.promise, pub.publish);
    h.eq(pub.latest().loading, true, 'nothing is published while the snapshot list and active id are still being read');
    h.eq(pub.latest().snapshots.length, 0, 'and there are no rows yet');

    gate.resolve({ snapshots: snaps(['v3', 'v2', 'v1']), activeId: 'v3' });
    await within(run, 1000, 'the first load');
    h.eq(pub.latest().loading, false, 'the loading state clears when the read resolves');
    h.eq(pub.latest().snapshots.length, 3, 'with the rows');
    h.eq(pub.latest().activeId, 'v3', 'and the active version, published in the same update');
  });

  await h.test('load: an install-only history clears loading and renders as genuinely empty', async () => {
    // The distinguishing case for the requirement: one snapshot (or none) must NOT keep the
    // skeleton on screen — loading clears and the real, honest list renders.
    const pub = publisher();
    await within(
      runHistoryLoad(async () => ({ snapshots: snaps(['v1']), activeId: 'v1' }), pub.publish),
      1000,
      'the install-only load',
    );
    h.eq(pub.latest(), { loading: false, snapshots: snaps(['v1']), activeId: 'v1' }, 'install-only history is loaded, not loading');

    const emptyPub = publisher();
    await within(
      runHistoryLoad(async () => ({ snapshots: snaps([]), activeId: null }), emptyPub.publish),
      1000,
      'the empty load',
    );
    h.eq(emptyPub.latest().loading, false, 'a zero-row result also clears the loading state');
  });

  await h.test('load: a failed read clears the loading state instead of stranding the skeleton', async () => {
    const pub = publisher();
    await h.throws(
      () => within(runHistoryLoad(async () => { throw new Error('store unreadable'); }, pub.publish), 1000, 'the failing load'),
      'store unreadable',
      'the read failure still propagates to the caller',
    );
    h.eq(pub.latest().loading, false, 'and the screen is not left loading forever');
  });

  // Scenario: the reload `confirmRestore` runs after a restore fails. The rows on screen are still
  // the truth about this app's history — a failed READ must not present as an emptied history.
  await h.test('load: a failed RELOAD keeps the rows already on screen', async () => {
    const pub = publisher();
    await within(
      runHistoryLoad(async () => ({ snapshots: snaps(['v3', 'v2', 'v1']), activeId: 'v3' }), pub.publish),
      1000,
      'the first load',
    );

    await h.throws(
      () => within(runHistoryLoad(async () => { throw new Error('store unreadable'); }, pub.publish), 1000, 'the failing reload'),
      'store unreadable',
      'the reload failure still propagates to the caller',
    );
    h.eq(pub.latest().snapshots.length, 3, 'the rows from the last good read are still on screen');
    h.eq(pub.latest().activeId, 'v3', 'and so is the active version');
    h.eq(pub.latest().loading, false, 'with the wait cleared, not a permanent skeleton');
  });

  // ── confirm-sheet double submit ────────────────────────────────────────────────────────────

  await h.test('restore: a second tap while the restore is in flight runs exactly one rollback', async () => {
    const flight = new ConfirmFlight();
    const gate = deferred<void>();
    const busy: boolean[] = [];
    let rollbacks = 0;

    const first = runConfirmOp(flight, b => busy.push(b), async () => {
      rollbacks++;
      await gate.promise;
    });
    h.eq(busy, [true], 'the button goes busy before the rollback resolves');

    // Deliberately invoking the HANDLER, not the disabled control: a guard that lived only in the
    // `disabled` prop would let this second call through and queue a second rollback.
    const second = await within(runConfirmOp(flight, b => busy.push(b), async () => { rollbacks++; }), 1000, 'the second restore');
    h.eq(second, false, 'the second confirm is refused outright');
    h.eq(rollbacks, 1, 'exactly one rollback reached the version store');

    gate.resolve();
    h.eq(await within(first, 1000, 'the first restore'), true, 'the first one ran');
    h.eq(busy, [true, false], 'and the busy state clears when it settles');
  });

  await h.test('copy: a second tap while the fork is in flight runs exactly one fork', async () => {
    const flight = new ConfirmFlight();
    const gate = deferred<void>();
    let forks = 0;

    const first = runConfirmOp(flight, () => {}, async () => {
      forks++;
      await gate.promise;
    });
    h.eq(
      await within(runConfirmOp(flight, () => {}, async () => { forks++; }), 1000, 'the second copy'),
      false,
      'the second confirm is refused',
    );
    h.eq(forks, 1, 'exactly one fork reached the version store');
    h.ok(flight.inFlight, 'the sheet is still busy with the first fork');

    gate.resolve();
    await within(first, 1000, 'the first copy');
    h.ok(!flight.inFlight, 'once it settles the sheet is free');
    h.eq(
      await within(runConfirmOp(flight, () => {}, async () => { forks++; }), 1000, 'a later copy'),
      true,
      'and a later confirm is allowed again',
    );
    h.eq(forks, 2, 'that later fork ran');
  });

  await h.test('confirm: a failed restore releases the button instead of leaving it disabled', async () => {
    const flight = new ConfirmFlight();
    const busy: boolean[] = [];
    await h.throws(
      () => within(runConfirmOp(flight, b => busy.push(b), async () => { throw new Error('rollback failed'); }), 1000, 'the failing restore'),
      'rollback failed',
      'the failure propagates',
    );
    h.eq(busy, [true, false], 'the busy state was published and then cleared');
    h.ok(!flight.inFlight, 'so the user can try again rather than facing a permanently disabled button');
  });

  // ── restore-diff pending line ──────────────────────────────────────────────────────────────

  await h.test('diff: the reassurance line shows a pending placeholder until the diff resolves', () => {
    h.eq(restoreDiffLine({ status: 'pending' }), 'pending', 'while the fields are being computed the line reserves its space');
    h.eq(restoreDiffLine({ status: 'ready', fields: ['Notes (text)'] }), 'reassurance', 'fields leaving view resolve into the reassurance sentence');
    h.eq(restoreDiffLine({ status: 'ready', fields: [] }), 'none', 'and nothing at all when no field would leave view');
    h.eq(restoreDiffLine(RESTORE_DIFF_NONE), 'none', 'a non-restore sheet has nothing pending');
  });

  // ── HistoryScreen.tsx wiring ───────────────────────────────────────────────────────────────
  // The guards are exercised for real above; what these pin is that the screen actually runs its
  // confirms and its load through them. Their failure mode is a missing wire, which leaves every
  // behavioural assertion above green.

  const src = read('HistoryScreen.tsx');

  await h.test('wiring: both confirms run their version-store call under the double-submit guard', () => {
    for (const [handler, call] of [['confirmRestore', 'access\\.rollback'], ['confirmCopy', 'access\\.fork']] as const) {
      const re = new RegExp(`const ${handler} = [\\s\\S]{0,320}?runConfirmOp\\(confirmFlight, setConfirmBusy, \\(\\) => ${call}\\(`);
      h.ok(re.test(src), `${handler} calls the version store only inside runConfirmOp`);
      const guard = new RegExp(`const ${handler} = [\\s\\S]{0,400}?if \\(!ran\\) return;`);
      h.ok(guard.test(src), `${handler} does nothing further when the confirm was refused`);
    }
    h.ok(/const confirmFlight = useRef\(new ConfirmFlight\(\)\)\.current/.test(src), 'the guard is a ref, so two taps in one frame cannot both claim it');
    h.ok(/busy=\{confirmBusy\}/.test(src), 'and the busy flag reaches the confirm sheet');
  });

  await h.test('wiring: the confirm control disables and renames itself while busy', () => {
    h.ok(/disabled=\{busy\}/.test(src), 'the consequential button is disabled while the operation runs');
    h.ok(/busy \? busyLabel : idleLabel/.test(src), 'and it says what it is doing');
    h.ok(/sheetConsequentialBtnBusy: \{ opacity/.test(src), 'the busy treatment is opacity-based — `shadow*` renders as nothing on Android');
  });

  await h.test('wiring: the first load renders skeleton rows, never a zero-row list', () => {
    h.ok(/useState<HistoryLoadState>\(HISTORY_LOADING\)/.test(src), 'the screen starts in the loading state');
    h.ok(/runHistoryLoad\(async \(\) => \{/.test(src), 'and its load runs through runHistoryLoad');
    h.ok(/loading \? \(\s*<HistoryLoadingRows/.test(src), 'while loading, the skeleton rows render instead of the FlatList');
    h.ok(/<BreathingView/.test(src), 'reusing the design system’s breathe primitive rather than a hand-rolled animation');
    h.ok(
      /skeletonHeadline: \{ height: TYPE_SCALE\.bodyEmphatic\.lineHeight/.test(src) &&
        /skeletonMeta: \{ height: TYPE_SCALE\.metaPlain\.lineHeight/.test(src),
      'and its geometry from the same type-scale the real rows use, so the list does not jump',
    );
  });

  await h.test('copy: the wait states are named in product copy, not invented at the call site', () => {
    h.eq(COPY.historyRestoreConfirmBusy, 'Going back…', 'the restore button names the restore it is running');
    h.eq(COPY.historyCopyConfirmBusy, 'Making the copy…', 'and the copy button the fork');
    h.ok(COPY.historyLoadingLabel.length > 0, 'the first-load skeleton has a screen-reader name');
    h.ok(COPY.historyReassurancePending.length > 0, 'so does the pending reassurance placeholder');
  });
}
