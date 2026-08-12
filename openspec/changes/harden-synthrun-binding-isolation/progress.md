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
