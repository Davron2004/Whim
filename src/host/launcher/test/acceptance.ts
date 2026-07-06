/**
 * launcher Node acceptance (task 5.4) — the fast, device-free checkpoint for the launcher's
 * deterministic core: the back-policy state machine (2.2), the installed-apps index (5.1), and
 * the version-store access wrapper (5.2). Green here is the correctness gate; the pass is the
 * on-device walk (acceptance.spec.md / task 7.2).
 *
 *   npm run launcher:test
 */

import { Harness } from './harness';
import { runBackPolicyTests } from './back-policy.test';
import { runAppIndexTests } from './app-index.test';
import { runStoreAccessTests } from './store-access.test';
import { runSeedTests } from './seed.test';
import { runProductVerbsTests } from './product-verbs.test';
import { runDevProbeBackButtonTests } from './dev-probe-back-button.test';
import { runUnmountTeardownTests } from './unmount-teardown.test';
import { runDeliverTests } from './deliver.test';

const h = new Harness();

console.log('\nlauncher acceptance — back-policy + app-index + store-access + seed + product-verbs\n');

await runBackPolicyTests(h);
await runAppIndexTests(h);
await runStoreAccessTests(h);
await runSeedTests(h);
await runProductVerbsTests(h);
await runDevProbeBackButtonTests(h);
await runUnmountTeardownTests(h);
await runDeliverTests(h);

console.log(`\n${h.passed} checks passed, ${h.failures.length} failed.`);
if (h.failures.length) {
  console.error('\nFAILURES:\n' + h.failures.map(f => '  - ' + f).join('\n'));
  process.exit(1);
}
console.log('✅ launcher acceptance green.\n');
