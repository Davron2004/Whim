/**
 * KvBackedFs — the persistent FS backend (task 5.1, Decision #36 D4).
 *
 * Strategy: run the same in-memory engine substrate (MemoryFs) the spike validated,
 * but mirror every path mutation to a key-value store (MMKV/AsyncStorage). Zero native
 * *filesystem* surface — the only native dependency is a KV blob store. This is the
 * spike's recommended v0.2 backing.
 *
 * Each FS path becomes ONE KV key (`p:<path>`). That is deliberate: it makes the KV
 * key count track the loose-object count, which #36 identified as the real cost driver
 * (not byte volume). Compaction (pack-then-drop-loose) therefore genuinely collapses
 * KV keys, not just bytes.
 *
 * Cross-restart persistence (the D4 acceptance bar): construct a fresh KvBackedFs over
 * the SAME KVBackend and `hydrate()` rebuilds the entire tree — the repo, full history,
 * pins, and forks all survive intact because git's whole state lives in those paths.
 */

import { MemoryFs, FsNode, dirnameOf, MODE_FILE } from './memory-fs';

/**
 * The minimal key-value surface we need. Deliberately matches `react-native-mmkv`'s
 * instance API exactly (getString/set/delete/getAllKeys), so an MMKV instance can be
 * passed directly. A Map-backed adapter (MapKVBackend) satisfies it for Node tests.
 */
export interface KVBackend {
  getString(key: string): string | undefined | null;
  set(key: string, value: string): void;
  delete(key: string): void;
  getAllKeys(): string[];
}

const KEY_PREFIX = 'p:';

interface SerializedNode {
  t: 'file' | 'dir' | 'symlink';
  m?: number; // mode (only when non-default, for files/symlinks)
  d?: string; // base64 data (files)
  tg?: string; // symlink target
}

function b64encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
function b64decode(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

export class KvBackedFs extends MemoryFs {
  private kv: KVBackend;
  private ready = false;

  constructor(kv: KVBackend) {
    super();
    this.kv = kv;
    this.hydrate();
  }

  /** Rebuild the in-memory tree from persisted KV keys (called on construction). */
  hydrate(): void {
    let maxIno = 0;
    for (const key of this.kv.getAllKeys()) {
      if (!key.startsWith(KEY_PREFIX)) continue;
      const path = key.slice(KEY_PREFIX.length);
      if (path === '/') continue; // root is created by the base constructor
      const raw = this.kv.getString(key);
      if (raw == null) continue;
      const s = JSON.parse(raw) as SerializedNode;
      const ino = this.nextIno();
      const t = this.tick();
      const node: FsNode =
        s.t === 'file'
          ? { type: 'file', data: s.d ? b64decode(s.d) : new Uint8Array(0), mode: s.m ?? MODE_FILE, mtimeMs: t, ctimeMs: t, ino }
          : s.t === 'symlink'
          ? { type: 'symlink', target: s.tg ?? '', mode: s.m ?? 0o120000, mtimeMs: t, ctimeMs: t, ino }
          : { type: 'dir', mode: 0o040000, mtimeMs: t, ctimeMs: t, ino };
      this.entries.set(path, node);
      maxIno = Math.max(maxIno, ino);
    }
    this.inoCounter = maxIno + 1;
    this.ready = true;
  }

  protected onWrite(path: string, node: FsNode): void {
    // Skip during the base constructor (root entry) — kv not assigned yet.
    if (!this.kv) return;
    const s: SerializedNode =
      node.type === 'file'
        ? { t: 'file', m: node.mode === MODE_FILE ? undefined : node.mode, d: b64encode(node.data ?? new Uint8Array(0)) }
        : node.type === 'symlink'
        ? { t: 'symlink', tg: node.target, m: node.mode }
        : { t: 'dir' };
    this.kv.set(KEY_PREFIX + path, JSON.stringify(s));
  }

  protected onDelete(path: string): void {
    if (!this.kv) return;
    this.kv.delete(KEY_PREFIX + path);
  }

  /** Number of persisted KV keys (the metric compaction reduces). */
  kvKeyCount(): number {
    return this.kv.getAllKeys().filter(k => k.startsWith(KEY_PREFIX)).length;
  }
}

/** A Map-backed KVBackend for Node tests and restart simulation. */
export class MapKVBackend implements KVBackend {
  private map: Map<string, string>;
  constructor(map?: Map<string, string>) {
    this.map = map ?? new Map();
  }
  getString(key: string): string | undefined {
    return this.map.get(key);
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  delete(key: string): void {
    this.map.delete(key);
  }
  getAllKeys(): string[] {
    return [...this.map.keys()];
  }
  /** The underlying store — pass into a fresh KvBackedFs to simulate an app restart. */
  raw(): Map<string, string> {
    return this.map;
  }
}

// dirnameOf is re-exported here only to keep the persistence layer self-describing
// for callers that walk the KV namespace; it is the same helper MemoryFs uses.
export { dirnameOf };
