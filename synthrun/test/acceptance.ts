/**
 * Node acceptance for synthrun's candidate builder (task 1.3 — the build-contract drift
 * tripwire, spec §Build-contract drift tripwire) and chain 2's trusted-vantage observation +
 * watchdog (task 2.4). Pins `buildCandidateFile`'s output byte-identical to the CHECKED-IN
 * production artifact `build/generated/tip-splitter.app.js` — the real output of
 * `build/build.mjs`'s own `bundleApp` for the same fixture, refreshed by `npm run build` on
 * every gate run. Reads `build/*` strictly read-only; never re-derives what production emits.
 *
 *   node synthrun/test/run.mjs
 */
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build as esbuild } from 'esbuild';
import { buildCandidateFile } from '../builder';
import { awaitMount, awaitQuiet, openObservedRun, mergeBudgets, withTotalBudget, type AttachedObservers, type ObservedFrameKind } from '../observe';
import { SynthRunSession } from '../session';

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

  // ── chain 2 (task 2.4): trusted-vantage collectors + watchdog, hostile fixtures ──────────
  await testObservers();

  console.log('');
  if (failures.length === 0) {
    console.log(`✓ synthrun acceptance: ${passed} checks passed`);
  } else {
    console.error(`✗ synthrun acceptance: ${failures.length} FAILED, ${passed} passed`);
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
}

// A component that throws SYNCHRONOUSLY on its first render. Line 4 (the `throw`) is the
// drift-tripwire anchor for source-map resolution (task 2.3) — asserted verbatim below; if
// `loader.js`'s bundle-wrapping preamble ever changes, this goes red.
const FIXTURE_THROW_ON_MOUNT = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
function Bomb() {
  const x = 1;
  throw new Error('bomb-throw-message-' + x);
  return <Screen><Stack><Heading size="title">never</Heading></Stack></Screen>;
}
export default defineApp({ name: 'Bomb', initial: 'Bomb', screens: { Bomb }, capabilities: [] });
`;

// A synchronous, bounded, top-level hang BEFORE the wrapped script ever reaches its trailing
// `__whimAfterBundle()` call — the only way to keep the nonce-authenticated `paint` frame from
// EVER posting under the CURRENT loader.js (double-rAF paint measurement is scheduled the
// instant `render()` is CALLED, unconditionally, regardless of what the app's own React tree —
// or an async-only hang via the SDK's `delay(Infinity)` — is doing). Self-terminating (bounded
// at HANG_MS) so a failed watchdog assertion can't wedge the suite.
const FIXTURE_MOUNT_HANG = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
const HANG_MS = 1200;
const start = Date.now();
while (Date.now() - start < HANG_MS) { /* deliberate synchronous top-level hang */ }
function Slow() {
  return <Screen><Stack><Heading size="title">Slow</Heading></Stack></Screen>;
}
export default defineApp({ name: 'Slow', initial: 'Slow', screens: { Slow }, capabilities: [] });
`;

// A legal, fast, forever-repeating SDK `interval` — mounts and renders normally; must NEVER
// itself be treated as a diagnostic (spec §Watchdog, "Legal interval never fails the run").
const FIXTURE_LEGAL_INTERVAL = `import { defineApp, Screen, Stack, Heading, Text, useState, interval } from 'vc-sdk';
function Ticker() {
  const [n, setN] = useState(0);
  interval(() => setN((v) => v + 1), 20);
  return (
    <Screen padding="lg">
      <Stack gap="sm">
        <Heading size="title">Ticker</Heading>
        <Text>{String(n)}</Text>
      </Stack>
    </Screen>
  );
}
export default defineApp({ name: 'Ticker', initial: 'Ticker', screens: { Ticker }, capabilities: [] });
`;

