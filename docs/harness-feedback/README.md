# Harness feedback

Evidence for changing the coding harness (`docs/harness.md`), collected run by run from the agents that live inside it. Each run adds a folder `<YYYY-MM-DD>-<change>/` with one file per agent, plus the orchestrator's own. This README keeps the running tally: which themes keep coming back, what actually caught mistakes, and the proposals ranked by evidence.

## Protocol

Every dispatch prompt (implementer, fix-worker, reviewer, verifier) ends by asking for a `HARNESS FEEDBACK` section in the agent's own final report, in the template below. The orchestrator saves it word for word to `<run>/<label>.md`. Never collect feedback by resuming a finished agent: a resume reloads the agent's whole transcript after its prompt cache has expired (subagent cache lives about 5 minutes). On 2026-09-24, eight debrief resumes re-read over a million tokens and hit the session limit. The orchestrator then writes `<run>/orchestrator.md`, updates the tables below, and commits the folder with the run's ledger.

Template, one entry per time the harness blocked, slowed, redirected or forced a workaround, including workarounds never reported:

```
- **What:** one line
- **Mechanism:** which harness part (gate check, hook, worktree setup, runbook rule, chain block, contract, tooling)
- **Verdict:** CAUGHT-REAL-MISTAKE | DRAWBACK | ENV | NEUTRAL
- **Cost:** rough minutes or tool calls
- **Evidence:** error text or file:line
```

Then "What helped" and "What the harness should change" (1–3 proposals).

Verdicts:
- **CAUGHT-REAL-MISTAKE:** stopped a genuine error by the agent or the plan.
- **DRAWBACK:** a cost with no catch.
- **ENV:** the machine or tooling, not the harness.
- **NEUTRAL:** neither.

## Runs

| Run | Agents | Entries | Caught | Drawback | Env | Neutral |
|---|---|---|---|---|---|---|
| [2026-09-23 request-envelope](2026-09-23-request-envelope/) | 8 implementers, reviewer, 2 verifiers, orchestrator | 86 | 9 | 40 | 18 | 19 |
| [2026-09-24 legal-surface-v2](2026-09-24-legal-surface-v2/) (session 2 only; session 1 lost all but chain-1) | 8 implementers/fix-workers, reviewer, git-cleaner, 2 Sonar workers, orchestrator | ~68 | 11 | 31 | 10 | 16 |

## Recurring themes

"Raised by" counts agents per run. A theme that recurs across runs is where to spend.

| # | Theme | Raised by (run 1) | Verdict mix | Status |
|---|---|---|---|---|
| T1 | **Plans hand decisions and contradictions to implementers.** Examples: task vs spec vs rules (chain-5: "Not now goes home" vs "keep the prompt"); spec clause vs scope rule (chain-1: "every log line"); precedent depends on a frozen file (chain-3: WhimTone needs `package.json`); tasks that don't match the code (chain-4); a chain written against a log line that doesn't exist (chain-1b); a missing cross-chain contract (orchestrator) | 6 | DRAWBACK; largest single cost (~15 min of deliberation each) | open |
| T2 | **The "cd first, one command at a time" rule is unworkable and unenforced.** Bash cwd resets every call; everyone chained `cd <wt> && …`; an `npx eslint` from the primary tree silently linted nothing (chain-3) | 7 | DRAWBACK / NEUTRAL | open |
| T3 | **Test directories aren't typechecked** (`src/host/*/test`, `checks/test`, `evals/test` excluded). Stale fixtures fail only at runtime or never; the reviewer found 13 errors past 7 green regates; the fix chain's own new tests were never typechecked either | 5 | DRAWBACK | #79 |
| T4 | **Worktree provisioning is manual and leaky.** `@whim/*` resolves to the primary tree without hand-made symlinks; Gradle needs `../node_modules`; Metro can't bundle from `.claude/worktrees/`, so device tasks can't finish in-chain; codegen writes into the primary `node_modules` | 3 | DRAWBACK / ENV | open |
| T5 | **Hand-written recipes in prompts were wrong:** `assembleRelease` needs upload keys; `simctl --console-pty` hides RN logs; macOS has no `timeout` | 3 | DRAWBACK / ENV | open |
| T6 | **Red-checks have no tooling and leave no evidence.** Implementers hand-roll working-tree backups; the ledger records counts, not variants and failing test names, so the reviewer can't verify them; an inverse `sed` that fails to match silently leaves a mutation in the tree | 5 | NEUTRAL / DRAWBACK; once CAUGHT (chain-1b's own test) | open |
| T7 | **One shared main tree and scratchpad.** Reviewer, verifier, gate-full, merges and the ledger compete; the reviewer ran `rm -rf` in a shared scratchpad | 2 | DRAWBACK (risk) | #74 (related) |
| T8 | **Integrity and ticking are ceremony.** No per-chain file scopes, so integrity can't see scope creep or test weakening (a `=== 1` → `> 0` got through); tasks are ticked at merge, not on acceptance (5.3) | 2 | NEUTRAL / DRAWBACK | open |
| T9 | **Lint rules at a hard edge.** Cognitive complexity 15 in `renderScreenContent` (every new screen needs a shuffle); a comparator demanded on a two-element sort | 2 | DRAWBACK | open |
| T10 | **Test-harness limits.** No single-suite mode in the server or launcher runners (~2900 / ~10k checks per iteration; chain-7a built a scratch runner); `native-host` `Platform.select` always picks iOS; launcher output prints log lines under the wrong test | 4 | DRAWBACK | open |
| T11 | **Conflicting instructions.** An injected co-author reminder vs CLAUDE.md and the chain block (one agent committed it, then amended it out); a stale git-status snapshot in a subagent's context | 4 | DRAWBACK | open |
| T13 | **Strict file ownership orphans cross-cutting follow-ups.** A fix makes a handoff line stale but `openspec/` is out of scope; a real-producer fixture needs a builder in another chain's files; an allowlist lives in `server/` while the chain owns `src/` | 3 | DRAWBACK | open |
| T12 | Shell quirks: zsh `nomatch` on `--include=*.ts`; tool output size limits | 7 | ENV | put in env facts |

