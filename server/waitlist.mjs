/**
 * Dev runner for the waitlist operator command (beta-waitlist design D8). Mirrors `server/admin.mjs`:
 * bundles src/waitlist/cli.ts → a temp ESM file, imports it, and runs `waitlistMain` against
 * `WHIM_DATA_DIR`. The production image carries the same command prebuilt as
 * `server/whim-waitlist.mjs` (`server/build.mjs`); docs/deploy.md "Operating" shows it on the VM.
 *
 *   node server/waitlist.mjs export --platform android
 *   node server/waitlist.mjs remove someone@example.com
 */

import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'src', 'waitlist', 'cli.ts');
const outfile = path.join(here, `.waitlist-cli.${process.pid}.tmp.mjs`);

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['node:*'],
  logLevel: 'warning',
});

const cleanup = () => { fs.rmSync(outfile, { force: true }); };
process.on('exit', cleanup);

try {
  const { waitlistMain } = await import(pathToFileURL(outfile));
  const result = waitlistMain(process.argv.slice(2), process.env);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
} finally {
  cleanup();
}
