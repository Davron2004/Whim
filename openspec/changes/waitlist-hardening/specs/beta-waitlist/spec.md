## MODIFIED Requirements

### Requirement: Signup page and result pages
The pages site SHALL serve a signup page at `/beta` and result pages at `/beta/thanks` and `/beta/retry`, each script-free under the pages-site CSP, and each linking `/privacy`.
The signup page SHALL contain one form that posts `application/x-www-form-urlencoded` to the
build-time value `WHIM_BETA_SIGNUP_URL`, with fields `email` (type email, required, maxlength 254),
`platform` (radios `ios`, `android`, `other`, labelled "iOS", "Android" and "Other"; one required),
`updates_opt_in` (checkbox, value `1`, unchecked by default, labelled "Email me news about Whim")
and the trap field `hp_ref` (hidden from people, not `type="hidden"`, `autocomplete="off"`, and
with a name, id and label that hold no word browser autofill fills: company, organization,
business, website, url or name). The page SHALL NOT carry a field named `updates_opt_out`.

#### Scenario: Pages are routed
- **WHEN** a browser requests `/beta`, `/beta/thanks` or `/beta/retry` on the pages host
- **THEN** it receives the matching page with status 200 and the pages-site CSP

#### Scenario: Form contract holds
- **WHEN** the site is built
- **THEN** the built `/beta` page has exactly one form, whose method is post, whose action is the configured signup URL, and whose fields match the contract above, and no page in the site contains a script element or an inline event handler

#### Scenario: The news box starts unticked
- **WHEN** the site is built
- **THEN** the `updates_opt_in` checkbox has no `checked` attribute and the page has no `updates_opt_out` field

### Requirement: Pages-site fonts and assets
The pages site SHALL serve the files under `deploy/site/assets/` whose extension is on the site build's asset allowlist at `/assets/*`, and its CSP SHALL add `font-src 'self'` and nothing else to `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'`.
The site build SHALL never publish a file or directory whose name starts with `.`, and SHALL fail,
naming the file, when `deploy/site/assets/` holds any other file whose extension is not on the
allowlist.

#### Scenario: Self-hosted font loads
- **WHEN** a page references a font under `/assets/`
- **THEN** the pages host serves it and the CSP allows it

#### Scenario: Remote font is still refused
- **WHEN** a page references a font on another origin
- **THEN** the CSP refuses it

#### Scenario: A hidden file is not published
- **WHEN** `deploy/site/assets/fonts/.DS_Store` exists, even though git ignores it, and the site is built
- **THEN** the build succeeds and the built site has no `.DS_Store` anywhere under `assets/`

#### Scenario: An unexpected file fails the build
- **WHEN** `deploy/site/assets/notes.md` exists and the site is built
- **THEN** the build fails and names `notes.md`

### Requirement: Signup route
The API server SHALL accept `POST /beta/signup` outside `/v1`, with no device header, and SHALL answer every request with `303 See Other` to `/beta/thanks` or `/beta/retry` on the pages host.
A valid submission SHALL be stored and redirected to thanks. A submission is valid when its email,
after trimming, is at most 254 UTF-8 bytes, holds exactly one `@` that is not its first character,
has a local part made only of letters, digits and `` . ! # $ % & ' * + / = ? ^ _ ` { | } ~ - `` that does not
start with `=`, `+`, `-`, `@`, `|` or `%`, and has a domain of at least two dot-separated labels,
each 1–63 letters, digits or inner hyphens; its platform is in `ios|android|other`; and its
`updates_opt_in` is absent or exactly `1`. A legacy `updates_opt_out` field SHALL be ignored. Any
other submission SHALL be redirected to retry and store nothing.

#### Scenario: Valid signup is stored
- **WHEN** a form post carries a valid email, platform `android` and no `updates_opt_in`
- **THEN** the store holds one row for the normalized email with platform `android`, no news consent and the current notice id, and the response is a 303 to `/beta/thanks`

#### Scenario: Invalid signup is refused
- **WHEN** a form post has a malformed email or a platform outside the set
- **THEN** nothing is stored and the response is a 303 to `/beta/retry`

#### Scenario: Formula-leading and dotless addresses are refused
- **WHEN** a form post's email is `=HYPERLINK(1)@example.com` or `person@localhost`
- **THEN** nothing is stored and the response is a 303 to `/beta/retry`

