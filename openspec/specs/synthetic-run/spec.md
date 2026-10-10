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

The harness SHALL expose a library entry point that accepts one candidate TypeScript source string (the H1b bundle contract: single file importing only `vc-sdk`) plus options (budgets, concurrency handle), and returns a run report containing: the diagnostics list, the containment verdict, per-stage timings (build, boot, mount→paint, sweep, per-screen), the syscall/cue invocation trace, the screens declared, visited and cold-mounted, the sweep's counts (actions taken, fingerprints blocked, actions failed), and the applied budget values. Given the same candidate source and options, the sweep SHALL be deterministic: fixed canonical input values, a fixed group-then-sorted-fingerprint action order, no random or wall-clock-dependent branching in the driver. The one exception is a control lying under a toast, which is reached or not according to when the toast leaves.

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

Per rendered screen the harness SHALL enumerate interactive SDK elements from outside the realm, by evaluating in the candidate's frame at browser level, fingerprint each as (structural kind, accessible label, DOM path), and act on each fingerprint at most once: tap `Button`, `Card` and `ListItem`; tap each `SegmentedControl` option, which is a button of its own; type canonical values into `TextInput` and `NumberInput`; choose an option of a `Picker`'s native `<select>` through the driver's select-option call, taking the first enabled option with a non-empty value that is not already selected; type a canonical date, time or date-time into a `DateInput`'s native input; toggle `Switch` and `Checkbox` on and off; click a `Slider`'s track at its low and high ends; dismiss a `Modal` by its backdrop. The kind is inferred from the element's DOM shape, not from a component name. The accessible label is the element's text, or its `aria-label` when it has no text. A wrapper that only hosts a native `<select>` or date input is not a fingerprint of its own, and neither is the SDK's toast host, a fixed `role="status"` region that is not a `Modal` backdrop.

The harness SHALL wait for the quiet window before its first enumeration on a freshly mounted realm, at the initial mount and after each cold-mount, so a control that appears once a mount-time read resolves is enumerated. Before every enumeration it SHALL also wait, up to the action hard cap, until no finite animation is running in the candidate's frame, because the quiet window cannot see motion and a `Modal` sheet that is still sliding in reads as covered. An animation that never ends is not waited for. It SHALL re-enumerate after every action, and SHALL end a screen's sweep when no unvisited fingerprint can be acted on or when the per-screen action cap is reached. The total budget ends the whole run from outside the sweep. A screen that reaches the cap with unvisited fingerprints left SHALL mark the report truncated, never silently complete.

A label that carries a running value mints a new fingerprint at the same DOM path on every press. The harness SHALL act on one DOM path of a screen at most three times however its label changes, a `Modal` backdrop excepted, and SHALL retire any further fingerprint at that path: it is not acted on, does not keep the screen's sweep open, does not mark the report truncated and is not counted as blocked.

#### Scenario: State-minted elements are swept without looping

- **WHEN** tapping a button re-renders the screen with one new button and the existing elements
- **THEN** the new fingerprint is acted on once, already-visited fingerprints are not re-acted on, and the sweep terminates

#### Scenario: A control whose label carries a running value does not exhaust the cap

- **WHEN** a card's label shows a count that rises each time the card is pressed
- **THEN** the sweep presses that card three times, goes on to the screen's other fingerprints, and the report is not truncated

#### Scenario: A toast is not dismissed as a Modal

- **WHEN** an action shows a toast on a screen with no `Modal`
- **THEN** the sweep's action log contains no backdrop dismissal

#### Scenario: A Picker's option is chosen without a click

- **WHEN** a screen shows a `Picker` with a placeholder and two options
- **THEN** the sweep selects the first option through the select-option call, the candidate's `onChange` receives that option's value, and the report counts zero failed actions

#### Scenario: An icon-only button is labelled by its accessible name

- **WHEN** a screen's header carries an action button that has an `aria-label` and no text
- **THEN** its fingerprint's label is that `aria-label`

