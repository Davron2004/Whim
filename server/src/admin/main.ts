/**
 * The operator command's real process entry (design D11): loads config, opens the stores on the
 * configured backend (`openStores`), runs `runAdminCli` against `process.argv`, writes its output and exit
 * code. Runs inside the production container as `node server/whim-admin.mjs …` (or in dev as
 * `node server/admin.mjs …`, which bundles this file like `server/dev.mjs` bundles `main.ts`) —
 * never imported by test code, so `runAdminCli` (the testable half) stays free of this file's
 * environment/filesystem side effects.
 *
 * `import-sqlite` opens no store: it writes into the configured Firestore database directly
 * (`runImportSqlite`, durable-server-stores D7).
 */
import { loadServerConfig } from '../config';
import { openStores } from '../stores';
import { runAdminCli, type AdminCliResult } from './cli';
import { runImportSqlite } from './import-sqlite';

const config = loadServerConfig(process.env);
const argv = process.argv.slice(2);

async function runStoreCommand(): Promise<AdminCliResult> {
  const stores = await openStores(config);
  return runAdminCli(argv, {
    reportStore: stores.reports,
    usageStore: stores.usage,
    now: config.now,
    reportRetentionDays: config.reportRetentionDays,
  }).finally(() => stores.close());
}

const result = argv[0] === 'import-sqlite' ? await runImportSqlite(argv.slice(1), config) : await runStoreCommand();

process.stdout.write(result.output);
process.exitCode = result.exitCode;
