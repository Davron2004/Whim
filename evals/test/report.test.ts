/**
 * Acceptance suite for chain-E (report-diff-compare): canonical serialization/determinism,
 * `diff` naming per-case/per-tier regressions (and Tier-C deltas marked non-deterministic),
 * `compare`'s overfitting alarm + refusal rules, and — the load-bearing property of this chain —
 * that redaction (design D3) survives every output path: `serializeReport`, `renderSummary`,
 * `diff`, and `compare` can never surface holdout prompt/expectation text, because report
 * construction (`buildReport`/`buildCaseResult`) is the only place a `CaseResult.case` is ever
 * produced and it always goes through `redactCase`. Auto-discovered by `evals/test/run.mjs`
 * (D14). No eval set, no network, no Chromium — hand-built `TierAResult`/`TierBResult`/
 * `TierCResult` literals only.
 */
/* eslint sonarjs/no-empty-test-file: "off" -- house tally idiom (`check`/`eq`), not a
   jest-shaped test file; sonarjs's `*.test.ts` heuristic doesn't recognize it. Every
   `evals/test/*.test.ts` file needs this same line (D14 naming convention, pinned in the
   contract) — see `handoff/eval-contract.md`. */
import type { EvalRunReport, TierAResult, TierBResult, TierCResult } from '../contract';
import { compareExitCode, compareReports, COMPARE_EXIT_ALARM, COMPARE_EXIT_OK, COMPARE_EXIT_REFUSED, renderCompare } from '../report/compare';
import { diffReports, renderDiff } from '../report/diff';
import type { CaseInput } from '../report/serialize';
import { buildReport, serializeDiffableBody, serializeReport } from '../report/serialize';
import { renderSummary } from '../report/summary';
import { check, eq, section } from './harness';

const PASS_A: TierAResult = { status: 'pass', diagnostics: [], containment: { authenticated: true, contained: true } };
const FAIL_A: TierAResult = {
  status: 'fail',
  diagnostics: [{ kind: 'runtime_throw', severity: 'error', line: 0, message: 'threw', hint: 'fix it' }],
  containment: { authenticated: true, contained: true },
};

function tierB(status: 'pass' | 'fail'): TierBResult {
  return {
    status: 'evaluated',
    assertions: [{ english: 'the Home screen is reachable', kind: 'screen-reachable', status, observed: [] }],
  };
}

const NO_TIER_C: TierCResult = { status: 'skipped', reason: 'no_judge_configured' };

function scoredTierC(polish: number, judgeIdentity = 'scripted:test'): TierCResult {
  return {
    status: 'scored',
    verdict: {
      rubricVersion: 'v1',
      judgeIdentity,
      criteria: [{ criterion: 'polish', score: polish, rationale: 'because' }],
    },
  };
}

function caseInput(overrides: Partial<CaseInput> & Pick<CaseInput, 'caseId' | 'prompt'>): CaseInput {
  return {
    appSlug: 'tip-splitter',
    expectation: undefined,
    candidateSource: undefined,
    tierA: PASS_A,
    tierB: tierB('pass'),
    tierC: NO_TIER_C,
    ...overrides,
  };
}

