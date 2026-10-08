/**
 * `whim-admin purge` (durable-server-stores): the server's four retention purges, run once. On
 * Cloud Run an idle server has no instance, so its boot and hourly purges stop; an hourly Cloud
 * Scheduler trigger runs this as a Cloud Run Job instead (`deploy/cloudrun/deploy.sh`).
 *
 * Each purge cuts where the server's scheduled one does (`reportPurgeCutoff`, `usagePurgeCutoffs`,
 * `WaitlistStore.purge`), from the same configuration. A failed purge does not stop the others; the
 * command prints one line per store and exits 1 when any failed.
 */
import type { ServerConfig } from '../config';
import { reportPurgeCutoff } from '../reports/store';
import type { OpenedStores } from '../stores';
import { usagePurgeCutoffs } from '../usage-store';
import type { AdminCliResult } from './cli';

/** The configuration the purges read. */
export type PurgeConfig = Pick<ServerConfig, 'reportRetentionDays' | 'ledgerRetentionDays' | 'usageIdleDays' | 'now'>;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Runs the purges against `stores` and prints `<store>: N purged` (or `<store>: failed: <why>`)
 *  for reports, ledger, usage and waitlist, in that order. */
export async function runPurge(
  argv: readonly string[],
  stores: Pick<OpenedStores, 'reports' | 'usage' | 'waitlist'>,
  config: PurgeConfig,
): Promise<AdminCliResult> {
  if (argv.length > 0) return { exitCode: 1, output: 'purge takes no arguments\n' };
  const now = config.now();
  const { ledgerBeforeUtcDay, idleBeforeUtcDay } = usagePurgeCutoffs(now, config);
  const purges: ReadonlyArray<readonly [string, () => Promise<number>]> = [
    ['reports', () => stores.reports.purgeOlderThan(reportPurgeCutoff(now, config.reportRetentionDays))],
    ['ledger', () => stores.usage.purgeLedger(ledgerBeforeUtcDay)],
    ['usage', () => stores.usage.purgeIdleUsage(idleBeforeUtcDay)],
    ['waitlist', () => stores.waitlist.purge(now)],
  ];
  const lines: string[] = [];
  let failed = false;
  for (const [store, purge] of purges) {
    try {
      lines.push(`${store}: ${await purge()} purged`);
    } catch (err) {
      failed = true;
      lines.push(`${store}: failed: ${messageOf(err)}`);
    }
  }
  return { exitCode: failed ? 1 : 0, output: lines.join('\n') + '\n' };
}
