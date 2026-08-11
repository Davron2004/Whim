## 1. The diagnostic kind (D4)

- [ ] 1.1 Add `containment_unobserved` to `DIAGNOSTIC_KINDS` in `checks/contract.ts`, in the
  runtime-observed block next to `containment_failure`, and extend the module's roster doc-comment
  with its one-line meaning ("no authenticated containment verdict was observed"). It is a third
  kind, not a rename or a widening of `mount_timeout` or `containment_failure`.
- [ ] 1.2 Add `containment_unobserved` to `RUNTIME_OBSERVED_KINDS` in `synthrun/observe.ts` and give
  it a `genericHint` case — the hint is mandatory and non-empty (harness-diagnostics req 1), and it
  SHALL describe "the run was never verified", not "the app escaped".
- [ ] 1.3 Update the kind-roster assertion in `checks/test/acceptance.ts` so the closed union and the
  runtime self-check list still cannot drift, and confirm the new kind narrows cleanly through the
  shared server contract package's wire `kind`.
- [ ] 1.4 Write `handoff/diagnostic-kind.md`: the exact kind string, its severity, its hint text, the
  module that declares it, and the rule that no producer may emit it in place of `mount_timeout` or
  `containment_failure` (or vice versa).

## 2. Relay live before navigation (D1)

- [ ] 2.1 Move relay installation out of `EarlyObservers.finish` into the pre-navigation phase
  (`attachObserversEarly`, reached through `RunOptions.beforeNavigate`): the `__whimSynthRelay`
  binding and the `globalThis.ReactNativeWebView` shim `assemble.mjs`'s `toRN()` posts through.
  Carry the `sourceMap` / `ctx.startedAt` values the relay callback needs via the existing
  mutable-slot precedent that `attachObserversEarly` already uses for the CDP handler.
- [ ] 2.2 Keep the installation **main-frame-confined**. Do not use `context.addInitScript` or any
  per-document mechanism: that would also define `ReactNativeWebView` inside the opaque-origin
  sandbox realm, where `loader.js` defines its own same-named stub and `probes.js` asserts the
  parent's is unreachable (design D1, #35/#37, finding F4). `page.evaluate` on the main frame is the
  sanctioned mechanism.
- [ ] 2.3 Move the console listener into the same pre-navigation phase, so `rnLog()`'s console
  fallback and `{__whimHostLog:true,line}` frames emitted before `load` are not lost either.
- [ ] 2.4 Settle the `waitUntil` mode explicitly (design Open Question 2). Do not change it
  speculatively — change it only if the un-quarantined red-check (4.1) cannot otherwise reach
  `awaitMount`, and record the decision and its reason in `progress.md`.
- [ ] 2.5 Update both compositions for the new phase split: `openObservedRun` (`observe.ts`) and the
  production composition in `report.ts`, so `finish(ctx)` retains only what genuinely cannot run
  before navigation.
- [ ] 2.6 Record in `progress.md` any shift in what `bootMs` / `mountToPaintMs` measure. The
  `synthetic-run` spec's determinism requirement is "timings aside", so a shift is permitted — a
  silent one is not.
- [ ] 2.7 Write `handoff/observation-phases.md`: the post-move signature and responsibilities of
  `attachObserversEarly` and `EarlyObservers.finish`, what each installs, and the main-frame
  confinement invariant.

## 3. The three-valued verdict and the forgery signal (D2, D5)

- [ ] 3.1 Widen `RunReport.contained` from `boolean` to `boolean | null` in `synthrun/contract.ts`
  (**BREAKING**), documenting all three states on the field: `true` verdict held, `false` verdict
  reported a breach, `null` no authenticated verdict was ever observed.
- [ ] 3.2 In `report.ts`, emit `obs.state.contained` verbatim instead of `obs.state.contained === true`.
  Leave the separate `paintAtMs ?? budgets.mountBudgetMs` collapse alone — it is a different field
  and a different question.
- [ ] 3.3 In `recordProbesOutcome`, keep `containment_failure` on an explicit `false` only, and emit
  `containment_unobserved` when a `probes` frame arrives whose `contained` is absent or not a
  boolean. Also emit it once at report composition when the run ended with no authenticated `probes`
  frame at all, so `null` never travels without its diagnostic.
- [ ] 3.4 Record rejected forgeries as the **fact** plus a **bounded** count on the report, capped at
  a fixed maximum of **16** (design D5): rejections beyond the cap saturate — the report says "at
  least 16" and does not record them individually. No payload, no per-frame list. No byte of a forged
  frame may reach a diagnostic, a log line, or any report field.