Run 2 (legal-surface-v2) reinforced T2 (all agents), T3 (#79), T4 (native builds only in the main tree; 9b), T6, T10, T11 (co-author reminder, 5 agents) and T13, and added:
- **T14 Cross-change interactions nobody tests.** lsv2's log-age cap truncates a file devobs's Ops Agent tails; found only when a human-style re-apply read both diffs.
- **T15 Environment drift inside the gate.** Node/ICU version changes a static scan's verdict (#87); a full `node_modules` symlink changes `prod-build.suite` (9b).
- **T16 Deferred work falls through.** A paragraph deferred by chain-7 "until age signals ship" was never assigned to chain-9 (reviewer H1).

## What caught real mistakes (keep these)

| Mechanism | Catch | Run |
|---|---|---|
| Per-chain self-gate (typecheck) | A plan error: a closed enum split from its exhaustive consumer (`REFUSAL_RULES`), caught on the first gate run | 1 |
| Lint (`no-shadow`, `sonarjs/no-unused-collection`, logging discipline) | Shadowed logger, leftover collection, silently swallowed error | 1 |
| Cross-workspace tripwire (`web-site.suite` consent-key parity) | A `consent*` copy key that privacy.html would have had to quote | 1 |
| Red-check against a weaker variant | A drain-order bug hiding 2 of 3 log lines in chain-1b's own new test | 1 |
| Self-gate suite run | A wrong expected order of model calls in chain-7a's own new rewrite test | 1 |
| Implementer honesty rule | chain-1 reported its unmet spec clause instead of papering over it, which became chain-1b | 1 |
| Final reviewer | Rollback-to-old-image smoke failure (would have hit the next deploy), weakened test, duplicate log key, 13 hidden type errors, a ticked-but-unmet task | 1 |
| Handoff contracts | No NEUTRAL entry reported a question back to a producer chain; every later chain started from the contract alone | 1 |

## Proposals, ranked by evidence

1. **Plan-quality gate before dispatch (T1).**
   - Resolve every spec/task tension in the chain block instead of delegating it.
   - Mark cross-cutting clauses in scope or deferred.
   - Put a closed-union change and all its exhaustive consumers in one chain.
   - Lint that every `reads` handoff has a producer.
   - Grep-verify claims handed to later chains.
   - Check that "follow X exactly" doesn't depend on a frozen file.
2. **`scripts/worktree.sh create|run|remove` (T2, T4).**
   - `create`: add the worktree, mirror `node_modules` with `@whim/*` pointed at the worktree, build, write the owner file.
   - `run <cmd>`: run one command with cwd in the worktree, replacing the one-command rule.
   - Default device tasks to a post-merge main-tree verifier.
3. **Typecheck test directories in `gate.sh` (T3, #79).**
4. **Red-check helper and evidence (T6).** Snapshot the working tree (not HEAD), mutate, run, restore. Reports list each variant and the test that failed by name, and the ledger keeps them.
5. **Recipes live in scripts or docs, not prompts (T5).** Examples: `android:offline-apk`, `ios:sim-log <marker>`, and a no-`timeout` note in the environment facts.
6. **Integrity with real scopes, or retire it (T8).** Derive per-chain file scopes from chains.md, flag assertion-count drops in touched tests, and tick tasks only on acceptance evidence.
7. **Reviewer isolation (T7).** Give the reviewer a read-only worktree of the tip and a per-agent scratch subdirectory.
8. **Ownership escape hatch (T13).** A chain block lists the handoff lines its fixes make stale and who updates them (default: the dispatcher at merge), and names any producer extraction in another chain's files.
9. **Small fixes (T9–T11).**
   - Put "no Co-Authored-By" in the commit step.
   - `native-host` honours `Platform.OS`.
   - Add a single-suite mode to the server, launcher and checks runners (`-- <suite>` / `--only <pattern>`).
   - Refactor `renderScreenContent` to a kind→renderer map.
   - Make log-capture reject duplicate JSON keys.
   - Add a rollback-compat smoke case.
