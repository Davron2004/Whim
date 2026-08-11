## MODIFIED Requirements

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

### Requirement: Observation is trusted-vantage only

The harness SHALL derive every failure-grade signal from vantage points the bundle cannot overwrite: nonce-authenticated frames (`delivery`, `paint`, `error`, `probes`), Playwright/CDP-level `pageerror` (throws and unhandled rejections) and console capture, and gate denials read host-side at the harness's own exposed dispatch function. The bundle's self-reports (including `emitUiEvent` and `__whimNavDepth` frames) SHALL be used for sweep bookkeeping only and SHALL NOT determine any diagnostic or the containment verdict.

The host-side transport those frames travel SHALL be live before navigation — installed in the pre-navigation phase, so it is already in place when the delivered page's inline scripts run and no frame the outer page emits between document commit and load is dropped. That installation SHALL be confined to the main frame: it SHALL NOT be performed per-document in every frame, because that would define the host transport global inside the opaque-origin sandbox realm the loader and probes rely on being free of it. The harness's own suite SHALL assert that the host relay binding is unreachable from inside the sandboxed realm, so the confinement is enforced rather than reviewed.

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

### Requirement: Diagnostics extend the central vocabulary additively

Runtime-observed diagnostic kinds (`runtime_throw`, `unhandled_rejection`, `mount_timeout`, `run_truncated`, `containment_failure`, `containment_unobserved`, `unreachable_screen`, and any later additions) SHALL be added additively to the closed vocabulary in the checks contract module — never minted ad hoc — and SHALL reuse the runtime's existing kind string where the same misdeed already has one (bridge denial kinds verbatim). Every diagnostic SHALL carry the mandatory `hint`; `line` SHALL be populated when the failure maps through the build's source map to an original-source anchor, and omitted otherwise (the shared shape's runtime-producer provision).

`containment_unobserved` and `mount_timeout` SHALL remain distinct kinds: `mount_timeout` names the never-painted cause only, and a verdict can go unobserved without a mount timeout (a malformed verdict payload, a suppressed frame, or a failure after a successful paint). A run SHALL NOT report an unobserved verdict as `mount_timeout`, and SHALL NOT report a mount timeout in place of `containment_unobserved` when the mount budget did not fire.

#### Scenario: Throw with a source anchor

- **WHEN** a candidate throws during an `onPress` handler and the stack maps through the source map to original line 42
- **THEN** the report contains a `runtime_throw` diagnostic with `line: 42`, a message, and a non-empty hint

#### Scenario: An unobserved verdict after a successful paint

- **WHEN** a candidate paints within the mount budget but no authenticated verdict is ever observed
- **THEN** the report contains a `containment_unobserved` error diagnostic with a non-empty hint, and no `mount_timeout` diagnostic
