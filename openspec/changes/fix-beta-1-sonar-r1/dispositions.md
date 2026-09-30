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
