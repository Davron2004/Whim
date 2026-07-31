/**
 * server/test/e2e.ts — chain-6's BROWSER-BACKED suite (spec "Blocking server suite in CI":
 * "A second, browser-backed suite SHALL exercise the pipeline end to end against the real static
 * checker, the real bundle build, and the real synthetic run harness"). Needs Chromium — never
 * part of `npm run server:test` / the fast gate (`server/test/run.mjs`'s own esbuild call). Its
 * own `package.json` script and `gate-full.sh` line are Class-2 and unapplied
 * (`openspec/changes/generation-loop/pending-class2.md`) — run directly:
 *
 *   node server/test/e2e.run.mjs
 *
 * Also covers `reconcile.ts` (task 6.3) — pure Node logic, no browser, kept in this file per this
 * chain's declared file scope rather than a second unregistered suite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { check, eq, report, section } from './harness';
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
    contained: true,
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

  const runStage = createRunStage(createRunCandidate(session));
  const outcome = await runStage.run({ source, manifest: checkReport.manifest, build: buildOutcome.result });

  check('the real run reaches contained:true', outcome.contained === true);
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

  const runStage = createRunStage(createRunCandidate(session));
  const manifest: CheckedManifest = { name: 'Evil App', manifest: { capabilities: [] }, schema: {} };
  const outcome = await runStage.run({ source: hostileSource, manifest, build: buildOutcome.result });

  check('the sandbox genuinely contains every escape attempt in the fixture — contained stays true', outcome.contained === true);
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
        // give mount time to finish so the abort lands mid-sweep, not mid-boot.
        setTimeout(() => controller.abort(), 250);
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
    const throwingStore = { credit: async () => { throw new Error('store failure'); }, read: async () => USAGE_B };
    let threw = false;
    try {
      await reconcileAbortedUsage('device-6', ['gen-y'], { transport, usageStore: throwingStore });
    } catch {
      threw = true;
    }
    check('red-check: a UsageStore.credit failure never escapes reconciliation (gives up quietly, spec-wide)', threw === false);
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await testContainmentFailureShortCircuit();
  await testTruncationIsNotAPass();
  await testReconciliation();

  const session = await SynthRunSession.launch({ concurrency: 2 });
  try {
    await testHonestCandidateReachesResult(session);
    await testHostileCandidateStaysContained(session);
  } finally {
    await session.close();
  }

  await testCancellationDisposesAndReleasesSlot();

  report();
}

await main();
