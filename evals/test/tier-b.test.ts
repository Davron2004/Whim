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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateAssertion } from '../assertions';
import { ASSERTION_KINDS } from '../contract';
import type { EvalAssertion, RunObservation } from '../contract';
import { EvalSetError, loadEvalSet } from '../eval-set';
import { evaluateTierB } from '../tiers/tier-b';
import { caught, check, eq, section } from './harness';

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** Declares `Detail` but only ever reaches `Home`; carries one error diagnostic and both storage
 *  legs plus one cue — enough surface for every kind's red case below. */
const BASE_OBSERVATION: RunObservation = {
  caseId: 'tier-b-fixture',
  diagnostics: [
    { kind: 'forbidden_global', severity: 'error', line: 4, message: 'uses Function', hint: 'remove the forbidden global' },
  ],
  declaredScreens: ['Home', 'Detail'],
  reachedScreens: ['Home'],
  syscallsInvoked: ['storage.get', 'storage.set'],
  cuesInvoked: ['cues.haptic'],
  containment: { authenticated: true, contained: true },
};

/** Same shape, no diagnostics — the clean run used for `renders-without-error`'s green case. */
const CLEAN_OBSERVATION: RunObservation = { ...BASE_OBSERVATION, diagnostics: [] };

/** Wrote but never read back — `storage-roundtrip`'s red case. */
const WRITE_ONLY_OBSERVATION: RunObservation = { ...BASE_OBSERVATION, syscallsInvoked: ['storage.set'] };

function assertion(kind: EvalAssertion['kind'], target?: string, expected?: boolean): EvalAssertion {
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

check('this suite covers every closed assertion kind', ASSERTION_KINDS.length === 6, `ASSERTION_KINDS: ${ASSERTION_KINDS.join(', ')}`);

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
  const result = evaluateAssertion(assertion('syscall-invoked', 'storage.get'), BASE_OBSERVATION);
  eq('syscall-invoked: a recorded syscall passes', result.status, 'pass');
}
{
  const result = evaluateAssertion(assertion('syscall-invoked', 'storage.delete'), BASE_OBSERVATION);
  eq('syscall-invoked: an un-recorded syscall fails', result.status, 'fail');
  eq(
    'the failure lists the invocations actually recorded (spec "Syscall assertion reads the recorded trace")',
    (result.observed as { invoked: readonly string[] }).invoked,
    ['storage.get', 'storage.set'],
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

{
  const result = evaluateAssertion(assertion('storage-roundtrip'), BASE_OBSERVATION);
  eq('storage-roundtrip: a write and a read both recorded passes', result.status, 'pass');
}
{
  const result = evaluateAssertion(assertion('storage-roundtrip'), WRITE_ONLY_OBSERVATION);
  eq('storage-roundtrip: a write with no matching read fails', result.status, 'fail');
  eq(
    'the failure names which leg is missing',
    { wrote: (result.observed as { wrote: boolean }).wrote, read: (result.observed as { read: boolean }).read },
    { wrote: true, read: false },
  );
}

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

// ─────────────────────────────────────────────────────────────────────────────
section('load-time guarantees over Tier-B specs (spec "Tier-B specs are English-first and encoded as inert data")');
// ─────────────────────────────────────────────────────────────────────────────

const scratchDir = mkdtempSync(join(tmpdir(), 'whim-tier-b-test-'));

function writeSet(name: string, manifest: unknown): string {
  const dir = join(scratchDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  return dir;
}

{
  const dir = writeSet('missing-english', {
    setId: 'x',
    visibility: 'visible',
    cases: [
      { caseId: 'needs-english', appSlug: 'tip-splitter', prompt: 'p', assertions: [{ kind: 'renders-without-error' }] },
    ],
  });
  const err = await caught(() => { loadEvalSet(dir); });
  check('a Tier-B spec missing its English statement fails the whole set to load', err instanceof EvalSetError);
  check(
    'the load error names the offending case id (spec "Missing English statement is a load error")',
    err instanceof Error && err.message.includes('needs-english'),
    String(err),
  );
}

{
  const dir = writeSet('unknown-kind', {
    setId: 'x',
    visibility: 'visible',
    cases: [
      {
        caseId: 'c1',
        appSlug: 'tip-splitter',
        prompt: 'p',
        assertions: [{ english: 'the app teleports', kind: 'app-teleports' }],
      },
    ],
  });
  const err = await caught(() => { loadEvalSet(dir); });
  check('an unknown assertion kind fails the whole set to load', err instanceof EvalSetError);
  const message = err instanceof Error ? err.message : '';
  check('the load error names the offending kind', message.includes('app-teleports'), message);
  check(
    'the load error names the closed set of accepted kinds (spec "Unknown assertion kind is a load error")',
    ASSERTION_KINDS.every((kind) => message.includes(kind)),
    message,
  );
}

{
  // A sentinel that would only flip if this bare code string were ever evaluated, imported, or
  // otherwise executed — proving the refusal happens at load, before any execution path exists.
  (globalThis as Record<string, unknown>).__whimTierBSideEffectSentinel = false;
  const maliciousAssertion = "globalThis.__whimTierBSideEffectSentinel = true; require('node:fs').rmSync('/');";
  const dir = writeSet('code-as-assertion', {
    setId: 'x',
    visibility: 'visible',
    cases: [{ caseId: 'c1', appSlug: 'tip-splitter', prompt: 'p', assertions: [maliciousAssertion] }],
  });
  const err = await caught(() => { loadEvalSet(dir); });
  check(
    'an assertion expressed as a bare code string is refused, not run (spec "Eval-set-supplied code is refused, never run")',
    err instanceof EvalSetError,
  );
  check(
    'the refusal never executed the code string — the sentinel was never flipped',
    (globalThis as Record<string, unknown>).__whimTierBSideEffectSentinel === false,
  );
  delete (globalThis as Record<string, unknown>).__whimTierBSideEffectSentinel;
}

{
  const dir = writeSet('module-reference-assertion', {
    setId: 'x',
    visibility: 'visible',
    cases: [
      {
        caseId: 'c1',
        appSlug: 'tip-splitter',
        prompt: 'p',
        assertions: [{ english: 'ok', kind: 'renders-without-error', require: './evil.js' }],
      },
    ],
  });
  const err = await caught(() => { loadEvalSet(dir); });
  check('an assertion carrying a module-reference-shaped field is refused, not imported', err instanceof EvalSetError);
}

rmSync(scratchDir, { recursive: true, force: true });
