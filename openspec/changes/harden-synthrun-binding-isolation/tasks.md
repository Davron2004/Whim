# Tasks: harden-synthrun-binding-isolation

Design decisions referenced as D1–D6 are in `design.md`. Evidence for every claim is in `research.md`.

## 1. Host-side frame provenance for both channels, and a non-overridable verdict

- [x] 1.1 In `synthrun/observe.ts`, move the relay from `page.exposeFunction(RELAY_BINDING_NAME, …)` to
      `page.exposeBinding(RELAY_BINDING_NAME, (source, raw) => …)` (D1). Refuse the frame **before**
      parsing and before any mutation of `ObservationState` when `source.frame !== page.mainFrame()`.
      The refusal path must not touch `state.events`, `state.contained`, `state.diagnostics`,
      `state.paintAtMs`, `state.lastActivityAtMs`, or `generation`.
- [x] 1.2 Account for a refused frame rather than dropping it silently: increment the existing
      `rejected-forgery` accounting (respecting `REJECTED_FORGERY_CAP`) so a sandbox-origin attempt is
      visible in the report. Do **not** add a new member to `RUNTIME_OBSERVED_KINDS` — it is a closed
      union mirrored in `checks/contract.ts`; distinguish host-provenance refusals by an additive
      payload field instead (`research.md`, "Existing forgery accounting").
- [x] 1.3 Record the load-bearing ordering at the install site (D4): the `installRelayShim` init script
      only scrubs the name because the binding is exposed *before* `page.addInitScript` is registered.
      A comment naming the consequence of reversing them. `installRelayShim` itself is retained
      unchanged as defence in depth.
- [x] 1.4 In `synthrun/capability.ts`, move `context.exposeFunction('whimHostDispatch', dispatch)` to
      `context.exposeBinding('whimHostDispatch', (source, raw) => …)` with the same main-frame guard
      (D2). Refuse **before** `dispatcher.handle(raw)` is called, so no capability is invoked and no
      trace entry is recorded as a legitimate syscall. Return the dispatcher's existing "no result"
      shape (`null`) — never an error string describing the guard. Exposure stays at **context** level;
      do not change it.
- [x] 1.5 Make the containment verdict monotonic and fail-closed in `recordProbesOutcome`
      (`synthrun/observe.ts`) per D3's table: `null → true|false` accepted; `false → true` **refused**
      and recorded as a diagnostic; `true → false` accepted; equal values a no-op. Preserve the
      `boolean | null` tri-state exactly — `null` still never travels without a
      `containment_unobserved` diagnostic, `pushContainmentUnobserved` stays the single minting site,
      `finalizeContainmentVerdict` still closes out, and a malformed payload still yields `null` rather
      than a substituted `false`.
      > **Shipped stronger than this text.** The transition table above keys on the *current value*,
      > which leaves `false → null` a legal downgrade and therefore a `false → null → true` laundering
      > route. The implementation keys on `breachAlreadyObserved(state)` — the permanent
      > `containment_failure` diagnostic — so a breach is softened by neither a later `true` nor a
      > malformed payload. See `design.md` D3's amendment and `handoff/host-provenance.md`.
- [x] 1.6 `./scripts/gate.sh` green. Note that `synthrun:test` is **not** in the fast gate (decision
      #55) — chain-1 is not self-proving; chain-2 supplies the acceptance evidence.

## 2. The quarantined assertion becomes the acceptance criterion

- [x] 2.1 In `synthrun/test/acceptance.ts`, replace the `quarantined(...)` call at the
      capability-reachability case with a real `await test(...)`: from inside the candidate realm
      (`findAppFrame` + `frame.evaluate`, the established idiom), re-mint the relay binding via the
      existing `RELAY_REBIND_PROBE` and post `{kind:'probes', trusted:true, payload:{contained:true}}`.
      Assert the harness's observation state is unaffected and the refusal is accounted for.
- [x] 2.2 Add the host-syscall case: from inside the candidate realm, hand-roll a syscall frame to
      `whimHostDispatch`, bypassing `__whimSyscall` and its generation fence. Assert the call is
      refused, no host capability is invoked, nothing is recorded host-side as a legitimate syscall,
      and — the sharpest available assertion, since the original exploit really wrote through to the
      storage engine — that no such value is readable back afterwards.
- [x] 2.3 Add the verdict-override case: after an authenticated `contained:false`, a later
      authenticated `contained:true` does not flip the verdict, and the refused transition is visible
      as a diagnostic rather than silently dropped.
- [x] 2.4 **Red-check each of 2.1–2.3** against pre-fix behaviour — temporarily neuter the chain-1 guard
      in the worktree, confirm each new assertion fails, then restore. A security test that has never
      been observed failing is indistinguishable from one firing at a dead channel. Report the observed
      red output for each. The existing name-level test (4.2a) and the `contained:false` negative
      control must both keep passing untouched, and the suite's `QUARANTINED` count must drop by one.
- [x] 2.5 Correct the stale doc comment at `synthrun/contract.ts:118`, which still names
      `exposeFunction` as the relay transport. Chain-1 corrected the equivalent comments in its own two
      files and flagged this one as outside its declared scope. Comment only — no behaviour change.
- [x] 2.6 `./scripts/gate.sh` green, plus `npm run synthrun:test` green in the worktree.
