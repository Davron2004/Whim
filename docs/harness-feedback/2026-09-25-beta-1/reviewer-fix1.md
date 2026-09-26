# reviewer, scoped re-check of fix-1 (eed78401), Sonnet

- **What:** A scoped re-review subagent was asked to re-check a fix-1 chain merge against 9 named findings (M1/M2abc/L1-L4/L5ab), with instructions to run the actual suites and a red-check on the highest-risk fix (M1) rather than trust the implementer's self-report.
  **Mechanism:** Reading the diff line-by-line against each finding's exact wording (e.g. M2(a)'s "a present but wrongly typed value still fails the guard" — this is a specific, checkable clause that a lazier review would gloss as "defaults added, done") and mechanically reverting the M1 try/finally to confirm the claimed "10 checks fail" red-check count independently, rather than accepting the implementer's self-reported number.
  **Verdict:** NEUTRAL — nothing wrong was found this round; the fix-1 chain's own self-report (Opus) held up under independent re-execution of every suite and one destructive local revert.
  **Cost:** ~1 read-only pass, 4 test-suite runs (server:test, launcher:test, server:e2e, gate.sh) plus one local revert/restore cycle on `generation-client.ts`, restored to a byte-identical file.
  **Evidence:** `src/host/launcher/generation-client.ts:699-724`, `src/host/launcher/test/wire-future-frames.suite.ts:279-309`, `server/src/routes/generate.ts:415-451`, `server/test/routes-generate.suite.ts:792-816`, `server/test/wire-level.suite.ts:126-186`.

Proposals:
1. Keep the "revert the fix, count failing assertions, compare to the implementer's claimed count" step as standing for any finding whose fix is "wrap X in try/finally": that shape silently regresses on a later refactor (an early `return` inside the try before `ended = true`).
2. Chains that change an exported middleware's signature should keep flagging the contract-doc update as load-bearing evidence that every caller moved together.
