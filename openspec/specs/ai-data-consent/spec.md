# ai-data-consent Specification

## Purpose
TBD - created by archiving change store-launch-compliance. Update Purpose after archive.
## Requirements
### Requirement: Nothing is sent to the server before consent is granted
The launcher SHALL NOT send any request to the server (clarify, rewrite, generate, or a connectivity probe of any kind) unless a current AI-data consent grant exists. The one exception SHALL be a report the user sends by hand from the report sheet, which carries its own disclosure (see `content-reporting`).

Request options for clarify, rewrite, generate and connectivity probes SHALL come from one gate that yields nothing without a current grant, so a call site cannot build a request that skips it.

#### Scenario: A fresh install stays silent
- **WHEN** the launcher starts for the first time and the user browses the home grid, opens and uses the example apps, and visits Settings
- **THEN** no request of any kind has reached the server, and the connectivity state is unknown

#### Scenario: Revoking stops requests mid-session
- **WHEN** consent is turned off in Settings and the user then takes an action that would send a request
- **THEN** the consent screen opens and no request is sent

#### Scenario: A report is the only exception
- **WHEN** no consent grant exists and the user sends a report from the report sheet
- **THEN** exactly that report request is sent, and no clarify, rewrite, generate, or probe request accompanies it

### Requirement: The first action that would send data asks for consent at that moment

The launcher SHALL open the first-run sheet over the current screen, in place of the requested screen, whenever the user takes a data-sending action without a current grant. The data-sending actions are: the home composer; changing an app from its tile menu, from inside the running app or from History; and trying a failed or stopped attempt again. After the user agrees, the action they started SHALL continue as if consent had already existed, except that a change sent from inside a running mini-app closes that app when the sheet opens, so after agreeing it continues as a change made from Home (its Describe page, plan and Making page, and closing its Failure page lands on Home) rather than collapsing into the orb of a running app. Reattaching to a run that is already in flight sends nothing and SHALL NOT ask. Where another requirement of this capability says the consent screen opens for a data-sending action, the first-run sheet opens; the consent screen of "Settings shows consent and can review or turn it off" stays a full screen in review mode.

#### Scenario: Composer row on a fresh install

- **WHEN** a user with no grant taps the home composer
- **THEN** the first-run sheet opens, the Describe page is not shown, and no request is sent

#### Scenario: Agreeing continues the started action

- **WHEN** the user agrees on a first-run sheet opened by "Change it" on an app
- **THEN** the Describe page opens in change mode for that app

#### Scenario: Agreeing on a change sent from inside a running app

- **WHEN** a user with no grant sends a change from the Whim sheet of a running mini-app, the first-run sheet opens, and the user agrees
- **THEN** the running app is already closed, the change continues as one made from Home, and closing its Failure page lands on Home

#### Scenario: Agreeing continues a retry

- **WHEN** the user agrees on a first-run sheet opened by trying a failed attempt again
- **THEN** the retry starts from that attempt's stored description, exactly as it would with consent already granted

### Requirement: The disclosure names what is sent, what is never sent, and who receives it

The first-run sheet SHALL state the disclosure in two layers, in plain words from the copy table for the active legal language (see `legal-text-localization`), and both layers SHALL be on the sheet, reachable before any choice is taken.

The first layer SHALL always be visible above the choices: a title, a one-line lead saying that making or changing an app sends what the user asks for to Whim's server and that AI companies working for Whim write the code, and three summary rows. Between them the lead and the rows MUST name:

- every category of data that is sent: what the user asks for (with their answers and the plan they approve), the ID Whim makes for this phone, and error details;
- who receives it: the AI companies working for Whim, and in a few words every other recipient role the manifest marks as named on the screen (AnyCognition, the other companies that work for it, Apple or Google, and authorities when the law requires it);
- what it is used for;
- what stays on the phone, and what Whim never does.

The second layer SHALL be a "Full details" row on the same sheet that expands in place. It MAY start collapsed, and it SHALL be reachable before the terms checkbox is ticked and before the agree action is taken. Expanded, it SHALL state, in this order:

- what gets sent: what the user asks for (their description, their answers and the plan they approve); when changing an app, its name, code, description and data layout, never the data itself; an ID Whim makes for this phone and what it is used for; and error details, technical only, never what the user typed or saved;
- why: every purpose in the current disclosure manifest, in short words, including running Whim within its costs;
- who gets it: every recipient role the manifest marks as named on the screen. In version 2, those are AnyCognition; companies that work for it (some outside Canada), which can't train AI on the data or use it for their own products but may keep it briefly for security and legal reasons; Apple or Google checking that requests come from the real Whim app; and authorities when the law requires it;
- what the user saves in their apps: nobody at Whim can read it, it stays on the phone, and anything Whim ever syncs or backs up is encrypted on the phone with a key Whim never has;
- what Whim never does: show ads, sell data or share it for advertising, or track the user across other apps and websites;
- that Whim will ask first before collecting a new kind of information, using it for a new purpose, keeping it longer, or giving it to a new kind of company;
- that AI features and error details can each be turned off in Settings, and installed apps keep working either way.

Neither layer SHALL name any provider company or call the phone ID anonymous, and neither SHALL carry anything about the terms of use: the terms checkbox (see `terms-acceptance`) is a separate row under them. The sheet SHALL carry a privacy policy link that opens the policy URL for the active legal language in the system browser. All strings SHALL pass the product-verbs guard, and all styling SHALL come from the design tokens.

#### Scenario: The first layer is complete without expanding anything

