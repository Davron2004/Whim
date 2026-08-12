## Context

`synthrun` observes a candidate run from trusted vantages only: nonce-authenticated frames posted
by the outer page, plus CDP. Per `research.md`, the observation is already two-phase —
`attachObserversEarly` runs before navigation (CDP only), and `EarlyObservers.finish` runs *after*
`page.goto` resolves, where it installs the `__whimSynthRelay` binding and the main-frame
`globalThis.ReactNativeWebView` shim that `assemble.mjs`'s `toRN()` posts through.

`toRN()` guards on `if (window.ReactNativeWebView)` and silently drops the frame when it is
absent. So between document commit and `load`+`finish` there is no transport at all, and
everything the outer page emits in that window is lost: the trusted `delivery` / `paint` / `error`
/ `probes` frames, and the untrusted `rejected-forgery` / `ui-event` / `nav-depth` frames.

Downstream, `report.ts:132` emits `obs.state.contained === true` over an `ObservationState.contained`
that is `boolean | null` and initialised `null` (`observe.ts:269`). A verdict that never arrived
and a verdict that reported a breach therefore reach every consumer as the same `false`.

This is decision **#55**'s named structural fix. `synthrun/test/acceptance.ts:362-391` carries a
**quarantined** `mount_timeout` red-check that is unsound for exactly this reason.

> **Numbering note.** This document's `D1…Dn` labels are local to this change. Decision **#56**'s
> `D7`/`D8` — cited throughout — are referred to by their decision number and are *not* the same
> namespace.

## Goals / Non-Goals

**Goals:**

- No frame emitted by the outer page is dropped because the host transport was not yet live.
- "No authenticated verdict was observed" is a first-class state that no consumer can silently
  conflate with "an authenticated verdict reported a breach".
- A rejected forgery is a reliable, bounded, payload-free signal.
- The quarantined `mount_timeout` red-check becomes sound and is un-quarantined.
- The user is never told their app was unsafe on the strength of a verdict we never observed.

**Non-Goals:**

- Routing unobserved verdicts into the repair loop. Excluded by #56 D7/D8, and deliberately so:
  repair feeds diagnostics back to the model, and describing how an escape was detected is a
  targeting oracle.
- Automatic re-running of an unobserved candidate (see D3).
- Any change to the nonce trust boundary, the CSP, the production page, or the loader. Per
  `research.md` these are Class-2 protected and the spec forbids forking or loosening them to ease
  testing.
- Changing what `mount_timeout` itself means.

## Decisions

### D1 — Install the relay before navigation, confined to the main frame

Move relay installation from `EarlyObservers.finish` into the pre-navigation phase, so the
transport is live before the delivered page's inline scripts run. `RunOptions.beforeNavigate` is
already documented as exactly this seam.

*Alternatives rejected:*

- **Widen `mountBudgetMs`.** Masks the symptom. A dropped frame is dropped; waiting longer for a
  message that was never delivered cannot recover it, and the budget is not the mechanism.
- **Replay or poll for missed frames.** There is nothing to replay — `toRN()` discards the frame
  at the source when no transport exists.
- **`context.addInitScript` / any per-document installation.** **Rejected on containment
  grounds.** Per `research.md`, this would also define `ReactNativeWebView` inside the
  opaque-origin sandbox realm, where `src/runtime/web/loader.js:65` defines its own same-named
  stub and `probes.js:81-82` asserts `window.parent.ReactNativeWebView` is unreachable (#35/#37,
  finding F4). Installation must stay main-frame-confined, as `page.evaluate` guarantees today.

This reordering does not touch authentication. The nonce is minted in `makeIframe()`
(`assemble.mjs:131`) and `authentic` is evaluated before any `toRN({trusted:true})`; `observe.ts`
consumes `msg.trusted` and never re-derives it. The relay is a pure downstream sink, so opening it
earlier cannot admit an unauthenticated frame — **provided D1's main-frame confinement holds**,
which is why that confinement is an asserted invariant and not a convention.

