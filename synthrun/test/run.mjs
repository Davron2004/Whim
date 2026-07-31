/**
 * Node test runner for synthrun (task 1.3). esbuild-bundles the TypeScript acceptance suite
 * and runs it under Node — mirrors `checks/test/run.mjs` / `src/host/bridge/test/run.mjs`
 * verbatim, plus `tsconfigRaw: '{}'` (the esbuild jsx-runtime gotcha). Exits non-zero on any
 * failed check.
 *
 * Not yet wired to an `npm run` script (chain 5, task 5.3 — package.json is Class-2):
 *   node synthrun/test/run.mjs
 */
import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'acceptance.ts');
const outfile = path.join(process.cwd(), `.synthrun-acceptance.${process.pid}.tmp.mjs`);

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  tsconfigRaw: '{}',
  // `esbuild` (task 1.3's builder) and `playwright` (chain 2's real-Chromium collectors/
  // watchdog tests) both ship native/optional-platform requires (fsevents, chromium-bidi, …)
  // that esbuild's bundler cannot resolve statically. `typescript` (chain 5's `runStaticChecks`
  // import, task 5.2) hits the identical class of gotcha — its CJS bundle has requires esbuild
  // can't statically resolve when inlined into an ESM output ("Dynamic require of \"fs\" is not
  // supported"), the exact precedent `checks/test/run.mjs` already documents. All three stay
  // external; Node's own `require`/`import` resolves them from `node_modules` at run time.
  external: ['esbuild', 'playwright', 'typescript'],
  logLevel: 'warning',
});

try {
  await import(pathToFileURL(outfile));
} finally {
  fs.rmSync(outfile, { force: true });
}
