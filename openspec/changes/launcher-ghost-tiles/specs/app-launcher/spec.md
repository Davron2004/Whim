# app-launcher Specification

## ADDED Requirements

### Requirement: The home grid renders ghost tiles for pending-build records

The home grid SHALL render one greyed, non-launchable tile for every pending-build record, interleaved with installed-app tiles. A ghost tile MUST NOT be tappable as a launch action — tapping it opens the build or failure screen (per the ghost interaction requirement below), never a running mini-app.

#### Scenario: A building generation shows a ghost tile

- **WHEN** a generation is in flight and the user is on the home screen
- **THEN** the grid shows a greyed tile for that pending-build record alongside the installed apps

#### Scenario: A ghost tile does not launch an app

- **WHEN** the user taps a ghost tile
- **THEN** no mini-app realm is opened

### Requirement: Building and failed/interrupted ghosts are visually distinct

A ghost tile SHALL render a state caption and visual treatment that distinguishes `building` from `failed`/`interrupted`: a `building` ghost carries a neutral in-progress treatment, while `failed` and `interrupted` ghosts carry a shared alert accent distinct from `building`.

#### Scenario: A building ghost looks different from a failed one

- **WHEN** the grid renders one `building` ghost and one `failed` ghost
- **THEN** their visual treatments differ, and each carries a state caption naming its own state

### Requirement: Ghost tile color is a deterministic hash of the launcher id, stable across transmute

A ghost tile's color SHALL be derived deterministically from its pending-build record's launcher id, using the same tile-color derivation the installed tile will use once delivered. The color MUST NOT change when the ghost transmutes into the delivered tile at the same grid position.

#### Scenario: Same id, same color, before and after delivery

- **WHEN** a ghost tile with launcher id X is showing, and its generation is then delivered as an installed app with id X
- **THEN** the tile color at that position is unchanged across the transmute

#### Scenario: Color is deterministic for a given id

- **WHEN** the same launcher id is hashed to a tile color twice
- **THEN** both derivations produce the same color

### Requirement: A ghost tile displays a working title

A ghost tile SHALL display the pending-build record's working title (derived from the user's prompt) as its label, since no app name exists until delivery.

#### Scenario: Ghost label before a name exists

- **WHEN** a ghost tile renders for a pending-build record with no delivered app yet
- **THEN** the tile's visible label is the record's working title, not a blank or placeholder name

### Requirement: Tapping a ghost tile opens the build or failure screen by state

Tapping a `building` ghost tile SHALL reopen the build-progress screen, reattaching to the in-flight generation. Tapping a `failed` or `interrupted` ghost tile SHALL open the failure screen, hydrated from the record's persisted failure payload.

#### Scenario: Tap a building ghost

- **WHEN** the user taps a `building` ghost tile
- **THEN** the build-progress screen opens, reflecting the still-running generation

#### Scenario: Tap a failed ghost

- **WHEN** the user taps a `failed` ghost tile
- **THEN** the failure screen opens, showing the reason and diagnostics persisted on that record

#### Scenario: Tap an interrupted ghost

- **WHEN** the user taps an `interrupted` ghost tile
- **THEN** the failure screen opens, showing that the attempt was interrupted

### Requirement: Long-press on a ghost tile offers Cancel or Dismiss, never both

Long-pressing a `building` ghost tile SHALL offer a Cancel action. Long-pressing a `failed` or `interrupted` ghost tile SHALL offer a Dismiss action. A ghost tile's long-press menu MUST NOT offer both actions at once.

#### Scenario: Long-press a building ghost

- **WHEN** the user long-presses a `building` ghost tile
- **THEN** the action sheet offers Cancel and does not offer Dismiss

#### Scenario: Long-press a failed or interrupted ghost

- **WHEN** the user long-presses a `failed` or `interrupted` ghost tile
- **THEN** the action sheet offers Dismiss and does not offer Cancel

### Requirement: No always-visible cancel affordance on the ghost tile face

A ghost tile's resting visual state SHALL NOT show a cancel or dismiss control on its face. Destructive actions are reached only through long-press, never a persistent button on the tile itself.

#### Scenario: A resting ghost tile has no visible cancel control

- **WHEN** a `building` ghost tile is rendered in its resting state, not long-pressed
- **THEN** no cancel or dismiss control is visible on the tile

### Requirement: Grid composition dedupes pending and installed entries by id, pending wins

When composing the grid from pending-build records and installed-app records, an id present in both lists SHALL render exactly once, as the pending (ghost) tile, until the pending record is deleted.

#### Scenario: Transmute does not double-render

- **WHEN** a pending-build record and its just-delivered installed-app record briefly coexist under the same id during a delivery sequence
- **THEN** the grid shows exactly one tile for that id, not two

### Requirement: Rebuilding an existing app marks its installed tile as building, spawning no ghost

When the user re-prompts an existing installed app, the home grid SHALL show that app's existing installed tile in a `building` state for the duration of the generation. No separate ghost tile SHALL appear for the rebuild attempt.

#### Scenario: Re-prompting an installed app greys its own tile

- **WHEN** the user re-prompts an existing app and the generation starts
- **THEN** that app's existing tile shows a `building` state, and the grid gains no additional tile
