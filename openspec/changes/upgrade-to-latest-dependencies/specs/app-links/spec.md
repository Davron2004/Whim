## MODIFIED Requirements

### Requirement: The iOS app delivers universal links to the launcher
The iOS app SHALL declare the associated domain `applinks:whim.<WHIM_DOMAIN>` through the `Whim` target's entitlements file, and its `SceneDelegate` SHALL forward both `scene(_:continue:)` and `scene(_:openURLContexts:)` to React Native's linking manager (`RCTLinkingManager.scene(_:continue:)` and `RCTLinkingManager.scene(_:openURLContexts:)`).
When a link launches the app, the `SceneDelegate` SHALL convert the scene's connection options (a browsing-web user activity, or else the first URL context) into the launch options it starts React Native with.
The launcher SHALL receive the full, unmodified `https` URL: through `Linking.getInitialURL()` when the link launched the app, and through the `url` event when the app was already running.

#### Scenario: Cold start from a universal link
- **WHEN** Whim isn't running and the user taps `https://whim.<domain>/a/app-abc` on an iPhone where the association file is served
- **THEN** Whim launches and `Linking.getInitialURL()` returns exactly that URL

#### Scenario: Warm link
- **WHEN** Whim is in the background and the user taps an app link
- **THEN** Whim comes forward and the launcher's `url` listener receives exactly that URL
