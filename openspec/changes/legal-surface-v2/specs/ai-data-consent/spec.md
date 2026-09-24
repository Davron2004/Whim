## MODIFIED Requirements

### Requirement: The disclosure names what is sent, what is never sent, and who receives it
The consent screen SHALL state, in plain words from the copy table for the active legal language (see `legal-text-localization`), before any choice is offered and in this order:

- a title and a one-line lead saying that building or changing an app sends what the user asks for to Whim's server and that AI companies working for Whim write the code;
- what gets sent: what the user asks for (their description, their answers and the plan they approve); when changing an app, its name, code, description and data layout, never the data itself; an ID Whim makes for this phone and what it is used for; and error details, technical only, never what the user typed or saved;
- why: every purpose in the current disclosure manifest, in short words, including running Whim within its costs;
- who gets it: every recipient role the manifest marks as named on the screen. In version 2, those are AnyCognition; companies that work for it (some outside Canada), which can't train AI on the data or use it for their own products but may keep it briefly for security and legal reasons; Apple or Google checking that requests come from the real Whim app; and authorities when the law requires it;
- what the user saves in their apps: nobody at Whim can read it, it stays on the phone, and anything Whim ever syncs or backs up is encrypted on the phone with a key Whim never has;
- what Whim never does: show ads, sell data or share it for advertising, or track the user across other apps and websites;
- that Whim will ask first before collecting a new kind of information, using it for a new purpose, keeping it longer, or giving it to a new kind of company;
- that AI features and error details can each be turned off in Settings, and installed apps keep working either way.

The screen SHALL NOT name any provider company. It SHALL NOT call the phone ID anonymous, and SHALL NOT carry anything about the terms of use. It SHALL carry a privacy policy link that opens the policy URL for the active legal language in the system browser. All strings SHALL pass the product-verbs guard, and all styling SHALL come from the shell palette and SDK tokens.

#### Scenario: The disclosure is complete
- **WHEN** the consent screen renders at consent version 2
- **THEN** it shows each section above in order, names every screen-named role in the version-2 manifest, and shows the privacy policy link and no terms link

#### Scenario: No vendor on the screen
- **WHEN** the copy tables for every language are scanned
- **THEN** no consent-screen string contains "OpenRouter" or "anonymous"

#### Scenario: The privacy link follows the language
- **WHEN** the active legal language is French and the user taps the privacy policy link
- **THEN** the system browser opens the French policy URL derived from the release domain constant

### Requirement: Consent grants are versioned
A grant SHALL be persisted on the launcher's key-value store under `whim.ai-consent:v1` as `{ version, grantedAt }`, where `version` is the consent version that was current when the user agreed. A grant SHALL count as current only when its `version` equals the compiled consent version from `release-config`, which SHALL be 2 after this change. A missing, unreadable, or malformed record SHALL count as no grant.

When the stored grant is outdated, the consent screen SHALL show, above the title, one line saying this has changed since the user last agreed, and then the what's-new line for the grant's version. That line comes from the copy table and names every widening between the grant's version and the current one, including a longer keep-period.

#### Scenario: A version-1 grant asks again
- **WHEN** a user agreed under consent version 1 and the app now ships consent version 2
- **THEN** their next data-sending action opens the consent screen with the outdated line and a what's-new line that names every widening from version 1 to version 2: error details, the app-integrity check by Apple or Google, the longer keep-period for reports and usage records, and everything version 1's text never said (including the hosting companies and what they handle, the use of requests and connection logs to run Whim and keep it safe, and sharing with authorities or a new owner)
- **AND** no request is sent until they agree again

#### Scenario: A corrupted record fails closed
- **WHEN** the stored consent record is not valid JSON
- **THEN** the launcher treats consent as not granted

## ADDED Requirements

### Requirement: The consent version changes only when the disclosure manifest widens
The launcher SHALL bump `AI_CONSENT_VERSION` whenever the published disclosure manifest widens, before any app or server practice that relies on the wider manifest takes effect, and SHALL NOT bump it for any other change unless a reviewed reason entry records why.

The disclosure manifest SHALL be one checked-in, typed structure with append-only versions. It SHALL list the data categories that can leave the phone. Each category is described at category level together with what it excludes, whether Whim keeps it, its published maximum keep-period, how it is consented to (the main grant, its own opt-in, or an act the user takes for that purpose), whether an optional category is on by default, and its store mapping. The manifest SHALL also list the recipient roles, marking which ones the consent screen must name; the purposes; the allowed (category, role, purpose) combinations; and the core promises. The consent screen, the privacy policy and the store declarations SHALL be checked against it. A version-1 manifest describing the v1 disclosure SHALL be checked in as the first baseline, and version 2 SHALL be the README's "Manifest, version 2" with the owner's decisions of 2026-09-23 applied.

