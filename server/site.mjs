/**
 * Site build runner for the Whim pages host (public-generation-server chain-15, design D21–D24).
 * Mirrors `server/dev.mjs`/`server/admin.mjs`: bundles `src/site/build.ts` → a temp ESM file,
 * imports it, then drives `buildSite` with the real filesystem-backed association-files runner
 * (a child process over `scripts/release/run.mjs`, mirroring `scripts/release/run.mjs`'s own
 * bundle-then-run idiom). Argv parsing, stdout and the exit code all live here, untested by
 * design — `build.ts` stays a pure, suite-covered module.
 *
 *   node server/site.mjs build --out <dir>
 */

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const entry = path.join(here, 'src', 'site', 'build.ts');
const outfile = path.join(here, `.site-build.${process.pid}.tmp.mjs`);

const USAGE = 'usage: node server/site.mjs build --out <dir>\n';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  let outDir;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--out') {
      outDir = rest[i + 1];
      i++;
    }
  }
  return { command, outDir };
}

const { command, outDir } = parseArgs(process.argv.slice(2));
if (command !== 'build' || !outDir) {
  process.stderr.write(USAGE);
  process.exitCode = 2;
} else {
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

  try {
    const { buildSite } = await import(pathToFileURL(outfile));

    const runAssociationFiles = (stageDir) => {
      const result = spawnSync(
        process.execPath,
        [path.join(repoRoot, 'scripts', 'release', 'run.mjs'), 'association-files', '--out', stageDir],
        { cwd: repoRoot, stdio: 'inherit' },
      );
      return Promise.resolve({ exitCode: result.status === null ? 1 : result.status });
    };

    const result = await buildSite({
      repoRoot,
      env: process.env,
      outDir: path.resolve(outDir),
      runAssociationFiles,
    });

    if (!result.ok) {
      process.stderr.write(`site build failed: ${result.reason}\n`);
      process.exitCode = 1;
    } else if (result.associationState === 'present') {
      console.log('association files: present');
    } else {
      console.log(`association files: absent (${result.missingPath}); app link verification stays PENDING`);
    }
  } finally {
    fs.rmSync(outfile, { force: true });
  }
}
