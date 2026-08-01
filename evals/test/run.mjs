/**
 * Node test runner for the corpus-eval harness (`evals/`, design D14). AUTO-DISCOVERS every
 * `evals/test/*.test.ts` file — no hand-maintained registry, so parallel chains adding test
 * files never collide on one shared file. Each discovered file runs its own checks as a
 * module-load side effect (via `check`/`eq`/`section` from `./harness.ts`); this runner
 * generates an entry that imports them all (esbuild `stdin`, so no temp file is written next to
 * the real test files), bundles it, and calls `report()` once. Mirrors `checks/test/run.mjs` /
 * `synthrun/test/run.mjs`, plus `tsconfigRaw: '{}'` (the esbuild jsx-runtime gotcha). Exits
 * non-zero on any failure. Runs with no eval set present — the suite exercises the loader
 * against its own committed fixtures only.
 *
 * Not yet wired to an `npm run` script (chain-G, task 7.1 — package.json is Class-2):
 *   node evals/test/run.mjs
 */
import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));

const testFiles = fs
  .readdirSync(here)
  .filter((name) => name.endsWith('.test.ts'))
  .sort((a, b) => a.localeCompare(b));

const entryContents = [
  ...testFiles.map((name) => `import './${name}';`),
  "import { report } from './harness';",
  'report();',
].join('\n');

const outfile = path.join(process.cwd(), `.evals-acceptance.${process.pid}.tmp.mjs`);

await build({
  stdin: {
    contents: entryContents,
    resolveDir: here,
    sourcefile: 'entry.ts',
    loader: 'ts',
  },
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  tsconfigRaw: '{}',
  logLevel: 'warning',
  // `checks/` (pulled in transitively once a suite exercises Tier A's static leg) imports the
  // `typescript` package, which does its own dynamic `require('fs')` internally — inlining it
  // breaks under esbuild's ESM output (the "esbuild-in-esbuild"-shaped hazard, same family as
  // the live judge's CLI-shellout workaround in `evals/judge/live.ts`).
  //
  // `esbuild`/`playwright` are pulled in transitively via `evals/adapters/synthetic-run.ts`'s
  // re-export of `SynthRunSession`/`createRunCandidate` (`fix/redaction-tier-results`), which
  // drags in the whole `synthrun` barrel — `synthrun/builder.ts`'s own `import * as esbuild`
  // hits the identical esbuild-in-esbuild hazard, and `synthrun/session.ts`'s `playwright`
  // import ships native/optional-platform requires (`fsevents`, `chromium-bidi`'s CJS-only
  // submodules) esbuild cannot bundle either — the exact precedent `synthrun/test/run.mjs`
  // already documents for its own acceptance suite. All three stay external; Node's own
  // `require`/`import` resolves them from `node_modules` at run time instead — no test here
  // calls `SynthRunSession`/`createRunCandidate` (that needs a live Chromium), so the modules
  // are loaded but unused.
  external: ['typescript', 'esbuild', 'playwright'],
});

try {
  await import(pathToFileURL(outfile));
} finally {
  fs.rmSync(outfile, { force: true });
}
