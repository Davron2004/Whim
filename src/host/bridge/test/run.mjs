/**
 * Node test runner for the capability-bridge host core (Decision #41, D8). esbuild-bundles the
 * TypeScript acceptance suite and runs it under Node — node:sqlite is a built-in (so the gate /
 * dispatcher run against the REAL storage engine over a `:memory:` DB, not a mock), zero new
 * dependency. Mirrors the storage-engine runner idiom (src/host/storage-engine/test/run.mjs).
 * Exits non-zero on any failed check, so CI gates on it.
 *
 *   npm run bridge:test
 */

import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'acceptance.ts');
const outfile = path.join(process.cwd(), `.bridge-acceptance.${process.pid}.tmp.mjs`);

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
