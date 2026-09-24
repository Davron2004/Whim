/**
 * The operator command's pure subcommand logic (public-generation-server chain-5, design D11).
 *
 * `runAdminCli` takes its dependencies as data — no `process.env`/`process.stdout` reads, no
 * store construction — so it is safely importable from tests with in-memory stores and a fixed
 * clock. The real process entry (env, real stores, actual stdout/exit code) is
 * `server/src/admin/main.ts`; keeping that composition OUT of this module means importing
 * `runAdminCli` never opens a database file or touches the filesystem.
 *
 * Grammar (specs/content-reports "The operator can list and read reports from the VM",
 * specs/server-admission-control "The operator can read cost per generation, per device and per
 * day"):
 *   reports list [--since N] [--limit N] [--json]
 *   reports show <id> [--json]
 *   reports purge
 *   usage [--days N] [--top N] [--json]
 *   device export <id>
 *   device delete <id>
 *
 * `list`/`show`/`usage`/`device export` never call a mutating store method — only `purge` and
 * `device delete` do. Device ids and the records they key appear only in this module's returned
 * text (the operator's own terminal), never through `log`.
 *
 * `device export` prints one JSON object holding every server record keyed by that device id, and
 * `device delete` removes exactly those and prints how many of each went (specs/device-records "The
 * operator can export and delete one phone ID's records"). Both succeed, empty, for an unknown id. A
 * record type later keyed by device id joins both here.
 */
import type { ReportRecordKeeping, ReportRow, ReportStore } from '../reports/store';
import type { DeviceUsageRecords, UsageRecordKeeping, UsageStore } from '../usage-store';

export interface AdminCliDeps {
  reportStore: ReportStore & ReportRecordKeeping;
  usageStore: UsageStore & UsageRecordKeeping;
  /** Injected clock (ms since epoch) — drives `--since`/`--days` windows and `reports purge`. */
  now: () => number;
  /** WHIM_REPORT_RETENTION_DAYS — what `reports purge` applies "now" (spec). */
  reportRetentionDays: number;
}

export interface AdminCliResult {
  /** 0 on success, 1 on a usage error or an unknown report id. */
  exitCode: number;
  /** Everything the command prints, newline-terminated. */
  output: string;
}

const USAGE_TEXT =
  'Usage:\n' +
  '  reports list [--since N] [--limit N] [--json]\n' +
  '  reports show <id> [--json]\n' +
  '  reports purge\n' +
  '  usage [--days N] [--top N] [--json]\n' +
  '  device export <id>\n' +
  '  device delete <id>\n';

/** Everything `device export` prints: every server record keyed by one device id. */
export interface DeviceExport {
  deviceId: string;
  reports: ReportRow[];
  ledger: DeviceUsageRecords['ledger'];
  usage: DeviceUsageRecords['usage'];
}

