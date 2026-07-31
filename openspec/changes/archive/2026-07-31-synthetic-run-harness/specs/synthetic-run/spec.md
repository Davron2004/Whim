# synthetic-run Specification

## ADDED Requirements

### Requirement: One candidate in, one deterministic run report out

The harness SHALL expose a library entry point that accepts one candidate TypeScript source string (the H1b bundle contract: single file importing only `vc-sdk`) plus options (budgets, concurrency handle), and returns a run report containing: the diagnostics list, the containment verdict, per-stage timings (build, boot, mount→paint, sweep, per-screen), the syscall/cue invocation trace, screens visited vs declared, and the applied budget values. Given the same candidate source and options, the sweep SHALL be deterministic: fixed canonical input values, sorted fingerprint action order, no random or wall-clock-dependent branching in the driver.

#### Scenario: Same candidate, same report

- **WHEN** the same candidate source is run twice with the same options
- **THEN** both reports contain the same diagnostics (kinds, targets) and the same action sequence, timings aside

### Requirement: The candidate boots in the unmodified production runtime page

The harness SHALL assemble pages exclusively from the production artifacts (`build/assemble.mjs`'s `buildSrcdoc`/`buildOuterHtml` and `runtime-artifacts.json`'s `parts`) with the locked CSP and real nonce handshake, and SHALL NOT fork, patch, or loosen the page, the CSP, or the loader to ease testing. The candidate SHALL be built with the production esbuild contract (IIFE, classic JSX, externals `{vc-sdk, react, react-dom}`, `tsconfigRaw: '{}'`); if the harness owns a mirrored single-candidate builder, a test SHALL pin it byte-equivalent to `build/build.mjs` output for a fixture app. `invariants/` and `build/*` are consumed strictly read-only.

#### Scenario: Build-contract drift tripwire

- **WHEN** the harness's candidate builder output for a fixture app differs byte-wise from the production build pipeline's output for the same fixture
- **THEN** the harness test suite fails naming the drift

### Requirement: Observation is trusted-vantage only

The harness SHALL derive every failure-grade signal from vantage points the bundle cannot overwrite: nonce-authenticated frames (`delivery`, `paint`, `error`, `probes`), Playwright/CDP-level `pageerror` (throws and unhandled rejections) and console capture, and gate denials read host-side at the harness's own exposed dispatch function. The bundle's self-reports (including `emitUiEvent` and `__whimNavDepth` frames) SHALL be used for sweep bookkeeping only and SHALL NOT determine any diagnostic or the containment verdict.

#### Scenario: Forged verdict attempt

- **WHEN** a hostile candidate posts forged frames claiming a passing containment verdict and clean execution
- **THEN** the report's verdict and diagnostics derive only from the nonce-authenticated probes frame and CDP-level observation, unaffected by the forgery

#### Scenario: Swallowed denial is still observed

- **WHEN** a candidate invokes an undeclared capability and `.catch`es the rejected promise so no `pageerror` fires
- **THEN** the report still contains the denial diagnostic, collected host-side at the dispatch function

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

Runtime-observed diagnostic kinds (`runtime_throw`, `unhandled_rejection`, `mount_timeout`, `run_truncated`, `containment_failure`, `unreachable_screen`, and any later additions) SHALL be added additively to the closed vocabulary in the checks contract module — never minted ad hoc — and SHALL reuse the runtime's existing kind string where the same misdeed already has one (bridge denial kinds verbatim). Every diagnostic SHALL carry the mandatory `hint`; `line` SHALL be populated when the failure maps through the build's source map to an original-source anchor, and omitted otherwise (the shared shape's runtime-producer provision).

#### Scenario: Throw with a source anchor

- **WHEN** a candidate throws during an `onPress` handler and the stack maps through the source map to original line 42
- **THEN** the report contains a `runtime_throw` diagnostic with `line: 42`, a message, and a non-empty hint

### Requirement: Session lifecycle isolates candidates and records timings

The harness SHALL run one long-lived Chromium browser per session, give each candidate a fresh browser context (closed with its page when the run ends), and bound concurrent runs with a caller-set semaphore. Every report SHALL include per-stage timings; the harness SHALL NOT enforce any numeric latency budget beyond the watchdog in v1.

#### Scenario: Parallel candidates stay isolated

- **WHEN** two candidates run concurrently under the semaphore
- **THEN** each runs in its own browser context with its own engine, and neither's frames, syscalls, or diagnostics appear in the other's report