### D2 — Widen `RunReport.contained` to `boolean | null`

`null` means "no authenticated verdict was ever observed".

*Alternative rejected:* a sibling flag (e.g. `containmentObserved: boolean`), mirroring the
`ContainmentVerdict.authenticated` precedent in `evals/contract.ts`. It is a smaller diff and
leaves `stages/run.ts:54` literally unchanged — but it makes correct handling **opt-in**. A
consumer that ignores the new field silently reproduces today's collapse, which is the exact bug.
Widening the type makes every consumer a compile error until it says what it does with "unknown".
On the repo's highest-stakes invariant, the compiler is the right enforcement mechanism.

### D3 — An unobserved verdict is terminal, and is not re-run

It ends the run with its own reason and its own diagnostic, consumes no repair attempt, and feeds
nothing back to the model. It is never treated as contained — not after any number of attempts,
not as a fallback, not on a last try.

*Alternative rejected:* a bounded in-place re-run of the already-built candidate. Cheap to build
(`source`/`manifest`/`build` are live locals in `processCandidate`, so no model calls and no
repair attempts would be consumed) — but it buys little and costs something real. Post-D1 the
remaining causes of `null` are dominated by **deterministic** ones: a candidate that never mounts,
a malformed payload, or a candidate that suppresses its own verdict. Only a Chromium-level crash
benefits from a retry. Meanwhile an adversarial candidate that withholds its verdict would gain a
resource multiplier, and the user already has a one-tap "Try again" (`LauncherRoot.tsx:742-766`)
for the rare infrastructure case.

### D4 — A distinct diagnostic kind, not a reuse of `mount_timeout`

`mount_timeout` covers only the never-painted cause. A verdict can go unobserved *without* a mount
timeout: a malformed `payload.contained`, a suppressed frame, or a Chromium-level failure after a
successful paint. Reusing it would re-create a collapse one layer up. This adds a kind to the
closed vocabulary governed by `harness-diagnostics`.

### D5 — Rejected forgeries: record the fact, bounded and payload-free

`assemble.mjs` already emits `rejected-forgery`, and `acceptance.ts:409,719-749` already assert
the forgery is recorded and the genuine verdict still wins. That signal travels the same relay, so
D1 is what makes it *reliable*.

The tally is **not** a hostility discriminator, and the decision does not rest on it being one.
The harness's own T6b pen test trips it on every run: `src/runtime/web/probes.js` posts an
unauthenticated `{__whimHarness:true, kind:'spoof-probe'}` frame from every realm and
`assemble.mjs` rejects it as `rejected-forgery`, so a clean candidate reports `rejected: true` with
`count >= 1`, and the count climbs with realm resets (`sweep.ts` calls `reinject({reset:true})`,
which re-runs the oracle per reset) — it is partly a realm-reset counter. `acceptance.ts` pins
this baseline. What the recorded signal is good for, and why D5 stands: it is a bounded,
payload-free record that forgery rejection is occurring at all, and a saturating count that
separates ordinary operation from a candidate flooding the channel.

Because a forged frame's contents are attacker-controlled:

- Record the **fact** and a **bounded count**, capped at a fixed maximum of **16**. Rejections
  beyond the cap are counted as "at least 16" and are not recorded individually — the signal we
  need is "did this candidate try to forge, and was it once or was it spamming", which saturates
  well before 16. Never the payload — otherwise the candidate chooses what lands in our
  diagnostics, and an unbounded list is a log-exhaustion lever.
- Keep it out of every model-facing path. #56 D7/D8 already guarantees this incidentally; this
  design states it as an invariant, because a diagnostic reaching the repair loop would be a
  prompt-injection channel authored by the candidate.

### D6 — Separate the user-facing reason

`CONTAINMENT_FAILURE_REASON` ("This app could not be safely run and was not delivered") asserts a
breach. An unobserved run gets its own reason that says we could not verify, not that we caught
something. The copy is:

