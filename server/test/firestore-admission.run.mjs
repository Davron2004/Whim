/**
 * Entry of the Firestore admission load test (#143, design D7). Run only through
 * `deploy/loadtest/firestore-admission.sh`: it starts the emulator for the default run, and for a
 * throwaway-database run it creates the database and deletes it afterwards.
 *
 * Bundles `server/test/firestore-admission-load.ts` the way `firestore.run.mjs` bundles the
 * conformance suite and runs its `main` with this process's arguments. Exits with `main`'s code.
 */

import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { devBundleExternals } from '../build.mjs';
import { tmpBundlePath } from '../../scripts/lib/tmp-bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outfile = tmpBundlePath('firestore-admission-load');

await build({
  stdin: {
    contents: "import { main } from './firestore-admission-load';\nexport const run = main;\n",
    resolveDir: here,
    sourcefile: 'firestore-admission-entry.ts',
    loader: 'ts',
  },
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'warning',
  external: devBundleExternals(path.join(here, '..')),
});

let code;
try {
  const { run } = await import(pathToFileURL(outfile));
  code = await run(process.argv.slice(2), process.env);
} finally {
  fs.rmSync(outfile, { force: true });
}
// A client still retrying a database that went away would hold the process open; the verdict is in.
process.exit(code);
