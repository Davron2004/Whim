## ADDED Requirements

### Requirement: Every launcher screen except Home can be left with a visible control
Every launcher screen other than the home grid SHALL show a visible, tappable control that leaves it, on iOS and Android alike, so that no screen depends on a hardware back button or a gesture to be left.

The controls are the ones each screen's design already carries: the header back button on Settings and History; the header `Back` on the compose, clarify and plan steps; `Leave it running` on the build step; `Back to your apps` on the done step, the failure screen and the link-missing screen; `Not now` on the consent screen in ask mode; `Keep AI features on` or `Not now` on the consent screen in review mode; the orb's `Home` over a running mini-app, plus `Back to your apps` on a mini-app's launch-failed and app-error states; and `‹ Home` on the developer probe screen. None of these controls SHALL be hidden behind a platform check. Every sheet opened over a screen SHALL likewise carry a visible close, cancel or done control besides its scrim.

#### Scenario: Leaving Settings on an iPhone
- **WHEN** a user on an iPhone opens Settings from the home grid and taps the header back button
- **THEN** the home grid is shown, and no gesture or hardware button was needed

#### Scenario: Leaving the flow on an iPhone
- **WHEN** a user on an iPhone reached the plan step through clarify and taps the header `Back` three times
- **THEN** the flow shows clarify, then compose with the text kept, then the home grid

#### Scenario: Leaving a running mini-app on an iPhone
- **WHEN** a mini-app is running on an iPhone and the user opens the orb and taps `Home`
- **THEN** the mini-app closes and the home grid is shown

### Requirement: System back and the visible control perform the same action
On every launcher screen that handles system back, system back SHALL perform exactly the action that screen's visible leave control performs in the same state, and both SHALL run one handler.

On the plan step, while a row is being edited, both the header `Back` and system back SHALL cancel the row edit and keep the step; with no row being edited, both SHALL move back one step. On the build step, both SHALL leave the build running and SHALL never cancel it; while the details sheet is open, system back SHALL close the sheet and the sheet's visible `Close` does the same. On the done step, system back SHALL do what `Back to your apps` does. The system back listener SHALL be registered once per screen mount and SHALL always run the screen's current handler.

#### Scenario: Header Back while editing a plan row
- **WHEN** the user is editing a plan row with unsaved text and taps the header `Back`
- **THEN** the row edit is cancelled, the plan step stays on screen, and the saved rows are unchanged

#### Scenario: System back on the done step
- **WHEN** a build has just been delivered and the user presses Android system back on the done step
- **THEN** the home grid is shown with the new tile, the same as tapping `Back to your apps`, and Whim stays in the foreground

#### Scenario: System back on the build step never cancels
- **WHEN** a build is streaming, the details sheet is closed, and the user presses system back
- **THEN** the home grid is shown with a building ghost tile and the build keeps running

### Requirement: The consent review screen can always be left without changing consent
The consent screen in review mode SHALL always show a visible control that returns to Settings without changing consent, whether consent is currently on or off.

With consent on, that control is the large `Keep AI features on` button. With consent off, it is a plain `Not now` action beneath `Turn on AI features`. Leaving this way SHALL NOT grant or revoke consent and SHALL NOT send any request.

#### Scenario: Reviewing with AI features off
- **WHEN** AI features are off, the user opens AI features from Settings, and taps `Not now`
- **THEN** Settings is shown, AI features still read off, and no request has been sent

#### Scenario: Reviewing with AI features on
- **WHEN** AI features are on, the user opens AI features from Settings, and taps `Keep AI features on`
- **THEN** Settings is shown and the grant is unchanged

### Requirement: Controls at the bottom of a screen clear the bottom system area
Every launcher screen other than a running mini-app and the developer probe screen SHALL keep its content above the bottom safe-area inset (the iOS home indicator, the Android navigation bar), so a control anchored to the bottom of the screen is fully tappable.

A running mini-app keeps its full-height frame; its orb and its sheets add the bottom inset themselves. The developer probe screen applies its own safe area.

#### Scenario: The build step on an iPhone with a home indicator
- **WHEN** the build step renders on an iPhone that reports a bottom safe-area inset
- **THEN** `Leave it running` sits entirely above that inset

#### Scenario: A running mini-app keeps its full height
- **WHEN** a mini-app is running on the same iPhone
- **THEN** its view extends to the bottom edge and the orb sits above the inset

### Requirement: A screen without a declared exit fails the fast gate
The launcher SHALL declare one exit for every `Screen` kind in a React Native-free table, and the fast gate SHALL fail when a screen kind, or a component that handles system back, has no declared visible exit.

The table names, for each kind, whether system back is handled by the screen's own component, by the mini-app back policy, or not at all (the home grid), and the label of the visible control that leaves it. The shell indexes the table by the current screen's kind, so a kind with no row is a type error. A launcher suite SHALL fail, naming the file, when: a component other than the shared system-back hook and the mini-app host registers a hardware back listener; a component uses the hook but is not declared in the table; the handler a component passes to the hook is not also bound to a pressable control in that component; or a declared control label does not appear in its declared file. The suite SHALL prove each of those failures against a fixture, not only pass on the real tree.

#### Scenario: A new screen kind with no row
- **WHEN** a developer adds a member to the `Screen` union without adding it to the exit table
- **THEN** typechecking the launcher fails at the place the shell reads the table

#### Scenario: A new screen that only listens for hardware back
- **WHEN** a launcher component other than the shared hook and the mini-app host calls `BackHandler.addEventListener` directly
- **THEN** the launcher suite fails and names that component's file

#### Scenario: A back handler with no matching control
- **WHEN** a component passes one handler to the system-back hook and binds a different one to its visible back control
- **THEN** the launcher suite fails and names that component's file
