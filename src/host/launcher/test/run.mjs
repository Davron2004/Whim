/**
 * Node test runner for the launcher core (task 5.4). esbuild-bundles the TypeScript acceptance
 * suite (keeping the pure-JS git deps external so they resolve from node_modules) and runs it.
 * Mirrors the version-store runner idiom. Exits non-zero on any failed check.
 *
 *   npm run launcher:test
 */

import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'acceptance.ts');
const outfile = path.join(process.cwd(), `.launcher-acceptance.${process.pid}.tmp.mjs`);

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Keep the runtime deps external — they resolve from node_modules at run time (store-access
  // exercises the real VersionStore over MemoryFs, which pulls isomorphic-git).
  external: ['isomorphic-git', 'pako', 'sha.js', 'crc-32', 'buffer', 'text-encoding-polyfill'],
  logLevel: 'warning',
});

try {
  await import(pathToFileURL(outfile));
} finally {
  fs.rmSync(outfile, { force: true });
}
