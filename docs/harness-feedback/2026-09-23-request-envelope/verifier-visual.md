# verifier-visual: harness feedback, request-envelope 2026-09-23

## Blocks, stops and detours
- **What:** `timeout` command not found on macOS while polling a background Gradle build.
- **Mechanism:** build recipes / instructions given (assumed GNU coreutils `timeout`).
- **Verdict:** ENV
- **Cost:** ~1 tool call (immediately fell back to a bounded `for`+`sleep` poll loop).
- **Evidence:** `(eval):1: command not found: timeout`.

- **What:** No iOS tap tool (`idb`) present, so the two iOS button-tap screenshots (Update Whim / Not now) could not be captured.
- **Mechanism:** missing tapper.
- **Verdict:** ENV
- **Cost:** 0 extra tool calls — instructions explicitly pre-authorized skipping this if `idb` was absent, so it was a clean, documented skip, not a stall.
- **Evidence:** `which idb` → `idb not found`.

- **What:** The pre-task system-reminder snapshot showed a dirty `git status` (`M openspec/changes/request-envelope/progress.md`), which conflicted with the task's stated precondition of a clean tree.
- **Mechanism:** instructions given (stale git-status snapshot passed in context).
- **Verdict:** DRAWBACK (cost with no catch)
- **Cost:** ~2 tool calls to re-verify actual git state before proceeding, which turned out clean all along.
- **Evidence:** `git status --porcelain` and `git diff` both empty when re-checked, despite the reminder claiming a modified file.

## What the harness should change
- Don't inject a git-status snapshot into a subagent's context when its freshness isn't guaranteed; either omit it or label it with a timestamp/staleness caveat so the agent doesn't have to spend calls re-deriving ground truth it was told to trust.
