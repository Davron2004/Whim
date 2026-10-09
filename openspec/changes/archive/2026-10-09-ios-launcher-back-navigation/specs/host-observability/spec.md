## MODIFIED Requirements

### Requirement: Every screen renders inside a recoverable error boundary
Every launcher screen SHALL render inside a React error boundary. A render, lifecycle, or
effect-mount throw in any screen SHALL be caught by that boundary and SHALL NOT unmount the
launcher tree. The boundary SHALL render a recoverable error screen carrying a plain-English
message and a retry affordance that remounts the failed subtree, and SHALL reset when the active
screen changes, so a screen that failed once is reachable again by navigating away and back.

When the screen that failed is anything other than the home grid, the error screen SHALL also
carry a `Back to your apps` affordance that shows the home grid, and system back on the error
screen SHALL do the same. On the home grid the error screen carries the retry affordance only,
and system back keeps its platform default there.

The boundary SHALL NOT be placed inside individual screen components. It SHALL wrap the launcher's
screen-switch boundary, so screen coverage is a property of the router rather than of each
screen's own source.

#### Scenario: A screen throws during render
- **WHEN** a launcher screen throws while rendering
- **THEN** the recoverable error screen is shown in place of that screen, the rest of the shell
  (status-bar inset, safe-area frame) still renders, and the app is not left blank

#### Scenario: Retry remounts the failed screen
- **WHEN** the user taps retry on the recoverable error screen
- **THEN** the failed screen's subtree is remounted from scratch, and a screen whose throw was
  transient renders normally

#### Scenario: Navigating away clears the boundary
- **WHEN** a screen has failed and the user navigates to a different screen and back
- **THEN** the boundary has reset and the screen is attempted again rather than staying in its
  error state

#### Scenario: Leaving a screen that keeps failing
- **WHEN** the Settings screen throws on every render and the user, on an iPhone, taps
  `Back to your apps` on the error screen
- **THEN** the home grid renders normally, and opening Settings again attempts it afresh

#### Scenario: The boundary never swallows
- **WHEN** the boundary catches any throw
- **THEN** a log record carrying the error class, message, stack, and the identifier of the screen
  that failed is emitted through the logging seam before the error screen renders
