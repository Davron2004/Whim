# progress — harden-synthrun-binding-isolation

Ledger. Appended as it happens, never batched.

## Run parameters (deviations from the standard runbook, recorded up front)

- **Base branch is `redesign`, not `main`** — explicit user instruction ("get the pr to merge this to
  redesign green"). `main` is an ancestor of `redesign` (verified), so this is a fast-forward-compatible
  topic base, not a fork.
- **Unattended run.** The user went to sleep mid-run with "harness is off on you… judge for yourself".
  Consequences, each decided rather than asked:
  - `chains.md` ships without the human's quick OK (runbook step 1). Partition rationale is recorded in
    this ledger instead, so it is auditable after the fact.
  - Closure (step 12) is normally attended-only. It is run here because the user asked for a green PR
    while asleep. `gh pr merge` is denied for all callers, so the ratification click is still the
    human's — the "don't merge" constraint holds by construction, not by my restraint.
  - Anything irreversible, ambiguous, or requiring a Class-2 ratification is PARKED with a reason,
    never self-approved.
- **Change was BLOCKED at dispatch time.** `openspec status` reported `state: blocked`, missing
  `research`, `design`, `tasks`, `chains` — only `proposal.md` + the `synthetic-run` spec delta existed.
  The runbook says to bounce this to `/opsx:propose`. Judgment call: the proposal is complete and its
  spec delta is written, and the proposal itself specifies the research phase it needs. So the planning
  phase is run here rather than bounced, in the same order `/opsx:propose` would: research → design →
  tasks → chains.

## Ledger

- `run-start` — staging branch `integration/harden-synthrun-binding-isolation` cut from
  `redesign` @ `b4d0724d326527b1a72856865f078f2874474d64`. `main` @ `795c8bda` is an ancestor.
  Primary tree clean; no other `integration/*` branch active; `scripts/gate.sh`, `scripts/gate-full.sh`,
  `scripts/fixloop.sh` present and committed clean. Playwright pinned at 1.60.0.
- `research-dispatched` — two read-only `researcher` subagents, disjoint jurisdictions:
  (R1) Playwright 1.60.0 binding internals from `node_modules` source — anatomy of `exposeFunction`,
  host-side frame provenance on `Runtime.bindingCalled`, whether a JS-level scrub is durable, and what
  main-frame-only alternatives the pinned version actually offers;
  (R2) `synthrun/` code shape — relay path, `recordProbesOutcome` last-writer-wins, `whimHostDispatch`
  context-level exposure, the quarantined acceptance test, suite/gate wiring, file-scope inventory.
- `baseline-gate-pass` — `./scripts/gate.sh` exit 0 on the staging tip before any chain ran. Establishes
  that a later red is attributable to a chain rather than inherited. (Notable: the CI workflow
  `.github/workflows/invariants.yml` runs server/storage/bridge/launcher/checks suites + the two Chromium
  invariant suites, but does NOT appear to run `synthrun:test`. If confirmed, "green PR" does not by
  itself exercise this fix in CI — see the CI-coverage decision recorded below.)
- `research-complete` — both digests in. All three of the proposal's declared unknowns are answered, and
  the answer overturns the proposal's own leading hypothesis:
  - **Scrubbing more names cannot work, in principle.** Playwright calls `Runtime.addBinding` with
    `{name}` only and never uses the protocol's context-scoping params, so the raw binding lands on every
    execution context including the srcdoc realm. There is no configuration that scopes it.
  - **The provenance was there all along and was being thrown away.** CDP delivers `executionContextId`
    on every `bindingCalled`; Playwright resolves it to the owning frame from browser-supplied `auxData`
    and passes `{frame,page,context}` to the callback. `exposeFunction` discards that argument
    (`coreBundle.js:57483`); `exposeBinding` keeps it. Frame identity is browser-derived, so it is
    unforgeable from the sandbox.
  - **`whimHostDispatch`'s context-level exposure has no recorded rationale** and its only legitimate
    caller is the outer page's main frame.
- `planning-artifacts-written` — research.md, design.md, tasks.md, chains.md. `openspec validate --strict`
  passes. Judgment calls made without the human, each argued in design.md:
  - **D1 mechanism**: `exposeBinding` + `source.frame !== page.mainFrame()`, rejecting raw-CDP
    `executionContextId` (protocol-deprecated, crbug.com/1169639) as more fragile for the same guarantee.
  - **"Unreachable as a capability"** is delivered as *inert*, not literally absent — calls are
    attributable, refused before effect, and recorded. Literal unreachability is impossible (see above).
    The delta spec's three scenarios are satisfied verbatim, so **no spec amendment was needed**.
  - **D3 verdict rule is fail-closed monotonic**, not first-write-wins: `false → true` refused,
    `true → false` still accepted. Chosen because the dangerous direction is the one that ships an unsafe
    app, and because first-write-wins would render the existing negative control at
    `acceptance.ts:704-707` vacuous. (R2 flagged that assertion as colliding with the new rule; on
    inspection it does not — it transitions from a malformed/`null` verdict, and would be legal even
    from `true`.)
  - **D6 CI gap NOT closed.** `.github/workflows/` is unprotected and absent from `gate.sh`'s
    `CONFIG_SET`, so adding `synthrun:test` to CI was mechanically available. Declined: it makes a
    real-Chromium suite with a recent flake history (`chain-9 fix-sourcemap-anchor-flake`) a blocking
    gate on every future PR — outward-facing, never asked for, and not a call to make unattended.
    Verification comes from `gate-full.sh` locally instead; the gap is surfaced in the PR body.
- `chains-planned` — 2 chains, strictly serial, file-disjoint. chain-1 `host-frame-provenance`
  (`synthrun/observe.ts`, `synthrun/capability.ts`); chain-2 `capability-reachability-acceptance`
  (`synthrun/test/acceptance.ts`, `after: chain-1`). **No parallelism, deliberately** — one small,
  highly-coupled security fix plus its acceptance suite; splitting chain-1 would put `observe.ts` in two
  chains for no gain. Shipped WITHOUT the human's quick OK per the unattended-run parameters above.
- `planning-committed` — `adea06e` on the staging branch. `openspec validate --strict` green.
- `dispatched` — chain-1 `host-frame-provenance`, BASE `adea06e`, worktree
  `.claude/worktrees/synthrun-binding-1`, branch `chain/synthrun-binding-1`. Scope: `synthrun/observe.ts`,
  `synthrun/capability.ts`. Writes `handoff/host-provenance.md`. Instructed to run `npm run synthrun:test`
  as a regression check on top of the fast gate, since decision #55 keeps that suite out of `gate.sh` and
  a green fast gate therefore does not prove this chain.
- `report-received` — chain-1 STATUS complete, GATE PASS (`gate.sh` exit 0), plus `synthrun:test` exit 0
  (139 checks passed, 1 QUARANTINED — the 4.2b case chain-2 owns). The report carried **measured
  before/after evidence against the real exploit**, not just a gate verdict: with guards neutered, a
  forged frame flipped `contained` and a hand-rolled `whimHostDispatch` really wrote `pwned` into the
  storage engine; with guards in place the same probe leaves state untouched, returns `null`, records no
  trace entry, and writes nothing. Commit `9b145e9`.
- `deviations-adjudicated` — three Class-A, all accepted:
  - **A1** The 1.2 distinguisher landed as an additive `ObservationState` field
    (`hostProvenanceRefusals?: number`) rather than a `FrameEvent.payload` field. Correct: task 1.1
    forbids the refusal path touching `state.events`, so no payload could survive it. My task text was
    internally inconsistent; the implementer resolved it the safe way.
  - **A2** The refused `false → true` transition reuses `containment_failure` with a distinct message
    rather than a new `DiagnosticKind` (the union is closed and mirrored in `checks/contract.ts`).
    Accepted under the constraint. **Noted as a follow-up candidate**: finding a diagnostic by message
    string is brittle; a dedicated kind would be cleaner but touches `checks/contract.ts`, outside scope.
  - **A3 — an improvement on my design, accepted gratefully.** D3's table keyed transitions on the
    *current value*, which left `false → null` (malformed) a legal downgrade and therefore a two-step
    **`false → null → true` laundering route**. The implementation instead keys the fence on
    `breachAlreadyObserved(state)` — the presence of a `containment_failure` diagnostic, the permanent
    record — so a breach can be softened by neither a later `true` nor a malformed payload. `design.md`
    D3 has been amended to record that the table as I wrote it was not tight enough.
  - No pattern repeated across chains (only one chain so far) → no tripwire candidates yet.
- `integrity-ok` — `fixloop.sh integrity chain/synthrun-binding-1` against the declared allowlist: exactly
  the three declared files, no protected path touched.
- `merged` + `regate-pass` — `b47f4c8` on the staging branch; `./scripts/gate.sh` exit 0 on the merged tip.
  Worktree and chain branch cleaned up unsandboxed; no stranded `.git/config` branch sections.
- `docs-corrected` — two planning docs amended so they do not outlive their accuracy: `research.md`'s
  attribution of the init-script ordering guarantee to `allInitScripts()` was an over-read (it applies to
  fresh frame sessions; this call path is governed by CDP registration order — conclusion unchanged), and
  `design.md` D3 now records the laundering route A3 closed.
- `scope-widened` — chain-2 picks up task 2.5: the stale `exposeFunction` doc comment at
  `synthrun/contract.ts:118`, which chain-1 flagged but could not reach inside its declared scope.
  chains.md updated to declare `synthrun/contract.ts` in chain-2's partition. Safe because chain-2 is
  `after: chain-1` — file-disjointness constrains *concurrent* chains, and nothing else is in flight.
- `dispatched` — chain-2 `capability-reachability-acceptance`, BASE `6e6acd7`, worktree
  `.claude/worktrees/synthrun-binding-2`, branch `chain/synthrun-binding-2`.
- `report-received` — chain-2 STATUS complete, GATE PASS, `synthrun:test` exit 0:
  **`165 checks passed, 0 QUARANTINED`** (from `139 passed, 1 QUARANTINED`). Commit `36443d0`.
  **The red-check evidence is the deliverable and it is real.** Each guard was neutered one at a time
  per the contract's recipe and the suite re-run:
  - 2.1 neutered → 5 failures, reproducing the contract's measured pre-fix numbers exactly (verdict
    `true→false`, events +2, diagnostics 0→1, `hostProvenanceRefusals` stuck at 0).
  - 2.2 neutered → 4 failures **reproducing the original exploit verbatim**, including the sysret
    `{"ok":true}`, the `storage.kv.set` trace entry, and the written value readable back as `'yes'`.
  - 2.3 neutered → 3 failures (a later `true` replaced the observed breach; no refusal diagnostic).
  Guards verified restored: `git diff BASE..chain -- synthrun/observe.ts synthrun/capability.ts` empty,
  and neither file appears in the commit.
