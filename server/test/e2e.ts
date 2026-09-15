/**
 * server/test/e2e.ts — chain-6's BROWSER-BACKED suite (spec "Blocking server suite in CI":
 * "A second, browser-backed suite SHALL exercise the pipeline end to end against the real static
 * checker, the real bundle build, and the real synthetic run harness"). Needs Chromium — never
 * part of `npm run server:test` / the fast gate (`server/test/run.mjs`'s own esbuild call). It runs
 * in the full gate as `npm run server:e2e` (`scripts/gate-full.sh`):
 *
 *   node server/test/e2e.run.mjs
 *
 * Also covers the production boot self-test and the browser-context teardown on a real TCP
 * disconnect through the composed server (`lifecycle.ts`), and `reconcile.ts` (task 6.3) — pure
 * Node logic, no browser, kept in this file per chain-6's declared file scope.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { check, eq, report, section } from './harness';
import { ScriptedModelClient } from './scripted-model';
import { E2E_ROSTER, heldRunTurns, MOUNT_HANG } from './e2e-fixtures';
import { BootError, runBootSelfTest, startServer, type ServerHandle } from '../src/lifecycle';
import { createCheckStage } from '../src/generation/stages/check';
import { createBuildStage } from '../src/generation/stages/build';
import { createRunStage } from '../src/generation/stages/run';
import { reconcileAbortedUsage, type GenerationStatsTransport } from '../src/generation/reconcile';
import { InMemoryUsageStore } from '../src/usage-store';
import type { CheckedManifest } from '../src/generation/machine';
import type { Usage } from '@whim/contract';
import { SynthRunSession } from '../../synthrun/session';
import { createRunCandidate } from '../../synthrun/report';
import type { RunCandidate, RunOptions, RunReport } from '../../synthrun/contract';
import type { Page } from 'playwright';

const ROOT = process.cwd();

function readFixture(name: string): string {
  return fs.readFileSync(path.join(ROOT, 'fixtures', name), 'utf8');
}

// ── stub RunCandidate helper (design D8's adapter tested in isolation from the real harness) ──

const EMPTY_BUDGETS = { mountBudgetMs: 8000, actionQuietMs: 300, actionHardCapMs: 4000, totalBudgetMs: 45000 };

function fakeReport(overrides: Partial<RunReport>): RunReport {
  return {
    ok: true,
    diagnostics: [],
    // The harness's verdict is three-valued (`handoff/run-report-contract.md`); this default is the
    // "we saw a clean run" stub. A stub meaning "we never heard back" must say `contained: null`
    // explicitly — there is no value that stands in for it.
    contained: true,
    forgeries: { rejected: false, count: 0 },
    truncated: false,
    timings: { buildMs: 0, bootMs: 0, mountToPaintMs: 0, sweepMs: 0, perScreenMs: {} },
    trace: [],
    screens: { declared: [], visited: [] },
    budgets: EMPTY_BUDGETS,
    ...overrides,
  };
}

function stubRunCandidate(r: RunReport): RunCandidate {
  return async (_source: string, _opts?: RunOptions) => r;
}

const A_MANIFEST: CheckedManifest = { name: 'X', manifest: {}, schema: {} };

/**
 * Wraps a real `RunCandidate` so its raw `RunReport` (with `diagnostics` — a mount timeout, e.g.
 * — survives even when `createRunStage`'s D7 short-circuit zeroes `RunOutcome.diagnostics` to
 * `[]` on `contained:false`) is captured for a failing check's `detail`, without a second harness
 * invocation and without touching the harness's own verdict or timing.
 */
function capturingRunCandidate(candidate: RunCandidate): { candidate: RunCandidate; lastReport: () => RunReport | undefined } {
  let lastReport: RunReport | undefined;
  return {
    candidate: async (source, opts) => {
      const r = await candidate(source, opts);
      lastReport = r;
      return r;
    },
    lastReport: () => lastReport,
  };
}

/** Compact, non-lossy detail for a failing `contained` assertion: the raw verdict (`JSON.stringify`
 *  so `null` and `false` never collapse into the same rendered text) plus every diagnostic's
 *  kind/message from the underlying `RunReport` — present even when `RunOutcome.diagnostics` was
 *  zeroed by the D7 short-circuit — so a `mount_timeout` (never reported back) reads differently
 *  from a genuine `containment_failure` in the CI log. The forgery TALLY is included too (a count,
 *  never a payload — `handoff/run-report-contract.md`'s payload-free invariant), and a CI log line
 *  is not a model-facing path. The tally is NOT a hostility signal: the harness's own T6b spoof
 *  probe is rejected on every run, so a clean candidate's baseline is `rejected: true` with
 *  `count >= 1`, rising with realm resets. It reads as "forgery rejection is happening at all",
 *  and a saturated count reads as a candidate flooding the channel. */
