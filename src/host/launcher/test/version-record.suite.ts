/**
 * An older version, and a copy made from one, runs with that version's own manifest and schema
 * (capability bridge #41: the gate reads the host-held record, so the record must be the one the
 * running code was built with). Real producer output throughout: the Water Counter and Pour-Over
 * Timer records and bundles the build extracts (`APP_RECORDS`/`APP_BUNDLES`), the storage-less app
 * the stub generation pipeline delivers, delivered through `deliverResult` and `StoreAccess` over a
 * real version store, and launched the way the shell launches (`LauncherRoot#launchApp` →
 * `useMiniAppHost#bind`): the index entry's record under its engine appId, through the real bridge
 * gate and dispatcher over a real store file.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { GenerateRequest, WireAppRecord } from '@whim/contract';
import { Harness } from './harness';
import { AppIndex, type InstalledApp } from '../app-index';
import type { StoreAccess } from '../store-access';
import { deliverResult } from '../build-lifecycle';
import { buildGenerateRequest } from '../generation-request';
import { seedFirstRun } from '../seed';
import { tileOf } from '../tile-identity';
import { createDefaultRegistry, Dispatcher, launchApp, type SysretFrame } from '../../bridge';
import { createEngine } from '../../storage-engine/engine';
import { burnedIdFloor, diffSchemas, type AppliedSchema } from '../../storage-engine/schema';
import type { SchemaArtifact } from '../../storage-engine/contract';
import type { KVBackend } from '../../version-store';
import { createNodeSqlExecutor } from '../../storage-engine/bindings/node-sqlite';
import { APP_RECORDS } from '../../../runtime/generated/app-records';
import { APP_BUNDLES } from '../../../runtime/generated/app-bundles';
import { createStubPipeline } from '../../../../server/src/pipeline';
import { burnedSchema, runStaticChecks } from '../../../../checks/index';
import { accessOver, disposeDeviceState, fileOf, newDeviceState, readApplied, type DeviceState } from './data-copy-rig';

const WATER = 'water-counter';

/** One launch of an app: the code it runs, its syscalls, the cues its realm fired, and closing its store. */
interface Session {
  source: string;
  call(method: string, params: Record<string, unknown>): Promise<SysretFrame | null>;
  cues: string[];
  close(): void;
}

/** Launch `entry` as the shell does: the active version's code and the record it runs with, read
 *  together (`StoreAccess#activeLaunch`), under its engine appId, behind the host's table. */
async function open(state: DeviceState, access: StoreAccess, entry: InstalledApp): Promise<Session> {
  const { app, source } = await access.activeLaunch(entry);
  const launched = launchApp({ ...app.record, appId: access.engineAppId(app) }, (appId) =>
    createEngine(createNodeSqlExecutor(fileOf(state, appId))),
  );
  if (!launched.ok) throw new Error(`launch refused: ${launched.error.kind}`);
  const cues: string[] = [];
  const registry = createDefaultRegistry({ cueBackend: { haptic: (kind) => cues.push(kind), sound: (name) => cues.push(name) } });
  const dispatcher = Dispatcher.forRealm(launched.realm, registry);
  let id = 0;
  return {
    call: (method, params) => dispatcher.handle({ whim: 'syscall', v: 1, id: ++id, gen: launched.realm.generation, method, params }),
    cues,
    close: () => launched.realm.engine?.close(),
    source,
  };
}

/** A syscall's result, or the kind of its refusal. */
async function outcome(session: Session, method: string, params: Record<string, unknown>): Promise<unknown> {
  const ret = await session.call(method, params);
  if (ret == null) return 'dropped';
  return ret.ok ? ret.result : ret.error?.kind;
}

/** What the water counter itself reads at start: its saved total and its glasses. */
async function saved(session: Session): Promise<unknown> {
  const total = await outcome(session, 'storage.kv.get', { key: 'total' });
  const drinks = await outcome(session, 'storage.records.list', { collection: 'Drinks' });
  return { total, glasses: Array.isArray((drinks as { records?: unknown[] }).records) ? (drinks as { records: unknown[] }).records.length : drinks };
}

/** The storage-less app the stub generation pipeline delivers. */
async function stubDelivery(): Promise<WireAppRecord> {
  for await (const event of createStubPipeline(0).run({ prompt: 'make it a day checklist' } as GenerateRequest)) {
    if (event.type === 'result') return event.app;
  }
  throw new Error('the stub pipeline delivered no app');
}

