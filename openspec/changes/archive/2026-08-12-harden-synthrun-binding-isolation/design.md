# design — harden-synthrun-binding-isolation

Source: `research.md` (this folder), which answers all three unknowns the proposal refused to design
against. Read that first; this file only decides.

## The shape of the problem, restated after research

The proposal framed this as "the relay binding leaks into the sandbox realm". Research narrows it:

1. The leak is **not fixable from inside the page.** Playwright calls `Runtime.addBinding` with `{name}`
   only and never uses the protocol's context-scoping parameters, so the raw binding is installed on the
   global of *every* execution context of the target, opaque-origin srcdoc included, and survives reloads
   (`research.md` Q1). There is no Playwright configuration, init-script ordering, or JS deletion that
   reliably removes it — and whether Chromium re-materialises it after a `delete` is not even knowable
   from the source.
2. The leak **has always been detectable at the host.** CDP delivers `executionContextId` with every
   `Runtime.bindingCalled`; Playwright resolves it to the owning frame from browser-supplied `auxData`
   and passes `{frame, page, context}` into the binding callback. `exposeFunction` throws that argument
   away; `exposeBinding` does not (`research.md` Q2).

So the fix is not a better scrub. **It is to stop discarding the provenance the browser is already
handing us.**

---

## D1 — Provenance is established host-side via `exposeBinding`, and that is the load-bearing mechanism

`synthrun/observe.ts:428` moves from `page.exposeFunction(RELAY_BINDING_NAME, (raw) => …)` to
`page.exposeBinding(RELAY_BINDING_NAME, (source, raw) => …)`, and the callback refuses — before parsing,
before any state mutation — when `source.frame !== page.mainFrame()`.

Why this and not the alternatives (all four weighed in `research.md` Q2):

- Frame identity is derived by the browser from `executionContextId`, never from page-supplied data, so
  **it cannot be forged from the candidate realm**. The candidate keeps the ability to *call*; it loses
  the ability to be *believed*. That is precisely the spec's "trust is established by the harness rather
  than asserted by the payload".
- It is public, typed API on the pinned version, and lowers to the *same* CDP channel already in use —
  the diff is a callback signature and a guard, not a new transport.
- Raw CDP with an explicit `executionContextId` would buy the same guarantee through a protocol field
  Chromium marks deprecated and slated for removal. Rejected as strictly more fragile.

### On the spec phrase "unreachable **as a capability**"

