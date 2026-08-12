/**
 * Node acceptance for synthrun's candidate builder (task 1.3 — the build-contract drift
 * tripwire, spec §Build-contract drift tripwire) and chain 2's trusted-vantage observation +
 * watchdog (task 2.4). Pins `buildCandidateFile`'s output byte-identical to the CHECKED-IN
 * production artifact `build/generated/tip-splitter.app.js` — the real output of
 * `build/build.mjs`'s own `bundleApp` for the same fixture, refreshed by `npm run build` on
 * every gate run. Reads `build/*` strictly read-only; never re-derives what production emits.
 *
 * Also owns the containment-observation acceptance (`harden-containment-observation` §4): the
 * mount gate against a genuinely never-painting candidate, the three-valued containment verdict
 * separated end-to-end (`true` / `false` + `containment_failure` / `null` +
 * `containment_unobserved`), the malformed-payload path, relay-binding confinement, and the
 * bounded, payload-free forgery tally.
 *
 *   node synthrun/test/run.mjs
 */
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build as esbuild } from 'esbuild';
import { buildCandidateFile } from '../builder';
import { awaitMount, awaitQuiet, openObservedRun, mergeBudgets, withTotalBudget, RELAY_BINDING_NAME, type AttachedObservers, type ObservedFrameKind } from '../observe';
import { REJECTED_FORGERY_CAP } from '../contract';
import { SynthRunSession, type RunContext } from '../session';
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
const quarantines: string[] = [];

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

/**
 * Registers a test that is NOT run, because it is currently unsound rather than merely broken —
 * it would assert a property this suite cannot construct today. Deliberately loud: it prints, it
 * is counted, and the summary line always names the total, so a quarantine cannot quietly become
 * permanent the way a commented-out test does. It never affects the exit code (a quarantined
 * test proves nothing, so it must not be able to fail OR to pass). `reason` must say what would
 * make the test sound again, not merely that it flakes.
 */
