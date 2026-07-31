/**
 * generation-request Node suite (task 3.6, #52-D5, generation-loop chain-3): behavioral coverage
 * for `buildGenerateRequest`'s device-seam rules —
 *   - a legacy entry (no `source.ts` snapshot) omits `app.source` entirely
 *   - a grouped entry's `app.appliedSchema` is the whole group's live union, not its own
 *     `record.schemaArtifact`
 *   - a fresh share-data fork inherits the founder's union before it has written anything itself
 *   - a brand-new app (no `editing`) ships no `app` at all
 *
 * `appliedSchema` is exercised against a REAL file-backed storage engine (mirrors
 * `shared-storage.suite.ts`'s file-per-appId convention), so "the union contains both members'
 * fields" is genuine engine behavior, not a stub.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Harness } from './harness';
import { createMemoryStore, MapKVBackend } from '../../version-store';
import { AppIndex } from '../app-index';
import { StoreAccess } from '../store-access';
import { buildGenerateRequest, AppliedSchemaReader } from '../generation-request';
import { createEngine } from '../../storage-engine/engine';
import { createNodeSqlExecutor, readAppliedSchemaFromFile } from '../../storage-engine/bindings/node-sqlite';
import { SchemaArtifact } from '../../storage-engine/contract';
import type { AppRecord } from '../../bridge/contract';

const REC = (id: string, schemaArtifact?: SchemaArtifact): AppRecord => ({
  appId: id,
  name: id,
  manifest: { capabilities: ['storage'] },
  ...(schemaArtifact ? { schemaArtifact } : {}),
});

function harnessAccess() {
  const store = createMemoryStore({ autoCompact: false });
  const index = new AppIndex(new MapKVBackend());
  const access = new StoreAccess({ store, index });
  return { access };
}

/** A file-backed applied-schema reader: the SAME appId always resolves to the SAME file on
 *  disk, mirroring the device's `storage/<appId>.db` convention and `store-access.ts#engineAppId`. */
function fileAppliedReader(dir: string): AppliedSchemaReader {
  return (appId: string) => readAppliedSchemaFromFile(path.join(dir, `${appId}.db`));
}

/** Opens `schema` against `appId`'s file (real engine, real DDL) and closes it — the live-db
 *  side of a scenario, distinct from the entry's own `record.schemaArtifact`. */
function writeLiveSchema(dir: string, appId: string, schema: SchemaArtifact): void {
  const engine = createEngine(createNodeSqlExecutor(path.join(dir, `${appId}.db`)));
  engine.open(schema);
  engine.close();
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whim-generation-request-'));
}

const foundersSchema: SchemaArtifact = {
  schemaVersion: 1,
  collections: { Notes: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: 'text' } } } },
};

const sharersAddedField: SchemaArtifact = {
  schemaVersion: 1,
  collections: { Notes: { id: 'c1', tombstones: [], fields: { notes: { id: 'f9', type: 'text', default: '' } } } },
};

function fieldIds(applied: unknown, collectionId: string): string[] {
  const collections = (applied as { collections: { id: string; active: { id: string }[] }[] }).collections;
  return collections.find(c => c.id === collectionId)?.active.map(c => c.id) ?? [];
}

