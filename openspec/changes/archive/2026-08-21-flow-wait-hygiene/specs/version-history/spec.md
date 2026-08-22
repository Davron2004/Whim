## ADDED Requirements

### Requirement: History's first load shows a loading state, never fake-empty
While the initial snapshot list and active version are being read, the history screen SHALL
render a loading state distinguishable from a truly-empty history. The list SHALL NOT render as
zero rows before the first load has actually resolved.

#### Scenario: A slow first load is not mistaken for empty history
- **WHEN** the history screen opens and reading the snapshot list takes noticeably long
- **THEN** the screen shows a loading state, not an empty-history view

#### Scenario: A genuinely empty history still renders as empty once loaded
- **WHEN** the snapshot list resolves with only the install row
- **THEN** the loading state clears and the install-only list renders normally

### Requirement: The confirm sheet's Restore and Copy actions disable while in flight
Once the user confirms Restore or Copy on the confirm sheet, that action's control SHALL show a
busy state and SHALL be disabled against further taps until the underlying restore or fork
operation completes. Repeated taps MUST NOT queue more than one restore or fork operation for the
same confirmation.

#### Scenario: Restore cannot be double-submitted
- **WHEN** the user taps Restore on the confirm sheet and taps it again before the operation
  completes
- **THEN** only one restore operation runs

#### Scenario: Copy cannot be double-submitted
- **WHEN** the user taps Copy on the confirm sheet and taps it again before the operation
  completes
- **THEN** only one fork operation runs

### Requirement: The restore-diff reassurance line shows a pending state while it loads
The reassurance line's position SHALL show a subtle pending state, rather than staying absent and then popping in unannounced, while the confirm sheet computes which fields would leave view on a restore.

#### Scenario: The reassurance line does not pop in silently
- **WHEN** the restore confirm sheet opens and the fields-leaving-view computation is still
  running
- **THEN** a pending state is shown where the reassurance line will appear, before it resolves

#### Scenario: The pending state resolves to the reassurance text or nothing
- **WHEN** the computation resolves
- **THEN** the pending state is replaced by the reassurance line if fields would leave view, or
  by nothing if none would