function containedDetail(contained: unknown, capturedReport: RunReport | undefined): string {
  const diagnostics = capturedReport
    ? capturedReport.diagnostics.map((d) => {
        const suffix = d.message ? `: ${d.message}` : '';
        return `${d.kind}${suffix}`;
      })
    : ['<no report captured>'];
  const reportContained = capturedReport ? JSON.stringify(capturedReport.contained) : '<n/a>';
  const forgeries = capturedReport ? JSON.stringify(capturedReport.forgeries) : '<n/a>';
  return `contained=${JSON.stringify(contained)}, report.contained=${reportContained}, forgeries=${forgeries}, diagnostics=${JSON.stringify(diagnostics)}`;
}

// ── RunStage — containment failure is terminal (design D7, spec "Containment failure short-circuits") ──

async function testContainmentFailureShortCircuit(): Promise<void> {
  section('RunStage — containment failure is terminal, feeds nothing back (design D7)');

  const negative = fakeReport({
    contained: false,
    diagnostics: [{ kind: 'runtime_throw', severity: 'error', message: 'boom', hint: 'fix it' }],
  });
  const stage = createRunStage(stubRunCandidate(negative));
  // No `manifest` supplied at all — proves the short-circuit happens BEFORE the manifest
  // requirement is ever consulted.
  const outcome = await stage.run({ source: 'hostile source, irrelevant to the stub', build: { bundle: '' } });

  check('contained:false short-circuits without needing a manifest', outcome.contained === false);
  if (outcome.contained) return;
  eq('nothing is fed back — diagnostics is empty regardless of what the harness itself reported', outcome.diagnostics, []);

  // red-check (non-vacuity): the adapter is a real conditional, not hardcoded to always report a
  // containment failure — a positive verdict from the harness must still deliver.
  const positive = fakeReport({ contained: true, diagnostics: [] });
  const stage2 = createRunStage(stubRunCandidate(positive));
  const outcome2 = await stage2.run({ source: 's', manifest: A_MANIFEST, build: { bundle: 'b' } });
  check('red-check: contained:true from the harness is NOT hardcoded away — it delivers', outcome2.contained === true);
}

// ── RunStage — an unobserved verdict is its own terminal outcome (design D3/D6/D8-local, spec
//    "An unobserved verdict short-circuits with its own reason") ──

/** The harness's own diagnostic for "no authenticated verdict was ever observed"
 *  (`handoff/diagnostic-kind.md` — the kind string and the meaning of its hint are fixed there).
 *  Never a `containment_failure`: never heard back is not evidence of a breach. */
const UNOBSERVED_DIAG = {
  kind: 'containment_unobserved',
  severity: 'error',
  message: 'no authenticated containment verdict was observed',
  hint:
    'no authenticated containment verdict was observed — this run proves nothing about containment; ' +
    're-run it and treat the candidate as unverified, not as escaped',
} as const;

async function testUnobservedVerdictShortCircuit(): Promise<void> {
  section('RunStage — an unobserved verdict maps to its OWN outcome, never to contained:false or true');

  const unobserved = fakeReport({
    ok: false,
    contained: null,
    diagnostics: [UNOBSERVED_DIAG],
  });
  const stage = createRunStage(stubRunCandidate(unobserved));
  // No `manifest` supplied, exactly as in the containment-failure case above: the short-circuit
  // must happen BEFORE the manifest requirement is consulted, so an unobserved verdict can never
  // reach record assembly.
  const outcome = await stage.run({ source: 'a candidate that never reported back', build: { bundle: '' } });

  check(
    'an unobserved report resolves to contained:null — NOT collapsed onto true (which would ship it)',
    outcome.contained === null,
    containedDetail(outcome.contained, unobserved),
  );
  check(
    'an unobserved report is NOT reported as a containment failure — absence of evidence is not evidence',
    outcome.contained !== false,
    containedDetail(outcome.contained, unobserved),
  );
  eq(
    'nothing is fed back — diagnostics is empty, so no containment_unobserved detail can reach a prompt',
    outcome.diagnostics,
    [],
  );

  // red-check (non-vacuity): the null mapping is a real conditional on the report's verdict, not a
  // property of the diagnostic list — the SAME diagnostics with an affirmative verdict still deliver.
  const affirmative = fakeReport({ ok: false, contained: true, diagnostics: [UNOBSERVED_DIAG] });
  const outcome2 = await createRunStage(stubRunCandidate(affirmative)).run({
    source: 's',
    manifest: A_MANIFEST,
    build: { bundle: 'b' },
  });
  check('red-check: contained:null is driven by the verdict, not by the diagnostics', outcome2.contained === true);
}

// ── RunStage — the forgery tally never crosses into a model-facing path (spec "Forgery detail
//    never reaches the model"; `handoff/run-report-contract.md`'s payload-free invariant) ──