/** What `device delete` prints: how many records of each kind it removed. */
export interface DeviceDeletion {
  deviceId: string;
  removed: { reports: number; ledger: number; usage: number };
}

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | true>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function flagNumber(flags: Record<string, string | true>, name: string, fallback: number): number {
  const raw = flags[name];
  if (raw === undefined || raw === true) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export async function runAdminCli(argv: readonly string[], deps: AdminCliDeps): Promise<AdminCliResult> {
  const { positional, flags } = parseArgs(argv);
  const json = flags.json === true;
  const [group, sub, ...rest] = positional;

  if (group === 'reports' && sub === 'list') return listReports(deps, flags, json);
  if (group === 'reports' && sub === 'show') return showReport(deps, rest[0], json);
  if (group === 'reports' && sub === 'purge') return purgeReports(deps);
  if (group === 'usage') return usageSummary(deps, flags, json);
  if (group === 'device' && sub === 'export') return exportDevice(deps, rest[0]);
  if (group === 'device' && sub === 'delete') return deleteDevice(deps, rest[0]);

  return { exitCode: 1, output: USAGE_TEXT };
}

async function exportDevice(deps: AdminCliDeps, deviceId: string | undefined): Promise<AdminCliResult> {
  if (!deviceId) return { exitCode: 1, output: 'device export requires <id>\n' };
  const reports = await deps.reportStore.listByDevice(deviceId);
  const { ledger, usage } = await deps.usageStore.deviceRecords(deviceId);
  const exported: DeviceExport = { deviceId, reports, ledger, usage };
  return { exitCode: 0, output: JSON.stringify(exported) + '\n' };
}

async function deleteDevice(deps: AdminCliDeps, deviceId: string | undefined): Promise<AdminCliResult> {
  if (!deviceId) return { exitCode: 1, output: 'device delete requires <id>\n' };
  const reports = await deps.reportStore.deleteByDevice(deviceId);
  const { ledger, usage } = await deps.usageStore.deleteDeviceRecords(deviceId);
  const deletion: DeviceDeletion = { deviceId, removed: { reports, ledger, usage } };
  return { exitCode: 0, output: JSON.stringify(deletion) + '\n' };
}

async function listReports(
  deps: AdminCliDeps,
  flags: Record<string, string | true>,
  json: boolean,
): Promise<AdminCliResult> {
  const sinceDays = flags.since !== undefined ? flagNumber(flags, 'since', 0) : undefined;
  const limit = flagNumber(flags, 'limit', 50);
  const items = await deps.reportStore.list({ now: deps.now(), sinceDays, limit });

  if (json) return { exitCode: 0, output: JSON.stringify(items) + '\n' };

  if (items.length === 0) return { exitCode: 0, output: '(no reports)\n' };
  const lines = items.map(
    (r) =>
      `${r.reportId}  ${new Date(r.receivedAt).toISOString()}  reason=${r.reason}  appName=${r.appName || '-'}  note=${r.note || '-'}  promptBytes=${r.promptBytes}  sourceBytes=${r.sourceBytes}`,
  );
  return { exitCode: 0, output: lines.join('\n') + '\n' };
}

async function showReport(deps: AdminCliDeps, reportId: string | undefined, json: boolean): Promise<AdminCliResult> {
  if (!reportId) return { exitCode: 1, output: 'reports show requires <id>\n' };
  const row = await deps.reportStore.get(reportId);
  if (!row) return { exitCode: 1, output: `no report with id ${reportId}\n` };

  if (json) return { exitCode: 0, output: JSON.stringify(row) + '\n' };

  const lines = [
    `id: ${row.reportId}`,
    `receivedAt: ${new Date(row.receivedAt).toISOString()}`,
    `deviceId: ${row.deviceId}`,
    `reason: ${row.reason}`,
    `appName: ${row.appName || '-'}`,
    `note: ${row.note || '-'}`,
    `prompt: ${row.prompt || '-'}`,
    `source: ${row.source || '-'}`,
  ];
  return { exitCode: 0, output: lines.join('\n') + '\n' };
}

async function purgeReports(deps: AdminCliDeps): Promise<AdminCliResult> {
  const cutoffMs = deps.now() - deps.reportRetentionDays * 86_400_000;
  const deleted = await deps.reportStore.purgeOlderThan(cutoffMs);
  return { exitCode: 0, output: `purged ${deleted} report(s)\n` };
}

async function usageSummary(
  deps: AdminCliDeps,
  flags: Record<string, string | true>,
  json: boolean,
): Promise<AdminCliResult> {
  const days = flagNumber(flags, 'days', 7);
  const top = flagNumber(flags, 'top', 10);
  const summary = await deps.usageStore.summary({ days, top, now: deps.now() });

  if (json) return { exitCode: 0, output: JSON.stringify(summary) + '\n' };

  const lines: string[] = [];
  for (const day of summary.days) {
    const counts = Object.entries(day.countByKind).map(([k, v]) => `${k}=${v}`).join(' ') || '(none)';
    const costs =
      Object.entries(day.costUsdByKind).map(([k, v]) => `${k}=$${(v ?? 0).toFixed(4)}`).join(' ') || '(none)';
    lines.push(`${day.utcDay}  counts: ${counts}  cost: ${costs}`);
  }
  lines.push('', 'Top devices by cost:');
  for (const d of summary.topDevicesByCost) lines.push(`  ${d.deviceId}  $${d.costUsd.toFixed(4)}`);
  const g = summary.generationStats;
  lines.push(
    '',
    `Generation cost stats: count=${g.count} mean=$${g.meanCostUsd.toFixed(4)} median=$${g.medianCostUsd.toFixed(4)} p95=$${g.p95CostUsd.toFixed(4)} max=$${g.maxCostUsd.toFixed(4)} unresolved=${g.unresolvedCount}`,
  );
  const reasons = Object.entries(summary.failureReasonCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, count]) => `${reason}=${count}`)
    .join(' ');
  lines.push(`Failure reasons: ${reasons || '(none)'}`);
  return { exitCode: 0, output: lines.join('\n') + '\n' };
}
