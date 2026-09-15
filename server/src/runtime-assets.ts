/**
 * server/src/runtime-assets.ts — every repo file the server reads at run time (design D1;
 * specs/server-deployment "A production build produces a self-contained runtime tree"). This is
 * the one list: `server/build.mjs` copies exactly these files into the runtime tree at their
 * repo-relative paths, and `preflight.ts` checks each is present and readable before the server
 * listens. Every path is relative to the process's working directory, which is the tree root in
 * production and the repo root in dev.
 *
 * The fixture entries are the curated few-shot examples `loadFewShotExamples` sends to the model,
 * listed by name so that a missing file fails boot instead of silently shrinking the prompt.
 * `fixtures/tip-splitter.app.tsx` doubles as the boot self-test candidate (design D16).
 */
export const RUNTIME_ASSETS: readonly string[] = Object.freeze([
  'docs/sdk-reference.md',
  'docs/content-policy.md',
  'fixtures/navigation-demo.app.tsx',
  'fixtures/pour-over-timer.app.tsx',
  'fixtures/style-gallery.app.tsx',
  'fixtures/tip-splitter.app.tsx',
  'fixtures/water-counter.app.tsx',
  'build/react-inject-shim.ts',
  'src/runtime/generated/runtime-artifacts.json',
]);

/** The curated fixture the boot self-test runs through the synthetic run. */
export const SELF_TEST_FIXTURE = 'fixtures/tip-splitter.app.tsx';

/** The harness runtime packages boot resolves from `node_modules` before listening (specs/
 *  server-deployment "Boot fails fast when the runtime is incomplete"). */
export const PREFLIGHT_PACKAGES: readonly string[] = Object.freeze(['esbuild', 'playwright', 'typescript']);
