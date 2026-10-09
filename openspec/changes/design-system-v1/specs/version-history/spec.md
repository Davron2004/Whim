## REMOVED Requirements

### Requirement: Tapping a row expands it; restoring is confirmed, never instant

**Reason**: Going back to a version is immediate with Undo (decision #75): every version stays listed, so nothing is lost.
**Migration**: See "Using an older version is immediate and undoable".

### Requirement: Any version can become its own app

**Reason**: "Make a copy from here" is immediate and always starts fresh.
**Migration**: See "Any version can become its own app at once".

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
An expanded older version SHALL offer "Use this version"; tapping it SHALL make that version active at once and show the toast "Back on version N" with Undo, and every Undo SHALL stay reachable from History after the toast ends. Later versions SHALL remain listed and usable. When going back would hide saved data, the expanded row SHALL say so before the tap: "Some saved data won't show in this version. It isn't deleted and comes back when you return." The current version's expanded row SHALL offer "Change it".

#### Scenario: Undo returns to the newer version
- **WHEN** the user uses version 3 of 4 and taps Undo
- **THEN** version 4 is active again and both remain listed

### Requirement: Any version can become its own app at once
Every expanded version SHALL offer "Make a copy from here", which SHALL create a new launcher entry from that exact version at once, with its own fresh data (#43b), and show the toast "Copy made" with Open. The original SHALL be unchanged.

#### Scenario: Copy from an old version
- **WHEN** the user taps "Make a copy from here" on version 2
- **THEN** a new app whose code is version 2 appears on Home, starts with empty data, and the original is unchanged
