/**
 * VersionStore — the host-side, per-mini-app snapshot store (Sections 2, 3, 6).
 *
 * A thin product-verb API over a subset of isomorphic-git. The git vocabulary stays
 * STRICTLY internal (Decision #36 D3 / spec "git is never exposed"): callers pass app
 * ids, opaque snapshot ids (`g1`, `g2`, …), user labels, and lineage ids — never a
 * hash, ref, or git command. The verb→mechanism mapping:
 *
 *   snapshot  → commit (message = the structured prompt) + a tracked prompt.md + a snap tag
 *   history   → log (capped/paginated)
 *   diff      → walk + compare (isomorphic-git has no git.diff)
 *   rollback  → move the lineage's ref + checkout (non-destructive: later snaps stay tagged)
 *   pin       → tag (user label)
 *   fork      → branch THEN checkout (TWO calls — the #36 gotcha)
 *
 * The store is content-agnostic (D6): `snapshot` versions whatever files it is handed
 * plus prompt.md. A future `schema` artifact is tracked like any other file, for free.
 * It enforces the code/data boundary (D2): it holds NO handle to any user-data store
 * and only ever materializes code artifacts into the working tree.
 */

import './polyfills';
import * as git from 'isomorphic-git';
import { MemoryFs } from './fs/memory-fs';
import { VersionStoreConfig, resolveConfig } from './config';
import { compactRepo, CompactionResult } from './compaction';

/** A file map: filename → text content. Code artifacts only — never user data. */
export type Artifacts = Record<string, string>;

/** The typical Tier-0 code-artifact set (task 2.2). Documentation only — the store is
 *  content-agnostic and tracks whatever it is handed (D6), so this is NOT enforced. */
export const TYPICAL_CODE_ARTIFACTS = ['bundle.js', 'manifest.json', 'LEARNED.md', 'prompt.md'];

export interface Snapshot {
  id: string; // opaque snapshot id, e.g. "g3" — NOT a git hash
  prompt: string; // the structured prompt that produced it
  createdAt: number; // epoch ms
}

export interface SnapshotContent extends Snapshot {
  artifacts: Artifacts; // the full materialized code-artifact set at this snapshot
}

export type ChangeStatus = 'added' | 'removed' | 'modified';

export interface FileChange {
  file: string;
  status: ChangeStatus;
  before?: string;
  after?: string;
}

export interface Pin {
  label: string;
  snapshotId: string | null;
}

const SNAP_TAG = (id: string) => `whim/snap/${id}`;
const PIN_TAG = (label: string) => `whim/pin/${label}`;
const AUTHOR = { name: 'Whim', email: 'whim@local' };

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function stripTrailingNewline(s: string): string {
  let out = s;
  while (out.endsWith('\n')) out = out.slice(0, -1);
  return out;
}

/** Classifies a diff() entry from its before/after oids. Missing-before wins over
 *  missing-after (matches the prior nested-ternary precedence exactly). */
function changeStatusOf(aOid: string | undefined, bOid: string | undefined): ChangeStatus {
  if (!aOid) return 'added';
  if (!bOid) return 'removed';
  return 'modified';
}

export interface VersionStoreOptions {
  backend: MemoryFs;
  config?: Partial<VersionStoreConfig>;
}

export class VersionStore {
  private backend: MemoryFs;
  private client: { promises: MemoryFs };
  private config: VersionStoreConfig;

  constructor(options: VersionStoreOptions) {
    // Code/data boundary guard (task 2.3 / D2): the store accepts ONLY an FS backend.
    // It must never be handed a user-data store; reject anything that smells like one.
    for (const forbidden of ['dataStore', 'data', 'database', 'db']) {
      if (forbidden in (options as unknown as Record<string, unknown>)) {
        throw new Error(`VersionStore holds no handle to user data — refusing "${forbidden}" option`);
      }
    }
    this.backend = options.backend;
    this.client = { promises: options.backend };
    this.config = resolveConfig(options.config);
  }

  // --- paths ---------------------------------------------------------------

