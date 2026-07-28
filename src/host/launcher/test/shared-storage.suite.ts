/**
 * Shared-storage acceptance suite (tasks 4.1/4.2, linked-apps-data-model chain-3, from
 * shared-storage-acceptance.spec.md). Real `engine`/`launchApp` machinery, file-backed via
 * `createNodeSqlExecutor` (never `:memory:`) so a shared `engineAppId` genuinely means the SAME
 * SQLite file on disk -- exactly what `store-access.ts#engineAppId` resolves grouped entries to.
 * No new detection code (D5): every conflict/coexistence check reuses `launchApp`'s existing
 * `engine.open` guard path unchanged.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createEngine } from '../../storage-engine/engine';
import { createNodeSqlExecutor } from '../../storage-engine/bindings/node-sqlite';
import { SchemaArtifact, StorageEngine } from '../../storage-engine/contract';
import { AppRecord, EngineFactory, launchApp } from '../../bridge';
import { Harness } from './harness';

/** A file-backed engine factory: the SAME appId always resolves to the SAME file on disk --
 *  mirrors the device's `storage/<appId>.db` convention (a group id IS an appId, per
 *  `engineAppId(entry) = entry.storageGroupId ?? entry.id`). */
function fileEngineFactory(dir: string): EngineFactory {
  return (appId: string): StorageEngine => createEngine(createNodeSqlExecutor(path.join(dir, `${appId}.db`)));
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whim-shared-storage-'));
}

const GROUP = 'wc-group';

const notesSchema: SchemaArtifact = {
  schemaVersion: 1,
  collections: {
    Notes: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: 'text' } } },
  },
};

function record(schema: SchemaArtifact): AppRecord {
  return { appId: GROUP, name: 'wc', manifest: { capabilities: ['storage'] }, schemaArtifact: schema };
}

/** Every scenario below runs against one temp dir whose file-backed factory makes a shared
 *  `engineAppId` mean the same SQLite file. Cleanup is in `finally` so a failed assertion
 *  reports itself instead of leaking the directory. */
function withSharedDir(body: (factory: EngineFactory) => void): void {
  const dir = tmpDir();
  try {
    body(fileEngineFactory(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Binds `schema` to the shared file, hands the live engine to `body`, then closes it --
 *  `bind()` always closes the previous realm's engine first (D7). A refused launch is a
 *  test failure, never a silent skip; scenarios that EXPECT a refusal call `launchApp`
 *  directly so they can assert on the structured error. */
function openApp(
  factory: EngineFactory,
  schema: SchemaArtifact,
  who: string,
  body: (engine: StorageEngine) => void,
): void {
  const launched = launchApp(record(schema), factory);
  if (!launched.ok) throw new Error(`${who} launch unexpectedly refused: ` + launched.error.hint);
  try {
    body(launched.realm.engine!);
  } finally {
    launched.realm.engine!.close();
  }
}

/** The founder's opening move in every scenario: one row under its own `body` field. */
function seedFounder(factory: EngineFactory, body: string): void {
  openApp(factory, notesSchema, 'founder', engine => engine.records.append('Notes', { body }));
}

/** Column readers, hoisted to module scope so a scenario callback never nests a `map` arrow a
 *  fifth level deep (typescript:S2004). Two accessors rather than one indexed helper because the
 *  whole point of §4 is that `body` and `notes` are DISTINCT fields under distinct burned ids. */
function bodies(engine: StorageEngine): unknown[] {
  return engine.records.list('Notes').map(r => r.body);
}

function notesOf(engine: StorageEngine): unknown[] {
  return engine.records.list('Notes').map(r => r.notes);
}

export async function runSharedStorageTests(h: Harness): Promise<void> {
  // §1-2 sharer reads the founder's records across a close-then-reopen bind cycle (D7)
  await h.test('shared-storage §1 sharer reads founder\'s records after a close-then-reopen cycle', () => {
    withSharedDir(factory => {
      seedFounder(factory, 'from founder');

      openApp(factory, notesSchema, 'sharer', engine => {
        h.eq(bodies(engine), ['from founder'], 'sharer reads the founder\'s record from the same file');
        engine.records.append('Notes', { body: 'from sharer' });
      });
    });
  });

  await h.test('shared-storage §2 a second reopen still sees everything written so far', () => {
    withSharedDir(factory => {
      seedFounder(factory, 'from founder');
      openApp(factory, notesSchema, 'sharer', engine => engine.records.append('Notes', { body: 'from sharer' }));

      openApp(factory, notesSchema, 'founder relaunch', engine => {
        h.eq(bodies(engine), ['from founder', 'from sharer'], 'a third hop still reads both prior writes');
      });
    });
  });

  // §3 conflicting artifact aborts pre-delivery; shared data untouched (D5)
  await h.test('shared-storage §3 a conflicting artifact fails closed before delivery; data untouched', () => {
    withSharedDir(factory => {
      seedFounder(factory, 'untouched');

      // Reuses burned field id f1 at a different type -- a type_change conflict.
      const conflicting: SchemaArtifact = {
        schemaVersion: 1,
        collections: { Notes: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: 'int' } } } },
      };
      // Expects a REFUSAL, so it calls launchApp directly rather than through openApp.
      const sharer = launchApp(record(conflicting), factory);
      h.ok(!sharer.ok, 'the conflicting launch is refused, not delivered');
      if (!sharer.ok) {
        h.eq(sharer.error.kind, 'type_change', 'the structured error names the conflict class');
        h.ok(sharer.error.hint.length > 0, 'the error carries an actionable hint');
      }

      // Reopen with the founder's ORIGINAL (good) schema: the shared data is unchanged.
      openApp(factory, notesSchema, 'founder reopen', engine => {
        h.eq(bodies(engine), ['untouched'], 'the founder\'s data survives the refused conflicting launch, unchanged');
      });
    });
  });

  // §4 divergent same-named fields coexist (D5)
  await h.test('shared-storage §4 divergent same-named fields under distinct IDs coexist', () => {
    withSharedDir(factory => {
      seedFounder(factory, 'founder note');

      // Same collection id (c1), a DIFFERENT field also display-named "body" under a fresh id (f9)
      // with the default a truly-new field on an existing collection requires.
      const sharerSchema: SchemaArtifact = {
        schemaVersion: 1,
        collections: { Notes: { id: 'c1', tombstones: [], fields: { notes: { id: 'f9', type: 'text', default: '' } } } },
      };
      // Asserts on `ok` rather than throwing, so it calls launchApp directly.
      const sharer = launchApp(record(sharerSchema), factory);
      h.ok(sharer.ok, 'the sharer\'s divergent-id field is a plain additive change, not a conflict');
      if (!sharer.ok) return;
      sharer.realm.engine!.records.append('Notes', { notes: 'sharer note' });
      h.eq(notesOf(sharer.realm.engine!), ['', 'sharer note'], 'sharer sees only its own "notes" field (its own id) -- the founder\'s pre-existing row reads its default');
      sharer.realm.engine!.close();

      openApp(factory, notesSchema, 'founder reopen', engine => {
        h.eq(bodies(engine), ['founder note', null], 'founder sees only its own "body" field (its own id) -- the sharer\'s row has no value under it');
      });
    });
  });
}