- [ ] 3.5 Write `handoff/run-report-contract.md`: the widened `contained` type verbatim, the forgery
  field's shape and its bound, which diagnostic accompanies which verdict value, and the
  payload-free/never-model-facing invariant.

## 4. Synthetic-run acceptance suite

- [ ] 4.1 Un-quarantine the `mount_timeout` case in `synthrun/test/acceptance.ts` and make it sound:
  a fixture whose hang is **unbounded** (genuinely never paints) and a run path that actually reaches
  `awaitMount`. This is the acceptance test for the ordering fix — delete the quarantine note along
  with the quarantine, and keep the stub red-checks as the non-vacuity anchor.
- [ ] 4.2 Add the D7-local assertion: from inside the candidate's opaque-origin sandboxed realm, the
  `__whimSynthRelay` binding is **not** defined. **If it turns out to be reachable, that is a
  pre-existing containment hole and becomes its own change — do not fix it here.** Record the finding
  in `progress.md` and leave the assertion in place either way (failing red if reachable, so the
  hole is visible rather than reviewed).
- [ ] 4.3 Add cases separating the three verdict states end-to-end: a contained run (`true`), a
  genuine breach (`false` plus `containment_failure`), and an unobserved verdict (`null` plus
  `containment_unobserved`, no `containment_failure`), including the malformed-payload path.
- [ ] 4.4 Keep the forged-verdict cases green (the existing forged-verdict case and the six-way
  hostile case) and extend them: the rejection is recorded, the count is bounded under a flood, and
  no forged payload appears anywhere in the report.
- [ ] 4.5 Triage suites that move because frames previously dropped in the race now arrive. A broken
  assertion here is a finding to be understood and recorded, not noise to be re-baselined.
- [ ] 4.6 Run `npm run synthrun:test` (gate-full only) green, and confirm no quarantined case remains
  in the file for this cause.

## 5. Pipeline consumers of the widened type (D3, D6)

- [ ] 5.1 `server/src/generation/stages/run.ts` — discriminate all three values explicitly rather than
  letting `=== false` catch the collapsed null. An unobserved verdict maps to its own outcome, still
  carrying `diagnostics: []` so "feeds nothing back to the model" holds at the type level.
- [ ] 5.2 `server/src/generation/machine.ts` — model the unobserved state as a **third arm of the
  `RunOutcome` union** (design D8-local), never as a discriminant field or extra boolean hung off an
  existing arm: a field lets a `switch` handling both old arms keep compiling while mishandling the
  new state, which re-creates the collapse one layer up and defeats D2's enforcement argument. Add
  the terminal branch beside `contained-failure`. It consumes no repair attempt, builds no repair
  prompt, emits its `stage`/`done` pair and a single `failure` terminal event, and is never re-run.
- [ ] 5.3 Add a distinct user-facing reason constant beside `CONTAINMENT_FAILURE_REASON`, with the
  copy settled by design D6 verbatim: `We couldn't verify this app ran safely. Please try again.`
  This is a settled product decision, not an implementer's choice — do not reword it. It must not
  drift into asserting a breach or implying the app is fine. The `FailureScreen` affordances and the
  existing one-tap "Try again" path are unchanged; the sentence points at that affordance rather than
  promising an automatic retry (D3 declines to add one).
- [ ] 5.4 Update `server/test/e2e.ts`: `fakeReport`, `containedDetail`, and the fixtures around
  `:190-243` and `:294` for the widened type; add a case asserting the unobserved outcome is terminal,
  spends no repair attempt, and carries the new reason rather than the containment-failure one.
- [ ] 5.5 Assert no forgery or unobserved-verdict detail reaches any assembled prompt (the
  prompt-injection guard in the `generation-pipeline` delta).

## 6. Evals consumers

- [ ] 6.1 `evals/adapters/synthetic-run.ts` — stop hardcoding `containment.authenticated: true`
  (design Open Question 1, resolved: yes, in scope). Derive it from the now-real distinction: a
  `null` verdict is an un-authenticated/unobserved verdict, which `tier-a.ts:25` already fails.
  Replace the docstring that justified the hardcode with what the mapping now is.
- [ ] 6.2 Update `evals/test/fixtures/synthetic-run-report.json` and any adapter/tier test fixture the
  widened type touches, so the three states are represented rather than only the passing one.
- [ ] 6.3 Add an adapter test pinning the mapping: `true` → authenticated+contained, `false` →
  authenticated+not-contained, `null` → not-authenticated (Tier A fails as an untrusted verdict,
  never as a pass). Confirm `evals/tiers/tier-a.ts` needs no change.
