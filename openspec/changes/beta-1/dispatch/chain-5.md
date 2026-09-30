# chain-5 dispatch block: app-legal-flow (tasks 5.1–5.5)

Tasks 5.1–5.5 verbatim from tasks.md, as amended by progress.md R7 (the dispatch prompt quotes them).

Read (only these):
- `specs/store-age-signals/spec.md` and `specs/terms-acceptance/spec.md` (both whole; both short).
- `design.md` §D1, §D2 (with its R7 amendment), §D6.
- `research.md` §"Relevant files" (the age/legal bullets), §"Constraints and invariants" (age reduction, raw
  signal never stored, single legal gate).
- `openspec/changes/legal-surface-v2/specs/{store-age-signals,terms-acceptance}/spec.md`: the live text.
- progress.md R7.

Decisions made for the implementer:
1. **D1 deadline in JS.** `runAgeCheck` races `read()` against a 3 s timer through the existing reduction, so a
   timeout lands as `unavailable`. Clear the timer when `read()` wins. Test with a never-settling `read` and the
   fake clock the suites already inject. Red-check against the unbounded version.
2. **R7 acknowledgment, native side.**
   - Swift: `WhimAgeSignal.acknowledgeSignificantUpdate(description)`, guarded by `#available(iOS 26.4, *)`.
   - First `requiredRegulatoryFeatures` (bounded in JS at 3 s like the read). Without
     `.significantAppChangeRequiresAdultNotification` it resolves `unavailable` (not required here).
   - Otherwise it calls `showSignificantUpdateAcknowledgment(in: <active UIWindowScene>, updateDescription:)` on
     the main actor. A normal return is `acknowledged`, a `CancellationError` is `declined`, any other error or a
     missing window scene is `unavailable`.
   - It resolves a string (`'acknowledged' | 'declined' | 'unavailable'`) and never rejects.
   - Add the `.mm` binding and the TS spec in `src/native/NativeWhimAgeSignal.ts`.
   - Android: `WhimAgeSignalModule.kt` implements the new spec method and resolves `'unavailable'`. The
     TurboModule codegen spec is shared, so a missing Android method breaks the Android build.
   - Verify every API name against the SDK's `DeclaredAgeRange.swiftinterface` (iPhoneOS.sdk, arm64e) before
     writing Swift. Check `.significantAppChangeRequiresAdultNotification` too: it is a
     `RegulatoryFeature` case at line ~91. You can't build iOS in a worktree; the orchestrator compiles it in
     task 10.4. Keep the Swift small and state what you couldn't compile.
3. **R7 acknowledgment, JS side (5.3).** It's requested only when the platform is iOS, this pass's signal is
   `minor-approved`, and the stored terms acceptance is for an older terms version. JS bounds it at **60 s**
   (timeout → `unavailable`).
   - `declined` keeps AI features off exactly like `minor-not-approved`.
   - `unavailable` proceeds for this pass only: nothing is stored, so it's asked again next pass.
   - `acknowledged` is stored keyed by the current terms version, so it's never asked again for that version.
   - Store only the outcome, never the raw signal (Texas §121.055). Test every `store-age-signals` scenario.
4. **D6 (#104).** Settings "Turn on AI features" goes through `nextLegalStep` from the start. `legalScreen`
   stays the only builder and nothing bypasses it. Tests:
   - outdated terms → terms, then one consent;
   - current terms → one consent;
   - no legal screen twice in one pass. The assertion watches the sequence of screens shown.
5. **5.5 is a docs edit:** reword `openspec/changes/developer-observability/tasks.md` 8.2(a) as the task says.
   Nothing else in that change folder.
6. `LauncherRoot.tsx` is shared with chain-4 (already merged) and chain-6 (next). Keep the edits to the legal
   handlers.

Gate: `./scripts/gate.sh` to FAST GATE PASSED. Typecheck the launcher test files you touch with a scratch tsconfig
(#79), and say how. End the report with HARNESS FEEDBACK (template in docs/harness-feedback/README.md).
