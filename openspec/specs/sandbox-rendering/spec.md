# sandbox-rendering Specification

## Purpose
TBD - created by archiving change webview-sandbox-runtime. Update Purpose after archive.
## Requirements
### Requirement: An SDK-targeting bundle renders UI inside the WebView

A hand-written bundle that imports only the injected SDK SHALL render its UI inside the contained WebView context via the React-to-DOM path (hypothesis R1). The bundle MUST NOT need to know it is inside an iframe, a WebView, or any particular host.

#### Scenario: Button renders from the injected SDK

- **WHEN** the ~20-line hand-written bundle imports `{ Button }` from the injected fake SDK and returns it as its UI
- **THEN** a button is visibly painted inside the WebView

#### Scenario: The SDK is the only import surface

- **WHEN** the bundle attempts to import or reference any module other than the injected SDK
- **THEN** nothing else resolves — there is no ambient module system and no reachable host module

### Requirement: User events round-trip from the bundle to the RN host

A user interaction inside the contained bundle SHALL be deliverable to the React Native host via the one-way, string-only message channel (`window.ReactNativeWebView.postMessage` → host `onMessage`, per spec §5.6 transport).

#### Scenario: A tap reaches the host

- **WHEN** the user taps the rendered button
- **THEN** the bundle posts a string message that the RN host's `onMessage` handler receives and can act on

#### Scenario: The transport is string-only and one-way per pipe

- **WHEN** the bundle sends a message to the host
- **THEN** the payload crosses as a string (JSON), confirming the transport contract that later carries the syscall RPC envelope unchanged

### Requirement: Mount-to-first-paint feels instant for a trivial app

For a trivial app, the elapsed time from bundle injection to first paint SHALL be fast enough to feel instant, with a rough ceiling of ~150 ms, and the measured number MUST be recorded in the spike artifact.

#### Scenario: A trivial app paints quickly on the target

- **WHEN** the hand-written bundle is injected into the contained context on the target Android emulator or device
- **THEN** first paint occurs within roughly 150 ms (eyeballed) and the observed timing is written into the decisions log / DEVLOG

### Requirement: Number inputs render without stray native focus artifacts
The SDK `NumberInput` SHALL render without leaking native browser chrome — no spin-button glyph and no stray focus-indicator dot — when focused inside the WebView. The corrected behavior MUST be achieved purely in the SDK render layer (style reset), never by widening the sandbox or CSP.

#### Scenario: Focusing a NumberInput
- **WHEN** the user focuses a `NumberInput` field in a mini-app
- **THEN** no stray dot or native spin-button artifact appears adjacent to the field
- **AND** the field remains usable for numeric entry

### Requirement: The realm reports a post-paint render failure as fatal
The runtime SHALL mount the mini-app inside a runtime-owned error boundary and, when it catches a render error, SHALL post a nonce-authenticated error frame with `where: 'render'`; generated code SHALL NOT be able to suppress it.

#### Scenario: Render throws after paint
- **WHEN** a component throws during a re-render after the first paint
- **THEN** the realm posts one trusted `render` error frame

### Requirement: Screen content clears the host's bottom chrome
The SDK's `Screen` SHALL add the host-supplied bottom inset to the bottom padding of its scrollable content, so the last element can scroll fully above the host's overlay; generated code SHALL NOT receive the inset value.

#### Scenario: Long screen
- **WHEN** a mini-app's `Screen` content is scrolled to its end
- **THEN** its last element sits entirely above the orb's footprint

#### Scenario: No inset supplied
- **WHEN** the host supplies no inset
- **THEN** `Screen` pads exactly as before

### Requirement: A focused mini-app input stays visible
The runtime SHALL scroll a focused editable element into view when it gains focus and when the viewport resizes while it has focus.

#### Scenario: Input near the bottom
- **WHEN** a user taps a text field near the bottom of a mini-app and the keyboard opens
- **THEN** the field is visible above the keyboard