- `deviations-adjudicated` (chain-2) — four Class-A, all accepted:
  - **A1** Test 2.1 posts a `{contained:false}` sibling alongside the specified `{contained:true}` frame.
    Correct and necessary: on a harmless run the genuine verdict is already `true`, so "the verdict is
    unaffected" would have been **vacuous** under a single-guard neuter. The sibling is what gives the
    verdict axis teeth. This is the same vacuity trap that let the previous change ship a passing
    assertion over a live vulnerability — caught here by the implementer, not by me.
  - **A2** The `quarantined` helper became entirely unused and eslint's dead-code rule rejected it, so it
    and the now-permanently-empty `quarantines` array / `QUARANTINED` summary suffix were removed. The
    gate decided, which is the sanctioned way for this call to be made. **Recorded for retrieval**: a
    future quarantine must re-add the helper; it is in git history at
    `6e6acd7:synthrun/test/acceptance.ts`.
  - **A3/A4** A stale comment above `RELAY_REBIND_PROBE` refreshed; test 2.2 placed in `testObservers()`
    beside its siblings to reuse the existing session rather than launching another browser.
  - **Tripwire candidate (pattern now seen in 2+ chains):** stale doc comments naming `exposeFunction`
    as the transport. chain-1 fixed two and flagged one; chain-2 fixed that one and flagged another at
    `synthrun/session.ts:16`. Three occurrences across two chains is a pattern, so it is dispatched as
    chain-3 rather than left as a reviewer note.
