/**
 * Single-candidate builder (design D6 — "reuses the production contract, parameterized, not
 * forked"). Mirrors `build/build.mjs`'s `bundleApp` esbuild call FIELD-FOR-FIELD: IIFE,
 * classic JSX, externals `{vc-sdk, react, react-dom}`, `tsconfigRaw: '{}'` (the load-bearing
 * gotcha — without it the project tsconfig's `jsx: "react-jsx"` leaks in and emits an
 * off-allowlist `require("react/jsx-runtime")`). Consumes `build/react-inject-shim.ts`
 * read-only; never edits `build/*`. Pinned byte-equivalent to `build.mjs`'s own output for a
 * fixture app by `synthrun/test/acceptance.ts` (the drift tripwire, spec §Build-contract
 * drift tripwire).
 */
import * as esbuild from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// `process.cwd()` (the repo root), NOT `import.meta.url` — this module is imported by Node
// acceptance suites that esbuild-bundles it together with the test entry into ONE output file
// (the house idiom's known gotcha, `src/host/launcher/test/dev-probe-back-button.suite.ts`'s
// own comment: bundling collapses every module's `import.meta.url` onto the bundle's own URL,
// not each source file's original directory). All Node entry points in this repo (`npm run`
// scripts, this suite) run from the repo root by convention.
const ROOT = process.cwd();

export interface BuildCandidateResult {
  js: string;
  map: string;
}

/**
 * Build ONE candidate from a real file on disk, using the exact production esbuild contract.
 * `entryPath` must be a single TypeScript file importing only `vc-sdk` (the H1b bundle
 * contract). esbuild has no in-memory-entry mode for a bundled build with resolvable
 * externals, so `buildCandidateSource` below materializes a source string to a temp file
 * before calling this.
 */
export async function buildCandidateFile(entryPath: string): Promise<BuildCandidateResult> {
  const out = await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'iife',
    globalName: '__WHIM_APP_MODULE__',
    platform: 'browser',
    target: 'es2019',
    tsconfigRaw: '{}',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    inject: [join(ROOT, 'build/react-inject-shim.ts')],
    external: ['vc-sdk', 'react', 'react-dom', 'react-dom/client'],
    sourcemap: 'external',
    sourcesContent: true,
    // esbuild requires an outdir for the external-map code path even with write:false — no
    // file is ever written to it (build.mjs's own `bundleApp` carries the identical comment).
    // `tmpdir()` here (rather than `build/generated`) keeps this call from even NOMINALLY
    // touching the agent-protected `build/*` tree.
    outdir: tmpdir(),
    minify: false,
    write: false,
    logLevel: 'warning',
  });
  let js = '';
  let map = '';
  for (const f of out.outputFiles) {
    if (f.path.endsWith('.map')) {
      map = f.text;
    } else {
      js = f.text;
    }
  }
  return { js, map };
}

/**
 * Build ONE candidate from a raw TypeScript source string (the harness entry point's actual
 * input shape — spec §One candidate in...). Writes `source` to a uniquely-named temp file
 * (safe under concurrent runs — the filename affects only esbuild's internal bundle
 * identifiers, never the app's runtime behavior) and delegates to `buildCandidateFile`.
 */
export async function buildCandidateSource(
  source: string,
  opts: { filenameHint?: string } = {},
): Promise<BuildCandidateResult> {
  const dir = await mkdtemp(join(tmpdir(), 'synthrun-candidate-'));
  const name = `${opts.filenameHint ?? 'candidate'}.app.tsx`;
  const entryPath = join(dir, name);
  await writeFile(entryPath, source, 'utf8');
  try {
    return await buildCandidateFile(entryPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