async function testForgeryDetailNeverCrossesTheAdapter(): Promise<void> {
  section('RunStage — no forgery detail (payload, count, or the fact of it) survives into the RunOutcome');

  // A candidate that forged verdict frames AND produced a genuine runtime diagnostic: the
  // diagnostics DO travel (they are the repair loop's input), so this is the exact path on which a
  // forgery detail could ride into an assembled prompt.
  const forged = fakeReport({
    ok: false,
    contained: true,
    forgeries: { rejected: true, count: 16 },
    diagnostics: [{ kind: 'runtime_throw', severity: 'error', message: 'boom', hint: 'fix it' }],
  });
  const outcome = await createRunStage(stubRunCandidate(forged)).run({ source: 's', manifest: A_MANIFEST, build: { bundle: 'b' } });

  check('the outcome carries no forgery field at all', !('forgeries' in outcome));
  if (outcome.contained !== true) return;
  const serialized = JSON.stringify(outcome).toLowerCase();
  for (const leak of ['forger', 'rejected', '16']) {
    check(`no forgery detail rides along on the model-facing outcome (${leak})`, !serialized.includes(leak));
  }
  eq('the genuine runtime diagnostic still travels — the guard is scoped, not a blanket drop', outcome.diagnostics.length, 1);
}

// ── RunStage — truncation is never a silent pass (spec "Truncation is not a pass") ──

async function testTruncationIsNotAPass(): Promise<void> {
  section('RunStage — truncation is never a silent pass');

  // A per-screen sweep truncation carries NO diagnostic from the harness itself
  // (`synthrun/sweep.ts`'s `SweepResult.truncated` is a bare flag) — the adapter must synthesize one.
  const truncatedNoDiag = fakeReport({ truncated: true, diagnostics: [] });
  const outcome1 = await createRunStage(stubRunCandidate(truncatedNoDiag)).run({ source: 's', manifest: A_MANIFEST, build: { bundle: 'b' } });
  check('truncated candidates still resolve contained:true (the MACHINE decides pass/repair, never the stage)', outcome1.contained === true);
  if (outcome1.contained) {
    const synthesized = outcome1.diagnostics.find((d) => d.kind === 'run_truncated');
    check('a run_truncated diagnostic is synthesized when the harness did not already carry one', !!synthesized);
    eq('the synthesized diagnostic is error severity (drives the ordinary repair gate, never a silent warning)', synthesized?.severity, 'error');
  }

  // The total-budget watchdog already appends its own `run_truncated` — no duplicate.
  const truncatedWithDiag = fakeReport({
    truncated: true,
    diagnostics: [{ kind: 'run_truncated', severity: 'error', message: 'm', hint: 'h' }],
  });
  const outcome2 = await createRunStage(stubRunCandidate(truncatedWithDiag)).run({ source: 's', manifest: A_MANIFEST, build: { bundle: 'b' } });
  if (outcome2.contained) {
    eq('no duplicate run_truncated diagnostic is synthesized', outcome2.diagnostics.filter((d) => d.kind === 'run_truncated').length, 1);
  }

  // red-check: a clean, non-truncated report never gets a spurious run_truncated diagnostic.
  const clean = fakeReport({});
  const outcome3 = await createRunStage(stubRunCandidate(clean)).run({ source: 's', manifest: A_MANIFEST, build: { bundle: 'b' } });
  if (outcome3.contained) {
    check('red-check: a clean report never gets a spurious run_truncated diagnostic', !outcome3.diagnostics.some((d) => d.kind === 'run_truncated'));
  }
}

// ── The honest corpus-shaped candidate through the REAL check, build, and run stages ──

/**
 * esbuild embeds the input FILE PATH as a `//` banner comment and derives its module-scope
 * identifier names (`<basename>_exports`/`<basename>_default`) from the same basename.
 * `createBuildStage()` always builds from raw TEXT through a synthesized temp file
 * (`synthrun/builder.ts`'s `buildCandidateSource`, filename `candidate.app.tsx` — deliberately: a
 * freshly-generated candidate has no file on disk to build FROM), so its output can never
 * literally match a FILE-PATH build's (e.g. the checked-in production artifact) comment/identifier
 * pair — `builder.ts`'s own doc comment: "the filename affects only esbuild's internal bundle
 * identifiers, never the app's runtime behavior". Normalizing away exactly that (and only that)
 * documented difference is what "byte-identical to the production build" can honestly mean for a
 * candidate built from text; any OTHER divergence (options, externals, JSX transform, minify, …)
 * still fails this comparison.
 */
function normalizeBuildIdentity(bundle: string): string {
  return bundle.replace(/\/\/ .*\.app\.tsx\n/g, '// <source>\n').replace(/\b\w+_app_(exports|default)\b/g, 'app_$1');
}