#### Scenario: A stale page's opt-out field grants nothing
- **WHEN** a form post carries a valid email, platform `ios` and `updates_opt_out=1` but no `updates_opt_in`
- **THEN** the row is stored with no news consent and the response is a 303 to `/beta/thanks`

#### Scenario: No device header needed
- **WHEN** a valid form post arrives without `x-whim-device`
- **THEN** it is stored, and `/v1/*` routes still refuse requests without that header

### Requirement: One row per person
The waitlist store SHALL keep at most one row per email, normalized by trimming and lowercasing, and a repeat signup SHALL update platform, notice id and `updated_at` and apply the news-consent rules, while keeping `created_at`.

#### Scenario: Repeat signup updates
- **WHEN** `A@Example.com ` signs up as `ios`, then `a@example.com` signs up as `android` with the news box ticked
- **THEN** the store holds one row for `a@example.com` with platform `android`, news consent recorded at the second signup under its notice id, and the first signup's `created_at`

### Requirement: Emails never logged
The server MUST NOT write a submitted email, platform or client address to any log; signup log lines SHALL carry only an outcome code and a request id, and the `error` line SHALL also carry `errorClass`, the thrown value's class name (or its `typeof`), never its message.
The outcome codes SHALL be `stored`, `updated`, `suppressed`, `invalid`, `origin`, `limited`,
`trap` and `error`.

#### Scenario: Log output is clean
- **WHEN** valid, invalid, cross-site, suppressed, limited and trapped signups are processed with logging captured
- **THEN** no captured log line contains the submitted email or client address

#### Scenario: A store failure names only its class
- **WHEN** the store throws an error whose message contains the submitted email
- **THEN** the `error` line carries `outcome`, the request id and `errorClass`, and no captured line contains the email or the error's message

#### Scenario: Redaction backstop
- **WHEN** any log call passes a field named `email`
- **THEN** the logger redacts it

### Requirement: Consent wording is recorded
The site build MUST fail when the normalized text of the signup page's `data-notice` elements does not hash to the notice registered as current, and each stored signup SHALL record the notice id current at the time.
Registered notice ids SHALL be append-only. A signup page that carries an older registered
notice's wording SHALL fail the build exactly as unregistered wording does.

#### Scenario: Unregistered wording fails the build
- **WHEN** the consent line's wording changes without a new registered notice id
- **THEN** the site build fails and names the unregistered wording

#### Scenario: Superseded wording fails the build
- **WHEN** the signup page carries the wording of `beta-1` after `beta-2` became current
- **THEN** the site build fails and names the notice the page carries and the current one

#### Scenario: Signup records the notice
- **WHEN** a signup is stored
- **THEN** its row carries the current notice id

### Requirement: Retention and operator access
The waitlist store SHALL delete rows 730 days after their `updated_at`, and the list SHALL be reachable only through the operator command, never through an HTTP route.
The operator command SHALL export CSV (email, platform, updates_opt_in, updates_consent_at,
notice_id, created_at, updated_at), optionally filtered by platform or to rows with news consent
(`--updates-ok`). Every CSV cell that starts with `=`, `+`, `-`, `@`, `|`, `%`, a tab or a carriage
return SHALL be written with a leading `'`. The command SHALL remove a person by email, turn a
person's news consent off or on (`updates <email> off|on`), and lift a removal fingerprint
(`restore <email>`).

#### Scenario: Purge
- **WHEN** the purge runs and a row's `updated_at` is more than 730 days old
- **THEN** that row is deleted and newer rows remain

#### Scenario: Android export
- **WHEN** the operator runs the export filtered to `android`
- **THEN** the CSV lists exactly the Android rows

#### Scenario: News export
- **WHEN** the operator runs the export with `--updates-ok`
- **THEN** the CSV lists exactly the rows with news consent

#### Scenario: Removal
- **WHEN** the operator removes an email, in any casing
- **THEN** its row is gone, a later export omits it, and its fingerprint is kept

#### Scenario: A formula never reaches the spreadsheet
- **WHEN** a stored row's email starts with `=` (written directly to the store, bypassing the route) and the operator exports
- **THEN** that cell starts with `'=`

