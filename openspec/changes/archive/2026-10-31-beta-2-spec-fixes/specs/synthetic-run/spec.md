## MODIFIED Requirements

### Requirement: The sweep acts only on an element that can receive the action

The harness SHALL test, immediately before acting on a picked fingerprint, that the element can receive the action, and SHALL defer an element that cannot instead of acting on it. The test runs in the candidate's frame at browser level: the element is scrolled into view, and it passes only if it is rendered with a non-empty box, is not `disabled`, has no ancestor-or-self with `aria-hidden="true"`, and the topmost element at the action point is the element itself or one of its descendants.

A deferred element SHALL NOT be marked visited, SHALL NOT count toward the per-screen action cap and SHALL NOT spend an action timeout. It stays eligible, and the sweep SHALL pick it on a later enumeration once it passes. An open `Modal` therefore gets its own controls used and its backdrop dismissed before the controls beneath it.

When unvisited fingerprints remain on a screen and none passes the test, the sweep SHALL dismiss a `Modal` backdrop that does pass once more, counted as an action, but only if it acted on at least one fingerprint since its previous dismissal on that screen. Otherwise the screen's sweep ends. Every fingerprint that was enumerated and never acted on by the end of the run SHALL be counted in the report as blocked, except one retired by the per-path limit. The count is of fingerprints, so a control whose label changed before it was acted on counts once under each label it showed and was not acted on.

After it dismisses a `Modal` backdrop, the sweep SHALL wait until that Modal has left, meaning the dismissed backdrop no longer receives a click at its action point, up to five seconds, before it enumerates again. The wait spends no action and is taken once per dismissal; a dismissal is itself a counted action, so the total wait is bounded by the per-screen action cap and never by the clock. A control is booked as blocked by a `Modal` only if that Modal is still open after the wait, so a close that lands late on a loaded machine cannot end the screen's sweep with a reachable control unpressed.

A toast leaves by itself, and so does a `Modal` whose close the sweep has just asked for. When unvisited fingerprints remain on a screen and none passes the test, the sweep SHALL enumerate and pick once more before it ends the screen's sweep, spending no action, and if the SDK's toast host is showing it SHALL first wait for the toast to leave, up to five seconds. The second pick happens whether or not a toast was seen, so a toast that left between the test and the check cannot end the screen early. The sweep SHALL wait for a toast at most twice in one run, counted and not timed, so toasts cannot spend the total budget and the bound never depends on the clock. Which controls a toast still covers when the sweep looks does depend on when the toast leaves, so whether a toast-covered control is reached is the one part of the action sequence that can differ between two runs of the same candidate.

An action that passes the test and still fails in the browser driver SHALL be counted in the report as a failed action, and its fingerprint marked visited. No action failure SHALL be discarded without a count.

#### Scenario: A control under an open Modal is pressed after the Modal closes

- **WHEN** one button opens a `Modal` and a second button on the same screen lies under the Modal's scrim when the sweep picks it
- **THEN** the sweep acts on the Modal's own controls, dismisses the Modal, then presses the second button, and the report counts zero failed actions

#### Scenario: A Modal that closes late does not strand the control beneath it

- **WHEN** one button opens a `Modal` whose close handler takes 2.5 seconds to close it, and a second button lies under the Modal's scrim
- **THEN** after dismissing the backdrop the sweep waits for the Modal to leave, presses the second button, and the report counts zero blocked fingerprints and zero failed actions

#### Scenario: A disabled control is never clicked

- **WHEN** a screen shows a control that stays disabled for the whole run next to enabled ones
- **THEN** no action is attempted on it, the enabled controls are all acted on, and the report counts zero failed actions

#### Scenario: A button under a toast is pressed once the toast has gone

- **WHEN** pressing one button shows a toast that covers the only other unvisited button
- **THEN** the sweep waits for the toast to leave and presses the second button, and the report counts zero failed actions

#### Scenario: Toast waits are bounded per run

- **WHEN** every press on a screen raises a toast over the next unvisited button, more than twice in a row
- **THEN** the sweep waits for a toast twice, ends the screen's sweep with the remaining buttons counted as blocked, and the report is not truncated

#### Scenario: A screen whose remaining controls stay covered ends without a timeout

- **WHEN** a `Modal` that cannot be dismissed covers the remaining unvisited controls of a screen
- **THEN** the screen's sweep ends, those controls are counted as blocked, and the report counts zero failed actions
