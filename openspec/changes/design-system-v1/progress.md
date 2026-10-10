# Progress ledger: design-system-v1

Chains 1–14 and 23 were merged before this ledger existed; their record is the merge commits on
`integration/beta-2` and `docs/handoff-2026-10-09.md`. Staging branch: `integration/beta-2`
(`FIXLOOP_INTEGRATION_BRANCH`). Entries are appended as they happen.

## 2026-10-10, shift 1 (chains 15 and 16)

- run-resume: staging tip `a579f6f8`, in sync with origin, main tree clean.
- decision (orchestrator, owner away): chain-15 introduces the shared question component
  `CopyQuestionSheet` for "Copy the data, or start fresh?". It is shown only when
  `StoreAccess.canCopyData` is true; when false, "Make a copy" makes a fresh copy at once (a
  one-option question is not asked). design.md D8 ("no question") is superseded by the RESOLVED
  note in tasks.md and the delta spec's Forking requirement. Skipping the question for an app that
  never saved data needs `hasSavedData`, which is copy-app-data task 3.0, not chain-15.
- decision: a failed "Copy the data" in chain-15 surfaces one generic failure toast and creates
  nothing; the per-kind copy and the "Start fresh" offer stay with copy-app-data task 3.3.
- dispatched: chain-15 (home), BASE `a579f6f8`, worktree `.claude/worktrees/design-system-v1-chain-15`, branch `chain/design-system-v1-chain-15`, implementer on sonnet.
- report: chain-15 STATUS complete, fast gate PASS, commit `627a8bfb` (48 files). Class-A deviations
  logged: out-of-scope edits to `consent-flow.ts`, `flow-skeletons.tsx`, `launcher/index.ts`,
  `checks/test/repo/design-system.suite.ts` (stale exemption dropped), `scripts/release/upgrade-check/seed.yaml`
  (selectors accept the old and new menu word) and three test helpers; `fork-ui.suite.tsx` rewritten
  instead of deleted; a busy tile opens no menu.
- integrity: `fixloop.sh integrity chain/design-system-v1-chain-15` exit 0.
- merged: `71bd7a6d` (--no-ff). gate-full on `71bd7a6d`: FULL GATE PASSED (fast gate, knip, guard:metro,
  three Chromium suites, openspec validate, codex mirror). Tasks 15.1–15.6 ticked.
- deferred from chain-15, each with its owner: M18 delete reflow → task 22.3; the stuck/"honest light"
  ember on tiles → task 22.2; Stop leaving a "Stopped" tile → chain-17 (Stop lives on the Making page);
  the plan's proposed name on a tile being made → chain-16 (`attemptName` is the one place to read it);
  the composer's draft state is a prop nobody passes yet → chain-16 (task 16.1).
- reviewer on `a579f6f8..627a8bfb`: VERDICT findings, no report-mismatch, no check weakened. One medium
  (the Undo toast pauses under a screen reader while the purge timer keeps running, so Undo can be
  offered after the purge started) and lows (list-mode skeleton padding, live Settings button on the
  skeleton, skeleton count before the purge sweep, unfloored `gridLayout` with its guard tests deleted,
  dead `AppBusyOp 'delete'` and `COPY.customizePreviewLabel`, stale comments). → fix chain 15b.
- decision: the Undo window belongs to the toast. The purge completes when the Undo toast ends
  (timeout, swipe or replacement), so Undo works for as long as it is offered; under a screen reader
  that is longer than 10 s (the toast pauses there by system.md §7.1). The launch sweep stays the backstop.
- decision: a changing or change-failed app's menu has no Delete, as system.md §3.2 lists; the spec's
  "Delete on every installed app" is met once the change is stopped or discarded. No requirement changed.
