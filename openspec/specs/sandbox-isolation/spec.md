# sandbox-isolation Specification

## Purpose
TBD - created by archiving change webview-sandbox-runtime. Update Purpose after archive.
## Requirements
### Requirement: Forbidden globals are unavailable to the bundle

The contained execution context SHALL NOT expose any Layer-3 escape-hatch global (spec §5.1) to the mini-app bundle. Each forbidden global MUST be removed or replaced with an inert reference such that invoking it throws synchronously rather than performing its effect. The forbidden set covers at minimum: `fetch`, `XMLHttpRequest`, `WebSocket`, `eval`, `Function` / `new Function`, `localStorage`, `indexedDB`, dynamic `import()`, and `Worker`.

#### Scenario: Network primitives are dead

- **WHEN** the bundle calls `fetch(...)`, constructs `new XMLHttpRequest()`, or constructs `new WebSocket(...)`
- **THEN** each call throws (e.g. `ReferenceError`/`TypeError`) and no network request leaves the device

#### Scenario: Dynamic code execution is dead

- **WHEN** the bundle calls `eval(...)`, `new Function(...)`, or a dynamic `import(...)`
- **THEN** each call throws and no externally-supplied code string is executed

#### Scenario: Ambient persistence and threading are dead

- **WHEN** the bundle accesses `localStorage`, accesses `indexedDB`, or constructs a `Worker`
- **THEN** access throws or yields an inert object that performs no persistence or threading

#### Scenario: The probe checklist runs as pass/fail assertions

- **WHEN** the forbidden-globals probe checklist is executed against the contained context
- **THEN** every entry reports "throws or provably inert" with zero exceptions, producing a result usable as a never-regress invariant (the network/native-isolation assertion of spec §16.2)

### Requirement: The contained context cannot reach the host or native layer

There SHALL be no reachable reference path from the bundle's execution context to the React Native host JS context, the native message bridge, or the parent document. Containment MUST hold against deliberate escape attempts, not merely absent ones.

#### Scenario: Parent and top reach is blocked

- **WHEN** the bundle reads `window.parent`, `window.top`, or `window.frameElement`
- **THEN** it cannot obtain a usable handle to the host document or to any host/native global (the reference is null, throws, or is a cross-origin-blocked opaque object)

#### Scenario: Prototype-chain walking yields no escape

- **WHEN** the bundle walks prototype chains and constructor references (e.g. `({}).constructor.constructor`, `Object`/`Array`/`Function` prototypes) attempting to climb out of the sandbox
- **THEN** no path resolves to a host function, the RN message bridge, or a live native capability

### Requirement: Global neutralization is surgical, not total

The global-stripping technique SHALL remove only the dangerous set and MUST preserve the globals the legitimate React render path and injected SDK depend on, so that neutralization does not break the runtime itself.

#### Scenario: The allowed runtime survives stripping

- **WHEN** the forbidden globals are neutralized and the fake SDK is injected
- **THEN** the React render path still mounts and the injected SDK module remains the single reachable capability surface

#### Scenario: Non-configurable globals are handled

- **WHEN** a forbidden global cannot be `delete`d because the engine marks it non-configurable
- **THEN** it is still rendered inert by shadowing within the bundle's execution scope (or equivalent), and the probe checklist confirms it

### Requirement: The WebView that hosts mini-apps refuses network loads natively
Every WebView the app mounts through `react-native-webview` SHALL refuse every `http` and `https` load from every frame through its native WebView configuration, independently of the page's CSP, the iframe sandbox and global neutralization, and on iOS it SHALL also refuse `ws` and `wss` loads.
This covers a sandboxed mini-app frame navigating itself, which none of the three web-layer legs can stop. A refused load opens no connection. The runtime page itself SHALL keep working under the refusal: it loads from its inline HTML, receives bundles by source, and reports its containment verdict and syscalls over the nonce-authenticated channel, because none of that is a network load.

#### Scenario: A mini-app navigates its own frame
- **WHEN** a delivered mini-app sets `location.href`, calls `location.assign`, appends a `<meta http-equiv="refresh">`, or clicks an `<a href>`, each pointing at an `http` or `https` URL on a canary the test machine runs
- **THEN** the canary receives no HTTP request and no TCP connection, on the Android System WebView and on iOS WKWebView

#### Scenario: A load started by the host page is refused too
- **WHEN** the outer runtime page itself navigates its top frame to an `http` URL on the canary
- **THEN** the canary receives nothing and the WebView reports a load error for that URL

#### Scenario: The runtime still runs under the refusal
- **WHEN** a mini-app is launched in a WebView that refuses network loads
- **THEN** it paints, its containment verdict arrives as a trusted frame, and its syscalls round-trip

### Requirement: The refusal is armed before any content loads and fails closed
The app SHALL apply the network refusal to each WebView before that WebView loads any content, and a WebView the refusal could not be applied to MUST run no page script.
On Android the refusal is set when the view manager creates the view, and the app registers exactly one provider of the `RNCWebView` view manager. On iOS the compiled rule list is attached to the configuration when the WKWebView is initialized; a WKWebView initialized while no compiled rule list exists gets content JavaScript disabled instead.

#### Scenario: A recreated realm is refused too
- **WHEN** a Retry remounts the mini-app WebView, or the view system recycles a WebView into a new mount
- **THEN** the new native web view refuses network loads before its first load

#### Scenario: The rule list is missing on iOS
- **WHEN** a WKWebView is initialized and the rule list failed to compile, or the rule file is absent from the app bundle
- **THEN** the web view runs no page script, no mini-app is delivered, the launch ends on the app error surface, and the canary receives nothing

### Requirement: The native refusal is locked by the checks and proven on device
The release checks SHALL fail when the native refusal's wiring or rule content is weakened, and the attended device acceptance MUST show zero canary requests with the refusal in place and a non-zero count with it removed.
The checks read the Android view manager, its package and the application's package list, the iOS rule file, the file that installs the iOS hook, and the Xcode target's build phases. They run without Gradle, Xcode or a device.

#### Scenario: A narrower iOS rule fails the checks
- **WHEN** the iOS rule file limits its block to `document` loads, or drops the `wss?` rule
- **THEN** the release checks fail and name the rule file and the missing coverage

#### Scenario: The stock provider left in place fails the checks
- **WHEN** the application's package list adds the network-denied WebView package without removing the autolinked `RNCWebViewPackage`
- **THEN** the release checks fail, naming `MainApplication.kt`

#### Scenario: The device probe is not vacuous
- **WHEN** the refusal is removed by a local edit and the network deny probe runs again against the same canary
- **THEN** the canary counts requests for the self-navigation variants and exits with a failure

