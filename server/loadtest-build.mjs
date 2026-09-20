/**
 * server/loadtest-build.mjs — bundles the load-test entry (design D26; handoff/runtime-tree.md's
 * `bundleServerEntry`) into `server/dist/loadtest/server/loadtest-server.mjs` (+ its source map),
 * the load-test image's `CMD`. Run from the repo root, like `server/build.mjs`:
 *
 *   node server/loadtest-build.mjs
 *
 * Nothing under `server/src/main.ts`'s own bundle graph imports this file or `server/src/loadtest/`
 * (`server/test/loadtest.suite.ts`'s metafile check fails if it ever does) — only
 * `deploy/loadtest/Dockerfile`'s build stage, and the operator, run this directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleServerEntry } from './build.mjs';

const OUT_DIR = path.join('server', 'dist', 'loadtest', 'server');

export async function buildLoadtestServer() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await bundleServerEntry({
    entry: path.join('server', 'loadtest-server.entry.mjs'),
    outfile: path.join(OUT_DIR, 'loadtest-server.mjs'),
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(fs.realpathSync(process.argv[1])).href : '';
if (invokedPath === pathToFileURL(fs.realpathSync(fileURLToPath(import.meta.url))).href) {
  process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  await buildLoadtestServer();
  console.log(`load-test server bundled to ${OUT_DIR}`);
}
