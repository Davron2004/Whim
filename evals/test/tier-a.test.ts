/**
 * Acceptance suite for chain-B (tier-a-and-run-adapter): Tier A's combined static + runtime
 * gate, the untrusted-verdict path, determinism, the case-level gating rule (`evals/tiers/
 * case.ts`), and the synthetic-run adapter's normalization. Auto-discovered by `evals/test/
 * run.mjs` (D14). No Chromium is launched anywhere in this file — the runtime leg is exercised
 * against hand-built and fixture-recorded `RunObservation`/report values only.
 */
/* eslint sonarjs/no-empty-test-file: "off" -- house tally idiom (`check`/`eq`), not a
   jest-shaped test file; sonarjs's `*.test.ts` heuristic doesn't recognize it. Every
   `evals/test/*.test.ts` file needs this same line (D14 naming convention, pinned in the
   contract) — see `handoff/eval-contract.md`. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { observationFromRunReport } from '../adapters/synthetic-run';
import type { RunObservation, TierAResult, TierBResult, TierCResult } from '../contract';
import { computeCaseVerdict, tierAFailed } from '../tiers/case';
import { evaluateTierA } from '../tiers/tier-a';
import { check, eq, section } from './harness';

const repoRoot = process.cwd();
const candidatesDir = join(repoRoot, 'evals', 'test', 'fixtures', 'candidates');

function readCandidate(name: string): string {
  return readFileSync(join(candidatesDir, name), 'utf8');
}

const CLEAN_OBSERVATION: RunObservation = {
  caseId: 'c1',
  diagnostics: [],
  declaredScreens: ['Home'],
  reachedScreens: ['Home'],
  syscallsInvoked: [],
  cuesInvoked: [],
  containment: { authenticated: true, contained: true },
};

// ─────────────────────────────────────────────────────────────────────────────
section('Tier A: honest fixture passes both legs (spec "Same input, same result")');
// ─────────────────────────────────────────────────────────────────────────────

{
  const source = readCandidate('honest.app.tsx');
  const result = evaluateTierA(source, CLEAN_OBSERVATION);
  eq('an honest candidate over a clean, authenticated observation passes Tier A', result, {
    status: 'pass',
    diagnostics: [],
    containment: { authenticated: true, contained: true },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
section('Tier A: error diagnostic fails the static leg (spec "Error diagnostic fails Tier A")');
// ─────────────────────────────────────────────────────────────────────────────

{
  const source = readCandidate('error-diagnostic.app.tsx');
  const result = evaluateTierA(source, CLEAN_OBSERVATION);
  check('a static-leg error diagnostic fails Tier A', result.status === 'fail');
  const offending = result.diagnostics.find((d) => d.kind === 'forbidden_global');
  check('the failing report carries the diagnostic\'s kind', offending !== undefined);
  check(
    'the failing report carries the diagnostic\'s message and fix hint',
    offending !== undefined && offending.message.length > 0 && offending.hint.length > 0,
    JSON.stringify(offending),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
section('Tier A: self-reported verdict is not trusted (spec "Self-reported verdict is not trusted")');
// ─────────────────────────────────────────────────────────────────────────────

{
  const source = readCandidate('honest.app.tsx');
  const untrustedObservation: RunObservation = {
    ...CLEAN_OBSERVATION,
    containment: { authenticated: false, contained: true },
  };
  const result = evaluateTierA(source, untrustedObservation);
  check('an un-authenticated containment verdict never reads as a Tier A pass', result.status === 'fail');
  eq(
    'the untrusted verdict is echoed verbatim, not silently adopted or dropped',
    result.containment,
    { authenticated: false, contained: true },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
section('Tier A: determinism (spec "Same input, same result")');
// ─────────────────────────────────────────────────────────────────────────────

{
  const source = readCandidate('honest.app.tsx');
  const first = evaluateTierA(source, CLEAN_OBSERVATION);
  const second = evaluateTierA(source, CLEAN_OBSERVATION);
  eq('evaluating Tier A twice over the same source and observation yields an equal result', first, second);
}

// ─────────────────────────────────────────────────────────────────────────────
section('synthetic-run adapter: normalizes a recorded report fixture (design D6)');
// ─────────────────────────────────────────────────────────────────────────────

{
  const reportPath = join(repoRoot, 'evals', 'test', 'fixtures', 'synthetic-run-report.json');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const observation = observationFromRunReport('adapter-fixture', report);
  eq('the recorded RunReport fixture normalizes into the pinned RunObservation shape', observation, {
    caseId: 'adapter-fixture',
    diagnostics: [],
    declaredScreens: ['Home'],
    reachedScreens: ['Home'],
    syscallsInvoked: ['storage.get', 'storage.set'],
    cuesInvoked: ['cues.haptic'],
    containment: { authenticated: true, contained: true },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
section('case verdict: three-tier gating semantics (spec "Three tiers with declared gating semantics")');
// ─────────────────────────────────────────────────────────────────────────────

const FAILED_TIER_A: TierAResult = {
  status: 'fail',
  diagnostics: [
    { kind: 'runtime_throw', severity: 'error', line: 0, message: 'candidate threw', hint: 'fix the throw' },
  ],
  containment: { authenticated: true, contained: true },
};
const PASSED_TIER_A: TierAResult = { status: 'pass', diagnostics: [], containment: { authenticated: true, contained: true } };
const SKIPPED_TIER_B: TierBResult = { status: 'skipped', reason: 'tier_a_failed' };
const SKIPPED_TIER_C: TierCResult = { status: 'skipped', reason: 'tier_a_failed' };
const FAILING_TIER_B: TierBResult = {
  status: 'evaluated',
  assertions: [{ english: 'the home screen is reachable', kind: 'screen-reachable', status: 'fail', observed: [] }],
};
const PASSING_TIER_B: TierBResult = {
  status: 'evaluated',
  assertions: [{ english: 'the home screen is reachable', kind: 'screen-reachable', status: 'pass', observed: ['Home'] }],
};
const LOW_SCORED_TIER_C: TierCResult = {
  status: 'scored',
  verdict: {
    rubricVersion: 'v1',
    judgeIdentity: 'scripted:test',
    criteria: [{ criterion: 'polish', score: 0, rationale: 'bottom of the rubric range' }],
  },
};

check('tierAFailed(FAILED_TIER_A) is true', tierAFailed(FAILED_TIER_A));
check('tierAFailed(PASSED_TIER_A) is false', !tierAFailed(PASSED_TIER_A));
eq(
  'Tier A failure short-circuits: case verdict is fail, Tier B and Tier C are recorded skipped',
  { verdict: computeCaseVerdict(FAILED_TIER_A, SKIPPED_TIER_B), tierB: SKIPPED_TIER_B, tierC: SKIPPED_TIER_C },
  { verdict: 'fail', tierB: { status: 'skipped', reason: 'tier_a_failed' }, tierC: { status: 'skipped', reason: 'tier_a_failed' } },
);

{
  const verdict = computeCaseVerdict(PASSED_TIER_A, FAILING_TIER_B);
  eq('Tier B failure does not suppress Tier C: verdict is fail, Tier C result still stands', {
    verdict,
    tierC: LOW_SCORED_TIER_C,
  }, { verdict: 'fail', tierC: LOW_SCORED_TIER_C });
}

{
  const verdict = computeCaseVerdict(PASSED_TIER_A, PASSING_TIER_B);
  eq(
    'Tier C never gates: verdict is pass even though Tier C scored the lowest possible on every criterion',
    { verdict, tierC: LOW_SCORED_TIER_C },
    { verdict: 'pass', tierC: LOW_SCORED_TIER_C },
  );
}
