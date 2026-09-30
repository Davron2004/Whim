# reviewer, scoped review of eed78401..35704928 (fix-2..fix-7b), Opus

1. **What:** fix-4 and fix-5 ran in parallel and both edited `src/host/launcher/test/flow-messages-ui.suite.tsx`. **Mechanism:** the dispatch blocks' "NOT" lists fence source files only. **Verdict:** NEUTRAL (the merge was clean because the hunks happened not to overlap). **Cost:** none this time. **Evidence:** `785114f6`, `514e7276`.
2. **What:** the review range was given as `eed78401..integration/beta-1`, and the branch advanced four commits mid-review. **Mechanism:** a branch name instead of a pinned SHA. **Verdict:** DRAWBACK (worked only because I noticed HEAD ≠ `35704928`). **Cost:** one extra check. **Evidence:** `fad90c87..4affe058` (docs only).
3. **What:** the lockstep corpus uses the contract as oracle but runs on a single unknown type. **Mechanism:** the contract as oracle. **Verdict:** CAUGHT-REAL-MISTAKE for `notice: null`; blind for `compat: null` (L1). **Cost:** L1. **Evidence:** `wire-future-frames.suite.ts:299`.
4. **What:** a chain that died at the usage limit (fix-4) was rescued by committing its WIP and redispatching. **Mechanism:** orchestrator WIP commit plus redispatch. **Verdict:** NEUTRAL (worked; gated green afterwards). **Cost:** an ungated "gate not run" commit on the staging branch until `/git-cleanup` regroups it. **Evidence:** `785114f6`.
5. **What:** the reviewer was allowed to run `gate.sh`, but a background app build owned the tree. **Mechanism:** reviewer and background build sharing the primary tree. **Verdict:** DRAWBACK. **Cost:** one fewer independent gate run. **Evidence:** live `gradle` and `xcodebuild` processes.

Proposals:
1. Wire corpus tests run every value on both a known and an unknown type, each with its own expected outcome; fold oldest-reader tolerance R-decisions into the spec delta before archive.
2. Pin reviewer briefs to a SHA range and say whether the tree is safe to build in; before merging the second of two parallel chains, check both chains' diffs for file overlap, test files included.