### Requirement: The sweep acts only on an element that can receive the action

The harness SHALL test, immediately before acting on a picked fingerprint, that the element can receive the action, and SHALL defer an element that cannot instead of acting on it. The test runs in the candidate's frame at browser level: the element is scrolled into view, and it passes only if it is rendered with a non-empty box, is not `disabled`, has no ancestor-or-self with `aria-hidden="true"`, and the topmost element at the action point is the element itself or one of its descendants.

A deferred element SHALL NOT be marked visited, SHALL NOT count toward the per-screen action cap and SHALL NOT spend an action timeout. It stays eligible, and the sweep SHALL pick it on a later enumeration once it passes. An open `Modal` therefore gets its own controls used and its backdrop dismissed before the controls beneath it.

When unvisited fingerprints remain on a screen and none passes the test, the sweep SHALL dismiss a `Modal` backdrop that does pass once more, counted as an action, but only if it acted on at least one fingerprint since its previous dismissal on that screen. Otherwise the screen's sweep ends. Every fingerprint that was enumerated and never acted on by the end of the run SHALL be counted in the report as blocked, except one retired by the per-path limit. The count is of fingerprints, so a control whose label changed before it was acted on counts once under each label it showed and was not acted on.

A toast is the one cover that leaves by itself. When unvisited fingerprints remain on a screen and none passes the test, the sweep SHALL enumerate and pick once more before it ends the screen's sweep, spending no action, and if the SDK's toast host is showing it SHALL first wait for the toast to leave, up to five seconds. The second pick happens whether or not a toast was seen, so a toast that left between the test and the check cannot end the screen early. The sweep SHALL wait for a toast at most twice in one run, counted and not timed, so toasts cannot spend the total budget and the bound never depends on the clock. Which controls a toast still covers when the sweep looks does depend on when the toast leaves, so whether a toast-covered control is reached is the one part of the action sequence that can differ between two runs of the same candidate.

An action that passes the test and still fails in the browser driver SHALL be counted in the report as a failed action, and its fingerprint marked visited. No action failure SHALL be discarded without a count.

#### Scenario: A control under an open Modal is pressed after the Modal closes

- **WHEN** one button opens a `Modal` and a second button on the same screen lies under the Modal's scrim when the sweep picks it
- **THEN** the sweep acts on the Modal's own controls, dismisses the Modal, then presses the second button, and the report counts zero failed actions

#### Scenario: A disabled control is never clicked

- **WHEN** a screen shows a control that stays disabled for the whole run next to enabled ones
- **THEN** no action is attempted on it, the enabled controls are all acted on, and the report counts zero failed actions

#### Scenario: A button under a toast is pressed once the toast has gone

- **WHEN** pressing one button shows a toast that covers the only other unvisited button
- **THEN** the sweep waits for the toast to leave and presses the second button, and the report counts zero failed actions

#### Scenario: Toast waits are bounded per run

- **WHEN** every press on a screen raises a toast over the next unvisited button, more than twice in a row
- **THEN** the sweep waits for a toast twice, ends the screen's sweep with the remaining buttons counted as blocked, and the report is not truncated

#### Scenario: A screen whose remaining controls stay covered ends without a timeout

- **WHEN** a `Modal` that cannot be dismissed covers the remaining unvisited controls of a screen
- **THEN** the screen's sweep ends, those controls are counted as blocked, and the report counts zero failed actions

### Requirement: The sweep enters values before it presses commands

The harness SHALL order the fingerprints of a screen in four groups and act on an earlier group's actionable fingerprints before a later group's: first rows and cards (`Card` and `ListItem` with `onPress`), then value controls (`TextInput`, `NumberInput`, `Picker`, `DateInput`, `Slider`, `Switch`, `Checkbox`), then buttons, then the controls that leave what is on screen, a `Modal` backdrop before the SDK header's Back button. Within a group the order is the sorted fingerprint. The header Back button is the icon-only button whose accessible name is the SDK's back label; the harness already pops a finished screen through the host's system-back control, so pressing that button earlier would only abandon the screen.

