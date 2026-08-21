## Why

**A candidate running inside `synthrun`'s opaque-origin sandbox can forge its own containment verdict
and reach host syscalls. Verified by execution, not inference, on 2026-08-11.**

`synthrun` is the generation pipeline's verification vantage — the thing that decides whether a
generated mini-app is safe to deliver. Its containment verdict is supposed to come only from
nonce-authenticated `probes` frames posted by the *outer* page (`docs/spike2-findings.md` finding F4:
a bundle can forge its self-reported verdict, so only the outer page's nonce check is trusted).

That guarantee does not hold. The harness observes the page through Playwright's
`page.exposeFunction('__whimSynthRelay', …)`, and Playwright implements an exposed function as three
separable pieces:

1. `Runtime.addBinding({name: "__playwright__binding__"})` — a raw CDP channel installed on the global
   of **all** execution contexts of the page;
2. a browser-context init script defining `globalThis["__playwright__binding__controller__"]` — runs in
   every document, **including the opaque-origin srcdoc iframe**;
3. a per-binding init script defining the named wrapper.

Host-side, `PageBinding.dispatch` resolves the target **by the `name` field in the payload** and does
**not** check that the calling frame is the main frame. So candidate code inside the sandbox re-acquires
the relay in one line and posts a frame the harness accepts as trusted:

```js
globalThis['__playwright__binding__controller__'].addBinding('__whimSynthRelay');
globalThis['__whimSynthRelay'](JSON.stringify({kind:'probes',trusted:true,payload:{contained:true}}));
```

The forged frame never transits `assemble.mjs`'s `toRN()`, so the outer page's nonce check is bypassed
entirely rather than defeated.

### What was measured (2026-08-11, primary tree at `740210b`, real Chromium, real `SynthRunSession`)

Sandbox realm confirmed as `{"origin":"null","isTop":false,"href":"about:srcdoc"}`.

- `typeof __whimSynthRelay` there is `"undefined"` — the name-level scrub added by
  `harden-containment-observation` chain-2 **does** work. It is not sufficient.
- `__playwright__binding__controller__` → `"object"` and `__playwright__binding__` → `"function"` both
  survive in the sandbox realm. `addBinding('__whimSynthRelay')` returns `ok` and the name becomes
  `"function"` again.
- The forged frame reaches the host relay callback and is recorded with `trusted: true`, including a
  `containment_failure` diagnostic the candidate authored itself.
- **The verdict is last-writer-wins.** `recordProbesOutcome` assigns `state.contained` unconditionally,
  so a late forgery overrides the genuine frame. Demonstrated in both directions: a forgery at
  `setTimeout(…, 1200)`, after the genuine `contained:true` frame, ended the run at `contained = false`.
  The same mechanism pins a run to `true`, which is the direction that ships an unsafe app.
- **`whimHostDispatch` is worse: it is not scrubbed at all.** Exposed at *context* level in
  `synthrun/capability.ts`, it is directly `"function"` in the sandbox realm. A hand-rolled syscall frame
  from inside the sandbox bypassed `__whimSyscall` and the dispatcher's generation fence, returned
  `{"ok":true}`, was recorded host-side as a legitimate syscall (`storage.kv.set`), and really wrote
  `FORGED_BY_SANDBOX = "pwned"` into the storage engine.
- Other host globals visible from inside the sandbox realm: `__whimRequire`, `__whimRunProbes`,
  `__whimSyscall`, `__whimGeneration`, `__whimAfterBundle`, `__WHIM_VC_SDK__`,
  `__WHIM_NEUTRALIZE_REPORT__`.

### Scope and provenance

- **Pre-existing.** It predates `harden-containment-observation`; the pre-D1 code installed the same
  wrapper into the sandbox realm. That change neither created nor widened it, and its D7-local decision
  explicitly anticipated this outcome and routed it here.
- **Harness-side, not product-runtime.** This is `synthrun` (server-side verification), not the on-device
  WebView. Chromium only; the real Android System WebView was not tested and is not implicated by this
  evidence.
- Severity is nonetheless critical *for what synthrun exists to do*: a candidate that can pin
  `contained: true` defeats the gate that decides whether an app ships.

### What is NOT yet known — do not design against these as if settled

- Whether scrubbing `__playwright__binding__controller__` and `__playwright__binding__` as well actually
  closes it. Playwright may re-add per-binding init scripts, and `Runtime.addBinding` operates **below**
  the JS global, so a JS-level `delete` may be cosmetic. **"Scrub three names instead of one" is a
  hypothesis, not the fix.**
- Whether a frame-aware alternative exists in the pinned Playwright version — binding payload inspection
  carrying an `executionContextId`, or routing observation over CDP directly instead of `exposeFunction`.
- Whether `whimHostDispatch` needs the same treatment or a different one, given it is exposed at context
  level for reasons the capability bridge may depend on.

A research phase is required before design. This proposal deliberately does not pick a mechanism.

## What Changes

- **The host observation relay SHALL be unreachable as a capability from the sandbox realm**, not merely
  undefined by name. The distinction is the whole finding: the current name-level scrub yields an
  assertion that passes while the capability is one call away.
- **Host-side frame provenance.** A frame arriving at the host relay SHALL be attributable to the main
  frame, so that trust is established by the harness rather than asserted by the payload. Today
  `msg.trusted` is consumed verbatim and the host has no way to distinguish an outer-page frame from a
  sandbox-originated one.
- **The containment verdict SHALL NOT be last-writer-wins.** `recordProbesOutcome` assigning
  unconditionally is what converts a forged frame into a verdict override. A verdict, once
  authentically observed, must not be silently replaceable.
- **`whimHostDispatch` SHALL receive the same isolation guarantee**, and the syscall dispatcher's
  generation fence SHALL NOT be bypassable by a hand-rolled frame from the sandbox realm.
- **Un-quarantine the capability-reachability assertion** that `harden-containment-observation` chain-4
  landed in `synthrun/test/acceptance.ts`. That quarantined test is the acceptance criterion for this
  change and is already written; it fails today and names this change.

## Capabilities

### New Capabilities

None. This corrects behaviour in an existing capability.

### Modified Capabilities

- `synthetic-run`: the host observation relay and the host syscall dispatch SHALL be unreachable from the
  candidate's opaque-origin realm as capabilities rather than as names; frames reaching the host relay
  SHALL be attributable to the main frame; and an authenticated containment verdict SHALL NOT be
  overridable by a later frame.

## Impact

**Code**

- `synthrun/observe.ts` — `installRelayShim` (the name-level scrub), the `page.exposeFunction` call site,
  the relay callback that consumes `msg.trusted`, and `recordProbesOutcome`'s unconditional assignment.
- `synthrun/capability.ts` — `context.exposeFunction('whimHostDispatch', …)`, unscrubbed today.
- `synthrun/test/acceptance.ts` — the quarantined capability-reachability case becomes the acceptance
  test and is un-quarantined here.

**Not touched**

- `build/assemble.mjs`, `src/runtime/web/loader.js`, `probes.js`, `invariants/` — Class-2 protected. The
  nonce check itself is sound; it is being bypassed rather than broken, so the outer page needs no change.

**Governing decisions**: #35/#37 (the three-leg containment model), `docs/spike2-findings.md` finding F4
(a bundle can forge its self-reported verdict — this is that finding one layer up, at the harness's own
transport), #41/#43 (the capability bridge's syscall authority and generation fence, which the
`whimHostDispatch` half of this finding bypasses), and `harden-containment-observation` D7-local, which
predicted this and routed it here.

**Provenance**: found during the `harden-containment-observation` run (2026-08-11). The full ledger entry,
including the reviewer audit that first derived it from Playwright's bundled source and the verifier run
that confirmed it by execution, is in that change's `progress.md`.
