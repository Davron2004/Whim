VERDICT: ACCEPT. Three low findings below; none blocks the merge.

**Per finding** (range `cae360d2..500567e3`, worktree generation-reliability-fix1):
1. **RESOLVED.** `provider-breaker.ts:134`: a probe that completes or fails non-upstream calls `close(openedAt, failure)`, and the close line carries `errorKind`/`status`. An upstream failure re-opens and logs `provider breaker open` with `reopened: true` (`:139-143`). The tests use real 402/401/400 errors (`provider-breaker.suite.ts:348-370`) and check that the count restarts at zero. `admission.suite` drives a 402 probe through to the credit check. The fixer's red evidence (a mutation that re-opens on any failure fails 4 named tests) is believable. The orchestrator's live call (306 ms) shows `maxTokens: 1` is accepted.
   - **(a) Can it still get stuck?** No. Every way a probe can end now leaves the breaker closed, or open with a fresh cooldown. A timeout is classed `timeout` (upstream, re-open, which is correct). A synchronous throw is `other`, so it closes. The 10 s deadline is enforced. A stale probe defers to the current state.
2. **RESOLVED.** `withProviderBreaker` passes `req.model !== engineerModel` through without recording (`:287`), and `guardModel` passes `roster.engineer.model` (`:261`). The probe uses `roster.engineer.model`, so it checks the same model.
   - **(b)** The rule is the model id, not the role. `plan`/`repair` count only when `WHIM_PLAN_MODEL`/`WHIM_REPAIR_MODEL` are unset (`model.ts:210-211`). Spec delta (`server-admission-control` delta, "every call to the roster's engineer model"), D8 and the code agree. The override case is only in the fixer's notes (low finding 2).
   - Tests: `testFeedIsEngineerOnly` (each engineer failure follows a completed clarify call, and the 4th opens; 6 clarify-model failures never open it; a completed other-model call doesn't close it). The e2e is rewritten to use real plan failures.
3. **RESOLVED.** Behaviour kept, documented in a new scenario in the "Admission checks run in a fixed order" delta and in Risks. Pinned by `routes-unary` `testUpstreamClassifierFailureIsPolicyUnavailable`.
4. **RESOLVED.**
   - **(d)** `machine.ts:868-871` marks the error (a WeakSet) only when it comes from a failed resend (`resends > 0`), not aborted, and upstream. `endOnThrow` reads only that mark (`:772`). All three turns that use this have `retries=1` (`:864`), so nothing is left unmarked.
   - `machine.suite` `testUpstreamShapedThrowOutsideATurnIsInternal`: a 503-shaped throw from the check stage ends with the generic reason, no `cause`, and `internal_error`. This test fails if the old shape check comes back.
5. **RESOLVED.**
   - **(c)** `refusedBy` sits on `ServiceRefusal` next to `body`, not inside it (`refusals.ts:60`). The routes still send `c.json(r.body, …)` and only `c.set('refusedBy')`. `app.ts:261` writes it only to the log line.
   - Grep finds no spread or serialisation of the whole refusal, so the wire body, the ApiError contract and level-1 compat are unchanged. The launcher fixtures send `errorForLevel(refusal.body)` only.
6. **RESOLVED.** Paragraph plus the scenario "A re-run leaves a trace" added. `testRerunThatDeliversIsLogged` already covers it.
7. **RESOLVED.** The `docs/deploy.md` alert row now says outages can fire it. The `deploy-config` filter case is updated for the second open line: same assertion count, still a real check.

**(e)** The MODIFIED blocks keep every live scenario in the same order, with additions only (checked against `openspec/specs/{generation-pipeline,server-admission-control}`). The new `## ADDED` section in server-observability is the only one in that file.

**Attribution:** there are no Co-Authored-By lines, no "Generated with" lines and no `Check-removal` trailers in the 3 commits.

**REPORT HONESTY:** matches the diff, including the honest "live probe NOT RUN" in the report.

**New findings (all low):**
- **L1** `specs/server-admission-control/spec.md` (lazy-probe requirement) lists only `401`/`402`/`400` as closing. The code closes on any failure that isn't upstream, including 404, `other` and a synchronous throw. Done looks like: say "fails for any reason that is not upstream", matching D8 and the code.
- **L2** Nothing in the spec or docs says that plan/repair calls under `WHIM_PLAN_MODEL`/`WHIM_REPAIR_MODEL` overrides aren't counted. Only the fixer's notes mention it. `design.md:125` ("two failed plan turns") assumes plan uses the engineer model. Done looks like: one Risks line in design.md, plus a note in `docs/deploy.md` (the roster table or the breaker alert row).
- **L3** `handoff/probe-live.md` still says "STATUS: NOT RUN" and contains a session scratchpad path, which shouldn't be in a committed file (`:90`). The real result is only in the uncommitted `progress.md`. Done looks like: write the orchestrator's live result into `probe-live.md` and drop the scratchpad path.

**SPEC CONFORMANCE:** conforms; the only gaps are L1 and L2.