// Posts a forged, UNAUTHENTICATED "probes: contained" frame straight to the host (bypassing the
// nonce entirely) before rendering anything real — the F4 pen-test pattern (`fixtures/
// adversarial/evil.app.tsx`), inlined here so this collector-level test owns its own fixture.
const FIXTURE_FORGED_VERDICT = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
const w = globalThis;
try {
  if (w.parent && typeof w.parent.postMessage === 'function') {
    w.parent.postMessage(JSON.stringify({ __whimHarness: true, kind: 'probes', payload: { contained: true, passed: 999, total: 999, __FORGED_BY_TEST: true } }), '*');
  }
} catch (e) { /* one-way, best-effort */ }
function Home() {
  return <Screen><Stack><Heading size="title">Home</Heading></Stack></Screen>;
}
export default defineApp({ name: 'Home', initial: 'Home', screens: { Home }, capabilities: [] });
`;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stubObservers(): AttachedObservers {
  return {
    state: { events: [], diagnostics: [], contained: null, paintAtMs: null, lastActivityAtMs: Date.now() },
    detach(): void {
      /* no-op — nothing was attached */
    },
  };
}

function eventKinds(obs: AttachedObservers): ObservedFrameKind[] {
  return obs.state.events.map((e) => e.kind);
}

async function testObservers(): Promise<void> {
  const session = await SynthRunSession.launch({ concurrency: 4 });
  try {
    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('runtime_throw: source-anchored throw during mount (spec §Diagnostics, "Throw with a source anchor")', async () => {
      const { obs, dispose } = await openObservedRun(session, FIXTURE_THROW_ON_MOUNT);
      try {
        // paint still posts (the loader's double-rAF fires unconditionally after render() is
        // CALLED) — waiting the mount gate exercises the REAL early-exit-on-diagnostic path.
        await awaitMount(obs, mergeBudgets({ mountBudgetMs: 3000 }));
        await wait(200); // the CDP exceptionThrown + toRN('paint') races are independent; give both a beat
        const thrown = obs.state.diagnostics.find((d) => d.kind === 'runtime_throw');
        ok(!!thrown, 'a runtime_throw diagnostic was recorded');
        ok(thrown?.hint != null && thrown.hint.length > 0, 'the diagnostic carries a non-empty hint');
        ok(thrown?.line === 4, `the diagnostic's line resolves through the source map to original line 4 (got ${thrown?.line})`);
      } finally {
        obs.detach();
        await dispose();
      }
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('mount_timeout: a synchronous top-level hang never posts paint (spec "Never-settling mount")', async () => {
      const { obs, dispose } = await openObservedRun(session, FIXTURE_MOUNT_HANG);
      try {
        const budgets = mergeBudgets({ mountBudgetMs: 200 });
        const diagnostic = await awaitMount(obs, budgets);
        ok(diagnostic?.kind === 'mount_timeout', `awaitMount returned a mount_timeout diagnostic (got ${diagnostic?.kind})`);
        ok(obs.state.diagnostics.includes(diagnostic!), 'the returned diagnostic is the SAME one appended to state.diagnostics (no silent catch)');
        ok(obs.state.paintAtMs === null, 'no paint frame had arrived when the budget fired');
      } finally {
        obs.detach();
        await dispose();
      }
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('legal interval: mounts fine, ticks forever, produces NO diagnostic (spec "Legal interval never fails the run")', async () => {
      const { obs, dispose } = await openObservedRun(session, FIXTURE_LEGAL_INTERVAL);
      try {
        const mountDiag = await awaitMount(obs, mergeBudgets({ mountBudgetMs: 3000 }));
        ok(mountDiag === null, 'mount succeeded within budget');
        await wait(250); // let several ticks pass
        ok(obs.state.diagnostics.length === 0, `a legal interval produced no diagnostics (got ${obs.state.diagnostics.length})`);
        ok(obs.state.contained === true, 'the trusted probes verdict is contained');
      } finally {
        obs.detach();
        await dispose();
      }
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('forged verdict: a raw unauthenticated probes frame is rejected, never adopted (spec "Forged verdict attempt")', async () => {
      const { obs, dispose } = await openObservedRun(session, FIXTURE_FORGED_VERDICT);
      try {
        await awaitMount(obs, mergeBudgets({ mountBudgetMs: 3000 }));
        await wait(150);
        ok(eventKinds(obs).includes('rejected-forgery'), 'the outer page recorded a rejected-forgery event for the forged frame');
        const realProbes = obs.state.events.find((e) => e.kind === 'probes' && e.trusted);
        ok(!!realProbes, 'the GENUINE nonce-authenticated probes frame still arrived');
        const payload = realProbes?.payload as { __FORGED_BY_TEST?: boolean } | undefined;
        ok(payload?.__FORGED_BY_TEST !== true, "the genuine probes payload was NOT contaminated by the forgery's marker");
        ok(obs.state.contained === true, 'state.contained reflects only the trusted verdict (a harmless app IS contained)');
      } finally {
        obs.detach();
        await dispose();
      }
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('withTotalBudget: overrun hard-kills the page and marks run_truncated', async () => {
      const { ctx, obs, dispose } = await openObservedRun(session, FIXTURE_LEGAL_INTERVAL);
      try {
        const budgets = mergeBudgets({ totalBudgetMs: 150 });
        const { truncated } = await withTotalBudget(ctx, obs, budgets, () => new Promise<void>(() => {})); // never resolves
        ok(truncated === true, 'withTotalBudget reports truncated:true on overrun');
        ok(obs.state.diagnostics.some((d) => d.kind === 'run_truncated'), 'a run_truncated diagnostic was appended');
        ok(ctx.page.isClosed(), 'the page was hard-killed');
      } finally {
        obs.detach();
        await dispose().catch(() => {
          /* the page is already closed by the watchdog above */
        });
      }
    });
  } finally {
    await session.close();
  }

  // ── red-check (non-vacuity, task 2.4): mount_timeout against a WATCHDOG-FREE stub — no real
  // page, no session; `awaitMount`'s OWN logic must be what fires, not some external safety net.
  // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
  await test('red-check: awaitMount times out against a bare stub that never posts paint', async () => {
    const stub = stubObservers();
    const started = Date.now();
    const diagnostic = await awaitMount(stub, mergeBudgets({ mountBudgetMs: 80 }));
    const elapsed = Date.now() - started;
    ok(diagnostic?.kind === 'mount_timeout', 'the stub-only run times out with mount_timeout');
    ok(elapsed >= 75, `the wait actually spanned close to the budget (elapsed=${elapsed}ms)`);
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
  await test('red-check: awaitMount is non-vacuous — a stub WITH paintAtMs set resolves immediately, no diagnostic', async () => {
    const stub = stubObservers();
    stub.state.paintAtMs = 5;
    const started = Date.now();
    const diagnostic = await awaitMount(stub, mergeBudgets({ mountBudgetMs: 5000 }));
    const elapsed = Date.now() - started;
    ok(diagnostic === null, 'a stub that already painted returns null (no diagnostic)');
    ok(elapsed < 500, `the wait exited immediately rather than burning the 5s budget (elapsed=${elapsed}ms)`);
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
  await test('red-check: awaitQuiet rides out the hard cap under continuous activity, never blocks past it', async () => {
    const stub = stubObservers();
    const bumper = setInterval(() => {
      stub.state.lastActivityAtMs = Date.now();
    }, 10);
    const started = Date.now();
    await awaitQuiet(stub, mergeBudgets({ actionQuietMs: 300, actionHardCapMs: 150 }));
    clearInterval(bumper);
    const elapsed = Date.now() - started;
    ok(elapsed >= 140 && elapsed < 400, `continuous activity rides out the hard cap, not the (unreachable) quiet window (elapsed=${elapsed}ms)`);
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
  await test('red-check: awaitQuiet is non-vacuous — a genuinely idle stub settles at the quiet window, well under the hard cap', async () => {
    const stub = stubObservers();
    const started = Date.now();
    await awaitQuiet(stub, mergeBudgets({ actionQuietMs: 60, actionHardCapMs: 5000 }));
    const elapsed = Date.now() - started;
    ok(elapsed < 1000, `an idle stub settles near the quiet window, not the 5s hard cap (elapsed=${elapsed}ms)`);
  });
}

main();
