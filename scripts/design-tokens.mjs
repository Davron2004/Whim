/**
 * The design-token generator (design-system-v1 D1). Bundles `scripts/lib/design-tokens.ts` (which
 * reads `src/design/tokens.ts`) with esbuild, then either writes every output — the marked tables in
 * `docs/design/system.md`, the mockup's token block, `docs/design/system-v1/palette.json`,
 * `src/design/generated/springs.ts` and `src/design/generated/page.mjs` — or, with `--check`,
 * writes nothing and exits 1 naming each output that drifted from the module.
 *
 *   npm run tokens               # regenerate
 *   npm run tokens -- --check    # drift check (the fast gate runs it through checks:test)
 */

import { build } from 'esbuild';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { tmpBundlePath } from './lib/tmp-bundle.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = tmpBundlePath('design-tokens');

await build({
  entryPoints: [path.join(root, 'scripts/lib/design-tokens.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  tsconfigRaw: '{}',
  logLevel: 'warning',
});

const read = (file) => {
  const p = path.join(root, file);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
};

try {
  const tokens = await import(pathToFileURL(outfile).href);
  if (process.argv.includes('--check')) {
    const drifts = tokens.checkOutputs(read);
    for (const d of drifts) console.error(`tokens drift: ${tokens.formatDrift(d)}`);
    if (drifts.length > 0) {
      console.error('Run `npm run tokens` after changing src/design/tokens.ts; never edit the generated text by hand.');
      process.exitCode = 1;
    } else {
      console.log(`tokens: ${tokens.OUTPUT_FILES.length} outputs match src/design/tokens.ts`);
    }
  } else {
    const { files, problems } = tokens.renderOutputs(read);
    for (const p of problems) console.error(`tokens: ${tokens.formatDrift(p)}`);
    for (const [file, text] of Object.entries(files)) {
      if (read(file) === text) continue;
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
      console.log(`tokens: wrote ${file}`);
    }
    if (problems.length > 0) process.exitCode = 1;
  }
} finally {
  fs.rmSync(outfile, { force: true });
}
