## ADDED Requirements

### Requirement: Text input never hides the content or action it belongs to
Every launcher screen and sheet with a text input SHALL keep the focused field and the screen's primary action visible above the keyboard, SHALL let the rest of the content scroll into view while the keyboard is up, and SHALL let the user dismiss the keyboard on both platforms without submitting.

#### Scenario: Compose on iOS
- **WHEN** a user types a description on the compose screen on iOS
- **THEN** Continue stays visible above the keyboard and tapping Done, tapping empty space, or dragging the content dismisses the keyboard

#### Scenario: Compose opens without the keyboard
- **WHEN** the compose screen opens
- **THEN** the description field is not focused and the suggestions are visible

#### Scenario: Every input screen
- **WHEN** the keyboard is up on plan editing, "Change it", the report sheet or any other input screen, on iOS or Android
- **THEN** the focused field and the primary action are visible and the content above scrolls

### Requirement: The host tells the realm how much of the bottom the orb covers
The host SHALL pass the orb's bottom footprint (its size, margin and the bottom safe-area inset) into the mini-app realm as a sanitized number between 0 and 200 through the theme channel, whenever it mounts a mini-app.

#### Scenario: Footprint delivered
- **WHEN** a mini-app mounts on a phone with a bottom safe-area inset
- **THEN** the realm receives the orb footprint including that inset

### Requirement: A post-paint render failure shows the failure screen
The host SHALL treat a trusted `render` error frame from the realm as fatal and show the failure screen with its recovery, exactly as for a mount failure.

#### Scenario: App crashes after it painted
- **WHEN** a mini-app throws during rendering after its first paint
- **THEN** the failure screen appears instead of a blank app

#### Scenario: Untrusted frame ignored
- **WHEN** a `render` error frame arrives without nonce authentication
- **THEN** the host does not act on it

### Requirement: Orb and tiles render cleanly on both platforms
The orb menu's dim layer SHALL cover the whole window including the status bar, the orb SHALL draw no extra shape on Android, each tile's watermark SHALL stay inside the tile's rounded corners without truncation, and the built-in example apps SHALL each have a distinct tile colour.

#### Scenario: Orb menu open
- **WHEN** the orb menu is open on iOS or Android
- **THEN** the status bar area is dimmed like the rest of the window and no grey disc is drawn at the orb

#### Scenario: Home grid of examples
- **WHEN** the home grid shows only the built-in examples
- **THEN** no two example tiles share a colour and no watermark is clipped or shows an ellipsis

### Requirement: Numbers in English copy use an English locale
The launcher SHALL format counts inside English copy with an explicit English locale, independent of the phone's locale.

#### Scenario: French phone
- **WHEN** the phone's locale is fr-CA and a run signal shows 1204 characters
- **THEN** the copy reads "1,204 characters"

## MODIFIED Requirements

### Requirement: History entry point in the app action sheet
The app long-press action sheet SHALL include a History action alongside Open/Fork/Delete, opening the app's full-screen history surface. The history screen SHALL follow the launcher's full-screen sibling pattern: its own back binding (its Back control and hardware back) returning to where it was opened from, which is Home when opened from the home grid and the running app, reopened at its current version, when opened from that app's orb, falling back to Home when that app cannot be reopened; theme colors via the shell palette; and all strings via the centralized copy table (product-verbs guard applies).

#### Scenario: Opening history
- **WHEN** the user long-presses an app tile and chooses History
- **THEN** the app's history screen opens full-screen, and hardware back returns to Home

#### Scenario: Opened from the orb
- **WHEN** the user opens History from a running app's orb and goes back
- **THEN** that app opens again, not Home

#### Scenario: The app cannot be reopened
- **WHEN** the user goes back from History opened over a running app and that app fails to open
- **THEN** the failure is shown and the user lands on Home, not on History