- dispatched: chain-15b (reviewer fixes for home), BASE `dbfebc71`, worktree `.claude/worktrees/design-system-v1-chain-15b`, branch `chain/design-system-v1-chain-15b`, implementer on sonnet.
- report: chain-15b STATUS complete, 7/7 fixes, fast gate PASS, commit `071b2901`. Class-A: `ToastSpec.onEnd`
  added (shell-surfaces contract updated); `PurgeWindows` lost its timers (`finish(kind, id)` runs the purge,
  Home gained `onSettleDelete`/`onSettleDiscard`, `onUndo*` return boolean, "Too late to undo." toast);
  `HomeHeader.tsx` and `AppTile.tsx` touched outside the listed scope; a degenerate grid width gets a 64 pt cell.
- integrity: exit 0 (INTEGRITY OK).
- merged: chain-15b as `51b6d2e2`; ledger commit `bb5d760f`. gate-full on `bb5d760f` started.
- dispatched: chain-16 (making-describe-plan), BASE `bb5d760f`, worktree `.claude/worktrees/design-system-v1-chain-16`,
  branch `chain/design-system-v1-chain-16`, implementer on sonnet. It started before the gate-full verdict on its
  BASE: the merged tree equals 15b's fast-gated tip, so only the full-gate extras were outstanding.
- decision: the making sheet's draft lives in memory for the session (one for a new app, one per app being
  changed); persisting drafts across launches is not in v1's chain-16. Cleared when Make it starts the run.
- decision: chain-16 hosts the existing Making/Ready/Failure components inside the sheet unchanged; chain-17
  redesigns them. The plan's proposed name is stored on the pending record only if the wire already carries one.
- gate-full on `bb5d760f` (after chain-15b): FULL GATE PASSED.
- report: chain-16 STATUS complete, fast gate PASS, knip clean, commit `eee46534` (55 files). Class-A deviations
  logged: screen kinds renamed (`compose`→`describe`, `clarify` merged into `plan`, `build`→`making`, `done`→`ready`);
  a clarify/rewrite error stays on Plan with Try again; the sheet presents over Home only; out-of-scope edits
  (`ComposerBar`, `KeyboardShell`, `AgeScreen`, `refusal-landing`, `flow-chrome`, `flow-skeletons`, upgrade-check
  `seed.yaml`, `consent-coverage.suite.ts`); `ConsentScreen` kept for Settings' review mode.
- integrity: exit 0 (INTEGRITY OK). merged: `895ae528` (--no-ff).
- gate-full on `895ae528`: FAILED in `synthetic-run`, one assertion (`synthrun/test/isolation.ts:589`, the bare-browser
  egress control saw no UDP datagram within its 2 s poll). Chain-16 touches nothing the suite loads; the suite passed
  in the two earlier full gates and 391/391 on an immediate rerun. Timing flake under load → issue #172. Every other
  full-gate step passed in that run. The final gate-full of the shift runs after chain-16b.
