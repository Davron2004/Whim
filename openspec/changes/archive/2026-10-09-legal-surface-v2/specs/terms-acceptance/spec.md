## ADDED Requirements

### Requirement: Terms are accepted in their own step before the consent screen
The launcher SHALL show a terms step whenever the user takes a data-sending action (as `ai-data-consent` lists them) without a current terms acceptance, before the consent screen and in its place in the flow. The step SHALL show a title, a short lead, a link that opens the terms of use for the active legal language in the system browser, an `Accept` action and a `Not now` action. It SHALL say nothing about data. After `Accept`, the flow SHALL continue to the consent screen when consent is not current, and otherwise to the action the user started. `Not now`, system back and any other exit SHALL grant nothing, and SHALL return the user as declining consent does.

#### Scenario: First data-sending action on a fresh install
- **WHEN** a user with neither acceptance nor grant taps `Describe an app…`
- **THEN** the terms step opens; after `Accept` the consent screen opens; after `Agree and continue` the compose step opens

#### Scenario: Declining the terms sends nothing
- **WHEN** the user taps `Not now` on the terms step
- **THEN** no acceptance is stored, the consent screen is not shown, no request is sent, and installed apps keep working

#### Scenario: A current acceptance skips the step
- **WHEN** the terms are current and the consent grant is outdated
- **THEN** the data-sending action opens the consent screen directly

#### Scenario: The step carries no data disclosure
- **WHEN** the terms step renders
- **THEN** none of its strings mention what is sent, to whom, or why

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
