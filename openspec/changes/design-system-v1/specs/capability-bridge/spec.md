## ADDED Requirements

### Requirement: The host-held manifest is the record of the version the realm runs
The host SHALL launch a realm with the manifest and schema of the version whose code it runs, read from that saved version together with its code in one step, so no version switch can land between the two; a copy of the app record held by a screen, or written to the app list, MUST NOT be what gates. The host's own fields (app id, name, tile) come from the app list. A version saved before versions kept their manifest runs with the record the app holds now: a known pre-release limitation (decision #81).

#### Scenario: Undo after leaving History runs the newest version's grants
- **WHEN** the user uses version 1 from History opened over Home, goes back to Home, taps Undo on the toast, and opens the app from Home
- **THEN** the newest version's code runs with the newest version's manifest: a capability only version 1 declared is refused, and the newest version's own capabilities are granted

#### Scenario: An Undo still running when History is left
- **WHEN** History was opened over the running app, the user taps Undo, and leaves History before the Undo has finished
- **THEN** the app reopens on the version the Undo returns to, with that version's manifest

#### Scenario: The app list and the store disagree after a failed write
- **WHEN** a version switch has moved the app but writing its record to the app list failed
- **THEN** the switch still stands, the next launch runs that version with its own manifest and schema, and writes that record to the app list
