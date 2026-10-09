/**
 * The operator command's real process entry (design D11): loads config, opens the stores on the
 * configured backend (`openStores`), runs `runAdminCli` against `process.argv`, writes its output and exit
 * code. Runs inside the production container as `node server/whim-admin.mjs …` (or in dev as
 * `node server/admin.mjs …`, which bundles this file like `server/dev.mjs` bundles `main.ts`) —
 * never imported by test code, so `runAdminCli` (the testable half) stays free of this file's
 * environment/filesystem side effects.
 *
 * `import-sqlite` opens no store: it writes into the configured Firestore database directly
 * (`runImportSqlite`, durable-server-stores D7). `purge` runs the server's retention purges once
 * (`runPurgeThenClose`, which also reports a failed close) on the opened stores, like every other
 * subcommand. When `purge` fails outright (the configuration, opening the stores), it prints the
 * same structured ERROR line a failed purge does (`purgeFailedLine`) and exits 1, so the
 * purge-failure alert sees it.
 */
import { loadServerConfig, type ServerConfig } from '../config';
import { openStores } from '../stores';
import { runAdminCli, type AdminCliResult } from './cli';
import { runImportSqlite } from './import-sqlite';
import { messageOf, purgeFailedLine, runPurgeThenClose } from './purge';

const argv = process.argv.slice(2);

async function runStoreCommand(config: ServerConfig): Promise<AdminCliResult> {
  const stores = await openStores(config);
  if (argv[0] === 'purge') return runPurgeThenClose(argv.slice(1), stores, config);
  return runAdminCli(argv, {
    reportStore: stores.reports,
    usageStore: stores.usage,
    now: config.now,
    reportRetentionDays: config.reportRetentionDays,
  }).finally(() => stores.close());
}

async function run(): Promise<AdminCliResult> {
  const config = loadServerConfig(process.env);
  return argv[0] === 'import-sqlite' ? runImportSqlite(argv.slice(1), config) : runStoreCommand(config);
}

async function runOrReportPurgeFailure(): Promise<AdminCliResult> {
  if (argv[0] !== 'purge') return run();
  try {
    return await run();
  } catch (err) {
    process.stderr.write(`${err instanceof Error && err.stack ? err.stack : messageOf(err)}\n`);
    return { exitCode: 1, output: purgeFailedLine(messageOf(err)) };
  }
}

const result = await runOrReportPurgeFailure();

process.stdout.write(result.output);
process.exitCode = result.exitCode;
