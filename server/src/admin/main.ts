/**
 * The operator command's real process entry (design D11): loads config, opens the stores on the
 * configured backend (`openStores`), runs `runAdminCli` against `process.argv`, writes its output and exit
 * code. Runs inside the production container as `node server/whim-admin.mjs …` (or in dev as
 * `node server/admin.mjs …`, which bundles this file like `server/dev.mjs` bundles `main.ts`) —
 * never imported by test code, so `runAdminCli` (the testable half) stays free of this file's
 * environment/filesystem side effects.
 */
import { loadServerConfig } from '../config';
import { openStores } from '../stores';
import { runAdminCli } from './cli';

const config = loadServerConfig(process.env);
const stores = await openStores(config);

const result = await runAdminCli(process.argv.slice(2), {
  reportStore: stores.reports,
  usageStore: stores.usage,
  now: config.now,
  reportRetentionDays: config.reportRetentionDays,
}).finally(() => stores.close());

process.stdout.write(result.output);
process.exitCode = result.exitCode;