function report(cases: readonly CaseInput[], opts: { visibility?: 'visible' | 'holdout'; startedAt?: string; finishedAt?: string } = {}): EvalRunReport {
  return buildReport({
    evalSet: { setId: 'test-set', visibility: opts.visibility ?? 'visible', location: 'evals/sets/test-set' },
    runnerVersion: 'runner-1',
    candidateLabel: 'candidate-a',
    cases,
    startedAt: opts.startedAt ?? '2026-01-01T00:00:00.000Z',
    finishedAt: opts.finishedAt ?? '2026-01-01T00:00:01.000Z',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
section('serialize: canonical ordering + determinism (spec "Identical inputs produce an identical body")');
// ─────────────────────────────────────────────────────────────────────────────

{
  const cases = [
    caseInput({ caseId: 'zzz-case', prompt: 'z' }),
    caseInput({ caseId: 'aaa-case', prompt: 'a' }),
  ];
  const built = report(cases);
  eq('cases are sorted by caseId regardless of input order', built.cases.map((c) => c.case.caseId), ['aaa-case', 'zzz-case']);
}

{
  const cases = [caseInput({ caseId: 'c1', prompt: 'p1' }), caseInput({ caseId: 'c2', prompt: 'p2' })];
  const first = report(cases, { startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z' });
  const second = report(cases, { startedAt: '2026-01-02T09:30:00.000Z', finishedAt: '2026-01-02T09:30:05.000Z' });

  check(
    'diffable bodies are byte-identical across two runs with different timings',
    serializeDiffableBody(first) === serializeDiffableBody(second),
  );
  check(
    'full serialized reports differ because timings differ',
    serializeReport(first) !== serializeReport(second),
  );
  check('neither report body mentions the timings-only startedAt string', !serializeDiffableBody(first).includes('2026-01-01T00:00:00'));
}

{
  const cases = [caseInput({ caseId: 'c1', prompt: 'p1', tierC: scoredTierC(3) })];
  const built = report(cases);
  eq('rubricVersion is derived from a scored Tier-C result, not caller-supplied', built.rubricVersion, 'v1');
  const noTierC = report([caseInput({ caseId: 'c1', prompt: 'p1' })]);
  check('rubricVersion is absent when no case ran Tier C', noTierC.rubricVersion === undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
section('diff: names per-case, per-tier regressions (spec "Diff names regressions")');
// ─────────────────────────────────────────────────────────────────────────────

{
  const base = report([caseInput({ caseId: 'c1', prompt: 'p1', tierB: tierB('pass') })]);
  const candidate = report([caseInput({ caseId: 'c1', prompt: 'p1', tierB: tierB('fail') })]);
  const diff = diffReports(base, candidate);
  eq('a Tier B pass -> fail transition is named by case, tier, and assertion', diff.tierBRegressions, [
    { caseId: 'c1', tier: 'B', english: 'the Home screen is reachable', kind: 'screen-reachable', from: 'pass', to: 'fail' },
  ]);
  check('tierARegressions is empty when only Tier B regressed', diff.tierARegressions.length === 0);
}

{
  const base = report([caseInput({ caseId: 'c1', prompt: 'p1', tierA: PASS_A })]);
  const candidate = report([caseInput({ caseId: 'c1', prompt: 'p1', tierA: FAIL_A })]);
  const diff = diffReports(base, candidate);
  eq('a Tier A pass -> fail transition is named by case', diff.tierARegressions, [
    { caseId: 'c1', tier: 'A', from: 'pass', to: 'fail' },
  ]);
}

{
  const base = report([caseInput({ caseId: 'c1', prompt: 'p1' }), caseInput({ caseId: 'c2', prompt: 'p2' })]);
  const candidate = report([caseInput({ caseId: 'c2', prompt: 'p2' }), caseInput({ caseId: 'c3', prompt: 'p3' })]);
  const diff = diffReports(base, candidate);
  eq('cases only on one side are named added/removed', { added: diff.casesAdded, removed: diff.casesRemoved }, {
    added: ['c3'],
    removed: ['c1'],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
section('diff: Tier-C deltas are non-deterministic, not regressions (design D9)');
// ─────────────────────────────────────────────────────────────────────────────

{
  const base = report([caseInput({ caseId: 'c1', prompt: 'p1', tierC: scoredTierC(5) })]);
  const candidate = report([caseInput({ caseId: 'c1', prompt: 'p1', tierC: scoredTierC(2) })]);
  const diff = diffReports(base, candidate);
  eq('a Tier-C score drop is recorded as a delta, marked non-deterministic', diff.tierCScoreDeltas, [
    { caseId: 'c1', criterion: 'polish', from: 5, to: 2, deterministic: false },
  ]);
  check('a Tier-C score change is never counted as a Tier A or Tier B regression', diff.tierARegressions.length === 0 && diff.tierBRegressions.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
section('compare: overfitting alarm (spec "Visible-versus-holdout divergence raises an overfitting alarm")');
// ─────────────────────────────────────────────────────────────────────────────

function reportWithVerdicts(setId: string, visibility: 'visible' | 'holdout', passes: number, fails: number): EvalRunReport {
  const cases: CaseInput[] = [];
  for (let i = 0; i < passes; i++) cases.push(caseInput({ caseId: `pass-${i}`, prompt: `p${i}`, tierB: tierB('pass') }));
  for (let i = 0; i < fails; i++) cases.push(caseInput({ caseId: `fail-${i}`, prompt: `f${i}`, tierB: tierB('fail') }));
  return buildReport({
    evalSet: { setId, visibility, location: `evals/sets/${setId}` },
    runnerVersion: 'runner-1',
    candidateLabel: 'candidate-a',
    cases,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
  });
}

{
  const visible = reportWithVerdicts('visible-set', 'visible', 10, 0); // 100% pass
  const holdout = reportWithVerdicts('holdout-set', 'holdout', 5, 5); // 50% pass
  const outcome = compareReports(visible, holdout, 0.1);
  check('divergence beyond threshold raises overfitting_alarm', outcome.status === 'ok' && outcome.overfittingAlarm);
  check('the non-zero exit code is the alarm code', compareExitCode(outcome) === COMPARE_EXIT_ALARM);
  check(
    'the alarm output names both rates',
    outcome.status === 'ok' && outcome.tiers.some((t) => t.tier === 'A+B' && Math.abs(t.divergence - 0.5) < 1e-9),
  );
}

{
  const visible = reportWithVerdicts('visible-set', 'visible', 10, 0);
  const holdout = reportWithVerdicts('holdout-set', 'holdout', 9, 1); // 90% pass, 10pp under threshold-inclusive
  const outcome = compareReports(visible, holdout, 0.1);
  check('divergence within threshold stays quiet', outcome.status === 'ok' && !outcome.overfittingAlarm);
  check('the exit code is clean', compareExitCode(outcome) === COMPARE_EXIT_OK);
}

// ─────────────────────────────────────────────────────────────────────────────
section('compare: refuses mismatched report versions (spec "Mismatched report versions are refused")');
// ─────────────────────────────────────────────────────────────────────────────

{
  const visible = reportWithVerdicts('visible-set', 'visible', 5, 0);
  const holdout = reportWithVerdicts('holdout-set', 'holdout', 5, 0);
  const bumpedSchema: EvalRunReport = { ...holdout, schemaVersion: holdout.schemaVersion + 1 };
  const outcome = compareReports(visible, bumpedSchema, 0.1);
  check('a schema version mismatch is refused', outcome.status === 'refused');
  check('the refusal names the mismatch', outcome.status === 'refused' && outcome.reason.includes('schema version'));
  check('the exit code is the refused code', compareExitCode(outcome) === COMPARE_EXIT_REFUSED);
}

{
  const visibleCase = caseInput({ caseId: 'c1', prompt: 'p1', tierC: scoredTierC(4) });
  const visible = report([visibleCase]);
  const holdoutCase = caseInput({ caseId: 'c1', prompt: 'p1', tierC: { status: 'scored', verdict: { rubricVersion: 'v2', judgeIdentity: 'x', criteria: [{ criterion: 'polish', score: 4, rationale: 'ok' }] } } });
  const holdout = report([holdoutCase], { visibility: 'holdout' });
  const outcome = compareReports(visible, holdout, 0.1);
  check('a rubric version mismatch while Tier C is compared is refused', outcome.status === 'refused');
  check('the refusal names the rubric mismatch', outcome.status === 'refused' && outcome.reason.includes('rubric version'));
}

// ─────────────────────────────────────────────────────────────────────────────
section('redaction: structurally impossible to leak holdout content (design D3)');
// ─────────────────────────────────────────────────────────────────────────────

const SECRET_PROMPT = 'THE-SECRET-PROMPT-TEXT-xyz789';
const SECRET_EXPECTATION = 'THE-SECRET-EXPECTATION-TEXT-abc123';
const SECRET_CANDIDATE_SOURCE = 'const THE_SECRET_SOURCE_TOKEN = 42;';

{
  const holdoutCase = caseInput({
    caseId: 'holdout-c1',
    prompt: SECRET_PROMPT,
    expectation: SECRET_EXPECTATION,
    candidateSource: SECRET_CANDIDATE_SOURCE,
    tierB: tierB('fail'),
    tierC: scoredTierC(3),
  });
  const holdoutBase = report([holdoutCase], { visibility: 'holdout' });
  const holdoutCandidate = report(
    [caseInput({ caseId: 'holdout-c1', prompt: SECRET_PROMPT, expectation: SECRET_EXPECTATION, candidateSource: SECRET_CANDIDATE_SOURCE, tierB: tierB('pass'), tierC: scoredTierC(5) })],
    { visibility: 'holdout' },
  );

  const builtCase = holdoutBase.cases[0].case;
  eq(
    'a holdout CaseResult.case carries ONLY caseId + promptSha256',
    Object.keys(builtCase).sort((a, b) => a.localeCompare(b)),
    ['caseId', 'promptSha256'],
  );

  const surfaces = [
    serializeReport(holdoutBase),
    serializeReport(holdoutCandidate),
    renderSummary(holdoutBase),
    renderSummary(holdoutCandidate),
    JSON.stringify(diffReports(holdoutBase, holdoutCandidate)),
    renderDiff(diffReports(holdoutBase, holdoutCandidate)),
  ];
  const secrets = [SECRET_PROMPT, SECRET_EXPECTATION, SECRET_CANDIDATE_SOURCE];
  for (const surface of surfaces) {
    for (const secret of secrets) {
      check(`no output surface contains "${secret}"`, !surface.includes(secret), surface.slice(0, 200));
    }
  }

  const visibleForCompare = report(
    [caseInput({ caseId: 'holdout-c1', prompt: 'unrelated visible prompt', tierC: scoredTierC(4) })],
  );
  const compareOutcome = compareReports(visibleForCompare, holdoutBase, 0.5);
  const compareSurface = `${JSON.stringify(compareOutcome)}${renderCompare(compareOutcome)}`;
  for (const secret of secrets) {
    check(`compare output does not contain "${secret}"`, !compareSurface.includes(secret));
  }
}

{
  // Prove the redaction test above is non-vacuous: deliberately construct an UNREDACTED case the
  // way `buildCaseResult` is forbidden from doing, and confirm the same assertion style WOULD
  // catch it — i.e. the check genuinely inspects content, it isn't trivially true.
  const unredactedLeak = JSON.stringify({ case: { caseId: 'x', prompt: SECRET_PROMPT } });
  check(
    'the leak-detection check itself fires on a deliberately unredacted object (negative control)',
    unredactedLeak.includes(SECRET_PROMPT),
  );
}
