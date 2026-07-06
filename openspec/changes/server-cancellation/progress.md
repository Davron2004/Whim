# Dispatch progress: server-cancellation

Base commit (recorded at dispatch start): `f2669c04f878c6656f6aa0effd75f8c7739e31d9`
Dispatcher: main thread. Implementers: `implementer` subagents, one per chain.

Chains (from chains.md):
- chain-1: cancellation plumbing — tasks 1.1–1.5. writes-contract: none.
- chain-2: OpenRouter wrapper hooks + batch validation — tasks 2.1, 2.2, 2.3, 3.1, 3.2. writes-contract: none.

---

## Log

### chain-1 — cancellation plumbing — COMPLETE (2026-07-03)
- STATUS: complete · GATE: PASS (`npm run server:test` → 134 passed / 0 failed, exit 0; `npm run lint` exit 0)
- Tasks done: 1.1, 1.2, 1.3, 1.4, 1.5 (all checked in tasks.md)
- Deviations: none
- Contract written: none (writes-contract: none)
- Files: `server/src/pipeline.ts`, `server/src/sse.ts`, `server/src/routes/generate.ts`, `contract/src/index.ts` (doc comment only), `server/test/server-core.suite.ts`, `server/test/metering.suite.ts`
- Key shape decisions carried out: `Pipeline.run(request, signal?)` optional `AbortSignal`; signal-aware `delay()` (clears timer, never rejects) + pre-yield abort check → early return, no terminal event; `buildSseStream` gained third param `onCancel?: () => void`; route owns one `AbortController` wired to both `cancel()` and `c.req.raw.signal` (idempotent).
- Non-vacuity: new `testSseCancelAbortsPipeline` uses the real stub pipeline + counting wrapper + instrumented timers; verified it fails against both a compile-error revert and a signature-only (ignore-signal) variant — the event-count assertions are load-bearing (timer-dangling assertion alone is near-vacuous because `for await` break → `.return()` clears timers).

### chain-2 — OpenRouter wrapper hooks + batch validation — COMPLETE (2026-07-03)
- STATUS: complete · GATE: PASS
  - `npm run server:test` → 138 passed / 0 failed
  - `./scripts/gate.sh` → FAST GATE PASSED (incl. scaffolding tripwires)
  - `openspec validate server-cancellation --strict` → "Change 'server-cancellation' is valid"
- Tasks done: 2.1, 2.2, 2.3, 3.1, 3.2 (all checked in tasks.md)
- Deviations: none
- Contract written: none (writes-contract: none)
- Files: `server/src/openrouter.ts`, `server/test/openrouter.suite.ts`
- Shape decisions carried out (D6, additive): `StreamResult` gained `id: Promise<string | undefined>`; `OpenRouterOptions` gained optional `signal?: AbortSignal` forwarded into `fetchFn` request-init; wrapper stays unmounted (no route imports it).

---

## Closing summary (2026-07-03)

- **Chains run:** 2 (chain-1 cancellation plumbing, chain-2 wrapper hooks + validation). **Redispatches:** 0. **Contracts written:** 0 (neither chain declared one; the chains are independent and share no files).
- **Deviations by class:** none (no class-A / class-B / class-C reported by either implementer). No tripwire candidates.
- **Dispatcher gate (full tree, step 7):** `./scripts/gate.sh` → `FAST GATE PASSED`, 138 passed / 0 failed. Independent of the implementers' own runs.
- **Reviewer verdict (full diff vs `f2669c0`):** **approve.** Report honesty: matches diff. Spec conformance: conforms. All 5 implementer claims verified against code (not prose), including a hand-trace of generator/`AbortSignal` semantics confirming the pipeline-abort test is genuinely non-vacuous.
- **Non-blocking residuals surfaced by the reviewer (NOT fixed here — out of scope / pre-existing):**
  1. `routes/generate.ts` — the `c.req.raw.signal` abort surface is wired but only the SSE `cancel()` surface is driven by the deterministic suites. Candidly disclosed in design.md as deferred to a manual LAN check when #11 goes live; consistent with Non-Goals, not a coverage regression.
  2. `server/src/openrouter.ts` (~L218-222) — the `if (!body) { throw }` early-exit path throws without rejecting `usagePromise`, leaving it permanently pending. **Pre-existing** (the throw predates this diff; this change only added a `captureId(undefined)` call on that path). Harmless while the wrapper is unmounted; **worth cleaning up in #11** when a route first awaits `usage`.

**Change status: ready.** Both delta specs satisfied, gate green on the full tree, reviewer approved. Ready for a human skim of this file + proposal.md before archive/merge.

---

## Post-review polish (2026-07-03, user-directed — AFTER the reviewer approval above)

Three cleanups the reviewer surfaced as non-blocking residuals, folded into this change's files at the user's request. These ride on server-cancellation's own diff (same files), so they are logged here rather than split into a separate change.

1. **res2 — null-body throw path now rejects the usage promise** (`server/src/openrouter.ts`). The reviewer flagged the inline `if (!body)` throw as a possible pending-`usage` hang. On inspection the branch is **unreachable at runtime**: `responseError()` already returns a network error for a null body (`openrouter.ts:105`) and the `validationError` path rejects+throws before this guard. The inline `if (!body)` survives only to narrow `body` to non-null for the read loop. Fix made anyway for uniformity: it now rejects `usagePromise` before throwing, matching every sibling error path, so it degrades safely if `responseError`'s guard is ever weakened. **Correction to the earlier characterization:** this is defensive-consistency, NOT a live-bug fix — no reachable hang existed.
2. **SRV-2 leftover dedup** (`server/src/openrouter.ts`). The critic's "~25-line duplicate parse block" was already mostly consolidated into `parseSseLine`; what remained was a 3-line `captureId/usage/content` triad duplicated between the per-line loop and the trailing-buffer flush. Extracted into a nested `emitFrame(rawLine)` generator both sites delegate to via `yield*` — single source of truth, verified behavior-preserving by the unchanged `flush: trailing no-newline final delta is not dropped` test.
3. **res1 documentation** (`server/src/routes/generate.ts` comment + `docs/v1-roadmap.md` #11 carryover). The `Request.signal` cancellation surface is wired but not deterministically tested (only `cancel()` is); its real-TCP-disconnect behavior rests on `@hono/node-server` and is a #11 LAN-acceptance item. Documented at the wiring site and as a #11 carryover note (which also reminds #11 to wire the `GET /api/v1/generation?id=` reconciliation poller using the captured `StreamResult.id`).

New test: `null body: usage promise rejects, does not hang` (+ two companion checks) in `server/test/openrouter.suite.ts` — locks the reachable null-body invariant with a race-based hang-guard so a future regression fails cleanly instead of hanging the suite. Note: res2's *inline* branch is unreachable so it cannot be exercised directly from the public API; the test locks the reachable `responseError` path.

**Gate after polish:** `./scripts/gate.sh` → `FAST GATE PASSED`, `npm run server:test` → 141 passed / 0 failed (was 138; +3 null-body checks). `gate-full` (knip / openspec validate / Chromium invariants) NOT re-run — nothing touched affects those surfaces (exports unchanged, no spec edits, no runtime/web/sdk/storage/bridge/launcher files). Reviewer approval above predates this polish; the additions are mechanical (a behavior-preserving refactor + a defensive-consistency edit in unreachable code + docs) and gate-verified.
