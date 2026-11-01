/**
 * server/test/run-stage.suite.ts — the harness adapter (`src/generation/stages/run.ts`, design D8)
 * driven by a hand-built `RunReport` through a stub `RunCandidate`. Pure Node, no Chromium: these
 * were originally in `e2e.ts` (which needs a real browser for its OTHER tests) even though nothing
 * here does, so a regression here only failed `gate-full`'s browser-backed suite instead of the
 * fast gate. `run-stage-fixtures.ts` holds the fixtures this shares with `e2e.ts`.
 */
import { check, eq, section } from './harness';
import { createRunStage } from '../src/generation/stages/run';
import { A_MANIFEST, containedDetail, fakeReport, sequencedRunCandidate, stubRunCandidate } from './run-stage-fixtures';

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
  if (outcome.contained !== false) return;
  eq('nothing is fed back — diagnostics is empty regardless of what the harness itself reported', outcome.diagnostics, []);
  eq('a first-run breach was not re-run', outcome.rerun, false);
  eq('the verdict the machine logs is the probes’ breach, not the earlier throw', outcome.verdict, { kind: 'breach', check: 'containment_failure' });

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
  if (outcome.contained === null && !outcome.repairable) {
    eq('with nothing else recorded, the unverified verdict names containment_unobserved itself', outcome.verdict, { kind: 'unobserved', check: 'containment_unobserved' });
  }
  const afterProbesFailure = await createRunStage(
    stubRunCandidate(
      fakeReport({
        ok: false,
        contained: null,
        unobservedPhase: 'probes',
        diagnostics: [{ kind: 'runtime_throw', severity: 'error', message: '[probes] failed', hint: 'h' }, UNOBSERVED_DIAG],
      }),
    ),
  ).run({ source: 's', build: { bundle: '' } });
  eq(
    'an unverified run names the first check that kept the verdict away',
    afterProbesFailure.contained === null && !afterProbesFailure.repairable ? afterProbesFailure.verdict : afterProbesFailure.contained,
    { kind: 'unobserved', check: 'runtime_throw' },
  );

  // red-check (non-vacuity): the null mapping is a real conditional on the report's verdict, not a
  // property of the diagnostics list — the SAME diagnostics with an affirmative verdict still deliver.
  const affirmative = fakeReport({ ok: false, contained: true, diagnostics: [UNOBSERVED_DIAG] });
  const outcome2 = await createRunStage(stubRunCandidate(affirmative)).run({
    source: 's',
    manifest: A_MANIFEST,
    build: { bundle: 'b' },
  });
  check('red-check: contained:null is driven by the verdict, not by the diagnostics', outcome2.contained === true);
}

// ── RunStage — a candidate that never mounted is repaired; a harness fault is re-run once
//    (#58, design D1; spec "The run stage is the synthetic harness, and containment failure is terminal") ──

const MODULE_THROW = {
  kind: 'runtime_throw',
  severity: 'error',
  message: 'RangeError: Currency code is required with currency style.',
  line: 2,
  hint: 'an uncaught exception escaped the candidate — wrap the risky call or fix the bug it exposes',
} as const;

async function testNeverMountedCandidateIsRepairable(): Promise<void> {
  section('RunStage — module-eval, bundle and mount-timeout phases send the candidate to repair, with no containment_* detail');

  const phases = [
    ['module-eval', MODULE_THROW],
    ['bundle', { kind: 'runtime_throw', severity: 'error', message: '[bundle] no AppSpec default export', hint: 'h' }],
    ['mount-timeout', { kind: 'mount_timeout', severity: 'error', message: 'no paint within budget', hint: 'h' }],
  ] as const;
  for (const [phase, cause] of phases) {
    const { runCandidate, calls } = sequencedRunCandidate(fakeReport({ ok: false, contained: null, unobservedPhase: phase, diagnostics: [cause, UNOBSERVED_DIAG] }));
    const outcome = await createRunStage(runCandidate).run({ source: 's', build: { bundle: '' } });

    check(`${phase}: the outcome is the repairable arm`, outcome.contained === null && outcome.repairable);
    if (outcome.contained !== null || !outcome.repairable) continue;
    eq(`${phase}: the phase is carried`, outcome.phase, phase);
    eq(`${phase}: the candidate diagnostic travels and no containment_* kind does`, outcome.diagnostics.map((d) => d.kind), [cause.kind]);
    eq(`${phase}: the candidate is not re-run`, calls(), 1);
  }

  const { runCandidate } = sequencedRunCandidate(fakeReport({ ok: false, contained: null, unobservedPhase: 'module-eval', diagnostics: [MODULE_THROW, UNOBSERVED_DIAG] }));
  const outcome = await createRunStage(runCandidate).run({ source: 's', build: { bundle: '' } });
  eq(
    'module-eval: the diagnostic keeps its message, line and hint, as any run-observed runtime_throw does',
    outcome.diagnostics.map(({ kind, severity, message, line, hint }) => ({ kind, severity, message, line, hint })),
    [MODULE_THROW],
  );
}