async function testHonestCandidateReachesResult(session: SynthRunSession): Promise<void> {
  section('spec: an honest corpus-shaped candidate reaches a result through the real check, build, and run stages');

  const source = readFixture('tip-splitter.app.tsx');
  const checkReport = await createCheckStage().check(source, {});
  check('setup: the honest fixture has no check-stage errors', !checkReport.diagnostics.some((d) => (d.severity ?? 'error') === 'error'));
  check('setup: a manifest was extracted', !!checkReport.manifest);
  if (!checkReport.manifest) return;

  const buildOutcome = await createBuildStage().build(source);
  check('the real build stage succeeds', buildOutcome.ok);
  if (!buildOutcome.ok) return;

  const { candidate, lastReport } = capturingRunCandidate(createRunCandidate(session));
  const runStage = createRunStage(candidate);
  const outcome = await runStage.run({ source, manifest: checkReport.manifest, build: buildOutcome.result });

  check(
    'the real run reaches contained:true',
    outcome.contained === true,
    outcome.contained === true ? undefined : containedDetail(outcome.contained, lastReport()),
  );
  if (!outcome.contained) return;
  eq('a clean fixture produces no diagnostics', outcome.diagnostics, []);
  eq('the delivered record name matches the extraction', outcome.record.name, 'Tip Splitter');

  const productionArtifact = fs.readFileSync(path.join(ROOT, 'build/generated/tip-splitter.app.js'), 'utf8');
  eq(
    'the delivered bundle is byte-identical to the production build, modulo the one documented, ' +
      'harmless difference building from TEXT (no file path) forces — the embedded esbuild source ' +
      'comment and its derived identifier names',
    normalizeBuildIdentity(outcome.record.bundle),
    normalizeBuildIdentity(productionArtifact),
  );

  // red-check (non-vacuity): normalization is narrowly scoped to that one difference — an
  // actually-different bundle (a perturbed esbuild option, same drift-tripwire technique
  // `synthrun/test/acceptance.ts` uses) must still be caught, not swallowed by the normalizer.
  const perturbed = productionArtifact.replace('React.createElement', 'React.createElementPerturbed');
  check(
    'red-check: normalization does not launder an actual content difference',
    normalizeBuildIdentity(perturbed) !== normalizeBuildIdentity(productionArtifact),
  );
}

// ── A real escape-attempting candidate stays contained (non-vacuity for the stub test above) ──

async function testHostileCandidateStaysContained(session: SynthRunSession): Promise<void> {
  section(
    'red-check (non-vacuity): a real escape-attempting candidate run through the REAL harness stays ' +
      'contained — proves the stub-based short-circuit test above exercises a real mapping, not a ' +
      'vacuously-always-false stub',
  );

  // Deliberately raw (no check-stage gating): `fixtures/adversarial/evil.app.tsx`'s own top
  // comment documents that a real static check would reject it — the pen test targets the
  // RUNTIME sandbox, the harness's own job, exactly as `synthrun`'s own suite treats its hostile
  // fixtures (never gated through the checker either).
  const hostileSource = readFixture('adversarial/evil.app.tsx');
  const buildOutcome = await createBuildStage().build(hostileSource);
  check('setup: the hostile fixture still builds (esbuild neither type-checks nor gates on forbidden globals)', buildOutcome.ok);
  if (!buildOutcome.ok) return;

  const { candidate, lastReport } = capturingRunCandidate(createRunCandidate(session));
  const runStage = createRunStage(candidate);
  const manifest: CheckedManifest = { name: 'Evil App', manifest: { capabilities: [] }, schema: {} };
  const outcome = await runStage.run({ source: hostileSource, manifest, build: buildOutcome.result });

  check(
    'the sandbox genuinely contains every escape attempt in the fixture — contained stays true',
    outcome.contained === true,
    outcome.contained === true ? undefined : containedDetail(outcome.contained, lastReport()),
  );
}

// ── Cancellation mid-run: context disposed, concurrency slot released ──

