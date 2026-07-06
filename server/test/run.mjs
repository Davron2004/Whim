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
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
// Resolve tsc via Node module resolution so this runs from an in-repo git worktree
// (no local node_modules — resolution walks up to the main repo's, exactly as
// Node/esbuild/tsc already do). A hardcoded repoRoot/node_modules path breaks there.
const tscBin = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const fixedPathEnv = { ...process.env, PATH: '/usr/bin:/bin' };

// --- Type-check both workspaces first (SPEC §GS-8) ---
for (const project of ['contract/tsconfig.json', 'server/tsconfig.json']) {
  console.log(`tsc --noEmit -p ${project}`);
  const tsc = spawnSync(process.execPath, [tscBin, '--noEmit', '-p', project], {
    cwd: repoRoot,
    env: fixedPathEnv,
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
  target: 'node22', // node:sqlite (DatabaseSync) needs Node 22+ — match dev.mjs, not a misleading node20
  logLevel: 'warning',
});

try {
  await import(pathToFileURL(outfile));
} finally {
  fs.rmSync(outfile, { force: true });
}
