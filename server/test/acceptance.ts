/**
 * Harness server + contract acceptance suite (harness-server-skeleton). Implements server/test/SPEC.md.
 * Run via `npm run server:test` (server/test/run.mjs type-checks both workspaces, bundles this with
 * esbuild, and runs it under Node). Each area lives in its own *.test.ts module; this file sequences
 * them and reports. Sections are added as chains lead (contract → server core → metering → wrapper).
 */
import { report } from './harness';
import { runContractTests } from './contract.test';
import { runServerCoreTests } from './server-core.test';
import { runMeteringTests } from './metering.test';
import { runOpenRouterTests } from './openrouter.test';

runContractTests();
await runServerCoreTests();
await runMeteringTests();
await runOpenRouterTests();

report();
