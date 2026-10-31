/**
 * `npm run android:release -- --device <serial>`: builds the debug-signed `offline` Android
 * variant and installs it on the one named device (or `ANDROID_SERIAL`). The work is the release
 * CLI's `android-release` command; this runs it from the repo root, whatever the caller's directory.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const result = spawnSync(process.execPath, [path.join(here, 'release', 'run.mjs'), 'android-release', ...process.argv.slice(2)], {
  cwd: path.resolve(here, '..'),
  stdio: 'inherit',
});
if (result.error) process.stderr.write(`android-release: ${result.error.message}\n`);
process.exitCode = result.status ?? 1;