  private paths(appId: string): { dir: string; gitdir: string } {
    if (!/^[A-Za-z0-9._-]+$/.test(appId)) throw new Error(`invalid app id: ${appId}`);
    const dir = `${this.config.rootDir}/${appId}`;
    return { dir, gitdir: `${dir}/.git` };
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await this.backend.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  private async mkdirp(dir: string): Promise<void> {
    const parts = dir.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      cur += '/' + p;
      if (!(await this.exists(cur))) await this.backend.mkdir(cur);
    }
  }

  /** Init the per-app repo on first use (task 2.1 — one repo per mini-app). */
  private async ensureRepo(appId: string): Promise<{ dir: string; gitdir: string }> {
    const { dir, gitdir } = this.paths(appId);
    if (!(await this.exists(`${gitdir}/HEAD`))) {
      await this.mkdirp(dir);
      await git.init({ fs: this.client, dir, gitdir, defaultBranch: 'main' });
    }
    return { dir, gitdir };
  }

  // --- snapshot-id ↔ oid mapping (kept off the user-facing surface) --------

  private async nextSnapId(gitdir: string): Promise<string> {
    let max = 0;
    for (const tag of await git.listTags({ fs: this.client, gitdir })) {
      const m = /^whim\/snap\/g(\d+)$/.exec(tag);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `g${max + 1}`;
  }

  private async resolveSnap(gitdir: string, snapshotId: string): Promise<string> {
    try {
      return await git.resolveRef({ fs: this.client, gitdir, ref: `refs/tags/${SNAP_TAG(snapshotId)}` });
    } catch {
      throw new Error(`unknown snapshot: ${snapshotId}`);
    }
  }

  private async oidToId(gitdir: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const tag of await git.listTags({ fs: this.client, gitdir })) {
      const m = /^whim\/snap\/(g\d+)$/.exec(tag);
      if (!m) continue;
      const oid = await git.resolveRef({ fs: this.client, gitdir, ref: `refs/tags/${tag}` });
      map.set(oid, m[1]);
    }
    return map;
  }

  // --- working-tree helpers ------------------------------------------------

  private async writeWork(dir: string, name: string, content: string): Promise<void> {
    const full = `${dir}/${name}`;
    await this.mkdirp(full.slice(0, full.lastIndexOf('/')));
    await this.backend.writeFile(full, content);
  }

  /** Read every tracked file at a commit/tree oid (used by getSnapshot / pins). */
  private async readContentAt(gitdir: string, oid: string): Promise<Artifacts> {
    const artifacts: Artifacts = {};
    await git.walk({
      fs: this.client,
      gitdir,
      trees: [git.TREE({ ref: oid })],
      map: async (filepath, [entry]) => {
        if (filepath === '.' || !entry) return undefined;
        if ((await entry.type()) === 'blob') {
          const content = await entry.content();
          if (content) artifacts[filepath] = decodeUtf8(content as Uint8Array);
        }
        return undefined;
      },
    });
    return artifacts;
  }

  // === product verbs =======================================================

  /** snapshot(appId, artifacts, prompt) → commit + tracked prompt.md (task 3.1). */
  async snapshot(appId: string, artifacts: Artifacts, prompt: string): Promise<Snapshot> {
    const { dir, gitdir } = await this.ensureRepo(appId);
    const files: Artifacts = { ...artifacts, 'prompt.md': prompt };

    for (const [name, content] of Object.entries(files)) {
      await this.writeWork(dir, name, content);
      await git.add({ fs: this.client, dir, gitdir, filepath: name });
    }
    // Drop any previously-tracked file no longer in the set (content-agnostic).
    for (const tracked of await git.listFiles({ fs: this.client, dir, gitdir })) {
      if (!(tracked in files)) {
        const full = `${dir}/${tracked}`;
        if (await this.exists(full)) await this.backend.unlink(full);
        await git.remove({ fs: this.client, dir, gitdir, filepath: tracked });
      }
    }

    const ts = Math.floor(this.config.now() / 1000);
    const oid = await git.commit({
      fs: this.client,
      dir,
      gitdir,
      message: prompt,
      author: { ...AUTHOR, timestamp: ts, timezoneOffset: 0 },
    });
    const id = await this.nextSnapId(gitdir);
    await git.tag({ fs: this.client, gitdir, ref: SNAP_TAG(id), object: oid });

    if (this.config.autoCompact && this.backend.countLooseObjects(gitdir) > this.config.compactionThreshold) {
      try {
        await compactRepo(this.client, this.backend, dir, gitdir);
      } catch {
        // Auto-compaction is best-effort. The snapshot (commit + tag) is already
        // durable; a compaction failure must NOT surface to the caller as a rejection.
      }
    }
    return { id, prompt, createdAt: ts * 1000 };
  }

