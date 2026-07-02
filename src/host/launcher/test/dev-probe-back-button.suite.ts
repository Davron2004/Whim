/**
 * E1 regression: DevProbeScreen back-button wiring.
 *
 * The back button (the ‹ Home TouchableOpacity) must use `onPress={host.exit}`, NOT the bare
 * `onPress={onExit}` prop. Routing through `host.exit` is the only path that calls
 * tearDownRealm and engine?.close() before delegating to the exit callback; bypassing it
 * leaks the DB handle and leaves `alive=true`.
 *
 * This is a static source assertion: it reads DevProbeScreen.tsx and verifies the wiring
 * without needing to render RN components. The test FAILS if the fix is reverted:
 *   • Assertion 1 fails if `onPress={host.exit}` is absent (fix not applied).
 *   • Assertion 2 fails if `onPress={onExit}` is present on the back button (bug still there).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';

export async function runDevProbeBackButtonTests(h: Harness): Promise<void> {
  await h.test('E1: DevProbeScreen back button is wired to host.exit, not bare onExit', () => {
    // Use process.cwd() (the repo root) to locate the production file — esbuild bundles this
    // into a temp file so import.meta.url would point at the bundle, not the source directory.
    const srcPath = path.join(process.cwd(), 'src/host/launcher/DevProbeScreen.tsx');
    const src = fs.readFileSync(srcPath, 'utf8');

    // Assertion 1: the fix must be present — host.exit wires tearDownRealm + engine?.close().
    // This fails if the production line is reverted back to onPress={onExit}.
    h.ok(
      src.includes('onPress={host.exit}'),
      'DevProbeScreen back button must use onPress={host.exit} (routes through tearDownRealm)',
    );

    // Assertion 2: the bare onExit prop must NOT appear on the back-button TouchableOpacity.
    // A presence of both would mean the fix is present but the old wiring is also left in.
    // Specifically check that the back-button line does not use bare onExit.
    // The back-button is the TouchableOpacity with backBtn style; it's the only one
    // in the titleRow. We check that no TouchableOpacity line has onPress={onExit}.
    const lines = src.split('\n');
    const backButtonLines = lines.filter(l => l.includes('backBtn') || (l.includes('TouchableOpacity') && l.includes('onPress={onExit}')));
    h.ok(
      !backButtonLines.some(l => l.includes('onPress={onExit}')),
      'DevProbeScreen back button must NOT use bare onPress={onExit} (bypasses tearDownRealm)',
    );
  });
}
