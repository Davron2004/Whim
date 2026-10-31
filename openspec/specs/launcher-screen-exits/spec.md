# launcher-screen-exits Specification

## Purpose
TBD - created by archiving change ios-launcher-back-navigation. Update Purpose after archive.
## Requirements
### Requirement: Every launcher screen except Home can be left with a visible control
Every launcher screen other than the home grid SHALL show a visible, tappable control that leaves it, on iOS and Android alike, so that no screen depends on a hardware back button or a gesture to be left.

The controls are: the native stack's header back control on Settings, Advanced, AI features, History and Report; the header back on the Plan page and the close button on every page of the making sheet; `Done` on Ready; the close button and `Back to your apps` on the Failure page and the link-missing screen; `Not now` on the first-run sheet; the orb's Whim sheet `Back to your apps` over a running app, plus `Back to your apps` on an app's launch-failed and crashed states; and `‹ Home` on the developer probe screen. None of these controls SHALL be hidden behind a platform check. Every sheet SHALL carry a visible close control besides its scrim and drag.

#### Scenario: Leaving Settings on an iPhone
- **WHEN** a user on an iPhone opens Settings from the home grid and taps the header back control
- **THEN** the home grid is shown, and no gesture or hardware button was needed

#### Scenario: Leaving the flow on an iPhone
- **WHEN** a user on an iPhone is on the Plan page and taps back, then the close button
- **THEN** the sheet shows Describe with the text kept, then closes to the home grid with the draft kept in the composer

#### Scenario: Leaving a running mini-app on an iPhone
- **WHEN** an app is running on an iPhone and the user taps the orb, then `Back to your apps`
- **THEN** the app closes into its tile and the home grid is shown

### Requirement: System back and the visible control perform the same action
On every launcher screen that handles system back, system back SHALL perform exactly the action that screen's visible leave control performs in the same state, and both SHALL run one handler. On native-stack screens the stack's own back (header control, iOS edge and content-area swipe, Android back) SHALL pop exactly one screen.

On the Plan page, while a row is being edited, both the header back and system back SHALL cancel the row edit and keep the page; with no row being edited, both SHALL return to Describe. On the Making page, system back and the close button SHALL leave the run going and SHALL never stop it. On Ready, system back SHALL do what `Done` does. With a sheet open over a screen, system back SHALL close the sheet. The system back listener SHALL be registered once per screen mount and SHALL always run the screen's current handler.

#### Scenario: Header Back while editing a plan row
- **WHEN** a row on the Plan page is being edited and the user taps the header back
- **THEN** the edit is cancelled and the Plan page stays

#### Scenario: System back on the build step never cancels
- **WHEN** the user presses Android back on the Making page
- **THEN** the sheet collapses into the run's tile and the run continues

#### Scenario: System back on the done step
- **WHEN** a run has just delivered and the user presses Android system back on the Ready page
- **THEN** the home grid is shown with the new tile, the same as tapping `Done`, and Whim stays in the foreground

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
- **WHEN** the Making page renders on an iPhone that reports a bottom safe-area inset
- **THEN** `Stop` sits entirely above that inset

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

### Requirement: Pushed shell screens sit on the native stack
Settings, Advanced, AI features (consent review), History and Report (when opened from History or Settings) SHALL be on `react-native-screens`' native stack: iOS gives the edge and content-area swipe, Android a plain pop (#164). The launcher's state machine SHALL stay the single navigation truth: a gesture pop SHALL update it as the header back does. With the keyboard up, the first back SHALL put it away. A running app SHALL NOT be on it (#67); its Android back keeps its seam.

#### Scenario: Swiping back from History on an iPhone
- **WHEN** a user drags from the leading edge on History
- **THEN** History follows the finger and pops to Home, and the launcher's state shows Home

#### Scenario: Back on Android pops without a preview
- **WHEN** a user on Android starts the back gesture on Settings
- **THEN** Settings pops to Home as a standard pop, with no preview of Home behind it

#### Scenario: Back with the keyboard up
- **WHEN** a field on a pushed screen has the keyboard up and the user presses back once
- **THEN** the keyboard goes away and the screen stays

#### Scenario: No edge swipe over a running app
- **WHEN** a user drags from the leading edge over a running app on an iPhone
- **THEN** the app receives the touch and nothing closes

