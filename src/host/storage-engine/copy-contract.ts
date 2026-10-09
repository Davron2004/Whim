/**
 * The data-copy seam's types (copy-app-data, design D1/D3). Importable anywhere — no op-sqlite,
 * no node:* import — so the launcher and the Node suites can name a copy without pulling a
 * binding in. The implementations are `copy-device.ts` (op-sqlite) and `copy-node.ts`
 * (node:sqlite); both run `copyStore` from `copy.ts`.
 */

import { AppliedSchema } from './schema';

/** What a finished copy measured: the copy's size on disk and the wall time it took. */
export interface CopyReport {
  bytes: number;
  ms: number;
}

/**
 * Copy the whole store of appId `from` into a new store under appId `to`. Resolves only once the
 * new store is written, closed and verified. Rejects with a `DataCopyError`; after a rejection no
 * file written by the copy remains, and the source store is never written to.
 */
export type CopyStorage = (args: { from: string; to: string }) => Promise<CopyReport>;

export type DataCopyErrorKind = 'no_space' | 'source_unreadable' | 'verify_failed' | 'io';

export class DataCopyError extends Error {
  readonly kind: DataCopyErrorKind;
  /** The underlying binding error, when there was one. */
  readonly cause: unknown;
  constructor(kind: DataCopyErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'DataCopyError';
    this.kind = kind;
    this.cause = cause;
  }
}

/**
 * True when `copy` holds every identity of `source`: each source collection exists in `copy`, and
 * each of its columns, active or retired, exists there with the same type. Whether a column is
 * active or retired is not compared: a writer may move a column between the two while the
 * snapshot is taken, and either way its identity stays burned in the copy.
 */
export function isSupersetSchema(copy: AppliedSchema, source: AppliedSchema): boolean {
  const copyCollections = new Map(copy.collections.map(c => [c.id, c]));
  for (const coll of source.collections) {
    const target = copyCollections.get(coll.id);
    if (!target) return false;
    const targetTypes = new Map([...target.active, ...target.retired].map(c => [c.id, c.type]));
    for (const col of [...coll.active, ...coll.retired]) {
      if (targetTypes.get(col.id) !== col.type) return false;
    }
  }
  return true;
}
