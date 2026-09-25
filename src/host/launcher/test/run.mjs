/**
 * Node test runner for the launcher core (task 5.4). esbuild-bundles the TypeScript acceptance
 * suite (keeping the pure-JS git deps external so they resolve from node_modules) and runs it.
 * Mirrors the version-store runner idiom. Exits non-zero on any failed check.
 *
 *   npm run launcher:test
 */

import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { tmpBundlePath } from '../../../../scripts/lib/tmp-bundle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'acceptance.ts');
const outfile = tmpBundlePath('launcher-acceptance');

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Keep the runtime deps external — they resolve from node_modules at run time (store-access
  // exercises the real VersionStore over MemoryFs, which pulls isomorphic-git). React's Node
  // build must keep its native require('timers'): async act otherwise falls back to MessageChannel
  // in the ESM bundle and leaves ports open after the suite completes.
  external: ['isomorphic-git', 'pako', 'sha.js', 'crc-32', 'buffer', 'text-encoding-polyfill', 'react', 'react-test-renderer', 'react-error-boundary'],
  alias: {
    'react-native': path.join(here, 'native-host.tsx'),
    'react-native-safe-area-context': path.join(here, 'native-host.tsx'),
    'react-native-webview': path.join(here, 'native-host.tsx'),
    'react-native-mmkv': path.join(here, 'native-storage.ts'),
    '@op-engineering/op-sqlite': path.join(here, 'native-storage.ts'),
  },
  define: { __DEV__: 'false' },
  logLevel: 'warning',
});

try {
  await import(pathToFileURL(outfile));
} finally {
  fs.rmSync(outfile, { force: true });
}