const TICKING_SOURCE = `import { defineApp, Screen, Stack, Heading, Text, useState, interval } from 'vc-sdk';
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

async function testCancellationDisposesAndReleasesSlot(): Promise<void> {
  section('spec: cancellation mid-run disposes the context and releases the concurrency slot');

  const session = await SynthRunSession.launch({ concurrency: 1 });
  try {
    const runCandidate = createRunCandidate(session);
    let capturedPage: Page | undefined;
    const controller = new AbortController();

    const started = Date.now();
    await runCandidate(TICKING_SOURCE, {
      signal: controller.signal,
      budgets: { mountBudgetMs: 5000, totalBudgetMs: 20000 },
      beforeNavigate: async (page) => {
        capturedPage = page;
        // Counted from the page's load, not from here, so however long navigation takes the abort
        // lands after it (mid-mount or mid-sweep, where the run resolves with a report) rather than
        // during `goto` (where it rejects with an AbortError).
        page.once('load', () => setTimeout(() => controller.abort(), 250));
      },
    });
    const elapsed = Date.now() - started;

    check('the aborted run resolves promptly, well under the 20s total budget', elapsed < 8000);
    check('the page/context was disposed on abort', capturedPage?.isClosed() === true);

    // Prove the slot was RELEASED, not leaked: a second run on the SAME concurrency:1 session
    // must still complete promptly, rather than queue forever behind a stuck slot.
    const secondStarted = Date.now();
    const secondReport = await runCandidate(TICKING_SOURCE, { budgets: { mountBudgetMs: 5000 } });
    const secondElapsed = Date.now() - secondStarted;
    check('a second run on the same session completes cleanly — the slot was released', secondReport.contained === true);
    check('the second run did not queue behind a leaked slot', secondElapsed < 8000);
  } finally {
    await session.close();
  }
}

// ── The production boot self-test (design D16, spec "Production boot proves the synthetic run
//    works before serving") ──

/** Throws while rendering, so its run reports an error diagnostic. */
const THROWS_ON_MOUNT = `import { defineApp, Screen, Text } from 'vc-sdk';
function Home() {
  throw new Error('the self-test fixture failed to render');
  return <Screen><Text>unreachable</Text></Screen>;
}
export default defineApp({ name: 'Broken', initial: 'Home', screens: { Home }, capabilities: [] });
`;

async function testBootSelfTest(session: SynthRunSession): Promise<void> {
  section('spec: the boot self-test passes on a healthy session');

  const outcome = await runBootSelfTest(session).then(
    () => 'passed',
    (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err)),
  );
  eq('the curated fixture runs contained with no error diagnostic, and egress from a run context is blocked', outcome, 'passed');

  // red-check (non-vacuity): a run that reports an error diagnostic must fail boot, so the self-test
  // is more than "the browser started".
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-self-test-'));
  try {
    fs.mkdirSync(path.join(cwd, 'fixtures'));
    fs.writeFileSync(path.join(cwd, 'fixtures', 'tip-splitter.app.tsx'), THROWS_ON_MOUNT);
    const failed = await runBootSelfTest(session, cwd).then(
      () => undefined,
      (err: unknown) => err,
    );
    check(
      'red-check: a fixture that throws while rendering fails the self-test as a boot failure',
      failed instanceof BootError && failed.reason === 'self_test',
      String(failed),
    );
    check('and the failure names the fixture', failed instanceof Error && failed.message.includes('fixtures/tip-splitter.app.tsx'), String(failed));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

// ── The composed server: boot gates listening, and a real TCP disconnect closes the browser
//    context (spec "A real TCP disconnect closes the browser context") ──

const DISCONNECT_BOUND_MS = 5000;

const HARMLESS = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
function Home() { return <Screen><Stack><Heading size="title">Harmless</Heading></Stack></Screen>; }
export default defineApp({ name: 'Harmless', initial: 'Home', screens: { Home }, capabilities: [] });
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `predicate` until it holds or `ms` elapses; returns whether it held. */
async function waitUntil(predicate: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await sleep(20);
  }
  return true;
}

const TIMED_OUT = Symbol('timed out');

/** `work`, or `TIMED_OUT` once `ms` pass on a ref'd timer. A late rejection of `work` is observed. */
async function within<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  work.catch(() => undefined);
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function testComposedServerBootAndDisconnect(): Promise<void> {
  section('spec: the composed server listens only after its self-test, and a real TCP disconnect closes the run\'s browser context');

  // Serving installs @hono/node-server's Request/Response globals; they are put back afterwards.
  const savedRequest = Object.getOwnPropertyDescriptor(globalThis, 'Request');
  const savedResponse = Object.getOwnPropertyDescriptor(globalThis, 'Response');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-e2e-server-'));
  const model = new ScriptedModelClient(E2E_ROSTER, heldRunTurns());
  let handle: ServerHandle | undefined;
  try {
    const checked = await createCheckStage().check(MOUNT_HANG, {});
    check('setup: the hanging candidate passes the static checks, so it reaches the run stage', !checked.diagnostics.some((d) => d.severity === 'error'), JSON.stringify(checked.diagnostics));

    const port = await freePort();
    let booted = false;
    const starting = startServer({
      env: { WHIM_DATA_DIR: dataDir, WHIM_SYNTHRUN_CONCURRENCY: '1' },
      overrides: { model: { client: model, roster: E2E_ROSTER } },
      listen: { host: '127.0.0.1', port },
    }).finally(() => {
      booted = true;
    });
    let probes = 0;
    let acceptedBeforeBoot = false;
    while (!booted) {
      probes++;
      if ((await accepts(port)) && !booted) acceptedBeforeBoot = true;
      await sleep(25);
    }
    const started = await within(starting, 60_000).then(
      (value) => value,
      (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
    );
    if (started === TIMED_OUT || started instanceof Error) {
      check('the composed server booted', false, String(started));
      return;
    }
    handle = started;
    const session = handle.session;
    check('nothing accepted a connection while the browser launched and the self-test ran', !acceptedBeforeBoot);
    check('non-vacuity: the port was probed throughout boot', probes > 3, `${probes} probes`);
    check('the server accepts connections once boot resolved', await accepts(port));
    eq('it reports its bound URL', handle.url, `http://127.0.0.1:${port}`);
    if (!session) {
      check('the real pipeline has a synthetic-run session', false);
      return;
    }

    const client = rawGenerate(port, 'e2e0e2e0-e2e0-4e20-8e20-e2e0e2e0e2e0', 'a slow app');

    check('the candidate reached the run stage and opened its browser context', await waitUntil(() => session.openContextCount() === 1, 60_000), client.text().slice(-800));
    // The page loads in tens of milliseconds and the candidate never paints, so by now the run is
    // held in its mount wait.
    await sleep(500);
    check('setup: the run is still held in the run stage', session.openContextCount() === 1 && !hasTerminalEvent(client.text()));
    const destroyedAt = Date.now();
    client.socket.destroy();

    check(`within ${DISCONNECT_BOUND_MS} ms the session has no open browser context`, await waitUntil(() => session.openContextCount() === 0, DISCONNECT_BOUND_MS), `${Date.now() - destroyedAt} ms`);
    const remaining = Math.max(1, DISCONNECT_BOUND_MS - (Date.now() - destroyedAt));
    const next = await within(session.openRun(HARMLESS).then((run) => run.dispose()), remaining);
    check(`and within ${DISCONNECT_BOUND_MS} ms its only concurrency slot is free for another run`, next !== TIMED_OUT, `${Date.now() - destroyedAt} ms`);
    eq('no model call was made after the disconnect', model.requests.length, 3);
    check('the stream never produced a terminal event', !hasTerminalEvent(client.text()), client.text().slice(-800));

    const closing = await within(handle.close(), 30_000);
    check('the server drains closed', closing !== TIMED_OUT);
    handle = undefined;
    check('and no longer accepts connections', !(await accepts(port)));
  } finally {
    if (handle) await within(handle.close(), 30_000);
    if (savedRequest) Object.defineProperty(globalThis, 'Request', savedRequest);
    if (savedResponse) Object.defineProperty(globalThis, 'Response', savedResponse);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// ── A real server process under SIGTERM with a synthetic run in flight (spec "SIGTERM drains
//    in-flight work before exit", "The deadline aborts the rest") ──

const DRAIN_DEADLINE_MS = 4000;

/** `process.kill(pid, 0)` probes a process without signalling it. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** `e2e-drain-server.ts` running as its own process, with its combined output. */
interface DrainServer {
  output(): string;
  /** Every JSON line it printed: its logs and its `e2eServer` reports. */
  records(): Record<string, unknown>[];
  /** The `e2eServer` reports only. */
  reports(): Record<string, unknown>[];
  /** The last open-context count it reported. */
  lastContexts(): unknown;
  exit(): { code: number | null; signal: NodeJS.Signals | null } | undefined;
  exited: Promise<void>;
  signal(signal: NodeJS.Signals): void;
  /** Kills it if still running and removes its bundle. */
  dispose(): Promise<void>;
}

async function spawnDrainServer(dataDir: string): Promise<DrainServer> {
  const childFile = path.join(ROOT, `.server-e2e-drain.${process.pid}.tmp.mjs`);
  await build({
    entryPoints: [path.join(ROOT, 'server', 'test', 'e2e-drain-server.ts')],
    outfile: childFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['esbuild', 'playwright', 'typescript', 'pino'],
    logLevel: 'warning',
  });

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? os.homedir(),
    WHIM_LOG_JSON: '1',
    WHIM_DATA_DIR: dataDir,
    WHIM_SYNTHRUN_CONCURRENCY: '1',
    WHIM_DRAIN_TIMEOUT_MS: String(DRAIN_DEADLINE_MS),
  };
  for (const name of ['TMPDIR', 'PLAYWRIGHT_BROWSERS_PATH']) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  const child = spawn(process.execPath, [childFile], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk;
  });
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  const exited = new Promise<void>((resolve) => {
    child.once('exit', (code, signal) => {
      exit = { code, signal };
      resolve();
    });
  });
  const records = (): Record<string, unknown>[] =>
    output
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch (err) {
          return { unparsed: line, detail: String(err) };
        }
      });
  const reports = (): Record<string, unknown>[] =>
    records().flatMap((record) => (record.e2eServer && typeof record.e2eServer === 'object' ? [record.e2eServer as Record<string, unknown>] : []));
  return {
    output: () => output,
    records,
    reports,
    lastContexts: () => reports().filter((r) => 'contexts' in r).at(-1)?.contexts,
    exit: () => exit,
    exited,
    signal: (signal) => {
      child.kill(signal);
    },
    dispose: async () => {
      if (!exit) child.kill('SIGKILL');
      await within(exited, 10_000);
      fs.rmSync(childFile, { force: true });
    },
  };
}

