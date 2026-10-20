/**
 * orb-menu acceptance: what the orb is once its tapped menu is gone (design-system-v1 task 19.5,
 * `app-launcher` "The orb is an opaque, draggable disc that opens the Whim sheet"; the menu and its
 * tap counters are REMOVED). A tap opens the Whim sheet and nothing of the orb's own; the counters the
 * old menu stored are removed from the phone at launch, once; the footprint the realm is told.
 * Dragging, corners and the keyboard are in `orb-ui.suite.tsx`; the sheet itself in
 * `whim-sheet-ui.suite.tsx`.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { Harness } from './harness';
import { MapKVBackend, type KVBackend } from '../../version-store/fs/kv-fs';
import HomeScreen from '../HomeScreen';
import { COPY } from '../copy';
import Orb from '../Orb';
import { chromeInsetBottom } from '../orb-geometry';
import { sweepRetiredKeys } from '../retired-keys';
import { resetNativeStorage } from './native-storage';
import { button, press, renderScreen, unmountScreen, hostType } from './react-screen';
import { waitFor, withLauncher } from './rendered-launcher';

/** The keys the retired menu wrote: `orb-action-count:` and the action, one per action tapped
 *  (`orb-actions.ts#recordOrbAction`, removed in task 19.5), each holding its count. */
const OLD_COUNTERS: Readonly<Record<string, string>> = {
  'orb-action-count:change': '4',
  'orb-action-count:home': '12',
  'orb-action-count:versions': '1',
  'orb-action-count:report': '2',
};

/** A KVBackend over `inner` that counts what is done to it. */
function counted(inner: KVBackend) {
  const ops = { reads: 0, writes: 0, deletes: 0 };
  const kv: KVBackend = {
    getString: (key) => { ops.reads++; return inner.getString(key); },
    set: (key, value) => { ops.writes++; inner.set(key, value); },
    delete: (key) => { ops.deletes++; inner.delete(key); },
    getAllKeys: () => inner.getAllKeys(),
  };
  return { kv, ops };
}

const entries = (kv: KVBackend) => Object.fromEntries(kv.getAllKeys().map((key) => [key, kv.getString(key)]));

