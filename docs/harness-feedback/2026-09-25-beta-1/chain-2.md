# chain-2 (server-admission-line), implementer, Opus. Resumed from an orchestrator-saved WIP (the first agent was cut off by the session limit and left no feedback)

- **What:** Resuming another agent's uncommitted WIP (1171 lines across 14 files) meant reviewing all of it as a stranger's code before adding anything.
  **Mechanism:** chain resume from an orchestrator-saved WIP commit · **Verdict:** NEUTRAL · **Cost:** about 15 tool calls and 12 minutes of reading diffs · **Evidence:** `git show 6eb0e3d3`. The WIP passed the gate as it stood, and the resume note ("the WIP touches neither…", with the known gaps listed) was accurate and pointed me straight at what was missing.
- **What:** The dispatch block's path pointed inside the worktree, but the file had been committed after BASE.
  **Mechanism:** chain block · **Verdict:** DRAWBACK · **Cost:** 1 call; the coordinator corrected it mid-run · **Evidence:** `openspec/changes/beta-1/dispatch/chain-2.md` is missing from the worktree.
- **What:** A test that runs only in gate-full (`e2e.ts`: "a fourth generation … is refused with server_busy") was sure to fail with the line in place. The fast gate cannot see it, so "gate passed" on the WIP hid a gate-full failure.
  **Mechanism:** the fast/full gate split · **Verdict:** DRAWBACK (a gap; I found it by grepping, not through the harness) · **Cost:** about 8 minutes, plus a 90 s local e2e run · **Evidence:** `server/test/e2e.ts:614-615` at BASE.
- **What:** Task 2.3 said "add the three rows to docs/deploy.md", but the rows are only true if the keys also go through the deploy plumbing (`lib.sh`, `deploy.sh`, operator example).
  **Mechanism:** tasks.md (theme T1) · **Verdict:** DRAWBACK · **Cost:** about 6 minutes to decide and add tests · **Evidence:** `deploy/deploy.sh:60` server_optional_keys; the `profileProblems` "standard must not override server limits" rule.
- **What:** Adding two test sections pushed `runConfigTests` over the cognitive-complexity limit (18 > 15), so I had to split them into functions.
  **Mechanism:** lint (theme T9) · **Verdict:** DRAWBACK · **Cost:** 2 calls · **Evidence:** `config.suite.ts:89:17 sonarjs/cognitive-complexity`.
- **What:** Tooling friction: a foreground `sleep` was blocked by tool policy, and zsh `nomatch` rejected `grep --include=*.ts` twice.
  **Mechanism:** tooling (theme T12) · **Verdict:** ENV · **Cost:** 3 calls · **Evidence:** "Blocked: sleep 60 followed by…"; "(eval):1: no matches found: --include=*.ts".

What helped: the chain block's decisions 1–11 being settled up front; the resume note's list of known gaps; the WIP's `ManualLineClock` and `StreamEvents`, plus `route-doubles` `within`/`TIMED_OUT`, which made every new await bounded; Chromium working from the worktree, so I could run the e2e locally.

What the harness should change:
1. Chain blocks (and resume notes) should list the gate-full-only suites that exercise the chain's files (here `server/test/e2e.ts`), so an implementer runs them before reporting.
2. When a task says "document env var X", the plan should say how X gets delivered (operator values file, profile, or code default); whether the doc is true depends on that plumbing.
3. When the orchestrator saves WIP from an agent that was cut off, the commit message should state which tasks the dead agent finished, as this resume note did informally.
