/**
 * Node runner for the release CLI (design D12). Mirrors `checks/test/run.mjs`: esbuild-bundles
 * `cli.ts` to a pid-named temp file with `tsconfigRaw: '{}'` (the esbuild jsx-runtime gotcha —
 * without it the project tsconfig leaks in) and `external: ['typescript', 'playwright']`
 * (neither bundles cleanly into a Node ESM output; playwright is only ever required behind
 * commands that need it), imports it, deletes the temp file in `finally`, and propagates the
 * exit code `runCli` returns.
 *
 *   node scripts/release/run.mjs <command> [args]
 */

import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'cli.ts');
const outfile = path.join(process.cwd(), `.release-cli.${process.pid}.tmp.mjs`);

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  tsconfigRaw: '{}',
  external: ['typescript', 'playwright'],
  logLevel: 'warning',
});

try {
  const cli = await import(pathToFileURL(outfile));
  process.exitCode = await cli.runCli(process.argv.slice(2));
} finally {
  fs.rmSync(outfile, { force: true });
}