### Requirement: Privacy policy covers the waitlist
The privacy policy, in English and French, SHALL describe the waitlist data (email, platform, news consent with its time and wording, notice id, removal fingerprint), its purpose, the 730-day retention of rows and of fingerprints, how to stop news emails and how to leave the list, and the app's AI-consent version MUST NOT change because of it.
The provider list SHALL name the waitlist among what Google Cloud receives and the beta emails
Whim sends among what Zoho receives, in every language the provider rows carry.

#### Scenario: Policy and retention agree
- **WHEN** the site is built
- **THEN** the legal-pages checks pass with the waitlist category disclosed in both languages and its retention matching the store's constants

#### Scenario: App consent unchanged
- **WHEN** this change is applied
- **THEN** the app's current AI-consent version is the same as before

#### Scenario: Provider rows cover the website and the emails
- **WHEN** the privacy page is built
- **THEN** the Google Cloud row's "receives" names the beta sign-up, and the Zoho row's names the beta emails, in English, French and Korean

## ADDED Requirements

### Requirement: News emails need express consent, and a withdrawal is sticky
The waitlist store SHALL record news consent only from a ticked `updates_opt_in` or an operator `updates <email> on`, SHALL keep for each row whether it has consent, when it was given and under which notice id (or `written-request`), and SHALL never let a web signup turn consent back on once it was withdrawn.
The rules for a signup on an existing row are:
- ticked, never withdrawn, no consent: consent is recorded now under the signup's notice id;
- ticked, consent already recorded: the earlier consent record is kept;
- ticked, withdrawn: nothing about consent changes;
- unticked, consent recorded: consent is withdrawn now;
- unticked, no consent: nothing about consent changes.

`updates <email> off` SHALL withdraw consent. `updates <email> on` SHALL clear the withdrawal and
record consent now under `written-request`; the runbook allows it only on a written request from
that address.

#### Scenario: Ticking the box records consent
- **WHEN** a new address signs up with `updates_opt_in=1`
- **THEN** its row has news consent with the signup time and the current notice id

#### Scenario: Unticking withdraws
- **WHEN** an address with news consent signs up again without the box ticked
- **THEN** its row has no news consent and records the withdrawal time

#### Scenario: A web post cannot undo a withdrawal
- **WHEN** an address whose consent was withdrawn signs up again with the box ticked, from any page
- **THEN** its row still has no news consent, and `--updates-ok` omits it

#### Scenario: A written request restores consent
- **WHEN** the operator runs `updates <email> on` for a withdrawn address
- **THEN** its row has news consent recorded under `written-request`

### Requirement: Removed addresses stay removed
Removing an address SHALL delete its row and keep its fingerprint (the HMAC-SHA-256 of the normalized email under a server-held key), and a later signup whose fingerprint is kept SHALL store nothing and redirect to `/beta/thanks` with outcome `suppressed`.
Removal SHALL keep the fingerprint whether or not a row existed. A fingerprint SHALL be deleted
730 days after it was kept, by the same purge as the rows, and `restore <email>` SHALL delete it
early. No fingerprint SHALL hold the address in clear. The key (`WHIM_WAITLIST_FINGERPRINT_KEY`,
from Secret Manager in production) SHALL never be stored, logged or exported, and the server, the
purge job and any command on the `firestore` backend SHALL refuse to start without it. The
Firestore row's document id stays the unkeyed SHA-256 of the normalized email; only the
fingerprint is keyed, so read access to the database alone cannot confirm a guessed address
against a fingerprint.

#### Scenario: A removed person cannot be re-added
- **WHEN** the operator removes `a@example.com` and a post then signs up `A@Example.com`
- **THEN** no row is stored, the response is a 303 to `/beta/thanks`, and the log outcome is `suppressed`

#### Scenario: Removal before signup
- **WHEN** the operator removes an address that is not on the list
- **THEN** the command reports that no row existed, keeps the fingerprint, and exits 0

#### Scenario: Restore lifts the fingerprint
- **WHEN** the operator runs `restore` for a removed address and that address then signs up
- **THEN** a row is stored

#### Scenario: A fingerprint is bound to its key
- **WHEN** an address is removed under one key and the same address signs up through a store holding another key
- **THEN** the signup is stored, and under the first key it is refused as `suppressed`

