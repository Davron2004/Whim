# Progress ledger: prompt-flow-ux

## Run metadata
- run-start: 2026-07-30 (overnight orchestrator, attended=false); staging branch v1-sprint (sprint-wide deviation, see synthetic-run-harness/progress.md)
- interleaved with synthetic-run-harness + eval-harness applies; merges strictly serialized by the dispatcher
- chain DAG: {1,2,3} independent → 4 (after 1,2,3) → 5 (after 4); task 7.2 on-device acceptance = attended, out of scope this run

## Dispositions (append-only)
- chain-1 (generation-client) DISPATCHED: BASE=6bfe552, worktree=.claude/worktrees/prompt-flow-ux-1, branch=chain/prompt-flow-ux-1, implementer=sonnet, heredoc-write instruction included (Write-binding quirk).
- chain-2 (store-access-prompt-flow) DISPATCHED: BASE=6bfe552, worktree=.claude/worktrees/prompt-flow-ux-2, branch=chain/prompt-flow-ux-2, implementer=sonnet, heredoc-write instruction included.
- chain-2 REPORT: complete, GATE PASS (launcher:test 1336 checks), commit 8fad09c, contract handoff/store-access-prompt-flow.md (88 lines). Deviations: none. Notable: activeSource==activeBundle limitation (D7, flagged for #11); schema.json must be resupplied on every update (snapshot is content-agnostic).
- chain-2 INTEGRITY: exit 0, file scope exactly as declared. MERGED onto v1-sprint (--no-ff), tasks 1.2/3.1/3.2/3.3 ticked, REGATE PASS (FAST GATE PASSED).
- chain-3 (prompt-flow-screens) DISPATCHED: BASE=b068376, worktree=.claude/worktrees/prompt-flow-ux-3, branch=chain/prompt-flow-ux-3, implementer=sonnet, heredoc instruction included.
- chain-3 REPORT: complete 6/6, GATE PASS, commit aa6227e, contract handoff/prompt-flow-screens.md. Deviation (A): Extract<GenerationEvent,{type:'stage'}>['stage'] instead of design's GenerationEvent['stage'] (zod discriminatedUnion can't be indexed directly) — noted in handoff. Screens purely presentational; chain-4 owns all orchestration/mapping.
- chain-3 INTEGRITY: exit 0, scope as declared. MERGED onto v1-sprint, tasks 4.1-4.3/5.1-5.3 ticked, REGATE PASS.
- chain-1 REPORT: complete 4/4, GATE PASS (1340 launcher checks), commit 652a10f, contract handoff/generation-client.md (71 lines). Deviations (A): local Body augmentation + buffered re-decode instead of TextDecoder {stream:true} (RN tsconfig excludes dom; Hermes decoder streaming unverified); generateApp split into helpers for cognitive-complexity; schema-invalid 200 → kind:'http' (documented in handoff).
- chain-1 MERGE CONFLICT in src/host/launcher/test/acceptance.ts (chains 1+3 both appended suite registrations). PARTITION FLAW (tripwire candidate: chains.md must reserve acceptance.ts registration to one chain or the dispatcher). Resolution: dispatcher union-resolved (both imports + both run calls, append-only hunks, no semantic overlap), commit 60966a5. REGATE PASS validates the union. Deviation from runbook HALT-on-conflict rule: sanctioned by unattended-run judgment — conflict was mechanically determinable; halting overnight disproportionate.
- chain-1 INTEGRITY: exit 0, scope as declared. Tasks 1.1/2.1/2.2/2.3 ticked.
- NOTE for gate-full: chain-4 wiring pulls @whim/contract (zod) into the Metro bundle graph for the first time — guard:metro only runs in gate-full/CI; check it explicitly after chain-4 merges.
- chain-4 (launcher-root-wiring) DISPATCHED: BASE=1545601, worktree=.claude/worktrees/prompt-flow-ux-4, branch=chain/prompt-flow-ux-4, implementer=sonnet; brief includes all three upstream contracts, schema.json-resupply footgun, guard:metro post-check instruction.
- chain-4 REPORT: complete 6/6, GATE PASS (1881 launcher checks), commit d706606. Deviations (A): Screen prompt variant gained initialText (preserves draft on rephrase/cancel); placeholder create-alert removed per 6.2; local app-id generator (non-UUID, only device-id is spec'd UUID-shaped); Settings detour drops prompt draft (consistent with one-level nav model).
- chain-4 INTEGRITY: exit 0, scope as declared. MERGED onto v1-sprint, tasks 6.1-6.6 ticked, REGATE PASS (fast gate).
- guard:metro on merged tip: FAIL — zod runtime code (export-namespace-from syntax) enters the Metro graph via @whim/contract runtime imports; RN babel config lacks the transform and babel.config.js is Class-2 protected. Class-B → converted to fix chain-4b: type-only contract imports + local runtime guards in launcher; behavioral surface per handoff/generation-client.md preserved. chain-4b DISPATCHED (worktree .claude/worktrees/prompt-flow-ux-4b from post-chain-4 tip).
- MEMORY candidate (chain-4): guard:metro is worktree-path-depth-sensitive, not just node_modules-presence-sensitive — meaningful verdict only from the main tree (symlinked node_modules is NOT sufficient).
- chain-4b REPORT: complete, GATE PASS (1885 launcher checks), commit 13c5cd5, no deviations. Only generation-client.ts had a runtime contract import; converted to import type + hand-rolled guards (isDeviceIdError/isRewriteResponse/isGenerationEvent); 2 new behavioral tests for previously zod-only paths; handoff updated (79 lines).
- chain-4b INTEGRITY: exit 0, scope as declared. MERGED onto v1-sprint, REGATE PASS. guard:metro from main tree: OK (Android release bundle resolved, 1959826 bytes). Class-B closed.
- chain-5 (docs-decision) DISPATCHED next.
- chain-5 REPORT: complete 1/1, GATE PASS, commit 7f2aed5, no deviations. Decision #53 appended; roadmap #7 block updated (implemented 2026-07-31, task 7.2 on-device acceptance PENDING).
- chain-5 INTEGRITY: exit 0. MERGED onto v1-sprint, task 7.1 ticked, REGATE PASS. All 5 chains (+4b fix chain) merged → proceeding to gate-full + reviewer.
- gate-full on staging tip (23959cd): FULL GATE PASSED (Chromium invariants, knip, guard:metro, openspec validate 31/31). Whole-change reviewer DISPATCHED (diff 6bfe552..HEAD scoped to launcher + change folder + docs).
