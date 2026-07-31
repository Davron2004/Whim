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
import { wireCapabilityBridge } from '../capability';
import type { AppRecord } from '../../src/host/bridge';
import { sweepApp, getScreenInfo, findAppFrame, type SweptElement } from '../sweep';
import { createRunCandidate } from '../report';

// `process.cwd()` (the repo root) — NOT `import.meta.url`: `run.mjs` esbuild-bundles this file
// into one output module, which collapses every module's `import.meta.url` onto the bundle's
// own location (see `builder.ts`'s identical comment; house idiom, e.g.
// `src/host/launcher/test/dev-probe-back-button.suite.ts`).
const ROOT = process.cwd();
const FIXTURE = path.join(ROOT, 'fixtures/tip-splitter.app.tsx');
const PRODUCTION_ARTIFACT = path.join(ROOT, 'build/generated/tip-splitter.app.js');
// The `sdk-navigation` 4.2 multi-screen fixture (list → detail via `nav.navigate`, back via
// `nav.back`) — authored explicitly to double as synthetic-run-harness material (its own
// top-of-file comment). Read as raw source text; the harness builds candidates from source, not
// from `build/generated/*`.
const NAVIGATION_DEMO_FIXTURE = path.join(ROOT, 'fixtures/navigation-demo.app.tsx');

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

  // ── chain 3 (task 3.3): capability wiring — real gate, ephemeral engine, recording effectors
  await testCapabilityWiring();

  // ── chain 4 (task 4.5): interaction sweep + nav-aware screen coverage + cold-mount ──────────
  await testSweep();

  // ── chain 5 (task 5.3): the assembled RunCandidate — end-to-end acceptance ──────────────────
  await testRunCandidate();

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

// ── chain 3 (task 3.3): capability wiring — real gate, ephemeral engine, recording effectors ──

// Declares NO capabilities, then calls a storage verb and FULLY SWALLOWS the rejection — no
// state, no re-render, nothing observable in the DOM. Proves denial collection happens at the
// HOST-SIDE dispatch function, not by watching what the candidate does with the promise.
const FIXTURE_SWALLOWED_DENIAL = `import { defineApp, Screen, Stack, Heading, useEffect, storage } from 'vc-sdk';
function Home() {
  useEffect(() => {
    storage.kv.set('intrude', 'x').catch(() => {});
  }, []);
  return <Screen><Stack><Heading size="title">quiet</Heading></Stack></Screen>;
}
export default defineApp({ name: 'SwallowedDenial', initial: 'Home', screens: { Home }, capabilities: [] });
`;

// Declares storage and writes one kv key on mount — used to prove no state survives across runs.
const FIXTURE_STORAGE_MARK = `import { defineApp, Screen, Stack, Heading, useEffect, storage } from 'vc-sdk';
function Home() {
  useEffect(() => { storage.kv.set('mark', 'A').catch(() => {}); }, []);
  return <Screen><Stack><Heading size="title">mark</Heading></Stack></Screen>;
}
export default defineApp({ name: 'StorageMark', initial: 'Home', screens: { Home }, capabilities: ['storage'] });
`;

const CAP_SCHEMA = {
  schemaVersion: 1 as const,
  collections: { Marks: { id: 'c1', tombstones: [], fields: { value: { id: 'f1', type: 'text' as const } } } },
};

const APP_UNDECLARED: AppRecord = { appId: 'cap-undeclared', name: 'CapUndeclared', manifest: { capabilities: [] } };
const APP_STORAGE: AppRecord = {
  appId: 'cap-storage',
  name: 'CapStorage',
  manifest: { capabilities: ['storage'] },
  schemaArtifact: CAP_SCHEMA,
};
const APP_MISSING_SCHEMA: AppRecord = {
  appId: 'cap-missing-schema',
  name: 'CapMissingSchema',
  manifest: { capabilities: ['storage'] },
};