- `integrity-ok` (chain-2) — exactly the two declared files; guards byte-identical.
- `merged` + `regate-pass` — `c39e043`; `./scripts/gate.sh` exit 0 on the merged tip. All 11 tasks ticked.
  Worktree/branch cleaned up unsandboxed.
- `dispatched` — chain-3 `stale-transport-comment`, BASE `c2f1a13`, one file
  (`synthrun/session.ts`), comment text only. Raised from the tripwire candidate above rather than left
  as a reviewer note, because the comment actively misdescribes a security seam: it names
  `exposeFunction` as the dispatch transport, which is the exact call this change replaced.
  Two other `exposeFunction` mentions were checked by the dispatcher and are **correct as-is**, so are
  explicitly out of chain-3's scope: `synthrun/test/acceptance.ts:861` is accurate *history* (it
  describes the pre-fix code during an earlier red-check), and the "`exposeBinding`, never
  `exposeFunction`" lines in `observe.ts`/`capability.ts`/`contract.ts` are deliberate contrasts.
- `closure-precondition` — **runbook step 12a is satisfied only partially, and the gap is recorded rather
  than papered over.** `node scripts/ruleset-probe.mjs` exits 0: the default branch `main` is protected by
  ruleset "Protect main" (`pull_request`, `non_fast_forward`, `deletion`, `required_linear_history`,
  `required_status_checks`). But the probe validates the DEFAULT branch, and this run's base is
  `redesign` by user instruction. `gh api repos/…/rules/branches/redesign` returns `[]` — **no protection
  rules at all.** So for this run the property the precondition exists to guarantee — "no agent path can
  reach the base branch; the server-side ruleset IS the human gate" — **does not hold**. It still holds
  for `main`, which is what `redesign` itself merges into via the pre-existing PR #21.
  Compensating controls, both weaker than a ruleset and stated as such: the user's explicit "don't
  merge", `gh pr merge` being denied for every caller, and this orchestrator not pushing to `redesign`
  directly at any point. **Recommendation for the human: add a ruleset to `redesign`** if agent runs are
  going to keep targeting it as a base.
