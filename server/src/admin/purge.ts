/**
 * `whim-admin purge` (durable-server-stores): the server's four retention purges, run once. On
 * Cloud Run an idle server has no instance, so its boot and hourly purges stop; an hourly Cloud
 * Scheduler trigger runs this as a Cloud Run Job instead (`deploy/cloudrun/deploy.sh`).
 *
 * Each purge cuts where the server's scheduled one does (`reportPurgeCutoff`, `usagePurgeCutoffs`,
 * `WaitlistStore.purge`), from the same configuration. A failed purge does not stop the others; the
 * command prints one line per store and exits 1 when any failed.
 *
 * Cloud Logging records a plain text line at DEFAULT severity, so a failing run also prints one
 * structured line, `{"severity":"ERROR","message":"purge failed","detail":…}`: the line the
 * purge-failure alert (`deploy/monitoring/policy-purge-failed.json`, `severity>=ERROR`) matches.
 * `main.ts` prints the same line when the command fails before or around the purges.
 */
import type { ServerConfig } from '../config';
import { reportPurgeCutoff } from '../reports/store';
import type { OpenedStores } from '../stores';
import { usagePurgeCutoffs } from '../usage-store';
import type { WaitlistPurgeCounts } from '../waitlist/store';
import type { AdminCliResult } from './cli';

/** The configuration the purges read. */
export type PurgeConfig = Pick<ServerConfig, 'reportRetentionDays' | 'ledgerRetentionDays' | 'usageIdleDays' | 'now'>;

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The one structured line a failed purge run prints, which Cloud Logging records at ERROR. */
export function purgeFailedLine(detail: string): string {
  return `${JSON.stringify({ severity: 'ERROR', message: 'purge failed', detail })}\n`;
}

/** The waitlist line's count: rows and removal fingerprints together, then each. */
function waitlistCount({ rows, fingerprints }: WaitlistPurgeCounts): string {
  return `${rows + fingerprints} purged (rows ${rows}, fingerprints ${fingerprints})`;
}

/** What a purge run printed, and why it failed (empty when it did not). */
interface PurgeOutcome {
  readonly output: string;
  readonly failures: string[];
}

/** The run's result: its output, then (when anything failed) the one structured ERROR line. */
function resultOf({ output, failures }: PurgeOutcome): AdminCliResult {
  if (failures.length === 0) return { exitCode: 0, output };
  return { exitCode: 1, output: output + purgeFailedLine(failures.join('; ')) };
}

/** Runs the four purges at once, as the server's scheduled purges do; one failing does not stop
 *  the others, and the lines keep the order reports, ledger, usage, waitlist. */
async function purgeAll(argv: readonly string[], stores: Pick<OpenedStores, 'reports' | 'usage' | 'waitlist'>, config: PurgeConfig): Promise<PurgeOutcome> {
  if (argv.length > 0) return { output: 'purge takes no arguments\n', failures: ['purge takes no arguments'] };
  const now = config.now();
  const { ledgerBeforeUtcDay, idleBeforeUtcDay } = usagePurgeCutoffs(now, config);
  const count = (purged: number): string => `${purged} purged`;
  const purges: ReadonlyArray<readonly [string, () => Promise<string>]> = [
    ['reports', async () => count(await stores.reports.purgeOlderThan(reportPurgeCutoff(now, config.reportRetentionDays)))],
    ['ledger', async () => count(await stores.usage.purgeLedger(ledgerBeforeUtcDay))],
    ['usage', async () => count(await stores.usage.purgeIdleUsage(idleBeforeUtcDay))],
    ['waitlist', async () => waitlistCount(await stores.waitlist.purge(now))],
  ];
  const settled = await Promise.allSettled(purges.map(([, purge]) => Promise.resolve().then(purge)));
  const lines: string[] = [];
  const failures: string[] = [];
  settled.forEach((outcome, i) => {
    const store = purges[i]![0];
    if (outcome.status === 'fulfilled') {
      lines.push(`${store}: ${outcome.value}`);
    } else {
      failures.push(`${store}: ${messageOf(outcome.reason)}`);
      lines.push(`${store}: failed: ${messageOf(outcome.reason)}`);
    }
  });
  return { output: lines.join('\n') + '\n', failures };
}

/** Runs the purges against `stores` and prints `<store>: N purged` (or `<store>: failed: <why>`)
 *  for reports, ledger, usage and waitlist, in that order. The waitlist line also splits its count
 *  into rows and removal fingerprints: `waitlist: N purged (rows R, fingerprints F)`. */
export async function runPurge(
  argv: readonly string[],
  stores: Pick<OpenedStores, 'reports' | 'usage' | 'waitlist'>,
  config: PurgeConfig,
): Promise<AdminCliResult> {
  return resultOf(await purgeAll(argv, stores, config));
}

/** `runPurge`, then closes `stores`, also when the run itself throws. A close that fails is one more
 *  failure: the one ERROR line names it after the purges' own, so it never hides which store failed. */
export async function runPurgeThenClose(argv: readonly string[], stores: Pick<OpenedStores, 'reports' | 'usage' | 'waitlist' | 'close'>, config: PurgeConfig): Promise<AdminCliResult> {
  const outcome = await purgeAll(argv, stores, config).catch((err: unknown): PurgeOutcome => ({ output: '', failures: [messageOf(err)] }));
  try {
    await stores.close();
  } catch (err) {
    outcome.failures.push(`close: ${messageOf(err)}`);
  }
  return resultOf(outcome);
}
