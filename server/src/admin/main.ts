/**
 * The operator command's real process entry (design D11): loads config, opens both stores
 * against `WHIM_DATA_DIR`, runs `runAdminCli` against `process.argv`, writes its output and exit
 * code. Runs inside the production container as `node server/whim-admin.mjs …` (or in dev as
 * `node server/admin.mjs …`, which bundles this file like `server/dev.mjs` bundles `main.ts`) —
 * never imported by test code, so `runAdminCli` (the testable half) stays free of this file's
 * environment/filesystem side effects.
 */
import path from 'node:path';
import { loadServerConfig } from '../config';
import { NodeSqliteReportStore } from '../reports/store';
import { NodeSqliteUsageStore } from '../usage-store';
import { runAdminCli } from './cli';

const config = loadServerConfig(process.env);
const reportStore = new NodeSqliteReportStore(path.join(config.dataDir, 'reports.db'));
const usageStore = new NodeSqliteUsageStore(path.join(config.dataDir, 'usage.db'), { now: config.now, usageIdleDays: config.usageIdleDays });

const result = await runAdminCli(process.argv.slice(2), {
  reportStore,
  usageStore,
  now: config.now,
  reportRetentionDays: config.reportRetentionDays,
});

process.stdout.write(result.output);
process.exitCode = result.exitCode;
