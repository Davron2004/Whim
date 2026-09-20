## MODIFIED Requirements

### Requirement: System back pops the mini-app's nav stack, then exits at the root

Android system back SHALL be the primary exit from a running mini-app (#42): while the
mini-app reports navigation depth greater than zero, a back press MUST be forwarded into the
realm as a pop request; at depth zero (or when no depth was ever reported), a back press MUST
exit to the launcher. While a host-layer sheet (the report sheet) is open over the mini-app, a
back press MUST close that sheet and MUST be neither forwarded nor counted toward the
guaranteed-exit policy; once the sheet is closed, back behaves as above.

#### Scenario: Back exits an app without internal navigation

- **WHEN** a mini-app that never reports navigation depth is running and the user presses
  system back
- **THEN** the host exits to the launcher immediately

#### Scenario: Back pops before it exits

- **WHEN** a mini-app reports depth 2 and the user presses system back three times
- **THEN** the first two presses are forwarded as pop requests (depth reports decreasing to
  zero between them) and the third press exits to the launcher

#### Scenario: A host sheet takes back first

- **WHEN** the report sheet is open over a mini-app that reports depth 1 and the user presses
  system back twice
- **THEN** the first press closes the sheet without reaching the app, and the second press is
  forwarded as a pop request