- `report-received` — chain-3 STATUS complete, GATE PASS, one file. Verified comment-only by the
  dispatcher (`git diff` filtered to non-comment lines was empty) before merging. One Class-A note: the
  added clause pushed past the block's wrap width, so that clause was rewrapped across two extra lines.
- `integrity-ok` + `merged` — `3e309be`. Worktree/branch cleaned unsandboxed; no stranded config.
- `gate-full-pass` — `./scripts/gate-full.sh` exit 0 on the merged tip: `FULL GATE PASSED`, including
  `✓ synthrun acceptance: 165 checks passed` and `openspec validate --all --strict` green across every
  spec and change. The fast regate after chain-3 was skipped as subsumed — `gate-full.sh` runs `gate.sh`
  in full and is strictly stronger.
- `pushed` + `draft-pr` — `integration/harden-synthrun-binding-isolation` pushed; draft PR **#25** opened
  against **`redesign`** (not `main`, per instruction).
- `checks-settled-pass` — the poll reached an asserted verdict, not an inferred one: `gh pr checks 25` +
  `fixloop.sh checkverdict` → **exit 0, SETTLED PASS**, both required checks explicitly passing
  (`isolation-suite` 2m12s, `quality-gate` 39s). The loop treated only exit 8 as pending, so the
  post-push "no checks reported" window — where `gh` itself exits 0 — could not be misread as green.
  That misreading is finding F1 in this repo's history.
