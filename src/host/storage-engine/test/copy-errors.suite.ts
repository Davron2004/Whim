/**
 * How a failed data copy reports a thrown value that is not an Error: a native binding may reject
 * with a plain object, and the copy must still classify it and carry its text. Run from
 * `acceptance.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { createEngine } from '../engine';
import { createNodeSqlExecutor } from '../bindings/node-sqlite';
import { SchemaArtifact } from '../contract';
import { CopyOpener, copyStore, messageOf, storeFileName } from '../copy';
import { createNodeCopyOpener } from '../copy-node';
import { DataCopyError } from '../copy-contract';

import type { CopySuiteHelpers } from './copy.suite';

const notes: SchemaArtifact = {
  schemaVersion: 1,
  collections: { Notes: { id: 'c1', tombstones: [], fields: { title: { id: 'f1', type: 'text' } } } },
};

/** The node opener whose snapshot statement rejects with `thrown`. */
function rejectingSnapshot(dir: string, thrown: unknown): CopyOpener {
  const base = createNodeCopyOpener(dir);
  return {
    ...base,
    open(appId) {
      return { ...base.open(appId), runAsync: () => Promise.reject(thrown) };
    },
  };
}

export async function runCopyErrorTests(root: string, h: CopySuiteHelpers): Promise<void> {
  const { ok, eq, fail } = h;

  const dir = path.join(root, 'copy-errors');
  fs.mkdirSync(dir, { recursive: true });
  const store = createEngine(createNodeSqlExecutor(path.join(dir, storeFileName('src'))));
  store.open(notes);
  store.records.append('Notes', { title: 'one' });
  store.close();

  try {
    await copyStore(rejectingSnapshot(dir, { message: 'database or disk is full' }), { from: 'src', to: 'dst' });
    fail('§H copy: a plain-object rejection: expected a rejection, but the copy resolved');
  } catch (err) {
    ok(err instanceof DataCopyError, '§H copy: a plain-object rejection surfaces as a DataCopyError');
    if (err instanceof DataCopyError) {
      eq(err.kind, 'no_space', '§H copy: a plain-object "database or disk is full" is classified no_space');
      ok(err.message.includes('database or disk is full'), `§H copy: the object's message reaches the error text (got "${err.message}")`);
    }
  }

  eq(messageOf(new Error('boom')), 'boom', '§H copy: an Error reports its message');
  eq(messageOf('plain'), 'plain', '§H copy: a string reports itself');
  eq(messageOf(42), '42', '§H copy: a number is stringified');
  eq(messageOf({ message: 'obj' }), 'obj', '§H copy: an object with a message reports it');
  eq(messageOf({ code: 1 }), 'non-Error object thrown', '§H copy: an object without a message is not stringified');
  eq(messageOf(null), 'non-Error null thrown', '§H copy: null is named, not stringified');
}
