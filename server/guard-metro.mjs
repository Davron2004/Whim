/**
 * guard:metro — proves the Android RN JS bundle still resolves after workspace-ification.
 *
 * Decision (harness-server-skeleton D1; generation-contract §"Metro-safe device consumption"):
 * adding the `contract/` + `server/` npm workspaces hoists their deps into the root
 * node_modules. The hazard is a hoisted package shadowing or duplicating an RN dependency —
 * above all a second `react`. This converts "we believe Metro is unaffected" into a blocking
 * check: a release-mode Metro bundle of `index.js`. Non-zero exit on any resolution failure,
 * so CI (and `npm run guard:metro` locally) gates on it.
 *
 * Pure JS bundling — no Android SDK / native toolchain needed, so it runs on ubuntu-latest.
 *
 *   npm run guard:metro
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(os.tmpdir(), `whim-guard-metro.${process.pid}.jsbundle`);
const reactNativeBin = path.join(repoRoot, 'node_modules', '.bin', 'react-native');

// A real RN release bundle is >1MB; a "successful" run that produced a near-empty file means
// resolution silently degraded. Baseline at authoring time was ~1.83MB.
const MIN_BYTES = 500_000;

const result = spawnSync(
  reactNativeBin,
  [
    'bundle',
    '--platform',
    'android',
    '--dev',
    'false',
    '--entry-file',
    'index.js',
    '--bundle-output',
    out,
    '--reset-cache',
  ],
  { cwd: repoRoot, stdio: 'inherit' },
);

try {
  if (result.status !== 0) {
    console.error(
      `\nguard:metro FAILED — the Android JS bundle did not resolve (exit ${result.status}). ` +
        'A workspace dependency likely shadowed or duplicated an RN dependency.',
    );
    process.exit(result.status === null ? 1 : result.status);
  }
  const bytes = fs.existsSync(out) ? fs.statSync(out).size : 0;
  if (bytes < MIN_BYTES) {
    console.error(
      `\nguard:metro FAILED — bundle output suspiciously small (${bytes} bytes < ${MIN_BYTES}).`,
    );
    process.exit(1);
  }
  console.log(`\nguard:metro OK — Android release bundle resolved (${bytes} bytes).`);
} finally {
  fs.rmSync(out, { force: true });
}