The effect this order exists for: on a form screen the sweep fills every field, then presses the submit control, and only then leaves. An item the form created appears as a new row fingerprint on the list screen and the sweep follows it, so a screen that exists only once data exists is reached through the candidate's own interface.

#### Scenario: A detail screen behind an empty list is reached live

- **WHEN** a candidate lists items read from storage, has none on a fresh install, creates one through a form on a second screen whose save control is disabled until a field is filled, and opens a detail screen from a row
- **THEN** the sweep fills the form, saves, presses the new row and sweeps the detail screen live, and the report lists the detail screen as visited and not as cold-mounted

#### Scenario: The header Back button does not abandon a pushed form

- **WHEN** a pushed screen with a title holds a form and a save button
- **THEN** the sweep acts on every field and on the save button before it presses the header Back button

#### Scenario: Rows are followed before a search field filters them away

- **WHEN** a list screen shows rows and a text field that filters them
- **THEN** the sweep presses the rows before it types into the field

### Requirement: Screen coverage follows real navigation, then cold-mounts the rest

The harness SHALL resolve the screen on top of the navigation stack from the browser side, by matching the mounted component against the live app module's declared screens, and SHALL NOT take it from any frame the bundle posts. After each action it SHALL wait out a push or pop in flight before reading the screen; a screen still unsettled at the end of that wait reads as no navigation. A change of the settled screen is entry to that screen, and the sweep continues there.

Progress SHALL be kept per declared screen across visits: the fingerprints already acted on and the action count. A screen entered again resumes with what is left, and the per-screen action cap spans all its visits. When a screen has nothing left to act on, the sweep SHALL step back one screen through the host's system-back control and continue on the screen it lands on, while the SDK's last announced navigation depth is above zero. The `__whimNavDepth` frame is an unauthenticated hint and only gates that step: the number of back steps SHALL never exceed the number of actions taken, so a candidate that announces a false depth cannot make the sweep loop.

After the live sweep, each declared `spec.screens` entry it never reached SHALL be cold-mounted in a fresh realm (via `__whimControl.reinject({reset:true, …})` with the same source rebuilt to start on that screen — never in-place re-delivery, per T7) and swept on its own after the quiet window. Navigation out of a cold-mounted screen is not followed: it ends that screen's sweep. A cold-mounted screen is listed in the report's visited screens and in its cold-mounted screens.

A cold-mounted screen SHALL produce an `unreachable_screen` warning diagnostic only when no `navigate` call in the candidate source names it as a string-literal target. A cold-mounted screen the candidate does navigate to SHALL produce no diagnostic: the candidate has a path, the sweep could not satisfy what gates it, and the report's cold-mounted list already records the gap. The harness cannot tell a gated path from a broken one, and the hint on `unreachable_screen` is true only for a screen with no path.

#### Scenario: Unreachable screen is rendered and flagged

- **WHEN** a candidate declares screens `{Home, Detail, Orphan}` and no `navigate` call names `Orphan`
- **THEN** `Orphan` is cold-mounted in a fresh realm, render failures there surface as diagnostics, and the report contains an `unreachable_screen` warning naming `Orphan`

#### Scenario: A gated screen is covered without a diagnostic

- **WHEN** a candidate navigates to `Secret` only after the user types a specific phrase the sweep's canonical text does not match
- **THEN** `Secret` is cold-mounted and swept, the report lists it as cold-mounted, and the report contains no `unreachable_screen` diagnostic

#### Scenario: A gated screen that throws still fails the run

- **WHEN** a screen the sweep reaches only by cold-mount throws while rendering
- **THEN** the report contains the `runtime_throw` error diagnostic

#### Scenario: A hub's second spoke is reached after the first one's dead end

- **WHEN** a hub screen opens two spokes, and the first spoke has no control that returns
- **THEN** the sweep steps back from the first spoke through the system-back control, resumes the hub with its remaining fingerprints, and reaches the second spoke live

