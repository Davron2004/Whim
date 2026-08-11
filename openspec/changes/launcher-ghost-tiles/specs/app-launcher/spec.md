# app-launcher Specification

## MODIFIED Requirements

### Requirement: A tile's colour is the app's declared colour, with a deterministic fallback

The launcher SHALL take an app's tile colour from the host-held record's manifest when the app declared one, and next from a launcher-injected colour when the app declared none but the launcher recorded one (a new install's ghost-tile id hash, preserved across rebuilds per the "Ghost tile color is a deterministic hash of the launcher id" requirement below), and SHALL fall back to `appColor(name)` only when the record carries neither a declared nor a launcher-injected colour, when the declaration is malformed, or when it collides with a reserved status hue. The colour SHALL be read from the host-held record only — never from anything the running bundle reports about itself — and the launcher SHALL NOT hold a second name→colour mapping of its own.

Every surface that shows an app's colour — the grid tile, the history header, and an `app`-class span in prose — SHALL resolve it through this one path, so a single app is one colour everywhere.

#### Scenario: A declared colour wins

- **WHEN** an installed app's record carries a valid declared tile colour
- **THEN** its tile and every `app`-class mention of it render in that colour

#### Scenario: A launcher-injected colour wins over the name hash

- **WHEN** an installed app's record carries a launcher-injected tile colour (a new install with no declared colour of its own) rather than a declared one
- **THEN** its tile and every `app`-class mention of it render in the injected colour, not `appColor(name)`

#### Scenario: A pre-existing app keeps working

- **WHEN** an app installed before declarations existed is rendered
- **THEN** its colour resolves from `appColor(name)` and nothing in the grid, history, or prose errors or renders colourless

#### Scenario: The bundle cannot recolour itself

- **WHEN** a running mini-app reports a different colour than its host-held record carries
- **THEN** the launcher SHALL use the record's value

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

### Requirement: Ghost tile color is a deterministic hash of the launcher id, stable across transmute and undeclared rebuilds

A ghost tile's color SHALL be derived deterministically from its pending-build record's launcher id, using the same tile-color derivation the installed tile will use once delivered. When the delivered app's manifest declares no tile color of its own, the color MUST NOT change as the ghost transmutes into the delivered tile at the same grid position, nor across a later rebuild whose own manifest ALSO declares no tile color. A manifest that DOES declare a tile color — at delivery or on a later rebuild — is the app stating its own identity (`sdk-design-system`), and that declaration wins over the derived hash; a color change at delivery, or at a rebuild whose manifest declares a color, is then intended behavior, not a violation of this requirement.

#### Scenario: Same id, same color, before and after delivery

- **WHEN** a ghost tile with launcher id X is showing, and its generation is delivered as an installed app with id X whose manifest declares no tile color
- **THEN** the tile color at that position is unchanged across the transmute

#### Scenario: A manifest that declares its own color takes it at delivery

- **WHEN** a ghost tile with launcher id X is showing, and its generation is delivered with a manifest that declares its own tile color
- **THEN** the delivered tile renders the declared color rather than the id-derived one

#### Scenario: Rebuilding does not move a delivered app's color

- **WHEN** an app delivered under the id-derived color is re-prompted and rebuilt, and the rebuilt manifest declares no tile color of its own
- **THEN** the tile still renders the color it has rendered since delivery, not a name-derived one

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
