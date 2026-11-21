/**
 * The stub's storage fixture (`src/stub-storage-fixture.ts`, upgrade-to-latest-dependencies 7.1/7.4):
 * `[[fixture:storage-v1|v2]]` makes the stub deliver it, through the stub rewrite and generate as a
 * device reaches them; its record is what the checker extracts from its source and the check stage
 * passes it; and its delivered bundles, run in order against a real storage engine on a database
 * file (the store a device keeps), write a store that `scripts/release/run.mjs storage-seed-check`
 * accepts as an upgrade seed: every field type, a burned field id holding data, two collections.
 */
import * as vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { check, eq, section } from './harness';
import { readSseResponse } from './sse-reader';
import { PROTOCOL_HEADERS, TIMED_OUT, within } from './route-doubles';
import { createApp } from '../src/app';
import { createStubPipeline } from '../src/pipeline';
import { InMemoryUsageStore } from '../src/usage-store';
import { createCheckStage } from '../src/generation/stages/check';
import { STORAGE_FIXTURE_MARKERS, type StorageFixtureVersion } from '../src/stub-markers';
import { STORAGE_FIXTURE_NAME, STORAGE_FIXTURE_SCHEMAS, STORAGE_FIXTURE_TOTALS, storageFixtureStatus } from '../src/stub-storage-fixture';
import { createEngine, readAppliedSchema } from '../../src/host/storage-engine/engine';
import { createNodeSqlExecutor } from '../../src/host/storage-engine/bindings/node-sqlite';
import { FIELD_TYPES, type JsonValue, type ListQuery, type SchemaArtifact, type StorageEngine } from '../../src/host/storage-engine/contract';
import type { WireAppRecord } from '@whim/contract';

const DEVICE_HEADER = { 'x-whim-device': '33333333-3333-4333-8333-333333333333', ...PROTOCOL_HEADERS };
const VERSIONS: readonly StorageFixtureVersion[] = ['v1', 'v2'];

function stubApp() {
  return createApp({ pipeline: createStubPipeline(0), usageStore: new InMemoryUsageStore(), stub: true });
}

async function post(route: string, body: unknown): Promise<Response | typeof TIMED_OUT> {
  return within(Promise.resolve(stubApp().request(route, { method: 'POST', headers: { 'content-type': 'application/json', ...DEVICE_HEADER }, body: JSON.stringify(body) })));
}

/** The app the stub delivers for a prompt, as a device receives it: rewrite first, then generate. */
async function deliver(prompt: string): Promise<WireAppRecord | undefined> {
  const rewrite = await post('/v1/rewrite', { prompt });
  if (rewrite === TIMED_OUT || rewrite.status !== 200) return undefined;
  const { rewrittenPrompt } = (await rewrite.json()) as { rewrittenPrompt: string };
  const generate = await post('/v1/generate', { prompt: rewrittenPrompt });
  if (generate === TIMED_OUT) return undefined;
  const terminal = (await readSseResponse(generate)).events.at(-1)?.data;
  return terminal?.type === 'result' ? terminal.app : undefined;
}

interface Reading {
  status: string;
  summary: string;
  lines: string[];
}

const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

/** `vc-sdk` as far as the fixture uses it: its storage over a real engine, values crossing as JSON
 *  as they cross the bridge, and one render whose effect runs at once and whose state lands in
 *  `onState`. */
function fakeSdk(engine: StorageEngine, onState: (state: Reading) => void): Record<string, unknown> {
  return {
    defineApp: (spec: unknown) => spec,
    Screen: 'Screen',
    Stack: 'Stack',
    Text: 'Text',
    useState: (initial: unknown) => [initial, onState],
    useEffect: (effect: () => void) => {
      effect();
    },
    storage: {
      kv: {
        get: async (key: string) => clone(engine.kv.get(key)),
        set: async (key: string, value: JsonValue) => {
          engine.kv.set(key, clone(value));
        },
      },
      records: {
        append: async (collection: string, record: Record<string, JsonValue>) => clone(engine.records.append(collection, clone(record))),
        list: async (collection: string, query?: ListQuery) => clone(engine.records.list(collection, query)),
        update: async (collection: string, id: number, patch: Record<string, JsonValue>) => {
          engine.records.update(collection, id, clone(patch));
        },
      },
    },
  };
}

