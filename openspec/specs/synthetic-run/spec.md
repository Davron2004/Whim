# synthetic-run Specification

## Purpose
The server-side "run + observe" harness: one candidate bundle source in, one deterministic run
report out. It boots the unmodified production runtime page in headless Chromium, observes only
from trusted vantages (nonce-authenticated frames plus CDP), runs the real capability
gate/dispatcher/registry over an ephemeral per-run engine, and performs a bounded interaction
sweep with nav-aware screen coverage. Every failure-grade signal is one the candidate cannot
forge; every watchdog outcome is an explicitly named diagnostic, never a silent catch.

## Requirements

### Requirement: One candidate in, one deterministic run report out

The harness SHALL expose a library entry point that accepts one candidate TypeScript source string (the H1b bundle contract: single file importing only `vc-sdk`) plus options (budgets, concurrency handle), and returns a run report containing: the diagnostics list, the containment verdict, per-stage timings (build, boot, mount→paint, sweep, per-screen), the syscall/cue invocation trace, screens visited vs declared, and the applied budget values. Given the same candidate source and options, the sweep SHALL be deterministic: fixed canonical input values, sorted fingerprint action order, no random or wall-clock-dependent branching in the driver.

The report's containment verdict SHALL be three-valued: `true` (a nonce-authenticated `probes` frame reported containment held), `false` (a nonce-authenticated `probes` frame reported a breach), and `null` (no authenticated verdict was ever observed — no `probes` frame arrived, or the one that arrived carried no boolean verdict). The harness SHALL NOT collapse `null` onto `false`, onto `true`, or onto any other single value: "we could not hear the guard" and "the guard said no" are distinct states at the report's type level, so a consumer that ignores the distinction fails to compile rather than silently reproducing the collapse.

#### Scenario: Same candidate, same report

- **WHEN** the same candidate source is run twice with the same options
- **THEN** both reports contain the same diagnostics (kinds, targets) and the same action sequence, timings aside

#### Scenario: An unobserved verdict is not a negative one

- **WHEN** a run produces no nonce-authenticated `probes` frame at all
- **THEN** the report's containment verdict is `null`, not `false`, and the report carries the named unobserved-verdict diagnostic rather than a `containment_failure` diagnostic

#### Scenario: A negative verdict is still negative

- **WHEN** a nonce-authenticated `probes` frame reports a breach
- **THEN** the report's containment verdict is `false` and the report carries a `containment_failure` diagnostic, unchanged from before

#### Scenario: A malformed verdict payload is unobserved, not a breach

- **WHEN** a nonce-authenticated `probes` frame arrives whose containment field is absent or not a boolean
- **THEN** the report's containment verdict is `null` and no `containment_failure` diagnostic is produced

### Requirement: The candidate boots in the unmodified production runtime page

The harness SHALL assemble pages exclusively from the production artifacts (`build/assemble.mjs`'s `buildSrcdoc`/`buildOuterHtml` and `runtime-artifacts.json`'s `parts`) with the locked CSP and real nonce handshake, and SHALL NOT fork, patch, or loosen the page, the CSP, or the loader to ease testing. The candidate SHALL be built with the production esbuild contract (IIFE, classic JSX, externals `{vc-sdk, react, react-dom}`, `tsconfigRaw: '{}'`); if the harness owns a mirrored single-candidate builder, a test SHALL pin it byte-equivalent to `build/build.mjs` output for a fixture app. `invariants/` and `build/*` are consumed strictly read-only.

#### Scenario: Build-contract drift tripwire

- **WHEN** the harness's candidate builder output for a fixture app differs byte-wise from the production build pipeline's output for the same fixture
- **THEN** the harness test suite fails naming the drift

### Requirement: Observation is trusted-vantage only

The harness SHALL derive every failure-grade signal from vantage points the bundle cannot overwrite: nonce-authenticated frames (`delivery`, `paint`, `error`, `probes`), Playwright/CDP-level `pageerror` (throws and unhandled rejections) and console capture, and gate denials read host-side at the harness's own exposed dispatch function. The bundle's self-reports (including `emitUiEvent` and `__whimNavDepth` frames) SHALL be used for sweep bookkeeping only and SHALL NOT determine any diagnostic or the containment verdict.

