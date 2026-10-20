## REMOVED Requirements

### Requirement: Tapping a row expands it; restoring is confirmed, never instant

**Reason**: Going back to a version is immediate with Undo (decision #75): every version stays listed, so nothing is lost.
**Migration**: See "Using an older version is immediate and undoable".

### Requirement: Any version can become its own app

**Reason**: "Make a copy from here" needs no confirm sheet: it asks only Home's "Copy the data, or start fresh?" (skipped, starting fresh, when there is no saved data), and either way the copy has its own data.
**Migration**: See "Any version can be copied into its own app".

### Requirement: Filter pills group the list by what changed

**Reason**: Most apps have under 20 versions; the filter cost a row of chrome for a search nobody does.
**Migration**: None; kinds remain as neutral chips on each row.

### Requirement: A confirm sheet makes the safe option the large button

**Reason**: History no longer uses confirm sheets.
**Migration**: Undo toasts replace them; the confirm-sheet pattern lives on only for a new phone ID and the own-server switch.

### Requirement: The confirm sheet's Restore and Copy actions disable while in flight

**Reason**: The confirm sheet is gone.
**Migration**: The row's actions show their busy words and ignore taps while in flight.

## ADDED Requirements

### Requirement: History is a native-stack screen with the person's words as the hero
History SHALL be pushed on the native stack with a header back control and a `Report` text button, the title "History", the app's 40 pt tile, its name in its tint and the version count. Each version row SHALL show the person's words quoted (italic, `title3`), Whim's summary, "vN · <when>" in tabular figures, a neutral kind chip with its icon, and `Current` on the active version; the rail SHALL stop at v1. Tapping a row SHALL expand it without changing the active version; at most one row is expanded.

#### Scenario: The kind is not colour-coded
- **WHEN** History lists Added, Changed and Fixed versions
- **THEN** every kind chip has the same neutral colours and differs only by icon and word

### Requirement: Versions are ordered by the version chain, not the clock
History SHALL order versions by their position in the version chain (newest first) and label the first version of the line by its place in the chain, never by commit timestamps, so versions saved within the same second keep their true order.

#### Scenario: Two versions in one second
- **WHEN** two versions are saved within the same second
- **THEN** the later one is listed first and the "Start" chip is on the true first version

### Requirement: Using an older version is immediate and undoable
An expanded version that is not current SHALL offer "Use this version"; tapping it SHALL make that version active at once and show a toast with Undo: "Back on version N" when N is older than the version that was current, "Now on version N" when it is newer. Every Undo SHALL stay reachable from History after the toast ends. Later versions SHALL remain listed and usable. An Undo tapped while another of the row actions is still running SHALL be carried out once that action has finished, never dropped. The current version's expanded row SHALL offer "Change it".

#### Scenario: Undo returns to the newer version
- **WHEN** the user uses version 3 of 4 and taps Undo
- **THEN** version 4 is active again and both remain listed

#### Scenario: A used version runs with its own manifest and schema
- **WHEN** the user uses a version whose manifest or schema differs from the current one's, then taps Undo
- **THEN** the app runs that version with its own manifest and schema, and after Undo with the newer version's again

#### Scenario: Moving to a newer version says so
- **WHEN** the app is on version 2 of 4 and the user uses version 4
- **THEN** the toast reads "Now on version 4", not "Back on version 4"

#### Scenario: An Undo tapped during a copy is not lost
- **WHEN** the user uses version 3 of 4, then starts a copy, and taps the toast's Undo while the copy is being made
- **THEN** once the copy is made, version 4 is active again

### Requirement: Any version can be copied into its own app
Every expanded version SHALL offer "Make a copy from here", which SHALL ask the same "Copy the data, or start fresh?" question as "Make a copy" (skipped when there is no saved data) and SHALL create a new launcher entry from that exact version with its own storage (#43b), and show the toast "Copy made" with Open. The original SHALL be unchanged.

#### Scenario: Copy from an old version
- **WHEN** the user taps "Make a copy from here" on version 2
- **AND** answers "Start fresh"
- **THEN** a new app whose code is version 2 appears on Home, starts with empty data, and the original is unchanged

#### Scenario: The question's answer is taken once
- **WHEN** the user taps an answer to "Copy the data, or start fresh?" twice in quick succession
- **THEN** exactly one copy is made

## MODIFIED Requirements

### Requirement: History reads as the user's own prompts
The history screen SHALL present an app's versions as a newest-first timeline, ordered by the version chain. Its header SHALL be the title "History" over the app's 40 pt tile, the app's name in its tint and the number of versions ("4 versions").

Each row SHALL lead with the user's own words, quoted, in the italic that marks them as theirs: the version's prompt text, parsing the prompt envelope (any version of it) when present and falling back to the raw stored string when it is not. A version with no words of the user's SHALL lead with its stored summary's text instead, rendered through the shared Whim Syntax renderer. Under the words the row SHALL show Whim's summary when the version has one (and it is not already the headline), "vN · <when>" and the kind chip. Rows SHALL carry no origin line naming who caused the version.

The version the user is currently on SHALL carry the `Current` badge on its row, derived live from the store and never persisted on the app record. The first version of the chain SHALL carry the `Start` chip and, with no summary of its own, the line "Where this app began". Version-control vocabulary SHALL never appear; every user-visible string SHALL come from the centralized copy table and pass the product-verbs guard.

#### Scenario: Summarised rows
- **WHEN** the user opens History for an app whose versions carry stored summaries
- **THEN** each row leads with that version's own prompt, quoted, with Whim's summary under it, then the version, when, and its kind chip, newest first

#### Scenario: A version with no summary still shows its prompt
- **WHEN** a version was delivered before summaries existed, or its run produced none
- **THEN** the row shows that version's prompt text as its headline and the screen does not error

#### Scenario: Raw legacy prompt string
- **WHEN** a version's stored prompt is not valid envelope JSON (e.g. a seeded fixture)
- **THEN** the row shows the raw string unchanged and the screen does not error

#### Scenario: Install row
- **WHEN** the list reaches the app's first version
- **THEN** the row carries the `Start` chip, says "Where this app began" when it has no summary, and, when it is not current, offers Use this version and Make a copy from here like any other version

#### Scenario: Current version is marked
- **WHEN** the list renders after the user used another version
- **THEN** the `Current` badge is on the now-active version's row and on no other

### Requirement: An expanded row answers what happened, what it touched, and what to do next
Whim's summary of what a version did SHALL show on its row. Expanding the row SHALL show, in order: the eyebrow `What it touched` over chips naming the areas the version affected (area names, never diffs), the data-shape annotation when the version changed the data's shape, the hidden-data line when using the version would hide saved data, and its actions. Expanding SHALL NOT move the row's words.

The current version SHALL offer exactly one action, `Change it`, opening the compose step scoped to that app. Every other version, the first version included, SHALL offer exactly two, `Use this version` and `Make a copy from here`. No third action SHALL be added to a row.

#### Scenario: The current version offers one action
- **WHEN** the current version's row is expanded
- **THEN** it offers `Change it` and no other action

#### Scenario: A past version offers exactly two
- **WHEN** the row of a version that is not current is expanded, v1 included
- **THEN** it offers `Use this version` and `Make a copy from here`, and nothing else

#### Scenario: Touched areas are named, not diffed
- **WHEN** an expanded row lists what the version touched
- **THEN** each chip names an area of the app in plain words, and no file name, symbol, or diff appears

#### Scenario: The words stay where they are
- **WHEN** the user taps a row to expand it
- **THEN** its words keep their position, and the card grows around them

### Requirement: Data-shape annotations and restore reassurance
A history row whose version changed the app's data shape SHALL carry a one-line annotation naming the added fields and their types (computed from the schema artifacts; additive-only evolution means only additions/display-renames can appear). The annotation SHALL appear in the row's expanded body alongside what the version touched. It is product copy, not agent prose: it SHALL be drawn in `footnote` at the secondary text colour (`text-2`), never fainter, with no Whim Syntax mark.

When the current version's schema has fields the expanded version's lacks, the expanded row SHALL say so above its actions, before either is tapped: "If you use this version, some saved data won't show. It isn't deleted and comes back when you return." The line speaks only of using that version, and the current version's row never shows it.

#### Scenario: Added-field annotation
- **WHEN** a version's prompt added a "notes" text field to the app's data
- **THEN** its expanded body carries an annotation naming "notes" and its type, at the secondary text colour

#### Scenario: Restore reassurance
- **WHEN** the user expands a version that predates a field the current version has
- **THEN** before either action the row says that using it hides some saved data, which isn't deleted and comes back, and no data is deleted

#### Scenario: Nothing hidden, nothing said
- **WHEN** the user expands a version whose schema has every field the current version has, or the current version itself
- **THEN** the row shows no hidden-data line

### Requirement: The restore-diff reassurance line shows a pending state while it loads
While an expanded row works out whether using its version would hide saved data, the hidden-data line's place SHALL show a subtle pending state, rather than staying absent and then popping in unannounced.

#### Scenario: The reassurance line does not pop in silently
- **WHEN** the user expands a version that is not current and the fields-leaving-view computation is still running
- **THEN** a pending state is shown in the expanded row where the hidden-data line will appear, before it resolves

#### Scenario: The pending state resolves to the reassurance text or nothing
- **WHEN** the computation resolves, or fails
- **THEN** the pending state is replaced by the hidden-data line if fields would leave view, or by nothing if none would or the computation failed