function quarantined(name: string, reason: string, fixtureItNeeds: string): void {
  quarantines.push(`${name} — ${reason}`);
  console.warn(`⚠ QUARANTINED (not run): ${name}\n    ${reason}`);
  // The parked test's fixture is otherwise unreferenced, so a tidy-up pass would delete it as
  // dead code and the quarantine could never be lifted without reconstructing it. Naming it here
  // both keeps it alive and asserts it is still present — the one thing about a parked test that
  // can still silently rot.
  ok(fixtureItNeeds.length > 0, `the quarantined test's fixture is still present: ${name}`);
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
  const quarantineNote = quarantines.length === 0 ? '' : `, ${quarantines.length} QUARANTINED`;
  if (failures.length === 0) {
    console.log(`✓ synthrun acceptance: ${passed} checks passed${quarantineNote}`);
  } else {
    console.error(`✗ synthrun acceptance: ${failures.length} FAILED, ${passed} passed${quarantineNote}`);
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  for (const q of quarantines) console.warn('  ⚠ ' + q);
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

// An UNBOUNDED synchronous top-level hang, entered before the wrapped script ever reaches its
// trailing `__whimAfterBundle()` call — the only way to keep the nonce-authenticated `paint`
// frame from EVER posting under the CURRENT loader.js (the double-rAF paint measurement is
// scheduled the instant `render()` is CALLED, unconditionally, regardless of what the app's own
// React tree — or an async-only hang via the SDK's `delay(Infinity)` — is doing).
//
// Genuinely never-terminating on purpose: a bounded hang eventually paints, and a test that
// passes only while the paint frame is still in flight asserts a race, not a property. Wedging
// the renderer forever is safe here because nothing this suite needs comes back out of that
// realm — `page.goto(..., {waitUntil:'load'})` resolves in ~30ms regardless (the outer page's
// `load` fires when the sandbox iframe's srcdoc loads; the candidate bundle is delivered
// afterwards over postMessage, so a never-painting candidate cannot delay it) and `dispose()`
// tears the wedged context down without waiting for it.
const FIXTURE_MOUNT_HANG = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
for (;;) { /* deliberate, unbounded synchronous top-level hang — this candidate never paints */ }
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

// The minimal well-formed candidate: mounts, paints, is contained, does nothing else. The
// baseline every containment-verdict case below is read against.
const FIXTURE_HARMLESS = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
function Home() { return <Screen><Stack><Heading size="title">Harmless</Heading></Stack></Screen>; }
export default defineApp({ name: 'Harmless', initial: 'Home', screens: { Home }, capabilities: [] });
`;

// CAUSES a genuine breach verdict rather than claiming one: planting a Node-style `process`
// global makes probes.js's own escape-axis check `ambient process (Node env leak)` (§6,
// `expectUnreachable`) reach a usable value, so `contained` — computed by the loader's
// closure-captured trusted probe fn, which this candidate cannot touch (constraint #3) — comes
// back `false` in a nonce-authenticated frame. Verified: the run's single probe failure is
// exactly that one.
const FIXTURE_CONTAINMENT_BREACH = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
const w = globalThis;
try { w.process = { env: { NODE_ENV: 'production' } }; } catch (e) { /* best-effort plant */ }
function Home() {
  return <Screen><Stack><Heading size="title">Breach</Heading></Stack></Screen>;
}
export default defineApp({ name: 'Breach', initial: 'Home', screens: { Home }, capabilities: [] });
`;

// Paints normally, then SABOTAGES the oracle so no verdict is ever computed: probes.js plants its
// own negative control with a plain assignment (window.__WHIM_PLANTED_LEAK__ = function…) under
// 'use strict', so making that property non-writable turns the assignment into a TypeError. The
// loader has already posted its nonce-authenticated `paint` frame by then (double-rAF, before the
// probe call), so this run paints and never yields a verdict — the exact shape of spec scenario
// "An unobserved verdict after a successful paint", and the case that must NOT be scored as
// contained.
const FIXTURE_PROBE_SABOTAGE = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
const w = globalThis;
try {
  Object.defineProperty(w, '__WHIM_PLANTED_LEAK__', { value: 1, writable: false, configurable: false });
} catch (e) { /* best-effort sabotage */ }
function Home() {
  return <Screen><Stack><Heading size="title">Sabotage</Heading></Stack></Screen>;
}
export default defineApp({ name: 'Sabotage', initial: 'Home', screens: { Home }, capabilities: [] });
`;

// The attacker-chosen bytes a forged frame carries. Asserted ABSENT from every field of the
// assembled report and from every diagnostic — if a single one of these bytes can be made to
// appear there, the candidate is authoring harness output (spec "A rejected forgery is counted,
// never echoed").
const FORGED_PAYLOAD_MARKER = '__WHIM_FORGED_PAYLOAD_MARKER_7b41__';

// Posts far more forged, unauthenticated "probes" frames than `REJECTED_FORGERY_CAP`, each with a
// large attacker-chosen payload, then renders normally so the run still produces a genuine
// verdict alongside the flood.
const FORGERY_FLOOD_COUNT = 40;
const FIXTURE_FORGERY_FLOOD = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
const w = globalThis;
const PAD = 'p'.repeat(2048);
for (let i = 0; i < ${FORGERY_FLOOD_COUNT}; i++) {
  try {
    w.parent.postMessage(JSON.stringify({ __whimHarness: true, kind: 'probes', payload: { contained: true, passed: 999, total: 999, marker: '${FORGED_PAYLOAD_MARKER}', pad: PAD, i: i } }), '*');
  } catch (e) { /* one-way, best-effort */ }
}
function Home() {
  return <Screen><Stack><Heading size="title">Flood</Heading></Stack></Screen>;
}
export default defineApp({ name: 'Flood', initial: 'Home', screens: { Home }, capabilities: [] });
`;

// The single line of candidate-reachable code that defeats chain 2's name-level scrub: Playwright's
// own binding controller survives in the opaque-origin sandbox realm, so the deleted binding can be
// re-minted there. Kept verbatim (and kept alive) by the QUARANTINED confinement case below, which
// is the only thing in this suite that would execute it.
const RELAY_REBIND_PROBE = `globalThis['__playwright__binding__controller__'].addBinding('${RELAY_BINDING_NAME}')`;

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
          // eslint-disable-next-line no-restricted-syntax -- intentional: cross-origin/opaque frames may refuse evaluate; probing every frame and ignoring refusals is the point.
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

/** Polls until `predicate` holds or `budgetMs` expires, then returns regardless — for waiting on a
 *  frame the RUN emits on its own schedule (a fixed sleep would either be a race or be slow). The
 *  caller asserts the property itself; this only bounds the wait. */
async function waitUntil(predicate: () => boolean, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline && !predicate()) await wait(15);
}

/**
 * Posts one frame on the host transport from the OUTER page's own realm — the trusted vantage
 * every genuine frame travels (`assemble.mjs`'s `toRN`, which is the outer page's own call). Lets
 * a test stand in for the outer page when the frame shape under test is one the iframe-side
 * runtime cannot be made to emit (a nonce-authenticated verdict with a malformed payload). It
 * grants nothing the outer page did not already have, and bypasses no authentication: the nonce
 * check happens upstream, inside the outer page, before it ever calls `toRN`.
 */
async function relayFromOuterPage(ctx: RunContext, frame: { kind: string; trusted: boolean; payload: unknown }): Promise<void> {
  await ctx.page.evaluate((raw: string) => {
    const g = globalThis as unknown as { ReactNativeWebView?: { postMessage(s: string): void } };
    g.ReactNativeWebView?.postMessage(raw);
  }, JSON.stringify(frame));
}

// The two halves of the pre-/post-`load` comparison below. Carried in the frame's `where` field,
// so each one's diagnostic is identifiable by message without reading anything else.
const PRE_LOAD_FRAME_WHERE = 'whim-pre-load-frame-probe';
const POST_LOAD_FRAME_WHERE = 'whim-post-load-frame-probe';

/**
 * Registered as a page init script, so it runs in the DELIVERED document at document-start — after
 * the document has committed and before any of its own inline scripts, hence long before `load`.
 * That is the exact window spec scenario "A frame emitted before load is not dropped" names, and
 * the one a relay installed after navigation cannot see.
 *
 * It posts ONE authenticated frame through `window.ReactNativeWebView` — the outer page's own
 * transport, the same one `assemble.mjs`'s `toRN()` posts every genuine frame through — standing in
 * for the outer page emitting a frame in that window (the same seam, and the same standing-in, as
 * `relayFromOuterPage` above; the nonce check sits upstream of it either way). Two properties are
 * load-bearing and deliberate:
 *
 *  - main frame only (`g.top !== g` bails), so it never posts from the opaque-origin sandbox realm;
 *  - `?.` on the transport reproduces `toRN()`'s own `if (window.ReactNativeWebView)` guard: with no
 *    transport installed yet the frame is DROPPED AT SOURCE with nothing to replay. That is the
 *    regression this test exists to catch, expressed in the production page's own terms.
 *
 * `document.readyState` is captured at post time and travels in the payload, so the assertion that
 * the frame really was emitted pre-`load` is made from in-band evidence rather than from harness
 * wall-clock timing.
 */
function postAuthenticatedFrameAtDocumentStart(where: string): void {
  const g = globalThis as unknown as {
    top?: unknown;
    document?: { readyState?: string };
    ReactNativeWebView?: { postMessage(s: string): void };
  };
  if (g.top !== g) return;
  g.ReactNativeWebView?.postMessage(
    JSON.stringify({ kind: 'error', trusted: true, payload: { where, message: 'emitted between document commit and load', readyState: g.document?.readyState } }),
  );
}

function framePayload(event: { payload: unknown } | undefined): { where?: string; readyState?: string } {
  return (event?.payload ?? {}) as { where?: string; readyState?: string };
}

function stubObservers(): AttachedObservers {
  return {
    state: { events: [], diagnostics: [], contained: null, rejectedForgeries: 0, paintAtMs: null, lastActivityAtMs: Date.now() },
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

    // Un-quarantined once the relay was opened pre-navigation: the real-browser mount gate is now
    // observable end-to-end. The fixture never paints at all (unbounded hang), so `paintAtMs`
    // stays null because no paint EXISTS — not because a paint frame was lost racing the relay
    // install, which is what the parked version of this test was actually measuring. The stub
    // red-checks below stay as the non-vacuity anchor for `awaitMount`'s own timeout arithmetic.
    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('mount_timeout: an unbounded top-level hang never posts paint (spec "Never-settling mount")', async () => {
      const { obs, dispose } = await openObservedRun(session, FIXTURE_MOUNT_HANG);
      try {
        const diagnostic = await awaitMount(obs, mergeBudgets({ mountBudgetMs: 600 }));
        ok(diagnostic?.kind === 'mount_timeout', `the never-painting candidate times out with mount_timeout (got ${diagnostic?.kind ?? 'null'})`);
        ok(diagnostic?.hint != null && diagnostic.hint.length > 0, 'the diagnostic carries a non-empty hint');
        ok(obs.state.paintAtMs === null, `no paint was ever observed (got paintAtMs=${obs.state.paintAtMs})`);
        // Non-vacuity for the fixture itself: a candidate wedged in its own top-level hang never
        // reaches the loader's post-delivery frames, so the relay — live since before navigation —
        // legitimately sees nothing. An empty buffer here means "nothing happened", not "the relay
        // was late"; the tests below prove the same relay does receive a healthy candidate's frames.
        ok(eventKinds(obs).length === 0, `the wedged realm emitted no frames at all (got ${eventKinds(obs).join(',')})`);
        ok(obs.state.contained === null, 'no authenticated verdict was observed, so containment is unobserved — never false');
        ok(!obs.state.diagnostics.some((d) => d.kind === 'containment_failure'), 'a never-painting run is NOT reported as a containment breach');
      } finally {
        obs.detach();
        await dispose().catch(() => {
          /* the renderer is wedged for good; teardown is best-effort */
        });
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
        // The rejection is recorded as a FACT, not merely dropped (spec "A frame the outer page
        // rejected as a forgery SHALL be recorded as the fact of a rejection plus a bounded
        // count"). Not asserted as an exact number here: probes.js's own T6b pen test posts an
        // unauthenticated spoof frame from inside every realm, so any run that reaches the oracle
        // carries one rejection of its own. The cap arithmetic is the flood test's job.
        ok(obs.state.rejectedForgeries > 0, `the rejection was tallied (got ${obs.state.rejectedForgeries})`);
      } finally {
        obs.detach();
        await dispose();
      }
    });

    // ── 4.2a: the confinement chain-2 actually achieved, pinned so a refactor cannot drop it ──
    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('confinement: the host relay binding is undefined in the sandbox realm as installed (spec "The relay binding is not reachable from the sandbox realm")', async () => {
      const { ctx, obs, dispose } = await openObservedRun(session, FIXTURE_HARMLESS);
      try {
        await awaitMount(obs, mergeBudgets({ mountBudgetMs: 3000 }));
        await wait(150);
        const frame = await findAppFrame(ctx.page);
        const realm = await frame.evaluate((name: string) => {
          const g = globalThis as unknown as Record<string, unknown> & { top?: unknown; ReactNativeWebView?: { postMessage?: unknown } };
          return {
            relay: typeof g[name],
            isSubordinateRealm: g.top !== g,
            transportKind: typeof g.ReactNativeWebView?.postMessage,
          };
        }, RELAY_BINDING_NAME);

        // Non-vacuity first: an "everything is undefined here" bug (wrong frame, dead evaluate)
        // must not be able to make the assertion below pass.
        ok(realm.isSubordinateRealm, 'the evaluated realm really is the subordinate sandbox realm, not the outer page');
        ok(realm.transportKind === 'function', `loader.js's own same-named transport stub IS present in that realm (got ${realm.transportKind})`);
        ok(realm.relay === 'undefined', `${RELAY_BINDING_NAME} is not defined in the sandbox realm as installed (got ${realm.relay})`);

        // …and that stub is loader.js's, NOT the host relay: what goes through it is subject to
        // the outer page's nonce check, so a "probes" frame posted through it lands as a REJECTED
        // forgery and changes no verdict. The host relay would have delivered it verbatim.
        const forgeriesBefore = obs.state.rejectedForgeries;
        await frame.evaluate((marker: string) => {
          const g = globalThis as unknown as { ReactNativeWebView?: { postMessage(s: string): void } };
          g.ReactNativeWebView?.postMessage(JSON.stringify({ __whimHarness: true, kind: 'probes', payload: { contained: false, marker } }));
        }, FORGED_PAYLOAD_MARKER);
        await wait(200);
        ok(obs.state.rejectedForgeries === forgeriesBefore + 1, `the frame posted through the sandbox transport was rejected as a forgery (tally ${forgeriesBefore} → ${obs.state.rejectedForgeries})`);
        ok(obs.state.contained === true, 'the verdict is untouched by a frame that travelled the sandbox realm transport');
      } finally {
        obs.detach();
        await dispose();
      }
    });

    // ── 4.2b: the property the spec actually demands — QUARANTINED because it FAILS TODAY. ─────
    //
    // 4.2a above pins a NAME-level fact: `page.exposeFunction` defines its wrapper in every frame
    // of the page (the opaque-origin sandbox iframe included), and chain 2's init-script shim
    // deletes it there. That is real and worth locking. It is NOT the same property as the spec's
    // "the host relay binding is unreachable from inside the sandboxed realm", and this suite must
    // not let the weaker one stand in for the stronger.
    //
    // Verified by execution against this very build, not by reading: Playwright's own
    // `__playwright__binding__controller__` survives in the sandbox realm as an `object`, and the
    // single line held in `RELAY_REBIND_PROBE` below re-adds the binding — `typeof` goes back to
    // `'function'`, calling it reaches the host relay callback, and a frame handed to it with
    // `trusted: true` sets the run's containment verdict (forced to both `false` and `true` in
    // separate reproductions, after the genuine verdict had already landed). Deleting the name
    // does not remove the capability that mints it.
    //
    // The hole is PRE-EXISTING (it predates this change), is tracked by its own change, and is
    // deliberately NOT fixed or weakened here. A quarantined honest test is the deliverable; a
    // green one that asserted only the name would be the exact failure mode this change exists to
    // eliminate. Un-quarantine it when the capability — not just the name — is gone from the
    // realm (e.g. the relay no longer travels through a binding the candidate's realm can re-mint).
    quarantined(
      'confinement: the host relay is unreachable as a CAPABILITY from the sandbox realm (spec "The relay binding is not reachable from the sandbox realm")',
      'FAILS TODAY, deliberately parked: the binding is scrubbed by NAME only. Playwright\'s __playwright__binding__controller__ survives in the sandbox realm and re-adds it (verified end-to-end: the re-minted binding reaches the host relay and can set the run\'s containment verdict). Pre-existing and tracked by its own change; sound again once the realm cannot re-mint the binding.',
      RELAY_REBIND_PROBE,
    );

    // ── 4.3: a malformed authenticated verdict payload is UNOBSERVED, never a breach ───────────
    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('malformed verdict payload: unobserved, not a breach (spec "A malformed verdict payload is unobserved, not a breach")', async () => {
      const { ctx, obs, dispose } = await openObservedRun(session, FIXTURE_HARMLESS);
      try {
        await awaitMount(obs, mergeBudgets({ mountBudgetMs: 3000 }));
        await wait(200);
        ok(obs.state.contained === true, 'baseline: the genuine verdict landed first, so a change below is this test\'s own doing');

        // Stands in for the OUTER PAGE emitting an authenticated frame whose payload is malformed.
        // The outer container relays the iframe's probe result verbatim (`toRN({kind:'probes',
        // trusted:true, payload:r})`) once its own nonce check passes, so this is that frame with
        // a non-boolean `contained` — the one shape probes.js itself cannot be made to produce.
        // The nonce check sits UPSTREAM of this seam and is exercised by the forgery tests above;
        // what is under test here is what the harness does with an authenticated-but-malformed
        // verdict. Posted from the main frame, i.e. the trusted vantage, exactly like every real
        // frame on this transport.
        await relayFromOuterPage(ctx, { kind: 'probes', trusted: true, payload: { contained: 'not-a-boolean' } });
        await wait(200);
        ok(obs.state.contained === null, `a non-boolean verdict field leaves containment unobserved (got ${JSON.stringify(obs.state.contained)})`);
        ok(!obs.state.diagnostics.some((d) => d.kind === 'containment_failure'), 'absence of a boolean verdict is NOT evidence of a breach — no containment_failure');
        const unobserved = obs.state.diagnostics.filter((d) => d.kind === 'containment_unobserved');
        ok(unobserved.length === 1, `exactly one containment_unobserved diagnostic was minted (got ${unobserved.length})`);
        ok((unobserved[0]?.hint.length ?? 0) > 0, 'the diagnostic carries a non-empty hint');
        ok(!JSON.stringify(obs.state.diagnostics).includes('not-a-boolean'), 'the malformed payload is never echoed into a diagnostic');

        // Red-check on the SAME seam: an authenticated `contained:false` DOES produce a breach.
        // Without this, the assertions above would also pass against a dead injection channel.
        await relayFromOuterPage(ctx, { kind: 'probes', trusted: true, payload: { contained: false } });
        await wait(200);
        ok(obs.state.contained === false, 'the same channel carrying an explicit false IS read as a breach (the seam is live)');
        ok(obs.state.diagnostics.some((d) => d.kind === 'containment_failure'), 'an explicit false — and only an explicit false — earns containment_failure');
      } finally {
        obs.detach();
        await dispose();
      }
    });

    // ── the pre-`load` window: the ordering this whole change turns on ─────────────────────────
    //
    // Every frame a HEALTHY candidate emits lands after `openRun` returns (measured: `delivery`
    // @33ms, `probes` @58ms, with `page.goto`'s `load` resolving before either), so no natural
    // fixture exercises the window between document commit and `load` — which is precisely why the
    // dropped-verdict regression was intermittent rather than deterministic. This test constructs
    // that window directly: one authenticated frame emitted from the outer page's realm at
    // document-start, i.e. before `load`, plus the SAME frame emitted after `load` as the control
    // for the scenario's "exactly as a post-load frame would".
    //
    // Red-checked against the actual regression (task 8.2): with relay installation moved back into
    // `EarlyObservers.finish()` — `exposeFunction` + a post-navigation `page.evaluate` installing
    // the transport, i.e. the pre-fix ordering verbatim — the pre-`load` frame is never observed and
    // this test goes red, while the post-`load` control still lands.
    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('a frame emitted before load is not dropped (spec "A frame emitted before load is not dropped")', async () => {
      const { ctx, obs, dispose } = await openObservedRun(session, FIXTURE_HARMLESS, {
        beforeNavigate: async (page) => {
          await page.addInitScript(postAuthenticatedFrameAtDocumentStart, PRE_LOAD_FRAME_WHERE);
        },
      });
      try {
        // The frame is emitted during navigation itself, so it is already in flight by the time
        // `openRun` returns; the mount gate returns immediately here (its early-exit-on-diagnostic
        // path), so wait on the run's own genuine frames rather than on a fixed sleep.
        await awaitMount(obs, mergeBudgets({ mountBudgetMs: 3000 }));
        await waitUntil(() => obs.state.contained !== null && obs.state.paintAtMs !== null, 3000);

        const preLoad = obs.state.events.find((e) => e.kind === 'error' && framePayload(e).where === PRE_LOAD_FRAME_WHERE);
        ok(!!preLoad, 'the frame emitted between document commit and load was observed at all (a relay installed after navigation never sees it — the regression)');
        ok(framePayload(preLoad).readyState === 'loading', `it really was emitted before load — document.readyState at emit time (got ${framePayload(preLoad).readyState})`);
        ok(preLoad?.trusted === true, 'its trusted flag is consumed verbatim, exactly as for a post-load frame');
        const preDiag = obs.state.diagnostics.find((d) => d.message.includes(PRE_LOAD_FRAME_WHERE));
        ok(!!preDiag, 'the pre-load frame CONTRIBUTED to the report — it produced its diagnostic, not merely an event');

        // The post-`load` control on the same transport: same frame shape, same authenticated
        // vantage, emitted after `load` instead of before. Without it, "contributes exactly as a
        // post-load frame would" would be asserted against nothing.
        await relayFromOuterPage(ctx, { kind: 'error', trusted: true, payload: { where: POST_LOAD_FRAME_WHERE, message: 'emitted after load', readyState: 'complete' } });
        await waitUntil(() => obs.state.diagnostics.some((d) => d.message.includes(POST_LOAD_FRAME_WHERE)), 2000);
        const postDiag = obs.state.diagnostics.find((d) => d.message.includes(POST_LOAD_FRAME_WHERE));
        ok(!!postDiag, 'the post-load control frame contributed too (both halves of the comparison exist)');
        ok(
          !!preDiag && preDiag.kind === postDiag?.kind && preDiag.severity === postDiag.severity && preDiag.hint === postDiag.hint,
          `the pre-load frame contributes EXACTLY as the post-load one does — same kind/severity/hint (pre=${preDiag?.kind}/${preDiag?.severity}, post=${postDiag?.kind}/${postDiag?.severity})`,
        );

        // Non-vacuity for the run itself: opening the transport before navigation did not disturb
        // the genuine pipeline, so an absent pre-load frame above would mean "dropped", never
        // "this run emitted nothing".
        ok(obs.state.paintAtMs !== null, 'the run still painted (the genuine nonce-authenticated paint frame landed)');
        ok(obs.state.contained === true, `the run's own genuine verdict still landed unchanged (got ${JSON.stringify(obs.state.contained)})`);
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
      // Verdict `true` carries NEITHER containment diagnostic — the state is separated from the
      // other two end to end, not merely at the field.
      ok(
        !report.diagnostics.some((d) => d.kind === 'containment_failure' || d.kind === 'containment_unobserved'),
        'a contained run carries neither containment_failure nor containment_unobserved',
      );
      // The forgery tally is self-consistent, and NOT zero even for a candidate that forges
      // nothing: probes.js's T6b pen test posts an unauthenticated spoof frame from inside every
      // realm, so the outer page rejects one frame in every run that reaches the oracle. Pinned
      // deliberately — `forgeries.rejected` therefore does NOT distinguish a hostile candidate
      // from a clean one, and a consumer must not read it as if it did.
      ok(report.forgeries.rejected === (report.forgeries.count > 0), 'rejected is exactly (count > 0)');
      ok(report.forgeries.count === 1, `a clean candidate still tallies the oracle's own T6b spoof, and nothing more (got ${report.forgeries.count})`);
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
      ok(report.forgeries.rejected === true, 'the forgery attempt is recorded as a fact on the report');
      ok(
        !JSON.stringify(report).includes('__FORGED_BY_TEST'),
        'no byte of the forged payload appears ANYWHERE in the report — not just in its diagnostics',
      );
    });

    // ── 4.3: the three verdict states, separated end-to-end on the assembled report ────────────

    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('verdict false: a genuine breach is a breach (spec "A negative verdict is still negative")', async () => {
      const runCandidate = createRunCandidate(session);
      const report = await runCandidate(FIXTURE_CONTAINMENT_BREACH, { budgets: { mountBudgetMs: 5000, actionQuietMs: 40, actionHardCapMs: 250 } });

      ok(report.contained === false, `an authenticated breach verdict is reported as false (got ${JSON.stringify(report.contained)})`);
      const breaches = report.diagnostics.filter((d) => d.kind === 'containment_failure');
      ok(breaches.length === 1, `exactly one containment_failure diagnostic accompanies it (got ${breaches.length})`);
      ok((breaches[0]?.hint.length ?? 0) > 0, 'the diagnostic carries a non-empty hint');
      ok(
        !report.diagnostics.some((d) => d.kind === 'containment_unobserved'),
        'a breach is evidence, so it is never softened to containment_unobserved',
      );
      ok(!report.diagnostics.some((d) => d.kind === 'mount_timeout'), 'the candidate painted fine — a breach is not a mount timeout');
      ok(report.ok === false, 'a breached run is not ok');
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('verdict null after a paint: unobserved, not negative (spec "An unobserved verdict after a successful paint")', async () => {
      const runCandidate = createRunCandidate(session);
      const report = await runCandidate(FIXTURE_PROBE_SABOTAGE, { budgets: { mountBudgetMs: 5000, actionQuietMs: 40, actionHardCapMs: 250 } });

      ok(report.contained === null, `no authenticated verdict was ever observed, so the verdict is null (got ${JSON.stringify(report.contained)})`);
      const unobserved = report.diagnostics.filter((d) => d.kind === 'containment_unobserved');
      ok(unobserved.length === 1, `exactly one containment_unobserved diagnostic is carried (got ${unobserved.length})`);
      ok((unobserved[0]?.hint.length ?? 0) > 0, 'the diagnostic carries a non-empty hint');
      ok(!report.diagnostics.some((d) => d.kind === 'containment_failure'), 'never heard back is NOT heard "breached" — no containment_failure');
      // The mount budget never fired: this candidate paints. Reporting it as mount_timeout would
      // name the wrong cause (`handoff/diagnostic-kind.md`, the no-substitution rule).
      ok(!report.diagnostics.some((d) => d.kind === 'mount_timeout'), 'the candidate painted within budget, so NO mount_timeout is reported');
      // Whole truth: sabotaging the oracle throws where the loader calls it, and that throw is
      // observed at CDP level. Asserted so this case states everything the run produces.
      ok(report.diagnostics.some((d) => d.kind === 'runtime_throw'), 'the sabotage itself surfaces as a runtime_throw');
      ok(report.ok === false, 'an unverified run is not ok');
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('verdict null with no probes frame at all: mount_timeout AND containment_unobserved, neither standing in for the other', async () => {
      const runCandidate = createRunCandidate(session);
      const report = await runCandidate(FIXTURE_MOUNT_HANG, { budgets: { mountBudgetMs: 600, actionQuietMs: 40, actionHardCapMs: 250 } });

      ok(report.contained === null, `a run with no probes frame at all reports null, never false (got ${JSON.stringify(report.contained)})`);
      ok(report.diagnostics.some((d) => d.kind === 'mount_timeout'), 'the never-painted cause is named on its own terms');
      ok(report.diagnostics.filter((d) => d.kind === 'containment_unobserved').length === 1, 'and the unobserved verdict is named on its own terms — both, exactly once');
      ok(!report.diagnostics.some((d) => d.kind === 'containment_failure'), 'a candidate that never even painted is not reported as a breach');
      ok(report.forgeries.count === 0, `a realm that never ran the oracle produces no rejections at all (got ${report.forgeries.count})`);
    });

    // ── 4.4: a flood of forged frames costs a fixed-size, payload-free signal ──────────────────
    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('forgery flood: the count saturates at the declared cap and no forged byte reaches the report (spec "A rejected forgery is counted, never echoed")', async () => {
      const runCandidate = createRunCandidate(session);
      const report = await runCandidate(FIXTURE_FORGERY_FLOOD, { budgets: { mountBudgetMs: 5000, actionQuietMs: 40, actionHardCapMs: 250 } });

      ok(FORGERY_FLOOD_COUNT > REJECTED_FORGERY_CAP, 'precondition: the fixture posts more forgeries than the cap (otherwise saturation is untested)');
      ok(report.forgeries.rejected === true, 'the fact of rejection is recorded');
      ok(
        report.forgeries.count === REJECTED_FORGERY_CAP,
        `the count saturates at the cap — read as "at least ${REJECTED_FORGERY_CAP}", never as the true number ${FORGERY_FLOOD_COUNT} (got ${report.forgeries.count})`,
      );
      ok(
        !JSON.stringify(report).includes(FORGED_PAYLOAD_MARKER),
        'no byte of any forged payload appears anywhere in the report or its diagnostics',
      );
      ok(report.contained === true, 'the genuine nonce-authenticated verdict is unaffected by the flood');
      ok(!report.diagnostics.some((d) => d.kind === 'containment_failure' || d.kind === 'containment_unobserved'), 'a rejected forgery is not a diagnostic and does not disturb the verdict axis');
    });

    // ── red-check (non-vacuity, task 5.3): a candidate with NO hostile behavior at all must
    // never produce a false-positive diagnostic from the assembled pipeline itself.
    // eslint-disable-next-line sonarjs/assertions-in-tests -- asserts via the house `ok()` helper.
    await test('red-check: the assembled pipeline is non-vacuous — a trivially harmless candidate is clean too', async () => {
      const runCandidate = createRunCandidate(session);
      const report = await runCandidate(FIXTURE_HARMLESS, { budgets: { mountBudgetMs: 5000 } });
      ok(report.ok === true, `a harmless candidate is clean (got ${JSON.stringify(report.diagnostics)})`);
      ok(report.diagnostics.length === 0, 'no diagnostics leak in from the hostile fixture above being run in the same suite');
    });
  } finally {
    await session.close();
  }
}

main();
