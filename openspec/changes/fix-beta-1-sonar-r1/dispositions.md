# Sonar round 1 dispositions

Staging: `integration/beta-1`; PR #137; initial analysis at `a1586b87b55467b5696ef2da5cf4d07abcc45c89`.

- 2026-09-29: nested batch created. Sonar probe exit 10, GATE: ERROR, 96 findings copied verbatim to findings.md. Existing GitHub quality/isolation checks pass. Planner dispatched; no source worker has started.
- shell-release: evidence present at HEAD, stale check exit 0 (17 lines). Worktree `.claude/worktrees/beta-1-sonar-tools`, branch `fix/beta-1-sonar-tools`, pinned BASE `4d15c0dde6e3da268f50b8656e895b812d1efcab`; six-file allowlist, structural/no-new-test class. Worker dispatched with sole server-bearing gate lease.
- Ingestion recorded: all 96 findings appended to the new recurrence ledger using the synced spec's grammar. Planner accounted for all locations, including 41 documented async-contract/serial-execution false positives. No external disposition has been applied yet.
- shell-release first attempt: actual fast gate exit 1, typecheck TS2307 on both node:buffer type imports; every other check passed. No commit or merge. Worker requested a non-protected ambient declaration in scripts/release/node-buffer.d.ts; scope correction under independent review. Gate lease released.
- Root adjudication: 41 current PR issue keys verified against rule, source path and line; documented Sonar API bulk transition succeeded (41 success, 0 ignored/failures), notifications disabled. A follow-up API read confirms all 41 FALSE_POSITIVE dispositions; receipt fp-receipt.json. No source/check suppression. Overall Sonar gate awaits the remaining source fixes and fresh analysis.
- S6: false-positive-adjudicated, key AaDv2GrLDHOwsfbTeJiy; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S31: false-positive-adjudicated, key AaDv2Gn6DHOwsfbTeJiO; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S32: false-positive-adjudicated, key AaDv2Gn6DHOwsfbTeJiP; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S33: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJiW; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S34: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJij; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S40: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJid; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S41: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJie; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S42: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJif; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S43: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJiq; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S44: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJir; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S45: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJis; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S48: false-positive-adjudicated, key AaDv2GsEDHOwsfbTeJiz; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S49: false-positive-adjudicated, key AaDv2Gp_DHOwsfbTeJiu; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S50: false-positive-adjudicated, key AaDv2Gp_DHOwsfbTeJiv; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S60: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJiV; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S61: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJiX; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S62: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJiY; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S63: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJiZ; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S64: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJia; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S65: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJib; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S66: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJic; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S67: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJii; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S68: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJik; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S69: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJil; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S70: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJim; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S71: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJin; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S72: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJio; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S73: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJip; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S79: false-positive-adjudicated, key AaDv2GiGDHOwsfbTeJiA; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S80: false-positive-adjudicated, key AaDv2GiGDHOwsfbTeJiB; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S84: false-positive-adjudicated, key AaDv2GziDHOwsfbTeJjP; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S86: false-positive-adjudicated, key AaDv2Gs1DHOwsfbTeJi1; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S87: false-positive-adjudicated, key AaDv2Gs1DHOwsfbTeJi2; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S89: false-positive-adjudicated, key AaDv2G_fDHOwsfbTeJjd; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S90: false-positive-adjudicated, key AaDv2G_fDHOwsfbTeJje; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S91: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJiT; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S92: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJiU; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S93: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJig; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S94: false-positive-adjudicated, key AaDv2Go9DHOwsfbTeJih; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S95: false-positive-adjudicated, key AaDv2G9vDHOwsfbTeJjb; rationale fp-rationale.md, confirmed by fp-receipt.json.
- S96: false-positive-adjudicated, key AaDv2G_fDHOwsfbTeJjc; rationale fp-rationale.md, confirmed by fp-receipt.json.
# Dispatch: resolver-routes

S8, S23-S24, S26, S51-S59: dispatched at BASE 757809963baa429b99bccc16e8ce02174ff829d7 to fix/beta-1-sonar-resolvers, .claude/worktrees/beta-1-sonar-resolvers. Stale check passed all 18 evidence lines. Structural only; server-bearing gate lease remains with shell-release until it returns.

S7, S9-S21, S25, S36-S39, S47: worker commit cb57231c914689c6c97717bfa067d5839559826c passed the fast gate (actual exit 0) and root integrity against pinned BASE 4d15c0dde6e3da268f50b8656e895b812d1efcab. All seven changed files are within the revised allowlist. Independent review and hermetic full gate remain pending.

