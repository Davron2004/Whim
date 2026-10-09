## ADDED Requirements

### Requirement: Store privacy declarations follow the manifest's store mapping
The App Store privacy answers (`app-privacy.json`), the Play Data safety form (`data-safety.json`), the iOS privacy manifest (`PrivacyInfo.xcprivacy`) and `answers.md` SHALL declare exactly the data types, linkage, purposes, required-or-optional flags and shared flags that the current disclosure manifest's store mapping gives. That means every Apple type Linked; request material, the phone ID (which also carries the app-integrity check), usage records and error details declared; error details optional; and Play "Shared" set by the one recorded rule. No declaration SHALL mark any type as used for tracking. The release check SHALL fail when any of the four disagrees with the mapping or with the others, and SHALL no longer refuse a Linked declaration.

#### Scenario: Linked is accepted
- **WHEN** the release check runs on declarations that mark every type Linked
- **THEN** it passes

#### Scenario: Not linked is refused
- **WHEN** the iOS privacy manifest marks the device ID `NSPrivacyCollectedDataTypeLinked` false
- **THEN** the release check fails, naming the file and the type

#### Scenario: Tracking is refused
- **WHEN** any declaration marks a type as used for tracking
- **THEN** the release check fails

#### Scenario: A missing type is refused
- **WHEN** `data-safety.json` omits error details
- **THEN** the release check fails, naming the file and the category

### Requirement: Listings and review notes carry the version-2 text
The App Store description and the Play full description SHALL replace their privacy paragraph with `draft-copy.md` §3's text. They SHALL say "no accounts, no login and no ads" and SHALL NOT claim "no analytics" or call the phone ID anonymous. The App Review notes (`review_information/notes.txt` and `docs/store/review-notes.md` §4) SHALL carry §5's "What leaves the phone, and when" paragraph, the updated 4.7.1 sentence, and the 4.7.4 and 4.7.5 answers. The 4.7.5 answer SHALL include the age-signal sentence once `store-age-signals` ships in the same release. The network-deny TODO SHALL stay until `platform-release-readiness` 13.6 and 13.7 pass, and the review notes SHALL stay within the 4,000-character limit.

#### Scenario: Listings pass the checker
- **WHEN** the listing checker runs on the new descriptions
- **THEN** it passes (no URLs, within length limits), and neither description contains "analytics" or "anonymous"

#### Scenario: Review notes fit
- **WHEN** the review notes are measured
- **THEN** they are at most 4,000 characters and name OpenRouter only in the reviewer paragraph
