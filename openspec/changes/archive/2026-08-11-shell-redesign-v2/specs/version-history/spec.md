## MODIFIED Requirements

### Requirement: History reads as the user's own prompts
The history screen SHALL present an app's versions as a newest-first timeline. Its header SHALL name the app in that app's own tile hue followed by `history`, over a subtitle counting the versions and naming when the app started.

Each collapsed row SHALL carry a kind badge, a human-readable timestamp, the version identifier, an origin line reading `You said` when the user's prompt caused the version and `Whim, on its own` when the product acted unprompted, and a headline. The headline SHALL be the stored summary's text when the version has one, and SHALL fall back to the version's prompt text otherwise — parsing the prompt envelope (any version of it) when present and falling back to the raw stored string when it is not. Headlines SHALL be rendered through the shared Whim Syntax renderer, so the user's own words carry the `yours` class and mentions of an app carry its hue.

The version the user is currently on SHALL be marked `↑ you're on this one` beneath its row, derived live from the store and never persisted on the app record. Version-control vocabulary SHALL never appear; every user-visible string SHALL come from the centralized copy table and pass the product-verbs guard.

#### Scenario: Summarised rows
- **WHEN** the user opens History for an app whose versions carry stored summaries
- **THEN** each row shows that summary as its headline, with its kind badge, timestamp, version identifier and origin line, newest first

#### Scenario: A version with no summary falls back to its prompt
- **WHEN** a version was delivered before summaries existed, or its run produced none
- **THEN** the row shows that version's prompt text as its headline and the screen does not error

#### Scenario: Raw legacy prompt string
- **WHEN** a version's stored prompt is not valid envelope JSON (e.g. a seeded fixture)
- **THEN** the row shows the raw string unchanged and the screen does not error

#### Scenario: Install row
- **WHEN** the list reaches the app's first version (the install event)
- **THEN** the row shows install-appropriate copy, and offers no restore action (there is no earlier state)

#### Scenario: Current version is marked
- **WHEN** the list renders after a restore
- **THEN** `↑ you're on this one` appears beneath the now-active version's row and beneath no other

### Requirement: Data-shape annotations and restore reassurance
A history row whose version changed the app's data shape SHALL carry a one-line annotation naming the added fields and their types (computed from the schema artifacts; additive-only evolution means only additions/display-renames can appear). The annotation SHALL appear in the row's expanded body alongside what the version touched, and SHALL be rendered through the shared renderer so counted things carry the `measure` class and the annotation itself reads as a `hedge` — honest detail that is not the point.

When a restore targets a version whose schema lacks fields the user has since gained, the reassurance that nothing is deleted and the data returns with newer versions SHALL appear in the confirm sheet's body, where the user reads it before deciding.

#### Scenario: Added-field annotation
- **WHEN** a version's prompt added a "notes" text field to the app's data
- **THEN** its expanded body carries an annotation naming "notes" and its type

#### Scenario: Restore reassurance
- **WHEN** the user opens the confirm sheet for a version predating a field that now holds their data
- **THEN** the sheet's body states the data is kept and returns on newer versions, and no data is deleted

### Requirement: Any version can become its own app
Every listed version SHALL offer `Start a copy here` in its expanded body, creating a new launcher entry from that exact version via the existing fork flow. The action SHALL open a confirm sheet before anything is created, titled to name the version being copied, whose body states that the user will have two apps and that the one they are using now stays exactly as it is, and whose confirming action reads `Make the copy`. On confirmation a toast SHALL report `Copy made — it's on your home screen`. The new app SHALL start with its own fresh user data (existing fork semantics unchanged by this change).

#### Scenario: Fork from an old version
- **WHEN** the user invokes the action on a version that is not the newest and confirms
- **THEN** a new launcher entry appears whose code is exactly that version, the original app is unchanged, and the toast reports the copy is on the home screen

#### Scenario: Nothing is copied without confirming
- **WHEN** the user opens the copy confirm sheet and takes the safe option
- **THEN** no new launcher entry is created

## ADDED Requirements

### Requirement: Tapping a row expands it; restoring is confirmed, never instant
Tapping a history row SHALL expand it and SHALL NOT change which version is active. At most one row SHALL be expanded at a time. Restoring SHALL be reachable only as an explicit action inside an expanded row, and SHALL take effect only after a confirm sheet is confirmed. Nothing destructive SHALL be one tap away.

On confirmation the app SHALL be restored to the chosen version and a toast SHALL report which version the user is now on. Versions later on the same line SHALL remain listed and restorable afterwards.

