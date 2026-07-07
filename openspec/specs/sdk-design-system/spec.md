# sdk-design-system Specification

## Purpose
TBD - created by archiving change sdk-design-system. Update Purpose after archive.
## Requirements
### Requirement: Components resolve semantic tokens through the active theme

SDK components SHALL accept only semantic tokens (color roles, space, radius, text sizes), and token resolvers SHALL resolve them through the active host-supplied theme, falling back to the built-in default theme whenever no theme (or an invalid one) is present.

#### Scenario: A themed launch restyles token consumers

- **WHEN** the host supplies a valid theme at delivery and a bundle renders a component with `color="primary"`
- **THEN** the rendered value SHALL be the theme's `primary` role value, not a hard-coded constant

#### Scenario: No theme means defaults, never breakage

- **WHEN** a bundle runs with no theme supplied (baked delivery, invariant scenario pages, dev probes)
- **THEN** every token SHALL resolve to the default theme's values and rendering SHALL be unaffected

### Requirement: The host-supplied theme is inert, sanitized data

The theme crossing the host→iframe boundary SHALL be pure data (color strings, a shape name, a dark flag), and the SDK SHALL sanitize it field-by-field (hex-pattern colors, enumerated shape) before use, substituting default values for any field that fails validation.

#### Scenario: A malformed theme cannot corrupt rendering

- **WHEN** the theme global contains a non-hex color value or an unknown shape
- **THEN** the SDK SHALL substitute the default theme's value for each invalid field and SHALL NOT throw

#### Scenario: Theme delivery adds no capability

- **WHEN** the theme rides the existing init frame
- **THEN** no new message kind, CSP directive, resolver entry, or bridge capability SHALL exist in the diff, and the sandbox-isolation invariants SHALL pass unmodified

### Requirement: The component kit renders under the unchanged containment contract

Every new component (controls: TextInput, Switch, Checkbox, Slider, SegmentedControl; surfaces: Card, Divider, Badge, ProgressBar, List, ListItem, Spacer, EmptyState, Modal, Grid) SHALL render via the existing React-to-DOM path with inline token-resolved styles only, and SHALL expose no DOM concept in its props.

#### Scenario: The gallery app runs contained

- **WHEN** the style-gallery fixture (which uses every new component) is built and delivered
- **THEN** it SHALL render through the standard loader path with the invariant suites green and no widening of any containment leg

#### Scenario: Native control chrome stays suppressed

- **WHEN** an input-bearing component (TextInput, Slider, Checkbox) renders
- **THEN** stray native artifacts SHALL be suppressed purely via SDK styles (appearance resets, accent-color), never via sandbox or CSP changes

### Requirement: Interactive components surface state only through declared callbacks

Every interactive component SHALL report user interaction exclusively through its declared `onChange`/`onPress`-style props and the existing ui-event telemetry, holding no ambient authority.

#### Scenario: A toggle round-trips through its callback

- **WHEN** the user flips a Switch bound to app state via `onChange`
- **THEN** the app SHALL observe exactly one callback with the new boolean and no other channel SHALL carry the interaction
