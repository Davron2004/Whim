/**
 * Where a runner writes the esbuild bundle it is about to import, and the guarantee that it goes.
 *
 * The Node runners (`npm run launcher:test`, `server:test`, `evals:test`, …) bundle TypeScript with
 * esbuild and `import()` the result. The bundle has to live INSIDE the checkout: its external
 * packages (esbuild, typescript, pino, isomorphic-git, react, …) resolve by walking up from the
 * bundle's own location to `<root>/node_modules`, which nothing under os.tmpdir() has.
 *
 * They used to write `<root>/.<name>.<pid>.tmp.mjs` and delete it in a `finally`. That `finally`
 * never runs when the suite calls `process.exit()` — which every suite does on a failure — nor
 * when the runner is killed, so each failed or interrupted run left a 1-2 MB bundle in the repo
 * root (48 of them, 81 MB, in the primary tree by 2026-09-25).
 *
 * Now the bundle goes to `<root>/.tmp-bundles/<name>.<pid>.mjs` (gitignored) and is removed when
 * the process exits, `process.exit()` included. A run killed by a signal leaves its file inside
 * `.tmp-bundles/`, never in the root, and the next runner in the same checkout sweeps it: any
 * bundle whose pid is no longer running and which is older than a minute. The age floor keeps the
 * sweep safe even when the pid belongs to another pid namespace (the devcontainer shares the
 * checkout): a bundle is read once, when it is imported, a moment after it is written.
 */
import fs from 'node:fs';
import path from 'node:path';

export const TMP_BUNDLE_DIR = '.tmp-bundles';

const SWEEP_MIN_AGE_MS = 60_000;
const BUNDLE_NAME = /^.+\.(\d+)\.mjs$/;
const owned = new Set();

function removeOwned() {
  for (const file of owned) fs.rmSync(file, { force: true });
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return err.code === 'EPERM';
  }
}

function sweep(dir, now) {
  for (const entry of fs.readdirSync(dir)) {
    const match = BUNDLE_NAME.exec(entry);
    if (!match || pidAlive(Number(match[1]))) continue;
    const file = path.join(dir, entry);
    let mtimeMs;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch (err) {
      if (err.code === 'ENOENT') continue; // another runner swept it first
      throw err;
    }
    if (now - mtimeMs > SWEEP_MIN_AGE_MS) fs.rmSync(file, { force: true });
  }
}

/**
 * The path to write this process's `<name>` bundle to, under `<root>/.tmp-bundles/`. The file is
 * removed when the process exits; stale bundles of dead runs are swept first.
 *
 * @param {string} name  a short label, e.g. `launcher-acceptance`
 * @param {string} [root]  the checkout root (default: the cwd, which `npm run` sets to it)
 * @returns {string}
 */
export function tmpBundlePath(name, root = process.cwd()) {
  const dir = path.join(root, TMP_BUNDLE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  sweep(dir, Date.now());
  const file = path.join(dir, `${name}.${process.pid}.mjs`);
  if (owned.size === 0) process.once('exit', removeOwned);
  owned.add(file);
  return file;
}
