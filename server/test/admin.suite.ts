/**
 * Operator command acceptance (public-generation-server chain-5). Scaffolded here by chain-1
 * (task 2.5, pre-registered in acceptance.ts); chain-5 fills it in — this module is
 * chain-5's alone to edit.
 *
 * Covers specs/content-reports "The operator can list and read reports from the VM" and
 * specs/server-admission-control "The operator can read cost per generation, per device and per
 * day" at the CLI layer (design D11). Exercises `runAdminCli` directly (in-memory stores, a fixed
 * clock) plus one real-sqlite read-while-writing proof per store.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { check, eq, section } from './harness';
import { runAdminCli, type AdminCliDeps } from '../src/admin/cli';
import { InMemoryReportStore, NodeSqliteReportStore } from '../src/reports/store';
import { InMemoryUsageStore, NodeSqliteUsageStore } from '../src/usage-store';

const DEVICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEVICE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0, 0);

function tmpDbPath(label: string): string {
  return path.join(os.tmpdir(), `whim-admin-test-${label}-${process.pid}-${Date.now()}.db`);
}

function baseDeps(overrides: Partial<AdminCliDeps> = {}): AdminCliDeps {
  return {
    reportStore: new InMemoryReportStore(),
    usageStore: new InMemoryUsageStore(),
    now: () => NOW,
    reportRetentionDays: 90,
    ...overrides,
  };
}

async function testUnknownCommand(): Promise<void> {
  section('Operator command — an unknown subcommand fails with the grammar');

  const result = await runAdminCli(['bogus'], baseDeps());
  eq('exit code 1', result.exitCode, 1);
  check('output names the real subcommands', result.output.includes('reports list') && result.output.includes('usage'));
}

async function testListHidesBulkyContent(): Promise<void> {
  section('Operator command — reports list hides bulky content (spec "Listing hides bulky content")');

  const reportStore = new InMemoryReportStore();
  const marker = 'PROMPT_TEXT_THAT_LIST_MUST_NEVER_PRINT';
  await reportStore.insert({
    deviceId: DEVICE_A,
    reason: 'offensive',
    appName: 'Joke Box',
    note: 'rude jokes',
    prompt: marker,
    source: marker,
    now: NOW,
  });
  const deps = baseDeps({ reportStore });

  const text = await runAdminCli(['reports', 'list', '--since', '7'], deps);
  eq('text output exit code', text.exitCode, 0);
  check('text output shows id, reason, app name and note', text.output.includes('Joke Box') && text.output.includes('rude jokes'));
  check('text output shows content sizes, not content', text.output.includes(`promptBytes=${Buffer.byteLength(marker, 'utf8')}`));
  check('text output never prints the prompt/source text', !text.output.includes(marker));

  const asJson = await runAdminCli(['reports', 'list', '--json'], deps);
  const parsed = JSON.parse(asJson.output) as Record<string, unknown>[];
  eq('json list has one item', parsed.length, 1);
  check('json list items carry no prompt/source key', !('prompt' in parsed[0]!) && !('source' in parsed[0]!));
  check('json output never contains the prompt/source text', !asJson.output.includes(marker));
}

async function testShowPrintsEverything(): Promise<void> {
  section('Operator command — reports show prints everything sent (spec scenario)');

  const reportStore = new InMemoryReportStore();
  const reportId = await reportStore.insert({
    deviceId: DEVICE_A,
    reason: 'harmful',
    prompt: 'the full prompt text',
    source: 'the full source text',
    now: NOW,
  });
  const deps = baseDeps({ reportStore });

  const text = await runAdminCli(['reports', 'show', reportId], deps);
  eq('exit code 0', text.exitCode, 0);
  check('full prompt text is printed', text.output.includes('the full prompt text'));
  check('full source text is printed', text.output.includes('the full source text'));

  const asJson = await runAdminCli(['reports', 'show', reportId, '--json'], deps);
  const parsed = JSON.parse(asJson.output) as { prompt: string; source: string };
  eq('json show carries the full prompt', parsed.prompt, 'the full prompt text');
  eq('json show carries the full source', parsed.source, 'the full source text');

  const missing = await runAdminCli(['reports', 'show', 'does-not-exist'], deps);
  eq('an unknown id exits non-zero', missing.exitCode, 1);
}

async function testPurgeAppliesRetentionNow(): Promise<void> {
  section('Operator command — reports purge applies the retention period now (spec scenario)');

  const reportStore = new InMemoryReportStore();
  const staleId = await reportStore.insert({ deviceId: DEVICE_A, reason: 'broken', now: NOW - 91 * 86_400_000 });
  const freshId = await reportStore.insert({ deviceId: DEVICE_A, reason: 'broken', now: NOW });
  const deps = baseDeps({ reportStore, reportRetentionDays: 90 });

  const result = await runAdminCli(['reports', 'purge'], deps);
  eq('exit code 0', result.exitCode, 0);
  check('reports the number purged', result.output.includes('purged 1 report'));
  check('the stale report is gone', (await reportStore.get(staleId)) === undefined);
  check('the fresh report remains', (await reportStore.get(freshId)) !== undefined);
}

async function testUsageSummary(): Promise<void> {
  section('Operator command — usage summary over recent days (spec scenario)');

  const usageStore = new InMemoryUsageStore();
  const genA = await usageStore.admit({ deviceId: DEVICE_A, kind: 'generate', now: NOW, deviceLimit: 15 });
  const genB = await usageStore.admit({ deviceId: DEVICE_B, kind: 'generate', now: NOW, deviceLimit: 15 });
  if (genA.ok) {
    await usageStore.settle(genA.requestId, { outcome: 'delivered' });
    await usageStore.recordCost(genA.requestId, { state: 'resolved', costUsd: 0.2 });
  }
  if (genB.ok) {
    await usageStore.settle(genB.requestId, { outcome: 'unavailable' });
    await usageStore.recordCost(genB.requestId, { state: 'unresolved' });
  }
  const deps = baseDeps({ usageStore });

  const text = await runAdminCli(['usage', '--days', '1', '--top', '5'], deps);
  eq('exit code 0', text.exitCode, 0);
  check('daily totals are listed', text.output.includes('generate=2'));
  check('top devices by cost are listed', text.output.includes(DEVICE_A));
  check('per-generation stats are listed', text.output.includes('count=2'));
  check('the unresolved row is counted separately', text.output.includes('unresolved=1'));

  const asJson = await runAdminCli(['usage', '--days', '1', '--json'], deps);
  const parsed = JSON.parse(asJson.output) as { generationStats: { unresolvedCount: number } };
  eq('json summary carries the unresolved count', parsed.generationStats.unresolvedCount, 1);
}

async function testReadWhileWriting(): Promise<void> {
  section('Operator command — reading while the server writes (both stores)');

  // Reports: a second connection lists while inserts proceed on the first.
  {
    const dbPath = tmpDbPath('read-write-reports');
    try {
      const writer = new NodeSqliteReportStore(dbPath);
      const reader = new NodeSqliteReportStore(dbPath);
      const deps = baseDeps({ reportStore: reader });

      const writes = Promise.all(
        Array.from({ length: 20 }, (_unused, i) =>
          writer.insert({ deviceId: DEVICE_A, reason: 'broken', now: NOW + i, note: `n${i}` }),
        ),
      );
      const read = runAdminCli(['reports', 'list', '--limit', '50'], deps);
      const [writeResults, readResult] = await Promise.all([writes, read]);

      eq('all 20 inserts succeeded', writeResults.length, 20);
      eq('the concurrent list command completed successfully', readResult.exitCode, 0);
      writer.close();
      reader.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
    }
  }

  // Usage: the operator's usage command completes while admits proceed on another connection.
  {
    const dbPath = tmpDbPath('read-write-usage');
    try {
      const writer = new NodeSqliteUsageStore(dbPath);
      const reader = new NodeSqliteUsageStore(dbPath);
      const deps = baseDeps({ usageStore: reader });

      const writes = Promise.all(
        Array.from({ length: 20 }, (_unused, i) =>
          writer.admit({ deviceId: DEVICE_A, kind: 'generate', now: NOW + i, deviceLimit: 400 }),
        ),
      );
      const read = runAdminCli(['usage', '--days', '1'], deps);
      const [writeResults, readResult] = await Promise.all([writes, read]);

      check('all admits succeeded', writeResults.every((r) => r.ok));
      eq('the concurrent usage command completed successfully', readResult.exitCode, 0);
      writer.close();
      reader.close();
    } finally {
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
    }
  }
}

export async function runAdminTests(): Promise<void> {
  await testUnknownCommand();
  await testListHidesBulkyContent();
  await testShowPrintsEverything();
  await testPurgeAppliesRetentionNow();
  await testUsageSummary();
  await testReadWhileWriting();
}
