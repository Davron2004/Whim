## ADDED Requirements

### Requirement: The launched mini-app matches the selected card
The launcher SHALL run the mini-app whose card the user tapped. Bundle delivery MUST complete only after the WebView host page is ready, so the selected bundle is delivered over channel (b) rather than the run falling through to the channel-(a) baked default.

#### Scenario: Selecting a non-default app card
- **WHEN** the user taps the Water Counter card on the home screen
- **THEN** the Water Counter mini-app renders
- **AND** the reported `appName` is "Water Counter" (not the baked `initial` default)

#### Scenario: Delivery lands before the realm reports ready
- **WHEN** a card is selected and the mini-app view mounts
- **THEN** the selected bundle source is injected after the host page load completes
- **AND** the iframe receives the selected bundle, so the reported generation reflects a channel-(b) delivery rather than the baked default

### Requirement: Card touch targets are bounded to their visual area
A card's tappable region SHALL coincide with its visible bounds. Taps that fall outside every card — including the gap between cards — MUST NOT launch any app.

#### Scenario: Tapping the gap between two cards
- **WHEN** the user taps a point in the horizontal gap between two cards, outside both cards' visible bounds
- **THEN** no mini-app is launched

### Requirement: The home screen presents an honest layout with few apps
When only a small number of apps exist, the home screen SHALL NOT present a large region of empty dead space below the grid. The area below the grid MUST be either intentionally laid out or carry an empty-state affordance.

#### Scenario: Home screen with a handful of apps
- **WHEN** the home screen renders with only a few app cards
- **THEN** the space below the grid is not an undifferentiated empty background with no affordance

### Requirement: The launcher exposes no unshipped-feature copy
User-facing launcher copy SHALL NOT promise features that are not present. Text that sets an expectation the build cannot meet (e.g. "Coming soon.") MUST NOT ship.

#### Scenario: Opening the create-app modal
- **WHEN** the user opens the "make your first app" modal
- **THEN** the modal body contains no "Coming soon." text

### Requirement: Production builds hide developer diagnostics surfaces
The shipping build SHALL NOT display developer diagnostics. Neither the DELIVERY/PAINT/CONTAINMENT diagnostics panel nor the `CONTAINED … probes` containment status bar may be visible while a mini-app is open.

#### Scenario: Opening a mini-app in a production build
- **WHEN** a mini-app is opened in the shipping build
- **THEN** no diagnostics panel is shown
- **AND** no containment status-bar overlay is shown

### Requirement: Launcher surfaces respect the system status-bar inset
In Android edge-to-edge mode, launcher and mini-app content SHALL be inset below the system status bar so app content does not draw underneath the clock, signal, and battery icons.

#### Scenario: Viewing the home screen edge-to-edge
- **WHEN** the home screen renders on Android 15+ with edge-to-edge enabled
- **THEN** the top of the app content begins below the system status bar

#### Scenario: Viewing a mini-app edge-to-edge
- **WHEN** a mini-app view renders on Android 15+ with edge-to-edge enabled
- **THEN** the top of the mini-app content begins below the system status bar
