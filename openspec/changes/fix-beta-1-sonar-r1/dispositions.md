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
