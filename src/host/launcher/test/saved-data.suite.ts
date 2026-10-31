/**
 * "Has this app saved anything?" through `StoreAccess` (copy-app-data task 3.0, rulings 3 and 40
 * revised) over a real version store and real store files: an app no version of which ever declared
 * storage is `false` without its store being touched; one that declares storage has its rows read
 * (a never-run one leaves a table-less store the first run then initialises); the question is asked
 * of the store the entry resolves to (`engineAppId`); and not knowing means asking.
 */

import * as git from 'isomorphic-git';
import { Harness } from './harness';
import { MemoryFs, VersionStore } from '../../version-store';
import type { HasSavedData } from '../store-access';
import type { InstalledApp } from '../app-index';
import { createNodeHasSavedData } from '../../storage-engine/saved-data-node';
import { readAppliedSchemaFromFile } from '../../storage-engine/bindings/node-sqlite';
import type { SchemaArtifact } from '../../storage-engine/contract';
import { accessOver, disposeDeviceState, fileOf, filesOf, installApp, newDeviceState, withEngine, type DeviceState } from './data-copy-rig';

const NOTES: SchemaArtifact = {
  schemaVersion: 1,
  collections: { Notes: { id: 'c1', tombstones: [], fields: { title: { id: 'f1', type: 'text' } } } },
};

/** The real Node read, recording every appId it is asked about. */
function spiedRead(state: DeviceState): { read: HasSavedData; asked: string[] } {
  const asked: string[] = [];
  const real = createNodeHasSavedData(state.dir);
  return {
    asked,
    read: (appId) => {
      asked.push(appId);
      return real(appId);
    },
  };
}

/** A record that declares no storage (a Tier-0 app: no engine is ever opened for it). */
const plainRecord = (id: string) => ({ appId: id, name: id, manifest: { capabilities: [] as string[] } });

/** A device state whose version store sits on `backend`, so a test can see what the store reads. */
function stateOver(backend: MemoryFs): DeviceState {
  let t = 1_700_000_000_000;
  return { ...newDeviceState(), store: new VersionStore({ backend, config: { autoCompact: false, now: () => (t += 1000) } }) };
}

/** Records every path the backend is asked to read from here on. */
function recordReads(backend: MemoryFs): string[] {
  const paths: string[] = [];
  const readFile = backend.readFile.bind(backend);
  backend.readFile = (at, options) => {
    paths.push(at);
    return readFile(at, options);
  };
  return paths;
}

