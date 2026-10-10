## ADDED Requirements

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

### Requirement: The sweep acts only on an element that can receive the action

The harness SHALL test, immediately before acting on a picked fingerprint, that the element can receive the action, and SHALL defer an element that cannot instead of acting on it. The test runs in the candidate's frame at browser level: the element is scrolled into view, and it passes only if it is rendered with a non-empty box, is not `disabled`, has no ancestor-or-self with `aria-hidden="true"`, and the topmost element at the action point is the element itself or one of its descendants.

A deferred element SHALL NOT be marked visited, SHALL NOT count toward the per-screen action cap and SHALL NOT spend an action timeout. It stays eligible, and the sweep SHALL pick it on a later enumeration once it passes. An open `Modal` therefore gets its own controls used and its backdrop dismissed before the controls beneath it.

When unvisited fingerprints remain on a screen and none passes the test, the sweep SHALL dismiss a `Modal` backdrop that does pass once more, counted as an action, but only if it acted on at least one fingerprint since its previous dismissal on that screen. Otherwise the screen's sweep ends. Every fingerprint that was enumerated and never acted on by the end of the run SHALL be counted in the report as blocked, except one retired by the per-path limit.

An action that passes the test and still fails in the browser driver SHALL be counted in the report as a failed action, and its fingerprint marked visited. No action failure SHALL be discarded without a count.

#### Scenario: A control under an open Modal is pressed after the Modal closes

- **WHEN** one button opens a `Modal` and a second button on the same screen lies under the Modal's scrim when the sweep picks it
- **THEN** the sweep acts on the Modal's own controls, dismisses the Modal, then presses the second button, and the report counts zero failed actions

#### Scenario: A disabled control is never clicked

- **WHEN** a screen shows a control that stays disabled for the whole run next to enabled ones
- **THEN** no action is attempted on it, the enabled controls are all acted on, and the report counts zero failed actions

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

## MODIFIED Requirements

### Requirement: One candidate in, one deterministic run report out

The harness SHALL expose a library entry point that accepts one candidate TypeScript source string (the H1b bundle contract: single file importing only `vc-sdk`) plus options (budgets, concurrency handle), and returns a run report containing: the diagnostics list, the containment verdict, per-stage timings (build, boot, mount→paint, sweep, per-screen), the syscall/cue invocation trace, the screens declared, visited and cold-mounted, the sweep's counts (actions taken, fingerprints blocked, actions failed), and the applied budget values. Given the same candidate source and options, the sweep SHALL be deterministic: fixed canonical input values, a fixed group-then-sorted-fingerprint action order, no random or wall-clock-dependent branching in the driver.

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

### Requirement: Screen coverage follows real navigation, then cold-mounts the rest

The harness SHALL resolve the screen on top of the navigation stack from the browser side, by matching the mounted component against the live app module's declared screens, and SHALL NOT take it from any frame the bundle posts. After each action it SHALL wait out a push or pop in flight before reading the screen; a screen still unsettled at the end of that wait reads as no navigation. A change of the settled screen is entry to that screen, and the sweep continues there.

Progress SHALL be kept per declared screen across visits: the fingerprints already acted on and the action count. A screen entered again resumes with what is left, and the per-screen action cap spans all its visits. When a screen has nothing left to act on, the sweep SHALL step back one screen through the host's system-back control and continue on the screen it lands on, while the SDK's last announced navigation depth is above zero. The `__whimNavDepth` frame is an unauthenticated hint and only gates that step: the number of back steps SHALL never exceed the number of actions taken, so a candidate that announces a false depth cannot make the sweep loop.

After the live sweep, each declared `spec.screens` entry it never reached SHALL be cold-mounted in a fresh realm (via `__whimControl.reinject({reset:true, …})` with the same source rebuilt to start on that screen — never in-place re-delivery, per T7) and swept on its own after the quiet window. Navigation out of a cold-mounted screen is not followed. A cold-mounted screen is listed in the report's visited screens and in its cold-mounted screens.

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

#### Scenario: Never-settling mount

- **WHEN** a candidate's mount path hangs (e.g. an unresolvable `delay` before first render) past the mount budget
- **THEN** the run ends with a `mount_timeout` error diagnostic and the report says which budget fired, rather than proceeding on stale page state

#### Scenario: Legal interval never fails the run

- **WHEN** a candidate runs a 100ms `interval` forever but mounts and responds normally
- **THEN** the sweep completes with no timeout diagnostic

#### Scenario: A write-then-navigate is followed

- **WHEN** a button's handler awaits a storage write and navigates to another screen once it resolves
- **THEN** the sweep reads the settled screen after that navigation and continues on the new screen