- **WHEN** the first-run sheet renders at consent version 2 with "Full details" collapsed
- **THEN** the visible text names what the user asks for, the phone ID and error details as sent, the AI companies working for Whim and every other screen-named recipient role, and what the data is used for, and it shows the privacy policy link and no terms wording outside the checkbox row

#### Scenario: The disclosure is complete

- **WHEN** the user taps "Full details" before ticking the box or agreeing
- **THEN** each section above shows in order and names every screen-named role in the version-2 manifest

#### Scenario: No vendor on the screen

- **WHEN** the copy tables for every language are scanned
- **THEN** no first-run or consent string contains "OpenRouter" or "anonymous"

#### Scenario: The privacy link follows the language

- **WHEN** the active legal language is French and the user taps the privacy policy link
- **THEN** the system browser opens the French policy URL derived from the release domain constant

### Requirement: Permission is explicit and declining keeps installed apps usable

The first-run sheet SHALL grant consent only through its explicit agree action (`Agree to send descriptions`), an act separate from the terms checkbox: ticking the checkbox SHALL grant nothing, and the agree action SHALL NOT tick it. Its decline action (`Not now`), close, drag, scrim, system back, and any other exit SHALL grant nothing. Nothing on the sheet SHALL be pre-selected or implied as agreement. The grant SHALL be recorded with the consent version, apart from the terms acceptance and its version (see `terms-acceptance`), and no clarify, rewrite, generate or probe request SHALL be sent until every act that was due is recorded.

Declining SHALL return the user to the screen that opened the sheet, or to Home when that screen was a running mini-app. After declining, every installed app SHALL still open, run, be copied, and show its history, and the next data-sending action SHALL ask again.

#### Scenario: Back declines

- **WHEN** the user presses system back on the first-run sheet
- **THEN** no grant and no acceptance are stored and the user returns to the screen that opened it

#### Scenario: Apps keep working after declining

- **WHEN** the user declines and then opens an example app, makes a copy of it, and opens its history
- **THEN** all three work, and no request has been sent

#### Scenario: Two acts, two records

- **WHEN** a user with neither record ticks the terms box and takes `Agree to send descriptions`
- **THEN** the terms acceptance is stored under its key with the terms version and the grant under its key with the consent version

#### Scenario: Nothing is sent before both acts

- **WHEN** the first-run sheet is open on a fresh install, with the box ticked or not
- **THEN** no request has been sent, and the first request leaves only after the agree action has recorded both acts

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

### Requirement: Settings shows consent and can review or turn it off
The Settings screen SHALL carry an AI features section that reads whether consent is on (with the date it was granted) or off. Tapping it SHALL open the consent screen in review mode, showing the same disclosure.

In review mode with consent on, the large button SHALL keep it on and a plain-text action SHALL turn it off. Turning it off SHALL delete the grant, return the connectivity state to unknown with no probe scheduled, and block every later request until the user agrees again. Turning it off SHALL NOT cancel a build that is already running, because its request was already sent, and SHALL NOT change any installed app. In review mode with consent off, the agree action SHALL grant consent and return to Settings.

#### Scenario: Turning consent off
- **WHEN** the user opens AI features in Settings and chooses to turn it off
- **THEN** the grant is deleted, Settings reads off, no connectivity probe is pending, and the next composer tap opens the consent screen

#### Scenario: A running build survives revocation
- **WHEN** a build was left running and the user turns consent off
- **THEN** that build continues and can still be delivered, and no new request is sent afterwards

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
The server's consent-practices table (created by `request-envelope`) SHALL be computed from the disclosure manifest: the practices permitted for a consent version SHALL be exactly the category ids that version's manifest lists with surface `app`. A category with surface `website` SHALL never be a practice for any version. The manifest's category ids SHALL keep `request-envelope`'s ids (`request-material`, `usage-records`, `connection-logs`, `reports`) and add `phone-id`, `error-details` and `app-integrity`. Version 1 SHALL list every category `request-envelope` gave it, plus `phone-id`, which v1 disclosed. A server practice SHALL NOT run for a request whose granted version's manifest lacks its category, as `request-envelope` enforces.

#### Scenario: Version 2 permits error details
- **WHEN** a diagnostics request carries consent version 2
- **THEN** the table permits `error-details` for it

#### Scenario: Version 1 does not permit error details
- **WHEN** a diagnostics request carries consent version 1
- **THEN** the table does not permit `error-details`, and `request-envelope`'s refusal applies

#### Scenario: The table can't drift from the text
- **WHEN** an `app`-surface category is added to a new manifest version
- **THEN** the server permits it for that version with no edit to `consent-practices.ts`

#### Scenario: The waitlist is not an app practice
- **WHEN** the table is computed from the live manifests
- **THEN** no version permits `waitlist`

### Requirement: Every manifest category declares whether the app or the website collects it
Every disclosure-manifest category SHALL declare a surface, `app` or `website`, with no default, and the checks SHALL keep website categories out of the app's consent.
- A frozen snapshot that predates the field SHALL be read as listing only `app` categories.
- The release check SHALL fail when a category's surface in a released version's live manifest
  differs from its surface in that version's frozen snapshot.
- The route static check SHALL fail when a `/v1` route declares a `website` category.

#### Scenario: A category without a surface does not compile
- **WHEN** a category is added to the manifest without `surface`
- **THEN** the typecheck fails

#### Scenario: Moving a released category to the app is refused
- **WHEN** a category that version 2's frozen snapshot lists as `app` is marked `website` in the live version-2 manifest, or the reverse
- **THEN** the release check fails, naming version 2 and the category

#### Scenario: A route cannot claim the website's category
- **WHEN** a `/v1` route declares `waitlist` as its category
- **THEN** the static check fails, naming the route and the category

