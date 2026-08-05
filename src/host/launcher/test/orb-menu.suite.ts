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
  orbRowGlyphColor,
  type OrbActionId,
} from '../orb-actions';
import { COPY } from '../copy';
import { SHELL_COLORS } from '../../../sdk/theme';

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src/host/launcher', file), 'utf8');
}

export async function runOrbMenuTests(h: Harness): Promise<void> {
  // ── the action set ─────────────────────────────────────────────────────────
  await h.test('orb-menu: the action set contains nothing destructive', async () => {
    const ids = ORB_ACTIONS.map((a) => a.id);
    h.eq(ids, ['change', 'home', 'versions'], 'exactly the 3 wired actions, in order — no placeholder "copy"');
    const destructive = ['delete', 'rename', 'restore'];
    for (const bad of destructive) {
      h.ok(!ids.includes(bad as OrbActionId), `"${bad}" must never be an orb menu action`);
      h.ok(
        !ORB_ACTIONS.some((a) => a.label.toLowerCase().includes(bad)),
        `no action label mentions "${bad}"`,
      );
    }
  });

  await h.test('orb-menu: every action label comes from the shared COPY table', async () => {
    h.eq(ORB_ACTIONS.find((a) => a.id === 'change')?.label, COPY.orbActionChangeIt, 'change label');
    h.eq(ORB_ACTIONS.find((a) => a.id === 'home')?.label, COPY.orbActionHome, 'home label');
    h.eq(ORB_ACTIONS.find((a) => a.id === 'versions')?.label, COPY.orbActionVersions, 'versions label');
  });

  // ── the per-row swatch (design `3a`/`3b`/`3c`, html:220-224) ──────────────
  await h.test('orb-menu: each row swatch takes its glyph colour from a token, never an inline hex', async () => {
    h.eq(orbRowGlyphColor('change'), SHELL_COLORS.accent, 'change glyph uses the accent token, not a literal');
    h.eq(orbRowGlyphColor('home'), SHELL_COLORS.text, 'home glyph uses the text token, not a literal');
    h.eq(orbRowGlyphColor('versions'), SHELL_COLORS.text, 'versions glyph uses the text token, not a literal');
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
    } catch {
      threw = true;
    }
    h.ok(!threw, 'recordOrbAction never throws on a corrupt prior value');
    h.eq(loadOrbActionCounts(kv).home, 1, 'a corrupt prior value resets the effective count to zero before the bump');
  });

  // ── negative assertions: no wheel, no counter on any surface ──────────────
  // Scanned with `//` comment lines stripped: the file's own doc comments legitimately name the
  // unbuilt gesture (to explain why it is absent) — the product concern is CODE and rendered
  // copy, not documentation prose describing what was deliberately left out.
  const orbSource = read('Orb.tsx');
  const orbCode = orbSource
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  await h.test('orb-menu: no press-and-hold arming exists in the orb source', async () => {
    h.ok(!/setTimeout/.test(orbCode), 'no hold-timer scaffolding (setTimeout) in Orb.tsx');
    h.ok(!/PanResponder/.test(orbCode), 'no drag/gesture responder in Orb.tsx');
    h.ok(!/onOrbMove|onPanResponderMove/.test(orbCode), 'no pointer-move / drag hit-testing in Orb.tsx');
  });

  await h.test('orb-menu: no wheel/wedge geometry or direction hints in the orb source', async () => {
    h.ok(!/wedge|sector|wheel/i.test(orbCode), 'no wheel/wedge/sector vocabulary in Orb.tsx code');
    h.ok(!/["'`](up|down|left|right)["'`]/i.test(orbCode), 'no literal direction-hint strings in Orb.tsx');
  });

  await h.test('orb-menu: no "hold to flick" copy is advertised anywhere in the orb source', async () => {
    h.ok(!/hold.*flick|flick.*hold/i.test(orbCode), 'no hold-to-flick caption text in Orb.tsx code');
  });

  await h.test('orb-menu: no tap count is rendered on any user-facing surface', async () => {
    h.ok(!/loadOrbActionCounts/.test(orbSource), 'Orb.tsx never reads back the counts it writes');
    h.ok(!/\bcount\b/i.test(orbCode), 'no "count" vocabulary appears in the orb component code');
  });

  await h.test('orb-menu: every action tap is instrumented before anything else happens', async () => {
    const onActionBody = orbSource.slice(orbSource.indexOf('const onAction'), orbSource.indexOf('return (', orbSource.indexOf('const onAction')));
    h.ok(/recordOrbAction\(kv, id\)/.test(onActionBody), 'onAction calls recordOrbAction first');
    const recordIdx = onActionBody.indexOf('recordOrbAction');
    const menuCloseIdx = onActionBody.indexOf('setMenuOpen(false)');
    h.ok(recordIdx >= 0 && menuCloseIdx > recordIdx, 'instrumentation happens before the menu closes');
  });

  await h.test('orb-menu: "versions" and "change" navigate to their real destinations, not a placeholder sheet', async () => {
    const onActionBody = orbSource.slice(orbSource.indexOf('const onAction'), orbSource.indexOf('return (', orbSource.indexOf('const onAction')));
    h.ok(/onVersions\(\)/.test(onActionBody), '"versions" calls the onVersions callback');
    h.ok(/onChangeIt\(\)/.test(onActionBody), '"change" calls the onChangeIt callback');
    h.ok(!/OrbSheetKind|sheetTitle|styles\.sheet\b/.test(orbSource), 'the orb-local placeholder sheet is gone entirely');
  });

  await h.test('orb-menu: dismissing (scrim tap) and re-tapping the orb never call recordOrbAction', async () => {
    const closeAllBody = orbSource.slice(orbSource.indexOf('const closeAll'), orbSource.indexOf('const onOrbPress'));
    h.ok(!/recordOrbAction/.test(closeAllBody), 'closeAll (scrim dismiss) never instruments an action');
    const onOrbPressBody = orbSource.slice(orbSource.indexOf('const onOrbPress'), orbSource.indexOf('const onAction'));
    h.ok(!/recordOrbAction/.test(onOrbPressBody), 'toggling the orb itself never instruments an action');
  });

  await h.test('orb-menu: FloatingExit is gone, replaced by the orb', async () => {
    h.ok(!fs.existsSync(path.join(process.cwd(), 'src/host/launcher/FloatingExit.tsx')), 'FloatingExit.tsx no longer exists');
    const miniAppView = read('MiniAppView.tsx');
    h.ok(!/FloatingExit/.test(miniAppView), 'MiniAppView no longer references FloatingExit');
    h.ok(/<Orb\b/.test(miniAppView), 'MiniAppView renders the Orb');
  });
}
