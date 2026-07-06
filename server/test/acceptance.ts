/**
 * Harness server + contract acceptance suite (harness-server-skeleton). Implements server/test/SPEC.md.
 * Run via `npm run server:test` (server/test/run.mjs type-checks both workspaces, bundles this with
 * esbuild, and runs it under Node). Each area lives in its own *.test.ts module; this file sequences
 * them and reports. Sections are added as chains lead (contract → server core → metering → wrapper).
 */
import { report } from './harness';
import { runContractTests } from './contract.suite';
import { runServerCoreTests } from './server-core.suite';
import { runMeteringTests } from './metering.suite';
import { runOpenRouterTests } from './openrouter.suite';

runContractTests();
await runServerCoreTests();
await runMeteringTests();
await runOpenRouterTests();

report();