S77: report-draft-recovery dispatched at BASE a8d89cefe2b2ac09700a18e64a8452dcc67cd4d6 to fix/beta-1-sonar-report, .claude/worktrees/beta-1-sonar-report. Stale check passed seven evidence lines. Behavioral recovery needs a rendered rejection regression and root red-check; worker prepares while resolver-routes holds the gate lease.

## Terminal tooling and resolver dispositions

Shell-release: hermetic full gate exited 0 on cb57231c914689c6c97717bfa067d5839559826c; merged as b6575a7b5c3b6f110ba18c3d7ebe57d6dc069a9d; post-merge fast gate exited 0. Independent review and integrity passed. Logs: /tmp/whim-beta1-sonar-tools-fullgate.log and /tmp/whim-beta1-sonar-tools-regate.log.
- S7: merged, regate-pass; shell-release receipt/review.
- S9: merged, regate-pass; shell-release receipt/review.
- S10: merged, regate-pass; shell-release receipt/review.
- S11: merged, regate-pass; shell-release receipt/review.
- S12: merged, regate-pass; shell-release receipt/review.
- S13: merged, regate-pass; shell-release receipt/review.
- S14: merged, regate-pass; shell-release receipt/review.
- S15: merged, regate-pass; shell-release receipt/review.
- S16: merged, regate-pass; shell-release receipt/review.
- S17: merged, regate-pass; shell-release receipt/review.
- S18: merged, regate-pass; shell-release receipt/review.
- S19: merged, regate-pass; shell-release receipt/review.
- S20: merged, regate-pass; shell-release receipt/review.
- S21: merged, regate-pass; shell-release receipt/review.
- S25: merged, regate-pass; shell-release receipt/review.
- S36: merged, regate-pass; shell-release receipt/review.
- S37: merged, regate-pass; shell-release receipt/review.
- S38: merged, regate-pass; shell-release receipt/review.
- S39: merged, regate-pass; shell-release receipt/review.
- S47: merged, regate-pass; shell-release receipt/review.
- S8: false-positive-adjudicated; resolver-fp-rationale.md and resolver-fp-receipt.json.
- S23: false-positive-adjudicated; resolver-fp-rationale.md and resolver-fp-receipt.json.
- S24: false-positive-adjudicated; resolver-fp-rationale.md and resolver-fp-receipt.json.
- S26: false-positive-adjudicated; resolver-fp-rationale.md and resolver-fp-receipt.json.
- S51: false-positive-adjudicated; resolver-fp-rationale.md and resolver-fp-receipt.json.
- S52: false-positive-adjudicated; resolver-fp-rationale.md and resolver-fp-receipt.json.
- S53: false-positive-adjudicated; resolver-fp-rationale.md and resolver-fp-receipt.json.
- S54: false-positive-adjudicated; resolver-fp-rationale.md and resolver-fp-receipt.json.
- S55: false-positive-adjudicated; resolver-fp-rationale.md and resolver-fp-receipt.json.
- S56: false-positive-adjudicated; resolver-fp-rationale.md and resolver-fp-receipt.json.
- S57: false-positive-adjudicated; resolver-fp-rationale.md and resolver-fp-receipt.json.
- S58: false-positive-adjudicated; resolver-fp-rationale.md and resolver-fp-receipt.json.
- S59: false-positive-adjudicated; resolver-fp-rationale.md and resolver-fp-receipt.json.

Resolver API transition: 13 success, 0 ignored/failures, notifications disabled; readback confirms every reviewed current key FALSE_POSITIVE. Worker route edits were restored to its pinned BASE; no source commit/merge. Initial void patch failed lint; the adaptive catch attempt lost its final gate outcome, so no pass was inferred. Total confirmed false-positive dispositions: 54.

S81, S82, S88: dispatched at BASE b6575a7b5c3b6f110ba18c3d7ebe57d6dc069a9d to fix/beta-1-sonar-history in .claude/worktrees/beta-1-sonar-history after 12-line stale check passed. Behavioral regressions and review/gates pending.

## Launcher producer dispositions and report verification

S2, S5, S74, S76, S83: root accepted the closed product-callback evidence in launcher-fp-rationale.md; current keys/rules/paths/lines were verified before the supported Sonar API transition. Five success, no ignored/failures, notifications disabled; readback confirms all FALSE_POSITIVE. See launcher-fp-receipt.json. Total confirmed false positives: 59.