The host-side transport those frames travel SHALL be live before navigation — installed in the pre-navigation phase, so it is already in place when the delivered page's inline scripts run and no frame the outer page emits between document commit and load is dropped. That installation SHALL be confined to the main frame: the host transport global SHALL NOT be defined in any frame other than the top frame, and in particular SHALL NOT be defined inside the opaque-origin sandbox realm the loader and probes rely on being free of it. A per-document installation mechanism MAY be used provided it is guarded so that the global is defined only where the frame is the top frame; what is guaranteed is the absence of the global from the sandbox realm, not the choice of mechanism. The harness's own suite SHALL assert that the host relay binding is unreachable from inside the sandboxed realm, so the confinement is enforced rather than reviewed.

Opening the transport earlier SHALL NOT widen what is trusted: authentication remains the outer page's nonce check, evaluated before any trusted frame is posted, and the harness SHALL continue to consume the frame's trusted flag rather than re-deriving it.

A frame the outer page rejected as a forgery SHALL be recorded as the **fact** of a rejection plus a **bounded** count. The bound SHALL be a fixed cap declared by the harness, and rejections beyond it SHALL saturate at that cap — read as "at least the cap" — rather than being recorded individually, so the recorded signal is fixed-size no matter how many frames a candidate posts. The forged payload SHALL NOT be echoed into any diagnostic, log line, or field of the run report, and SHALL NOT reach any model-facing path — the payload is attacker-chosen input, so echoing it would let the candidate author our diagnostics and an unbounded list would be a log-exhaustion lever.

#### Scenario: Forged verdict attempt

- **WHEN** a hostile candidate posts forged frames claiming a passing containment verdict and clean execution
- **THEN** the report's verdict and diagnostics derive only from the nonce-authenticated probes frame and CDP-level observation, unaffected by the forgery

#### Scenario: Swallowed denial is still observed

- **WHEN** a candidate invokes an undeclared capability and `.catch`es the rejected promise so no `pageerror` fires
- **THEN** the report still contains the denial diagnostic, collected host-side at the dispatch function

#### Scenario: A frame emitted before load is not dropped

- **WHEN** the outer page emits a nonce-authenticated frame between document commit and the page's `load` event
- **THEN** the harness observes that frame and it contributes to the report exactly as a post-load frame would

#### Scenario: The relay binding is not reachable from the sandbox realm

- **WHEN** the harness suite evaluates, from inside the candidate's opaque-origin sandboxed realm, whether the host relay binding is defined
- **THEN** it is not defined, and the suite fails naming the leak if it is

#### Scenario: A rejected forgery is counted, never echoed

- **WHEN** a candidate posts more forged frames with large attacker-chosen payloads than the harness's declared cap
- **THEN** the report records that forgeries were rejected and a count saturated at that cap rather than the true number, and no byte of any forged payload appears in the report, its diagnostics, or any log line

### Requirement: Host observation channels are unreachable from the candidate realm

The harness SHALL ensure that every host-side channel it opens for observation or capability dispatch is unreachable **as a capability** from the candidate's opaque-origin sandboxed realm — not merely undefined by name. A channel whose name has been deleted from the sandbox realm's global while the underlying binding machinery remains reachable there SHALL NOT be considered isolated, because candidate code can restore the name from that machinery in one call.

This strengthens "Observation is trusted-vantage only" above. That requirement guarantees the *absence of the host transport global* from the sandbox realm, and that guarantee still holds and is still asserted. It is not sufficient on its own: the binding machinery beneath the global is installed by the browser on every execution context and cannot be scoped away, so absence of the name is a hardening measure while host-side refusal is the guarantee.

