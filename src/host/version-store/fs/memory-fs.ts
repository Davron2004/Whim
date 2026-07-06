/**
 * MemoryFs — the in-memory JS filesystem shim that `isomorphic-git` runs on top of.
 *
 * This is the spike's load-bearing finding (Decision #36, D2): a ~Hermes-safe `fs`
 * implementation with ZERO native modules. It isolates the Hermes-compatibility
 * question from native-FS/new-arch risk, and is exactly the substrate the on-device
 * acceptance ran against. Persistence is a SEPARATE concern layered on top
 * (see KvBackedFs) — this class is pure RAM.
 *
 * It implements the subset of the Node `fs.promises` surface that `isomorphic-git`'s
 * FsClient uses: readFile, writeFile, unlink, readdir, mkdir, rmdir, stat, lstat,
 * readlink, symlink, chmod, rename. Errors carry POSIX `.code` values (ENOENT,
 * ENOTDIR, EEXIST, ENOTEMPTY) because isomorphic-git branches on them.
 */

export interface FsBackend {
  readFile(path: string, options?: { encoding?: string } | string): Promise<Uint8Array | string>;
  writeFile(path: string, data: Uint8Array | string, options?: { mode?: number; encoding?: string } | string): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string, options?: { mode?: number; recursive?: boolean }): Promise<void>;
  rmdir(path: string): Promise<void>;
  stat(path: string): Promise<Stats>;
  lstat(path: string): Promise<Stats>;
  readlink(path: string): Promise<string>;
  symlink(target: string, path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

export type NodeType = 'file' | 'dir' | 'symlink';

export interface FsNode {
  type: NodeType;
  data?: Uint8Array; // files only
  target?: string; // symlinks only
  mode: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
}

export const MODE_FILE = 0o100644;
export const MODE_DIR = 0o040000;
export const MODE_SYMLINK = 0o120000;

function fsError(code: string, message: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: ${message}`) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

/** POSIX-style path normalization: absolute, collapsed, no trailing slash (except root). */
export function normalizePath(p: string): string {
  const parts = p.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return '/' + stack.join('/');
}

export function dirnameOf(p: string): string {
  const n = normalizePath(p);
  const i = n.lastIndexOf('/');
  return i <= 0 ? '/' : n.slice(0, i);
}

export function basenameOf(p: string): string {
  const n = normalizePath(p);
  return n.slice(n.lastIndexOf('/') + 1);
}

export class Stats {
  type: NodeType;
  mode: number;
  size: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  uid = 0;
  gid = 0;
  dev = 1;
  // isomorphic-git reads *Seconds/*Nanoseconds off the raw stat too; expose them.
  mtimeSeconds: number;
  ctimeSeconds: number;
  mtimeNanoseconds: number;
  ctimeNanoseconds: number;

  constructor(node: FsNode, size: number) {
    this.type = node.type;
    this.mode = node.mode;
    this.size = size;
    this.ino = node.ino;
    this.mtimeMs = node.mtimeMs;
    this.ctimeMs = node.ctimeMs;
    this.mtimeSeconds = Math.floor(node.mtimeMs / 1000);
    this.ctimeSeconds = Math.floor(node.ctimeMs / 1000);
    this.mtimeNanoseconds = Math.floor((node.mtimeMs % 1000) * 1e6);
    this.ctimeNanoseconds = Math.floor((node.ctimeMs % 1000) * 1e6);
  }

  isFile(): boolean {
    return this.type === 'file';
  }
  isDirectory(): boolean {
    return this.type === 'dir';
  }
  isSymbolicLink(): boolean {
    return this.type === 'symlink';
  }
}

function toBytes(data: Uint8Array | string): Uint8Array {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  // copy so callers can't mutate our storage
  return data.slice();
}

function decode(bytes: Uint8Array, encoding?: string): string {
  // isomorphic-git only ever asks for utf8 (refs, config, index helpers).
  return new TextDecoder(encoding && encoding !== 'utf-8' ? encoding : 'utf-8').decode(bytes);
}

export class MemoryFs implements FsBackend {
  protected entries = new Map<string, FsNode>();
  protected inoCounter = 1;
  // Monotonic logical clock so every write gets a strictly-increasing mtime —
  // guarantees isomorphic-git's index never mistakes a fresh write for "unchanged".
  protected clock = 1_700_000_000_000;

  constructor() {
    this.entries.set('/', { type: 'dir', mode: MODE_DIR, mtimeMs: this.clock, ctimeMs: this.clock, ino: 0 });
  }

  /** Snapshot of all paths — used by KvBackedFs to enumerate what to persist. */
  protected allEntries(): IterableIterator<[string, FsNode]> {
    return this.entries.entries();
  }

  protected tick(): number {
    return ++this.clock;
  }

  protected nextIno(): number {
    return this.inoCounter++;
  }

  // --- read side -----------------------------------------------------------

  async readFile(path: string, options?: { encoding?: string } | string): Promise<Uint8Array | string> {
    const np = normalizePath(path);
    const node = this.entries.get(np);
    if (!node || node.type === 'dir') throw fsError('ENOENT', `no such file '${path}'`);
    const bytes = node.type === 'symlink' ? new TextEncoder().encode(node.target!) : node.data!;
    const encoding = typeof options === 'string' ? options : options?.encoding;
    if (encoding) return decode(bytes, encoding);
    // Return a Buffer when available (polyfilled on Hermes) for max compatibility.
    return typeof Buffer !== 'undefined' ? Buffer.from(bytes) : bytes.slice();
  }

  async readdir(path: string): Promise<string[]> {
    const np = normalizePath(path);
    const node = this.entries.get(np);
    if (!node) throw fsError('ENOENT', `no such directory '${path}'`);
    if (node.type !== 'dir') throw fsError('ENOTDIR', `not a directory '${path}'`);
    const out: string[] = [];
    for (const key of this.entries.keys()) {
      if (key === np) continue;
      if (dirnameOf(key) === np) out.push(basenameOf(key));
    }
    return out;
  }

  async stat(path: string): Promise<Stats> {
    return this.lstat(path);
  }

  async lstat(path: string): Promise<Stats> {
    const np = normalizePath(path);
    const node = this.entries.get(np);
    if (!node) throw fsError('ENOENT', `no such file or directory '${path}'`);
    const size = node.type === 'file' ? node.data!.length : node.type === 'symlink' ? node.target!.length : 0;
    return new Stats(node, size);
  }

  async readlink(path: string): Promise<string> {
    const np = normalizePath(path);
    const node = this.entries.get(np);
    if (!node || node.type !== 'symlink') throw fsError('ENOENT', `not a symlink '${path}'`);
    return node.target!;
  }

  // --- write side ----------------------------------------------------------

  async writeFile(path: string, data: Uint8Array | string, options?: { mode?: number; encoding?: string } | string): Promise<void> {
    const np = normalizePath(path);
    const parent = dirnameOf(np);
    const parentNode = this.entries.get(parent);
    if (!parentNode || parentNode.type !== 'dir') throw fsError('ENOENT', `no such directory for '${path}'`);
    const existing = this.entries.get(np);
    const mode = (typeof options === 'object' && options?.mode) || existing?.mode || MODE_FILE;
    const t = this.tick();
    const node: FsNode = {
      type: 'file',
      data: toBytes(data),
      mode,
      mtimeMs: t,
      ctimeMs: t,
      ino: existing?.ino ?? this.nextIno(),
    };
    this.entries.set(np, node);
    this.onWrite(np, node);
  }

  async unlink(path: string): Promise<void> {
    const np = normalizePath(path);
    const node = this.entries.get(np);
    if (!node || node.type === 'dir') throw fsError('ENOENT', `no such file '${path}'`);
    this.entries.delete(np);
    this.onDelete(np);
  }

  async mkdir(path: string, _options?: { mode?: number; recursive?: boolean }): Promise<void> {
    const np = normalizePath(path);
    if (this.entries.has(np)) throw fsError('EEXIST', `already exists '${path}'`);
    const parent = dirnameOf(np);
    if (parent !== np) {
      const parentNode = this.entries.get(parent);
      if (!parentNode || parentNode.type !== 'dir') throw fsError('ENOENT', `no such parent directory for '${path}'`);
    }
    const t = this.tick();
    const node: FsNode = { type: 'dir', mode: MODE_DIR, mtimeMs: t, ctimeMs: t, ino: this.nextIno() };
    this.entries.set(np, node);
    this.onWrite(np, node);
  }

  async rmdir(path: string): Promise<void> {
    const np = normalizePath(path);
    const node = this.entries.get(np);
    if (!node) throw fsError('ENOENT', `no such directory '${path}'`);
    if (node.type !== 'dir') throw fsError('ENOTDIR', `not a directory '${path}'`);
    for (const key of this.entries.keys()) {
      if (key !== np && dirnameOf(key) === np) throw fsError('ENOTEMPTY', `directory not empty '${path}'`);
    }
    this.entries.delete(np);
    this.onDelete(np);
  }

  async symlink(target: string, path: string): Promise<void> {
    const np = normalizePath(path);
    const t = this.tick();
    const node: FsNode = { type: 'symlink', target, mode: MODE_SYMLINK, mtimeMs: t, ctimeMs: t, ino: this.nextIno() };
    this.entries.set(np, node);
    this.onWrite(np, node);
  }

  async chmod(path: string, mode: number): Promise<void> {
    const np = normalizePath(path);
    const node = this.entries.get(np);
    if (!node) throw fsError('ENOENT', `no such file '${path}'`);
    node.mode = mode;
    node.ctimeMs = this.tick();
    this.onWrite(np, node);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const from = normalizePath(oldPath);
    const to = normalizePath(newPath);
    const node = this.entries.get(from);
    if (!node) throw fsError('ENOENT', `no such file '${oldPath}'`);
    this.entries.delete(from);
    this.entries.set(to, node);
    this.onDelete(from);
    this.onWrite(to, node);
  }

  /**
   * Recursively remove a path and everything under it — the mechanism behind the version
   * store's `remove(appId)` verb (launcher-shell / #5 D2: delete leaves no per-app residue).
   * Fires `onDelete` per node so KvBackedFs drops the matching KV keys (one repo == one key
   * prefix). No-op on an absent path. Returns the number of paths removed. A sibling whose
   * name merely shares a prefix (`foobar` vs `foo`) is NOT matched — only the exact node and
   * its `<path>/…` descendants.
   */
  removeTree(path: string): number {
    const np = normalizePath(path);
    const prefix = np === '/' ? '/' : np + '/';
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (key === np || key.startsWith(prefix)) {
        this.entries.delete(key);
        this.onDelete(key);
        removed++;
      }
    }
    return removed;
  }

  // --- persistence hooks (overridden by KvBackedFs) ------------------------

  /** Called after a path is created/updated. Base class: no-op (pure RAM). */
  protected onWrite(_path: string, _node: FsNode): void {}
  /** Called after a path is removed. Base class: no-op. */
  protected onDelete(_path: string): void {}

  // --- introspection (used by compaction + tests) --------------------------

  /** Count loose git objects under a repo's .git/objects (the #36 cost driver). */
  countLooseObjects(gitdir: string): number {
    return this.listLooseObjects(gitdir).length;
  }

  /** List loose-object oids under `${gitdir}/objects`, skipping pack/ and info/. */
  listLooseObjects(gitdir: string): string[] {
    const base = normalizePath(gitdir + '/objects');
    const out: string[] = [];
    for (const key of this.entries.keys()) {
      const node = this.entries.get(key)!;
      if (node.type !== 'file') continue;
      const parent = dirnameOf(key);
      if (dirnameOf(parent) !== base) continue; // must be objects/<xx>/<file>
      const shard = basenameOf(parent);
      if (shard === 'pack' || shard === 'info' || shard.length !== 2) continue;
      out.push(shard + basenameOf(key));
    }
    return out;
  }

  /** Total number of stored paths (rough proxy for KV key pressure). */
  size(): number {
    return this.entries.size;
  }
}
