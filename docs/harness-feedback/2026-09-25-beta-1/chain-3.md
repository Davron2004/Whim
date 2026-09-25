# chain-3 (server-generation-quality), implementer, Opus. Third dispatch: two Sonnet dispatches stalled at the 600 s watchdog with nothing written (low-priority capacity; see orchestrator.md)

- **What:** Every red-check, and every green re-run after an edit, ran the whole server suite (about 90 s, roughly 4100 checks) because the runner has no way to run one suite.
  **Mechanism:** tooling (`server/test/run.mjs`) · **Verdict:** DRAWBACK · **Cost:** about 13 full runs, about 20 min of wall time · **Evidence:** red-a/red-b/red-c/red-policy logs in my scratchpad, each a full 4050+ check run
- **What:** I hand-rolled each red-check: a copy of the file in the scratchpad, a `sed` mutation, then a restore, checking with `grep -c red-check` that nothing was left behind.
  **Mechanism:** runbook rule (red-check), no tooling (T6) · **Verdict:** NEUTRAL · **Cost:** about 12 tool calls · **Evidence:** `cp …/machine.ts.bak`, `sed -i '' "s/…/…/"`
- **What:** Decision 5 said to replace "the old declined-retry comment at machine.ts:217". That comment is about re-running an unverified candidate (D3), not a model-turn retry, so I had to decide how to reword it.
  **Mechanism:** chain block · **Verdict:** DRAWBACK (T1) · **Cost:** about 3 min · **Evidence:** BASE machine.ts:214-217, the `UNVERIFIED_RUN_REASON` doc comment
- **What:** `node node_modules/typescript/bin/tsc` fails in the worktree because that path doesn't exist there; `npx tsc` works.
  **Mechanism:** worktree provisioning (T4) · **Verdict:** ENV · **Cost:** 1 call · **Evidence:** `Cannot find module '…/beta-1-3/node_modules/typescript/bin/tsc'`
- **What:** I chained `cd <wt> && …` and `git add && git commit`, as the dispatcher's message said to. Nothing blocked it.
  **Mechanism:** runbook rule "one command at a time" (T2) · **Verdict:** NEUTRAL · **Cost:** 0 · **Evidence:** every commit call
- **What:** The Edit tool warned "file modified on disk since you last read it" after my own Python-heredoc edits.
  **Mechanism:** tooling · **Verdict:** NEUTRAL · **Cost:** 0 · **Evidence:** notes after the machine.ts, prompts/index.ts and wire-v2.suite.ts edits
- **What:** Lint flagged `sonarjs/no-nested-assignment` on `(trace.x ??= []).push(id)`.
  **Mechanism:** lint config · **Verdict:** NEUTRAL · **Cost:** 2 calls · **Evidence:** machine.ts:350

What helped:
- Decisions 1–9 in the chain block were already made and precise. Only one of them (D5) needed interpretation.
- The contract's call-site rule and level-1 registry made `restart` and `limit` straightforward to add.
- `resolveRequestUsage` already accepted a set of credited ids, so metering the failed attempt needed no resolver change.
- `ScriptedModelClient`, `statsTransport`, `RecordingUsageStore`, `captureLogs` and `fakeReport`/`stubRunCandidate` covered every test I needed.
- `gh issue view 106` gave the exact wording users saw.

What the harness should change:
1. Add a way to run one suite in `server:test` (for example `SERVER_SUITE=machine,wire-v2`). Red-checks would then take seconds instead of 90 s each.
2. Add a red-check helper that applies a named mutation, runs the suite, records the failing test names in the ledger and always restores the file (T6).
3. When a chain block refers to a code comment or line, it should quote the text, not only give a line number. Line numbers drift, and this one pointed to a comment that meant something else.