- reviewer on `bb5d760f..eee46534`: VERDICT report-mismatch (undeclared dropped assertions; code otherwise verified:
  nothing is sent before both legal acts, both recorded with versions, approval gate, abort on close, runs never
  cross, draft rules). Mediums: Android back inside the sheet never reaches the page handlers on a device (the
  Modal's `onRequestClose` closes the sheet), a restored change-mode draft keeps a stale `editing` snapshot, a
  possible iOS double-Modal overlap between the first-run sheet and the making sheet (needs a simulator), and a
  spec contradiction (next line). → fix chain 16b for everything but the contradiction.
- OPEN, owner ruling needed (issue #173): task 16.2 and system.md §9 "First run" put terms acceptance and AI-data
  consent on one sheet with the full disclosure collapsed under "Full details". Live `terms-acceptance` ("own step",
  "SHALL say nothing about data") and `ai-data-consent` (every disclosure section "before any choice is offered",
  nothing about the terms) say otherwise, and this change has no delta for either. No requirement was changed.
  Task 16.2 stays unticked until the ruling.
- decision: Android back inside the making sheet steps back before it closes: on Plan it cancels an open row edit,
  else returns to Describe (text and answers kept); on Describe it closes the sheet and keeps the draft. This follows
  the delta spec's "Back on Plan SHALL return to Describe" and replaces the dispatch note that back always closes.
- deferred: the making sheet presents over Home even when started from History or a running app. Chain-19 (the
  Whim sheet grows into the change's plan) and chain-20 (History's "Change it") own those entry points.
- side findings filed: #167 stale demo flows, #170 no producer for the plan's proposed name, #171 stub rewrite
  restates clarify questions, #172 synthrun UDP canary flake.
- ruling received (product-owner session, provisional until the owner confirms on #173): option A, keep the one
  sheet. Recorded as design.md D19. MODIFIED deltas written for `terms-acceptance` (one requirement renamed) and
  `ai-data-consent`; `openspec validate design-system-v1 --strict` passes. Kept as requirements: two separate
  affirmative acts, neither pre-selected, each recorded with its own version; nothing sent before every due act is
  recorded; exits record nothing; the age gate blocks; the full disclosure is on the sheet and may start collapsed.
  Tightened: the first layer names every data category sent, the recipients and the purpose, in every legal
  language. Chain-16b implements the deltas; 16.2 is ticked when it merges.
- dispatched: chain-16b (reviewer fixes A1–A6 and first-run deltas B1–B7), BASE `5ccb0ea5`, worktree `.claude/worktrees/design-system-v1-chain-16b`, branch `chain/design-system-v1-chain-16b`, implementer on sonnet. #173 commented: option A applied provisionally, B named as the alternative, left open.
- report: chain-16b STATUS complete, 13/13 (A1–A6, B1–B7), fast gate PASS, knip clean, commit `31e9c74a`. Class-A:
  `Sheet` gained `useSheetBack` and `onClosed` (1 s fallback), `FirstRunSheet` gained `consentDue`, `DescribePage.onClose`
  removed, new legal key `firstRunContinue` (en, fr); only `firstRun*` strings changed, no `consent*` key, no version bump.
- integrity: exit 0. merged: `44532e5c` (--no-ff). gate-full on `44532e5c`: FULL GATE PASSED.
- reviewer on `5ccb0ea5..31e9c74a`: VERDICT findings, no report-mismatch, spec conforms. Left for the next shift
  (no new worktrees this shift, by the product-owner session's instruction): #174 (the first-layer coverage test
  passes by key presence) and #175 (label flip while the first-run sheet closes, Make it swallowed after a null
  client-options result, render-phase write in `useSheetHandOver`, the 1 s fallback, dead `useSystemBack` on
  Making/Ready/Failure, stale-record Describe after the app was deleted, two test-hygiene lows).
- tasks 16.1–16.6 ticked (16.2 under the provisional ruling D19; #173 stays open for the owner).

### Shift 1 closing summary

Chains run: 15, 15b (reviewer fixes), 16, 16b (reviewer fixes + first-run deltas). Redispatches: none.
Deviations: all class A; no class B or C. Reviewer verdicts: 15 findings, 16 report-mismatch (undeclared dropped
assertions, restored in 16b), 16b findings. Full gates: `71bd7a6d` pass, `bb5d760f` pass, `895ae528` fail on the
synthrun UDP canary flake only (#172), `44532e5c` pass. Not done from the chain blocks and where it went: see the
"deferred" lines above. Nothing on a device was verified this shift.

## Shift 2 (2026-10-10)

- side branches landed first: `chain/copy-app-data-4` merged as `0ccd05d2` (integrity 0; reviewer: findings, three
  lows, no test removed; gate-full PASS), then `harness/removal-ratchet` as `d25e330d` (decision #78). From
  `d25e330d` on, a commit that removes an assertion or a test needs a `Check-removal: <reason>` trailer on a commit
  touching that file, and the orchestrator reviews each at merge.
- triage of the two device passes on `895ae528` plus #174 and #175: `visual-fixes.md` in this folder (classification,
  the decisions taken for the owner, and the fix chains 16c–16g in two waves).
