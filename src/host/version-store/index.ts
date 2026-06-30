/**
 * On-device snapshot store — public API.
 *
 * Build the store with an FS backend (MemoryFs for ephemeral/Node use, KvBackedFs for
 * persistent on-device use), then drive it with PRODUCT VERBS only. No git terminology,
 * commands, or commit identifiers ever cross this surface (spec: "git is never exposed").
 *
 *   import { createMemoryStore } from './version-store';
 *   const store = createMemoryStore();
 *   const snap = await store.snapshot('my-app', { 'bundle.js': '…' }, 'make a tip splitter');
 *   await store.history('my-app');
 */

import { MemoryFs } from './fs/memory-fs';
import { KvBackedFs, KVBackend } from './fs/kv-fs';
import { VersionStore } from './engine';
import { VersionStoreConfig } from './config';

export { VersionStore } from './engine';
export type {
  Artifacts,
  Snapshot,
  SnapshotContent,
  FileChange,
  ChangeStatus,
  Pin,
  VersionStoreOptions,
} from './engine';
export { TYPICAL_CODE_ARTIFACTS } from './engine';
export type { VersionStoreConfig } from './config';
export { DEFAULT_CONFIG } from './config';
export { MemoryFs } from './fs/memory-fs';
export { KvBackedFs, MapKVBackend } from './fs/kv-fs';
export type { KVBackend } from './fs/kv-fs';

/** An ephemeral, RAM-only store (Node tests, throwaway use). */
export function createMemoryStore(config?: Partial<VersionStoreConfig>): VersionStore {
  return new VersionStore({ backend: new MemoryFs(), config });
}

/** A persistent store backed by a key-value blob store (MMKV/AsyncStorage). The repo,
 *  history, pins, and forks survive an app restart — reconstruct over the same KVBackend. */
export function createPersistentStore(kv: KVBackend, config?: Partial<VersionStoreConfig>): VersionStore {
  return new VersionStore({ backend: new KvBackedFs(kv), config });
}

const FORBIDDEN_KEYS = ['oid', 'sha', 'hash', 'commit', 'ref', 'gitdir', 'tree', 'blob', 'head'];
const HEX40 = /^[0-9a-f]{40}$/i;

/**
 * Assert that a value returned by the store leaks NO git terminology or commit
 * identifiers (task 3.7 / spec "git is never exposed"). Throws on the first violation.
 * Used in tests to guard every verb's return shape.
 */
export function assertNoGitLeak(value: unknown, path = '$', skipHexCheck = false): void {
  if (value == null) return;
  if (typeof value === 'string') {
    if (!skipHexCheck && HEX40.test(value)) {
      throw new Error(`git leak at ${path}: looks like a commit hash ("${value}")`);
    }
    return;
  }
  if (typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoGitLeak(v, `${path}[${i}]`, skipHexCheck));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.includes(k.toLowerCase())) {
      throw new Error(`git leak at ${path}.${k}: forbidden key exposes the mechanism`);
    }
    const nextSkip = skipHexCheck || k.toLowerCase() === 'artifacts';
    assertNoGitLeak(v, `${path}.${k}`, nextSkip);
  }
}