The harness SHALL establish the provenance of a frame arriving at its host relay rather than accepting the frame's own claim to be trusted. A frame SHALL be attributable to the main frame before it is treated as a nonce-authenticated observation; the outer page's nonce check governs which frames it posts, and the harness SHALL NOT treat a frame that never transited the outer page as though it had. Provenance is an additional necessary condition and SHALL NOT replace the trusted flag: a frame must be both main-frame-attributable and trusted.

An authenticated containment verdict, once observed, SHALL NOT be silently replaceable by a later frame. The harness SHALL NOT resolve competing verdicts by last-writer-wins, because that converts any writable channel into a verdict override. A verdict SHALL only ever move in the fail-closed direction: once a breach has been observed, neither a later passing verdict nor a later malformed payload SHALL soften it, and a refused transition SHALL be recorded rather than dropped.

The harness's own suite SHALL assert capability-level unreachability for each such channel, and that assertion SHALL fail — naming the reachable channel — while any channel remains reachable.

#### Scenario: The relay cannot be re-acquired from inside the sandbox

- **WHEN** candidate code inside the opaque-origin sandboxed realm attempts to restore the host relay binding from the underlying binding machinery and post a frame claiming to be trusted
- **THEN** the frame does not reach the harness's observation state, and the run's containment verdict is unaffected by it

#### Scenario: Host syscall dispatch cannot be reached from inside the sandbox

- **WHEN** candidate code inside the opaque-origin sandboxed realm hand-rolls a syscall frame to the host dispatch channel, bypassing the sandbox-side syscall shim and its generation fence
- **THEN** the call is refused, no host capability is invoked, and no syscall is recorded host-side as legitimate

#### Scenario: An observed verdict is not overridden by a later frame

- **WHEN** a nonce-authenticated `probes` frame has established a containment verdict and a later frame reports a different verdict
- **THEN** the run's verdict is not silently replaced by the later frame

#### Scenario: An observed breach is not laundered through a malformed frame

- **WHEN** a breach has been observed and a later authenticated frame carries a malformed containment payload, followed by a frame claiming containment held
- **THEN** the breach verdict stands, is not softened to an unobserved verdict, and the later claim is refused

### Requirement: Interaction sweep covers the interactive surface with fingerprint dedup

Per rendered screen the harness SHALL enumerate interactive SDK elements from outside the realm (CDP), fingerprint each as (component kind, label/accessible text, DOM path), and act on each fingerprint exactly once in sorted order: tap `Button`/`Card`/`ListItem`; type canonical values into `TextInput`/`NumberInput`; toggle `Switch`/`Checkbox` on and off; select each `SegmentedControl` option; drag `Slider` to min and max; interact inside a present `Modal` before backdrop-dismissing it. The harness SHALL re-enumerate after every action and SHALL terminate the per-screen sweep on no-unvisited-fingerprints, the per-screen action cap, or the global budget — whichever comes first. A truncated sweep SHALL be marked in the report, never silently reported as complete.

#### Scenario: State-minted elements are swept without looping

- **WHEN** tapping a button re-renders the screen with one new button and the existing elements
- **THEN** the new fingerprint is acted on once, already-visited fingerprints are not re-acted on, and the sweep terminates

### Requirement: Screen coverage follows real navigation, then cold-mounts the rest

The harness SHALL treat an observed `__whimNavDepth` change after an action as entry to a new screen and continue the sweep there, bounding cycles with a visited-screen set. After the nav-reachable sweep, each declared `spec.screens` entry never visited SHALL be cold-mounted in a fresh realm (via `__whimControl.reinject({reset:true, …})` — never in-place re-delivery, per T7) and swept; every such screen SHALL produce an `unreachable_screen` warning diagnostic.

#### Scenario: Unreachable screen is rendered and flagged

- **WHEN** a candidate declares screens `{Home, Detail, Orphan}` and no nav path from `Home` reaches `Orphan`
- **THEN** `Orphan` is cold-mounted in a fresh realm, render failures there surface as diagnostics, and the report contains an `unreachable_screen` warning naming `Orphan`

### Requirement: Watchdog makes every timeout an explicit outcome

