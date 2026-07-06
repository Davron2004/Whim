/**
 * E2 regression: useMiniAppHost unmount teardown.
 *
 * When the component unmounts without routing through host.exit(), the live realm must be
 * cleaned up: alive set to false, engine closed, live.current cleared, and popTimer cleared.
 * A separate unmount-only useEffect (empty deps, no onExit call) is the enforcement mechanism.
 *
 * Two parts:
 *   (1) BEHAVIORAL — import the extracted RN-free helper `tearDownLiveRealm` directly and
 *       verify all four postconditions hold.
 *   (2) STATIC WIRING — read useMiniAppHost.ts from disk and assert the unmount useEffect is
 *       present and does not reference onExit/onExitRef (so onExit structurally cannot fire on
 *       unmount).
 *
 * FAILS without the fix:
 *   • Revert teardown.ts or break the helper  → (1) assertions fail (alive/closed/null not set).
 *   • Remove the empty-dep useEffect          → (2) static wiring assertion fails.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { tearDownLiveRealm } from '../teardown';
import type { RealmRecord } from '../../bridge';

export async function runUnmountTeardownTests(h: Harness): Promise<void> {
  // ── (1) Behavioral: the helper correctly tears down live + popTimer ───────────
  await h.test('E2(1): tearDownLiveRealm sets alive=false, closes engine, clears live and popTimer', () => {
    let closed = false;
    const realm = {
      appId: 'test-app',
      manifest: { capabilities: [] },
      engine: { close() { closed = true; } },
      generation: 1,
      alive: true,
    } as unknown as RealmRecord;

    const live = { current: { app: 'x', realm, dispatcher: {} } };
    const popTimer = { current: setTimeout(() => { /* never fires */ }, 100_000) };

    tearDownLiveRealm(live, popTimer);

    h.ok(realm.alive === false, 'E2(1): tearDownRealm must set realm.alive to false');
    h.ok(closed === true, 'E2(1): engine.close() must be called');
    h.ok(live.current === null, 'E2(1): live.current must be null after teardown');
    h.ok(popTimer.current === null, 'E2(1): popTimer.current must be null after teardown');
  });

  // ── (1b) Behavioral: safe to call when already null (no throw) ──────────────
  await h.test('E2(1b): tearDownLiveRealm is safe when live and popTimer are already null', () => {
    const live = { current: null };
    const popTimer = { current: null };
    // Must not throw
    tearDownLiveRealm(live as Parameters<typeof tearDownLiveRealm>[0], popTimer);
    h.ok(true, 'E2(1b): no throw when both refs are null');
  });

  // ── (2) Static wiring: useMiniAppHost has an empty-dep unmount effect calling tearDownLiveRealm
  //        and that effect does NOT reference onExit/onExitRef ───────────────────
  await h.test('E2(2): useMiniAppHost has empty-dep unmount useEffect calling tearDownLiveRealm without onExit', () => {
    const srcPath = path.join(process.cwd(), 'src/host/launcher/useMiniAppHost.ts');
    const src = fs.readFileSync(srcPath, 'utf8');

    // Assert the empty-dep effect with tearDownLiveRealm is present.
    // The pattern: useEffect(() => () => { tearDownLiveRealm(  with empty deps [].
    h.ok(
      src.includes('tearDownLiveRealm(live, popTimer)'),
      'E2(2): useMiniAppHost must call tearDownLiveRealm(live, popTimer)',
    );

    // Find lines that are part of the unmount useEffect (empty deps) block and verify
    // tearDownLiveRealm is called from it.
    const lines = src.split('\n');

    // Locate the line index where the unmount effect is declared (empty deps []).
    // It must be a useEffect with empty deps array [] that also contains tearDownLiveRealm.
    // We look for the useEffect(() => () => { tearDownLiveRealm pattern.
    const unmountEffectLine = lines.findIndex(
      (l) => l.includes('useEffect') && l.includes('tearDownLiveRealm') && l.includes('[]'),
    );

    h.ok(
      unmountEffectLine !== -1,
      'E2(2): useMiniAppHost must have a useEffect with empty deps [] that calls tearDownLiveRealm',
    );

    // Verify that the unmount effect line (and adjacent context) does NOT reference onExit.
    // We check the single line because the empty-dep teardown is intentionally one-liner.
    if (unmountEffectLine !== -1) {
      const effectLine = lines[unmountEffectLine];
      h.ok(
        !effectLine.includes('onExit') && !effectLine.includes('onExitRef'),
        'E2(2): the empty-dep unmount useEffect must NOT reference onExit or onExitRef',
      );
    }
  });
}