export async function runOrbMenuTests(h: Harness): Promise<void> {
  // ── a tap opens the Whim sheet ─────────────────────────────────────────────
  await h.test('orb-menu: a tap on the orb opens the Whim sheet, each time, and draws nothing of its own', async () => {
    resetNativeStorage();
    let opened = 0;
    const tree = await renderScreen(React.createElement(Orb, { appId: 'app-a', onOpen: () => { opened++; } }));
    try {
      await press(button(tree, COPY.orbMenuOpenLabel));
      await press(button(tree, COPY.orbMenuOpenLabel));
      h.eq(opened, 2, 'each tap opens the sheet once, and the orb keeps its name ("Whim menu") after a tap');
      h.eq(tree.root.findAll((n) => hostType(n) === 'Modal').length, 0, 'no menu or scrim of the orb’s own');
      h.eq(tree.root.findAll((n) => hostType(n) === 'Pressable').length, 1, 'the orb is its one control');
    } finally {
      await unmountScreen(tree);
    }
  });

  await h.test('orb-menu: the orb button carries no elevation (the Android grey-disc regression)', async () => {
    resetNativeStorage();
    const tree = await renderScreen(React.createElement(Orb, { appId: 'app-a', onOpen: () => {} }));
    try {
      const styles = button(tree, COPY.orbMenuOpenLabel).findAll((n) => typeof n.type === 'string').map((n) => StyleSheet.flatten(n.props.style) as Record<string, unknown>);
      h.ok(styles.every((s) => !('elevation' in s)), 'no elevation style anywhere in the orb: it drew a solid grey disc on Android, not a shadow');
      h.ok(styles.some((s) => typeof s.boxShadow === 'string' && s.boxShadow.length > 0), 'its shadow is a boxShadow, which both platforms draw');
    } finally {
      await unmountScreen(tree);
    }
  });

  // ── the retired menu's stored counters leave the phone ─────────────────────
  await h.test('orb-menu: launching Whim removes the retired menu’s tap counters and keeps every other stored setting', async () => {
    let kept: Record<string, string | null | undefined> = {};
    await withLauncher({
      server: () => new Response(null, { status: 404 }),
      prepare: (kv) => {
        for (const [key, value] of Object.entries(OLD_COUNTERS)) kv.set(key, value);
        kv.set('orb-corner:app-a', 'leading');
        kept = Object.fromEntries(kv.getAllKeys().filter((key) => !(key in OLD_COUNTERS)).map((key) => [key, kv.getString(key)]));
      },
    }, async ({ tree, kv }) => {
      await waitFor(() => tree.root.findAllByType(HomeScreen).length === 1, 'Home');
      h.eq(kv.getAllKeys().filter((key) => key.startsWith('orb-action-count:')), [], 'no tap counter is left on the phone');
      const now = entries(kv);
      h.eq(Object.keys(kept).filter((key) => now[key] !== kept[key]), [], 'every other key the phone had is still there, unchanged (the orb’s corner, terms, consent, the index)');
    });
  });

  await h.test('orb-menu: the counter sweep runs once: a fresh install loses nothing, and every later launch only reads its marker', () => {
    const fresh = new MapKVBackend(new Map([['orb-corner:app-a', 'leading'], ['device-id', 'd-1']]));
    const before = entries(fresh);
    sweepRetiredKeys(fresh);
    const after = entries(fresh);
    h.eq(Object.keys(before).filter((key) => after[key] !== before[key]), [], 'a fresh install keeps everything it had');
    h.eq(fresh.getAllKeys().length, 3, 'and gains only the sweep’s marker');
    const later = counted(fresh);
    sweepRetiredKeys(later.kv);
    h.eq(later.ops, { reads: 1, writes: 0, deletes: 0 }, 'a second launch reads one key and changes nothing');
    const upgraded = new MapKVBackend(new Map(Object.entries(OLD_COUNTERS)));
    sweepRetiredKeys(upgraded);
    upgraded.set('orb-action-count:home', '1');
    sweepRetiredKeys(upgraded);
    h.eq(upgraded.getString('orb-action-count:home'), '1', 'once swept, a launch never sweeps again (what it removes is only ever written by an older build)');
  });

  // ── the footprint the realm is told (beta-1 D5) ─────────────────────────────
  // That it matches where the orb is drawn is asserted on the rendered mini-app container
  // (mini-app-host-ui.suite.tsx); these cover the arithmetic at the edges a device can hand it.
  await h.test('orb-menu: the orb footprint grows with the bottom safe-area inset, in whole pixels', async () => {
    const bare = chromeInsetBottom(0);
    h.ok(bare > 0, 'the orb covers some of the bottom edge even with no inset');
    h.eq(chromeInsetBottom(34), bare + 34, 'each pixel of inset adds a pixel of footprint');
    h.eq(chromeInsetBottom(10.4), bare + 10, 'a fractional inset rounds down below the half');
    h.eq(chromeInsetBottom(10.5), bare + 11, 'and up from it');
  });

  await h.test('orb-menu: the orb footprint is clamped to 0–200, and a footprint that is not a number is 0', async () => {
    h.eq(chromeInsetBottom(1000), 200, 'an absurd inset is capped at 200');
    h.eq(chromeInsetBottom(-1000), 0, 'a negative result is 0');
    h.eq(chromeInsetBottom(Number.NaN), 0, 'NaN is 0');
    h.eq(chromeInsetBottom(Number.POSITIVE_INFINITY), 0, 'Infinity is 0, not the cap');
    h.eq(chromeInsetBottom(Number.NEGATIVE_INFINITY), 0, '-Infinity is 0');
  });
}
