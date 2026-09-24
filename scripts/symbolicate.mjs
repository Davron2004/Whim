/**
 * Symbolicates a release build's stack (developer-observability D12; docs/release/mobile.md,
 * "Reading a device stack"):
 *
 *   node scripts/symbolicate.mjs <ios|android> <version> <build> [--maps-dir <dir>] < stack.txt
 *
 * Fetches `<platform>/<version>+<build>.map` from the private source-map bucket (or from
 * `--maps-dir`, a local directory laid out like the bucket) and prints the stack with every
 * bundle frame replaced by `source:line:function`. Exits non-zero naming the key when no map
 * exists for it. The work is the release CLI's `symbolicate` command; this runs it from the repo
 * root, whatever the caller's directory.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mapsDirAt = args.indexOf('--maps-dir');
if (mapsDirAt !== -1 && args[mapsDirAt + 1] !== undefined) args[mapsDirAt + 1] = path.resolve(args[mapsDirAt + 1]);

const result = spawnSync(process.execPath, [path.join(here, 'release', 'run.mjs'), 'symbolicate', ...args], {
  cwd: path.resolve(here, '..'),
  stdio: 'inherit',
});
if (result.error) process.stderr.write(`symbolicate: ${result.error.message}\n`);
process.exitCode = result.status ?? 1;
