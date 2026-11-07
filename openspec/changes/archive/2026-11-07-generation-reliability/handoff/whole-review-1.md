VERDICT: REJECT

I read the whole range b6a3b2d6..cae360d2 (31 commits). It conforms to the spec deltas, and the per-chain safety properties still hold once the chains are combined. I'm rejecting because of finding 1, and finding 2 needs at least a written decision. The other findings are low.

1. **Med: the breaker can stay open forever, under the wrong name.** `server/src/admission/provider-breaker.ts:108-131` (`onProbeSettled`) re-opens on any probe failure. While the breaker is open, admission refuses every call, so only the probe can close it.
   - If the probe fails for a reason that isn't upstream, it fails every time. Examples: a 402 (credit), a 401 (rotated key), or a 400 if the engineer model rejects `maxTokens: 1` (`:207`). Then every request gets `provider_unavailable` until the process restarts.
   - The credit check comes after the breaker, so `budget_exhausted` and its alert never fire.
   - A re-open logs only `provider probe failed`, never `provider breaker open`, so one email is sent and nothing after it.
   - The probe has only ever run against `ScriptedModelClient`.
   - Done looks like: re-open only when the probe fails upstream (`modelFailureOf(...).upstream`); any other failure closes the breaker and lets admission go on to the credit check. Add a suite case for a 402 probe, and one live `maxTokens: 1` call against the configured engineer model, recorded in the change folder.
2. **Med: an outage of one model never opens the breaker.** `provider-breaker.ts:156-160` resets the count on a completed call from any role. Policy, clarify, rewrite and summary use different models from the engineer.
   - If only the engineer model's provider is down, each flow's policy, clarify and rewrite calls reset the count before plan fails twice (2 failures). The breaker never reaches 4, and every user still waits through two failed plan turns.
   - The design's Risks section lists "any call resets" as a mitigation without weighing this case.
   - Done looks like: count and reset only on calls to `roster.engineer.model`, which is also the model the probe checks. Or record the limitation in design.md Risks and file a parked issue.
3. **Low: early in an outage the user sees the content-check sentence.** A policy check that isn't cached and hits the outage answers `503 policy_unavailable` ("We couldn’t check this request right now"), not `provider_unavailable`. The new e2e test pins this (`server/test/e2e.ts`, around lines 480-505), but neither the proposal nor any delta mentions it. Done looks like: decide which code an upstream policy failure gets, and write that down in a delta scenario.
4. **Low: `machine.ts:760` is broader than design D6.** `endOnThrow` labels any thrown error with `status>=500` or `kind:'network'` as `provider_unavailable`; D6 says only errors from an engineer turn. I found no other code path that throws errors of that shape today. Done looks like: decide origin at `runModelTurn`, for example by tagging the error from the resend.
5. **Low: breaker refusals can't be told apart in logs.** A breaker refusal and a mid-call clarify/rewrite 503 produce the same `request` line (`error: provider_unavailable`, 503). Breaker refusals write no ledger row (same as credit refusals), so `usage` counts only terminal and mid-call failures. Done looks like: a `breaker` field on that line, or a documented query in docs/deploy.md.
6. **Low: one log line isn't in any delta.** `machine.ts:1289` logs `run re-run {phase}`. It carries no content, but no delta describes it; add it to the "logged without content" requirement or remove it.
7. **Low, accepted: the terminal-failures alert also fires on provider outages.** `provider_unavailable` terminals count in `metric-whim-terminal-failures`. design.md Risks accepts the double email. With the breaker at 4, one outage produces at most about 2 terminals, so ">5 per hour" fires only when the breaker is off or many runs are in flight. Acceptable; the docs/deploy.md alert row could say so.
8. **Low: installed level-1 builds still show the contradiction D11 fixes.** They get the provider sentence without `cause`, so they show "It’s not something you did" next to "Change the description". This can't be fixed for level 1 and is fine before release. The smoke test only runs at level 2 (`deploy/lib.sh:29`); the compat path is covered only by the suites.

What checked out:
- **#58:** a module-scope crash goes to repair. A harness fault is re-run once, in the run stage, with no model or breaker involved. Only an observed `true` is ever delivered.
- **#57:** the plan resend is counted by the breaker once per attempt, and a resend that succeeds resets the count.
- **Terminal events and gating:** every path ends in exactly one terminal event. `cause` is stripped for level 1 through the new `fields` gate. Clarify now answers through `c.json`, so its errors are gated by protocol level.
- **Ledger and imports:** the ledger's code set is still closed. The device imports `FailureCause` as a type only, so nothing new reaches Metro.
- **Untouched and clean:** nothing changed in `invariants/` or the generated files. There are no attribution lines and no `Check-removal` trailers. The env vars reach both deploy scripts, `lib.sh` and the docs.

REPORT HONESTY: matches diff. progress.md, tasks.md (all ticked) and the chain reports match the commits.
SPEC CONFORMANCE: conforms, with the gaps in findings 3 and 6.

Deploy note:
- **Server deploy alone:** covers #58 (repair and re-run), #57 (plan resend), and the server side of #66: the provider sentence on every build, 503s on clarify and rewrite, the breaker, and the alert, which the next deploy applies.
- **App build (level 2) also needed:** for #66 on the phone. That means a `provider_unavailable` refusal landing neutrally on the step that sent it and honouring `Retry-After`, and `cause` making the Failure page lead with retry and drop "Change the description".
- **Order:** server first, then the app build. A level-2 app on the old server is safe, but it gets none of these features.
