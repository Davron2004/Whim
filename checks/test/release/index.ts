/**
 * Aggregates the release-tooling acceptance suites (design D12 "Tests" paragraph — one
 * aggregator so `checks/test/acceptance.ts` is edited once, by chain-1, and never again).
 * Each `<name>.suite.ts` exports `run(): Promise<void>`, using `checks/test/harness.ts`'s
 * `test()`/`assert()` for its own scenarios; a suite never calls `report()` itself — that
 * happens once, at the end of the whole acceptance run.
 *
 * chain-1 pre-creates every suite file below as a stub (its header names the owning chain)
 * except `native-config`, which chain-1 fills itself. See
 * `openspec/changes/platform-release-readiness/handoff/release-tooling.md` for the suite →
 * owning-chain map. `checks/test/acceptance.ts` is edited once, by chain-1; this file gets one
 * more import and call from chain-16 (its network-deny suite) — see chains.md's parallel-safety
 * rules — and otherwise no later chain adds or removes a line here.
 */

import { run as runNativeConfig } from './native-config.suite';
import { run as runHermesEntry } from './hermes-entry.suite';
import { run as runIosProject } from './ios-project.suite';
import { run as runAndroidProject } from './android-project.suite';
import { run as runAssets } from './assets.suite';
import { run as runStoreListing } from './store-listing.suite';
import { run as runReleaseCli } from './release-cli.suite';
import { run as runDomainLockstep } from './domain-lockstep.suite';
import { run as runNativeNetworkDeny } from './native-network-deny.suite';

export async function runReleaseSuites(): Promise<void> {
  await runNativeConfig();
  await runHermesEntry();
  await runIosProject();
  await runAndroidProject();
  await runAssets();
  await runStoreListing();
  await runReleaseCli();
  await runDomainLockstep();
  await runNativeNetworkDeny();
}
