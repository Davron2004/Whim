/**
 * Deploy artifacts acceptance (public-generation-server chain-12). Scaffolded here by chain-1
 * (task 2.5, pre-registered in acceptance.ts); chain-12 fills it in — this module is
 * chain-12's alone to edit.
 */
import { section } from './harness';
import { runWebSiteTests } from './web-site.suite';

export async function runDeployConfigTests(): Promise<void> {
  await runWebSiteTests();
  section('Deploy artifacts');
}
