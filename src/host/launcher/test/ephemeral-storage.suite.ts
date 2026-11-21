/**
 * The device ephemeral store (mini-app-storage "An ephemeral mode exists for test runs") through the
 * production entrypoint `createStorageEngine` and the op-sqlite binding, over the op-sqlite double,
 * which resolves `open` the way op-sqlite 19 does. Ephemeral writes never reach a file and never
 * reach another ephemeral or persistent store (finding F4: the binding used to open a file named
 * `:memory:` that every ephemeral instance shared across sessions).
 */

import { Harness } from './harness';
import { createStorageEngine } from '../../storage-engine';
import type { SchemaArtifact } from '../../storage-engine/contract';
import { closedDatabases, hasDatabase, open, resetNativeStorage, saveUserData } from './native-storage';

const NOTES: SchemaArtifact = {
  schemaVersion: 1,
  collections: { Notes: { id: 'c1', tombstones: [], fields: { title: { id: 'f1', type: 'text' } } } },
};

export async function runEphemeralStorageTests(h: Harness): Promise<void> {
  await h.test('ephemeral store: a full write-and-close creates no database file', () => {
    resetNativeStorage();
    const store = createStorageEngine({ appId: 'eph-a', mode: 'ephemeral' });
    store.kv.set('count', 3);
    h.eq(store.kv.get('count'), 3, 'the ephemeral store reads back its own write');
    store.close();
    h.ok(!hasDatabase(':memory:'), 'no file named :memory: was created');
    h.ok(!hasDatabase('eph-a.db'), 'no file named after the app was created');
  });

  await h.test('ephemeral store: a later ephemeral or persistent store never sees an earlier ephemeral write', () => {
    resetNativeStorage();
    const first = createStorageEngine({ appId: 'eph-a', mode: 'ephemeral' });
    first.kv.set('secret', 'from the first session');
    first.close();

    const nextSession = createStorageEngine({ appId: 'eph-a', mode: 'ephemeral' });
    h.eq(nextSession.kv.get('secret'), undefined, 'a new ephemeral store for the same app starts empty');
    nextSession.close();

    const otherApp = createStorageEngine({ appId: 'eph-b', mode: 'ephemeral' });
    h.eq(otherApp.kv.get('secret'), undefined, 'an ephemeral store for another app starts empty');
    otherApp.close();

    const persistent = createStorageEngine({ appId: 'eph-a', mode: 'persistent' });
    h.eq(persistent.kv.get('secret'), undefined, 'the persistent store for the same app holds none of it');
    persistent.close();
    resetNativeStorage();
  });

  await h.test('ephemeral store: the full verb lifecycle (kv and records) leaves nothing in the persistent store', () => {
    resetNativeStorage();
    const eph = createStorageEngine({ appId: 'eph-a', mode: 'ephemeral' });
    eph.open(NOTES);
    const { id } = eph.records.append('Notes', { title: 'first' });
    eph.records.append('Notes', { title: 'second' });
    eph.records.update('Notes', id, { title: 'edited' });
    h.eq(eph.records.list('Notes').map((r) => r.title), ['edited', 'second'], 'records append, list and update');
    eph.records.remove('Notes', id);
    h.eq(eph.records.list('Notes').map((r) => r.title), ['second'], 'records remove');
    eph.kv.set('k', 'v');
    eph.kv.remove('k');
    h.eq(eph.kv.get('k'), undefined, 'kv remove');
    eph.close();
    h.ok(!hasDatabase('eph-a.db'), 'no database file was created');

    const persistent = createStorageEngine({ appId: 'eph-a', mode: 'persistent' });
    persistent.open(NOTES);
    h.eq(persistent.records.list('Notes'), [], 'the persistent store holds none of the ephemeral records');
    persistent.close();
    resetNativeStorage();
  });

  await h.test('ephemeral store: closing or deleting it never disturbs the persistent database of that name', () => {
    resetNativeStorage();
    saveUserData('eph-a');
    const memory = open({ name: 'eph-a.db', location: ':memory:' });
    memory.close();
    memory.delete();
    h.ok(hasDatabase('eph-a.db'), 'deleting an in-memory handle leaves the persistent database in place');
    h.eq(closedDatabases.get('eph-a.db') ?? 0, 0, 'closing an in-memory handle is not a close of the persistent database');
    resetNativeStorage();
  });
}
