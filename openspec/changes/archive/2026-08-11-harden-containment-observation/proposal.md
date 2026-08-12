## Why

The synthetic-run harness opens its observation relay *after* `page.goto`, so every frame the
outer page emits between document commit and `load` is silently dropped — including the trusted
`paint` and `probes` frames that carry the containment verdict. When that happens the verdict is
never observed, and `report.ts` collapses the unobserved state into `contained: false`, which is
the same value a genuine sandbox escape produces. The repo's highest-stakes invariant therefore
has a failure mode where "we could not hear the guard" is indistinguishable from "the guard said
no" — and the user is told their app "could not be safely run" when in fact nothing ran at all.

This surfaced as an intermittent `gate-full.sh` failure (2 failures against 10+ passes on
identical code) that cost a full debugging session precisely because the two cases could not be
told apart from a log. Decision #55 already names the structural fix; `synthrun`'s own acceptance
suite carries a **quarantined** `mount_timeout` red-check that is unsound for exactly this reason
and cannot be made sound until the ordering is corrected.

## What Changes

- **Open the observation relay before navigation.** The relay and the `ReactNativeWebView`
  transport it backs must be live before the delivered page's inline scripts run, so no frame is
  dropped. Installation stays confined to the main frame — anything installed per-document in
  *every* frame would define `ReactNativeWebView` inside the opaque-origin sandbox realm, which
  `probes.js` asserts is unreachable.
- **BREAKING** — **`RunReport.contained` widens from `boolean` to `boolean | null`.** `null` means
  "no authenticated verdict was ever observed" and is a distinct state from `false` ("an
  authenticated verdict reported a breach"). Every consumer must discriminate explicitly; the
  type-checker enforces it.
- **An unobserved verdict is terminal, but never reported as a containment failure.** It ends the
  run with its own reason and its own named diagnostic. It consumes no repair attempt, feeds
  nothing back to the model, and is never treated as contained. The existing user-facing "Try
  again" affordance is unchanged and remains the recovery path.
- **Correct the user-facing copy.** A run that was never observed must not tell the user their app
  "could not be safely run and was not delivered" — that asserts a breach that was not observed.
- **Make rejected forgeries observable, and treat them as a distinct signal.** `assemble.mjs`
  already emits a `rejected-forgery` frame when the nonce check fails, but that frame travels the
  same relay and is droppable on the same race — so the tamper signal is unreliable today for
  exactly the same reason the verdict is. Once the ordering is fixed, the rejection SHALL be
  recorded reliably. It is **not** a hostility signal: the harness's own T6b pen test
  (`probes.js`'s unauthenticated `spoof-probe`, rejected by `assemble.mjs`) trips it from every
  realm, so the baseline for a clean candidate is at least one and rises with realm resets. What
  the signal buys is a bounded, payload-free record that forgery rejection is occurring at all,
  plus a saturating count that separates ordinary operation from a candidate flooding the channel.
  Constraints on that signal, because a forged frame's contents are attacker-controlled input:
  - Record the **fact** of rejection and a **bounded** count. The forged payload SHALL NOT be
    echoed into diagnostics, logs, or the report — otherwise the candidate chooses what lands
    there, and an unbounded list is a log-exhaustion lever.
  - Forgery detail SHALL NOT reach any model-facing path. D7/D8 already guarantees containment
    outcomes feed nothing back to the model; this makes it explicit rather than incidental,
    because a diagnostic that reached the repair loop would be a prompt-injection channel written
    by the candidate.
- **Treat an unobserved verdict as security-relevant telemetry, not noise.** A genuine escape
  followed by verdict suppression presents as `null` rather than `false`. Containment is not lost
  — neither state is delivered — but detection is: an attacker can otherwise launder a breach into
  something indistinguishable from a harness flake.
- **Un-quarantine the `mount_timeout` red-check** and make it sound, as the acceptance test for
  the ordering fix.
- **Verify** whether Playwright's `exposeFunction` binding (`__whimSynthRelay`) is reachable from
  inside the sandboxed iframe. The research digest could not confirm this and no probe asserts its
  absence. If it is reachable that is a pre-existing containment hole and becomes its own change —
  this change adds the assertion either way.

Explicitly out of scope: routing unobserved verdicts into the repair loop. Containment failures
are excluded from repair by decision #56 D7/D8, and that exclusion is deliberate — repair feeds
diagnostics back to the model, and telling a candidate how its escape was detected is a targeting
oracle. Automatic re-running is also rejected: post-fix the dominant remaining causes of `null`
are deterministic (a candidate that never mounts, or one that suppresses its own verdict), so a
retry buys little and hands an adversarial candidate a resource multiplier.

## Capabilities

### New Capabilities

None. This change corrects behaviour in three existing capabilities.

### Modified Capabilities

- `synthetic-run`: the observation relay SHALL be live before navigation, so no frame emitted by
  the outer page is dropped; the run report SHALL distinguish an unobserved containment verdict
  from a negative one rather than collapsing both to `false`; and a rejected forgery SHALL be
  recorded as a bounded, payload-free signal that is distinguishable from plain silence.
- `generation-pipeline`: the terminal rule currently covers a *negative* containment verdict. It
  gains a distinct rule for an *unobserved* verdict — also terminal and also consuming no repair
  attempt, but carrying its own reason and never asserting that a breach occurred.
- `harness-diagnostics`: the closed diagnostic-kind vocabulary gains a named kind for "no
  authenticated containment verdict was observed". The existing `mount_timeout` covers only the
  never-painted cause; a verdict can go unobserved without a mount timeout.

## Impact

**Code**

- `synthrun/session.ts` — the `newPage` → `beforeNavigate` → `goto` sequence.
- `synthrun/observe.ts` — the `attachObserversEarly` / `EarlyObservers.finish` phase split; the
  relay installation currently in `finish`; `recordProbesOutcome`.
- `synthrun/report.ts` — the `contained` collapse at `:132`.
- `synthrun/contract.ts` — `RunReport.contained` widens (**BREAKING**).
- `server/src/generation/stages/run.ts` — the D7 short-circuit at `:54`, which today catches the
  collapsed null via an `=== false` test.
- `server/src/generation/machine.ts` — the `contained-failure` branch and the terminal reason
  string.
- `evals/adapters/synthetic-run.ts` — hardcodes `authenticated: true` today *because* synthrun
  collapses; with a real distinction available it should stop hardcoding.
- Fixtures and tests: `server/test/e2e.ts`, `evals/test/fixtures/synthetic-run-report.json`,
  `synthrun/test/acceptance.ts`.

**Not touched**

- `invariants/` — owner-authored, never edited by an implementing agent. The research confirmed it
  does not import synthrun.
- `build/assemble.mjs`, `src/runtime/web/loader.js`, `probes.js` — the production page, CSP and
  loader may not be forked, patched or loosened to ease testing. These are Class-2 protected; any
  chain that needs to touch them is HUMAN-BOOTSTRAP by construction.

**Already landed** (do not redo): commit `cec5d6c` instruments `server/test/e2e.ts` so a
containment failure prints `contained=…, report.contained=…, diagnostics=[…]`. That is
diagnosis-only and fixes neither defect.

**Governing decisions**: #55 (names this structural fix), #56 D7/D8 (containment failure is
terminal, feeding nothing back to the model), #35/#37 and `docs/spike2-findings.md` (the
containment model and the nonce trust boundary — finding F4: a bundle can forge its self-reported
verdict).