S77: worker commit 244597d2f46df4a0613a138bcfd73a5273ab0ed4 passed fast gate with actual exit 0; root integrity passed. Independent review CLEAN. Root redcheck2 exited 0, confirming 6 assertion failures with ReportSheet and copy reverted to BASE (81 passed). The first redcheck incorrectly targeted the primary checkout, ran its older 61-check suite and exited 5; the corrected command uses the redcheck temporary checkout cwd. No assertion was changed to obtain the RED. Hermetic full gate and merge remain pending.

Launcher-age initial stale check exited 7: the evidence block did not match HEAD. No worktree was created and no worker dispatched. Planner supplied corrected verbatim evidence for the next stale check.

## Resource interruption and queued verification

Report hermetic full gate session 66337 was voluntarily interrupted (actual exit 130) during the owner's memory investigation; primary checkout restored to integration/beta-1. This is not a source-failure verdict or a full-gate pass; rerun remains required. Root shut down its Whim iOS simulator 469C2821-24D0-4FF4-B72D-DCDB9184048D and stopped its local QA servers on 8787/8790. Stored device/server data remains for final-candidate acceptance.

Owner constraints: keep Docker, omvi-postgres and outsiide-postgres running. Only anyworkflow-postgres was explicitly authorized to stop, and was stopped at 2026-09-30T03:14:31Z. Do not restart Docker or mutate the other projects' containers. The original headless FilmKit Android process was shut down; later headed emulator-5556 instances were traced to Outsiide's active Claude test-health subagent, so do not interfere with its QA run. Whim heavy verification jobs are serialized.

History fast gate retries 1 and 2 failed test-helper lint; retry 1 also exposed a missing ignored worktree-local contract link. Worker fixed only its allowed test helpers and that local link. Retry 3 is now leased; no source commit/pass has been inferred from earlier runs.

S27, S28, S30: dispatched to fix/beta-1-sonar-queue, .claude/worktrees/beta-1-sonar-queue, pinned BASE b6b8c58fd1ea3c541fc3ea274b9bcba1c38999d5 after 20-line stale check passed. Structural source patch prepared, build/targeted lint passed; fast/full gates and review pending. S29 is separately reconciled against its resolve-only producer.

S29: false-positive-adjudicated. Supported Sonar transition succeeded for the single verified issue, with notifications disabled; readback confirms FALSE_POSITIVE. Producer and observer are resolve-only. See queue-fp-rationale.md and queue-fp-receipt.json. Total confirmed false positives: 60.

S81, S82, S88: worker commit eeec0f08 passed fast gate retry 3, session 29004 actual exit 0. The isolated history runner passed 46/0; root RED, integrity, independent review and full gate remain pending.

S27, S28, S30: worker commit 5c01cf6e8d666e0e99565df40dcdb21cbd549e88 passed fast gate session 10431, actual exit 0. Existing server checks passed 4,328/0. Root integrity, independent review and full gate remain pending.

Launcher-age and appstats-noop evidence: corrected verbatim blocks passed root stale checks with actual exit 0. The earlier stale failures did not create a worktree or authorize a source dispatch.

S22, S75: dispatched to fix/beta-1-sonar-launcher-age in .claude/worktrees/beta-1-sonar-launcher-age, pinned BASE 100d71f79c45f6d2e8509f85fa8e9bd492b73b50, after root stale exit 0 (two lines). Four-file allowlist and corrected launcher-age DONE govern this cohort.

S46, S85: dispatched to fix/beta-1-sonar-xhr-usage in .claude/worktrees/beta-1-sonar-xhr-usage, pinned BASE 6314b1eea6dca5f5f83d485950233ea7bc0f16ea, after root stale exit 0 (14 lines). Four-file allowlist and corrected xhr-usage DONE govern this cohort.

S81, S82, S88: root integrity exit 0; independent review CLEAN in reviews/history-rejection-recovery.md. Root redcheck session 10687 actual exit 0: reverting HistoryScreen to BASE with final tests triggers the real unhandled listing rejection. Selected-root runner prevents reading tests from the primary checkout. Full gate remains pending.

S27, S28, S30: root integrity exit 0; independent review CLEAN in reviews/queue-source.md. Structural cohort, no added test/RED required. Full gate remains pending.

S77: merged, regate-pass at 5656a631f9891d74c2c99d26ef0e40afa4273404. Report full gate retry 2 session 15338 actual exit 0, FULL GATE PASSED; post-merge fast gate session 51009 actual exit 0, FAST GATE PASSED. Logs /tmp/whim-beta1-sonar-report-fullgate2.log and /tmp/whim-beta1-sonar-report-regate.log. Independent review and root RED/integrity receipts above. Terminal source count: 21.

