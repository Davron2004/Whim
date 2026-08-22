## ADDED Requirements

### Requirement: Opening an app shows an immediate busy affordance
Tapping an app tile SHALL show a pressed/busy affordance on that tile immediately, persisting
until the launcher switches to the mini-app screen or the open attempt fails. A tap MUST NOT be
allowed to read as unregistered while the app's active bundle is being read.

#### Scenario: A slow open still looks alive
- **WHEN** the user taps an app tile and reading its active bundle takes noticeably long
- **THEN** the tile shows a busy affordance from the moment of the tap until the screen switches

#### Scenario: A failed open clears the busy affordance
- **WHEN** opening an app fails
- **THEN** the tile's busy affordance clears and the existing failure alert is shown

### Requirement: Fork and delete show a busy state and cannot be re-triggered mid-operation
The Fork and Delete actions SHALL each show a busy state on their triggering control while their
underlying version-store operation runs, and SHALL be disabled against re-triggering for the same
app until that operation completes (success or failure).

#### Scenario: Fork disables re-triggering
- **WHEN** the user chooses a fork option and the fork operation is still running
- **THEN** the fork action is shown busy and cannot be invoked again for that app until it
  completes

#### Scenario: Delete disables re-triggering
- **WHEN** the user confirms delete and the delete operation is still running
- **THEN** the delete action is shown busy and cannot be invoked again for that app until it
  completes

### Requirement: The mini-app container shows a boot state before first paint
The mini-app container SHALL render a branded, minimal boot state, rather than a blank WebView, between binding a realm and that realm's first paint (or a launch failure). The boot state SHALL be replaced by the running realm as soon as first paint is observed, and by the existing launch-failure state if the launch fails first.

#### Scenario: A slow-loading bundle shows a boot state, not a blank screen
- **WHEN** an app is opened and the realm has bound but has not yet reported first paint
- **THEN** the container shows the boot state rather than an empty WebView

#### Scenario: First paint replaces the boot state
- **WHEN** the realm reports its first paint
- **THEN** the boot state is no longer shown and the rendered mini-app is visible

#### Scenario: A launch failure replaces the boot state, not the other way around
- **WHEN** the realm's launch fails before any paint is observed
- **THEN** the existing launch-failure state is shown, not the boot state
