## MODIFIED Requirements

### Requirement: Production builds hide developer diagnostics surfaces
The shipping build SHALL NOT display developer diagnostics. Neither the DELIVERY/PAINT/CONTAINMENT diagnostics panel nor the `CONTAINED … probes` containment status bar may be visible while a mini-app is open. The dev log overlay SHALL be held to the same rule: it SHALL NOT be reachable from any surface of a shipping build, and the affordance that opens it SHALL NOT render there.

Because this project's working build recipe is a release build, in which `__DEV__` is `false`, the gate on every developer diagnostics surface SHALL be `__DEV__` **or** an explicit build-time flag that defaults to `false` — the same idiom the on-device acceptance probes already use. A surface gated on `__DEV__` alone is unreachable in the build the project actually runs, which is a defect, not compliance.

#### Scenario: Opening a mini-app in a production build
- **WHEN** a mini-app is opened in the shipping build
- **THEN** no diagnostics panel is shown
- **AND** no containment status-bar overlay is shown

#### Scenario: The log overlay is absent from a shipping build
- **WHEN** the launcher renders with the developer flag off and `__DEV__` false
- **THEN** no affordance opens the dev log overlay and no route reaches it

#### Scenario: The log overlay is reachable in a locally-built release APK
- **WHEN** the app is built with the developer flag on
- **THEN** the dev log overlay is reachable from the same developer affordance that opens the device probe screen, even though `__DEV__` is false

## ADDED Requirements

### Requirement: The mini-app container styles its failure state from tokens
The mini-app container's launch-failure state SHALL resolve every colour, radius, spacing, and type value from the shell's design tokens. Hardcoded numeric style literals for font size, radius, padding, and margin SHALL NOT appear in its stylesheet, so a token change reaches this surface like every other.

The container's WebView error path SHALL report through the logging seam rather than a raw console call, carrying the native error payload as structured fields.

#### Scenario: The failure state carries no style literals
- **WHEN** the mini-app container's stylesheet is inspected
- **THEN** its font sizes, radii, paddings, and margins are token references, not numeric literals

#### Scenario: A WebView error is recorded
- **WHEN** the WebView reports a load error
- **THEN** a record is emitted on the mini-app container's channel carrying the native error's fields, and no `console.*` call is made
