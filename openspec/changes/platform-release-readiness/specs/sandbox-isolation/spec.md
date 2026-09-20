## ADDED Requirements

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