async function testCapabilityWiring(): Promise<void> {
  const session = await SynthRunSession.launch({ concurrency: 4 });
  try {
    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('undeclared capability: the production denial is collected host-side even when the candidate swallows it', async () => {
      const wiring = wireCapabilityBridge(APP_UNDECLARED);
      const { ctx, dispose } = await session.openRun(FIXTURE_SWALLOWED_DENIAL, {
        appId: APP_UNDECLARED.appId,
        beforeNavigate: wiring.beforeNavigate,
      });
      try {
        await ctx.page.waitForTimeout(500); // let the mount effect fire + the syscall round-trip
        const denial = wiring.trace.find((t) => t.kind === 'denial' && t.method === 'storage.kv.set');
        ok(!!denial, 'a denial trace entry was recorded for storage.kv.set');
        ok(denial?.kind === 'denial' && denial.errorKind === 'undeclared_capability', `the recorded kind is the production gate's own denial kind (got ${denial && denial.kind === 'denial' ? denial.errorKind : 'none'})`);
        let text = '';
        for (const f of ctx.page.frames()) {
          try {
            const t = await f.evaluate(() => {
              const doc = (globalThis as unknown as { document: { getElementById(id: string): { innerText: string } | null } }).document;
              return doc.getElementById('whim-root')?.innerText ?? null;
            });
            if (t) text = t;
          } catch {
            /* cross-origin/opaque frames may refuse evaluate — ignore */
          }
        }
        ok(text.trim() === 'quiet', `the candidate's own DOM shows nothing but its static text — it truly swallowed the rejection (got ${JSON.stringify(text)})`);
      } finally {
        await dispose();
      }
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('no cross-candidate contamination: a fresh :memory: engine per run means candidate B never sees candidate A\'s write', async () => {
      const wiringA = wireCapabilityBridge(APP_STORAGE);
      const runA = await session.openRun(FIXTURE_STORAGE_MARK, { appId: APP_STORAGE.appId, beforeNavigate: wiringA.beforeNavigate });
      try {
        await runA.ctx.page.waitForTimeout(500);
        ok(wiringA.realm?.engine?.kv.get('mark') === 'A', "candidate A's own write landed in its own engine");
      } finally {
        await runA.dispose();
      }

      // A SECOND wiring over the SAME appId — a fresh call, fresh `:memory:` engine (D3).
      const wiringB = wireCapabilityBridge(APP_STORAGE);
      ok(wiringB.realm?.engine?.kv.get('mark') === undefined, "candidate B's fresh engine observes an empty store, not candidate A's write");
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('schema-application failure surfaces as a diagnostic, not a delivered bundle', () => {
      const wiring = wireCapabilityBridge(APP_MISSING_SCHEMA);
      ok(wiring.realm === null, 'no realm was bound');
      ok(wiring.launchError?.kind === 'missing_schema', `the launch failure kind is surfaced verbatim (got ${wiring.launchError?.kind})`);
      ok(typeof wiring.launchError?.hint === 'string' && wiring.launchError.hint.length > 0, 'the launch failure carries a non-empty hint');
    });
  } finally {
    await session.close();
  }

  // ── red-check (non-vacuity, task 3.3): a GRANTED capability must NOT be denied — proves the
  // undeclared-capability assertion above is a real gate, not a permanently-closed one.
  // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
  await test('red-check: a declared capability is NOT denied (the gate is a live path, not vacuously closed)', async () => {
    const wiring = wireCapabilityBridge(APP_STORAGE);
    const sysretRaw = await wiring.dispatch(JSON.stringify({ whim: 'syscall', v: 1, id: 1, gen: 1, method: 'storage.kv.set', params: { key: 'k', value: 'v' } }));
    const sysret = sysretRaw ? (JSON.parse(sysretRaw) as { ok: boolean }) : null;
    ok(sysret?.ok === true, `a declared capability's syscall succeeds (got ${sysretRaw})`);
    ok(!wiring.trace.some((t) => t.kind === 'denial'), 'no denial was recorded for a granted, valid call');
  });
}

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
        // A generous budget relative to HANG_MS (1200). Widened 500ms→800ms (chain 5 stability
        // fix, per the integration note this chain received). NOTE for whoever next touches
        // this test: widening the margin measurably does NOT fully eliminate an intermittent
        // flake here — this fixture's hang is long/synchronous enough to block the OUTER page's
        // own `load` event (the iframe's parser-blocking script delays its parent's `load` per
        // the HTML spec), so `openObservedRun`'s `page.goto` itself doesn't resolve until the
        // hang is already over. That puts `EarlyObservers.finish()`'s async setup (the
        // `window.ReactNativeWebView` relay override) into a real race against the double-rAF
        // paint message the candidate posts a couple of frames later — a race independent of
        // `mountBudgetMs`. Out of this chain's scope to restructure (chain 2's already-merged
        // `observe.ts`); rerun-to-confirm remains the sanctioned mitigation for now.
        const budgets = mergeBudgets({ mountBudgetMs: 800 });
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

    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('withTotalBudget: signal (task 6.1, design D8) hard-kills the page promptly, never marks run_truncated', async () => {
      const { ctx, obs, dispose } = await openObservedRun(session, FIXTURE_LEGAL_INTERVAL);
      try {
        const budgets = mergeBudgets({ totalBudgetMs: 20000 }); // generous — the signal must win, not the timeout
        const controller = new AbortController();
        const started = Date.now();
        setTimeout(() => controller.abort(), 100);
        const { truncated, aborted } = await withTotalBudget(ctx, obs, budgets, () => new Promise<void>(() => {}), controller.signal); // never resolves
        const elapsed = Date.now() - started;
        ok(aborted === true, 'withTotalBudget reports aborted:true when the signal fires');
        ok(truncated === false, 'an abort is never reported as truncated (a cancelled run is not a truncated one)');
        ok(elapsed < 5000, `the abort won the race well before the 20s total budget (elapsed=${elapsed}ms)`);
        ok(!obs.state.diagnostics.some((d) => d.kind === 'run_truncated'), 'no run_truncated diagnostic is appended on abort');
        ok(ctx.page.isClosed(), 'the page was hard-killed on the same cleanup path as a budget overrun');
      } finally {
        obs.detach();
        await dispose().catch(() => {
          /* the page is already closed by the watchdog above */
        });
      }
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('red-check: withTotalBudget with no signal supplied is unaffected — same overrun behavior as before', async () => {
      const { ctx, obs, dispose } = await openObservedRun(session, FIXTURE_LEGAL_INTERVAL);
      try {
        const budgets = mergeBudgets({ totalBudgetMs: 150 });
        const { truncated, aborted } = await withTotalBudget(ctx, obs, budgets, () => new Promise<void>(() => {})); // no signal arg at all
        ok(truncated === true, 'omitting signal entirely still truncates on overrun (non-vacuity: the new param is additive, not load-bearing for existing callers)');
        ok(aborted === undefined, 'aborted is left unset when no signal was supplied');
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

// ── chain 4 (task 4.5): interaction sweep + nav-aware screen coverage + cold-mount ────────────

// Mints exactly ONE extra button, once, on the FIRST tap — then stays stable. A sweep that
// re-acted on an already-visited fingerprint, or that never noticed the new one, would either
// loop forever (bounded only by the action cap, which this test asserts was NOT hit) or leave
// "Extra" unvisited.
const FIXTURE_MINT_ONE = `import { defineApp, Screen, Stack, Button, useState } from 'vc-sdk';
function Home() {
  const [minted, setMinted] = useState(false);
  return (
    <Screen>
      <Stack>
        <Button label="Mint" onPress={() => setMinted(true)} />
        {minted ? <Button label="Extra" onPress={() => {}} /> : null}
      </Stack>
    </Screen>
  );
}
export default defineApp({ name: 'Mint', initial: 'Home', screens: { Home }, capabilities: [] });
`;

// Declares TWO screens; `Home` has no navigation call at all, so `Orphan` is unreachable via any
// live nav path (spec "Unreachable screen is rendered and flagged" scenario).
const FIXTURE_UNREACHABLE_SCREEN = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
function Home() {
  return <Screen><Stack><Heading size="title">Home</Heading></Stack></Screen>;
}
function Orphan() {
  return <Screen><Stack><Heading size="title">Orphan</Heading></Stack></Screen>;
}
export default defineApp({ name: 'Coverage', initial: 'Home', screens: { Home, Orphan }, capabilities: [] });
`;

function actionSignature(el: SweptElement): string {
  return `${el.kind}|${el.label}|${el.domPath}`;
}

async function testSweep(): Promise<void> {
  const session = await SynthRunSession.launch({ concurrency: 4 });
  const sweepBudgets = mergeBudgets({ actionQuietMs: 40, actionHardCapMs: 250, mountBudgetMs: 5000 });
  try {
    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('state-minted element is swept exactly once, then the sweep terminates', async () => {
      const { ctx, obs, dispose } = await openObservedRun(session, FIXTURE_MINT_ONE);
      try {
        await awaitMount(obs, mergeBudgets({ mountBudgetMs: 3000 }));
        const result = await sweepApp(ctx, obs, FIXTURE_MINT_ONE, sweepBudgets);
        ok(result.truncated === false, `the sweep did not hit the per-screen action cap (got truncated=${result.truncated})`);
        ok(result.actionsLog.length === 2, `exactly two actions were performed — Mint then the state-minted Extra (got ${result.actionsLog.length})`);
        ok(result.actionsLog[0]?.label === 'Mint', `the first action was Mint (got ${result.actionsLog[0]?.label})`);
        ok(result.actionsLog[1]?.label === 'Extra', `the second (newly-minted) action was Extra (got ${result.actionsLog[1]?.label})`);
        ok(result.visitedScreens.length === 1 && result.visitedScreens[0] === 'Home', 'only the single declared screen was visited');
        ok(result.diagnostics.length === 0, `no screens are unreachable, so no unreachable_screen diagnostics (got ${result.diagnostics.length})`);
      } finally {
        obs.detach();
        await dispose();
      }
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('unreachable screen: cold-mounted directly and flagged (spec "Unreachable screen is rendered and flagged")', async () => {
      const { ctx, obs, dispose } = await openObservedRun(session, FIXTURE_UNREACHABLE_SCREEN);
      try {
        await awaitMount(obs, mergeBudgets({ mountBudgetMs: 3000 }));
        const result = await sweepApp(ctx, obs, FIXTURE_UNREACHABLE_SCREEN, sweepBudgets);
        ok(
          [...result.declaredScreens].sort((a, b) => a.localeCompare(b)).join(',') === 'Home,Orphan',
          `both declared screens are reported (got ${result.declaredScreens.join(',')})`,
        );
        ok(
          [...result.visitedScreens].sort((a, b) => a.localeCompare(b)).join(',') === 'Home,Orphan',
          `both screens end up visited — Home via live mount, Orphan via cold-mount (got ${result.visitedScreens.join(',')})`,
        );
        ok(result.diagnostics.length === 1, `exactly one unreachable_screen diagnostic was recorded (got ${result.diagnostics.length})`);
        ok(result.diagnostics[0]?.kind === 'unreachable_screen', `the diagnostic kind is unreachable_screen (got ${result.diagnostics[0]?.kind})`);
        ok(result.diagnostics[0]?.message.includes('Orphan') ?? false, `the diagnostic names "Orphan" (got ${result.diagnostics[0]?.message})`);
        ok(typeof result.perScreenMs.Orphan === 'number', 'Orphan has its own per-screen timing entry from the cold-mount sweep');

        // Non-vacuity: the cold-mount pass really rendered Orphan (fresh realm, T7 — never
        // in-place re-delivery) rather than just declaring the diagnostic and stopping.
        const frame = await findAppFrame(ctx.page);
        const info = await getScreenInfo(frame);
        ok(info.current === 'Orphan', `the page is left showing the cold-mounted Orphan screen (got ${info.current})`);
      } finally {
        obs.detach();
        await dispose();
      }
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('determinism: two independent runs of the same candidate produce the same action sequence + diagnostics', async () => {
      const runOnce = async (): Promise<{ signatures: string[]; diagnosticKinds: string[] }> => {
        const { ctx, obs, dispose } = await openObservedRun(session, FIXTURE_UNREACHABLE_SCREEN);
        try {
          await awaitMount(obs, mergeBudgets({ mountBudgetMs: 3000 }));
          const result = await sweepApp(ctx, obs, FIXTURE_UNREACHABLE_SCREEN, sweepBudgets);
          return { signatures: result.actionsLog.map(actionSignature), diagnosticKinds: result.diagnostics.map((d) => `${d.kind}:${d.message}`) };
        } finally {
          obs.detach();
          await dispose();
        }
      };
      const [a, b] = await Promise.all([runOnce(), runOnce()]);
      ok(a.signatures.join('|') === b.signatures.join('|'), `the two runs performed the identical action sequence (got ${a.signatures.join('|')} vs ${b.signatures.join('|')})`);
      ok(
        a.diagnosticKinds.join('|') === b.diagnosticKinds.join('|'),
        `the two runs produced identical diagnostics (got ${a.diagnosticKinds.join('|')} vs ${b.diagnosticKinds.join('|')})`,
      );
    });
  } finally {
    await session.close();
  }
}

// ── chain 5 (task 5.3): the assembled RunCandidate — end-to-end acceptance ────────────────────

// Six independent hostile behaviors in ONE well-formed-enough candidate (mounts, renders, is
// swept) — proves the ASSEMBLED report composes every chain's diagnostic source correctly, not
// just each chain in isolation (chains 2/3/4 already own the per-layer edge-case coverage):
//   1. an unhandled rejection fired on mount                       → unhandled_rejection
//   2. an uncaught throw in a swept Button's onPress                → runtime_throw
//   3. an undeclared `storage` call, swallowed                      → undeclared_capability
//   4. an undeclared `cues` call, ALSO swallowed (a denied syscall's own rejected Promise is a
//      genuine unhandled rejection if left uncaught — swallowed here so this behavior stays a
//      single, distinct `undeclared_capability` diagnostic, not an incidental second
//      `unhandled_rejection` on top of behavior 1's deliberate one)  → undeclared_capability
//   5. a declared screen no nav path reaches                        → unreachable_screen
//   6. a forged, unauthenticated "contained:false" probes frame     → must be REJECTED, not
//      adopted (no extra diagnostic; the genuine trusted verdict still lands)
const FIXTURE_SIX_WAY_HOSTILE = `import { defineApp, Screen, Stack, Heading, Button, useEffect, storage, cues } from 'vc-sdk';
const w = globalThis;
try {
  if (w.parent && typeof w.parent.postMessage === 'function') {
    w.parent.postMessage(JSON.stringify({ __whimHarness: true, kind: 'probes', payload: { contained: false, __FORGED_BY_TEST: true } }), '*');
  }
} catch (e) { /* one-way, best-effort */ }
function Home() {
  useEffect(() => { Promise.reject(new Error('hostile-unhandled-rejection')); }, []);
  useEffect(() => { storage.kv.set('sneaky', 'x').catch(() => {}); }, []);
  useEffect(() => { cues.haptic('double').catch(() => {}); }, []);
  return (
    <Screen>
      <Stack>
        <Heading size="title">Hostile</Heading>
        <Button label="Boom" onPress={() => { throw new Error('hostile-boom-on-press'); }} />
      </Stack>
    </Screen>
  );
}
function Orphan() {
  return <Screen><Stack><Heading size="title">Orphan</Heading></Stack></Screen>;
}
export default defineApp({ name: 'SixWayHostile', initial: 'Home', screens: { Home, Orphan }, capabilities: [] });
`;

function diagnosticSignature(d: { kind: string }): string {
  return d.kind;
}

async function testRunCandidate(): Promise<void> {
  const session = await SynthRunSession.launch({ concurrency: 2 });
  try {
    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('clean report: a well-formed multi-screen candidate (sdk-navigation 4.2 fixture) yields ok:true', async () => {
      const runCandidate = createRunCandidate(session);
      const source = await readFile(NAVIGATION_DEMO_FIXTURE, 'utf8');
      const report = await runCandidate(source, { budgets: { mountBudgetMs: 5000, actionQuietMs: 40, actionHardCapMs: 250 } });

      ok(report.ok === true, `a well-formed candidate produces ok:true (got diagnostics: ${JSON.stringify(report.diagnostics)})`);
      ok(report.diagnostics.length === 0, `no diagnostics were recorded (got ${report.diagnostics.length})`);
      ok(report.contained === true, 'the trusted probes verdict is contained');
      ok(report.truncated === false, 'the run was not truncated');
      ok(
        [...report.screens.declared].sort((a, b) => a.localeCompare(b)).join(',') === 'Detail,List',
        `both declared screens are reported (got ${report.screens.declared.join(',')})`,
      );
      ok(
        [...report.screens.visited].sort((a, b) => a.localeCompare(b)).join(',') === 'Detail,List',
        `both screens end up visited — List via live mount, Detail via nav.navigate (got ${report.screens.visited.join(',')})`,
      );
      ok(report.timings.buildMs >= 0 && report.timings.bootMs >= 0, 'build/boot timings are recorded');
      ok(typeof report.timings.mountToPaintMs === 'number' && report.timings.mountToPaintMs > 0, 'mount→paint timing is recorded');
      ok(typeof report.timings.perScreenMs.List === 'number' && typeof report.timings.perScreenMs.Detail === 'number', 'both screens have their own per-screen timing entry');
      ok(report.trace.length === 0, `no capabilities are declared, so the trace is empty (got ${report.trace.length} entries)`);
      ok(report.budgets.mountBudgetMs === 5000, 'the applied budgets are recorded verbatim, merged with the caller override');
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('six-way hostile: exactly the expected diagnostic set, forged verdict rejected', async () => {
      const runCandidate = createRunCandidate(session);
      const report = await runCandidate(FIXTURE_SIX_WAY_HOSTILE, {
        budgets: { mountBudgetMs: 5000, actionQuietMs: 40, actionHardCapMs: 250 },
      });

      ok(report.ok === false, 'a hostile candidate produces ok:false');
      const expectedKinds = ['unhandled_rejection', 'runtime_throw', 'undeclared_capability', 'undeclared_capability', 'unreachable_screen'];
      const gotKinds = report.diagnostics.map(diagnosticSignature).sort((a, b) => a.localeCompare(b));
      ok(
        gotKinds.join(',') === [...expectedKinds].sort((a, b) => a.localeCompare(b)).join(','),
        `exactly the expected diagnostic kind multiset was produced (got ${gotKinds.join(',')})`,
      );

      const rejection = report.diagnostics.find((d) => d.kind === 'unhandled_rejection');
      ok(rejection?.message.includes('hostile-unhandled-rejection') ?? false, `unhandled_rejection names the rejection (got ${rejection?.message})`);

      const thrown = report.diagnostics.find((d) => d.kind === 'runtime_throw');
      ok(thrown?.message.includes('hostile-boom-on-press') ?? false, `runtime_throw names the thrown error (got ${thrown?.message})`);

      const denials = report.diagnostics.filter((d) => d.kind === 'undeclared_capability');
      ok(denials.length === 2, `both undeclared capability calls were denied and surfaced (got ${denials.length})`);
      ok(denials.some((d) => d.message.includes('storage.kv.set')), 'one denial names storage.kv.set');
      ok(denials.some((d) => d.message.includes('cues.haptic')), 'one denial names cues.haptic');

      const unreachable = report.diagnostics.find((d) => d.kind === 'unreachable_screen');
      ok(unreachable?.message.includes('Orphan') ?? false, `unreachable_screen names Orphan (got ${unreachable?.message})`);

      // Behavior 6 (forged verdict): rejected, never adopted — the genuine trusted probes frame
      // still lands and the forgery contributes NO extra diagnostic (spec "Forged verdict attempt").
      ok(report.contained === true, 'the forged contained:false claim is rejected — the genuine trusted verdict (contained) still wins');
      ok(
        !report.diagnostics.some((d) => 'message' in d && typeof d.message === 'string' && d.message.includes('__FORGED_BY_TEST')),
        "the forgery's own marker never leaks into any diagnostic",
      );

      ok(
        [...report.screens.declared].sort((a, b) => a.localeCompare(b)).join(',') === 'Home,Orphan',
        `both declared screens are reported (got ${report.screens.declared.join(',')})`,
      );
    });

    // ── red-check (non-vacuity, task 5.3): a candidate with NO hostile behavior at all must
    // never produce a false-positive diagnostic from the assembled pipeline itself.
    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('red-check: the assembled pipeline is non-vacuous — a trivially harmless candidate is clean too', async () => {
      const runCandidate = createRunCandidate(session);
      const harmless = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
function Home() { return <Screen><Stack><Heading size="title">Harmless</Heading></Stack></Screen>; }
export default defineApp({ name: 'Harmless', initial: 'Home', screens: { Home }, capabilities: [] });
`;
      const report = await runCandidate(harmless, { budgets: { mountBudgetMs: 5000 } });
      ok(report.ok === true, `a harmless candidate is clean (got ${JSON.stringify(report.diagnostics)})`);
      ok(report.diagnostics.length === 0, 'no diagnostics leak in from the hostile fixture above being run in the same suite');
    });
  } finally {
    await session.close();
  }
}

main();
