## MODIFIED Requirements

### Requirement: A crashed app keeps the orb and offers a way forward

When a running app fails, the container SHALL show "<name> ran into a problem", "It stopped and can't carry on right now. Your saved data is safe.", Reload, "Ask Whim to fix it" (opening the change field prefilled with "Fix the error that stops this app." and the error text attached) and Back to your apps, and the orb SHALL stay. When the crashed launch is behind its app's current version (a change landed and was not reloaded, or an Undo moved the app after it opened), the body SHALL say a newer version is ready and the screen SHALL offer only Reload and Back to your apps: the error belongs to code that is no longer current, and a change is made from the current version, so the fix is offered once Reload runs that version (decision #82). When the launch failed because its WebView got no bridge token (`webview-message-provenance`), the failure is the host's, not the app's code: the screen SHALL offer only Reload and Back to your apps, and no error is attached anywhere.

#### Scenario: A crash is a change request

- **WHEN** the user taps "Ask Whim to fix it"
- **THEN** the Whim sheet opens with the prefilled request and the error attached, and the app is not closed

#### Scenario: A crash behind the current version leads with Reload

- **WHEN** a change of the app landed while it ran, was not reloaded, and the app then crashes
- **THEN** the crash screen says a newer version is ready and offers Reload and Back to your apps, without "Ask Whim to fix it", and after Reload a crash of the new version offers "Ask Whim to fix it" again

#### Scenario: A launch with no bridge token offers no fix

- **WHEN** an app is launched into a WebView that was handed no bridge token, and the crash screen shows
- **THEN** it offers Reload and Back to your apps, without "Ask Whim to fix it", while a crash of the app's own code, or of a WebView that died, still offers "Ask Whim to fix it"