- `sonar-round-1` — `node scripts/sonar-pr-issues.mjs --pr 25` exit 0, **`gate: NONE`, 0 issues**
  (`findings-sonar-1.md`). **This is NOT recorded as a Sonar pass.** `gate: NONE` means SonarCloud did
  not analyze this PR at all — automatic analysis covers the default branch and PRs into it, and this PR
  targets `redesign`. An empty result from an analyzer that never ran carries no information. So no
  lines were appended to `openspec/critic/sonar-ledger.md` (there are no findings to ingest) and **no
  nested fix-loop round was run** — running one over zero findings would have been theatre. Sonar will
  see this work when `redesign` reaches `main` via the pre-existing PR #21. This is the second coverage
  gap of the run, alongside `synthrun:test` being absent from CI.
- `reviewer-verdict` — **sound; no must-fix blockers.** The reviewer attempted to break the guard and
  could not find a path to state mutation or `dispatcher.handle` that skips the frame check, nor any
  laundering route back to `contained: true` after a breach. Load-bearing confirmations, each derived
  from the code rather than from the chains' claims: `state.contained` has exactly **one** write site;
  `containment_failure` has exactly two mint sites and **nothing anywhere filters, splices or removes
  diagnostics**, so `breachAlreadyObserved` is a genuinely permanent record; `msg.trusted` is still
  AND-ed rather than substituted; `page.mainFrame()` is stable across navigation, so there is no window
  where the comparison targets a replaced object; a wholly absent `source` throws inside Playwright
  before any mutation, so the guard fails closed both ways. Report-vs-diff: matches commit-for-commit.
  Spec conformance: conforms, all three scenarios mapped to one real test each.