/** A `POST /v1/generate` written straight onto a TCP socket, accumulating the raw response. */
function rawGenerate(port: number, deviceId: string, prompt: string): { socket: net.Socket; text: () => string } {
  const payload = JSON.stringify({ prompt });
  const socket = net.connect({ port, host: '127.0.0.1' });
  let received = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    received += chunk;
  });
  socket.on('error', () => undefined);
  socket.write(
    [
      'POST /v1/generate HTTP/1.1',
      'Host: 127.0.0.1',
      'Content-Type: application/json',
      `Content-Length: ${Buffer.byteLength(payload)}`,
      `x-whim-device: ${deviceId}`,
      'Connection: close',
      '',
      payload,
    ].join('\r\n'),
  );
  return { socket, text: () => received };
}

function hasTerminalEvent(stream: string): boolean {
  return stream.includes('event: result') || stream.includes('event: failure');
}

/** Watches the first `ms` after the signal. Returns what ended the run early, or `undefined` if the
 *  browser stayed up, the run's context stayed open, no terminal event arrived and the server ran on. */
async function earlyEnding(server: DrainServer, browserPid: number, stream: () => string, signalledAt: number, ms: number): Promise<string | undefined> {
  while (Date.now() - signalledAt < ms) {
    const at = `${Date.now() - signalledAt} ms after SIGTERM`;
    if (!processAlive(browserPid)) return `the browser process exited ${at}`;
    if (server.exit()) return `the server exited ${at} (${JSON.stringify(server.exit())})`;
    if (hasTerminalEvent(stream())) return `the stream ended with a terminal event ${at}`;
    if (server.lastContexts() !== 1) return `the run's browser context closed ${at}`;
    await sleep(50);
  }
  return undefined;
}

