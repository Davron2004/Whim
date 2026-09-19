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
import { runPromptsTests } from './prompts.suite';
import { runMachineTests } from './machine.suite';
import { runSourceBlockTests } from './source-block.suite';
import { runStagesTests } from './stages.suite';
import { runWireV2Tests } from './wire-v2.suite';
import { runLoggingTests } from './logging.suite';
import { runConfigTests } from './config.suite';
import { runLedgerTests } from './ledger.suite';
import { runResolverTests } from './resolver.suite';
import { runAdmissionTests } from './admission.suite';
import { runPolicyTests } from './policy.suite';
import { runReportsTests } from './reports.suite';
import { runAdminTests } from './admin.suite';
import { runRoutesUnaryTests } from './routes-unary.suite';
import { runRoutesGenerateTests } from './routes-generate.suite';
import { runDisconnectTests } from './disconnect.suite';
import { runProdBuildTests } from './prod-build.suite';
import { runDeployConfigTests } from './deploy-config.suite';

runContractTests();
await runServerCoreTests();
await runMeteringTests();
await runOpenRouterTests();
await runPromptsTests();
await runMachineTests();
runSourceBlockTests();
await runStagesTests();
await runWireV2Tests();
await runLoggingTests();
runConfigTests();
await runLedgerTests();
await runResolverTests();
await runAdmissionTests();
await runPolicyTests();
await runReportsTests();
await runAdminTests();
await runRoutesUnaryTests();
await runRoutesGenerateTests();
await runDisconnectTests();
await runProdBuildTests();
await runDeployConfigTests();

report();