export async function runGenerationRequestTests(h: Harness): Promise<void> {
  await h.test('generation-request: a brand-new app (no editing) ships no `app` at all', async () => {
    const { access } = harnessAccess();
    const readApplied: AppliedSchemaReader = () => { throw new Error('must not be called for a new-app request'); };
    const request = await buildGenerateRequest(access, readApplied, undefined, 'make me a timer');
    h.eq(request, { prompt: 'make me a timer' }, 'a new-app request is exactly {prompt}, no app key');
  });

  await h.test('generation-request: a legacy entry (no source.ts) omits app.source entirely', async () => {
    const { access } = harnessAccess();
    const dir = tmpDir();
    try {
      const orig = await access.install({ id: 'legacy', name: 'Legacy', record: REC('legacy'), bundleSource: 'BUNDLE', prompt: 'p1' });
      const request = await buildGenerateRequest(access, fileAppliedReader(dir), orig, 'edit legacy app');
      h.ok(request.app != null, 'an editing request still carries an app section');
      h.ok(!('source' in (request.app as object)), 'app.source key must be absent, not merely undefined-valued, for a legacy entry');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await h.test('generation-request: a non-legacy entry sends its real source.ts, not the bundle', async () => {
    const { access } = harnessAccess();
    const dir = tmpDir();
    try {
      const orig = await access.install({ id: 'fresh', name: 'Fresh', record: REC('fresh'), bundleSource: 'BUNDLE_TEXT', source: 'ORIGINAL_TS', prompt: 'p1' });
      const request = await buildGenerateRequest(access, fileAppliedReader(dir), orig, 'edit fresh app');
      h.eq(request.app?.source, 'ORIGINAL_TS', 'app.source is the genuine source.ts artifact');
      h.ok(request.app?.source !== 'BUNDLE_TEXT', 'app.source is never the compiled bundle text');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await h.test('generation-request: a grouped entry ships the whole group\'s live union, not its own record.schemaArtifact', async () => {
    const { access } = harnessAccess();
    const dir = tmpDir();
    try {
      const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc', foundersSchema), bundleSource: 'V1', prompt: 'p1' });
      writeLiveSchema(dir, 'wc', foundersSchema); // founder's own field lands in the group's live db

      const shared = await access.fork(orig, undefined, { shareData: true });
      writeLiveSchema(dir, access.engineAppId(shared), sharersAddedField); // sharer adds its own field to the SAME group file

      // The sharer's own stored record.schemaArtifact never learned about the founder's field —
      // proving appliedSchema is NOT sourced from it.
      const sharedEntryWithOwnSchema = { ...shared, record: REC(shared.id, sharersAddedField) };
      const request = await buildGenerateRequest(access, fileAppliedReader(dir), sharedEntryWithOwnSchema, 'edit sharer');

      h.eq(access.engineAppId(shared), 'wc', 'sanity: the sharer resolves to the founder\'s group id');
      h.ok(fieldIds(request.app?.appliedSchema, 'c1').includes('f1'), 'appliedSchema includes the FOUNDER\'s field (f1) — absent from the sharer\'s own record.schemaArtifact');
      h.ok(fieldIds(request.app?.appliedSchema, 'c1').includes('f9'), 'appliedSchema includes the SHARER\'s own field (f9) too — the whole group\'s union');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await h.test('generation-request: a fresh share-data fork inherits the founder\'s union before writing anything itself', async () => {
    const { access } = harnessAccess();
    const dir = tmpDir();
    try {
      const orig = await access.install({ id: 'wc2', name: 'WC2', record: REC('wc2', foundersSchema), bundleSource: 'V1', prompt: 'p1' });
      writeLiveSchema(dir, 'wc2', foundersSchema); // only the founder has ever written to the group

      const shared = await access.fork(orig, undefined, { shareData: true }); // the fork itself never opens the engine
      const request = await buildGenerateRequest(access, fileAppliedReader(dir), shared, 'edit fresh sharer');

      h.ok(fieldIds(request.app?.appliedSchema, 'c1').includes('f1'), 'a fork that has never written anything still sees the founder\'s field via the shared group id');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await h.test('generation-request: an ungrouped entry with no live db yet gets the empty applied schema', async () => {
    const { access } = harnessAccess();
    const dir = tmpDir();
    try {
      const orig = await access.install({ id: 'never-opened', name: 'Never Opened', record: REC('never-opened'), bundleSource: 'V1', prompt: 'p1' });
      const request = await buildGenerateRequest(access, fileAppliedReader(dir), orig, 'edit');
      h.eq(request.app?.appliedSchema, { collections: [] }, 'no live db yet -> the empty applied schema, not an error');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
