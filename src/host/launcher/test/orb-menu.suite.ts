/**
 * orb-menu acceptance (shell-redesign-v2 chain-G, `app-launcher` §"The orb is a tapped menu
 * whose actions are instrumented"; design D12).
 *
 * The action set and its persisted tap counts are pure and exercised directly; the rendered `Orb`
 * is driven at the end, for which callback each action reaches and what gets counted.
 */

import React from 'react';
import { Harness } from './harness';
import { MapKVBackend } from '../../version-store/fs/kv-fs';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import { COPY } from '../copy';
import Orb from '../Orb';
import {
  ORB_ACTIONS,
  recordOrbAction,
  loadOrbActionCounts,
  type OrbActionId,
} from '../orb-actions';
import { chromeInsetBottom } from '../orb-geometry';
import { resetNativeStorage } from './native-storage';
import { button, press, renderScreen, textOf, unmountScreen } from './react-screen';

export async function runOrbMenuTests(h: Harness): Promise<void> {
  // ── the action set ─────────────────────────────────────────────────────────
  await h.test('orb-menu: the action set contains nothing destructive', async () => {
    const ids = ORB_ACTIONS.map((a) => a.id);
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

  // ── the rendered orb: each action reaches its own callback, and only an action is counted ──
  await h.test('orb-menu: each action calls its own callback once and is counted; dismissing or toggling counts nothing', async () => {
    const callbackOf: Record<OrbActionId, string> = { change: 'onChangeIt', home: 'onExit', versions: 'onVersions', report: 'onReport' };
    for (const action of ORB_ACTIONS) {
      resetNativeStorage();
      const calls: Record<string, number> = { onChangeIt: 0, onExit: 0, onVersions: 0, onReport: 0 };
      const spy = (name: string) => () => { calls[name]++; };
      const tree = await renderScreen(React.createElement(Orb, {
        onExit: spy('onExit'), onVersions: spy('onVersions'), onChangeIt: spy('onChangeIt'), onReport: spy('onReport'),
      }));
      try {
        const counts = () => loadOrbActionCounts(createMmkvBackend('whim.launcher'));
        const dismiss = () => tree.root.findAll((n) => n.type === 'Pressable' && n.props.accessibilityLabel === COPY.orbMenuDismissLabel);
        await press(button(tree, COPY.orbMenuOpenLabel));
        await press(button(tree, COPY.orbMenuCloseLabel));
        await press(button(tree, COPY.orbMenuOpenLabel));
        await press(dismiss()[0]);
        h.eq(Object.values(counts()).reduce((a, b) => a + b, 0), 0, 'opening, closing and dismissing the menu count nothing');
        await press(button(tree, COPY.orbMenuOpenLabel));
        await press(tree.root.find((n) => n.type === 'Pressable' && n.props.accessibilityLabel == null && textOf(n).endsWith(action.label)));
        const expected = Object.fromEntries(Object.keys(calls).map((name) => [name, name === callbackOf[action.id] ? 1 : 0]));
        h.eq(calls, expected, `"${action.label}" calls ${callbackOf[action.id]} once and nothing else`);
        h.eq(counts()[action.id], 1, 'and is counted once in storage');
        h.eq(dismiss().length, 0, 'and the menu closes');
      } finally {
        await unmountScreen(tree);
      }
    }
  });
}