/** A delivery of the build's Pour-Over Timer: a version that declares cues and no storage. */
function pourOverDelivery(): WireAppRecord {
  const record = APP_RECORDS['pour-over-timer'];
  return {
    name: record.name,
    source: fs.readFileSync(path.join(process.cwd(), 'fixtures/pour-over-timer.app.tsx'), 'utf8'),
    bundle: APP_BUNDLES['pour-over-timer'],
    manifest: record.manifest as unknown as WireAppRecord['manifest'],
    schema: {},
  };
}

/** A delivery of the Water Counter that adds a Notes collection beside its Drinks. */
function waterWithNotesDelivery(): WireAppRecord {
  const record = APP_RECORDS[WATER];
  const schema = record.schemaArtifact!;
  return {
    name: record.name,
    source: fs.readFileSync(path.join(process.cwd(), 'fixtures/water-counter.app.tsx'), 'utf8'),
    bundle: APP_BUNDLES[WATER],
    manifest: record.manifest as unknown as WireAppRecord['manifest'],
    schema: {
      ...schema,
      collections: { ...schema.collections, Notes: { id: 'c2', tombstones: [], fields: { body: { id: 'f2', type: 'text' } } } },
    } as unknown as WireAppRecord['schema'],
  };
}

/** The seeded Water Counter with two glasses saved, then changed by each delivery in turn. Returns
 *  the version ids oldest-first. */
async function waterCounterChanged(state: DeviceState, access: StoreAccess, index: AppIndex, deliveries: WireAppRecord[]): Promise<string[]> {
  await seedFirstRun(index, access, [
    { id: WATER, name: 'Water Counter', prompt: 'count my glasses of water', record: APP_RECORDS[WATER], bundleSource: APP_BUNDLES[WATER] },
  ]);
  const first = await open(state, access, index.get(WATER)!);
  try {
    await first.call('storage.records.append', { collection: 'Drinks', record: { at: 1 } });
    await first.call('storage.records.append', { collection: 'Drinks', record: { at: 2 } });
    await first.call('storage.kv.set', { key: 'total', value: 2 });
  } finally {
    first.close();
  }
  for (const wire of deliveries) {
    await deliverResult({ access, appId: 'unused', editing: index.get(WATER)!, text: `change it to ${wire.name}`, wire });
  }
  return (await access.timeline(index.get(WATER)!)).map((v) => v.id).reverse();
}

/** Run `body` with the session `entry` launches into, closing its store after. */
async function within<T>(state: DeviceState, access: StoreAccess, entry: InstalledApp, body: (s: Session) => Promise<T>): Promise<T> {
  const session = await open(state, access, entry);
  try {
    return await body(session);
  } finally {
    session.close();
  }
}

