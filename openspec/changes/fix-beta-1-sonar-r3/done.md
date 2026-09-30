# Sonar S107 — mechanical DONE plan

**Finding:** `typescript:S107` at `src/host/launcher/LauncherRoot.tsx:1676` on PR head `3a23babe56c7aa2e6db8f1667bd8bb2ed6b2082c`.

**Severity:** MED

**Classification:** structural-no-test. This change only replaces eleven positional arguments with a typed context object whose fields carry the same values. It must not alter refusal settlement, persistence, leases, screen selection, or requests.

**Allowlist:**

- `src/host/launcher/LauncherRoot.tsx`

## EVIDENCE

```text
## src/host/launcher/LauncherRoot.tsx
  const handleGenerateRefusal = (
    attemptId: string,
    refusal: ServiceRefusal,
    isRetry: boolean,
    detached: boolean,
    fromPlan: PlanScreen | undefined,
    counts: RunTerminalCounts,
    retrySnapshot: AttemptSnapshot | undefined,
    editing: InstalledApp | undefined,
    prompt: string,
    observedRepairAttempts: number,
    lease: PendingAttemptLease,
  ): void => {
```

## Required edit

Introduce a local `GenerateSettlementAttempt` context type from the existing inline `settleServerEnding` attempt shape. Use that type in `settleServerEnding` and change the refusal helper to accept `refusal`, `ctl`, and `attempt`. The sole call becomes `handleGenerateRefusal(refusal, ctl, attempt)`.

Map each current field once: `attemptId`, `isRetry`, `fromPlan`, `counts`, `retrySnapshot`, `editing`, `prompt`, `observedRepairAttempts`, and `lease` come from `attempt`; `detached` remains `ctl.detached`. Keep `streamRequestId` in the shared context shape only if `settleServerEnding` still requires it. Do not change the selected-attempt guard, store or journal calls, live-ref release, screen outcome, request handling, or error paths.

## Test classification and assurance

No new test is required. This is structural-no-test work: do not add a patch-shaped or source-grep test, and no behavioral RED check is required. Review the type/context field mapping and run the normal typecheck and full gate after the edit.

Existing meaningful behavior coverage includes:

- `src/host/launcher/test/attempt-lifecycle-ui.suite.tsx` covers a Retry service refusal whose terminal journal write cannot persist, including restoration of the old record/journal pair and the rendered Back path.
- The same suite covers a stale same-ID refusal while a newer retry remains reattachable.
- `src/host/launcher/test/build-lifecycle.suite.ts` covers fresh, retry, and detached refusal persistence outcomes directly through `settleRefusedGenerate`.

Coverage gap to record separately: there is no rendered LauncherRoot test for a fresh HTTP generate refusal that verifies its plan/notice landing and absence of a pending ghost. That gap is outside this signature-only S107 correction; it does not justify adding a behavioral patch test here.

## Boundaries

No checker or configuration changes, suppressions, dependencies, generated files, or test-harness changes. No behavior delta is intended.

This is one newly reported, independently scoped finding. The prior R2 cap and park history remain unchanged.
