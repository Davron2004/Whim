/**
 * The waitlist operator command (beta-waitlist design D8; spec "Retention and operator access").
 * The list is reachable only here, on the server host, never through an HTTP route.
 *
 *   export [--platform ios|android|other] [--updates-ok]   CSV on stdout
 *   remove <email>                                         deletes that person, in any casing
 *
 * `runWaitlistCli` is the testable half: arguments and a store in, output and an exit code out.
 * `waitlistMain` opens `waitlist.db` under `WHIM_DATA_DIR` around it. Run as a process — `node
 * server/waitlist.mjs …` in dev, which bundles this file, or `node server/whim-waitlist.mjs …` in the
 * production image, which `server/build.mjs` bundles from it — it writes the result and sets the
 * exit code; imported, it does nothing on its own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadServerConfig } from '../config';
import { isWaitlistPlatform, NodeSqliteWaitlistStore, type WaitlistFilter, type WaitlistRow, type WaitlistStore } from './store';

export interface WaitlistCliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export const WAITLIST_USAGE =
  'usage: waitlist export [--platform ios|android|other] [--updates-ok]\n       waitlist remove <email>\n';

/** The export's columns, in order. */
export const CSV_COLUMNS = ['email', 'platform', 'updates_opt_out', 'created_at', 'updated_at'] as const;

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function csvLine(row: WaitlistRow): string {
  return [row.email, row.platform, String(row.updatesOptOut), new Date(row.createdAt).toISOString(), new Date(row.updatedAt).toISOString()]
    .map(csvCell)
    .join(',');
}

function usageError(problem: string): WaitlistCliResult {
  return { stdout: '', stderr: `waitlist: ${problem}\n${WAITLIST_USAGE}`, exitCode: 2 };
}

function exportRows(args: readonly string[], store: WaitlistStore): WaitlistCliResult {
  let filter: WaitlistFilter = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--updates-ok') {
      filter = { ...filter, updatesOk: true };
    } else if (arg === '--platform') {
      const platform = args[i + 1] ?? '';
      if (!isWaitlistPlatform(platform)) return usageError(`--platform must be ios, android or other, got ${JSON.stringify(platform)}`);
      filter = { ...filter, platform };
      i++;
    } else {
      return usageError(`unknown export option ${JSON.stringify(arg)}`);
    }
  }
  const lines = [CSV_COLUMNS.join(','), ...store.export(filter).map(csvLine)];
  return { stdout: `${lines.join('\n')}\n`, stderr: '', exitCode: 0 };
}

function removeRow(args: readonly string[], store: WaitlistStore): WaitlistCliResult {
  const [email, ...extra] = args;
  if (email === undefined || email.trim() === '' || extra.length > 0) return usageError('remove takes exactly one email');
  return store.remove(email)
    ? { stdout: `removed ${email.trim().toLowerCase()}\n`, stderr: '', exitCode: 0 }
    : { stdout: '', stderr: `waitlist: ${email.trim().toLowerCase()} is not on the list\n`, exitCode: 1 };
}

export function runWaitlistCli(argv: readonly string[], store: WaitlistStore): WaitlistCliResult {
  const [command, ...args] = argv;
  if (command === 'export') return exportRows(args, store);
  if (command === 'remove') return removeRow(args, store);
  return usageError(command === undefined ? 'no command given' : `unknown command ${JSON.stringify(command)}`);
}

/** Opens `waitlist.db` under `env`'s `WHIM_DATA_DIR`, runs the command, and closes it. */
export function waitlistMain(argv: readonly string[], env: NodeJS.ProcessEnv): WaitlistCliResult {
  const store = new NodeSqliteWaitlistStore(path.join(loadServerConfig(env).dataDir, 'waitlist.db'));
  try {
    return runWaitlistCli(argv, store);
  } finally {
    store.close();
  }
}

function invokedAsProcess(): boolean {
  const entry = process.argv[1];
  if (entry === undefined || !fs.existsSync(entry)) return false;
  return pathToFileURL(fs.realpathSync(entry)).href === import.meta.url;
}

if (invokedAsProcess()) {
  const result = waitlistMain(process.argv.slice(2), process.env);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
