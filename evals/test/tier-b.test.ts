/**
 * Acceptance suite for chain-C (tier-b-assertions): the closed `ASSERTION_KINDS` evaluator
 * (`evals/assertions.ts`), Tier B's skip/evaluate framing (`evals/tiers/tier-b.ts`), and the
 * load-time guarantees a Tier-B spec must satisfy (English-first, closed vocabulary, inert-data
 * only — enforced by `evals/eval-set.ts`, chain-A, exercised here from Tier-B's own fixtures).
 * Auto-discovered by `evals/test/run.mjs` (D14). No Chromium is launched and no eval set env/flag
 * is required — every fixture here is a hand-built `RunObservation` or a synthetic manifest
 * written to a temp directory, never a real holdout.
 */
/* eslint sonarjs/no-empty-test-file: "off" -- house tally idiom (`check`/`eq`), not a
   jest-shaped test file; sonarjs's `*.test.ts` heuristic doesn't recognize it. Every
   `evals/test/*.test.ts` file needs this same line (D14 naming convention, pinned in the
   contract) — see `handoff/eval-contract.md`. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { observationFromRunReport } from '../adapters/synthetic-run';
import { evaluateAssertion } from '../assertions';
import { ASSERTION_KINDS } from '../contract';
import type { EvalAssertion, RunObservation } from '../contract';
import { evaluateTierB } from '../tiers/tier-b';
import { check, eq, section } from './harness';

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** A real synthrun run of `fixtures/water-counter.app.tsx`, so the syscall names are the ones the
 *  SDK actually sends. */
const RECORDED_OBSERVATION = observationFromRunReport(
  'recorded-water-counter',
  JSON.parse(readFileSync(join(process.cwd(), 'evals', 'test', 'fixtures', 'synthetic-run-report.json'), 'utf8')),
);

/** Declares `Detail` but only ever reaches `Home`; carries one error diagnostic, the recorded run's
 *  storage syscalls and one cue — enough surface for every kind's red case below. */
const BASE_OBSERVATION: RunObservation = {
  caseId: 'tier-b-fixture',
  diagnostics: [
    { kind: 'forbidden_global', severity: 'error', line: 4, message: 'uses Function', hint: 'remove the forbidden global' },
  ],
  declaredScreens: ['Home', 'Detail'],
  reachedScreens: ['Home'],
  syscallsInvoked: RECORDED_OBSERVATION.syscallsInvoked,
  cuesInvoked: ['cues.haptic'],
  containment: { authenticated: true, contained: true },
};

/** Same shape, no diagnostics — the clean run used for `renders-without-error`'s green case. */
const CLEAN_OBSERVATION: RunObservation = { ...BASE_OBSERVATION, diagnostics: [] };


/** Every kind exercised below by a green-or-red `evaluateAssertion` case (not the skip/framing
 *  or English-statement sections, which reuse `screen-reachable`). Checked at the bottom of this
 *  section against `ASSERTION_KINDS`, so a kind added to the closed vocabulary with no case here
 *  fails the suite — the count-only version of this check couldn't tell a missing kind from an
 *  unrelated drift in the total. */
const EXERCISED_KINDS = new Set<EvalAssertion['kind']>();

