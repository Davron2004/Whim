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
import type { RunObservation, TierAResult, TierBResult } from '../contract';
import { computeCaseVerdict } from '../tiers/case';
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
    syscallsInvoked: ['storage.kv.get', 'storage.kv.set', 'storage.kv.set'],
    cuesInvoked: [],
    containment: { authenticated: true, contained: true },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
section(
  'synthetic-run adapter: pins the three-valued containment mapping ' +
    '(handoff/run-report-contract.md, design Open Question 1)',
);
// ─────────────────────────────────────────────────────────────────────────────

{
  const reportPath = join(repoRoot, 'evals', 'test', 'fixtures', 'synthetic-run-report-breach.json');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const observation = observationFromRunReport('contained-false', report);
  eq(
    'RunReport.contained === false maps to an authenticated, NOT-contained verdict',
    observation.containment,
    { authenticated: true, contained: false },
  );
}

{
  const reportPath = join(repoRoot, 'evals', 'test', 'fixtures', 'synthetic-run-report-unobserved.json');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const observation = observationFromRunReport('contained-null', report);
  check(
    'RunReport.contained === null maps to an un-authenticated verdict',
    observation.containment.authenticated === false,
  );
  // Isolate the containment mapping's effect from the fixture's own `containment_unobserved`
  // diagnostic: even with no diagnostics at all, the un-authenticated verdict alone fails Tier A
  // (tier-a.ts's `containmentTrusted = authenticated && contained`) — never adopted as a pass.
  const isolatedObservation: RunObservation = { ...observation, diagnostics: [] };
  const result = evaluateTierA(readCandidate('honest.app.tsx'), isolatedObservation);
  check(
    'an unobserved (null) verdict fails Tier A as an untrusted verdict, never as a pass',
    result.status === 'fail',
  );
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
const FAILING_TIER_B: TierBResult = {
  status: 'evaluated',
  assertions: [{ english: 'the home screen is reachable', kind: 'screen-reachable', status: 'fail', observed: [] }],
};
const PASSING_TIER_B: TierBResult = {
  status: 'evaluated',
  assertions: [{ english: 'the home screen is reachable', kind: 'screen-reachable', status: 'pass', observed: ['Home'] }],
};
// Tier C takes no part: computeCaseVerdict reads only Tier A and Tier B.
for (const [name, tierA, tierB, want] of [
  ['failed Tier A, passing Tier B', FAILED_TIER_A, PASSING_TIER_B, 'fail'],
  ['passed Tier A, failing Tier B', PASSED_TIER_A, FAILING_TIER_B, 'fail'],
  ['passed Tier A, skipped Tier B', PASSED_TIER_A, SKIPPED_TIER_B, 'fail'],
  ['passed Tier A, passing Tier B', PASSED_TIER_A, PASSING_TIER_B, 'pass'],
] as const) {
  eq(`case verdict: ${name} is ${want}`, computeCaseVerdict(tierA, tierB), want);
}
