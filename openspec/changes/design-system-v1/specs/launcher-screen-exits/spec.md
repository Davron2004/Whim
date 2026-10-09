## MODIFIED Requirements

### Requirement: Every launcher screen except Home can be left with a visible control
Every launcher screen other than the home grid SHALL show a visible, tappable control that leaves it, on iOS and Android alike, so that no screen depends on a hardware back button or a gesture to be left.

The controls are: the native stack's header back control on Settings, Advanced, AI features, History and Report; the header back on the Plan page and the close button on every page of the making sheet; `Done` on Ready; the close button and `Back to your apps` on the Failure page and the link-missing screen; `Not now` on the first-run sheet; the orb's Whim sheet `Back to your apps` over a running app, plus `Back to your apps` on an app's launch-failed and crashed states; and `‹ Home` on the developer probe screen. None of these controls SHALL be hidden behind a platform check. Every sheet SHALL carry a visible close control besides its scrim and drag.

#### Scenario: Leaving Settings on an iPhone
- **WHEN** a user on an iPhone opens Settings from the home grid and taps the header back control
- **THEN** the home grid is shown, and no gesture or hardware button was needed

#### Scenario: Leaving the making flow on an iPhone
- **WHEN** a user on an iPhone is on the Plan page and taps back, then the close button
- **THEN** the sheet shows Describe with the text kept, then closes to the home grid with the draft kept in the composer

#### Scenario: Leaving a running app on an iPhone
- **WHEN** an app is running on an iPhone and the user taps the orb, then `Back to your apps`
- **THEN** the app closes into its tile and the home grid is shown

### Requirement: System back and the visible control perform the same action
On every launcher screen that handles system back, system back SHALL perform exactly the action that screen's visible leave control performs in the same state, and both SHALL run one handler. On native-stack screens the stack's own back (header control, iOS edge and content-area swipe, Android predictive back) SHALL pop exactly one screen.

On the Plan page, while a row is being edited, both the header back and system back SHALL cancel the row edit and keep the page; with no row being edited, both SHALL return to Describe. On the Making page, system back and the close button SHALL leave the run going and SHALL never stop it. On Ready, system back SHALL do what `Done` does. With a sheet open over a screen, system back SHALL close the sheet. The system back listener SHALL be registered once per screen mount and SHALL always run the screen's current handler.

#### Scenario: Header back while editing a plan row
- **WHEN** a row on the Plan page is being edited and the user taps the header back
- **THEN** the edit is cancelled and the Plan page stays

#### Scenario: Back on the Making page never stops the run
- **WHEN** the user presses Android back on the Making page
- **THEN** the sheet collapses into the run's tile and the run continues

## ADDED Requirements

### Requirement: Pushed shell screens sit on the native stack
Settings, Advanced, AI features (consent review), History and Report (when opened from History or Settings) SHALL be presented on `react-native-screens`' native stack, so iOS gives them the edge and content-area swipe and Android its predictive back preview (`android:enableOnBackInvokedCallback="true"`), with Whim drawing none of the transition. The launcher's state machine SHALL stay the single source of navigation truth: a pop by gesture SHALL update it exactly as the header back does. A running app SHALL NOT be on this stack: there is no edge swipe over a running app (#67), and the running app's Android back SHALL keep its existing seam (in-app depth, then close at depth 0).

#### Scenario: Swiping back from History on an iPhone
- **WHEN** a user drags from the leading edge on History
- **THEN** History follows the finger and pops to Home, and the launcher's state shows Home

#### Scenario: Predictive back on Android
- **WHEN** a user on Android 14 or later starts the back gesture on Settings
- **THEN** the system previews Home behind Settings and completes or cancels the pop with the gesture

#### Scenario: No edge swipe over a running app
- **WHEN** a user drags from the leading edge over a running app on an iPhone
- **THEN** the app receives the touch and nothing closes
