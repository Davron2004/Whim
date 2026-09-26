/** Runs the release-tooling suites; each exports `run()` and uses checks/test/harness.ts. */

import { run as runNativeConfig } from './native-config.suite';
import { run as runHermesEntry } from './hermes-entry.suite';
import { run as runIosProject } from './ios-project.suite';
import { run as runAndroidProject } from './android-project.suite';
import { run as runAssets } from './assets.suite';
import { run as runStoreListing } from './store-listing.suite';
import { run as runReleaseCli } from './release-cli.suite';
import { run as runDomainLockstep } from './domain-lockstep.suite';
import { run as runNativeNetworkDeny } from './native-network-deny.suite';
import { run as runDisclosure } from './disclosure.suite';
import { run as runSourceMaps } from './source-maps.suite';
import { run as runUpgradeCheck } from './upgrade-check.suite';

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
  await runDisclosure();
  await runSourceMaps();
  await runUpgradeCheck();
}
