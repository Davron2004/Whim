/**
 * Node acceptance runner for vc-sdk. Each `*.acceptance.ts` / `*.acceptance.tsx`
 * file is a standalone suite, bundled independently so feature chains never need
 * to edit a shared acceptance entry point.
 *
 *   npm run sdk:test
 */

import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entries = fs
  .readdirSync(here)
  .filter((name) => /\.acceptance\.tsx?$/.test(name))
  .sort((a, b) => a.localeCompare(b, 'en'));

if (entries.length === 0) {
  throw new Error('SDK acceptance runner found no *.acceptance.ts(x) suites');
}

for (const entryName of entries) {
  const entry = path.join(here, entryName);
  const suiteName = entryName.replace(/\.acceptance\.tsx?$/, '');
  const outfile = path.join(process.cwd(), `.sdk-${suiteName}.${process.pid}.tmp.mjs`);

  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    tsconfigRaw: '{}',
    external: ['react', 'react-test-renderer'],
    logLevel: 'warning',
  });

  try {
    await import(pathToFileURL(outfile));
  } finally {
    fs.rmSync(outfile, { force: true });
  }
}
