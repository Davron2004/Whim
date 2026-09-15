/**
 * Node runner for the network-deny reproduction canary (design D17 "Reproduce first, then
 * prove"). Mirrors `checks/test/run.mjs` verbatim — esbuild-bundle `canary.ts` to a pid-named
 * temp file, `import()` it, delete the temp file in `finally` — plus `external: ['esbuild',
 * 'typescript']`: `canary.ts` reaches `synthrun/builder.ts`'s `buildCandidateSource`, which
 * imports the `esbuild` package itself, and bundling esbuild into one Node ESM file throws
 * "Dynamic require of \"fs\" is not supported" (memory esbuild-typescript-node-suite). Must run
 * from the repo root, since `synthrun/builder.ts` resolves its own paths off `process.cwd()`.
 *
 * `canary.ts`'s own `main()` calls `process.exit(code)` once its run completes, which is why this
 * file needs no extra exit-code plumbing: the dynamic `import()` below resolves as soon as the
 * module's synchronous top level finishes (which only *starts* `main()`), so the `finally` cleanup
 * runs immediately while the canary keeps listening in the background, and its later
 * `process.exit()` becomes the process's exit code exactly as `checks/test/run.mjs`'s own
 * `acceptance.ts` does today.
 *
 *   node scripts/netdeny/run.mjs canary --expect leak|zero [--bind 127.0.0.1]
 *     [--http-port 8765] [--tls-port 8766] [--seconds 180]
 */

import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'canary.ts');
const outfile = path.join(process.cwd(), `.netdeny-canary.${process.pid}.tmp.mjs`);

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  tsconfigRaw: '{}',
  external: ['esbuild', 'typescript'],
  logLevel: 'warning',
});

try {
  await import(pathToFileURL(outfile));
} finally {
  fs.rmSync(outfile, { force: true });
}
