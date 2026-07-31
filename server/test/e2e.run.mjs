/**
 * Node test runner for server/test/e2e.ts (chain 6, task 6.4) — the browser-backed suite. Mirrors
 * `server/test/run.mjs` (esbuild-bundle + run under Node) but WITHOUT the `tsc --noEmit` gate
 * (that stays `server:test`'s job) and with `synthrun`'s own external set added, since this suite
 * pulls in `synthrun/session.ts` (playwright) and `synthrun/report.ts` (transitively `esbuild`,
 * `typescript` via `checks/index.ts` — the same class of gotcha `checks/test/run.mjs` and
 * `synthrun/test/run.mjs` already document: bundling any of the three throws "Dynamic require of
 * \"fs\" is not supported" at import time).
 *
 * Not yet wired to an `npm run` script (Class-2 — `openspec/changes/generation-loop/
 * pending-class2.md`):
 *
 *   node server/test/e2e.run.mjs
 */
import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'e2e.ts');
const outfile = path.join(process.cwd(), `.server-e2e.${process.pid}.tmp.mjs`);

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['esbuild', 'playwright', 'typescript'],
  logLevel: 'warning',
});

try {
  await import(pathToFileURL(outfile));
} finally {
  fs.rmSync(outfile, { force: true });
}