S46, S85: worker fast gate session 25629 actual exit 0, FAST GATE PASSED, /tmp/whim-beta1-sonar-xhr-usage-fast.log. Commit, independent review, root RED/integrity and full gate remain pending.

S3, S4, S35: root stale exit 0 (three lines); created fix/beta-1-sonar-host-guards in .claude/worktrees/beta-1-sonar-host-guards at immutable BASE b40f7fab23972492ee6b9c50b0a4770b4739f570. One-file structural scope; final host-Hermes compatibility proof remains a distinct acceptance requirement.

Host-guards native acceptance clarified after read-only engine/producer review: all three callsites invoke the same Object.hasOwn intrinsic in launcher Hermes. Existing wire-future-frames tests prove null normalization, summaries and event semantics. One successful host decode on each shipping platform proves intrinsic availability; optional-null Release branch coverage would require unrelated production/test infrastructure. See host-guards-native-evidence.md and corrected DONE. Native receipts still required.

S22, S75: fast gate attempt 1 session 88035 actual exit 1; the sole failure was server metafile resolution through the worktree dependency link (4,327 passed, one failed). Worker repaired the ignored local contract workspace link and retains the lease for retry; no source PASS or terminal disposition inferred.

S46, S85: source commit add2be3988aca8ef35bd7cbbee2fbf8b1a05759d; root integrity actual exit 0, exact four paths. Root RED and independent review/full gate remain pending.

S46, S85: root redcheck session 93640 actual exit 0. Reverting both production files with final tests retained reproduces classifier and purge-observer assertion failures; no compile-only RED. Log /tmp/whim-beta1-sonar-xhr-usage-redcheck.log.

S22, S75: worker commit 99a8e6d24bfbbad4b639d14cd24b3243d9ac00fa. Fast retry session 63976 actual exit 0, FAST GATE PASSED. Targeted renderer 139/0 and lint passed. Root RED/integrity, independent review and full gate pending.

S1: root stale actual exit 0 (one line); dispatched to fix/beta-1-sonar-evidence-path in .claude/worktrees/beta-1-sonar-evidence-path, immutable BASE 20adf6d06e2759b694244ccbbb10be4d7923e008. Exact one-file acceptance-helper scope.

S22, S75: root integrity actual exit 0, exact four files. Root redcheck session 63163 actual exit 0; reverting LauncherRoot and age-check with final tests retained reproduces the real consent-resumed pending-store rejection (no compile failure). Log /tmp/whim-beta1-sonar-launcher-age-redcheck.log. Review and full gate still pending.

S3, S4, S35: worker commit 90dd017d25e44e6676436798ccf1d055d728c305; fast gate session 2615 actual exit 0, FAST GATE PASSED. Structural source-only changes; no new test/RED required. Root review/integrity/full gate and final native compatibility proof remain pending.

S78: root stale actual exit 0 (two lines); dispatched to fix/beta-1-sonar-appstats-noop in .claude/worktrees/beta-1-sonar-appstats-noop, immutable BASE 720803675c547ea2d6b4288e7c2eb8308314472a. Exact one-file structural promise-contract scope.

S46, S85: independent read-only review CLEAN in reviews/xhr-usage.md, confirming exact scope, single settlement, late-abort taxonomy and private/isolated purge observers. Worker fast, root RED/integrity all passed; hermetic full gate/merge pending.

S3, S4, S35: root integrity actual exit 0 and independent review CLEAN in reviews/host-guards.md. Full gate/merge and final native compatibility receipts remain pending.

S22, S75: independent review REJECTED candidate 99a8e6d2, two HIGH defects (unguarded guardian acknowledgement persistence and rethrowing journal recovery after pending recreation). See reviews/launcher-age-initial.md. Returned to the same worker/worktree, original immutable BASE and four-file allowlist, with additional guardian/journal/post-record failure regressions. Earlier fast/RED/integrity passes do not close these defects; second review, new fast/RED/full gate remain required.

S1: worker commit dde9bbfb548a6e636313148c7ff1675654ada264, fastgate session71412 actual exit 0. Root redcheck session31559 actual exit 0: restored BASE accepts the valid outside hierarchy and validation fails with an explicit escape assertion. Root integrity exit 0, exact onefile. Independent review/fullgate/merge pending.

S1: independent review CLEAN in reviews/evidence-path.md, confirming resolved confinement, symlink escape refusal and preserved bounds. Fast/root RED/integrity passed; full gate and merge pending.

S78: worker commit 1c7b4a8c6c8f5a839eb18c191b9b4346b746d16e, fastgate session9880 actual exit 0, FAST GATE PASSED. Root integrity actual exit 0, exact onefile. Structural scope; independent review/fullgate/merge remain pending.
