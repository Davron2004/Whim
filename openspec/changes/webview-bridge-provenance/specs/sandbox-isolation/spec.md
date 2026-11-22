## ADDED Requirements

### Requirement: The mini-app frame holds no native bridge object
The mini-app frame SHALL hold no native message-bridge object reachable by app code other than the loader's transport stub: neutralization MUST remove any native `ReactNativeWebView` and `webkit.messageHandlers.ReactNativeWebView` present in the frame before any other runtime script runs, and counted `reach` probes MUST fail containment if app code can still reach one.

#### Scenario: A native bridge injected into the frame is removed
- **WHEN** the platform has put a native `ReactNativeWebView` object into the mini-app frame before the runtime's scripts run
- **THEN** neutralization removes it, the loader installs its stub, and the `reach` probe "frame bridge is the loader stub" passes

#### Scenario: A bridge that cannot be removed fails containment
- **WHEN** a native bridge object in the frame cannot be removed or shadowed (for example a non-configurable, non-writable property), or one stays reachable through the window's prototype chain
- **THEN** the corresponding `reach` probe fails and the verdict reports `contained: false`

#### Scenario: The iOS message handler is unreachable
- **WHEN** app code reads `window.webkit.messageHandlers.ReactNativeWebView`
- **THEN** it obtains nothing it can post through, and the `reach` probe for it passes; where the handler cannot be made unreachable, that probe fails

#### Scenario: App code cannot uncover a removed bridge
- **WHEN** app code deletes or replaces `window.ReactNativeWebView` and then reads it again, or walks the window's prototypes for it
- **THEN** it never obtains a native bridge object

### Requirement: Bridge presence at start is reported, not counted
The verdict SHALL carry a `bridge` side field recording, from neutralization's own captured record, whether each native bridge object was present in the mini-app frame when the runtime started and whether its removal succeeded; the field MUST NOT be computed from any global app code can write, and MUST NOT count toward `total` or `contained`.

#### Scenario: Presence is reported on a device that injects the bridge
- **WHEN** the frame started with a native `ReactNativeWebView`, and neutralization removed it
- **THEN** the verdict's `bridge` field shows `{android: {present: true, removed: true}, …}` while `contained` reflects only the counted probes

#### Scenario: App code cannot rewrite the record
- **WHEN** app code overwrites `window.__WHIM_NEUTRALIZE_REPORT__` or any other window global before the probes run
- **THEN** the verdict's `bridge` field still shows the values neutralization recorded

### Requirement: iOS refuses sub-frame navigations to anything but the frame's own document
On iOS, native code SHALL refuse every navigation whose target frame is not the main frame unless its URL is `about:srcdoc` or `about:blank`, so a mini-app frame cannot replace itself with a `data:`, `blob:` or `javascript:` document that neutralization never ran in. The main frame's navigations and sub-resource loads (including `data:` images under the CSP's `img-src`) MUST be unaffected, and a static check MUST fail the gate if the refusal or its allowlist is removed.

#### Scenario: A mini-app frame cannot navigate itself to data:
- **WHEN** app code in the mini-app frame on iOS sets its own location to a `data:` URL
- **THEN** the navigation is refused natively and the frame keeps its original realm

#### Scenario: The mini-app frame itself still loads
- **WHEN** the runtime page creates the `about:srcdoc` mini-app frame on iOS under the refusal
- **THEN** the frame loads, the app paints, and `data:` images still render

#### Scenario: Android is unchanged
- **WHEN** the same navigation happens on Android
- **THEN** no native refusal applies (Android does not reliably report sub-frame navigations), and the token check alone keeps a navigated document's posts harmless