  /** history(appId, {limit}) → log, paginated, no git terms in the shape (task 3.2). */
  async history(appId: string, opts?: { limit?: number }): Promise<Snapshot[]> {
    const { gitdir } = this.paths(appId);
    if (!(await this.exists(`${gitdir}/HEAD`))) return [];
    const limit = opts?.limit ?? this.config.historyLimit;
    let commits: Awaited<ReturnType<typeof git.log>>;
    try {
      commits = await git.log({ fs: this.client, gitdir, ref: 'HEAD', depth: limit });
    } catch (err) {
      if (err instanceof git.Errors.NotFoundError) return []; // unborn HEAD (repo exists, no commits)
      throw err;
    }
    const map = await this.oidToId(gitdir);
    return commits.map(c => {
      const id = map.get(c.oid);
      if (id === undefined) throw new Error(`invariant: commit ${c.oid} has no snap tag`);
      return {
        id,
        prompt: stripTrailingNewline(c.commit.message),
        createdAt: c.commit.author.timestamp * 1000,
      };
    });
  }

  /**
   * timeline(appId, {limit}) → same-line enumeration that survives rollback (design D2).
   * Unlike history() (a tip-ancestry walk), this enumerates every snap tag and keeps the
   * ones on the active lineage's line — ancestors AND tag-reachable descendants of the
   * current tip — via the existing isSameLine predicate, so a snapshot rolled past
   * remains listed (and thus a discoverable roll-forward target). Newest-first by commit
   * timestamp, capped like history(). Same Snapshot shape; no git vocabulary crosses.
   */
  async timeline(appId: string, opts?: { limit?: number }): Promise<Snapshot[]> {
    const { gitdir } = this.paths(appId);
    if (!(await this.exists(`${gitdir}/HEAD`))) return [];
    const limit = opts?.limit ?? this.config.historyLimit;
    let tip: string;
    try {
      tip = await git.resolveRef({ fs: this.client, gitdir, ref: 'HEAD' });
    } catch (err) {
      if (err instanceof git.Errors.NotFoundError) return []; // unborn HEAD (repo exists, no commits)
      throw err;
    }
    const map = await this.oidToId(gitdir);
    const onLine: Array<{ oid: string; id: string }> = [];
    for (const [oid, id] of map) {
      if (await this.isSameLine(gitdir, oid, tip)) onLine.push({ oid, id });
    }
    const snaps: Snapshot[] = [];
    for (const { oid, id } of onLine) {
      const { commit } = await git.readCommit({ fs: this.client, gitdir, oid });
      snaps.push({ id, prompt: stripTrailingNewline(commit.message), createdAt: commit.author.timestamp * 1000 });
    }
    snaps.sort((a, b) => b.createdAt - a.createdAt);
    return snaps.slice(0, limit);
  }

  /** diff(appId, a, b) → walk + compare, per-file change (task 3.3). */
  async diff(appId: string, fromId: string, toId: string): Promise<FileChange[]> {
    const { gitdir } = this.paths(appId);
    const a = await this.resolveSnap(gitdir, fromId);
    const b = await this.resolveSnap(gitdir, toId);
    const changes: FileChange[] = [];
    await git.walk({
      fs: this.client,
      gitdir,
      trees: [git.TREE({ ref: a }), git.TREE({ ref: b })],
      map: async (filepath, [A, B]) => {
        if (filepath === '.') return undefined;
        const aType = A && (await A.type());
        const bType = B && (await B.type());
        if (aType === 'tree' || bType === 'tree') return undefined; // descend
        const aOid = A ? await A.oid() : undefined;
        const bOid = B ? await B.oid() : undefined;
        if (aOid === bOid) return null;
        const status = changeStatusOf(aOid, bOid);
        const beforeBytes = A ? await A.content() : undefined;
        const afterBytes = B ? await B.content() : undefined;
        const before = beforeBytes ? decodeUtf8(beforeBytes as Uint8Array) : undefined;
        const after = afterBytes ? decodeUtf8(afterBytes as Uint8Array) : undefined;
        changes.push({ file: filepath, status, before, after });
        return null;
      },
    });
    return changes;
  }

