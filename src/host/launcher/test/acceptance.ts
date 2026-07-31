/**
 * launcher Node acceptance (task 5.4) — the fast, device-free checkpoint for the launcher's
 * deterministic core: the back-policy state machine (2.2), the installed-apps index (5.1), and
 * the version-store access wrapper (5.2). Green here is the correctness gate; the pass is the
 * on-device walk (acceptance.spec.md / task 7.2).
 *
 *   npm run launcher:test
 */

import { Harness } from './harness';
import { runBackPolicyTests } from './back-policy.suite';
import { runAppIndexTests } from './app-index.suite';
import { runStoreAccessTests } from './store-access.suite';
import { runPromptEnvelopeTests } from './prompt-envelope.suite';
import { runSeedTests } from './seed.suite';
import { runProductVerbsTests } from './product-verbs.suite';
import { runDevProbeBackButtonTests } from './dev-probe-back-button.suite';
import { runUnmountTeardownTests } from './unmount-teardown.suite';
import { runDeliverTests } from './deliver.suite';
import { runThemeTests } from './theme.suite';
import { runHistoryLogicTests } from './history-logic.suite';
import { runForkQuestionUiTests } from './fork-question-ui.suite';
import { runSharedStorageTests } from './shared-storage.suite';
import { runLaunchFailureUiTests } from './launch-failure-ui.suite';
import { runPromptFlowScreensTests } from './prompt-flow-screens.suite';

const h = new Harness();

console.log('\nlauncher acceptance — back-policy + app-index + store-access + seed + product-verbs\n');

await runBackPolicyTests(h);
await runAppIndexTests(h);
await runStoreAccessTests(h);
await runPromptEnvelopeTests(h);
await runSeedTests(h);
await runProductVerbsTests(h);
await runDevProbeBackButtonTests(h);
await runUnmountTeardownTests(h);
await runDeliverTests(h);
await runThemeTests(h);
await runHistoryLogicTests(h);
await runForkQuestionUiTests(h);
await runSharedStorageTests(h);
await runLaunchFailureUiTests(h);
await runPromptFlowScreensTests(h);

console.log(`\n${h.passed} checks passed, ${h.failures.length} failed.`);
if (h.failures.length) {
  console.error('\nFAILURES:\n' + h.failures.map(f => '  - ' + f).join('\n'));
  process.exit(1);
}
console.log('✅ launcher acceptance green.\n');