/** Launches a delivered fixture version on the store at `dbFile` the way the host does (the engine
 *  opens the record's schema before the bundle runs), renders its screen once, and returns what it
 *  shows once its effect settles. */
async function runFixture(app: WireAppRecord, dbFile: string): Promise<Reading | undefined> {
  const engine = createEngine(createNodeSqlExecutor(dbFile));
  try {
    engine.open(app.schema as unknown as SchemaArtifact);
    let settle: ((state: Reading) => void) | undefined;
    const settled = new Promise<Reading>((resolve) => {
      settle = resolve;
    });
    const sdk = fakeSdk(engine, (state) => settle?.(state));
    const window: Record<string, unknown> = {
      require: (name: string): unknown => {
        if (name === 'vc-sdk') return sdk;
        if (name === 'react') return { createElement: () => ({}) };
        if (name === 'react-dom') return {};
        throw new Error(`unexpected require: ${name}`);
      },
    };
    window.window = window;
    vm.createContext(window);
    // Intentional: running the stub's own just-built fixture bundle inside an isolated node:vm
    // context, as server-core's F4 test runs the stub app — this is the test, not an injection path.
    // eslint-disable-next-line sonarjs/code-eval
    vm.runInContext(app.bundle, window);
    const loaded = window.__WHIM_APP_MODULE__ as { default?: unknown } | undefined;
    const spec = (loaded?.default ?? loaded) as { screens: { Home: () => unknown } };
    spec.screens.Home();
    const reading = await within(settled);
    return reading === TIMED_OUT ? undefined : reading;
  } finally {
    engine.close();
  }
}

