/**
 * Dev runner for the operator command (@whim/server, design D11). Mirrors `server/dev.mjs`:
 * bundles src/admin/main.ts → a temp ESM file, then imports it so the command runs and exits.
 * Node built-ins (node:*) are kept external — `main.ts` only reaches `node:sqlite`/`node:path`,
 * config and the two stores, none of which need synthrun/playwright/esbuild/pino.
 *
 *   node server/admin.mjs reports list --since 7
 *   node server/admin.mjs usage --days 7 --json
 */

import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'src', 'admin', 'main.ts');
const outfile = path.join(here, `.admin-cli.${process.pid}.tmp.mjs`);

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
  await import(pathToFileURL(outfile));
} finally {
  cleanup();
}
