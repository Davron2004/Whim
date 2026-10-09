/**
 * The waitlist operator command (beta-waitlist design D8; spec "Retention and operator access").
 * The list is reachable only here, on the server host, never through an HTTP route.
 *
 *   export [--platform ios|android|other] [--updates-ok]   CSV on stdout
 *   remove <email>                                         deletes that person, in any casing, and
 *                                                          keeps the removal fingerprint
 *   updates <email> on|off                                 news consent on (a written request) or off
 *   restore <email>                                        lifts a removal fingerprint
 *
 * `--updates-ok` lists only the rows with news consent (waitlist-hardening D2). Every CSV cell a
 * spreadsheet would read as a formula gets a leading `'` (D7): rows can reach the store without the
 * route's email rule, by import or a later validator. `updates <email> on` is the only way news
 * consent comes back after a withdrawal; the runbook allows it only on that person's written request.
 *
 * `runWaitlistCli` is the testable half: arguments and a store in, output and an exit code out.
 * `waitlistMain` opens the stores on the configured backend (`openStores`) around it. Run as a process — `node
 * server/waitlist.mjs …` in dev, which bundles this file, or `node server/whim-waitlist.mjs …` in the
 * production image, which `server/build.mjs` bundles from it — it writes the result and sets the
 * exit code; imported, it does nothing on its own.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadServerConfig, ServerConfigError, type ServerConfig } from '../config';
import { openStores } from '../stores';
import { isWaitlistPlatform, type WaitlistFilter, type WaitlistRow, type WaitlistStore } from './store';

export interface WaitlistCliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export const WAITLIST_USAGE =
  'usage: waitlist export [--platform ios|android|other] [--updates-ok]\n' +
  '       waitlist remove <email>\n' +
  '       waitlist updates <email> on|off\n' +
  '       waitlist restore <email>\n';

/** The export's columns, in order. */
export const CSV_COLUMNS = ['email', 'platform', 'updates_opt_in', 'updates_consent_at', 'notice_id', 'created_at', 'updated_at'] as const;

/** A cell starting with one of these is read as a formula (or a formula's lead) by a spreadsheet. */
const FORMULA_LEAD = /^[=+\-@|%\t\r]/;

function csvCell(value: string): string {
  const safe = FORMULA_LEAD.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function isoOrEmpty(ms: number | null): string {
  return ms === null ? '' : new Date(ms).toISOString();
}

function csvLine(row: WaitlistRow): string {
  return [
    row.email,
    row.platform,
    String(row.updatesOptIn),
    isoOrEmpty(row.updatesConsentAt),
    row.noticeId,
    new Date(row.createdAt).toISOString(),
    new Date(row.updatedAt).toISOString(),
  ]
    .map(csvCell)
    .join(',');
}

function usageError(problem: string): WaitlistCliResult {
  return { stdout: '', stderr: `waitlist: ${problem}\n${WAITLIST_USAGE}`, exitCode: 2 };
}

async function exportRows(args: readonly string[], store: WaitlistStore): Promise<WaitlistCliResult> {
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
  const lines = [CSV_COLUMNS.join(','), ...(await store.export(filter)).map(csvLine)];
  return { stdout: `${lines.join('\n')}\n`, stderr: '', exitCode: 0 };
}

/** The one email a command takes, normalized for its output, or `undefined` when the arguments are
 *  not exactly one non-blank email. */
function oneEmail(args: readonly string[]): string | undefined {
  const [email, ...extra] = args;
  return email === undefined || email.trim() === '' || extra.length > 0 ? undefined : email;
}

function shown(email: string): string {
  return email.trim().toLowerCase();
}

async function removeRow(args: readonly string[], store: WaitlistStore, now: () => number): Promise<WaitlistCliResult> {
  const email = oneEmail(args);
  if (email === undefined) return usageError('remove takes exactly one email');
  const existed = await store.remove(email, now());
  const what = existed ? `removed ${shown(email)}` : `${shown(email)} was not on the list`;
  return { stdout: `${what}; its fingerprint is kept, so it cannot sign up again\n`, stderr: '', exitCode: 0 };
}

async function setUpdates(args: readonly string[], store: WaitlistStore, now: () => number): Promise<WaitlistCliResult> {
  const [email, state, ...extra] = args;
  if (email === undefined || email.trim() === '' || (state !== 'on' && state !== 'off') || extra.length > 0) {
    return usageError('updates takes one email and on or off');
  }
  return (await store.setUpdates(email, state === 'on', now()))
    ? { stdout: `news consent ${state} for ${shown(email)}\n`, stderr: '', exitCode: 0 }
    : { stdout: '', stderr: `waitlist: ${shown(email)} is not on the list\n`, exitCode: 1 };
}

async function restoreFingerprint(args: readonly string[], store: WaitlistStore): Promise<WaitlistCliResult> {
  const email = oneEmail(args);
  if (email === undefined) return usageError('restore takes exactly one email');
  return (await store.restore(email))
    ? { stdout: `restored ${shown(email)}: it can sign up again\n`, stderr: '', exitCode: 0 }
    : { stdout: '', stderr: `waitlist: ${shown(email)} has no removal fingerprint\n`, exitCode: 1 };
}

/** `now` stamps a removal's fingerprint and an `updates` change. */
export async function runWaitlistCli(argv: readonly string[], store: WaitlistStore, now: () => number = Date.now): Promise<WaitlistCliResult> {
  const [command, ...args] = argv;
  if (command === 'export') return exportRows(args, store);
  if (command === 'remove') return removeRow(args, store, now);
  if (command === 'updates') return setUpdates(args, store, now);
  if (command === 'restore') return restoreFingerprint(args, store);
  return usageError(command === undefined ? 'no command given' : `unknown command ${JSON.stringify(command)}`);
}

/** Opens the stores `env` configures, runs the command against the waitlist, and closes them. A
 *  configuration the server would refuse (on the `firestore` backend, a missing
 *  `WHIM_WAITLIST_FINGERPRINT_KEY`) exits 1 naming the variable, never echoing its value. */
export async function waitlistMain(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<WaitlistCliResult> {
  let config: ServerConfig;
  try {
    config = loadServerConfig(env);
  } catch (err) {
    if (!(err instanceof ServerConfigError)) throw err;
    return { stdout: '', stderr: `waitlist: ${err.message}\n`, exitCode: 1 };
  }
  const stores = await openStores(config);
  try {
    return await runWaitlistCli(argv, stores.waitlist);
  } finally {
    await stores.close();
  }
}

function invokedAsProcess(): boolean {
  const entry = process.argv[1];
  if (entry === undefined || !fs.existsSync(entry)) return false;
  return pathToFileURL(fs.realpathSync(entry)).href === import.meta.url;
}

if (invokedAsProcess()) {
  const result = await waitlistMain(process.argv.slice(2), process.env);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
