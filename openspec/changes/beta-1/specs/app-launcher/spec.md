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

### Requirement: The Settings screen persists a server address for the prompt flow
Every build of the launcher SHALL let the user point Whim at their own server: an optional override of the compiled-in production server (see `release-config`), used by every request the launcher sends, including reports and diagnostics. The override SHALL be honoured only after the user has confirmed, once per install, that the chosen server sees everything Whim sends, that its operator decides what it keeps, and that Whim's privacy policy doesn't cover it. Until that acknowledgement is recorded, a saved address (including one saved by an earlier build) SHALL stay unread and every request SHALL go to the compiled-in server. The field SHALL live in the Settings screen's Advanced section and SHALL be editable only after the acknowledgement. While an override is active, a caption under the field SHALL restate that the user's server is the user's responsibility. A blank address SHALL mean "no override" and SHALL never cause a crash. An `http://` address SHALL be accepted only for an IP literal, `localhost`, a `.local` name or a single-label host; any other host SHALL require `https://`, and a refused address SHALL be explained inline and not saved. When an override is saved, a plain-text action SHALL offer to go back to the default server, and taking it SHALL clear the override and keep the acknowledgement. The field's placeholder SHALL name the default server's host so the user can see what "no override" means.

#### Scenario: Configured address is used
- **WHEN** the user has confirmed the acknowledgement, entered a server address in Settings and submits a prompt
- **THEN** the clarify, rewrite, generation and report requests target that address

#### Scenario: No override uses the default server
- **WHEN** no server address has been entered and the user submits a prompt with consent granted
- **THEN** the requests target the compiled-in production server, and no "set an address in Settings" message is shown

#### Scenario: The acknowledgement comes first
- **WHEN** a user opens Advanced for the first time and takes "Use your own server"
- **THEN** a confirm sheet explains that the server sees everything Whim sends and that Whim's privacy policy doesn't cover it; cancelling leaves no field and no override, and confirming shows the field

#### Scenario: An address from an earlier build waits for the acknowledgement
- **WHEN** a build starts on a phone where an earlier build saved an override and no acknowledgement is recorded
- **THEN** every request targets the compiled-in production server, and Settings shows the saved address only after the user confirms

#### Scenario: Plain http only for a local server
- **WHEN** the user enters `http://192.168.1.20:8787` and then `http://example.com`
- **THEN** the first is saved and used, and the second is refused inline with a note that non-local servers need `https://`

#### Scenario: Going back to the default
- **WHEN** an override is saved and the user takes the use-the-default action
- **THEN** the field is empty, the next request targets the compiled-in production server, and the field stays available without a second acknowledgement

### Requirement: Settings groups its controls into titled sections, with the server address under Advanced
The Settings screen SHALL present, in order:
- an AI features section, holding the consent row (see `ai-data-consent`) and the "Send error details" switch (see `privacy-settings`);
- the existing Highlighting section;
- an About section, with the privacy policy, terms of use and support links and the "This phone's ID" row (see `privacy-settings`);
- an Advanced section holding the own-server action and, once acknowledged, the server address.

The Advanced section SHALL be collapsed by default behind one row, SHALL open with a tap, and SHALL render already open while an acknowledged override is saved. Whether it is open SHALL NOT be persisted. Every string SHALL come from the copy table, and every style from the shell palette and SDK tokens.

#### Scenario: Advanced is in every build
- **WHEN** a user of a store build opens Settings
- **THEN** AI features, Highlighting, About and a collapsed Advanced section are visible

#### Scenario: An override keeps Advanced open
- **WHEN** a user with an acknowledged, saved override opens Settings
- **THEN** the Advanced section is already open and shows the saved address with the responsibility caption

#### Scenario: About carries the legal links and the ID
- **WHEN** the user opens Settings
- **THEN** the About section shows the privacy policy, terms of use and support links and this phone's ID