function releaseCli(args: string[]): { status: number | null; out: string } {
  const result = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts/release/run.mjs'), ...args], { encoding: 'utf8', timeout: 60_000 });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

/** The release CLI's dump of `dbFile`, written to `out`, and its seed check. */
function dumpAndSeedCheck(dbFile: string, out: string): { dumped: boolean; seed: { status: number | null; out: string } } {
  const dump = releaseCli(['storage-dump', dbFile, '--out', out]);
  return { dumped: dump.status === 0, seed: releaseCli(['storage-seed-check', out]) };
}

async function testDelivery(records: Map<StorageFixtureVersion, WireAppRecord>): Promise<void> {
  section('Stub storage fixture: [[fixture:storage-v1|v2]] delivers it through the stub rewrite and generate');

  for (const version of VERSIONS) {
    const marked = `a storage seed ${STORAGE_FIXTURE_MARKERS[version]}`;
    const rewrite = await post('/v1/rewrite', { prompt: marked });
    const rewritten = rewrite === TIMED_OUT ? undefined : ((await rewrite.json()) as { rewrittenPrompt?: string }).rewrittenPrompt;
    eq(`${version}: the stub rewrite passes the marked prompt through raw`, rewritten, marked);

    const app = await deliver(marked);
    if (app === undefined) {
      check(`${version}: the stub delivered an app`, false);
      continue;
    }
    records.set(version, app);
    eq(`${version}: the delivered app is the storage fixture`, app.name, STORAGE_FIXTURE_NAME);
    eq(`${version}: it declares the storage capability`, app.manifest.capabilities, ['storage']);
    eq(`${version}: its record's schema is what its source declares`, app.schema, STORAGE_FIXTURE_SCHEMAS[version]);
    check(`${version}: it carries its source and a bundle`, typeof app.source === 'string' && app.bundle.length > 0);
  }

  const plain = await deliver('a day checklist');
  eq('a prompt without a marker still gets the day checklist', plain?.name, 'Hello App');
}

async function testCheckStage(records: Map<StorageFixtureVersion, WireAppRecord>): Promise<void> {
  section('Stub storage fixture: the check stage passes both versions, v2 against the store v1 leaves');

  const v1 = records.get('v1');
  const v2 = records.get('v2');
  if (v1?.source === undefined || v2?.source === undefined) {
    check('setup: both versions were delivered with their source', false);
    return;
  }
  const stage = createCheckStage();
  const kinds = (report: Awaited<ReturnType<typeof stage.check>>): string[] => report.diagnostics.map((d) => `${d.kind}: ${d.message}`);
  eq('v1: the check stage reports nothing', kinds(await stage.check(v1.source, {})), []);
  const executor = createNodeSqlExecutor(':memory:');
  const engine = createEngine(executor);
  engine.open(v1.schema as unknown as SchemaArtifact);
  const appliedSchema = readAppliedSchema(executor) as unknown as Record<string, unknown>;
  engine.close();
  eq('v2: the check stage reports nothing against v1\'s applied schema', kinds(await stage.check(v2.source, { appliedSchema })), []);

  const v1Types = new Set(Object.values(STORAGE_FIXTURE_SCHEMAS.v1.collections).flatMap((c) => Object.values(c.fields).map((f) => f.type)));
  eq('v1 declares a field of every type in the engine\'s closed set', FIELD_TYPES.filter((type) => !v1Types.has(type)), []);
}

async function testSeedRun(records: Map<StorageFixtureVersion, WireAppRecord>): Promise<void> {
  section('Stub storage fixture: run v1 then v2 on one store, as a device does; the store is an upgrade seed');

  const v1 = records.get('v1');
  const v2 = records.get('v2');
  if (v1 === undefined || v2 === undefined) {
    check('setup: both versions were delivered', false);
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-storage-fixture-'));
  try {
    const dbFile = path.join(dir, 'app-fixture.db');

    const first = await runFixture(v1, dbFile);
    eq('v1: its first open writes the v1 seed', first?.status, storageFixtureStatus('v1', true));
    const afterV1 = dumpAndSeedCheck(dbFile, path.join(dir, 'after-v1.json'));
    check('v1 alone: the store dumps', afterV1.dumped);
    check('v1 alone: the seed check fails, naming the missing burned id', afterV1.seed.status === 1 && afterV1.seed.out.includes('no burned (retired) field id'), afterV1.seed.out);

    const second = await runFixture(v2, dbFile);
    eq('v2: its first open writes the v2 seed', second?.status, storageFixtureStatus('v2', true));
    const summary = new RegExp(`^Read back [0-9a-f]{8}: ${STORAGE_FIXTURE_TOTALS.rows} rows, ${STORAGE_FIXTURE_TOTALS.keys} keys$`);
    check('v2: it reads back every row and key both versions wrote', summary.test(second?.summary ?? ''), second?.summary);
    const seeded = dumpAndSeedCheck(dbFile, path.join(dir, 'seeded.json'));
    check('v1 then v2: the store dumps', seeded.dumped);
    eq('v1 then v2: the release seed check passes', seeded.seed.status, 0);

    const peek = createNodeSqlExecutor(dbFile);
    const applied = readAppliedSchema(peek);
    peek.close();
    const entries = applied.collections.find((c) => c.id === STORAGE_FIXTURE_SCHEMAS.v2.collections.Entries.id);
    const retired = entries?.retired.map((c) => c.id) ?? [];
    const tombstones = STORAGE_FIXTURE_SCHEMAS.v2.collections.Entries.tombstones;
    check('v1 then v2: _meta keeps v2\'s tombstoned ids, and only those, as retired columns', retired.length > 0 && retired.join(',') === tombstones.join(','), `${retired.join(',')} vs ${tombstones.join(',')}`);

    const third = await runFixture(v2, dbFile);
    eq('v2 reopened: it finds its seed and writes nothing', third?.status, storageFixtureStatus('v2', false));
    eq('v2 reopened: it shows the same read-back', third?.summary, second?.summary);
    const reopened = releaseCli(['storage-dump', dbFile, '--out', path.join(dir, 'reopened.json')]);
    const unchanged = releaseCli(['storage-diff', path.join(dir, 'seeded.json'), path.join(dir, 'reopened.json')]);
    check('v2 reopened: the store is identical to the seeded one', reopened.status === 0 && unchanged.status === 0, unchanged.out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function runStubStorageFixtureTests(): Promise<void> {
  const records = new Map<StorageFixtureVersion, WireAppRecord>();
  await testDelivery(records);
  await testCheckStage(records);
  await testSeedRun(records);
}