function assertion(kind: EvalAssertion['kind'], target?: string, expected?: boolean): EvalAssertion {
  EXERCISED_KINDS.add(kind);
  return {
    english: `fixture assertion for kind "${kind}"`,
    kind,
    ...(target !== undefined ? { target } : {}),
    ...(expected !== undefined ? { expected } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
section('non-vacuity: every ASSERTION_KINDS entry has a green and a red case');
// ─────────────────────────────────────────────────────────────────────────────

{
  const result = evaluateAssertion(assertion('screen-reachable', 'Home'), BASE_OBSERVATION);
  eq('screen-reachable: a reached declared screen passes', result.status, 'pass');
  check('screen-reachable green: observed is not a bare boolean', typeof result.observed === 'object', JSON.stringify(result.observed));
}
{
  const result = evaluateAssertion(assertion('screen-reachable', 'Detail'), BASE_OBSERVATION);
  eq('screen-reachable: a declared-but-unreached screen fails', result.status, 'fail');
  eq('the failure names the target screen', (result.observed as { target: string }).target, 'Detail');
  eq(
    'the failure lists the screens actually reached (spec "Unreachable declared screen fails its assertion")',
    (result.observed as { reachedScreens: readonly string[] }).reachedScreens,
    ['Home'],
  );
}

{
  const result = evaluateAssertion(assertion('syscall-invoked', 'storage.kv.get'), BASE_OBSERVATION);
  eq('syscall-invoked: a recorded syscall passes', result.status, 'pass');
}
{
  const result = evaluateAssertion(assertion('syscall-invoked', 'storage.kv.remove'), BASE_OBSERVATION);
  eq('syscall-invoked: an un-recorded syscall fails', result.status, 'fail');
  eq(
    'the failure lists the invocations actually recorded (spec "Syscall assertion reads the recorded trace")',
    (result.observed as { invoked: readonly string[] }).invoked,
    RECORDED_OBSERVATION.syscallsInvoked,
  );
}

{
  const result = evaluateAssertion(assertion('cue-invoked', 'cues.haptic'), BASE_OBSERVATION);
  eq('cue-invoked: a recorded cue passes', result.status, 'pass');
}
{
  const result = evaluateAssertion(assertion('cue-invoked', 'cues.sound'), BASE_OBSERVATION);
  eq('cue-invoked: an un-recorded cue fails', result.status, 'fail');
  eq('the failure lists the cue invocations actually recorded', (result.observed as { invoked: readonly string[] }).invoked, ['cues.haptic']);
}

{
  const result = evaluateAssertion(assertion('diagnostic-present', 'forbidden_global'), BASE_OBSERVATION);
  eq('diagnostic-present: a recorded diagnostic kind passes', result.status, 'pass');
}
{
  const result = evaluateAssertion(assertion('diagnostic-present', 'parse_error'), BASE_OBSERVATION);
  eq('diagnostic-present: an absent diagnostic kind fails', result.status, 'fail');
  eq(
    'the failure lists the diagnostic kinds actually recorded',
    (result.observed as { diagnosticKinds: readonly string[] }).diagnosticKinds,
    ['forbidden_global'],
  );
}

{
  const result = evaluateAssertion(assertion('renders-without-error'), CLEAN_OBSERVATION);
  eq('renders-without-error: no error diagnostic passes', result.status, 'pass');
}
{
  const result = evaluateAssertion(assertion('renders-without-error'), BASE_OBSERVATION);
  eq('renders-without-error: an error diagnostic fails', result.status, 'fail');
  check(
    'the failure carries the offending error diagnostics, not a bare boolean',
    Array.isArray((result.observed as { errorDiagnostics: unknown[] }).errorDiagnostics) &&
      (result.observed as { errorDiagnostics: unknown[] }).errorDiagnostics.length === 1,
    JSON.stringify(result.observed),
  );
}

for (const [name, syscallsInvoked, want] of [
  ['the recorded water-counter run (kv get + set)', RECORDED_OBSERVATION.syscallsInvoked, 'pass'],
  ['a records append then list', ['storage.records.append', 'storage.records.list'], 'pass'],
  ['a kv write with no read', ['storage.kv.set'], 'fail'],
  ['a kv read with no write', ['storage.kv.get'], 'fail'],
  ['a kv write and a records read (no single store round-tripped)', ['storage.kv.set', 'storage.records.list'], 'fail'],
] as const) {
  const result = evaluateAssertion(assertion('storage-roundtrip'), { ...BASE_OBSERVATION, syscallsInvoked });
  eq(`storage-roundtrip: ${name} ${want === 'pass' ? 'passes' : 'fails'}`, result.status, want);
}
{
  const result = evaluateAssertion(assertion('storage-roundtrip'), { ...BASE_OBSERVATION, syscallsInvoked: ['storage.kv.set'] });
  eq(
    'the failure names which leg is missing',
    { wrote: (result.observed as { wrote: boolean }).wrote, read: (result.observed as { read: boolean }).read },
    { wrote: true, read: false },
  );
}

for (const kind of ASSERTION_KINDS) {
  check(`this suite exercises the closed kind "${kind}" with a green and a red case`, EXERCISED_KINDS.has(kind));
}
eq('this suite exercises no kind outside ASSERTION_KINDS', [...EXERCISED_KINDS].filter((k) => !(ASSERTION_KINDS as readonly string[]).includes(k)), []);

// ─────────────────────────────────────────────────────────────────────────────
section('the English statement reaches the report (spec "The English statement reaches the report")');
// ─────────────────────────────────────────────────────────────────────────────

{
  const english = 'the Detail screen should be reachable from Home';
  const result = evaluateAssertion({ english, kind: 'screen-reachable', target: 'Detail' }, BASE_OBSERVATION);
  eq('a failing assertion carries its English statement verbatim', result.english, english);
  eq('a failing assertion status is fail', result.status, 'fail');
  check('a failing assertion never reports a bare boolean observed value', typeof result.observed !== 'boolean');
}

// ─────────────────────────────────────────────────────────────────────────────
section('evaluateTierB: skip/evaluate framing (spec "Tier A failure short-circuits")');
// ─────────────────────────────────────────────────────────────────────────────

eq(
  'Tier A failure short-circuits Tier B to skipped without evaluating any assertion',
  evaluateTierB({ assertions: [assertion('screen-reachable', 'Detail')], observation: BASE_OBSERVATION, tierAFailed: true }),
  { status: 'skipped', reason: 'tier_a_failed' },
);

{
  const result = evaluateTierB({
    assertions: [assertion('screen-reachable', 'Home'), assertion('screen-reachable', 'Detail')],
    observation: BASE_OBSERVATION,
    tierAFailed: false,
  });
  check('Tier A passing evaluates every declared assertion', result.status === 'evaluated');
  check(
    'a mixed pass/fail assertion list records both outcomes',
    result.status === 'evaluated' && result.assertions.length === 2 && result.assertions[0].status === 'pass' && result.assertions[1].status === 'fail',
    JSON.stringify(result),
  );
}

eq(
  'Tier A passing with no declared assertions evaluates to an empty (vacuous) assertion list',
  evaluateTierB({ assertions: [], observation: BASE_OBSERVATION, tierAFailed: false }),
  { status: 'evaluated', assertions: [] },
);
