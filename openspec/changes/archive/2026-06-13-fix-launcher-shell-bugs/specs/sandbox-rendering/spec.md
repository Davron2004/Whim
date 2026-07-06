## ADDED Requirements

### Requirement: Number inputs render without stray native focus artifacts
The SDK `NumberInput` SHALL render without leaking native browser chrome — no spin-button glyph and no stray focus-indicator dot — when focused inside the WebView. The corrected behavior MUST be achieved purely in the SDK render layer (style reset), never by widening the sandbox or CSP.

#### Scenario: Focusing a NumberInput
- **WHEN** the user focuses a `NumberInput` field in a mini-app
- **THEN** no stray dot or native spin-button artifact appears adjacent to the field
- **AND** the field remains usable for numeric entry
