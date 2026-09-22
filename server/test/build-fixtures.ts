/**
 * server/test/build-fixtures.ts — the one production entry-bundle pass `prod-build.suite.ts` and
 * `loadtest.suite.ts` both need (design D26): before this existed, `server/src/main.ts` was
 * bundled twice per gate run for two different assertions over the same output. Memoized so every
 * caller within one suite run shares the single pass.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { bundleServerEntry } from '../build.mjs';

let cached: Promise<string[]> | undefined;

/** Every module esbuild pulls into `server/src/main.ts`'s production bundle, written nowhere
 *  (`write: false`) — just the input list. */
export function productionEntryInputs(): Promise<string[]> {
  cached ??= (async () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-prod-entry-probe-'));
    try {
      return await bundleServerEntry({ entry: 'server/src/main.ts', outfile: path.join(scratch, 'main-probe.mjs'), write: false });
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  })();
  return cached;
}
