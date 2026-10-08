/**
 * `whim-admin purge` acceptance (durable-server-stores: retention under scale-to-zero). Real SQLite
 * stores throughout. Covers: the four purges delete exactly the rows past their keep period and
 * print a count per store; a failed purge fails the command without stopping the others; and the
 * command cuts where the server's own boot purge does, under the same configuration, observed by
 * booting the server process (`node server/dev.mjs`) on one copy of a data directory and running
 * `node server/admin.mjs purge` on another.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { check, eq, section } from './harness';
import { TIMED_OUT, within } from './route-doubles';
import { loadServerConfig } from '../src/config';
import { openStores, type OpenedStores } from '../src/stores';
import { runPurge } from '../src/admin/purge';

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const DEVICE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function tempDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `whim-admin-purge-${label}-`));
}

async function openSqlite(dataDir: string, now: () => number): Promise<OpenedStores> {
  return openStores({ ...loadServerConfig({ WHIM_DATA_DIR: dataDir, WHIM_STORE_BACKEND: 'sqlite' }), now });
}

/** One row per store at each age in `ages` (days before `now`), labelled by its age. Usage rows
 *  are one device per age, last credited that many days back. */
async function seed(dataDir: string, now: number, ages: readonly number[]): Promise<void> {
  let clock = now;
  const stores = await openSqlite(dataDir, () => clock);
  try {
    for (const age of ages) {
      const at = now - age * DAY_MS;
      await stores.reports.insert({ deviceId: DEVICE, reason: 'broken', appName: `report-${age}d`, now: at });
      const admitted = await stores.usage.admit({ requestId: `ledger-${age}d`, deviceId: DEVICE, kind: 'generate', now: at, deviceLimit: 1000 });
      if (!admitted.ok) throw new Error(`setup: ledger row ${age}d was not admitted`);
      clock = at;
      await stores.usage.credit(`usage-${age}d`, { promptTokens: 1, completionTokens: 1, totalTokens: 2 });
      await stores.waitlist.upsert({ email: `waitlist-${age}d@example.com`, platform: 'android', updatesOptOut: false, noticeId: 'beta-1', now: at });
    }
  } finally {
    await stores.close();
  }
}

interface Remaining {
  reports: string[];
  ledger: string[];
  usage: string[];
  waitlist: string[];
}

/** The labels of every row still in the data directory, per store. */
async function remaining(dataDir: string, ages: readonly number[]): Promise<Remaining> {
  const stores = await openSqlite(dataDir, () => NOW);
  try {
    const usage: string[] = [];
    for (const age of ages) if ((await stores.usage.deviceRecords(`usage-${age}d`)).usage !== null) usage.push(`usage-${age}d`);
    return {
      reports: (await stores.reports.listByDevice(DEVICE)).map((r) => r.appName),
      ledger: (await stores.usage.deviceRecords(DEVICE)).ledger.map((r) => r.id),
      usage,
      waitlist: (await stores.waitlist.export()).map((r) => r.email.replace('@example.com', '')),
    };
  } finally {
    await stores.close();
  }
}