Literal unreachability is impossible here (D1's first paragraph). What is achievable, and what this
change delivers, is that the channel is **inert** from the candidate realm: every call is attributable,
refused before any effect, and recorded. The function object may still exist; the *capability* — the
ability to cause a host-side effect — does not.

This is not a weakening of the requirement. The delta spec's three scenarios were written in exactly
these terms and are satisfied verbatim: "the frame does not reach the harness's observation state",
"the call is refused, no host capability is invoked, and no syscall is recorded host-side as
legitimate". **No spec amendment is required.** The requirement prose and the scenarios agree once
"capability" is read as effect-bearing rather than name-bearing, which is the reading the proposal
itself argues for ("the distinction is the whole finding").

## D2 — `whimHostDispatch` gets the identical guarantee, and stays context-level

`synthrun/capability.ts:135-137` moves to `context.exposeBinding('whimHostDispatch', (source, raw) => …)`
with the same main-frame guard, refusing before `dispatcher.handle` is ever called.

**Exposure level is deliberately left at context.** Research found no rationale for the original
divergence from the `page.exposeFunction` precedent, and it is tempting to "correct" it — but doing so
fixes nothing: init scripts and the raw binding reach every frame either way (Q1), so page-level
exposure is no safer than context-level. Changing it would be unmotivated churn in a security change,
and would risk `page.ts`'s `syscallSink: 'exposed'` contract for no guarantee. The guard is the fix; the
exposure level is not.

**Nothing legitimate breaks.** The only real caller is the outer page's main frame, via
`build/assemble.mjs:121` `relaySyscall`, which runs in the orchestration script *outside* the iframe and
only after source-verifying `ev.source === iframe.contentWindow`. The sandbox side calls
`__whimSyscall.call`, never `whimHostDispatch` (`research.md` Q3).

**The generation fence is not the layer that can fix this** and is left alone: a hand-rolled `gen:1`
frame *matches* the fence rather than defeating it. The fence stays as-is; provenance is what the
forged frame now fails.

## D3 — Verdict monotonicity is fail-closed, not first-write-wins

`recordProbesOutcome` (`observe.ts:229-247`) stops assigning unconditionally. The rule:

| current | incoming | result |
|---|---|---|
| `null` (unobserved) | `true` / `false` | accepted — this is the first observation |
| `false` | `true` | **refused**, recorded as a diagnostic |
| `true` | `false` | accepted (a breach observed later is still a breach) |
| same value | same value | no-op |

> **Strengthened during implementation (chain-1); this table as written was not quite tight enough.**
> Keying the rule on the *current value* leaves `false → null` (a malformed payload) as a legal
> downgrade, and therefore leaves a two-step **`false → null → true` laundering route** that defeats the
> whole rule. The implemented fence instead keys on `breachAlreadyObserved(state)` — the presence of a
> `containment_failure` diagnostic, i.e. the permanent record — so once a breach is observed, neither a
> later `true` **nor** a malformed payload can soften it. See `handoff/host-provenance.md` for the
> implemented table. The tri-state and its single minting site are preserved exactly as specified above.

**Why fail-closed and not first-write-wins.** The spec says only "not silently replaceable". Two readings
were available; this one is chosen because the asymmetry matches the threat: the dangerous direction is
the one that *ships an unsafe app*, i.e. pinning `contained: true`. A later honest `false` must still be
able to downgrade an earlier `true`, or a breach observed after the first probes frame would be
discarded — which would be a new hole in the opposite direction.

It also keeps the existing suite honest. `acceptance.ts:704-707` is a deliberate **red-check / negative
control** asserting that an authenticated `contained:false` on that seam IS read as a breach; under
first-write-wins that control would go vacuous. Under fail-closed monotonicity it passes unchanged.

**"Not silently" is discharged by recording, not by refusing quietly.** Every refused transition pushes a
diagnostic, so a suppressed override is visible in the report rather than inferred from its absence.

**The tri-state is preserved exactly.** `contained: boolean | null` keeps its meaning, `null` still never
travels without a `containment_unobserved` diagnostic, `pushContainmentUnobserved` remains the single
minting site, and `finalizeContainmentVerdict` still closes out. The `evals` adapter's fail-closed
`null → contained:false` mapping is untouched. A malformed payload still yields `null`+unobserved, never
a substituted `false`.

## D4 — The name scrub is retained as defence in depth, and its load-bearing ordering is pinned

`installRelayShim` stays. It is now explicitly *not* load-bearing — D1 is — but it costs nothing and
raises the bar for an attacker who must now also know the binding machinery.

Research surfaced a live trap worth closing while we are here: the scrub works **only because**
`exposeBinding`/`exposeFunction` at `observe.ts:428` is awaited *before* `addInitScript` at
`observe.ts:455`, since Playwright orders binding init scripts ahead of user init scripts. **Reversing
those two lines silently no-ops the scrub with no test failing.** A comment at the call site records the
dependency; the assertion that actually protects it is the un-quarantined capability test (D5), which
fails loudly if the scrub *and* the guard both regress.

## D5 — The quarantined test becomes the acceptance criterion, plus two siblings

`test/acceptance.ts:670-674`'s `quarantined(...)` call is replaced by a real `await test(...)` using the
established idiom (`findAppFrame` + `frame.evaluate`, exactly as the neighbouring 4.2a test does):

1. **Relay re-acquisition is inert.** From inside the candidate realm, re-mint the binding via
   `RELAY_BINDING_PROBE` and post `{kind:'probes', trusted:true, payload:{contained:true}}`. Assert the
   harness's observation state is unchanged — verdict unaffected, no `paint`/`probes` event recorded
   from that frame — and that the refusal is accounted for rather than dropped.
2. **Host syscall dispatch is refused.** From inside the candidate realm, hand-roll a syscall frame to
   `whimHostDispatch`. Assert no host capability is invoked, nothing is recorded host-side as a
   legitimate syscall, and — the sharpest assertion available, since the original exploit really wrote
   through to the storage engine — that no such value is readable back afterwards.
3. **A verdict is not overridden.** After an authenticated `contained:false`, a later authenticated
   `contained:true` does not flip the verdict, and the refusal appears as a diagnostic.

Each needs a **red-check**: it must be demonstrated to fail against the pre-fix behaviour, or it is
indistinguishable from a test firing at a dead channel. The existing 4.2a name-level test and the
`acceptance.ts:704-707` negative control must both keep passing untouched.

## D6 — The CI-coverage gap is reported, not closed here

`synthrun:test` runs in `gate-full.sh` but **not** in `.github/workflows/invariants.yml`
(`research.md`, "Gap found in passing"), so a green PR does not by itself exercise this fix. The
workflow is neither protected nor in `gate.sh`'s `CONFIG_SET`, so closing it is mechanically possible.

It is deliberately **out of scope**: adding a real-Chromium suite as a new blocking gate on every future
PR is an outward-facing change this proposal never asked for, and the suite has a recent flake history
(`chain-9 fix-sourcemap-anchor-flake`). Verification for this change therefore comes from `gate-full.sh`
run locally on the merged tip. The gap is surfaced in the PR body and the closing summary as a
recommendation for a separate change.

## Risk register

- **Residual, by construction:** provenance authenticates the *frame*, not the code in it. Anything
  already executing in the outer page's main realm still passes. That is the correct trust boundary —
  the outer page is harness-authored — but it is a boundary, not an absolute.
- **Playwright upgrades.** If a future version changes `exposeBinding`'s `source` shape or frame
  identity semantics, the guard degrades silently. The D5 tests are the tripwire; they exercise the real
  binding against real Chromium, so a version bump that breaks the assumption goes red rather than quiet.
- **The dispatch guard's soundness depends on the iframe's `sandbox` attribute** (found by the reviewer;
  D2 overstated the case). `context.exposeBinding` installs on *every* page in the context, and a
  candidate-opened page's own main frame would satisfy `source.frame === source.page.mainFrame()` and
  pass the guard. That is unreachable today **only** because the iframe is `sandbox="allow-scripts"`
  with no `allow-popups` and no `allow-top-navigation` (`build/assemble.mjs:131`). So D2's claim that
  page-level exposure "would buy no guarantee" is too strong: page-level exposure would remove this
  dependency entirely. It was still correct not to churn the exposure level inside a security fix, but
  **if `allow-popups` is ever added to that sandbox attribute, this guard must move to `page.exposeBinding`
  in the same change.**
- **The identical hole is still live in `invariants/sandbox-isolation/bridge/runner.mjs:72`** — an
  unguarded `page.exposeFunction('whimHostDispatch', host.dispatch)` with no provenance check and no
  scrub. `research.md` cited that line only as *precedent* for context-level exposure and did not notice
  it carries the same vulnerability. It is owner-authored Class-2 and correctly untouched here; it needs
  its own change. See the closing summary — this is the most important follow-up this run produced.
- **`deliverBindingResult` runs in the caller's realm** (`coreBundle.js:20461`) — so a refused call still
  causes the host to evaluate a delivery expression inside the attacker's realm, with errors swallowed.
  Unavoidable in this Playwright version, and harmless provided the refusal value carries nothing
  sensitive. The refusal returns the dispatcher's existing "no result" shape (`null`), not an error
  string describing the guard.
