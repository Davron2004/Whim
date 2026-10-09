## MODIFIED Requirements

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
