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
import { createNodeSqlExecutor } from '../../storage-engine/bindings/node-sqlite';
import { APP_RECORDS } from '../../../runtime/generated/app-records';
import { APP_BUNDLES } from '../../../runtime/generated/app-bundles';
import { createStubPipeline } from '../../../../server/src/pipeline';
import { accessOver, disposeDeviceState, fileOf, newDeviceState, readApplied, type DeviceState } from './data-copy-rig';

const WATER = 'water-counter';

/** One launch of an app: its syscalls, the cues its realm fired, and closing its store. */
interface Session {
  call(method: string, params: Record<string, unknown>): Promise<SysretFrame | null>;
  cues: string[];
  close(): void;
}

/** Launch `entry` as the shell does: its record, under its engine appId, behind the host's table. */
function open(state: DeviceState, access: StoreAccess, entry: InstalledApp): Session {
  const launched = launchApp({ ...entry.record, appId: access.engineAppId(entry) }, (appId) =>
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
  const first = open(state, access, index.get(WATER)!);
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
  const session = open(state, access, entry);
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

  await h.test('version record: a version saved before versions kept their manifest runs with the record the app has', async () => {
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
      h.eq(await access.activeBundle(index.get(WATER)!), APP_BUNDLES[WATER], "and the version's code runs");
    } finally {
      disposeDeviceState(state);
    }
  });
}