> **"We couldn't verify this app ran safely. Please try again."**

This is a settled product decision, not an implementer's choice — it is the sentence the user is
shown, and it must not drift into either asserting a breach or implying the app is fine. The
`FailureScreen` affordances are unchanged; "Please try again" points at the existing one-tap
affordance rather than promising an automatic retry (D3 explicitly declines to add one).

### D8-local — `RunOutcome` gains a third union arm, not a discriminant field

`RunOutcome` is today a two-arm discriminated union keyed on `contained: false | true`. The
unobserved state SHALL be modelled as a **third arm of that union**, not as an extra boolean or
flag hung off an existing arm.

*Rationale:* this is where D2's argument actually has to land. Widening `RunReport.contained` only
buys compiler-enforced discrimination if the shape it flows into preserves exhaustiveness. A
discriminant *field* on an existing arm lets a `switch` that handles both old arms keep compiling
while silently mishandling the new state — which re-creates the original collapse one layer up,
in the exact subsystem that decides whether an app ships. A third arm makes every non-exhaustive
consumer a compile error.

### D7-local — Assert the sandbox realm cannot see the relay binding

`research.md` could not confirm whether Playwright's `exposeFunction` binding (`__whimSynthRelay`)
is installed into the sandboxed opaque-origin iframe as well as the main frame, and found no probe
asserting its absence. This change adds that assertion regardless of D1, because D1 makes the
question load-bearing. **If the binding turns out to be reachable from candidate code, that is a
pre-existing containment hole and becomes its own change — it is not fixed here.**

## Risks / Trade-offs

- **Relay installation leaks into the sandbox realm** → containment regression, strictly worse
  than the flake being fixed. *Mitigation:* main-frame-confined installation (D1) plus the
  standing assertion in D7-local, which fails the suite rather than relying on review.
- **Navigation gating.** Per `research.md`, `goto` uses `waitUntil:'load'` with a 20s timeout; an
  unbounded synchronous hang may time out and throw out of `openRun` before `awaitMount` runs —
  unverified. The sound `mount_timeout` red-check needs a run that actually reaches `awaitMount`.
  *Mitigation:* treat the `waitUntil` mode as an explicit implementation decision with the red-check
  as its acceptance test; do not change it speculatively.
- **`bootMs` semantics.** `bootMs`/`mountToPaintMs` anchor on `RunContext.startedAt`; changing
  `waitUntil` changes what `bootMs` measures. *Mitigation:* the `synthetic-run` spec requires
  determinism "timings aside"; record any shift in the change rather than letting it drift
  silently.
- **Breaking type change churn** across `stages/run.ts`, `machine.ts`, the evals adapter, and
  fixtures. *Mitigation:* this is the point of D2 — the compiler enumerates the work.
- **Newly reliable frames change existing assertions.** Frames previously dropped in the race will
  now arrive, so suites that implicitly depended on their absence may move. *Mitigation:* expected;
  treat a suite that breaks here as a finding, not noise.

## Naming

The diagnostic kind introduced by D4 is **`containment_unobserved`**, matching the existing
`containment_failure` / `mount_timeout` style in the closed vocabulary.

## Open Questions

1. ~~Should `evals/adapters/synthetic-run.ts:36` stop hardcoding `authenticated: true`?~~
   **Resolved: yes, in scope.** Its docstring justifies the hardcode *because* synthrun collapses;
   D2 removes that justification, so leaving it would preserve the collapse in the one consumer
   whose whole job is judging containment. Carried by its own chain.
2. Does the `waitUntil` mode need to change for the un-quarantined red-check to be soundly
   reachable (see Risks)? **Deliberately deferred to implementation**, arbitrated by the red-check
   rather than by speculation — `research.md` could not confirm the behaviour of an unbounded
   synchronous hang against `waitUntil:'load'` without running it. This is a deferral, not an
   oversight; the implementer records the outcome in `progress.md`.