  /**
   * True iff `target` lies on the same line of history as `tip` (D4 — a "same line"
   * predicate, not full lineage-membership): equal, `target` is an ancestor of `tip`
   * (a rollback), or `tip` is an ancestor of `target` (a roll-forward).
   */
  private async isSameLine(gitdir: string, target: string, tip: string): Promise<boolean> {
    if (target === tip) return true;
    const targetIsAncestorOfTip = await git.isDescendent({ fs: this.client, gitdir, oid: tip, ancestor: target });
    if (targetIsAncestorOfTip) return true;
    return git.isDescendent({ fs: this.client, gitdir, oid: target, ancestor: tip });
  }

  /** rollback(appId, snapshotId) → move lineage ref + checkout; non-destructive (task 3.4). */
  async rollback(appId: string, snapshotId: string): Promise<{ activeId: string }> {
    const { dir, gitdir } = this.paths(appId);
    const oid = await this.resolveSnap(gitdir, snapshotId);
    const branch = (await git.currentBranch({ fs: this.client, gitdir, fullname: false })) || 'main';
    const tip = await git.resolveRef({ fs: this.client, gitdir, ref: `refs/heads/${branch}` });
    if (!(await this.isSameLine(gitdir, oid, tip))) {
      throw new Error(
        `snapshot ${snapshotId} is not in the active lineage — use fork or switchLineage to reach another lineage's history`,
      );
    }
    await git.writeRef({ fs: this.client, gitdir, ref: `refs/heads/${branch}`, value: oid, force: true });
    await git.checkout({ fs: this.client, dir, gitdir, ref: branch, force: true });
    return { activeId: snapshotId };
  }

  /** pin(appId, snapshotId, label) → tag, retrievable by label (task 3.5). */
  async pin(appId: string, snapshotId: string, label: string): Promise<Pin> {
    const { gitdir } = this.paths(appId);
    const oid = await this.resolveSnap(gitdir, snapshotId);
    if (!/^[A-Za-z0-9._-]+$/.test(label)) throw new Error(`invalid pin label: ${label}`);
    await git.tag({ fs: this.client, gitdir, ref: PIN_TAG(label), object: oid, force: true });
    return { label, snapshotId };
  }

  async listPins(appId: string): Promise<Pin[]> {
    const { gitdir } = this.paths(appId);
    if (!(await this.exists(`${gitdir}/HEAD`))) return [];
    const map = await this.oidToId(gitdir);
    const pins: Pin[] = [];
    for (const tag of await git.listTags({ fs: this.client, gitdir })) {
      const m = /^whim\/pin\/(.+)$/.exec(tag);
      if (!m) continue;
      const oid = await git.resolveRef({ fs: this.client, gitdir, ref: `refs/tags/${tag}` });
      pins.push({ label: m[1], snapshotId: map.get(oid) ?? null });
    }
    return pins;
  }

  /** Retrieve a pinned snapshot's full content by its label (spec: survives later gens). */
  async getPinned(appId: string, label: string): Promise<SnapshotContent> {
    const { gitdir } = this.paths(appId);
    let oid: string;
    try {
      oid = await git.resolveRef({ fs: this.client, gitdir, ref: `refs/tags/${PIN_TAG(label)}` });
    } catch {
      throw new Error(`unknown pin: ${label}`);
    }
    return this.snapshotContent(gitdir, oid);
  }

