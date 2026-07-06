/**
 * Node test runner for @whim/server + @whim/contract (harness-server-skeleton). Mirrors
 * src/host/bridge/test/run.mjs: esbuild-bundles the TS acceptance suite and runs it under Node —
 * node:sqlite is a built-in (the metering tests run against the REAL store, not a mock), zero new
 * test dependency. First it type-checks BOTH workspaces (`tsc --noEmit` over contract/ + server/)
 * so type drift fails the gate (SPEC §GS-8). Exits non-zero on any failure, so CI gates on it.
 *
 *   npm run server:test
 */

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

// --- Type-check both workspaces first (SPEC §GS-8) ---
for (const project of ['contract/tsconfig.json', 'server/tsconfig.json']) {
  console.log(`tsc --noEmit -p ${project}`);
  const tsc = spawnSync('npx', ['tsc', '--noEmit', '-p', project], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (tsc.status !== 0) {
    console.error(`\nserver:test FAILED — type errors in ${project}.`);
    process.exit(tsc.status === null ? 1 : tsc.status);
  }
}

// --- Bundle + run the acceptance suite ---
const entry = path.join(here, 'acceptance.ts');
const outfile = path.join(process.cwd(), `.server-acceptance.${process.pid}.tmp.mjs`);

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
});

try {
  await import(pathToFileURL(outfile));
} finally {
  fs.rmSync(outfile, { force: true });
}