export async function runVersionRecordTests(h: Harness): Promise<void> {
  await h.test('version record: "Use this version" on v1 runs v1 with v1\'s manifest, and Undo runs the newest with its own', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state);
      const [v1, , v3] = await waterCounterChanged(state, access, index, [await stubDelivery(), pourOverDelivery()]);
      const tileBefore = tileOf(index.get(WATER)!);
      await within(state, access, index.get(WATER)!, async (s) => {
        h.eq(await outcome(s, 'storage.kv.get', { key: 'total' }), 'undeclared_capability', 'precondition: the newest version declares no storage');
      });

      await access.rollback(index.get(WATER)!, v1);
      h.eq(await access.activeBundle(index.get(WATER)!), APP_BUNDLES[WATER], 'precondition: v1 is the code that runs');
      await within(state, access, index.get(WATER)!, async (s) => {
        h.eq(await saved(s), { total: { found: true, value: 2 }, glasses: 2 }, 'v1 loads its saved glasses');
        h.eq(await outcome(s, 'storage.records.append', { collection: 'Drinks', record: { at: 3 } }), { id: 3 }, 'and saves a new one');
        h.eq(await outcome(s, 'cues.haptic', { kind: 'tap' }), 'undeclared_capability', 'a capability only a later version declared is refused');
        h.eq(s.cues, [], 'and never fires');
      });
      const relaunched = new AppIndex(state.kv).get(WATER)!;
      await within(state, access, relaunched, async (s) => {
        h.eq(await saved(s), { total: { found: true, value: 2 }, glasses: 3 }, 'still so after the process restarts');
      });
      h.eq(tileOf(index.get(WATER)!), tileBefore, 'the tile does not move with the version');

      const request = await buildGenerateRequest(access, readApplied(state), index.get(WATER)!, 'add a goal');
      h.eq(request.app?.manifest, APP_RECORDS[WATER].manifest, "changing it from v1 describes v1's manifest");
      h.eq(request.app?.schema, APP_RECORDS[WATER].schemaArtifact, "and v1's schema");

      await access.rollback(index.get(WATER)!, v3);
      await within(state, access, index.get(WATER)!, async (s) => {
        h.eq(await outcome(s, 'storage.kv.get', { key: 'total' }), 'undeclared_capability', 'Undo: the newest version runs without storage again');
        h.eq(await outcome(s, 'cues.haptic', { kind: 'tap' }), {}, 'with the cues it declares');
        h.eq(s.cues, ['tap'], 'which fire');
      });
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('version record: "Make a copy from here" on v1 with "Copy the data" runs the copy with v1\'s manifest and the data', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state);
      const [v1] = await waterCounterChanged(state, access, index, [await stubDelivery(), pourOverDelivery()]);
      const copy = await access.fork(index.get(WATER)!, v1, { data: 'copy' });
      h.eq(index.get(copy.id)?.record, copy.record, 'precondition: the copy is indexed as returned');
      await within(state, access, copy, async (s) => {
        h.eq(await saved(s), { total: { found: true, value: 2 }, glasses: 2 }, 'the copy loads the copied glasses');
        h.eq(await outcome(s, 'storage.records.append', { collection: 'Drinks', record: { at: 3 } }), { id: 3 }, 'and saves a new one');
        h.eq(await outcome(s, 'cues.haptic', { kind: 'tap' }), 'undeclared_capability', 'a capability only a later version declared is refused');
      });
      await within(state, access, index.get(WATER)!, async (s) => {
        h.eq(await outcome(s, 'storage.kv.get', { key: 'total' }), 'undeclared_capability', 'the original still runs its newest version');
      });
      await access.rollback(index.get(WATER)!, v1);
      await within(state, access, index.get(WATER)!, async (s) => {
        h.eq(await saved(s), { total: { found: true, value: 2 }, glasses: 2 }, "the copy's new glass never reached the original");
      });
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('version record: "Make a copy from here" on v1 with "Start fresh" runs the copy with v1\'s manifest and an empty store', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state);
      const [v1] = await waterCounterChanged(state, access, index, [await stubDelivery(), pourOverDelivery()]);
      const copy = await access.fork(index.get(WATER)!, v1, { data: 'fresh' });
      await within(state, access, copy, async (s) => {
        h.eq(await saved(s), { total: { found: false, value: null }, glasses: 0 }, 'the fresh copy loads, empty');
        h.eq(await outcome(s, 'storage.records.append', { collection: 'Drinks', record: { at: 1 } }), { id: 1 }, 'and saves');
        h.eq(await outcome(s, 'cues.haptic', { kind: 'tap' }), 'undeclared_capability', 'a capability only a later version declared is refused');
      });
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('version record: v1 runs beside the fields a later version added, which stay in the store unused', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state);
      const [v1, v2] = await waterCounterChanged(state, access, index, [waterWithNotesDelivery()]);
      await within(state, access, index.get(WATER)!, async (s) => {
        h.eq(await outcome(s, 'storage.records.append', { collection: 'Notes', record: { body: 'drink more' } }), { id: 1 }, 'v2 saves a note');
      });

      await access.rollback(index.get(WATER)!, v1);
      await within(state, access, index.get(WATER)!, async (s) => {
        h.eq(await saved(s), { total: { found: true, value: 2 }, glasses: 2 }, 'v1 opens the store v2 grew and loads its glasses');
        h.eq(await outcome(s, 'storage.records.list', { collection: 'Notes' }), 'unknown_collection', "v1's schema does not name v2's Notes");
      });
      const notes = readApplied(state)(WATER).collections.find((c) => c.id === 'c2');
      h.eq(notes?.active, [{ id: 'f2', type: 'text' }], 'the store still holds every field v2 added');

      await access.rollback(index.get(WATER)!, v2);
      await within(state, access, index.get(WATER)!, async (s) => {
        const listed = (await outcome(s, 'storage.records.list', { collection: 'Notes' })) as { records: Array<{ body: string }> };
        h.eq(listed.records.map((r) => r.body), ['drink more'], 'back on v2, its note is there');
      });
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('version record (pins a known pre-release limitation, not correct behaviour): a version saved before versions kept their manifest runs with the record the app has now', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state);
      // What a seed left before this change: a snapshot of the bundle alone, and the index entry.
      const { id: v1 } = await state.store.snapshot(WATER, { 'bundle.js': APP_BUNDLES[WATER] }, 'count my glasses of water');
      index.put({ id: WATER, name: 'Water Counter', example: true, createdAt: 1, record: APP_RECORDS[WATER], lineageId: 'main' });
      await deliverResult({ access, appId: 'unused', editing: index.get(WATER)!, text: 'change it', wire: await stubDelivery() });
      const recordBefore = index.get(WATER)!.record;
      await access.rollback(index.get(WATER)!, v1);
      h.eq(index.get(WATER)!.record, recordBefore, 'the record is left as it was');
      const launch = await access.activeLaunch(index.get(WATER)!);
      h.eq([launch.source, launch.app.record], [APP_BUNDLES[WATER], recordBefore], "the version's code runs, with the record the app had (the limitation)");
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('version record: a launch read through a copy of the app taken before an Undo runs the newest version with its own record, never the copy’s', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state);
      const [v1, , v3] = await waterCounterChanged(state, access, index, [await stubDelivery(), pourOverDelivery()]);
      await access.rollback(index.get(WATER)!, v1);
      const homeCopy = index.get(WATER)!; // what Home holds once it comes back from History
      h.eq(homeCopy.record.manifest.capabilities, ['storage'], "setup: the copy holds v1's record");
      await access.rollback(homeCopy, v3); // Undo on the toast; Home is not refreshed
      await within(state, access, homeCopy, async (s) => {
        h.eq(s.source, APP_BUNDLES['pour-over-timer'], 'the newest code runs');
        h.eq(await outcome(s, 'storage.kv.get', { key: 'total' }), 'undeclared_capability', 'without the storage only v1 declared');
        h.eq(await outcome(s, 'cues.haptic', { kind: 'tap' }), {}, 'with the cues it declares');
      });
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('version record: a launch read while an Undo is still running waits for it and runs the version it returns to, code and record together', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state);
      const [v1, , v3] = await waterCounterChanged(state, access, index, [await stubDelivery(), pourOverDelivery()]);
      await access.rollback(index.get(WATER)!, v1);
      const release = holdNextRollback(state);
      const undo = access.rollback(index.get(WATER)!, v3);
      const launch = access.activeLaunch(index.get(WATER)!); // read before the Undo has written anything
      release();
      await undo;
      const { app, source } = await launch;
      h.eq(source, APP_BUNDLES['pour-over-timer'], 'the version the Undo returns to runs');
      h.eq(app.record.manifest.capabilities, APP_RECORDS['pour-over-timer'].manifest.capabilities, 'with its own capabilities');
      h.eq(app.record.schemaArtifact, undefined, 'and no schema it never declared');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('version record: a rollback whose index write fails still moves the app, and the next launch runs that version with its own record and writes it down', async () => {
    const state = newDeviceState();
    try {
      const kv = new FailingKv(state.kv);
      const { access, index } = accessOver(state, { kv });
      const [v1] = await waterCounterChanged(state, access, index, [await stubDelivery(), pourOverDelivery()]);
      kv.failing = true;
      const moved = await access.rollback(index.get(WATER)!, v1);
      kv.failing = false;
      h.eq(moved.activeId, v1, 'the switch is reported, since the app did move');
      h.eq(index.get(WATER)!.record.manifest.capabilities, ['cues'], 'setup: the index still holds the newest record');
      await within(state, access, index.get(WATER)!, async (s) => {
        h.eq(s.source, APP_BUNDLES[WATER], "v1's code runs");
        h.eq(await saved(s), { total: { found: true, value: 2 }, glasses: 2 }, 'with the storage v1 declares, its data loaded');
        h.eq(await outcome(s, 'cues.haptic', { kind: 'tap' }), 'undeclared_capability', 'and none of the newest version’s cues');
      });
      h.eq(index.get(WATER)!.record.manifest.capabilities, ['storage'], 'the launch wrote the record down, so every other reader agrees again');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('version record: a version whose saved manifest cannot be read is refused before the app moves', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state);
      const [good] = await waterCounterChanged(state, access, index, []);
      const { id: broken } = await state.store.snapshot(WATER, { 'bundle.js': 'BROKEN', 'manifest.json': '{"capabilities": [' }, 'a damaged save');
      await access.rollback(index.get(WATER)!, good);
      const refused = await access.rollback(index.get(WATER)!, broken).then(() => null, (e: unknown) => e);
      h.ok(refused instanceof Error, 'the switch is refused');
      h.eq(await access.activeId(index.get(WATER)!), good, 'and the app stays on the version it was on');
      await within(state, access, index.get(WATER)!, async (s) => {
        h.eq(s.source, APP_BUNDLES[WATER], 'which still runs');
      });
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('version record: a change landing behind the newest version, interrupted between its new line and its delivery, leaves an app that runs the version it started from with that version’s record', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state);
      const [v1] = await waterCounterChanged(state, access, index, [await stubDelivery(), pourOverDelivery()]);
      await access.rollback(index.get(WATER)!, v1);
      const continuation = await access.continueSharingData(index.get(WATER)!); // the process dies here
      const relaunched = new AppIndex(state.kv).get(continuation.id)!;
      h.eq(relaunched.record.manifest.capabilities, ['storage'], "the new entry holds v1's record");
      await within(state, access, relaunched, async (s) => {
        h.eq(s.source, APP_BUNDLES[WATER], "and runs v1's code");
        h.eq(await saved(s), { total: { found: true, value: 2 }, glasses: 2 }, 'on the shared data, which loads');
        h.eq(await outcome(s, 'storage.records.append', { collection: 'Drinks', record: { at: 3 } }), { id: 3 }, 'and saves');
      });
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('version record: a saved manifest holds what the version declares, not the tile colour the host keeps, which stays the app’s', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state);
      await waterCounterChanged(state, access, index, []);
      const manifestFile = JSON.parse((await state.store.active(WATER))!.artifacts['manifest.json']) as Record<string, unknown>;
      const { capabilities, tint, icon } = APP_RECORDS[WATER].manifest;
      h.ok(tint !== undefined && icon !== undefined, 'setup: the shipped water-counter record declares a tint and an icon');
      h.eq(manifestFile, { capabilities, tint, icon }, 'the saved manifest is the declaration alone, its tint and icon included');
      const { app } = await access.activeLaunch(index.get(WATER)!);
      h.eq(app.record.manifest.tileColor, APP_RECORDS[WATER].manifest.tileColor, 'the launch keeps the colour the app has');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('version record: a change made from an older version allocates field ids above every id a saved version declares, even one never opened', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state);
      const [v1] = await waterCounterChanged(state, access, index, [waterWithAmountDelivery()]);
      await access.rollback(index.get(WATER)!, v1);
      const request = await buildGenerateRequest(access, readApplied(state), index.get(WATER)!, 'add a note');
      h.eq(readApplied(state)(WATER).collections[0].active.map((c) => c.id), ['f1'], 'setup: the store never created v2’s field');
      h.eq(burnedIdFloor(burnedOf(request)).c1, 2, 'the floor the server states counts the field v2 declares');
      h.eq(serverCheck(request, waterSource({ amount: { id: 'f2', type: 'text', default: "''" } })), ['type_change'], 'so the server refuses its id reused for another type');
      h.eq(serverCheck(request, waterSource({ note: { id: 'f3', type: 'text', default: "''" } })), [], 'and takes a new field above it');
      h.eq(serverCheck(request, fs.readFileSync(path.join(process.cwd(), 'fixtures/water-counter.app.tsx'), 'utf8')), [], 'while v1’s own schema, which never names it, is accepted');

      // That change lands behind the newest version: on a new line sharing the data.
      const continuation = await deliverResult({ access, appId: 'unused', editing: index.get(WATER)!, text: 'a bigger glass icon', wire: waterWith(drinksWith({})) });
      h.ok(continuation.id !== WATER && access.engineAppId(continuation) === WATER, 'setup: a new line on the same data');
      const next = await buildGenerateRequest(access, readApplied(state), continuation, 'add a mood');
      h.eq(burnedIdFloor(burnedOf(next)).c1, 2, 'its next change still counts v2’s field, on the line it shares the data with');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('version record: a change from an older version that names a never-opened version’s field without a default is refused, as the store would refuse it', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state);
      const [v1] = await waterCounterChanged(state, access, index, [waterWithAmountDelivery()]);
      await access.rollback(index.get(WATER)!, v1);
      const request = await buildGenerateRequest(access, readApplied(state), index.get(WATER)!, 'count the amount');
      const candidate = waterSource({ amount: { id: 'f2', type: 'int' } }); // v2's own field, no default
      const delivered = diffSchemas(readApplied(state)(WATER), drinksWithout({ f2: 'int' }));
      h.ok(delivered.kind === 'conflict' && delivered.errors.some((e) => e.kind === 'missing_default'), 'setup: the store would refuse to open that version');
      h.eq(serverCheck(request, candidate), ['missing_default'], 'the server refuses it before delivery, so a repair can add the default');
      h.eq(request.app?.appliedSchema, readApplied(state)(WATER), 'the applied schema sent is the store’s own, so a server that predates declared fields refuses it too');
      h.eq(serverCheck(request, waterSource({ amount: { id: 'f2', type: 'int', default: '0' } })), [], 'with a default, the same field is accepted');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('version record: a change made after an Undo from Home describes the code it sends, with that version’s manifest and schema, never the copy Home holds', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state);
      const [v1, , v3] = await waterCounterChanged(state, access, index, [await stubDelivery(), pourOverDelivery()]);
      await access.rollback(index.get(WATER)!, v1); // Use this version, then Back to Home
      const homeCopy = index.get(WATER)!;
      await access.rollback(homeCopy, v3); // Undo on Home's toast; Home is not refreshed
      const request = await buildGenerateRequest(access, readApplied(state), homeCopy, 'add laps'); // Change it on the tile
      h.eq(request.app?.source, pourOverDelivery().source, 'the newest version’s code is sent');
      h.eq(request.app?.manifest.capabilities, APP_RECORDS['pour-over-timer'].manifest.capabilities, 'with its own capabilities');
      h.eq(request.app?.schema, {}, 'and no schema it never declared');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('version record: Ask Whim to fix it on an app used at an older version, whose record write failed, describes that version with its own manifest and schema', async () => {
    const state = newDeviceState();
    try {
      const kv = new FailingKv(state.kv);
      const { access, index } = accessOver(state, { kv });
      const [v1] = await waterCounterChanged(state, access, index, [await stubDelivery(), pourOverDelivery()]);
      kv.failing = true;
      await access.rollback(index.get(WATER)!, v1);
      kv.failing = false;
      h.eq(index.get(WATER)!.record.manifest.capabilities, ['cues'], 'setup: the app list still holds the newest version’s record');
      const request = await buildGenerateRequest(access, readApplied(state), index.get(WATER)!, 'Fix the error that stops this app.');
      h.eq(request.app?.source, undefined, 'v1, a seeded example, has no source to send');
      h.eq(request.app?.manifest.capabilities, ['storage'], 'and is described with the storage it declares');
      h.eq(request.app?.schema, APP_RECORDS[WATER].schemaArtifact, 'and its own schema');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('version record: change requests read each saved version once, however many there are', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state);
      const versions = 30;
      await waterCounterChanged(state, access, index, Array.from({ length: versions - 1 }, () => waterWithAmountDelivery()));
      const reads = countSnapshotReads(state);
      const first = await buildGenerateRequest(access, readApplied(state), index.get(WATER)!, 'add a note');
      h.ok(reads.count <= versions, `the first request reads each version at most once (${reads.count} reads, ${versions} versions)`);
      h.eq(first.app?.declaredFields, [{ collection: 'c1', id: 'f2', type: 'int' }], 'and finds the field they declare');
      reads.count = 0;
      await deliverResult({ access, appId: 'unused', editing: index.get(WATER)!, text: 'one more', wire: waterWithAmountDelivery() });
      const second = await buildGenerateRequest(access, readApplied(state), index.get(WATER)!, 'add a mood');
      h.eq(reads.count, 1, 'the next reads only the version saved since');
      h.eq(second.app?.declaredFields, first.app?.declaredFields, 'and sends the same fields');
    } finally {
      disposeDeviceState(state);
    }
  });
}

/** The burned-id view the server builds from `request` (the floor it states and enforces). */
function burnedOf(request: GenerateRequest): AppliedSchema {
  return burnedSchema(request.app?.appliedSchema as unknown as AppliedSchema, request.app?.declaredFields)!;
}

/** The schema diagnostics the server's checker reports for `source` as the change `request` asks for,
 *  given what the server's check stage gives it (the request's applied schema and declared fields). */
function serverCheck(request: GenerateRequest, source: string): string[] {
  const report = runStaticChecks(source, { appliedSchema: request.app?.appliedSchema as unknown as AppliedSchema, declaredFields: request.app?.declaredFields });
  return report.diagnostics.map((d) => d.kind).filter((kind) => SCHEMA_KINDS.has(kind));
}

const SCHEMA_KINDS = new Set(['type_change', 'tombstone_violation', 'missing_default', 'id_below_floor', 'schema_identity_drift']);

/** The Water Counter's source with `extra` Drinks fields (name → id, type, default literal). */
function waterSource(extra: Record<string, { id: string; type: string; default?: string }>): string {
  const source = fs.readFileSync(path.join(process.cwd(), 'fixtures/water-counter.app.tsx'), 'utf8');
  const at = "at: { id: 'f1', type: 'date' }";
  if (!source.includes(at)) throw new Error('the water counter fixture no longer declares its Drinks field as expected');
  const fields = Object.entries(extra).map(([name, f]) => {
    const defaultPart = f.default === undefined ? '' : `, default: ${f.default}`;
    return `${name}: { id: '${f.id}', type: '${f.type}'${defaultPart} }`;
  });
  return source.replace(at, [at, ...fields].join(', '));
}

/** The Water Counter's Drinks collection with `extra` fields (id → type), none with a default. */
function drinksWithout(extra: Record<string, 'text' | 'int'>): SchemaArtifact {
  const schema = drinksWith(extra);
  const drinks = schema.collections.Drinks;
  const fields = Object.fromEntries(Object.entries(drinks.fields).map(([name, f]) => [name, { id: f.id, type: f.type }]));
  return { ...schema, collections: { Drinks: { ...drinks, fields } } };
}

/** Counts the store's whole-version reads from here on. */
function countSnapshotReads(state: DeviceState): { count: number } {
  const counter = { count: 0 };
  const read = state.store.getSnapshot.bind(state.store);
  state.store.getSnapshot = (appId, snapshotId) => {
    counter.count += 1;
    return read(appId, snapshotId);
  };
  return counter;
}

/** The Water Counter's Drinks collection with `extra` fields (id → type), each with a default. */
function drinksWith(extra: Record<string, 'text' | 'int'>): SchemaArtifact {
  const schema = APP_RECORDS[WATER].schemaArtifact!;
  const drinks = schema.collections.Drinks;
  const fields = { ...drinks.fields };
  for (const [id, type] of Object.entries(extra)) fields[`field_${id}`] = { id, type, default: type === 'text' ? '' : 0 };
  return { ...schema, collections: { Drinks: { ...drinks, fields } } };
}

/** A delivery of the Water Counter declaring `schema`. */
function waterWith(schema: SchemaArtifact): WireAppRecord {
  return { ...waterWithNotesDelivery(), schema: schema as unknown as WireAppRecord['schema'] };
}

/** A delivery of the Water Counter that adds an amount (a whole number) to each glass. */
function waterWithAmountDelivery(): WireAppRecord {
  return waterWith(drinksWith({ f2: 'int' }));
}

/** Holds the store's next rollback until the returned release is called. */
function holdNextRollback(state: DeviceState): () => void {
  const store = state.store;
  const rollback = store.rollback.bind(store);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  store.rollback = async (appId, snapshotId) => {
    store.rollback = rollback;
    await gate;
    return rollback(appId, snapshotId);
  };
  return release;
}

/** The launcher KV, whose writes fail while `failing` is set. */
class FailingKv implements KVBackend {
  failing = false;
  constructor(private readonly inner: KVBackend) {}
  getString(key: string) { return this.inner.getString(key); }
  set(key: string, value: string) {
    if (this.failing) throw new Error('the launcher store is unwritable');
    this.inner.set(key, value);
  }
  delete(key: string) { this.inner.delete(key); }
  getAllKeys() { return this.inner.getAllKeys(); }
}
