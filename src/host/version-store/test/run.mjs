/**
 * Node test runner for the version-store core. esbuild-bundles the TypeScript
 * acceptance suite (keeping the pure-JS git deps external so they resolve from
 * node_modules) and runs it. Matches the project's existing .mjs runner idiom
 * (build/build.mjs, invariants/…). Exits non-zero on any failed check.
 *
 *   npm run vstore:test
 */

import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'acceptance.ts');
// Emit inside the project tree so the external deps resolve from node_modules.
const outfile = path.join(process.cwd(), `.vstore-acceptance.${process.pid}.tmp.mjs`);

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Keep the runtime deps external — they resolve from node_modules at run time.
  external: ['isomorphic-git', 'pako', 'sha.js', 'crc-32', 'buffer', 'text-encoding-polyfill'],
  logLevel: 'warning',
});

try {
  await import(pathToFileURL(outfile));
} finally {
  fs.rmSync(outfile, { force: true });
}
