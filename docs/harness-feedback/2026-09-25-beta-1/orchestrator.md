# Orchestrator (beta-1 apply run, 2026-09-25 → 26)

Opus 5.5, main thread. 9 chains, 16 fix chains, 2 whole-change reviews, 2 scoped reviews, 6 device passes,
2 investigations. Two usage-limit pauses, one low-priority window.

## Blocks, stops, detours

- **What:** Sonnet subagents stalled at the 600 s watchdog twice in a row while the session ran at low-priority
  capacity; Opus agents in the same window didn't. **Mechanism:** tooling (capacity scheduling). **Verdict:** ENV.
  **Cost:** ~25 min and 2 wasted dispatches. **Evidence:** progress.md R9; a `/feedback` draft for Anthropic.
- **What:** five agents died at usage limits (chain-2, fix-4, fix-5b, fix-11, the iOS re-verification). The
  harness has no rescue path, so each time I committed the dead agent's worktree as WIP by hand and redispatched
  "continue from WIP". **Mechanism:** runbook (none for this). **Verdict:** DRAWBACK. **Cost:** ~15 min each, plus
  one merge (fix-11) with no implementer report, red-check record or device checklist (reviewer L5).
  **Evidence:** progress.md WIP entries (`6eb0e3d3`, `87f73ae0`).
- **What:** my chain blocks carried wrong premises again and again (theme T1): one native promise asked to carry
  two JS deadlines (chain-5); stub "facts" true at HEAD but false at the 382511 commit (chain-9); a relational
  rule (synthrun ≤ vCPU) that a grep for the literal number can't find (fix-3); two items that were spec-mandated
  behaviour, not bugs (fix-5 6a/O); a Maestro diagnosis read off a screenshot instead of the log (fix-8b).
  **Mechanism:** chain block. **Verdict:** DRAWBACK (each cost a class-B stop or a device rerun) and
  CAUGHT-REAL-MISTAKE (the implementers caught every one). **Cost:** ~5 class-B stops, 2 extra device runs.
- **What:** I accepted a model-driven feature on one sample per prompt ("4/4 limits"). The iOS device pass
  contradicted it, and an investigation measured the real rate (~27 %). **Mechanism:** acceptance step.
  **Verdict:** CAUGHT-REAL-MISTAKE (by the device pass, not by any gate). **Cost:** a wrong claim in the ledger for
  ~10 h, one investigation, one fix chain (fix-6). **Evidence:** progress.md "Correction to 10.3".
- **What:** a merge conflict came from my own `git add -A openspec/changes/beta-1`, which swept in an agent's
  untracked evidence file. A `| tail` pipe then hid the merge's exit code, so a gate ran on a conflicted tree.
  **Mechanism:** my shell usage; the runbook's merge step has no guard. **Verdict:** DRAWBACK (self-inflicted).
  **Cost:** ~10 min. **Evidence:** progress.md fix-8 merge entry.
- **What:** IDE diagnostics for stale or misconfigured TypeScript projects were injected after nearly every tool
  call: thousands of lines of "Cannot find module" and "implicitly any" from removed worktrees and an IntelliJ
  config that doesn't match the repo's tsconfig. **Mechanism:** tooling (the IDE bridge). **Verdict:** DRAWBACK.
  **Cost:** a large share of my context over the run, and three false-alarm checks (all dismissed by the real
  `tsc`). **Evidence:** every "new-diagnostics" block in the session.
- **What:** device acceptance on real emulators and simulators found the problems that mattered most, and no gate
  could: the keyboard on both platforms (R10), the limit rate, the stub's stale app source, an Android-15
  edge-to-edge regression, and six upgrade-check flow bugs. **Mechanism:** section 10, done by subagents.
  **Verdict:** CAUGHT-REAL-MISTAKE (many). **Cost:** ~6 device passes at 30–60 min each.
- **What:** the reviewers caught real defects every time: M1 (a fallback never aborting the request), M2 (a rollback
  stranding beta-1), a blind `compat: null` lockstep, sheet accessibility, a spec contradicting History's back.
  **Mechanism:** reviewer passes. **Verdict:** CAUGHT-REAL-MISTAKE. **Cost:** 4 passes, ~15–20 min each.
- **What:** launcher test files are not typechecked by the gate (#79), so every chain rebuilt a scratch tsconfig
  and hand-diffed a base run. `server:test` has no single-suite filter, so every chain wrote a scratch runner.
  **Mechanism:** gate/tooling (themes T3, T10). **Verdict:** DRAWBACK. **Cost:** ~5–15 min per chain × ~20.
- **What:** instructions conflict. CLAUDE.md still describes the retired protected-file system; implementer.md says
  "one command at a time" while dispatch blocks say `cd <wt> && cmd`; a system reminder asks for a co-author trailer
  that the owner's CLAUDE.md forbids. **Mechanism:** runbook/docs (T2, T11). **Verdict:** DRAWBACK. **Cost:**
  small each time, but every agent paused on it.
- **What:** file-scope fences in parallel dispatches cover source files but not test files; fix-4 and fix-5 both
  edited `flow-messages-ui.suite.tsx` and merged cleanly only by luck. **Mechanism:** chain block. **Verdict:**
  NEUTRAL (no cost this time).

## What helped

- **Pre-written dispatch blocks as files** (`openspec/changes/beta-1/dispatch/*.md`). Every usage-limit death was
  resumable from a file, not from my context, and parallel dispatch was quick once capacity allowed it.
- **The ledger and handoff** kept the run resumable across two usage pauses with no lost decision.
- **Decisions resolved in the block** (the R-numbered ones) produced implementer reports with few questions.
- **The contract as the oracle** for device-side tests (lockstep corpus, fixtures from real producers) made the
  oldest-reader work checkable.

## What the harness should change

1. **A rescue step for dead agents:** `fixloop.sh rescue <chain>` commits the worktree as WIP with a
   standard message, records it in the ledger, and prints a resume prompt; the merge then requires a
   "rescue red-check" (each new test run against its commit's parent) before it counts.
2. **Stochastic acceptance is a rate:** any acceptance step on a model-driven behaviour states N and a threshold
   (e.g. ≥ 9/10 per case), and flowbench's `--repeat`/`--stop-after` is the tool.
3. **Device passes are standard, scripted section-10 steps:** keep Maestro keyboard and limit flows under
   `scripts/release/`, add a stub marker that throws at runtime, and an `apk-swap` helper so chains can check a
   JS change on a device without the main tree.
4. **Fix #79 and add `--only <suite>`** to the server and launcher runners (protected config, so a human bootstrap).
5. **A merge wrapper** (`fixloop.sh merge`) that checks the exit code, refuses a conflicted tree, and never lets a
   gate run on one.
6. **Refresh CLAUDE.md and implementer.md** to match reality (protected files retired, `cd && cmd` allowed), and
   turn off, or fix the project config for, the IDE diagnostic injection.
