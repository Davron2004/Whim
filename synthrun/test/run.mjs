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
  // that esbuild's bundler cannot resolve statically — same class of gotcha as bundling
  // `typescript` into a Node suite (documented precedent); keep both external and let Node's
  // own `require`/`import` resolve them from `node_modules` at run time.
  external: ['esbuild', 'playwright'],
  logLevel: 'warning',
});

try {
  await import(pathToFileURL(outfile));
} finally {
  fs.rmSync(outfile, { force: true });
}
