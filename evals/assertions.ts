/**
 * evals/assertions.ts — the closed `ASSERTION_KINDS` evaluator over `RunObservation` (design D5,
 * spec "Tier-B assertions evaluate against the normalized run observation"). Every assertion here
 * is `{ english, kind, target?, expected? }`, already validated by `evals/eval-set.ts`'s loader
 * against the closed vocabulary and against the code-as-assertion refusal — this module never
 * evaluates, compiles, imports, or otherwise executes anything an eval set supplies. Every branch
 * below is a plain data comparison over an already-normalized `RunObservation`.
 *
 * Every result records the concrete observed value that made the assertion pass or fail — never a
 * bare boolean (spec "never a bare boolean") — and carries the English statement verbatim, so a
 * red assertion reads as a sentence in a failure report (spec "The English statement reaches the
 * report").
 *
 * `EvalAssertion`/`TierBAssertionResult` (`evals/contract.ts`, chain-A) carry no `required`/
 * `advisory` field — the closed vocabulary has no advisory kind yet, so every assertion this
 * module evaluates is required and gates the case verdict; `evals/tiers/case.ts`'s
 * `computeCaseVerdict` already implements that as `.every(...)` over `tierB.assertions`.
 */
import type { EvalAssertion, RunObservation, TierBAssertionResult } from './contract';

/** Evaluates one `EvalAssertion` against one `RunObservation`. Pure function of its two inputs —
 *  same assertion + same observation always yields an equal result. */
export function evaluateAssertion(assertion: EvalAssertion, observation: RunObservation): TierBAssertionResult {
  switch (assertion.kind) {
    case 'screen-reachable':
      return evaluateScreenReachable(assertion, observation);
    case 'syscall-invoked':
      return evaluateInvocation(assertion, observation.syscallsInvoked);
    case 'cue-invoked':
      return evaluateInvocation(assertion, observation.cuesInvoked);
    case 'diagnostic-present':
      return evaluateDiagnosticPresent(assertion, observation);
    case 'renders-without-error':
      return evaluateRendersWithoutError(assertion, observation);
    case 'storage-roundtrip':
      return evaluateStorageRoundtrip(assertion, observation);
    default: {
      const exhaustive: never = assertion.kind;
      throw new Error(`evals/assertions.ts: unhandled assertion kind "${String(exhaustive)}".`);
    }
  }
}

function pass(assertion: EvalAssertion, observed: unknown): TierBAssertionResult {
  return { english: assertion.english, kind: assertion.kind, status: 'pass', observed };
}

function fail(assertion: EvalAssertion, observed: unknown): TierBAssertionResult {
  return { english: assertion.english, kind: assertion.kind, status: 'fail', observed };
}

/** A presence/absence kind with no `target` can never be meaningfully evaluated — recorded as a
 *  fail (never thrown, never silently skipped) naming the defect, since `evals/eval-set.ts`
 *  validates `target`'s TYPE but not its presence per kind. */
function missingTarget(assertion: EvalAssertion, context: unknown): TierBAssertionResult {
  return fail(assertion, { defect: 'assertion has no target to check', ...(context as object) });
}

/** Spec "Unreachable declared screen fails its assertion": the result names the target screen and
 *  lists the screens actually reached. */
function evaluateScreenReachable(assertion: EvalAssertion, observation: RunObservation): TierBAssertionResult {
  if (assertion.target === undefined) {
    return missingTarget(assertion, { reachedScreens: observation.reachedScreens });
  }
  const expected = assertion.expected ?? true;
  const reached = observation.reachedScreens.includes(assertion.target);
  const observed = { target: assertion.target, reachedScreens: observation.reachedScreens };
  return reached === expected ? pass(assertion, observed) : fail(assertion, observed);
}

/** Shared shape for `syscall-invoked`/`cue-invoked` (spec "Syscall assertion reads the recorded
 *  trace": the result lists the invocations actually recorded). */
function evaluateInvocation(assertion: EvalAssertion, invocations: readonly string[]): TierBAssertionResult {
  if (assertion.target === undefined) {
    return missingTarget(assertion, { invoked: invocations });
  }
  const expected = assertion.expected ?? true;
  const invoked = invocations.includes(assertion.target);
  const observed = { target: assertion.target, invoked: invocations };
  return invoked === expected ? pass(assertion, observed) : fail(assertion, observed);
}

function evaluateDiagnosticPresent(assertion: EvalAssertion, observation: RunObservation): TierBAssertionResult {
  const diagnosticKinds = observation.diagnostics.map((diagnostic) => diagnostic.kind);
  if (assertion.target === undefined) {
    return missingTarget(assertion, { diagnosticKinds });
  }
  const expected = assertion.expected ?? true;
  const present = diagnosticKinds.some((kind) => kind === assertion.target);
  const observed = { target: assertion.target, diagnosticKinds };
  return present === expected ? pass(assertion, observed) : fail(assertion, observed);
}

/** No `target` — the assertion is about the whole run. `expected: true` (the default) means "no
 *  error-severity diagnostic was recorded"; `expected: false` asserts the opposite (a candidate
 *  that IS expected to throw). */
function evaluateRendersWithoutError(assertion: EvalAssertion, observation: RunObservation): TierBAssertionResult {
  const expected = assertion.expected ?? true;
  const errorDiagnostics = observation.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const renderedCleanly = errorDiagnostics.length === 0;
  const observed = { errorDiagnostics };
  return renderedCleanly === expected ? pass(assertion, observed) : fail(assertion, observed);
}

/**
 * `target` optionally names a storage-capability prefix (defaulting to `storage`, matching the
 * bridge's `storage.get`/`storage.set` capability names, `handoff/run-observation.md`'s fixture).
 * A round trip is observed as both a write and a read invocation being recorded — `RunObservation`
 * carries only the invocation trace, never syscall payloads, so this is the strongest inert-data
 * check available.
 */
function evaluateStorageRoundtrip(assertion: EvalAssertion, observation: RunObservation): TierBAssertionResult {
  const prefix = assertion.target ?? 'storage';
  const expected = assertion.expected ?? true;
  const wrote = observation.syscallsInvoked.includes(`${prefix}.set`);
  const read = observation.syscallsInvoked.includes(`${prefix}.get`);
  const roundTripped = wrote && read;
  const observed = { wrote, read, invoked: observation.syscallsInvoked };
  return roundTripped === expected ? pass(assertion, observed) : fail(assertion, observed);
}
