# S107 adjudication — PR #137 at 3a23babe

Source: `/tmp/whim-beta1-sonar-3a23.txt`, `typescript:S107` at `src/host/launcher/LauncherRoot.tsx:1676`.

Classification: **genuine source issue; not a false positive and not pre-existing at the chain-10 base.** At D19 base `874be330`, `handleGenerateRefusal` had six parameters. The carried retry-persistence work added `retrySnapshot`, `editing`, `prompt`, `observedRepairAttempts`, and `lease`, leaving eleven scalar parameters in the final merged source. Sonar is correctly identifying a handler whose call contract is now difficult to keep aligned with the settlement path.

Producer and impact: `settleServerEnding` at `LauncherRoot.tsx:1732` constructs one attempt context, then explodes it into the eleven-argument `handleGenerateRefusal` call at lines 1782–1793. The handler drives both fresh-refusal drop-to-plan behavior and Retry/detached persistence, generic recovery, selected-screen, and stale-lease behavior. A positional mistake can silently mix attempt identity with UI context or retry-recovery state.

Smallest maintainable remedy:

1. Introduce one local `GenerateSettlementAttempt` type for the existing attempt fields (`attemptId`, retry/plan/counts, snapshot, editing, prompt, observed repairs, lease).
2. Change `handleGenerateRefusal` to accept `(refusal, ctl, attempt)` and read `ctl.detached` plus named `attempt` properties. Reuse the same type for `settleServerEnding`.
3. Change its sole call site to pass the existing context object. Do not change persistence, lease, journal, or screen logic.

Bounded scope: `src/host/launcher/LauncherRoot.tsx`; add one rendered assertion in `src/host/launcher/test/attempt-lifecycle-ui.suite.tsx` for a fresh generate refusal returning to Plan with its notice and no pending ghost. Existing rendered coverage already exercises the retry-refusal recovery path (lines 513–558) and stale same-ID refusal ownership (lines 961–989).

Required evidence after a correction: the focused rendered refusal assertion, `npm run launcher:test`, the fast gate, and a fresh PR Sonar ingestion showing S107 cleared. No config change, suppression, or rule adjustment is appropriate.

No source edits, tests, Git mutations, or native resources were used for this adjudication. The current Sonar quality gate is OK, but the open MAJOR issue means this is not a clean-none result.