The harness SHALL enforce: a mount budget (no nonce-authenticated `paint` frame in time ⇒ `mount_timeout` error diagnostic); a per-action quiet-window settle with a hard cap (a heuristic only — steady background activity such as a legal `interval` SHALL NOT produce a diagnostic and SHALL NOT block the sweep past the cap); and a total wall-clock budget (hard page kill ⇒ report marked `run_truncated`). No code path SHALL swallow a timeout silently. The runtime page itself SHALL remain watchdog-free.

#### Scenario: Never-settling mount

- **WHEN** a candidate's mount path hangs (e.g. an unresolvable `delay` before first render) past the mount budget
- **THEN** the run ends with a `mount_timeout` error diagnostic and the report says which budget fired, rather than proceeding on stale page state

#### Scenario: Legal interval never fails the run

- **WHEN** a candidate runs a 100ms `interval` forever but mounts and responds normally
- **THEN** the sweep completes with no timeout diagnostic

### Requirement: Real gate, ephemeral storage, recording effectors

Each run SHALL wire the production capability gate, dispatcher, and registry against a real storage engine created per run via the Node `:memory:` binding; a declared `schema` SHALL be applied to that engine before mount, and an application failure is a diagnostic. Gate verdicts SHALL come from the production gate — the harness SHALL NOT reimplement or approximate authorization. Effectors with no server-side effect (`cues.*`, `diag.*`) SHALL validate through the real gate and then record their invocation into the run report's trace instead of acting. No candidate state SHALL survive into another run (fresh browser context per candidate; fresh `:memory:` engine).

#### Scenario: Undeclared capability yields the production denial

- **WHEN** a candidate whose manifest omits `storage` calls a `storage.kv` verb
- **THEN** the report contains a diagnostic whose `kind` is the bridge gate's own denial kind string, produced by the production gate

#### Scenario: No cross-candidate contamination

- **WHEN** candidate A writes records and candidate B (same appId) runs next
- **THEN** candidate B observes an empty store

### Requirement: Diagnostics extend the central vocabulary additively

Runtime-observed diagnostic kinds (`runtime_throw`, `unhandled_rejection`, `mount_timeout`, `run_truncated`, `containment_failure`, `containment_unobserved`, `unreachable_screen`, and any later additions) SHALL be added additively to the closed vocabulary in the checks contract module — never minted ad hoc — and SHALL reuse the runtime's existing kind string where the same misdeed already has one (bridge denial kinds verbatim). Every diagnostic SHALL carry the mandatory `hint`; `line` SHALL be populated when the failure maps through the build's source map to an original-source anchor, and omitted otherwise (the shared shape's runtime-producer provision).

`containment_unobserved` and `mount_timeout` SHALL remain distinct kinds: `mount_timeout` names the never-painted cause only, and a verdict can go unobserved without a mount timeout (a malformed verdict payload, a suppressed frame, or a failure after a successful paint). A run SHALL NOT report an unobserved verdict as `mount_timeout`, and SHALL NOT report a mount timeout in place of `containment_unobserved` when the mount budget did not fire.

#### Scenario: Throw with a source anchor

- **WHEN** a candidate throws during an `onPress` handler and the stack maps through the source map to original line 42
- **THEN** the report contains a `runtime_throw` diagnostic with `line: 42`, a message, and a non-empty hint

#### Scenario: An unobserved verdict after a successful paint

- **WHEN** a candidate paints within the mount budget but no authenticated verdict is ever observed
- **THEN** the report contains a `containment_unobserved` error diagnostic with a non-empty hint, and no `mount_timeout` diagnostic

### Requirement: Session lifecycle isolates candidates and records timings

The harness SHALL run one long-lived Chromium browser per session, give each candidate a fresh browser context (closed with its page when the run ends), and bound concurrent runs with a caller-set semaphore. Every report SHALL include per-stage timings; the harness SHALL NOT enforce any numeric latency budget beyond the watchdog in v1.

#### Scenario: Parallel candidates stay isolated

- **WHEN** two candidates run concurrently under the semaphore
- **THEN** each runs in its own browser context with its own engine, and neither's frames, syscalls, or diagnostics appear in the other's report
