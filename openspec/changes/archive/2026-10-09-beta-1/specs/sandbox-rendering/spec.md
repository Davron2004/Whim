## ADDED Requirements

### Requirement: The realm reports a post-paint render failure as fatal
The runtime SHALL mount the mini-app inside a runtime-owned error boundary and, when it catches a render error, SHALL post a nonce-authenticated error frame with `where: 'render'`; generated code SHALL NOT be able to suppress it.

#### Scenario: Render throws after paint
- **WHEN** a component throws during a re-render after the first paint
- **THEN** the realm posts one trusted `render` error frame

### Requirement: Screen content clears the host's bottom chrome
The SDK's `Screen` SHALL add the host-supplied bottom inset to the bottom padding of its scrollable content, so the last element can scroll fully above the host's overlay; generated code SHALL NOT receive the inset value.

#### Scenario: Long screen
- **WHEN** a mini-app's `Screen` content is scrolled to its end
- **THEN** its last element sits entirely above the orb's footprint

#### Scenario: No inset supplied
- **WHEN** the host supplies no inset
- **THEN** `Screen` pads exactly as before

### Requirement: A focused mini-app input stays visible
The runtime SHALL scroll a focused editable element into view when it gains focus and when the viewport resizes while it has focus.

#### Scenario: Input near the bottom
- **WHEN** a user taps a text field near the bottom of a mini-app and the keyboard opens
- **THEN** the field is visible above the keyboard
