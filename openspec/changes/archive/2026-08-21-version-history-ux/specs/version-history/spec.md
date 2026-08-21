# Delta Spec: version-history (new capability)

## ADDED Requirements

### Requirement: History reads as the user's own prompts
The history screen SHALL present an app's versions as a newest-first list of the prompts that produced them, each with a human-readable timestamp. The screen SHALL render the prompt of each version by parsing the prompt envelope (`{v: 1, text}` JSON) when present and falling back to the raw stored string otherwise. Version-control vocabulary SHALL never appear; every user-visible string SHALL come from the centralized copy table and pass the product-verbs guard.

#### Scenario: Prompts as list rows
- **WHEN** the user opens History for an app that has versions produced by prompts
- **THEN** each row shows that prompt's text (envelope-parsed when applicable) and a timestamp, newest first

#### Scenario: Raw legacy prompt string
- **WHEN** a version's stored prompt is not valid envelope JSON (e.g. a seeded fixture)
- **THEN** the row shows the raw string unchanged and the screen does not error

#### Scenario: Install row
- **WHEN** the list reaches the app's first version (the install event)
- **THEN** the row shows install-appropriate copy, and offers no restore action (there is no earlier state)

### Requirement: Tap restores the state before that prompt, instantly, with undo
Tapping a history row SHALL immediately restore the app to the state that existed *before* that row's prompt was applied (the previous version), with no confirmation dialog. A toast SHALL offer a single-tap Undo that returns the app to the version active before the restore. The current version SHALL be visibly marked in the list, derived live from the store (never persisted on the app record), and SHALL update after every restore.

#### Scenario: Instant restore
- **WHEN** the user taps the row for a prompt that broke their app
- **THEN** the app is restored to the version preceding that prompt and a toast with Undo appears

#### Scenario: Undo
- **WHEN** the user taps Undo on the restore toast before it times out
- **THEN** the app returns to the version that was active before the restore

#### Scenario: Current marker follows restores
- **WHEN** a restore or undo completes
- **THEN** the current-version marker in the list moves to the now-active version

### Requirement: Roll-forward — restored-past versions remain listed and reachable
After the user restores backward, versions later on the same line SHALL remain visible in the history list and SHALL be restorable (roll-forward) exactly like earlier versions. Rolling backward and then forward SHALL never lose or alter any version.

#### Scenario: Future stays visible after rewind
- **WHEN** the user restores to an older version and reopens History
- **THEN** the versions they rewound past are still listed and individually restorable

#### Scenario: Round trip
- **WHEN** the user restores from version B back to A, then forward to B again
- **THEN** the app's code and behavior at B are identical to before the round trip

### Requirement: Named pins
The user SHALL be able to pin any listed version under a custom label. Pinned versions SHALL show their label in the list. A label SHALL map to at most one version; pinning an existing label onto another version moves it.

#### Scenario: Pin with custom label
- **WHEN** the user pins a version and enters a label
- **THEN** that version's row shows the label, and the pin survives later generations and restores

#### Scenario: Re-pin moves the label
- **WHEN** the user pins a different version under an already-used label
- **THEN** the label appears only on the newly pinned version

### Requirement: Any version can become its own app
Every listed version SHALL offer a "make this version its own app" action that creates a new launcher entry from that exact version via the existing fork flow. The new app SHALL start with its own fresh user data (existing fork semantics unchanged by this change).

#### Scenario: Fork from an old version
- **WHEN** the user invokes the action on a version that is not the newest
- **THEN** a new launcher entry appears whose code is exactly that version, and the original app is unchanged

### Requirement: Data-shape annotations and restore reassurance
A history row whose prompt changed the app's data shape SHALL carry a one-line annotation naming the added fields and their types (computed from the schema artifacts; additive-only evolution means only additions/display-renames can appear). When a restore targets a version whose schema lacks fields the user has since gained, the screen SHALL show a one-line reassurance that nothing is deleted and the data returns with newer versions.

#### Scenario: Added-field annotation
- **WHEN** a version's prompt added a "notes" text field to the app's data
- **THEN** its row carries an annotation naming "notes" and its type

#### Scenario: Restore reassurance
- **WHEN** the user restores to a version predating a field that now holds their data
- **THEN** a reassurance message states the data is kept and returns on newer versions, and no data is deleted
