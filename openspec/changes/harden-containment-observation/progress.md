# Progress ledger: harden-containment-observation

Append-only. Every disposition recorded AS IT HAPPENS.

## Run parameters

- `run-start` — staging branch `integration/harden-containment-observation`, cut from **`redesign`**
  at `63a369dd67343d4d1a03a508ce9fdbb865ecc217`.
- **Runbook deviation (user-directed):** this run stages on `redesign`, not `main`. Closure merges the
  staging branch back into `redesign` and pushes it so CI runs, rather than opening a PR into `main`.
  The ruleset precondition / draft-PR / ready-flip closure lane does not apply to this run.
- Chain DAG: 1 → 2 → 3 → {4, 5, 6}. Chains 4/5/6 are file-disjoint and run in parallel.
- Model assignment (deliberate, not session default): opus/high for chains 2–5, which each carry a real
  judgment call — chain-2's main-frame confinement trap + the deferred `waitUntil` question, chain-3's
  three-valued semantics and attacker-controlled forgery record, chain-4's "record the hole, don't fix
  it" scope discipline, chain-5's third-union-arm modelling. sonnet/high for chain-6 (mechanical
  adapter + fixtures). Chain-1 ran on opus/high; in hindsight it is mechanical enough for sonnet, but it
  was already in flight when that was reconsidered.
- No HUMAN-BOOTSTRAP chains. `build/assemble.mjs`, `src/runtime/web/loader.js`, `probes.js`,
  `invariants/` and `build/*` stay read-only by design.

## Dispositions

- `dispatched` chain-1 (diagnostics-kind-vocabulary), BASE `63a369dd67343d4d1a03a508ce9fdbb865ecc217`,
  worktree `.claude/worktrees/hco-1`, branch `chain/hco-1`. Implementer dispatched on opus/high.
  Worktree pre-built; `node_modules/@whim/{contract,server}` symlinked to shadow the primary tree.
- `report` chain-1 — STATUS complete, GATE PASS, commit `a6dc694`, 4/4 tasks, contract
  `handoff/diagnostic-kind.md` (94 lines). Implementer red-checked its own tests: with the two source
  edits stashed `checks:test` went 3 FAIL / 64 PASS (roster length, missing trio member, synthrun roster
  missing the kind), restored → 67 PASS. Non-vacuity established, not asserted.
- `deviation` chain-1 [Class A] — added a second acceptance test asserting
  `RUNTIME_OBSERVED_KINDS ⊆ DIAGNOSTIC_KINDS`, which required a **value** import of the roster array
  from `synthrun/observe.ts` into `checks/test/acceptance.ts`. ACCEPTED: this is what actually locks the
  harness-diagnostics scenario "declared in the contract module rather than minted at its producer" —
  a string-only addition would leave the producer free to drift. Safe against the Node-suite bundling
  constraint because `observe.ts`'s Playwright imports are all `import type`, so nothing runtime enters
  the test bundle; the passing fast gate is the evidence, not the implementer's prose.
- `integrity` chain-1 — exit 0. Changed set vs BASE exactly matches the declared file scope
  (`checks/contract.ts`, `checks/test/acceptance.ts`, `synthrun/observe.ts`, + the handoff contract).
- `merged` chain-1 → `fa84764`. Tasks 1.1–1.4 ticked.
- `regate-pass` chain-1 — `FAST GATE PASSED` on the merged tip, with `GATE_BASE` pinned to the recorded
  run base `63a369d` rather than the movable `HEAD`.
- `note` chain-1 — wire narrowing needed no schema change: `contract/src/index.ts` re-exports
  `DiagnosticKind` type-only and the wire `Diagnostic.kind` is an open `z.string()`. Also noted: a stale
  comment above `RUNTIME_OBSERVED_KINDS` ("Chain 5 … is the ONE place that adds these kind strings")
  predates this change and was left untouched for minimal diff — flagged for the reviewer, not a defect.
- `dispatched` chain-2 (synthrun-relay-ordering), BASE `fa84764`, worktree `.claude/worktrees/hco-2`,
  branch `chain/hco-2`, implementer on opus/high.
