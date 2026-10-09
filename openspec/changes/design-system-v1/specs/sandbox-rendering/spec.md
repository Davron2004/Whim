## ADDED Requirements

### Requirement: The runtime page follows the phone's scheme and allows zoom
The runtime page, the iframe and the SDK `Screen` SHALL all paint the theme's `bg` for its scheme, so opening an app never flashes another background. The page SHALL set `color-scheme: light dark` so native pickers and date inputs follow the scheme, and its viewport SHALL NOT set `maximum-scale`, so pinch zoom works. No CSP directive SHALL change.

#### Scenario: Dark app, dark page
- **WHEN** an app opens with `scheme: 'dark'`
- **THEN** the outer page, the iframe and `Screen` all paint the dark `bg`, and a `DateInput` opens a dark native picker

#### Scenario: Zoom is allowed
- **WHEN** the outer page's viewport meta is inspected
- **THEN** it contains no `maximum-scale`

### Requirement: The host can tell which launch a paint belongs to
The outer page SHALL stamp the host generation onto every `paint` frame it forwards to the host, as it does for nav-depth, and the host SHALL take a `paint` as the opening signal for a launch only when that stamp equals the generation of the current bind. `paint` SHALL stay the trusted loader's post-paint frame, posted after the first render's double animation frame; no new frame kind and no bundle-visible field SHALL be added. A forged or stale `paint` SHALL at most release an opening early and SHALL never be treated as another launch's paint.

#### Scenario: A paint from a replaced realm is ignored
- **WHEN** a `paint` stamped with an older generation reaches the host after a new bind
- **THEN** the current launch's opening signal stays unset

#### Scenario: The current launch's paint releases the opening
- **WHEN** the current realm's loader posts `paint`
- **THEN** the host receives it stamped with the current generation and records the opening signal
