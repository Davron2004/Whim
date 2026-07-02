/**
 * Node test runner for the storage engine (Decision #40, D7 fast checkpoint). esbuild-
 * bundles the TypeScript acceptance suite and runs it under Node — node:sqlite is a
 * built-in (externalized automatically on the node platform), so there is zero new
 * dependency. Mirrors the version-store runner idiom (src/host/version-store/test/run.mjs).
 * Exits non-zero on any failed check, so CI gates on it (the D5a injection property).
 *
 *   npm run storage:test
 */

import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'acceptance.ts');
const outfile = path.join(process.cwd(), `.storage-acceptance.${process.pid}.tmp.mjs`);

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
