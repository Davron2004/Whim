/**
 * E2 regression: tearing down a live realm (`teardown.ts`) marks it dead, closes its storage
 * engine and clears the host's live and back-press timer refs. That `useMiniAppHost` runs it on
 * unmount without calling `onExit`, and that a second teardown after `exit()` is harmless, is
 * rendered in `mini-app-host-ui.suite.tsx`.
 */

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

}
