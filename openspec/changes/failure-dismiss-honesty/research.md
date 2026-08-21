# Research: failure-dismiss-honesty

Origin: live bug report (2026-08-21, on-device). Opening an `interrupted` ghost tile and tapping
the failure screen's only exit — labeled "Back to your apps" — silently deleted the record and its
tile. Investigated pre-change; anchors re-verified at v1-sprint 65da21f:

1. The behavior is SPEC'D, not a defect: `openspec/specs/prompt-flow/spec.md:257` — the failure
   screen opened from a ghost "SHALL offer Retry … and Dismiss (delete the record)". The scenario
   at :269-272 mandates deletion.
2. The dishonesty is pure copy/affordance: `src/host/launcher/copy.ts:158`
   `failureDismiss: 'Back to your apps'` — a destructive action labeled as plain navigation.
   Rendered at `src/host/launcher/FailureScreen.tsx:207`; wired at
   `src/host/launcher/LauncherRoot.tsx:862` (`onDismissPending`) and :901 (`onDismiss` for the
   live-failure case), both routing into the shell's `dropAttempt` (deletes the pending-build
   record AND its run journal — generation-observability's paired-delete discipline,
   `handoff/shell-wiring.md` table row `dropAttempt`).
3. There is NO non-destructive exit today: the screen's only ways out are Retry and the deleting
   "Back to your apps". A user who just wants to look at a failed attempt and leave cannot.
4. Adjacent copy keys that are honest and must not be confused with this one: `doneBackToApps:105`
   and `launchFailedBack:151` — both genuinely navigate without deleting.
5. Source locks that constrain edits: `test/failure-screen.suite.ts` asserts copy usage and
   forbids diagnostic internals; `test/prompt-flow-wiring.suite.ts` pins `dropPendingBuild(` to
   exactly one call site (inside `dropAttempt`) — the new keep-and-leave path must NOT add a
   second deletion call site, which the lock would catch.