#### Scenario: A tap is safe
- **WHEN** the user taps a history row
- **THEN** the row expands and the active version is unchanged

#### Scenario: Restore goes through the sheet
- **WHEN** the user takes the restore action in an expanded row
- **THEN** a confirm sheet opens, and the app is restored only once the user confirms it

#### Scenario: Backing out of the sheet changes nothing
- **WHEN** the user opens the restore confirm sheet and takes the safe option
- **THEN** the active version is unchanged and no toast is shown

### Requirement: An expanded row answers what happened, what it touched, and what to do next
An expanded row SHALL show, in order: the result in plain words (the stored summary's body, rendered through the shared renderer), the eyebrow `What it touched` over chips naming the areas the version affected — area names, never diffs — and at most two next actions.

The current version SHALL offer exactly one action, `Change it from here`, opening the compose step scoped to that app. Any past version SHALL offer exactly two, `Go back to this` and `Start a copy here`. No third action SHALL be added to a row.

#### Scenario: The current version offers one action
- **WHEN** the newest version's row is expanded
- **THEN** it offers `Change it from here` and no restore or copy action

#### Scenario: A past version offers exactly two
- **WHEN** a past version's row is expanded
- **THEN** it offers `Go back to this` and `Start a copy here`, and nothing else

#### Scenario: Touched areas are named, not diffed
- **WHEN** an expanded row lists what the version touched
- **THEN** each chip names an area of the app in plain words, and no file name, symbol, or diff appears

### Requirement: Filter pills group the list by what changed
The history screen SHALL render filter pills above the list: an all-versions pill whose label carries the live count of versions in the list, plus one pill per kind group derived from each version's summariser kind. Selecting a pill SHALL filter the list to that group; the all-versions pill SHALL be selected by default. A version with no summariser kind SHALL remain reachable under the all-versions pill.

#### Scenario: The count is live
- **WHEN** a new version is delivered and History is reopened
- **THEN** the all-versions pill's count includes it

#### Scenario: Filtering narrows the list
- **WHEN** the user selects a kind pill
- **THEN** only versions of that group are listed, and selecting the all-versions pill restores the full list

#### Scenario: Unclassified versions are never hidden
- **WHEN** a version carries no summariser kind
- **THEN** it appears under the all-versions pill

### Requirement: A confirm sheet makes the safe option the large button
Every confirm sheet on this surface SHALL present the safe option as the large, full-width button and SHALL demote the consequential action to plain text beneath it. The sheet SHALL rise from the bottom edge it will return to, and its body SHALL say in plain words what the user will be left with — for a restore, what comes off, what is kept, and that they can come forward again from this list.

#### Scenario: The safe option is the prominent one
- **WHEN** any restore or copy confirm sheet is shown
- **THEN** the button that changes nothing is the large one, and the action that changes something is plain text

#### Scenario: The body says what is lost and what is kept
- **WHEN** a restore confirm sheet is shown
- **THEN** its body names what comes off, states the user's saved data stays, and states they can come forward again from this list

## REMOVED Requirements

### Requirement: Tap restores the state before that prompt, instantly, with undo

**Reason**: Replaced by "Tapping a row expands it; restoring is confirmed, never instant". The redesigned history screen makes nothing destructive one tap away: a tap expands a row, and restore is an explicit action behind a confirm sheet whose safe option is the large button. Instant-restore-with-undo is not kept alongside it — two restore paths with different safety properties on one screen is worse than either, and there is no longer an unconfirmed action for a toast Undo to reverse. The guarantees that survive are re-stated in their new homes: the current version stays visibly marked and derived live from the store ("History reads as the user's own prompts"), and versions later on the line remain listed and restorable ("Roll-forward — restored-past versions remain listed and reachable", unchanged).

**Migration**: None. Restore semantics in the store are unchanged; only the surface that reaches them changed.

### Requirement: Named pins

**Reason**: An expanded history row surfaces exactly two next actions — the two things you would want to do next — and pinning is neither of them. Rather than leave a shipped feature with no way to reach it, the pin surface is withdrawn: the redesigned row's headline is the version's stored summary, which is what labelling a version was standing in for. The store's pin verbs and the `StoreAccess` wrappers over them are not removed by this change; only the launcher surface that offered pinning and rendered pin labels is.

**Migration**: Any pin already stored remains in the version store and is simply not rendered. No pin is deleted, and no cleanup pass runs.
