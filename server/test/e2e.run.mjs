/**
 * Node test runner for server/test/e2e.ts (chain 6, task 6.4) — the browser-backed suite. Mirrors
 * `server/test/run.mjs` (esbuild-bundle + run under Node) but WITHOUT the `tsc --noEmit` gate
 * (that stays `server:test`'s job) and with `synthrun`'s own external set added, since this suite
 * pulls in `synthrun/session.ts` (playwright) and `synthrun/report.ts` (transitively `esbuild`,
 * `typescript` via `checks/index.ts` — the same class of gotcha `checks/test/run.mjs` and
 * `synthrun/test/run.mjs` already document: bundling any of the three throws "Dynamic require of
 * \"fs\" is not supported" at import time).
 *
 * Run as `npm run server:e2e`, which `scripts/gate-full.sh` gates on:
 *
 *   node server/test/e2e.run.mjs
 */
import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { serverBundleTarget } from '../build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'e2e.ts');
const serverDir = path.join(here, '..');
// Inside the server workspace, where its externals resolve (`serverBundleTarget`).
const serverBundle = serverBundleTarget('server-e2e', serverDir);

await build({
  entryPoints: [entry],
  ...serverBundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  logLevel: 'warning',
});

try {
  await import(pathToFileURL(serverBundle.outfile));
} finally {
  fs.rmSync(serverBundle.outfile, { force: true });
}
