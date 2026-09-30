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


### Requirement: The home grid renders ghost tiles for pending-build records

The home grid SHALL render one greyed, non-launchable tile for every applicable current pending-build record supplied by PendingBuildStore, interleaved with installed-app tiles. A ghost tile MUST NOT be tappable as a launch action — tapping it opens the build or failure screen (per the ghost interaction requirement below), never a running mini-app. Current views marked volatile SHALL remain represented exactly once; raw stored state, a journal, or absent live refs SHALL NOT override that current view. Rebuild/edit attempts retain their existing exception and create no separate ghost.

#### Scenario: A building generation shows a ghost tile

- **WHEN** a generation is in flight and the user is on the home screen
- **THEN** the grid shows a greyed tile for that pending-build record alongside the installed apps

#### Scenario: A ghost tile does not launch an app

- **WHEN** the user taps a ghost tile
- **THEN** no mini-app realm is opened

#### Scenario: Known failure remains represented during a write outage

- **WHEN** the store retains a volatile failed entry whose raw pending record still says building
- **THEN** Home shows one failed ghost with the existing failed treatment, and tapping it opens its generic failure

#### Scenario: Partial Discard has not removed the current entry

- **WHEN** some raw keys were removed but retained Discard has not verified complete removal
- **THEN** Home still shows that current entry exactly once

### Requirement: Tapping a ghost tile opens the build or failure screen by state

Tapping a ghost tile whose current store state is `building` SHALL reopen the build-progress screen, reattaching to the in-flight generation. Tapping a `failed` or `interrupted` ghost tile SHALL open the failure screen, hydrated from its current store view under prompt-flow's persisted/volatile failure rules. Pending app-link routing SHALL consume the same current records and open the same handler as tapping the tile; a volatile failed entry SHALL NOT route to stale building or missing behavior. Ghost and app-link failure opening SHALL honor persisted `journalUnavailable: true` after a fresh launcher instance or process restart; lifecycle still comes only from the current pending record.

#### Scenario: Tap a building ghost

- **WHEN** the user taps a `building` ghost tile
- **THEN** the build-progress screen opens, reflecting the still-running generation

#### Scenario: Tap a failed ghost

- **WHEN** the user taps a `failed` ghost tile
- **THEN** the failure screen opens, showing the verified persisted reason and diagnostics or the store-retained generic failure as applicable

#### Scenario: Tap an interrupted ghost

- **WHEN** the user taps an `interrupted` ghost tile
- **THEN** the failure screen opens, showing that the attempt was interrupted

#### Scenario: A link opens a retained failed attempt

- **WHEN** an app link targets a current volatile failed entry whose raw state is building or whose raw key was partially removed during Discard
- **THEN** the same generic failure and recovery actions open as for tapping its ghost, with no new generation request


#### Scenario: Cold generic failure keeps its durable report guard

- **WHEN** Home or an app link opens a persisted generic failed record marked journalUnavailable after restart while an old raw journal still exists
- **THEN** the failed screen opens without that old report and the ghost remains failed; journal availability does not change its lifecycle state