- `report` chain-2 — STATUS complete, GATE PASS, commit `acb1aed`, 7/7 tasks, contract
  `handoff/observation-phases.md` (105 lines). Separately ran the gate-full-only suite:
  `npm run synthrun:test` → 80 checks passed, 1 quarantined (the pre-existing `mount_timeout`
  quarantine, chain-4's to lift). No suite moved.
- `integrity` chain-2 — exit 0; changed set exactly the declared scope (`synthrun/observe.ts`,
  `synthrun/report.ts`, `synthrun/session.ts`, + the handoff contract). No probe scaffolding survives
  in either tree (verified by find, both trees).

### Task 2.4 — the `waitUntil` decision (design Open Question 2), settled by measurement

**Mode UNCHANGED**: `session.ts` keeps `waitUntil:'load'`, timeout 20000.

The hypothesised risk **did not reproduce**. A throwaway probe (deleted before commit) ran real Chromium
against the production assembled page with a candidate hanging synchronously for an hour at top level:
`page.goto(..., {waitUntil:'load'})` **resolved in ~30ms** and did not throw. (`'commit'` ~3ms,
`'domcontentloaded'` ~12ms — neither offered anything extra.)

**Why**, and this is the load-bearing part: the outer page's `load` fires once the sandboxed iframe's own
srcdoc has loaded, and the candidate bundle is only *delivered* afterwards over postMessage. So a
never-painting candidate **cannot** delay `load` at all. End-to-end through the real path,
`openObservedRun` returned in 149ms, `awaitMount` produced `mount_timeout` with `paintAtMs === null` and
zero frame events, and `dispose()` returned in ~4ms with the renderer wedged. `awaitMount` is soundly
reachable for an unbounded-hang fixture with the mode as-is.

**Correction to the record:** the existing quarantine comment's stated cause — "the hang blocks the outer
page's `load`" — is measurably **wrong**. The real cause was the relay-install race, which is exactly what
D1 fixed. Chain-4 can therefore lift the quarantine with an unbounded-hang fixture and no `waitUntil`
change; that exact path was verified end-to-end.

### Task 2.6 — shift in what the timings measure

- **`bootMs` — no shift.** Still `Date.now()` from just after build to just after `page.goto` resolves,
  and `waitUntil` is unchanged.
- **`mountToPaintMs` — shifts DOWNWARD.** It is fed by `ObservationState.paintAtMs`, now measured from the
  moment `attachObserversEarly` installs the relay (immediately pre-navigation) instead of from
  `RunContext.startedAt` (= `bootStart`, before page assembly). It therefore no longer includes page
  assembly, the temp-file write, `newContext` and `newPage` — tens of ms on this machine (measured
  `paint@57ms` on the attach clock for a healthy candidate). Same for every `FrameEvent.atMs`.
- **Second-order shift, same field:** values that used to read `null` because the frame was *lost* in the
  install race now carry a real number, so `mountToPaintMs` will stop falling back to
  `budgets.mountBudgetMs` on runs that actually painted. This is the bug being fixed showing up in the
  timings, not a regression.
- Spec determinism is "timings aside"; no diagnostic, event kind, action sequence or verdict changes as a
  result. (Independently checked by the reviewer — see the adjudication entry below.)

### Adjudication — chain-2's deviation reclassified A → **B** by reviewer audit

The implementer self-classified its mechanism swap as Class A. A reviewer was dispatched on the chain-2
diff (per the runbook: adjudication requiring the diff goes to the reviewer, not the dispatcher) and
reclassified it **Class B — spec-affecting**. Summary of the audit:

**The mechanism swap was forced, and tasks 2.1 + 2.2 are jointly unsatisfiable as written.** 2.1 says
install pre-navigation; 2.2 names `page.evaluate` as the sanctioned mechanism. But a pre-navigation
`page.evaluate` global belongs to the `about:blank` document and does not survive the candidate page's
commit, and Playwright offers no main-frame-only per-document hook. `page.addInitScript` + a
`top === self` guard is the correct engineering answer. **This is a plan defect, not implementer taste.**

**Confinement of `ReactNativeWebView` is real.** The `top === self` guard was probed adversarially and
fails safe in every direction: a candidate-created nested iframe still sees the real `top`; a detached
frame gets `top === null` → early return; a popup finds `relay === undefined` → early return. The sandbox
keeps `loader.js`'s own stub, so `probes.js`'s assertion is unaffected. Registration order is load-bearing
and correct (`exposeFunction` awaited BEFORE `addInitScript`), but is pinned by prose only — no test.

**However — the scrub is name-level, not capability-level (HIGH).** Playwright implements `exposeFunction`
as three separable pieces; chain-2's `delete g[name]` removes only the third (the per-binding wrapper).
The raw CDP channel `__playwright__binding__` and the context-level
`__playwright__binding__controller__` remain in the opaque-origin sandbox realm, and host-side
`PageBinding.dispatch` routes by the payload's `name` field with **no calling-frame check**. The reviewer's
claimed one-line re-acquisition from inside the sandbox:

```js
globalThis['__playwright__binding__controller__'].addBinding('__whimSynthRelay');
globalThis['__whimSynthRelay'](JSON.stringify({kind:'probes',trusted:true,payload:{contained:true}}));
```

would let a hostile candidate forge a *trusted* `probes` frame and set the verdict to `true` from inside
the sandbox — finding F4's exact class. Same exposure claimed for `whimHostDispatch`
(`synthrun/capability.ts`, exposed at CONTEXT level, not scrubbed at all). **Pre-existing, not created by
chain-2** — the pre-D1 code installed the wrapper into the sandbox realm too.

**Status of that claim: NOT YET CONFIRMED.** The reviewer derived it by reading Playwright's bundled
source and explicitly did not execute it. A `verifier` was dispatched to run the repro end-to-end before
this is treated as fact. Recorded here as a claim under test, not a finding.

**Consequence for chain-4 (this is the part that changes the plan).** Task 4.2 asserts
`__whimSynthRelay` is undefined in the sandbox realm. If the claim holds, that assertion now passes
**vacuously** — chain-2 scrubbed the *name* while the *capability* remains one call away. D7-local
expected 4.2 to possibly return a positive finding; as written it would return a negative one. That is the
vacuous-assertion failure mode arriving from the code side rather than the test side.

**Scope reading (reviewer, Q2): (b) — the scrub is separable, not incidental.** Confinement needs only the
`top === self` guard; deleting the scrub lines leaves confinement intact. So the scrub is a partial fix to
a pre-existing hole that D7-local and chains.md both say "becomes its own change".

**Other findings:** MED — the `exposeFunction`-before-`addInitScript` ordering is silently load-bearing,
documented in prose only, pinned by no test. LOW — the shim captures `relay` before the guard (unreachable,
but the read could move below it). LOW — `acceptance.ts:712`'s `mountToPaintMs > 0` now has a ~57ms margin
instead of a whole-boot margin. Report honesty: FILES TOUCHED matched exactly; no Class-1/Class-2 file
touched; no checker weakened; no residue. Two honesty discrepancies noted: the deviation was
self-classified A when it is B, and the timing-anchor justification ("for exactly the frames this change
exists to capture") is contradicted by the implementer's own measurement in the same handoff, which
records that on a healthy candidate every frame arrived after `openRun` returned. The anchor change is
still correct in principle; the evidence cited for it was overstated.

**Contract defect (HIGH), consequential because contracts are read INSTEAD of code:**
`handoff/observation-phases.md` asserts "The scrub is what makes the containment invariant true." That is
false. Chain-3's dispatch block carried an explicit correction so the false claim is not built upon.

- `merged` chain-2 → `740210b`. Tasks 2.1–2.7 ticked. Merged despite the Class-B reclassification because
  the chain's core work is sound and correct, it introduces no containment regression (the hole is
  pre-existing), and every remaining chain is blocked behind it. The re-plan it forces is scoped to the
  spec text and chain-4 — see the OPEN ITEMS section.
- `regate-pass` chain-2 — `FAST GATE PASSED`, exit 0, `GATE_BASE` pinned to `63a369d`.
- `dispatched` chain-3 (synthrun-verdict-tristate), BASE `740210b`, worktree `.claude/worktrees/hco-3`,
  branch `chain/hco-3`, implementer on opus/high. Dispatched in parallel with the verifier because its
  scope (verdict tristate + forgery bound) is untouched by the containment question.
- `dispatched` verifier (opus/high) — empirical confirm/refute of the sandbox relay-escape claim.

### VERIFIED FINDING — sandbox realm can forge the containment verdict and reach host syscalls

`verifier` (opus/high) reproduced the reviewer's claim **by execution**, two runs against the primary tree
at `740210b` (chain-2 merged), through the real `SynthRunSession` + `attachObserversEarly` +
`wireCapabilityBridge` path with a hostile candidate. Working tree untouched; probe deleted.
**Status: CONFIRMED, not inferred.** Sandbox realm identified as
`{"origin":"null","isTop":false,"href":"about:srcdoc"}`.

1. Chain-2's scrub **does** work at the name level: `typeof __whimSynthRelay === "undefined"` in the
   sandbox realm before the attempt.
2. But both Playwright internals survive there: `__playwright__binding__controller__` → `"object"`,
   `__playwright__binding__` → `"function"`. Also visible from inside the sandbox: `whimHostDispatch`,
   `__whimRequire`, `__whimSyscall`, `__whimRunProbes`, `__whimGeneration`, `__WHIM_VC_SDK__`.
3. Re-acquisition succeeds in one line — `addBinding('__whimSynthRelay')` → `"ok"`, and the name becomes
   `"function"` again.
4. **Decisive:** the forged payload reaches the host relay callback and controls the verdict. Run 1
   recorded two candidate-authored frames as `trusted: true`, including a `containment_failure`
   diagnostic the candidate wrote itself. Run 1 was ambiguous because the genuine frame landed last, so
   run 2 forged again at `setTimeout(…, 1200)` — after the genuine `contained:true` frame — and the run
   ended `contained = false`. `recordProbesOutcome` assigns unconditionally, so
   **`ObservationState.contained` is last-writer-wins over a channel the candidate can write to, in either
   direction.** A hostile candidate pins the verdict to `true` by forging on an interval. The outer page's
   nonce check is bypassed entirely — the forged frame never transits `toRN()`.
5. **`whimHostDispatch` is worse: not scrubbed at all**, so no re-acquisition is even needed
   (`"dispatchBefore":"function"` directly in the sandbox realm). A hand-rolled syscall frame bypassed
   `__whimSyscall` and the generation fence, returned `{"ok":true}`, was recorded host-side as a
   legitimate syscall (`storage.kv.set`), and actually wrote `FORGED_BY_SANDBOX = "pwned"` to the engine.

**Scope of the finding:** harness-side (`synthrun`, the generation pipeline's verification vantage), NOT
the product runtime. Chromium-only; the real Android System WebView was not tested and is out of scope
here. **Pre-existing** — it predates this change; pre-D1 code installed the wrapper into the sandbox realm
too. This change neither created nor widened it.

**Severity:** critical for what synthrun exists to do. A candidate that can pin `contained: true` defeats
the verification vantage that decides whether an app ships — finding F4's class, one layer up.

**Explicitly NOT established** (do not treat as known): whether scrubbing the controller and raw binding
as well actually closes it — Playwright may re-add per-binding init scripts, and `Runtime.addBinding`
operates *below* the JS global. Nobody should treat "scrub three names instead of one" as the fix without
its own probe. Also unexamined: whether a `frameId`/`executionContextId`-aware alternative (binding payload
inspection, or routing observation over CDP instead of `exposeFunction`) exists in the pinned Playwright.

## DISPOSITION OF THE VERIFIED FINDING — user decision, 2026-08-11

The finding was surfaced to the user mid-run with three options (finish and follow up / widen this change
to fix it / halt the run). **User chose: finish this change and come back to the escape afterwards, with
an explicit requirement that the finding not be lost.** That matches design D7-local, which routed a
positive result here by construction.

Recorded in three independent places so it cannot be forgotten:

1. **`openspec/changes/harden-synthrun-binding-isolation/`** — a filed OpenSpec change carrying the full
   verified evidence, the measured repro, the explicit "not yet known" list (notably: scrubbing three
   names instead of one is an untested hypothesis, because `Runtime.addBinding` operates *below* the JS
   global), and an ADDED `synthetic-run` requirement demanding capability-level unreachability, host-side
   frame provenance, and a non-last-writer-wins verdict. Validated against gate-full's exact command
   (`openspec validate --all --strict` → 44 passed, 0 failed). It now appears in `openspec list`.
2. **A quarantined red test in `synthrun/test/acceptance.ts`** (chain-4, task 4.2b) that asserts the real
   property and fails today, naming the follow-up change. Executable documentation.
3. **A session-crossing memory** (`synthrun-playwright-binding-escape`).

## OPEN ITEMS

1. **Spec text vs shipped mechanism — STILL OPEN, needs the user's wording call.** The MODIFIED
   `synthetic-run` requirement says installation "SHALL NOT be performed per-document in every frame".
   The shipped code uses `addInitScript`, which IS that mechanism, guarded so the prohibition's stated
   *purpose* (no host transport global in the sandbox realm) holds. The sentence as written is literally
   false about the code. The user asked why the mechanism was forbidden rather than picking an option;
   the explanation was given (the sandbox realm must contain only `loader.js`'s own stub, and
   `probes.js:81-82` asserts the parent's transport is unreachable — a per-document install would hand
   candidate code a real host pipe that never transits the nonce check). Proposed replacement wording to
   be drafted and shown before it is written.
2. **Task 4.2 re-scoped and dispatched** — chain-4 now writes TWO assertions: 4.2a live/green, pinning
   chain-2's actual achievement (`RELAY_BINDING_NAME` undefined as installed, and the sandbox's
   `ReactNativeWebView` being `loader.js`'s stub rather than the host transport); 4.2b quarantined/red,
   asserting capability-level unreachability and naming `harden-synthrun-binding-isolation`. Resolved.
3. **The pre-existing hole has its own change** — resolved, see above.

## Dispositions (continued)

- `merged` chain-3 → `5f20cf5`. Tasks 3.1–3.5 ticked. Integrity exit 0, scope exactly as declared (the
  one-line `synthrun/test/acceptance.ts` touch is the implementer's declared Class-A deviation:
  `stubObservers()` needed the new required `ObservationState.rejectedForgeries` field, and `synthrun/test`
  is not tsconfig-excluded the way `evals/test` and `server` are).
- `regate-fail (EXPECTED, not parked)` chain-3 — exit 1. **Verified to be exactly and only the two
  predicted cross-chain errors**, with 206 checks passing:
  `evals/adapters/synthetic-run.ts(36,41) TS2322` (chain-6's task 6.1) and
  `server/test/e2e.ts(40,3) TS2322` missing `forgeries` (chain-5's task 5.4). The runbook's revert-and-park
  response is for an *unknown* regate failure; this is a declared red window inherent to a BREAKING type
  widening deliberately split across chains (task 3.1 is marked BREAKING; 5.4 and 6.1 are its named
  fixes). Reverting would have undone the change's semantic core to satisfy a rule aimed at a different
  situation. Cleared by merging chains 5 and 6.
- `finding` chain-3 — **D2's compiler-enforcement argument is partly false, and this changes chain-5's
  brief.** Widening `contained` to `boolean | null` does NOT produce a compile error in
  `server/src/generation/stages/run.ts` or `machine.ts`: `report.contained === false` remains legal
  TypeScript against `boolean | null`, so both files compile untouched while silently treating
  "unobserved" as "not a breach, proceed" — the original collapse, one layer up, in the subsystem that
  decides whether an app ships. The compiler only catches sites that *assign* to a `boolean` or build a
  `RunReport` literal. Consequence: tasks 5.1/5.2 must be done deliberately, never by chasing tsc output,
  or chain-5 produces a green gate over an intact bug. Written into chain-5's dispatch block verbatim and
  into `handoff/run-report-contract.md`.
- `deviation` chain-3 [Class A] — minted the forgery field name/shape itself
  (`RunReport.forgeries: ForgeryTally`, `REJECTED_FORGERY_CAP = 16`); design D5 fixes the cap and the
  semantics but names no field. Accepted: the design left the naming open by omission, and the shape is
  declared in the handoff contract that chains 4/5/6 build against.
- `note` chain-3, out of scope, un-actioned: `build/assemble.mjs:146` does
  `rnLog('REJECTED-FORGERY kind=' + m.kind)` — an attacker-chosen string in the *page's* console. It
  reaches no harness log line (the console listener records only a heartbeat timestamp) and no report
  field, so D5's invariant holds. Class-2 code, pre-existing. Recorded, not fixed.
- `dispatched` chains 4, 5, 6 in parallel — shared BASE `5f20cf5`, worktrees
  `.claude/worktrees/hco-{4,5,6}`, branches `chain/hco-{4,5,6}`. File-disjoint by the chains.md partition;
  all three depend only on chain-3. Models: chain-4 opus/high (scope-discipline judgement on the
  re-scoped 4.2), chain-5 opus/high (D8-local union modelling, and the anti-tsc-chasing brief),
  chain-6 sonnet/high (mechanical adapter + fixtures).
- `report` chain-6 — STATUS complete, commit `46a9720`, 3/3 tasks. Claimed GATE PASS in its own worktree
  with only the pre-authorised `server` exception (chain-5's in-flight `e2e.ts:40`). **Verified, not
  taken on trust:** integrity exit 0 with the changed set exactly the declared scope, and `npx tsc
  --noEmit` inside `.claude/worktrees/hco-6` returned completely clean.
- `merged` chain-6 → `bcf67cd`. Tasks 6.1–6.3 ticked. Root `tsc` on the merged tip is now fully clean —
  the `evals/adapters/synthetic-run.ts:36` half of chain-3's expected red window is cleared. Only
  chain-5's `server/test/e2e.ts:40` remains, and `server` is excluded from the root tsconfig (checked
  separately by the `server:test` gate step), which is why root tsc reports clean while that check does
  not yet pass.
- `finding` chain-6 [Class B, HARNESS DEFECT, outside this change's scope] —
  **`.claude/hooks/gate-on-subagent-stop.sh` gates the wrong tree.** It resolves
  `ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"` and runs
  `"$ROOT/scripts/gate.sh"`. `CLAUDE_PROJECT_DIR` is empty in a worktree implementer's session and the
  executing hook file is the PRIMARY tree's copy, so ROOT is the primary/integration tree — while the
  hook's own dirty-check (`git diff --quiet`, line 32) runs in the subagent's worktree cwd. It gates a
  different tree than the one it just decided was dirty.

  **Confirmed by the dispatcher by reading the hook**, not accepted on the implementer's word.

  Consequence: an implementer whose chain FIXES a pre-existing error is guaranteed to be told its fix
  failed, because that fix is by construction not yet merged into the tree the hook checks. Bounded only
  by the 2-attempt cap in `/tmp/gate-attempts-<session>`. Chain-6 hit exactly this: the hook kept
  reporting chain-6's OWN original, unfixed `evals/adapters/synthetic-run.ts:36` error back at it.

  **Direction of failure is safe — false BLOCKS, never false passes.** It does not undermine any
  `GATE: PASS` reported this run: `gate.sh` opens with `cd "$(dirname "$0")/.."`, so an implementer
  running `./scripts/gate.sh` from inside its worktree gates that worktree correctly. Only the hook's
  absolute-`$ROOT` invocation is wrong.

  Fixing it is Class-2 (`.claude/hooks/**`) and needs human ratification — **not done in this change**.
  Recorded as memory `subagent-stop-hook-gates-wrong-tree`. Suggested fix: resolve ROOT from the worktree
  implied by cwd rather than from the hook file's own location.
- `report` chain-5 — STATUS complete, commit `187ae46`, 5/5 tasks. `server:test` 693 passed; Chromium
  `server:e2e` 40 passed. Integrity exit 0. **The brief's premise held exactly:** neither `run.ts` nor
  `machine.ts` errored from chain-3's widening; both were corrected by reading, not by chasing tsc — which
  is precisely why chain-3's finding was worth escalating into the dispatch block.
- `deviation` chain-5 [Class A ×3], all accepted:
  (i) added the machine-level acceptance case to `server/test/machine.suite.ts`, outside the declared
  3-file scope and owned by no other chain, **because `server/test/e2e.ts` is Chromium-backed and runs
  only in gate-FULL (`server:e2e`), not in the fast gate (`server:test`)** — a case placed only there
  would be exercised once per change instead of on every attempt. Dispatcher verified this against
  `scripts/gate.sh:61` and `scripts/gate-full.sh:41`. Good judgement, not scope creep.
  (ii) extracted `failureTerminalFor(outcome, state)` from `runRepairLoop` — the added terminal branch
  pushed sonarjs/cognitive-complexity 15 → 17 and failed lint. The extraction is an exhaustive switch over
  the three failure outcomes, so it also enforces that any future terminal outcome must decide what the
  user is told. A lint constraint turned into an invariant.
  (iii) `containedDetail` in `e2e.ts` renders the forgery tally (count only, never payload) — a CI log
  line is not a model-facing path.
- `red-check` chain-5 — collapsing `null` onto `contained-failure` produced 2 failures (wrong user-facing
  reason), then restored. Non-vacuity established by experiment.
- `merged` chain-5 → `0572311`. Tasks 5.1–5.5 ticked.
- `note` chain-5, out of scope: `stages/run.ts`'s adapter is covered only by the Chromium e2e suite — the
  fast gate never exercises the run stage, by `stages.suite.ts`'s design. Fast-gating that adapter is a
  separate small change if wanted.
- `report` chain-4 — STATUS failed-gate, commit `81f3843`, 6/6 tasks. The gate failure was exactly and
  only the two cross-chain errors (`evals` + `server`), both since merged; re-verified green after merge.
  `npm run synthrun:test`: **129 passed, 0 failed, 1 deliberate quarantine, identical across 3 consecutive
  runs** (stability checked, not assumed). Integrity exit 0, single file touched.
- `deviation` chain-4 [Class A ×3], all accepted: 4.2 implemented per the dispatcher's re-scope (4.2a live
  + 4.2b quarantined) rather than tasks.md's literal single assertion; the malformed-verdict scenario is
  driven by posting one frame from the OUTER page's own realm via `ReactNativeWebView` because `probes.js`
  cannot be made to emit a non-boolean `contained` — paired with a same-seam red-check
  (`contained:false` → `containment_failure`) so it cannot pass against a dead channel; and the inline
  `harmless` source in the existing pipeline red-check was replaced with the module-level
  `FIXTURE_HARMLESS` rather than adding a fourth copy.
- `merged` chain-4 → `10b5d47`. Tasks 4.1–4.6 ticked. **All 27 tasks now ticked; 0 remain.**
- `task 4.5 triage` — nothing moved. Every pre-existing case still passes unchanged; no assertion was
  re-baselined. The design's risk "newly reliable frames change existing assertions" did not materialise.
- `gate-full PASS` on the merged tip `10b5d47` — every suite green including `synthetic-run`,
  `generation-e2e`, `invariants`, `bridge-invariants`, `metro-guard`, knip, `codex-sync`, and
  `openspec validate --all --strict` (which now also validates the newly filed follow-up change).
- `cleanup` — all six chain worktrees removed and chain branches deleted UNSANDBOXED (per docs/harness.md
  §11, to avoid stranding dead `.git/config` sections). No stray probe/scaffolding file anywhere in the
  tree; exactly one `quarantined(` call site remains and it is chain-4's deliberate 4.2b.

### FINDING — `forgeries.rejected` is true in EVERY run, including clean ones

Reported by chain-4 and flagged for the reviewer to confirm. `probes.js`'s T6b pen test posts an
unauthenticated spoof frame from inside every sandbox realm, so the outer page rejects at least one frame
on **every** run that reaches the oracle. `RunReport.forgeries.rejected` is therefore `true` and
`count >= 1` even for a perfectly clean candidate.

**Consequence:** the forgery tally does NOT distinguish a hostile candidate from a clean one. D5's
mechanical requirements are still met — the signal is bounded (cap 16, saturating) and payload-free — but
the *interpretation* stated in this change's proposal and in `handoff/run-report-contract.md`
("`null` accompanied by a rejected forgery is a candidate that tried to lie about its own containment") is
**wrong as written**: the baseline is one rejection, not zero. Any consumer reading `rejected: true` as
hostility would be reading the harness's own pen test.

This is a documentation/interpretation defect, not a containment or safety defect, and it was found by the
chain that wrote the tests rather than by the chain that wrote the field. Disposition pending the final
reviewer's confirmation.
