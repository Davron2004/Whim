## ADDED Requirements

### Requirement: A needs-update tile ends when Whim has caught up
A failed attempt whose record names an `update` remedy SHALL show the Needs update tile only while the running Whim's protocol level is at or below the level the remedy names, and SHALL otherwise show the ordinary failed tile. The tile and the Failure page it opens SHALL decide with the same predicate.

#### Scenario: Whim updated since the failure
- **WHEN** a record names an `update` remedy at a protocol level the running Whim already meets
- **THEN** its tile reads "Didn't work", not "Needs update", and its menu has Try again

#### Scenario: Whim still too old
- **WHEN** a record names an `update` remedy above the running Whim's protocol level
- **THEN** its tile reads "Needs update" and its menu offers Update Whim and Discard

### Requirement: A Needs update tile opens the Failure page
A Needs update tile SHALL open the Failure page in its needs-a-newer-Whim kind (Update Whim, Not now), never a separate update screen.

#### Scenario: A Needs update tile opens the Failure page
- **WHEN** a record names an `update` remedy above the running Whim's protocol level and the person taps its tile
- **THEN** the Failure page opens with Update Whim and Not now, and no separate update screen opens

### Requirement: The Whim sheet offers See why for a failed change
While a change to the running app has failed and no newer change of that app is running, the Whim sheet SHALL show a "See why" row that opens that change's Failure page inside the sheet, the same page the failed-change toast's See why opens. The row SHALL stay after the toast has expired, for as long as the orb shows its `danger` dot, and SHALL be absent when no change has failed or once a new change of the app is running.

#### Scenario: See why after the toast has gone
- **WHEN** a change to the open app fails, the toast expires unread, and the person taps the orb
- **THEN** the Whim sheet shows a "See why" row, and tapping it shows the change's Failure page in the sheet

#### Scenario: No failed change
- **WHEN** the Whim sheet opens over an app whose last change landed or that has never been changed
- **THEN** it shows no "See why" row

### Requirement: A copy and a rewind continuation both read Copy
A launcher entry made from another entry SHALL show "Copy" as its tile label, whether the person made it with Make a copy or it is the continuation created when an app was changed while on an older version. The label SHALL NOT say whether the entry shares saved data with its original.

#### Scenario: Changing an app on an older version
- **WHEN** the person changes an app while it is on an older version and the change lands as a new launcher entry
- **THEN** the new tile reads "Copy"

#### Scenario: Make a copy
- **WHEN** the person makes a copy of an app with Make a copy
- **THEN** the new tile reads "Copy"
