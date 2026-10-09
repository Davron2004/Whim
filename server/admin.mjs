/**
 * Dev runner for the operator command (@whim/server, design D11). Mirrors `server/dev.mjs`:
 * bundles src/admin/main.ts → a temp ESM file, then imports it so the command runs and exits.
 * Node built-ins and the server's declared runtime packages are kept external.
 *
 *   node server/admin.mjs reports list --since 7
 *   node server/admin.mjs usage --days 7 --json
 */

import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { declaredRuntimePackages } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'src', 'admin', 'main.ts');
const outfile = path.join(here, `.admin-cli.${process.pid}.tmp.mjs`);

// The server's declared runtime packages stay external, as in the production bundle
// (`server/build.mjs`): pino and @google-cloud/firestore are CJS that cannot bundle into ESM.
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['node:*', ...declaredRuntimePackages(here)],
  logLevel: 'warning',
});

const cleanup = () => { fs.rmSync(outfile, { force: true }); };
process.on('exit', cleanup);

try {
  await import(pathToFileURL(outfile));
} finally {
  cleanup();
}