  /** fork(appId, snapshotId) → branch THEN checkout — TWO calls (task 3.6 / #36 gotcha). */
  async fork(appId: string, snapshotId: string): Promise<{ lineageId: string }> {
    const { dir, gitdir } = this.paths(appId);
    const oid = await this.resolveSnap(gitdir, snapshotId);
    const branches = await git.listBranches({ fs: this.client, gitdir });
    let n = 1;
    while (branches.includes(`fork-${n}`)) n++;
    const lineageId = `fork-${n}`;
    // branch({checkout:true}) moves HEAD but does NOT materialize the working tree — so
    // it is TWO calls: create the branch, then check it out.
    await git.branch({ fs: this.client, gitdir, ref: lineageId, object: oid, checkout: false });
    await git.checkout({ fs: this.client, dir, gitdir, ref: lineageId, force: true });
    return { lineageId };
  }

  /** The lineages (independent histories) of an app — the original is "main". */
  async lineages(appId: string): Promise<string[]> {
    const { gitdir } = this.paths(appId);
    if (!(await this.exists(`${gitdir}/HEAD`))) return [];
    return git.listBranches({ fs: this.client, gitdir });
  }

  /** Switch the active lineage so subsequent snapshots build on it (both stay usable). */
  async switchLineage(appId: string, lineageId: string): Promise<{ activeId: string | null }> {
    const { dir, gitdir } = this.paths(appId);
    await git.checkout({ fs: this.client, dir, gitdir, ref: lineageId, force: true });
    return { activeId: await this.activeId(gitdir) };
  }

  /** Full content of a snapshot by its id (used to assert bundle bytes; multi-file). */
  async getSnapshot(appId: string, snapshotId: string): Promise<SnapshotContent> {
    const { gitdir } = this.paths(appId);
    const oid = await this.resolveSnap(gitdir, snapshotId);
    return this.snapshotContent(gitdir, oid, snapshotId);
  }

  /** The currently-active snapshot (HEAD) with its content. */
  async active(appId: string): Promise<SnapshotContent | null> {
    const { gitdir } = this.paths(appId);
    if (!(await this.exists(`${gitdir}/HEAD`))) return null;
    let oid: string;
    try {
      oid = await git.resolveRef({ fs: this.client, gitdir, ref: 'HEAD' });
    } catch {
      return null;
    }
    return this.snapshotContent(gitdir, oid);
  }

  /**
   * remove(appId) → drop an app's entire version history (additive product verb; launcher-shell
   * / #5 D2). The launcher calls this when no installed entry references the repo any longer.
   * KvBackedFs deletes by key prefix, so this collapses every KV key for the repo (one repo ==
   * one prefix). Idempotent: removing an unknown app is a clean no-op. No git vocabulary crosses
   * the surface — the return is a plain product-verb shape.
   */
  async remove(appId: string): Promise<{ removed: boolean }> {
    const { dir } = this.paths(appId);
    const removed = this.backend.removeTree(dir);
    return { removed: removed > 0 };
  }

  /** Manually compact a repo (Section 4); also runs automatically past the threshold. */
  async compact(appId: string): Promise<CompactionResult> {
    const { dir, gitdir } = this.paths(appId);
    return compactRepo(this.client, this.backend, dir, gitdir);
  }

  /** Loose-object count for a repo (test/measurement hook). */
  looseObjectCount(appId: string): number {
    const { gitdir } = this.paths(appId);
    return this.backend.countLooseObjects(gitdir);
  }

  // --- internal ------------------------------------------------------------

  private async activeId(gitdir: string): Promise<string | null> {
    try {
      const oid = await git.resolveRef({ fs: this.client, gitdir, ref: 'HEAD' });
      return (await this.oidToId(gitdir)).get(oid) ?? null;
    } catch {
      return null;
    }
  }

  private async snapshotContent(gitdir: string, oid: string, knownId?: string): Promise<SnapshotContent> {
    const artifacts = await this.readContentAt(gitdir, oid);
    const { commit } = await git.readCommit({ fs: this.client, gitdir, oid });
    const id = knownId ?? (await this.oidToId(gitdir)).get(oid);
    if (id === undefined) throw new Error(`invariant: commit ${oid} has no snap tag`);
    return {
      id,
      prompt: stripTrailingNewline(commit.message),
      createdAt: commit.author.timestamp * 1000,
      artifacts,
    };
  }
}
