# Delta: app-launcher (theme customization)

## ADDED Requirements

### Requirement: The launcher persists a user theme preference and restyles the shell with it

The launcher SHALL offer a settings surface where the user picks a theme preset and optional accent and shape overrides; the resolved theme SHALL restyle the launcher's own screens immediately, and the preference SHALL persist across restarts in the launcher's key-value store.

#### Scenario: Picking a preset restyles the shell live

- **WHEN** the user selects a different preset in settings
- **THEN** the home and settings screens SHALL re-render in the new theme without a restart, and the choice SHALL be persisted

#### Scenario: The preference survives restart and tolerates garbage

- **WHEN** the launcher starts with a stored preference, or with a corrupted/absent one
- **THEN** it SHALL resolve the stored preference, or fall back to the default preset without crashing

### Requirement: A launched mini-app receives the active theme at delivery

When launching a mini-app, the launcher SHALL hand the resolved theme to the delivery path so the app renders in the user's theme, while delivery without a theme SHALL remain valid and render SDK defaults.

#### Scenario: Shell and mini-app match

- **WHEN** the user opens an installed app while a non-default theme is active
- **THEN** the delivered init payload SHALL carry the resolved theme and the app's token-based UI SHALL render in it

#### Scenario: Theme-less delivery stays byte-identical on the bundle path

- **WHEN** a bundle is delivered with no theme (probes, invariant pages)
- **THEN** the bundle bytes and the delivery channel SHALL be unchanged from the pre-theme contract and the app SHALL render with default tokens
