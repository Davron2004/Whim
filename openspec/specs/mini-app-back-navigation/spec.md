# mini-app-back-navigation Specification

## Purpose
TBD - created by archiving change launcher-shell. Update Purpose after archive.
## Requirements
### Requirement: System back pops the mini-app's nav stack, then exits at the root

Android system back SHALL be the primary exit from a running mini-app (#42): while the
mini-app reports navigation depth greater than zero, a back press MUST be forwarded into the
realm as a pop request; at depth zero (or when no depth was ever reported), a back press MUST
exit to the launcher.

#### Scenario: Back exits an app without internal navigation

- **WHEN** a mini-app that never reports navigation depth is running and the user presses
  system back
- **THEN** the host exits to the launcher immediately

#### Scenario: Back pops before it exits

- **WHEN** a mini-app reports depth 2 and the user presses system back three times
- **THEN** the first two presses are forwarded as pop requests (depth reports decreasing to
  zero between them) and the third press exits to the launcher

### Requirement: Navigation-depth reports are untrusted hints

The SDK runtime SHALL report the mini-app's navigation depth to the host as a control-family
frame whenever the depth changes (the seam `sdk-design-system` implements against). The host
MUST treat these reports as unauthenticated hints — never as authority over whether the user
can leave (F4: the bundle shares the iframe scope and can forge or inflate them) — and MUST
ignore reports stamped with a stale realm generation.

#### Scenario: A stale-generation depth report is ignored

- **WHEN** a depth report from a previous realm generation arrives after the realm was reset
- **THEN** the host's back behavior reflects only the current generation (a fresh realm
  starts at depth zero)

#### Scenario: An inflated depth claim cannot change what back ultimately does

- **WHEN** a bundle reports an arbitrarily large depth without real navigation
- **THEN** back presses still resolve to an exit via the guaranteed-exit policy — the claim
  delays nothing beyond the policy's single unhandled-press window

### Requirement: The user can always exit — no app can trap the back button

The host SHALL guarantee exit independently of app cooperation: if a forwarded pop request
produces no depth decrease within the policy window, that press counts as unhandled and the
next back press MUST exit unconditionally. The exit decision runs entirely in the host layer,
out of the realm's reach.

#### Scenario: A misbehaving app is escaped by the next press

- **WHEN** a mini-app claims depth above zero but never decreases it in response to pop
  requests, and the user presses back twice
- **THEN** the second press exits to the launcher

### Requirement: A floating affordance offers an always-available exit

The host SHALL render a small floating affordance over every running mini-app — host-layer,
unreachable and un-coverable from inside the realm — that exits to the launcher when tapped.
It MUST be drag-repositionable (the answer to §10's overlap risk) and MUST auto-dim after a
short idle period, returning to full visibility on touch.

#### Scenario: The affordance exits regardless of app state

- **WHEN** any mini-app is running — including one that ignores pop requests — and the user
  taps the floating affordance
- **THEN** the host exits to the launcher

#### Scenario: The affordance yields the screen when idle

- **WHEN** the affordance is untouched for the idle period
- **THEN** it dims to low opacity, and a touch restores it (and it can be dragged clear of
  any UI it overlaps)