- `findings-dispositioned` — 7 findings, none blocking. Dispositions:
  - **F1 (MED) → FIXED via chain-4.** The sharpest finding of the run: **the A3 hardening had no
    regression test.** Test 2.3 exercised only `breach → true`, which the *weaker* narrow-transition
    keying also refuses — so the fence could have been silently rewritten to
    `state.contained === false && contained === true`, the whole 165-check suite would stay green, and
    the `false → null → true` laundering route would reopen. A defence indistinguishable from its weaker
    form is a defence that gets refactored away. Dispatched with a mandatory discriminating red-check
    against the weakened fence.
  - **F2 (LOW-MED) → FIXED via chain-4** (`contract.ts` prose): `forgeries` is documented as counting
    only outer-page rejections, but host-side provenance refusals are now folded in, so a run where the
    outer page rejected nothing can report `forgeries.rejected === true`. Ironic given chain-3 existed
    solely to fix a stale comment. `observe.ts:90-94` carries the same stale prose and was out of
    chain-4's scope — see the follow-up list.
  - **F3 (LOW, out of scope) → ESCALATED, and it is the most important thing this run found.**
    `invariants/sandbox-isolation/bridge/runner.mjs:72` still does an unguarded
    `page.exposeFunction('whimHostDispatch', host.dispatch)` — no provenance check, no scrub. **The
    identical vulnerability this change just fixed is still live there**, which means that suite's
    invariant #1 ("storage reachable only as syscalls") is not proving its property against a hostile
    bundle. Correctly untouched: `invariants/` is owner-authored Class-2 (CLAUDE.md never-violate list),
    and `research.md` cited that exact line only as *precedent* for context-level exposure without
    noticing it shares the flaw. **Needs its own change.** Surfaced in the PR body, not left in a diff.
  - **F4 (LOW) → FIXED in `design.md`'s risk register.** D2's claim that page-level exposure "would buy
    no guarantee" was too strong: `context.exposeBinding` covers every page in the context, so a
    candidate-opened page's own main frame would pass the guard. Unreachable today only because the
    iframe is `sandbox="allow-scripts"` without `allow-popups`. Recorded as a standing dependency:
    if `allow-popups` is ever added, the guard must move to `page.exposeBinding` in the same change.
  - **F7 (LOW) → FIXED via chain-4**: a fixed `wait(200)` in the new verdict test replaced with the
    file's `waitUntil` poll idiom. Fails safe today, but this suite has recent flake history and the
    standing instruction is to fix flake surfaces on sight.
  - **F5, F6 (LOW) → NOTED, not fixed.** F5: the refusal diagnostic is uncapped where its sibling
    counter saturates — not candidate-drivable (it needs nonce-authenticated frames the sandbox cannot
    mint) and unbounded diagnostics from authenticated frames is a pre-existing class. F6:
    `HANDOFF-v1-sprint.md` documents the quarantine mechanism chain-2 deleted — already stale before
    this change, and outside every declared scope.
  - **Doc drift → FIXED by the dispatcher**: `tasks.md` 1.5 still stated D3's pre-strengthening table
    (drift in the harmless direction — the ticked text was weaker than what shipped); `chains.md`
    declared only chains 1–2 while 3 and 4 were dispatched. Both corrected so those files remain the
    truthful record rather than `progress.md` being the only accurate one.
- `dispatched` + `report-received` — chain-4 `reviewer-findings`, BASE `b8ced2c`. STATUS complete,
  GATE PASS, `synthrun:test` **169 checks passed** (was 165; +4 assertions), 0 quarantined. Commit
  `ad59223`.
  **The F1 red-check discriminated, which was the whole point.** With the fence rewritten to the weaker
  cell-keyed form `state.contained === false && contained === true`, the suite reported 6 failures, and
  the output shows the laundering route executing end to end — `(got null)` after the malformed frame,
  then `(got true)` after the override. Three of those six were *pre-existing* assertions that only
  fall once the malformed frame is interposed, which confirms the reviewer's premise exactly: without
  the interposition, the weaker fence kept every one of them green.
  Class-A deviation, accepted: also corrected `ForgeryTally.rejected`'s doc at `synthrun/contract.ts:95`
  — same staleness, same file, one line outside the named range. Leaving it wrong beside a corrected
  `RunReport.forgeries` would have been self-contradictory.
  Also of note: the implementer replaced the fixed sleep by polling `obs.state.events.length` rather
  than a diagnostic, because the shipped behaviour for a malformed post-breach frame is that *nothing
  moves* — there is no positive observable to wait on. Polling the event count doubles as a
  non-vacuity check, distinguishing "refused" from "never arrived".
- `integrity-ok` + `merged` — chain-4 `a765bfb`. Guards verified untouched before merge: `git diff` of
  `synthrun/observe.ts` and `synthrun/capability.ts` across the chain is empty, and the fence still
  reads `if (breachAlreadyObserved(state))` at `observe.ts:258`. Checked explicitly because a stale
  editor diagnostic (`'breachAlreadyObserved' is declared but never read`) is precisely what a
  left-behind weakened fence would look like — it was residue from the red-check edit, not the tree.
- `dispatched` — chain-5 `forgery-tally-doc`, BASE `a765bfb`, one file (`synthrun/observe.ts`), the
  last stale comment of the class the reviewer flagged twice: `rejectedForgeries` is still documented as
  counting only what the outer page rejected, while the field directly below it documents host
  provenance refusals as a *subset* of it. The two comments contradict each other in the same struct.
