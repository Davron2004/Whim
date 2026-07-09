/**
 * Node test runner for the static-check pipeline (design D8/D9). esbuild-bundles the
 * TypeScript acceptance suite and runs it under Node — no test framework, house idiom.
 * Mirrors `src/host/bridge/test/run.mjs` verbatim, plus `tsconfigRaw: '{}'` (the esbuild
 * jsx-runtime gotcha, P2 — without it the project tsconfig's `jsx: "react-jsx"` leaks in).
 * Exits non-zero iff a DUE test failed (the greenBy harness, `harness.ts`), so CI/gate.sh
 * gate on it.
 *
 *   npm run checks:test
 */

import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'acceptance.ts');
const outfile = path.join(process.cwd(), `.checks-acceptance.${process.pid}.tmp.mjs`);

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  tsconfigRaw: '{}',
  // `typescript`'s CJS bundle has requires esbuild can't statically resolve when inlined into
  // an ESM output ("Dynamic require of \"fs\" is not supported") — external + Node's own
  // resolution (upward node_modules walk) loads the real package instead (Chain C, task 3.2).
  external: ['typescript'],
  logLevel: 'warning',
});

try {
  await import(pathToFileURL(outfile));
} finally {
  fs.rmSync(outfile, { force: true });
}