function ledgerOutcomes(dataDir: string): string[] {
  const db = new DatabaseSync(path.join(dataDir, 'usage.db'), { readOnly: true });
  try {
    return (db.prepare('SELECT outcome FROM requests').all() as { outcome: string }[]).map((row) => row.outcome);
  } finally {
    db.close();
  }
}

async function testRealPipelineSigtermDrain(): Promise<void> {
  section('spec: SIGTERM with a synthetic run in flight keeps the browser until the drain deadline aborts the run, then exits 0');

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-e2e-drain-'));
  const server = await spawnDrainServer(dataDir);
  try {
    const booted = await waitUntil(() => server.reports().some((r) => typeof r.url === 'string') || server.exit() !== undefined, 90_000);
    const ready = server.reports().find((r) => typeof r.url === 'string');
    check('setup: the server process booted the real pipeline, self-test included', booted && ready !== undefined, server.output().slice(-2000));
    if (!ready) return;
    const browserPid = Number(ready.browserPid);
    const client = rawGenerate(Number(new URL(String(ready.url)).port), 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0', 'a slow app');
    try {
      check('setup: the generation reached the run stage and opened its browser context', await waitUntil(() => server.lastContexts() === 1, 60_000), server.output().slice(-2000));
      await sleep(500);
      check('setup: the run is held in its mount wait and the browser process is alive', server.lastContexts() === 1 && processAlive(browserPid) && !hasTerminalEvent(client.text()));

      const signalledAt = Date.now();
      server.signal('SIGTERM');
      check('the drain started', await waitUntil(() => server.records().some((r) => r.msg === 'drain started') || server.exit() !== undefined, 5000), server.output().slice(-2000));
      const early = await earlyEnding(server, browserPid, client.text, signalledAt, DRAIN_DEADLINE_MS - 1000);
      check('during the drain wait the browser stays connected and the run stays in flight', early === undefined, early);

      await within(server.exited, 30_000);
      eq('then the process exits 0', server.exit()?.code, 0);
      check('it exited only after the deadline', Date.now() - signalledAt >= DRAIN_DEADLINE_MS, `${Date.now() - signalledAt} ms`);
      check("the deadline closed the run's browser context before the process exited", server.reports().some((r) => r.contexts === 0), JSON.stringify(server.reports()));
      check('the drain completed', server.reports().some((r) => r.drained === true), server.output().slice(-2000));
      check('the stream was aborted without a terminal event', !hasTerminalEvent(client.text()), client.text().slice(-500));
      eq('the ledger settled the generation as aborted', ledgerOutcomes(dataDir), ['aborted']);
      check('the browser process is gone once the server has exited', await waitUntil(() => !processAlive(browserPid), 10_000));
    } finally {
      client.socket.destroy();
    }
  } finally {
    await server.dispose();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// ── reconcile.ts (task 6.3) — post-abort usage reconciliation, no browser needed ──

class FakeTransport implements GenerationStatsTransport {
  private readonly attempts = new Map<string, number>();
  constructor(
    private readonly resolved: Map<string, Usage>,
    private readonly resolveOnAttempt = 1,
    private readonly throwFirst = false,
  ) {}
  async fetchStats(id: string): Promise<Usage | null> {
    const n = (this.attempts.get(id) ?? 0) + 1;
    this.attempts.set(id, n);
    if (this.throwFirst && n === 1) throw new Error('simulated transport failure');
    if (n < this.resolveOnAttempt) return null;
    return this.resolved.get(id) ?? null;
  }
  attemptsFor(id: string): number {
    return this.attempts.get(id) ?? 0;
  }
}

const USAGE_A: Usage = { promptTokens: 10, completionTokens: 20, totalTokens: 30 };
const USAGE_B: Usage = { promptTokens: 1, completionTokens: 2, totalTokens: 3 };

async function testReconciliation(): Promise<void> {
  section('reconcile.ts — post-abort usage reconciliation (design D9)');

  // "Cancelled run credits the reconciled usage"
  {
    const transport = new FakeTransport(new Map([['gen-1', USAGE_A]]));
    const usageStore = new InMemoryUsageStore();
    await reconcileAbortedUsage('device-1', ['gen-1'], { transport, usageStore });
    eq('the resolved usage is credited to the calling device', await usageStore.read('device-1'), USAGE_A);
  }

  // multiple ids sum together
  {
    const transport = new FakeTransport(new Map([['gen-1', USAGE_A], ['gen-2', USAGE_B]]));
    const usageStore = new InMemoryUsageStore();
    await reconcileAbortedUsage('device-2', ['gen-1', 'gen-2'], { transport, usageStore });
    eq('multiple recorded ids sum into one credit', await usageStore.read('device-2'), {
      promptTokens: USAGE_A.promptTokens + USAGE_B.promptTokens,
      completionTokens: USAGE_A.completionTokens + USAGE_B.completionTokens,
      totalTokens: USAGE_A.totalTokens + USAGE_B.totalTokens,
    });
  }

  // "Reconciliation gives up quietly"
  {
    const transport = new FakeTransport(new Map()); // never resolves anything
    const usageStore = new InMemoryUsageStore();
    const started = Date.now();
    await reconcileAbortedUsage('device-3', ['gen-never'], {
      transport,
      usageStore,
      bounds: { maxAttempts: 3, totalBudgetMs: 150, retryDelayMs: 20 },
    });
    const elapsed = Date.now() - started;
    eq('nothing is credited when the transport never resolves', await usageStore.read('device-3'), {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    check('the give-up is bounded — it does not hang past the budget', elapsed < 1000);
    check('non-vacuity: the transport really was retried more than once before giving up', transport.attemptsFor('gen-never') > 1);
  }

  // A transport rejection is treated the same as an unresolved null — quiet, never throws.
  {
    const transport = new FakeTransport(new Map([['gen-x', USAGE_A]]), 2, true);
    const usageStore = new InMemoryUsageStore();
    await reconcileAbortedUsage('device-4', ['gen-x'], {
      transport,
      usageStore,
      bounds: { maxAttempts: 5, totalBudgetMs: 2000, retryDelayMs: 10 },
    });
    eq('a transport rejection on the first attempt does not prevent a later successful credit', await usageStore.read('device-4'), USAGE_A);
  }

  // "No double counting" — the reconcile.ts-testable slice: an empty id list (a run that never
  // started a model call, or a route that never schedules reconciliation for a normal completion)
  // is a true no-op. Full enforcement that a NORMALLY-completed run never reaches this function at
  // all is the route's job (task 7.3), outside this chain's file scope.
  {
    const transport = new FakeTransport(new Map([['unused', USAGE_A]]));
    const usageStore = new InMemoryUsageStore();
    await reconcileAbortedUsage('device-5', [], { transport, usageStore });
    eq('an empty id list credits nothing and calls the transport zero times', await usageStore.read('device-5'), {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
    eq('the transport was never invoked', transport.attemptsFor('unused'), 0);
  }

  // red-check: `usageStore.credit` throwing must not escape reconcileAbortedUsage either.
  {
    const transport = new FakeTransport(new Map([['gen-y', USAGE_A]]));
    const throwingStore = {
      credit: async () => { throw new Error('store failure'); },
      read: async () => USAGE_B,
      admit: async () => { throw new Error('not used in this test'); },
      refund: async () => {},
      settle: async () => {},
      recordCost: async () => {},
      summary: async () => { throw new Error('not used in this test'); },
      purgeLedger: async () => 0,
    };
    let threw = false;
    try {
      await reconcileAbortedUsage('device-6', ['gen-y'], { transport, usageStore: throwingStore });
    // eslint-disable-next-line no-restricted-syntax -- intentional: the flag flip below is the assertion that credit failures never escape
    } catch {
      threw = true;
    }
    check('red-check: a UsageStore.credit failure never escapes reconciliation (gives up quietly, spec-wide)', threw === false);
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await testContainmentFailureShortCircuit();
  await testUnobservedVerdictShortCircuit();
  await testForgeryDetailNeverCrossesTheAdapter();
  await testTruncationIsNotAPass();
  await testReconciliation();

  const session = await SynthRunSession.launch({ concurrency: 2 });
  try {
    await testHonestCandidateReachesResult(session);
    await testHostileCandidateStaysContained(session);
    await testBootSelfTest(session);
  } finally {
    await session.close();
  }

  await testCancellationDisposesAndReleasesSlot();
  await testComposedServerBootAndDisconnect();
  await testRealPipelineSigtermDrain();

  report();
}

await main();
