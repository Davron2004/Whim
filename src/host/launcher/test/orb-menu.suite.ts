/**
 * orb-menu acceptance (shell-redesign-v2 chain-G, `app-launcher` §"The orb is a tapped menu
 * whose actions are instrumented"; design D12).
 *
 * `Orb.tsx` is an RN component (not renderable under Node, same idiom as `tile-colour.suite.ts`
 * for `AppTile`) — its no-wheel negative assertions are checked against its production source
 * text instead. Everything else under test here (the action set, the instrumentation persistence
 * pair) is pure and exercised directly.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { MapKVBackend } from '../../version-store/fs/kv-fs';
import {
  ORB_ACTIONS,
  recordOrbAction,
  loadOrbActionCounts,
  type OrbActionId,
} from '../orb-actions';

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src/host/launcher', file), 'utf8');
}

export async function runOrbMenuTests(h: Harness): Promise<void> {
  // ── the action set ─────────────────────────────────────────────────────────
  await h.test('orb-menu: the action set contains nothing destructive', async () => {
    const ids = ORB_ACTIONS.map((a) => a.id);
    h.eq(ids, ['change', 'home', 'versions', 'report'], 'exactly the 4 wired actions, in order — no placeholder "copy"');
    const destructive = ['delete', 'rename', 'restore'];
    for (const bad of destructive) {
      h.ok(!ids.includes(bad as OrbActionId), `"${bad}" must never be an orb menu action`);
      h.ok(
        !ORB_ACTIONS.some((a) => a.label.toLowerCase().includes(bad)),
        `no action label mentions "${bad}"`,
      );
    }
  });

  // ── instrumentation persists, cross-session, off-screen ───────────────────
  await h.test('orb-menu: tap counts accumulate across two launches for the same action', async () => {
    const kv = new MapKVBackend();
    recordOrbAction(kv, 'versions'); // "launch" 1
    const restarted = new MapKVBackend(kv.raw()); // simulate an app restart over the same store
    recordOrbAction(restarted, 'versions'); // "launch" 2
    h.eq(loadOrbActionCounts(restarted).versions, 2, 'the same action fired twice across two launches counts as two');
  });

  await h.test('orb-menu: counts are per-action and start at zero', async () => {
    const kv = new MapKVBackend();
    recordOrbAction(kv, 'change');
    recordOrbAction(kv, 'change');
    recordOrbAction(kv, 'home');
    const counts = loadOrbActionCounts(kv);
    h.eq(counts.change, 2, 'change counted twice');
    h.eq(counts.home, 1, 'home counted once');
    h.eq(counts.versions, 0, 'versions never fired, still readable as zero');
  });

  await h.test('orb-menu: instrumentation keys are namespaced, not the bare action id', async () => {
    const kv = new MapKVBackend();
    recordOrbAction(kv, 'versions');
    const keys = kv.getAllKeys();
    h.ok(keys.some((k) => k.includes('versions') && k !== 'versions'), 'the persisted key is not the literal action id "versions"');
  });

  await h.test('orb-menu: a tolerant, corrupt prior value is treated as zero, never throws', async () => {
    const kv = new MapKVBackend();
    kv.set('orb-action-count:home', 'not-a-number');
    let threw = false;
    try {
      recordOrbAction(kv, 'home');
      // eslint-disable-next-line no-restricted-syntax -- intentional: the assertion IS "did it throw"; the thrown value is deliberately discarded and h.ok below reports the outcome
    } catch {
      threw = true;
    }
    h.ok(!threw, 'recordOrbAction never throws on a corrupt prior value');
    h.eq(loadOrbActionCounts(kv).home, 1, 'a corrupt prior value resets the effective count to zero before the bump');
  });

  const orbSource = read('Orb.tsx');

  await h.test('orb-menu: every action tap is instrumented before anything else happens', async () => {
    const onActionBody = orbSource.slice(orbSource.indexOf('const onAction'), orbSource.indexOf('return (', orbSource.indexOf('const onAction')));
    h.ok(/recordOrbAction\(kv, id\)/.test(onActionBody), 'onAction calls recordOrbAction first');
    const recordIdx = onActionBody.indexOf('recordOrbAction');
    const menuCloseIdx = onActionBody.indexOf('setMenuOpen(false)');
    h.ok(recordIdx >= 0 && menuCloseIdx > recordIdx, 'instrumentation happens before the menu closes');
  });

  await h.test('orb-menu: "versions", "change" and "report" navigate to their real destinations, not a placeholder sheet', async () => {
    const onActionBody = orbSource.slice(orbSource.indexOf('const onAction'), orbSource.indexOf('return (', orbSource.indexOf('const onAction')));
    h.ok(/onVersions\(\)/.test(onActionBody), '"versions" calls the onVersions callback');
    h.ok(/onChangeIt\(\)/.test(onActionBody), '"change" calls the onChangeIt callback');
    h.ok(/onReport\(\)/.test(onActionBody), '"report" calls the onReport callback');
    h.ok(!/OrbSheetKind|sheetTitle|styles\.sheet\b/.test(orbSource), 'the orb-local placeholder sheet is gone entirely');
  });

  await h.test('orb-menu: dismissing (scrim tap) and re-tapping the orb never call recordOrbAction', async () => {
    const closeAllBody = orbSource.slice(orbSource.indexOf('const closeAll'), orbSource.indexOf('const onOrbPress'));
    h.ok(!/recordOrbAction/.test(closeAllBody), 'closeAll (scrim dismiss) never instruments an action');
    const onOrbPressBody = orbSource.slice(orbSource.indexOf('const onOrbPress'), orbSource.indexOf('const onAction'));
    h.ok(!/recordOrbAction/.test(onOrbPressBody), 'toggling the orb itself never instruments an action');
  });

}
