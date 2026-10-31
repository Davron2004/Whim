/**
 * The file-backed rig the data-copy suites share (copy-app-data tasks 2.4/2.5): a real version
 * store, the launcher KV under the index and the copy journal (one backend, as on the device), and
 * user-data stores as real node:sqlite files in a temp directory — `<dir>/<appId>.db`, the layout
 * both the Node engine and the Node copy opener use. `DeviceState` is what survives a process
 * death; `accessOver` builds a fresh `StoreAccess` over it, which is what a relaunch does.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createMemoryStore, MapKVBackend, type KVBackend, type VersionStore } from '../../version-store';
import { AppIndex, type InstalledApp } from '../app-index';
import { StoreAccess, type DeleteStorage } from '../store-access';
import { DataCopyJournal } from '../data-copy-journal';
import { createEngine } from '../../storage-engine/engine';
import { createNodeSqlExecutor, readAppliedSchemaFromFile } from '../../storage-engine/bindings/node-sqlite';
import { createNodeCopyOpener, createNodeCopyStorage } from '../../storage-engine/copy-node';
import { storeFileName } from '../../storage-engine/copy';
import type { CopyStorage } from '../../storage-engine/copy-contract';
import type { SchemaArtifact, StorageEngine } from '../../storage-engine/contract';
import type { AppliedSchema } from '../../storage-engine/schema';

/** What outlives the process: the storage directory, the launcher KV and the version store. */
export interface DeviceState {
  readonly dir: string;
  readonly kv: MapKVBackend;
  readonly store: VersionStore;
}

export function newDeviceState(): DeviceState {
  let t = 1_700_000_000_000;
  return {
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'whim-data-copy-')),
    kv: new MapKVBackend(),
    store: createMemoryStore({ autoCompact: false, now: () => (t += 1000) }),
  };
}

export function disposeDeviceState(state: DeviceState): void {
  fs.rmSync(state.dir, { recursive: true, force: true });
}

/** The real file delete the device's `deleteStorage` stands for (file plus sidecars). */
export function fileDelete(state: DeviceState): DeleteStorage {
  const opener = createNodeCopyOpener(state.dir);
  return (appId) => opener.remove(appId);
}

export interface Rig {
  access: StoreAccess;
  index: AppIndex;
  journal: DataCopyJournal;
}

/** A launcher over `state`, with the real file-backed seams unless a test swaps one. Pass
 *  `copyStorage: null` for an instance built without the data-copy seam. */
export function accessOver(
  state: DeviceState,
  over: { kv?: KVBackend; deleteStorage?: DeleteStorage; copyStorage?: CopyStorage | null } = {},
): Rig {
  const kv = over.kv ?? state.kv;
  const index = new AppIndex(kv);
  const journal = new DataCopyJournal(kv);
  const deleteStorage = over.deleteStorage ?? fileDelete(state);
  let t = 5000;
  const now = () => (t += 1000);
  const access =
    over.copyStorage === null
      ? new StoreAccess({ store: state.store, index, deleteStorage, now })
      : new StoreAccess({ store: state.store, index, deleteStorage, now, copyStorage: over.copyStorage ?? createNodeCopyStorage(state.dir), copyJournal: journal });
  return { access, index, journal };
}

export function fileOf(state: DeviceState, appId: string): string {
  return path.join(state.dir, storeFileName(appId));
}

/** Every file in the storage directory that belongs to `appId`'s store (the db and any sidecar). */
export function filesOf(state: DeviceState, appId: string): string[] {
  const base = storeFileName(appId);
  return fs.readdirSync(state.dir).filter((f) => f === base || f.startsWith(`${base}-`)).sort((x, y) => x.localeCompare(y));
}

/** A file's size. `lstatSync`, because `scripts/release/lib/preflight.ts` narrows `statSync`'s type
 *  for every file the suites' type-check compiles. */
export function sizeOf(file: string): number {
  return fs.lstatSync(file).size;
}

export function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Open `appId`'s store through the real engine under `schema`, run `body`, close it. */
export function withEngine<T>(state: DeviceState, appId: string, schema: SchemaArtifact, body: (engine: StorageEngine) => T): T {
  const engine = createEngine(createNodeSqlExecutor(fileOf(state, appId)));
  try {
    engine.open(schema);
    return body(engine);
  } finally {
    engine.close();
  }
}

/** The side-effect-free union read generation uses (`generation-request.ts#AppliedSchemaReader`). */
export function readApplied(state: DeviceState): (appId: string) => AppliedSchema {
  return (appId) => readAppliedSchemaFromFile(fileOf(state, appId));
}

/** Install an app that declares storage, carrying `schema` as its artifact. */
export function installApp(access: StoreAccess, id: string, schema: SchemaArtifact, bundleSource = 'V1'): Promise<InstalledApp> {
  return access.install({
    id,
    name: id,
    record: { appId: id, name: id, manifest: { capabilities: ['storage'] }, schemaArtifact: schema },
    bundleSource,
    prompt: `${id} ${bundleSource}`,
    schemaJson: JSON.stringify(schema),
  });
}

/** Race `p` against a timer, so a hang fails its test instead of the whole suite. */
export async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