#### Scenario: A forged depth cannot loop the sweep

- **WHEN** a single-screen candidate keeps announcing a navigation depth above zero
- **THEN** the sweep ends after at most as many back steps as it took actions

### Requirement: Watchdog makes every timeout an explicit outcome

The harness SHALL enforce: a mount budget (no nonce-authenticated `paint` frame in time ⇒ `mount_timeout` error diagnostic); a per-action quiet-window settle with a hard cap (a heuristic only — steady background activity such as a legal `interval` SHALL NOT produce a diagnostic and SHALL NOT block the sweep past the cap); and a total wall-clock budget (hard page kill ⇒ a `run_truncated` error diagnostic and the report's `truncated` flag). No code path SHALL swallow a timeout silently. The runtime page itself SHALL remain watchdog-free.

Activity for the quiet window is every frame, console and CDP event the observers record, plus every capability call the host dispatches and every reply it returns, plus the sweep's own action at the moment the driver call returns, so a candidate that writes to storage and navigates when the write resolves is read after it navigated.

The report's `truncated` flag SHALL be set in two cases: the total budget fired, which also records the `run_truncated` diagnostic, or a screen reached its action cap with unvisited fingerprints left, which records no diagnostic of its own. A consumer SHALL treat the flag, with or without the diagnostic, as an incomplete run and never as a pass.

A run the total budget ended SHALL still report what the sweep had reached when it stopped: the declared, visited and cold-mounted screens, the per-screen timings and the sweep counts. A truncated report that reads as if nothing was swept hides how far the run got. The action in flight when the page was killed may be counted as failed.

#### Scenario: Never-settling mount

- **WHEN** a candidate's mount path hangs (e.g. an unresolvable `delay` before first render) past the mount budget
- **THEN** the run ends with a `mount_timeout` error diagnostic and the report says which budget fired, rather than proceeding on stale page state

#### Scenario: Legal interval never fails the run

- **WHEN** a candidate runs a 100ms `interval` forever but mounts and responds normally
- **THEN** the sweep completes with no timeout diagnostic

#### Scenario: A run the budget ended still says how far it got

- **WHEN** the total budget fires while the sweep is partway through a screen with many controls
- **THEN** the report is truncated with a `run_truncated` diagnostic, lists the declared screens and the screen being swept as visited, and counts the actions taken before the kill

#### Scenario: A write-then-navigate is followed

- **WHEN** a button's handler awaits a storage write and navigates to another screen once it resolves
- **THEN** the sweep reads the settled screen after that navigation and continues on the new screen

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

### Requirement: Verb-time storage denials are candidate diagnostics; host faults are not

Every storage denial the production dispatcher returns for a verb-time error — `type_mismatch`, `unknown_collection`, `unknown_field`, `unknown_record`, `unqueryable_field`, `kv_too_large` — SHALL appear in the run report as an **error** diagnostic carrying the engine's own kind string verbatim, the method that was denied, and the engine's own hint, even when the candidate swallowed the rejected promise.

A denial whose kind is a host fault (`not_open`, `corrupt_storage`) SHALL NOT be reported as a candidate diagnostic, because it describes the harness's engine rather than the candidate's code; it SHALL remain in the report's trace verbatim so the exclusion is visible rather than silent. No denial SHALL be dropped from both the diagnostics and the trace.

#### Scenario: A bad date write fails the run

- **WHEN** a candidate writes a formatted date string into a `date` field and ignores the rejected promise
- **THEN** the run report is not `ok`, and it contains a `type_mismatch` error diagnostic naming the denied method and carrying the engine's hint

#### Scenario: An error run diagnostic reaches repair

- **WHEN** the pipeline's run stage returns a report carrying a `type_mismatch` error diagnostic
- **THEN** the candidate goes to repair with that diagnostic in the repair prompt, and no record is delivered for it

#### Scenario: A host fault is excluded but visible

- **WHEN** a denial carrying a host-fault kind is recorded during a run
- **THEN** the report's diagnostics contain no entry for it and the report's trace contains the denial verbatim

### Requirement: Chromium runs with its OS sandbox enabled
The harness SHALL launch Chromium from one launch-options definition with the Chromium OS sandbox enabled, and SHALL NOT pass, or allow Playwright to add, `--no-sandbox`, `--disable-setuid-sandbox`, or any other flag that disables the sandbox, site isolation, or web security.

If Chromium cannot create its sandbox on the host, the launch SHALL fail with a named error. The harness SHALL NOT retry with a weaker configuration, and no environment variable or option SHALL exist that disables the sandbox. The launch-options definition is the only place browser flags are set, and the production boot self-test, the harness suites, and the server all use it.

#### Scenario: The launched browser process carries no sandbox-disabling flag
- **WHEN** a session is launched and the browser process's command-line arguments are inspected
- **THEN** none of `--no-sandbox`, `--disable-setuid-sandbox`, `--disable-web-security`, or `--disable-site-isolation-trials` is present

#### Scenario: No fallback exists
- **WHEN** the harness sources are scanned for a code path that launches Chromium with the sandbox disabled
- **THEN** none is found

### Requirement: A synthetic run has no network egress
No request originating in a synthetic run's browser context SHALL reach any network destination — not the internet, not the host's loopback, not private ranges, not the cloud metadata address. This covers every page, frame, worker, and navigation in the context, and every protocol Chromium can speak (HTTP(S), WebSocket, WebTransport, and WebRTC UDP).

The harness SHALL achieve this with independent layers, each sufficient for HTTP-family traffic on its own:

- **Interception:** the run's page SHALL be delivered from memory by a context-level route at a reserved non-resolvable origin, instead of being written to disk and loaded from `file://`. Every other request and WebSocket the context attempts SHALL be aborted, service workers SHALL be blocked, and downloads SHALL be refused.
- **Dead proxy:** the browser SHALL be launched with all traffic pinned to an unroutable proxy, with the implicit loopback bypass removed, so a request that escaped interception has no route.
- **Resolver and UDP:** host-name resolution SHALL map every name to not-found, and WebRTC SHALL be restricted from non-proxied UDP.

Every aborted attempt SHALL be counted in the run report's trace as the fact and a bounded count, never echoing the attempted URL into diagnostics or model-facing paths. The page's bytes, CSP, nonce handshake, and loader SHALL remain the unmodified production artifacts. Only their delivery changes.

#### Scenario: A hostile candidate reaches no canary
- **WHEN** the harness suite starts a loopback HTTP, WebSocket, and UDP canary, and runs a candidate that attempts every reachable egress path toward it: self-navigation of its frame, an inserted meta refresh, image and CSS URLs, prefetch and preconnect links, WebTransport, and a WebRTC peer connection with the canary as its ICE server
- **THEN** the canaries record zero connections and zero datagrams, and the run report's trace records that egress attempts were blocked

#### Scenario: Interception alone blocks a direct navigation
- **WHEN** a context produced by the harness's context factory is used from the harness side to navigate a page to the canary URL on a browser launched without the proxy pin
- **THEN** the navigation fails and the canary records nothing

#### Scenario: The proxy pin alone blocks a direct navigation
- **WHEN** a browser launched with the harness launch options is given a context with no interception and navigated to the canary URL
- **THEN** the navigation fails and the canary records nothing

#### Scenario: The canary is reachable without the guards
- **WHEN** a separately launched browser with default options and no interception navigates to the canary URL
- **THEN** the canary records the request, proving the other scenarios are not vacuous

#### Scenario: Existing containment behavior is unchanged by the delivery switch
- **WHEN** the harness's existing suite (verdict, relay provenance, forgery, sweep, watchdog, and cancellation tests) runs against in-memory page delivery
- **THEN** every existing test passes unchanged

### Requirement: A capability reply reaches the candidate realm

The harness SHALL deliver the run page so that the production syscall marshaller inside the candidate's realm accepts the host's replies: a candidate that awaits a capability call SHALL receive its result or its structured error, as it does on a device. The marshaller accepts a reply only from a parent document whose origin serialises as `null`, so the route that serves the run page SHALL serve it as an opaque-origin document by adding a `sandbox allow-scripts` content-security policy to the response. That policy is a property of delivery: the page's bytes, its own CSP, the nonce handshake and the loader stay the unmodified production artifacts, and the harness SHALL NOT patch the marshaller, the page or the candidate to make a reply arrive.

The harness's own suite SHALL assert the round trip from inside a real run, by an effect that happens only after the candidate received the reply. A host-side trace entry alone is not evidence, because the host records a call it answered whether or not the answer was accepted.

#### Scenario: A storage read made at mount resolves in the candidate

- **WHEN** a candidate awaits `storage.kv.get` in a mount effect and makes a second capability call only after the first one resolves
- **THEN** the run's trace contains the second call

#### Scenario: A control gated on a storage reply is swept

- **WHEN** a candidate keeps its only button disabled until a storage read made at mount resolves
- **THEN** the sweep acts on that button

#### Scenario: A reply is dropped when the page keeps a real origin

- **WHEN** the suite serves the same candidate through a context whose route omits the sandbox policy
- **THEN** the second capability call never appears in the trace, which proves the scenarios above are not vacuous

### Requirement: The candidate build reads nothing from disk but the runtime shim
The harness's candidate builder SHALL resolve no module from the filesystem other than the build's own entry and the production React inject shim. Every import, re-export, or require specifier other than the three host-injected externals (`vc-sdk`, `react`, `react-dom`) SHALL fail the build with a named diagnostic, and no byte of a file it names SHALL appear in the bundle or its source map.

This SHALL hold independently of the static checker, so a gap in either layer alone reopens nothing. A builder change of this kind SHALL keep the existing byte-equivalence tripwire against the production build green.

#### Scenario: A re-exported server file never enters the bundle
- **WHEN** the builder is given a candidate containing `export * from '<absolute path of a repo source file>'` directly, bypassing the checker
- **THEN** the build fails with a named diagnostic, and no content of that file appears in any output

#### Scenario: Honest candidates build byte-identically
- **WHEN** the fixture used by the build-contract drift tripwire is built after the change
- **THEN** its output is byte-identical to the production build pipeline's output

### Requirement: Abort is honoured at every wait in a run
A run given an `AbortSignal` SHALL observe it while waiting for a concurrency slot, before and during page delivery and navigation, while awaiting mount, and during the sweep. It SHALL abandon the run at whichever wait it is in.

A waiter aborted before acquiring a slot SHALL be removed from the queue without ever holding the slot. A run aborted after acquiring one SHALL close its page and browser context and release the slot within 5 seconds of the signal, with no unhandled rejection and no duplicate cleanup.

#### Scenario: An abort while queued never takes the slot
- **WHEN** a concurrency-1 session is running one candidate and a second run is aborted while waiting for the slot
- **THEN** the second run ends without ever opening a browser context, and the first run is unaffected

#### Scenario: An abort during mount releases promptly
- **WHEN** a candidate's mount path hangs and the run is aborted 250 ms after navigation
- **THEN** its browser context is closed and its slot is free within 5 seconds, well before the mount budget would have fired

### Requirement: A crashed browser is replaced
The session SHALL detect that its browser process has disconnected. Every run in progress on the dead browser SHALL end with a named harness error rather than hanging, and the session SHALL launch a replacement browser with the same launch options before the next run opens a context.

A replacement launch that fails SHALL surface as a named error to the run that needed it. The session SHALL retry the launch on a later run rather than staying permanently dead.

#### Scenario: Runs recover after the browser dies
- **WHEN** the session's browser process is killed while one run is in progress and a new run is then started
- **THEN** the in-progress run ends with a named harness error, and the new run completes with a normal report on a freshly launched browser