#### Scenario: Production refuses to start without the key
- **WHEN** the server or the purge job starts with `NODE_ENV=production` and no `WHIM_WAITLIST_FINGERPRINT_KEY`
- **THEN** it exits non-zero naming the variable, and its output never holds a key value

#### Scenario: Fingerprints expire with the published maximum
- **WHEN** the purge runs and a fingerprint was kept more than 730 days ago
- **THEN** that fingerprint is deleted and newer fingerprints remain

### Requirement: Signups posted from other sites are refused
The signup route SHALL refuse a request whose `Origin` header is present and is not exactly the configured pages origin, including the value `null`, by redirecting to `/beta/retry` with outcome `origin` and storing nothing, and SHALL accept a request with no `Origin` header on its other merits.
The pages host SHALL send `Referrer-Policy: strict-origin-when-cross-origin` on every page, so a
browser posting the real form sends the pages origin.

#### Scenario: Cross-site post
- **WHEN** a valid form post carries `Origin: https://evil.example`
- **THEN** nothing is stored and the response is a 303 to `/beta/retry`

#### Scenario: Opaque origin
- **WHEN** a valid form post carries `Origin: null`
- **THEN** nothing is stored and the response is a 303 to `/beta/retry`

#### Scenario: Same-site post
- **WHEN** a valid form post carries the pages origin as its `Origin`
- **THEN** it is stored and the response is a 303 to `/beta/thanks`

#### Scenario: Pages keep the origin visible
- **WHEN** the pages host serves `/beta`
- **THEN** the response carries `Referrer-Policy: strict-origin-when-cross-origin` and the page sets no other referrer policy

### Requirement: Existing rows move to the opt-in model without loss
`whim-admin migrate-waitlist` SHALL rewrite every row stored under the opt-out model into the opt-in model, SHALL only report what it would do unless given `--apply`, SHALL be idempotent, and SHALL print no address.
A legacy row with the opt-out ticked SHALL become a row with no news consent and a withdrawal at
its `updated_at`; a legacy row without it SHALL become a row with no news consent and no
withdrawal. Email, platform, notice id, `created_at` and `updated_at` SHALL be unchanged. The
command SHALL print, per row, its fingerprint prefix, the preserved fields and the planned consent
fields, then the counts of rows migrated, already migrated and total. Until a row is migrated,
every store read and write SHALL treat it by the same mapping.

#### Scenario: Dry run changes nothing
- **WHEN** the command runs without `--apply` over 5 legacy rows
- **THEN** it prints 5 planned migrations and the store is byte-for-byte unchanged

#### Scenario: Apply then re-run
- **WHEN** the command runs with `--apply`, then runs again
- **THEN** the first run migrates 5 rows, the second reports 0 migrated and 5 already migrated, and every row's email, platform, notice id, `created_at` and `updated_at` equal their values before the first run

#### Scenario: A legacy opt-out stays respected
- **WHEN** a legacy row with the opt-out ticked is migrated and its address then signs up with the news box ticked
- **THEN** the row has no news consent

#### Scenario: An unmigrated row is read correctly
- **WHEN** a legacy row with the opt-out ticked has not been migrated and the export runs with `--updates-ok`
- **THEN** the row is omitted

### Requirement: Beta emails follow the published paths
The runbook SHALL define how the operator sends beta emails, and that procedure SHALL match the privacy policy: Android addresses go only to Google Play's tester list, iOS people get the TestFlight link by email and their addresses are never uploaded to App Store Connect, and news emails go only to `--updates-ok` rows.
Every beta email SHALL go to one recipient per message or in BCC, SHALL name AnyCognition Inc. with
its mailing address and the support address, and SHALL say how to stop news emails and how to
leave the list. A stop or removal request SHALL be carried out with the operator command within 10
business days.

#### Scenario: Inviting iOS testers
- **WHEN** the operator follows the runbook to invite the iOS rows
- **THEN** the steps send the TestFlight link by email from the support mailbox and include no App Store Connect tester upload

#### Scenario: Sending news
- **WHEN** the operator follows the runbook to send a news email
- **THEN** the steps export with `--updates-ok`, send without exposing any recipient to another, and include the identification and stop lines
