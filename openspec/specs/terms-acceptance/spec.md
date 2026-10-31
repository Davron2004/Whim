# terms-acceptance Specification

## Purpose
TBD - created by archiving change legal-surface-v2. Update Purpose after archive.
## Requirements
### Requirement: Terms acceptance is versioned apart from consent
An acceptance SHALL be persisted on the launcher's key-value store under `whim.terms:v1` as `{ version, acceptedAt }`. It SHALL count as current only when `version` equals `TERMS_VERSION` from `release-config`, which is 1 after this change. A missing, unreadable or malformed record SHALL count as no acceptance. Bumping `TERMS_VERSION` SHALL NOT change the consent version, and bumping the consent version SHALL NOT invalidate a terms acceptance. When an outdated acceptance exists, the step SHALL show the updated-terms line in place of its lead.

#### Scenario: A consent bump does not re-show the terms
- **WHEN** a user with a current terms acceptance and a version-1 consent grant runs a build shipping consent version 2
- **THEN** only the consent screen is shown

#### Scenario: A corrupted acceptance fails closed
- **WHEN** the stored terms record is not valid JSON
- **THEN** the launcher treats the terms as not accepted

### Requirement: The send gate requires both a terms acceptance and a consent grant
The one request gate from `ai-data-consent` SHALL yield request options for clarify, rewrite, generate and connectivity probes only when both a current terms acceptance and a current consent grant exist. A report sent by hand from the report sheet SHALL remain the one exception and SHALL need neither.

#### Scenario: A grant without terms sends nothing
- **WHEN** a tester holds a current consent grant but no terms acceptance and takes a data-sending action
- **THEN** the terms step opens, and no request is sent until they accept

#### Scenario: Reports need neither
- **WHEN** a user with no acceptance and no grant sends a report
- **THEN** exactly that report is sent and neither screen appears

### Requirement: The terms are reachable from Settings
The Settings About section SHALL carry a "Terms of use" link that opens the terms URL for the active legal language (`RELEASE.termsUrl` or its French twin) in the system browser.

#### Scenario: Opening the terms from Settings
- **WHEN** the user taps "Terms of use" in Settings with English active
- **THEN** the system browser opens the English terms URL derived from the release domain constant

### Requirement: One pass through the legal flow shows each legal screen at most once

The launcher SHALL route every entry into the legal flow, including Settings' "Turn on AI features", through the single next-legal-step decision, and one pass SHALL show each legal surface (the age screen, the first-run sheet, the review-mode consent screen) at most once and SHALL ask for each act (the terms acceptance, the consent grant) at most once.

#### Scenario: Turn on AI features with outdated terms

- **WHEN** a user whose terms acceptance is not current taps "Turn on AI features" in Settings
- **THEN** the terms acceptance is asked once, consent is asked once, and AI features are on after that one pass

#### Scenario: Turn on AI features with current terms

- **WHEN** a user whose terms acceptance is current taps "Turn on AI features"
- **THEN** consent is asked exactly once and the terms are not asked

### Requirement: Terms are accepted by their own act on the first-run sheet

The launcher SHALL ask for the terms acceptance on the first-run sheet (see `ai-data-consent`), which opens over the current screen whenever the user takes a data-sending action without a current terms acceptance or a current consent grant. Accepting the terms MUST be its own affirmative act: a checkbox row reading "I accept the Terms of use", unticked every time the sheet opens, beside a link that opens the terms of use for the active legal language in the system browser. The link SHALL sit outside the checkbox's touch target, and following it SHALL NOT tick the box. The checkbox row SHALL say nothing about data, and ticking it SHALL grant no consent. The acceptance SHALL be recorded, with its version, only when the user takes the sheet's action with the box ticked, and the action SHALL stay disabled while the terms are due and the box is unticked. When the terms acceptance is current the sheet SHALL show no checkbox row. When the consent grant is current and only the terms are due, the sheet's action SHALL read as continuing, not as agreeing to send data, and SHALL record the acceptance and no new grant. `Not now`, close, drag, scrim, system back and any other exit SHALL record nothing, and SHALL return the user as declining consent does. Where another requirement of this capability says the terms step opens, the first-run sheet opens with its checkbox row.

#### Scenario: First data-sending action on a fresh install

- **WHEN** a user with neither acceptance nor grant taps the home composer
- **THEN** the first-run sheet opens with the box unticked and its action disabled; after the user ticks the box and takes `Agree to send descriptions`, the acceptance and the grant are both stored, each with its own version, and the Describe page opens

#### Scenario: Ticking the box alone records nothing

- **WHEN** the user ticks the box and then closes the sheet
- **THEN** no acceptance and no grant are stored, no request is sent, and the box is unticked the next time the sheet opens

#### Scenario: The terms link does not accept

- **WHEN** the user taps the terms link
- **THEN** the system browser opens the terms for the active legal language and the box stays unticked

#### Scenario: Declining the terms sends nothing

- **WHEN** the user taps `Not now` on the first-run sheet
- **THEN** no acceptance is stored, no grant is stored, no request is sent, and installed apps keep working

#### Scenario: A current acceptance skips the step

- **WHEN** the terms are current and the consent grant is outdated
- **THEN** the data-sending action opens the first-run sheet with no checkbox row and its agree action enabled

#### Scenario: Only the terms are due

- **WHEN** the consent grant is current, the terms acceptance is outdated, and the user takes a data-sending action
- **THEN** the sheet shows the updated-terms line and the checkbox row, its action reads as continuing, and taking it with the box ticked stores the new acceptance and leaves the stored grant unchanged

#### Scenario: The step carries no data disclosure

- **WHEN** the checkbox row renders
- **THEN** none of its strings mention what is sent, to whom, or why

