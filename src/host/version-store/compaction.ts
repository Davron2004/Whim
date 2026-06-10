/**
 * DIY compaction — pack-then-drop-loose (Section 4, Decision #36 D5).
 *
 * isomorphic-git has NO `gc`/`prune`/`repack`, so every git object stays loose forever
 * (~4 per generation, #36). Each loose object is a key in the KV-backed FS, so the
 * loose-object COUNT is the real cost driver. This hand-builds the missing gc:
 *   1. collect every reachable oid (all branches + tags + HEAD, with their trees/blobs),
 *   2. `packObjects` them into a single packfile, then `indexPack` so the pack is readable,
 *   3. drop the now-redundant loose copies.
 * Reachability is preserved (every snapshot is tag-reachable), so history / rollback /
 * pin / fork all still resolve — now against the packfile.
 */

import './polyfills';
import * as git from 'isomorphic-git';
import { MemoryFs } from './fs/memory-fs';

export interface CompactionResult {
  before: number; // loose-object count before
  after: number; // loose-object count after
  packed: number; // reachable objects written into the packfile
}

type GitFs = { promises: MemoryFs };

/** Walk a tree oid, collecting it plus every nested tree/blob oid. */
async function collectTree(client: GitFs, gitdir: string, treeOid: string, into: Set<string>): Promise<void> {
  if (into.has(treeOid)) return;
  into.add(treeOid);
  const { tree } = await git.readTree({ fs: client, gitdir, oid: treeOid });
  for (const entry of tree) {
    if (entry.type === 'tree') {
      await collectTree(client, gitdir, entry.oid, into);
    } else {
      into.add(entry.oid);
    }
  }
}

/** Every oid reachable from any ref (branches, tags, HEAD) — the pack input set. */
export async function collectReachable(client: GitFs, gitdir: string): Promise<Set<string>> {
  const reachable = new Set<string>();
  const startOids = new Set<string>();

  for (const branch of await git.listBranches({ fs: client, gitdir })) {
    startOids.add(await git.resolveRef({ fs: client, gitdir, ref: `refs/heads/${branch}` }));
  }
  for (const tag of await git.listTags({ fs: client, gitdir })) {
    startOids.add(await git.resolveRef({ fs: client, gitdir, ref: `refs/tags/${tag}` }));
  }
  try {
    startOids.add(await git.resolveRef({ fs: client, gitdir, ref: 'HEAD' }));
  } catch {
    // unborn HEAD (no commits yet) — nothing to add
  }

  for (const start of startOids) {
    // A tag may point at a non-commit, but ours always point at commits.
    const commits = await git.log({ fs: client, gitdir, ref: start });
    for (const { oid } of commits) {
      reachable.add(oid);
      const { commit } = await git.readCommit({ fs: client, gitdir, oid });
      await collectTree(client, gitdir, commit.tree, reachable);
    }
  }
  return reachable;
}

/**
 * Compact a repo in place. `backend` is the MemoryFs (or subclass) so we can enumerate
 * and delete loose objects through the FS — going through `backend.unlink` means the
 * KV persistence layer (KvBackedFs) drops those keys too.
 */
export async function compactRepo(
  client: GitFs,
  backend: MemoryFs,
  dir: string,
  gitdir: string,
): Promise<CompactionResult> {
  const before = backend.countLooseObjects(gitdir);
  const reachable = await collectReachable(client, gitdir);
  if (reachable.size === 0) return { before, after: before, packed: 0 };

  const { filename } = await git.packObjects({ fs: client, dir, gitdir, oids: [...reachable], write: true });
  // indexPack resolves `filepath` relative to `dir`; the pack lives under .git/objects/pack.
  const packRel = `${gitdir.slice(dir.length).replace(/^\//, '')}/objects/pack/${filename}`;
  await git.indexPack({ fs: client, dir, gitdir, filepath: packRel });

  // Drop the loose copies that are now in the pack (through the FS, so KV keys go too).
  for (const oid of backend.listLooseObjects(gitdir)) {
    if (reachable.has(oid)) {
      await backend.unlink(`${gitdir}/objects/${oid.slice(0, 2)}/${oid.slice(2)}`);
    }
  }

  return { before, after: backend.countLooseObjects(gitdir), packed: reachable.size };
}