/** Where a file holding `content` is kept in `repo` while the repo is not compacted. */
async function storedAt(repo: string, content: string): Promise<string> {
  const { oid } = await git.hashBlob({ object: content });
  return `/whim/apps/${repo}/.git/objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
}

/** Counts, per version id, each time the store is asked for a version's declaration. */
function countDeclarationReads(store: VersionStore): Record<string, number> {
  const counts: Record<string, number> = {};
  const read = store.declarationOf.bind(store);
  store.declarationOf = (appId, snapshotId) => {
    counts[snapshotId] = (counts[snapshotId] ?? 0) + 1;
    return read(appId, snapshotId);
  };
  return counts;
}

export async function runSavedDataTests(h: Harness): Promise<void> {
  await h.test('saved-data: an app that declares storage but never ran is not saved; its first run initialises the store and what it saves is found', async () => {
    const state = newDeviceState();
    try {
      const spy = spiedRead(state);
      const { access } = accessOver(state, { hasSavedData: spy.read });
      const a = await installApp(access, 'a', NOTES);
      h.eq(await access.hasSavedData(a), false, 'an app that never wrote anything has nothing saved');
      h.eq(spy.asked, ['a'], 'it declares storage, so its store was read');
      h.eq(filesOf(state, 'a'), ['a.db'], 'the read left its store file in place, never deleted');

      withEngine(state, 'a', NOTES, (engine) => engine.kv.set('theme', 'dark'));
      h.eq(readAppliedSchemaFromFile(fileOf(state, 'a')).collections.map((c) => c.id), ['c1'], 'the first run applied its schema over the file the read left');
      h.eq(await access.hasSavedData(a), true, 'what it saved on that run is found (a kv value alone counts)');

      const copy = await access.fork(a, undefined, { data: 'copy' });
      h.eq([copy.storageGroupId, await access.hasSavedData(copy)], [undefined, true], 'a copy made with the data owns a store holding it');
      const fresh = await access.fork(a, undefined, { data: 'fresh' });
      h.eq(await access.hasSavedData(fresh), false, 'a fresh copy holds nothing yet');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('saved-data: an app no version of which declared storage is not saved, its store is never read, and no file is made', async () => {
    const state = newDeviceState();
    try {
      const spy = spiedRead(state);
      const { access } = accessOver(state, { hasSavedData: spy.read });
      const v1 = await access.install({ id: 'p', name: 'p', record: plainRecord('p'), bundleSource: 'V1', prompt: 'p V1' });
      const v2 = await access.update(v1, { record: plainRecord('p'), bundleSource: 'V2', prompt: 'p V2' });
      h.eq((await access.timeline(v2)).length, 2, 'precondition: two saved versions, neither declaring storage');

      h.eq(await access.hasSavedData(v2), false, 'nothing that runs it could ever have saved anything');
      h.eq(spy.asked, [], 'its store was never read');
      h.eq(filesOf(state, 'p'), [], 'and no store file exists for it');
      const copy = await access.fork(v2, undefined, { data: 'fresh' });
      h.eq([await access.hasSavedData(copy), filesOf(state, copy.id)], [false, []], 'the same holds for its copy');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test("saved-data: the storage walk and declaredSchemas read each version's manifest and schema once per process, and never its code", async () => {
    const backend = new MemoryFs();
    const state = stateOver(backend);
    try {
      const { access } = accessOver(state);
      const bundles = ['V1', 'V2', 'V3'];
      let p = await access.install({ id: 'p', name: 'p', record: plainRecord('p'), bundleSource: bundles[0], prompt: 'p V1' });
      for (const bundle of bundles.slice(1)) p = await access.update(p, { record: plainRecord('p'), bundleSource: bundle, prompt: `p ${bundle}` });
      const reads = recordReads(backend);
      const asked = countDeclarationReads(state.store);
      const timesRead = async (content: string) => {
        const at = await storedAt('p', content);
        return reads.filter((r) => r === at).length;
      };

      h.eq(await access.hasSavedData(p), false, 'precondition: no version declares storage, so the walk reads every version');
      h.eq(asked, { g1: 1, g2: 1, g3: 1 }, "the walk asks for each version's declaration once");
      h.ok((await timesRead(JSON.stringify(plainRecord('p').manifest))) > 0, 'reading it reads the saved manifest');
      h.eq(await access.declaredSchemas(p), [], 'declaredSchemas finds no schema');
      h.eq(await access.hasSavedData(p), false, 'and a second walk says the same');
      h.eq(asked, { g1: 1, g2: 1, g3: 1 }, 'neither asks again: the walk and declaredSchemas share what was read');

      const relaunched = accessOver(state).access;
      await relaunched.declaredSchemas(p);
      await relaunched.hasSavedData(p);
      h.eq(asked, { g1: 2, g2: 2, g3: 2 }, 'a relaunched launcher reads each version once more, whichever asks first');
      h.eq(await Promise.all(bundles.map(timesRead)), [0, 0, 0], "no version's code was ever read");
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('saved-data: storage declared only by an older version still counts, so its data is found after a later version dropped storage', async () => {
    const state = newDeviceState();
    try {
      const { access } = accessOver(state);
      const v1 = await installApp(access, 'o', NOTES);
      withEngine(state, 'o', NOTES, (engine) => engine.records.append('Notes', { title: 'kept' }));
      const v2 = await access.update(v1, { record: plainRecord('o'), bundleSource: 'V2', prompt: 'o V2' });
      h.eq(v2.record.manifest.capabilities, [], 'precondition: the version it runs now declares no storage');

      h.eq(await access.hasSavedData(v2), true, 'the older version declared storage, so the store is read and its row found');
      const relaunched = accessOver(state).access;
      h.eq(await relaunched.hasSavedData(v2), true, 'a relaunched launcher, which has read no version yet, says the same');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('saved-data: a version saved before versions kept their manifest cannot tell, so the store is read', async () => {
    const state = newDeviceState();
    try {
      const spy = spiedRead(state);
      const { access, index } = accessOver(state, { hasSavedData: spy.read });
      await state.store.snapshot('legacy', { 'bundle.js': 'V0' }, 'legacy V0');
      const legacy: InstalledApp = { id: 'legacy', name: 'legacy', createdAt: 1, lineageId: 'main', record: plainRecord('legacy') };
      index.put(legacy);
      withEngine(state, 'legacy', NOTES, (engine) => engine.kv.set('k', 1));

      h.eq(await access.hasSavedData(legacy), true, 'its saved data is found, not assumed away');
      h.eq(spy.asked, ['legacy'], 'because its store was read');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('saved-data: a legacy copy that shares its group\'s store sees the group\'s data, asked of the group and not of its own id', async () => {
    const state = newDeviceState();
    try {
      const spy = spiedRead(state);
      const real = createNodeHasSavedData(state.dir);
      const { access } = accessOver(state, { hasSavedData: spy.read });
      const a = await installApp(access, 'a', NOTES);
      withEngine(state, 'a', NOTES, (engine) => engine.records.append('Notes', { title: 'kept' }));
      const member = await access.continueSharingData(a);
      h.eq([member.storageGroupId, access.engineAppId(member)], ['a', 'a'], 'precondition: the member resolves to the group store');
      h.eq(filesOf(state, member.id), [], 'precondition: the member has no store file of its own');

      h.eq(await access.hasSavedData(member), true, "the member's answer is the group's: it has saved data");
      h.eq(spy.asked, ['a'], 'the read was asked of the group store id');
      h.eq(filesOf(state, member.id), [], "the read made no file under the member's own id");
      h.eq(real(member.id), false, "asked of the member's own id the answer would have been \"nothing saved\", which is wrong");
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test("saved-data: a group member whose own versions never declared storage sees the founder's data, declared by the founder's record or by a version made after the member branched", async () => {
    const state = newDeviceState();
    try {
      const spy = spiedRead(state);
      const { access } = accessOver(state, { hasSavedData: spy.read });
      const f1 = await access.install({ id: 'f', name: 'f', record: plainRecord('f'), bundleSource: 'V1', prompt: 'f V1' });
      const member = await access.continueSharingData(f1);
      h.eq(
        [access.engineAppId(member), member.record.manifest.capabilities, (await access.timeline(member)).length],
        ['f', [], 1],
        'precondition: the member shares the founder store and branched at the one version, which declares no storage',
      );
      const f2 = await access.update(f1, {
        record: { appId: 'f', name: 'f', manifest: { capabilities: ['storage'] }, schemaArtifact: NOTES },
        bundleSource: 'V2',
        prompt: 'f V2',
      });
      withEngine(state, 'f', NOTES, (engine) => engine.records.append('Notes', { title: 'kept' }));

      h.eq(await access.hasSavedData(member), true, "the founder's record declares storage, so the member's answer finds the group's row");
      h.eq(spy.asked, ['f'], 'read from the group store');

      await access.update(f2, { record: plainRecord('f'), bundleSource: 'V3', prompt: 'f V3' });
      const relaunched = accessOver(state, { hasSavedData: spy.read }).access;
      h.eq(await relaunched.hasSavedData(member), true, "with no record declaring storage now, the founder's V2 (newer than the member's branch point) still counts");
      h.eq(spy.asked, ['f', 'f'], 'so the group store was read again');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('saved-data: without the read, or when it fails, the answer is "yes" so the question is asked, never skipped', async () => {
    const state = newDeviceState();
    try {
      const plain = accessOver(state, { hasSavedData: null });
      const a = await installApp(plain.access, 'a', NOTES);
      h.eq(await plain.access.hasSavedData(a), true, 'an instance built without the read cannot tell, so it says yes');

      const failing = accessOver(state, {
        hasSavedData: () => {
          throw new Error('disk image is malformed');
        },
      });
      h.eq(await failing.access.hasSavedData(a), true, 'a read that throws is not "nothing saved"');
      const rejecting = accessOver(state, { hasSavedData: () => Promise.reject(new Error('io')) });
      h.eq(await rejecting.access.hasSavedData(a), true, 'nor is a read that rejects');

      const brokenStore = accessOver(state, { hasSavedData: () => false });
      const p = await brokenStore.access.install({ id: 'p', name: 'p', record: plainRecord('p'), bundleSource: 'V1', prompt: 'p V1' });
      const originalTimeline = state.store.timeline.bind(state.store);
      state.store.timeline = () => Promise.reject(new Error('version store unreadable'));
      try {
        h.eq(await brokenStore.access.hasSavedData(p), true, 'nor is a version store that cannot be read');
      } finally {
        state.store.timeline = originalTimeline;
      }
    } finally {
      disposeDeviceState(state);
    }
  });
}
