## ADDED Requirements

### Requirement: Settings carries a "Send error details" switch, on by default
The launcher SHALL persist an error-details preference under `whim.error-details:v1`, where a missing or unreadable value means on. It SHALL expose it through a non-RN module that other launcher code reads, so any diagnostics transport can honour it. The Settings AI features section SHALL show it as a "Send error details" switch with the hint from the copy table. Turning it off SHALL take effect before the next diagnostic upload decision. The switch SHALL exist, and SHALL be named on the consent screen, before any diagnostics transport ships.

#### Scenario: Default is on
- **WHEN** the preference has never been set
- **THEN** the module reports error details as on, and the switch reads on

#### Scenario: Turning it off persists
- **WHEN** the user turns the switch off and restarts the app
- **THEN** the module reports error details as off, and the switch reads off

### Requirement: Settings shows this phone's ID and can make a new one
The Settings About section SHALL show "This phone's ID" with the ID the launcher sends as `x-whim-device`, as selectable text, and a hint saying to include it when asking about one's data. A "Make a new ID" action SHALL, after a confirm step whose text says old records are kept for up to 12 months and can be deleted sooner on request, replace the stored ID with a new random one. Every later request SHALL carry the new ID. Making a new ID SHALL NOT change the consent grant, the terms acceptance, or any installed app.

#### Scenario: The ID shown is the ID sent
- **WHEN** the user reads the ID in Settings and then builds an app
- **THEN** the build request's `x-whim-device` header equals the ID shown

#### Scenario: Making a new ID
- **WHEN** the user confirms "Make a new ID"
- **THEN** Settings shows a different ID, the next request carries it, and consent stays granted

#### Scenario: Cancelling keeps the ID
- **WHEN** the user opens the confirm step and cancels
- **THEN** the stored ID is unchanged
