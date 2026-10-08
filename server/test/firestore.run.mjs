/**
 * Firestore conformance entry for the server stores (durable-server-stores, design D5). Run only
 * through `npm run stores:firestore:test`, which starts the Firestore emulator via a pinned
 * firebase-tools and sets FIRESTORE_EMULATOR_HOST before invoking this file.
 *
 * Bundles `server/test/firestore-conformance.ts` the way `server/test/run.mjs` bundles the
 * acceptance suite and runs it under Node. Exits non-zero on any failure.
 *
 *   npm run stores:firestore:test
 */

import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { devBundleExternals } from '../build.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('stores:firestore:test FAILED — FIRESTORE_EMULATOR_HOST is unset; run via the npm script.');
  process.exit(1);
}

// The whole run takes about 13 s locally; the bound leaves several times that for a loaded CI host.
const WATCHDOG_MS = 60_000;
// The client retries an unreachable emulator for about a minute per call; fail by name instead of
// hanging the gate. Each conformance case also has its own 20 s timeout.
const watchdog = setTimeout(() => {
  console.error(`stores:firestore:test FAILED — the run did not finish within ${WATCHDOG_MS / 1000}s.`);
  process.exit(1);
}, WATCHDOG_MS);

const here = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(process.cwd(), `.firestore-conformance.${process.pid}.tmp.mjs`);

await build({
  entryPoints: [path.join(here, 'firestore-conformance.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'warning',
  // As in `server/test/e2e.run.mjs` (the firestore boot case reaches `synthrun/` through
  // `lifecycle.ts`): the declared runtime packages and the tool packages (`server/build.mjs`).
  external: devBundleExternals(path.join(here, '..')),
});

process.env.WHIM_LOG_JSON = '1';

try {
  await import(pathToFileURL(outfile));
} finally {
  fs.rmSync(outfile, { force: true });
}

clearTimeout(watchdog);
// The unreachable-database case leaves its client retrying in the background (terminating it would
// wait for the retries), so the process exits here rather than when that client gives up.
process.exit(0);
