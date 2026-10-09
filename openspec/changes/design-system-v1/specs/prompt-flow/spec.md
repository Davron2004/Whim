## REMOVED Requirements

### Requirement: The prompt flow is a five-step machine — compose, clarify, plan, build, done

**Reason**: Clarify and plan merge; the flow becomes one making sheet with four pages (decision #75).
**Migration**: See "The making flow is one sheet with four pages".

### Requirement: Clarifying questions are a pre-stream exchange, never a generation stage

**Reason**: The questions move onto the plan page, with "Decide for me" selected by default and long answers as rows.
**Migration**: See "The plan page shows the questions and the plan together".

### Requirement: The plan step is the approval gate before generation

**Reason**: Restated for the merged plan page (same approval and build-prompt rules).
**Migration**: See "The plan page is the approval gate before making".

### Requirement: The done step offers two distinct destinations

**Reason**: Replaced by the Ready page.
**Migration**: See "The Ready page opens the app or returns home".

### Requirement: Generation progress is shown without exposing internals

**Reason**: Replaced by the Making page (ember, step list with repair row, measured time lines, Stop).
**Migration**: See "The Making page shows honest progress without internals".

### Requirement: The build screen shows derived activity signals alongside the stage sentence

**Reason**: The output-size counter and transport wording describe the transport, not the making; elapsed time moves onto the current step and liveness to the ember.
**Migration**: See "The Making page shows honest progress without internals".

### Requirement: The build screen offers a details affordance into the run timeline

**Reason**: The Making page has no Details link; the tile menu and the Failure page carry Details.
**Migration**: See "Details of a run are reachable from its tile and its failure".

### Requirement: "Leave it running" leaves a visible building ghost

**Reason**: Leaving is now the sheet's close, back, drag or scrim; the label is gone.
**Migration**: See "Leaving the making sheet keeps the run and the draft".

### Requirement: The build screen shows the user's place in line

**Reason**: Restated for the Making page.
**Migration**: See "The Making page shows honest progress without internals".

### Requirement: Failure is shown honestly, never as a crash

**Reason**: Design `3b` (attempt-progress row, outcome panel) is replaced by failure kinds.
**Migration**: See "Failure is shown by kind, honestly, never as a crash".

### Requirement: Leaving clarify or rewrite cancels the in-flight request cleanly

**Reason**: Restated for the merged pages.
**Migration**: See "Leaving the making sheet keeps the run and the draft".

## ADDED Requirements

### Requirement: The making flow is one sheet with four pages

Making or changing an app SHALL happen in one large sheet over the current screen with the pages Describe, Plan, Making and Ready (or Failure), with no step indicator; each page SHALL start its headline at the same height. Forward movement SHALL be gated by one bottom action: `Continue` on Describe, `Make it` (or `Make the change`) on Plan, both `ember`. Back on Plan SHALL return to Describe with the text and answers kept. A busy action SHALL keep plain words, never a bare spinner. The sheet SHALL be keyed by the run's own journal id, so a page never shows another run's progress.

#### Scenario: Two runs never cross

- **WHEN** two runs are in flight and the user opens the second run's tile
- **THEN** the Making page shows only that run's steps, time and queue position

#### Scenario: Describe opens with the keyboard

- **WHEN** the user taps the composer
- **THEN** the sheet shows "What should it do?" with the field focused and Continue above the keyboard

### Requirement: The plan page shows the questions and the plan together

Continue SHALL send one clarify request and show the Plan page: "Here's the plan", the person's words quoted as the hero, then "A few choices" (the clarify questions, at most three, as soon as they land) and "What I'll make" (the plan rows, with skeleton rows until they land). Every question SHALL end with "Decide for me", selected by default and exclusive in multi-select (picking it clears the others; picking another clears it). A question whose options are all 20 characters or fewer SHALL show wrapping chips; otherwise every option SHALL be a full-width radio (single) or checkbox (multi) row. An answered question scrolled out of view SHALL collapse to one line with its answer, and tapping it SHALL reopen it. Answers SHALL travel to generation as `clarifications`; the plan rows SHALL NOT restate them. The exchange SHALL emit no `GenerationEvent`.

#### Scenario: Making without touching a choice

- **WHEN** the user taps Make it without changing any question
- **THEN** every question is sent as delegated (`decide: true`)

#### Scenario: Long options become rows

- **WHEN** one option of a question is 34 characters long
- **THEN** that question renders every option as a full-width row, not chips

### Requirement: The plan page is the approval gate before making

No generation request SHALL be sent before the user takes `Make it`. Each plan row SHALL edit in place on the Plan page, one at a time, with Save and Cancel at full targets; an edited row SHALL show the person's words and an "Edited" label. An unedited plan's build prompt SHALL be the rewrite response's `rewritten` string byte-identical; once any row is hand-edited the build prompt SHALL be assembled deterministically from the current rows, and SHALL stay on that path even if the text is reverted. A plan that arrives as one string SHALL render as one row. No SDK or engineering detail SHALL appear on the page. A server notice SHALL show above `Make it`.

#### Scenario: Nothing is made before approval

- **WHEN** the Plan page is showing
- **THEN** no generation request has been sent

#### Scenario: A hand-edited plan's rows become the build prompt

- **WHEN** the user edits a row and taps Make it
- **THEN** the build prompt is assembled from the current rows

### Requirement: The Making page shows honest progress without internals

While a run streams the Making page SHALL show the 128 pt ember (working, stuck after 40 s with no frame, following the stream's activity), "Making <name>" (or "Changing <name>"), the person's words, the four steps (`Reading your plan`, `Writing the app`, `Checking it runs safely`, `Putting it on your home screen`) with done, current (elapsed time on it) and waiting states, one time line from `system.md` §8 chosen by elapsed time, stall and queue position, and Stop. A `repair` event SHALL add "Fixing a problem · try N of M" under the current step and move the marker down to it. Raw `token` text, raw diagnostic fields, transport wording and output-size counters SHALL NOT render. Stop SHALL end the run at once and leave a stopped tile.

#### Scenario: A slow run says so honestly

- **WHEN** 80 seconds have passed and the run is still writing
- **THEN** the time line reads "Taking longer than most. Still going."

#### Scenario: Waiting in line

- **WHEN** a `queued` event with two runs ahead arrives
- **THEN** the page reads "2 ahead of you.", the ember is still and dim, and Stop is available

#### Scenario: Stop after a typo costs one tap

- **WHEN** the user taps Stop right after Make it
- **THEN** the run ends and a stopped tile they can change, retry or discard is on Home

### Requirement: Leaving the making sheet keeps the run and the draft

Closing the sheet (close button, back, drag or scrim) SHALL never cancel a run: on Making it SHALL collapse into the run's tile, which keeps its ember and reopens the page. Closing on Describe or Plan SHALL abort any in-flight clarify or rewrite request and keep the draft: the composer SHALL read "Continue "<start of the text>"" and reopening SHALL restore the text, the answers and any plan edits.

#### Scenario: A closed plan comes back

- **WHEN** the user answers two questions, closes the sheet and taps the composer again
- **THEN** the Plan page returns with the same text and answers, and the abandoned rewrite was aborted

### Requirement: The Ready page opens the app or returns home

When a run delivers with the sheet open, the Ready page SHALL show the 96 pt tile, the app's name, the person's words, "It's on your home screen.", `Open it` in the app's tint and `Done` (plain). `Open it` SHALL launch the app; `Done` SHALL return to Home. When it delivers with the sheet closed, Home SHALL show the toast "<name> is ready · Open", or over a running app the orb SHALL get its `ember` dot. Ready SHALL NOT run the app before it is opened.

#### Scenario: Open launches the app

- **WHEN** the user takes `Open it`
- **THEN** the delivered app opens from its tile

### Requirement: Failure is shown by kind, honestly, never as a crash

A `failure` terminal event or a stream error SHALL show the Failure page: the ember out, "Couldn't make this", one sentence and actions chosen by failure kind as in `system.md` §8 (couldn't run with or without a rewording hint, server refused for now, needs a newer Whim, stopped when Whim closed, connection dropped), "Your other apps are untouched" (or "Your current version still works" when changing), a collapsed "What happened" timeline, and Discard in the body with a 6 s Undo. A dropped connection SHALL never suggest rewording. A connection problem before any run (clarify or rewrite unreachable) SHALL NOT open this page; the current page SHALL show a notice with Try again. A service refusal SHALL be presented as `service-refusals` specifies. Diagnostic detail SHALL be limited to each diagnostic's `hint`; no failure reason SHALL be a transport message, and an unknown reason SHALL show the server's text.

#### Scenario: Offline mid-run

- **WHEN** the stream drops because the phone went offline
- **THEN** the page reads "I lost the connection to the server partway through." and Try again enables when the phone is back online

### Requirement: Details of a run are reachable from its tile and its failure

The menu of a tile being made SHALL offer Details, which reopens that run's Making page. The Failure page SHALL offer "What happened", which shows the run's timeline as a readable list, each row its own accessibility element, without raw `token` text or raw diagnostic `kind`, `symbol` or `message` values.

#### Scenario: Details from a tile being made

- **WHEN** the user long-presses a tile being made and taps Details
- **THEN** that run's Making page opens

#### Scenario: What happened is readable by VoiceOver

- **WHEN** a VoiceOver user expands "What happened" on the Failure page
- **THEN** each timeline row is focusable on its own
