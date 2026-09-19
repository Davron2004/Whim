/**
 * Single-candidate builder (design D6 — "reuses the production contract, parameterized, not
 * forked"). Mirrors `build/build.mjs`'s `bundleApp` esbuild call FIELD-FOR-FIELD: IIFE,
 * classic JSX, externals `{vc-sdk, react, react-dom}`, `tsconfigRaw: '{}'` (the load-bearing
 * gotcha — without it the project tsconfig's `jsx: "react-jsx"` leaks in and emits an
 * off-allowlist `require("react/jsx-runtime")`). Consumes `build/react-inject-shim.ts`
 * read-only; never edits `build/*`. Pinned byte-equivalent to `build.mjs`'s own output for a
 * fixture app by `synthrun/test/acceptance.ts` (the drift tripwire, spec §Build-contract
 * drift tripwire). On top of that contract it adds one thing production does not need: a resolve
 * allowlist plugin, so a candidate build can read no file but its entry and the inject shim.
 */
import * as esbuild from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// `process.cwd()` (the repo root), NOT `import.meta.url` — this module is imported by Node
// acceptance suites that esbuild-bundles it together with the test entry into ONE output file
// (the house idiom's known gotcha, `src/host/launcher/test/dev-probe-back-button.suite.ts`'s
// own comment: bundling collapses every module's `import.meta.url` onto the bundle's own URL,
// not each source file's original directory). All Node entry points in this repo (`npm run`
// scripts, this suite) run from the repo root by convention.
const ROOT = process.cwd();
const REACT_INJECT_SHIM = join(ROOT, 'build/react-inject-shim.ts');

export interface BuildCandidateResult {
  js: string;
  map: string;
}

/** The three host-injected globals a candidate's bundle may name (spec §The candidate build reads
 *  nothing from disk but the runtime shim). Everything else is refused at resolution. */
const HOST_INJECTED_EXTERNALS: ReadonlySet<string> = new Set(['vc-sdk', 'react', 'react-dom']);

/** Leads the text of every build error the resolve allowlist raises, so a refusal is identifiable
 *  in the `build_failure` diagnostic the server's build stage renders from it. */
export const CANDIDATE_RESOLVE_REFUSED = 'candidate_resolve_refused';

/**
 * The builder's own file-read boundary, independent of the static checker (design D5, build side).
 * The entry and the React inject shim are the only files esbuild may resolve, and the three
 * host-injected externals stay external. Every other import, re-export or `require` fails the
 * build at resolution, before esbuild reads a byte of what it names, so nothing of that file can
 * reach the bundle or its source map. The refusal names the specifier only.
 */
function resolveAllowlistPlugin(entryPath: string): esbuild.Plugin {
  const readable = new Set([resolve(entryPath), REACT_INJECT_SHIM]);
  return {
    name: 'synthrun-resolve-allowlist',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') {
          const path = resolve(args.resolveDir, args.path);
          if (readable.has(path)) return { path };
        } else if (HOST_INJECTED_EXTERNALS.has(args.path)) {
          return { path: args.path, external: true };
        }
        return {
          errors: [{ text: `${CANDIDATE_RESOLVE_REFUSED}: "${args.path}" is not resolvable in a candidate build. A candidate may import only 'vc-sdk'.` }],
        };
      });
    },
  };
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
    inject: [REACT_INJECT_SHIM],
    // Kept field-for-field with `build.mjs`. The plugin decides first, so `react-dom/client` is
    // refused here even though it stays listed.
    external: ['vc-sdk', 'react', 'react-dom', 'react-dom/client'],
    plugins: [resolveAllowlistPlugin(entryPath)],
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
