/**
 * Node acceptance for synthrun's candidate builder (task 1.3 — the build-contract drift
 * tripwire, spec §Build-contract drift tripwire). Pins `buildCandidateFile`'s output
 * byte-identical to the CHECKED-IN production artifact `build/generated/tip-splitter.app.js`
 * — the real output of `build/build.mjs`'s own `bundleApp` for the same fixture, refreshed by
 * `npm run build` on every gate run. Reads `build/*` strictly read-only; never re-derives what
 * production emits.
 *
 *   node synthrun/test/run.mjs
 */
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build as esbuild } from 'esbuild';
import { buildCandidateFile } from '../builder';

// `process.cwd()` (the repo root) — NOT `import.meta.url`: `run.mjs` esbuild-bundles this file
// into one output module, which collapses every module's `import.meta.url` onto the bundle's
// own location (see `builder.ts`'s identical comment; house idiom, e.g.
// `src/host/launcher/test/dev-probe-back-button.suite.ts`).
const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, 'fixtures/tip-splitter.app.tsx');
const PRODUCTION_ARTIFACT = path.join(ROOT, 'build/generated/tip-splitter.app.js');

let passed = 0;
const failures: string[] = [];

function ok(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
    return;
  }
  failures.push(msg);
  console.error('  ✗ ' + msg);
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log('• ' + name);
  } catch (err) {
    failures.push(`${name}: threw ${(err as Error).message}`);
    console.error(`  ✗ ${name} THREW: ${(err as Error).stack}`);
  }
}

async function main(): Promise<void> {
  // Asserts via the house `ok()` helper (the storage/bridge/checks acceptance-suite idiom),
  // which S2699 does not recognize.
  // eslint-disable-next-line sonarjs/assertions-in-tests
  await test('byte-equivalence: buildCandidateFile === checked-in production artifact (tip-splitter)', async () => {
    const [harness, production] = await Promise.all([
      buildCandidateFile(FIXTURE),
      readFile(PRODUCTION_ARTIFACT, 'utf8'),
    ]);
    ok(harness.js.length > 0, 'harness builder produced non-empty output');
    ok(harness.js === production, 'harness builder output is byte-identical to the production artifact');
  });

  // RED-CHECK (non-vacuity, task 1.3): perturbing a builder option (the JSX element factory —
  // every JSX element in the fixture goes through it, unlike `jsxFragment`, which only fires
  // for `<>...</>` and tip-splitter uses none) MUST make the two outputs differ — proves the
  // equivalence check above is a real comparison, not a vacuous pass (e.g. both sides trivially
  // empty, or the check never actually running).
  // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
  await test('red-check: a perturbed builder option is caught as drift', async () => {
    const out = await esbuild({
      entryPoints: [FIXTURE],
      bundle: true,
      format: 'iife',
      globalName: '__WHIM_APP_MODULE__',
      platform: 'browser',
      target: 'es2019',
      tsconfigRaw: '{}',
      jsx: 'transform',
      jsxFactory: 'React.createElementPerturbed', // PERTURBED — production uses 'React.createElement'
      jsxFragment: 'React.Fragment',
      inject: [path.join(ROOT, 'build/react-inject-shim.ts')],
      external: ['vc-sdk', 'react', 'react-dom', 'react-dom/client'],
      sourcemap: 'external',
      sourcesContent: true,
      outdir: tmpdir(),
      minify: false,
      write: false,
      logLevel: 'warning',
    });
    const perturbed = out.outputFiles.find((f) => !f.path.endsWith('.map'))?.text ?? '';
    const production = await readFile(PRODUCTION_ARTIFACT, 'utf8');
    ok(perturbed.length > 0, 'perturbed build produced non-empty output');
    ok(perturbed !== production, 'a perturbed jsxFactory IS caught as byte drift (the equivalence check is non-vacuous)');
  });

  console.log('');
  if (failures.length === 0) {
    console.log(`✓ synthrun acceptance: ${passed} checks passed`);
  } else {
    console.error(`✗ synthrun acceptance: ${failures.length} FAILED, ${passed} passed`);
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
}

main();
