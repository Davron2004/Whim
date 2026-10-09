# mini-app-back-navigation Specification

## Purpose
TBD - created by archiving change launcher-shell. Update Purpose after archive.
## Requirements
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

The host SHALL render the orb over every running mini-app — host-layer, a sibling of the realm's view, unreachable and un-coverable from inside the realm — and the orb's menu SHALL carry a `Home` action that exits to the launcher. The orb SHALL be reachable from the moment the mini-app's view mounts, including while the app is still loading and while it ignores pop requests. It is a tapped menu (`app-launcher` §"The orb is a tapped menu whose actions are instrumented"): it SHALL NOT be draggable and SHALL NOT dim itself.

The orb's `Home` action is the one exit that works on every platform. Where there is no system back (iOS), it is the guaranteed exit, and the host SHALL NOT make its reachability depend on a hardware back listener, a gesture, or anything the realm reports. On such a platform the host adds no gesture of its own for popping the mini-app's screen stack; a mini-app's own `nav.back()` controls do that.

#### Scenario: The affordance exits regardless of app state

- **WHEN** any mini-app is running — including one that ignores pop requests — and the user taps the orb's `Home` action
- **THEN** the host exits to the launcher

#### Scenario: Exiting on a platform without system back

- **WHEN** a mini-app that reports depth 2 and never handles pop requests is running on an iPhone, and the user opens the orb and taps `Home`
- **THEN** the realm is torn down and the home grid is shown

#### Scenario: The orb is reachable before the first paint

- **WHEN** a mini-app has been opened and has not painted yet
- **THEN** the loading state does not take the orb's touches, and the orb's `Home` action exits to the launcher

