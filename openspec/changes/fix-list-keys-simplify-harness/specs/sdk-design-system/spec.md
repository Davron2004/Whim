## MODIFIED Requirements

### Requirement: The component kit renders under the unchanged containment contract

Every new component (controls: TextInput, Switch, Checkbox, Slider, SegmentedControl; surfaces: Card, Divider, Badge, ProgressBar, List, ListItem, Spacer, EmptyState, Modal, Grid) SHALL render via the existing React-to-DOM path with inline token-resolved styles only, SHALL expose no DOM concept in its props, and SHALL give each `List` child wrapper unique React identity even when primitive child values repeat.

#### Scenario: The gallery app runs contained

- **WHEN** the style-gallery fixture (which uses every new component) is built and delivered
- **THEN** it SHALL render through the standard loader path with the invariant suites green
  and no widening of any containment leg

#### Scenario: Native control chrome stays suppressed

- **WHEN** an input-bearing component (TextInput, Slider, Checkbox) renders
- **THEN** stray native artifacts SHALL be suppressed purely via SDK styles (appearance
  resets, accent-color), never via sandbox or CSP changes

#### Scenario: Repeated list primitives render without key collisions

- **WHEN** a `List` receives two child strings or numbers with the same value
- **THEN** its wrappers SHALL retain unique React keys and rendering SHALL emit no
  duplicate-key diagnostic
