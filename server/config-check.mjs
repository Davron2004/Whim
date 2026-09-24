/**
 * The deploy's server-config check (legal-surface-v2 D9; specs/device-records "A configured
 * keep-period never exceeds its published maximum"). Mirrors `server/admin.mjs`: bundles
 * src/config.ts → a temp ESM file, then runs `loadServerConfig`, the server's own boot parse, over
 * exactly the NAME=value arguments given (the server values `deploy/deploy.sh` is about to write),
 * never over `process.env`. Exits 1 naming the variable when the server would refuse them at boot.
 *
 *   node server/config-check.mjs WHIM_USAGE_IDLE_DAYS=400
 */

import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'src', 'config.ts');
const outfile = path.join(here, `.config-check.${process.pid}.tmp.mjs`);

const env = {};
for (const arg of process.argv.slice(2)) {
  const at = arg.indexOf('=');
  if (at <= 0) {
    process.stderr.write(`config-check: expected NAME=value, got ${JSON.stringify(arg)}\nusage: node server/config-check.mjs [NAME=value ...]\n`);
    process.exit(2);
  }
  env[arg.slice(0, at)] = arg.slice(at + 1);
}

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
  const { loadServerConfig, ServerConfigError } = await import(pathToFileURL(outfile));
  try {
    loadServerConfig(env);
  } catch (err) {
    if (!(err instanceof ServerConfigError)) throw err;
    process.stderr.write(`config-check: ${err.message}\n`);
    process.exitCode = 1;
  }
} finally {
  cleanup();
}