async function testHarnessFaultIsRerunOnce(): Promise<void> {
  section('RunStage — any other unobserved phase re-runs the same source once, then ends terminal');

  // The discriminating control: a loader `[probes]` failure is a harness fault, never the candidate's.
  const probesOnly = fakeReport({
    ok: false,
    contained: null,
    unobservedPhase: 'probes',
    diagnostics: [{ kind: 'runtime_throw', severity: 'error', message: '[probes] probe function missing', hint: 'h' }, UNOBSERVED_DIAG],
  });
  const probes = sequencedRunCandidate(probesOnly);
  const probesOutcome = await createRunStage(probes.runCandidate).run({ source: 's', build: { bundle: '' } });
  check('a probes-phase report is NOT repairable', !(probesOutcome.contained === null && probesOutcome.repairable));
  eq('a probes-phase report is run exactly twice', probes.calls(), 2);

  for (const phase of ['none', 'mount', 'deliver'] as const) {
    const { runCandidate, calls } = sequencedRunCandidate(fakeReport({ ok: false, contained: null, unobservedPhase: phase, diagnostics: [UNOBSERVED_DIAG] }));
    const sources: string[] = [];
    const recording = async (source: string, opts?: Parameters<typeof runCandidate>[1]): ReturnType<typeof runCandidate> => {
      sources.push(source);
      return runCandidate(source, opts);
    };
    const outcome = await createRunStage(recording).run({ source: 'the candidate', build: { bundle: '' } });
    eq(`${phase}: the candidate is run exactly twice`, calls(), 2);
    eq(`${phase}: both runs got the same unchanged source`, sources, ['the candidate', 'the candidate']);
    check(`${phase}: still unobserved, the outcome is terminal and says it was re-run`, outcome.contained === null && !outcome.repairable && outcome.rerun && outcome.phase === phase);
    eq(`${phase}: nothing is fed back`, outcome.diagnostics, []);
  }

  // A re-run that is still unobserved is terminal whatever its phase: a candidate is never sent to repair from it.
  const flaky = sequencedRunCandidate(
    fakeReport({ ok: false, contained: null, unobservedPhase: 'none', diagnostics: [UNOBSERVED_DIAG] }),
    fakeReport({ ok: false, contained: null, unobservedPhase: 'module-eval', diagnostics: [MODULE_THROW, UNOBSERVED_DIAG] }),
  );
  const flakyOutcome = await createRunStage(flaky.runCandidate).run({ source: 's', build: { bundle: '' } });
  check('a re-run that is unobserved in a never-mounted phase is terminal, not repairable', flakyOutcome.contained === null && !flakyOutcome.repairable && flakyOutcome.rerun);
  if (flakyOutcome.contained === null && !flakyOutcome.repairable) eq('the terminal names the re-run\'s phase', flakyOutcome.phase, 'module-eval');
  eq('and the candidate was not run a third time', flaky.calls(), 2);

  // Aborted: the re-run is skipped.
  const controller = new AbortController();
  controller.abort();
  const aborted = sequencedRunCandidate(fakeReport({ ok: false, contained: null, unobservedPhase: 'none', diagnostics: [UNOBSERVED_DIAG] }));
  const abortedOutcome = await createRunStage(aborted.runCandidate).run({ source: 's', build: { bundle: '' } }, controller.signal);
  eq('an aborted signal skips the re-run', aborted.calls(), 1);
  check('an aborted run reports no re-run', abortedOutcome.contained === null && !abortedOutcome.repairable && !abortedOutcome.rerun);
}

async function testRerunVerdictIsHandledAsAFirstRunsWould(): Promise<void> {
  section('RunStage — a re-run verdict of true or false is mapped as a first run\'s would be');

  const unobserved = fakeReport({ ok: false, contained: null, unobservedPhase: 'none', diagnostics: [UNOBSERVED_DIAG] });

  const delivering = sequencedRunCandidate(unobserved, fakeReport({ contained: true, diagnostics: [] }));
  const delivered = await createRunStage(delivering.runCandidate).run({ source: 's', manifest: A_MANIFEST, build: { bundle: 'b' } });
  check('a re-run that earns an affirmative verdict delivers', delivered.contained === true);
  eq('the delivery names the phase that caused the re-run', delivered.contained === true ? delivered.rerunOf : 'not delivered', 'none');
  eq('and took exactly two runs', delivering.calls(), 2);

  const breaching = sequencedRunCandidate(unobserved, fakeReport({ ok: false, contained: false, diagnostics: [{ kind: 'containment_failure', severity: 'error', message: 'm', hint: 'h' }] }));
  const breached = await createRunStage(breaching.runCandidate).run({ source: 's', build: { bundle: '' } });
  eq('a re-run that reports a breach is the terminal containment failure', breached.contained === false ? breached.verdict : breached.contained, { kind: 'breach', check: 'containment_failure' });
  eq('and it says the candidate was re-run', breached.contained === false ? breached.rerun : 'not a breach', true);

  // Only an observed true delivers: the first-run null never does, however the re-run reads.
  const stillNull = sequencedRunCandidate(unobserved);
  const never = await createRunStage(stillNull.runCandidate).run({ source: 's', manifest: A_MANIFEST, build: { bundle: 'b' } });
  check('two unobserved runs never deliver', never.contained === null);
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

// ── Entry point ────────────────────────────────────────────────────────────

export async function runRunStageTests(): Promise<void> {
  await testContainmentFailureShortCircuit();
  await testUnobservedVerdictShortCircuit();
  await testNeverMountedCandidateIsRepairable();
  await testHarnessFaultIsRerunOnce();
  await testRerunVerdictIsHandledAsAFirstRunsWould();
  await testForgeryDetailNeverCrossesTheAdapter();
  await testTruncationIsNotAPass();
}
