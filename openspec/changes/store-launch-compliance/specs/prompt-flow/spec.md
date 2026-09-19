## MODIFIED Requirements

### Requirement: Failure is shown honestly, never as a crash
A `failure` terminal event, or a client-side stream error, SHALL produce a failure screen stating the reason and offering to rephrase (returning to the prompt screen with the user's text preserved). Diagnostic detail shown on this screen SHALL be limited to each diagnostic's `hint` string.

A service refusal (an `ApiError` whose `error` is a member of `ServiceRefusalCode`) of a clarify, rewrite, or plan-started generate request is not a failure: it SHALL NOT produce this screen, and SHALL be presented as `service-refusals` specifies. A refused Retry from this screen SHALL keep this screen with the refusal's hint as its reason. No failure reason on this screen SHALL ever be a transport message; a failure without a `hint` SHALL read as the copy table's generic sentence.

The screen SHALL be rendered to design `3b` and SHALL resolve every colour, radius, type face, and size from the shell's v2 design tokens — no numeric style literal and no hex value in its own stylesheet:

- a screen title at the display size the token scale defines for it, whose colour is **dynamic**: the failure hue when the run ended badly, the success hue when a repair recovered it;
- a sub-line under the title, in plain words, saying what happens next;
- an **attempt-progress row** of equal segments, one per permitted repair attempt — segments for spent attempts in the failure hue, the current attempt in the accent, the remainder in the neutral border tone — under a small uppercase mono label reading how many attempts were used. The row SHALL be shown only when the device actually observed repair attempts on the stream, and SHALL be hidden otherwise; a count SHALL NOT be invented for a run that never reached the repair stage;
- a bordered panel with the large radius, filled and outlined by the run's outcome tone, containing a **checklist** of rows. Each row carries a ring/mark icon and its text: a completed check with a filled ring and a check mark, a failed check with a filled ring and an alert mark, an in-flight check with a ring outline and no mark, and a waiting or advisory row with a muted ring outline, no mark, and muted text.

Checklist rows SHALL be built only from data the screen already receives — each diagnostic's `hint`, and copy-table strings. A row SHALL NOT carry a diagnostic's `kind`, `symbol`, or `message`; the hint-only discipline is unchanged by the redesign.

Every failure that reaches this screen SHALL also be recorded through the logging seam with the error class, message, stack, and the taxonomy the on-screen text deliberately scrubs — the screen stays plain-English while the detail becomes recoverable.

#### Scenario: Terminal failure event
- **WHEN** the stream ends with a `failure` event
- **THEN** the failure screen shows `reason` and each diagnostic's `hint`, and offers to rephrase

#### Scenario: Stream error before any terminal event
- **WHEN** the SSE stream ends or errors without a terminal event (not due to a user-initiated cancel)
- **THEN** the same honest failure screen is shown rather than the UI hanging or crashing

#### Scenario: Attempts are shown only when they happened
- **WHEN** the run reached the repair stage twice before failing
- **THEN** the attempt-progress row renders with two spent segments and a label naming the attempts used
- **AND WHEN** the run failed on a transport error before any stage arrived
- **THEN** no attempt-progress row is rendered

#### Scenario: The checklist reads as checks, not bullets
- **WHEN** the failure screen renders with diagnostics
- **THEN** each row carries its outcome icon and its hint text inside the bordered panel, and no row is prefixed with a bullet character

#### Scenario: No engineering detail leaks into the redesign
- **WHEN** any row of the checklist is inspected
- **THEN** its text is a diagnostic `hint` or a copy-table string, and no `kind`, `symbol`, or `message` value appears

#### Scenario: The failure is recoverable from the log
- **WHEN** the failure screen is shown
- **THEN** a record on the generation channel carries the error class, message, stack, and mapped error kind, none of which is rendered on screen

#### Scenario: Styling comes from tokens
- **WHEN** the failure screen's stylesheet is inspected
- **THEN** it contains no hex colour and no numeric font-size or radius literal

#### Scenario: A refusal is not a failure
- **WHEN** a clarify request is refused with `content_policy`
- **THEN** no failure screen is shown, and compose shows the refusal notice instead

#### Scenario: No transport text reaches the reason
- **WHEN** a request fails at the network level with an error message and no hint
- **THEN** the failure screen's reason is the copy table's generic sentence, and the error message appears only in the log record

### Requirement: The compose entry point shows a server-unreachable notice without blocking generation
The prompt flow's entry point SHALL show a "server unreachable" notice when the session connectivity state is offline. The notice SHALL be advisory only: it SHALL NOT prevent the user from submitting a prompt, and a submission that succeeds SHALL proceed exactly as it would if the notice were absent (per `server-connectivity`'s "a real generation succeeding counts as the session's first success"). Because the compose step opens only with AI-data consent granted and a server address always exists (an override or the compiled-in default), no "set an address in Settings" message SHALL be shown.

#### Scenario: Notice shown while offline
- **WHEN** the user opens the prompt entry point while the connectivity state is offline
- **THEN** the screen shows a "server unreachable" notice

#### Scenario: Submitting while offline is still permitted
- **WHEN** the connectivity state is offline and the user submits a prompt
- **THEN** the request is sent exactly as it would be online, and the notice does not gate submission

#### Scenario: No address message ever
- **WHEN** the user opens the prompt entry point with no server override saved
- **THEN** no "set an address in Settings" message is shown, and the connectivity notice follows the session state alone