async function purgeDeletesExpiredRows(): Promise<void> {
  section('whim-admin purge: deletes the rows past each keep period, keeps the rest, prints a count per store');
  const dir = tempDir('direct');
  // Defaults: reports 90 days, ledger 90 days, idle usage 365 days, waitlist 730 days.
  const ages = [1, 89, 91, 364, 366, 729, 731];
  try {
    await seed(dir, NOW, ages);
    const config = { ...loadServerConfig({ WHIM_DATA_DIR: dir, WHIM_STORE_BACKEND: 'sqlite' }), now: () => NOW };
    const stores = await openSqlite(dir, () => NOW);
    const first = await runPurge([], stores, config).finally(() => stores.close());
    eq('the purge exits 0', first.exitCode, 0);
    eq('  ... printing how many rows each store deleted', first.output, 'reports: 5 purged\nledger: 5 purged\nusage: 3 purged\nwaitlist: 1 purged\n');
    eq('  ... leaving exactly the rows inside each keep period', await remaining(dir, ages), {
      reports: ['report-89d', 'report-1d'],
      ledger: ['ledger-89d', 'ledger-1d'],
      usage: ['usage-1d', 'usage-89d', 'usage-91d', 'usage-364d'],
      waitlist: ['waitlist-729d', 'waitlist-366d', 'waitlist-364d', 'waitlist-91d', 'waitlist-89d', 'waitlist-1d'],
    });

    const again = await openSqlite(dir, () => NOW);
    const second = await runPurge([], again, config).finally(() => again.close());
    eq('a second run deletes nothing', second.output, 'reports: 0 purged\nledger: 0 purged\nusage: 0 purged\nwaitlist: 0 purged\n');

    const extra = await openSqlite(dir, () => NOW);
    eq('an argument is a usage error', (await runPurge(['--all'], extra, config).finally(() => extra.close())).exitCode, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function failedPurgeFailsTheCommand(): Promise<void> {
  section('whim-admin purge: a failed purge exits 1, naming the store, and the others still run');
  const dir = tempDir('failure');
  try {
    await seed(dir, NOW, [1, 91]);
    const config = { ...loadServerConfig({ WHIM_DATA_DIR: dir, WHIM_STORE_BACKEND: 'sqlite' }), now: () => NOW };
    const stores = await openSqlite(dir, () => NOW);
    const failingUsage = new Proxy(stores.usage, {
      get: (target, property) => (property === 'purgeLedger' ? () => Promise.reject(new Error('database is locked')) : Reflect.get(target, property, target)),
    });
    const result = await runPurge([], { reports: stores.reports, usage: failingUsage, waitlist: stores.waitlist }, config).finally(() => stores.close());
    eq('the purge exits 1', result.exitCode, 1);
    eq('  ... naming the failed store and why, and counting the others', result.output, 'reports: 1 purged\nledger: failed: database is locked\nusage: 0 purged\nwaitlist: 0 purged\n');
    eq('  ... whose deletions landed', (await remaining(dir, [1, 91])).reports, ['report-1d']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A port nothing listens on right now. */
async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** The environment a child command sees: this process's, minus every WHIM_ setting, plus `env`. */
function childEnv(dataDir: string, env: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('WHIM_')));
  return { ...base, ...env, WHIM_DATA_DIR: dataDir, WHIM_STORE_BACKEND: 'sqlite' };
}

/** Boots the stub server as a process (`node server/dev.mjs`) on `dataDir`, waits until it
 *  listens, then stops it. Boot runs the scheduled purges before it listens, and SQLite purges
 *  finish inside the call that starts them. Returns why it failed, or `undefined`. */
async function bootAndStop(dataDir: string, env: Readonly<Record<string, string>>): Promise<string | undefined> {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(process.cwd(), 'server', 'dev.mjs')], {
    env: childEnv(dataDir, { ...env, WHIM_PIPELINE: 'stub', WHIM_SERVER_HOST: '127.0.0.1', WHIM_SERVER_PORT: String(port) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  const listening = new Promise<boolean>((resolve) => {
    const onData = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      if (output.includes('whim-server listening')) resolve(true);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', () => resolve(false));
  });
  const up = await within(listening, 60_000);
  child.kill('SIGTERM');
  if ((await within(exited, 30_000)) === TIMED_OUT) {
    child.kill('SIGKILL');
    return 'the server did not stop';
  }
  return up === true ? undefined : `the server did not start: ${output.slice(-2000)}`;
}

/** Runs `node server/admin.mjs purge` on `dataDir` with `env` and nothing else from the WHIM_ space. */
function adminPurge(dataDir: string, env: Readonly<Record<string, string>>): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [path.join(process.cwd(), 'server', 'admin.mjs'), 'purge'], {
    encoding: 'utf8',
    timeout: 60_000,
    env: childEnv(dataDir, env),
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function sameCutoffsAsTheServer(): Promise<void> {
  section('whim-admin purge: cuts where the server boot purge does, from the same configuration');
  const shortened = { WHIM_REPORT_RETENTION_DAYS: '30', WHIM_LEDGER_RETENTION_DAYS: '30', WHIM_USAGE_IDLE_DAYS: '180' };
  // Each age sits inside one setting's keep period and outside the other's.
  const ages = [1, 45, 200, 731];
  const now = Date.now();
  const dirs = { serverShort: tempDir('server-short'), adminShort: tempDir('admin-short'), serverDefault: tempDir('server-default'), adminDefault: tempDir('admin-default') };
  try {
    for (const dir of Object.values(dirs)) await seed(dir, now, ages);

    eq('the server boots with shortened keep periods', await bootAndStop(dirs.serverShort, shortened), undefined);
    const shortRun = adminPurge(dirs.adminShort, shortened);
    eq('node server/admin.mjs purge exits 0 with the same settings', shortRun.status, 0);
    eq('  ... printing its counts', shortRun.stdout, 'reports: 3 purged\nledger: 3 purged\nusage: 2 purged\nwaitlist: 1 purged\n');
    const serverShort = await remaining(dirs.serverShort, ages);
    const adminShort = await remaining(dirs.adminShort, ages);
    eq('  ... and leaves exactly what the server boot purge left', adminShort, serverShort);
    eq('  ... which is only the rows inside the shortened periods', adminShort, {
      reports: ['report-1d'],
      ledger: ['ledger-1d'],
      usage: ['usage-1d', 'usage-45d'],
      waitlist: ['waitlist-200d', 'waitlist-45d', 'waitlist-1d'],
    });

    eq('the server boots with the default keep periods', await bootAndStop(dirs.serverDefault, {}), undefined);
    const defaultRun = adminPurge(dirs.adminDefault, {});
    eq('node server/admin.mjs purge exits 0 with the defaults', defaultRun.status, 0);
    const serverDefault = await remaining(dirs.serverDefault, ages);
    eq('  ... and leaves exactly what the server boot purge left', await remaining(dirs.adminDefault, ages), serverDefault);
    check('  ... which keeps the rows the shortened periods purged', serverDefault.reports.includes('report-45d') && serverDefault.usage.includes('usage-200d'), JSON.stringify(serverDefault));
  } finally {
    for (const dir of Object.values(dirs)) fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function runAdminPurgeTests(): Promise<void> {
  await purgeDeletesExpiredRows();
  await failedPurgeFailsTheCommand();
  await sameCutoffsAsTheServer();
}