A change widens the manifest when it:
- adds a data category covered by the main grant, such as audio, location, contacts, or a name or email;
- adds a field whose content the category's description excludes, such as typed text in error details or saved data in app material; such a field counts as a new category;
- adds a (category, role) or (category, purpose) combination, such as requests used to train or evaluate AI models, or any data used for advertising;
- adds a recipient role, such as a party that may use data for its own purposes;
- makes a category Whim keeps that the manifest lists as not kept, or lengthens a category's published maximum keep-period;
- changes an optional category's default from off to on, or moves a category from its own opt-in or a user act into the main grant;
- removes or narrows a core promise, for example by letting anything saved inside a mini-app reach Whim in a form Whim can read, whatever consent path it takes.

A change does not widen the manifest when it:
- rewords or translates copy;
- adds, removes or switches a provider within an existing role;
- adds a field inside an existing category that the category's description does not exclude;
- changes a keep-period within the published maximum;
- removes or narrows anything;
- adds an optional category that keeps every core promise and leaves the phone only after the user turns its feature on (such as sync, backup, in-app voice or bring-your-own-key), or after the user takes an act for that purpose on a screen that says what goes (such as sending a report or buying a subscription), and that sends nothing before that.

Such a category is added to the manifest with its own consent path. The feature's own screen records the user's choice, and the main version does not move.

A release check SHALL run on every app build, every server deploy and every gate run. It SHALL fail when:
- the manifest widened without a version bump;
- a released version's manifest widened compared with its frozen snapshot;
- the version was bumped although the manifest did not widen and no reviewed reason entry explains the bump (for example, a defect found in the previous consent, or data sent without a grant);
- the what's-new copy for any older version, in any language, does not cover exactly the widenings from that version to the current one.

#### Scenario: Switching AI provider does not ask again
- **WHEN** the server moves from OpenRouter to a model vendor's direct API, and both act only for Whim
- **THEN** the manifest is unchanged and `AI_CONSENT_VERSION` stays the same

#### Scenario: A new diagnostic field does not ask again
- **WHEN** the diagnostics allowlist gains a field and the ledger gains a `failure_reason` column
- **THEN** both fall inside existing categories and the version stays the same

#### Scenario: Accounts ask again
- **WHEN** a release adds sign-in with an email address
- **THEN** the manifest gains a category, the release check fails until the version is bumped, and the consent screen names the new category

#### Scenario: A new purpose asks again unless it is its own opt-in
- **WHEN** requests start being kept to evaluate model quality
- **THEN** the version bumps, unless the feature is an optional switch that asks on first use and sends nothing until the user agrees

#### Scenario: Turning on sync is the user's own opt-in
- **WHEN** a release adds end-to-end encrypted sync, off by default, with its own consent screen the first time a user turns it on
- **THEN** the manifest gains an optional category with its own opt-in, `AI_CONSENT_VERSION` stays the same, and nothing is synced for a user who hasn't turned it on

#### Scenario: Sync that Whim could read asks everyone
- **WHEN** a sync design would let Whim decrypt saved data, for example by holding a recovery key
- **THEN** it narrows a core promise, the release check fails until the version is bumped, and the feature's own opt-in does not count as consent for it

#### Scenario: Buying a subscription does not ask everyone
- **WHEN** a release adds a subscription bought through App Store or Google Play in-app purchase, and the server starts receiving the store's purchase record
- **THEN** the purchase record is an optional category consented to by the purchase itself, the paywall says what Whim receives, and the version stays the same

#### Scenario: A bump with nothing new is refused
- **WHEN** `AI_CONSENT_VERSION` changes, the manifest does not widen, and no reviewed reason entry exists
- **THEN** the release check fails, so nobody is asked again for a wording change

#### Scenario: A longer keep-period asks again
- **WHEN** the published maximum for reports goes from 12 months to 5 years
- **THEN** the manifest widened, and the release check fails until the version is bumped

#### Scenario: Editing a released version is refused
- **WHEN** someone adds a category to the version-2 manifest after version 2 was released, instead of adding version 3
- **THEN** the release check fails, naming version 2 and the widening

#### Scenario: A what's-new line that hides a widening is refused
- **WHEN** the version-1 what's-new copy in either language omits the longer keep-period for reports
- **THEN** the release check fails, naming the language and the missing widening

### Requirement: The server's consent practices are derived from the manifest
The server's consent-practices table (created by `request-envelope`) SHALL be computed from the disclosure manifest: the practices permitted for a consent version SHALL be exactly the category ids that version's manifest lists. The manifest's category ids SHALL keep `request-envelope`'s ids (`request-material`, `usage-records`, `connection-logs`, `reports`) and add `phone-id`, `error-details` and `app-integrity`. Version 1 SHALL list every category `request-envelope` gave it, plus `phone-id`, which v1 disclosed. A server practice SHALL NOT run for a request whose granted version's manifest lacks its category, as `request-envelope` enforces.

#### Scenario: Version 2 permits error details
- **WHEN** a diagnostics request carries consent version 2
- **THEN** the table permits `error-details` for it

#### Scenario: Version 1 does not permit error details
- **WHEN** a diagnostics request carries consent version 1
- **THEN** the table does not permit `error-details`, and `request-envelope`'s refusal applies

#### Scenario: The table can't drift from the text
- **WHEN** a category is added to a new manifest version
- **THEN** the server permits it for that version with no edit to `consent-practices.ts`
