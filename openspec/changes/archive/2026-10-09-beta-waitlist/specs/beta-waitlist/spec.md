## ADDED Requirements

### Requirement: Signup page and result pages
The pages site SHALL serve a signup page at `/beta` and result pages at `/beta/thanks` and `/beta/retry`, each script-free under the pages-site CSP, and each linking `/privacy`.
The signup page SHALL contain one form that posts `application/x-www-form-urlencoded` to the
build-time value `WHIM_BETA_SIGNUP_URL`, with fields `email` (type email, required, maxlength 254),
`platform` (radios `ios`, `android`, `other`, labelled "iOS", "Android" and "Other"; one required),
`updates_opt_out` (checkbox, value `1`, unchecked by default) and the trap field `hp_ref` (hidden
from people, not `type="hidden"`, `autocomplete="off"`, and with a name, id and label that hold no
word browser autofill fills: company, organization, business, website, url or name).

#### Scenario: Pages are routed
- **WHEN** a browser requests `/beta`, `/beta/thanks` or `/beta/retry` on the pages host
- **THEN** it receives the matching page with status 200 and the pages-site CSP

#### Scenario: Form contract holds
- **WHEN** the site is built
- **THEN** the built `/beta` page has exactly one form, whose method is post, whose action is the configured signup URL, and whose fields match the contract above, and no page in the site contains a script element or an inline event handler

### Requirement: Pages-site fonts and assets
The pages site SHALL serve files under `deploy/site/assets/` at `/assets/*`, and its CSP SHALL add `font-src 'self'` and nothing else to `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'`.

#### Scenario: Self-hosted font loads
- **WHEN** a page references a font under `/assets/`
- **THEN** the pages host serves it and the CSP allows it

#### Scenario: Remote font is still refused
- **WHEN** a page references a font on another origin
- **THEN** the CSP refuses it

### Requirement: Signup route
The API server SHALL accept `POST /beta/signup` outside `/v1`, with no device header, and SHALL answer every request with `303 See Other` to `/beta/thanks` or `/beta/retry` on the pages host.
A valid submission (a syntactically valid email of at most 254 bytes and a platform in
`ios|android|other`) SHALL be stored and redirected to thanks. Any other submission SHALL be
redirected to retry and store nothing.

#### Scenario: Valid signup is stored
- **WHEN** a form post carries a valid email, platform `android` and no `updates_opt_out`
- **THEN** the store holds one row for the normalized email with platform `android`, `updates_opt_out` false and the current notice id, and the response is a 303 to `/beta/thanks`

#### Scenario: Invalid signup is refused
- **WHEN** a form post has a malformed email or a platform outside the set
- **THEN** nothing is stored and the response is a 303 to `/beta/retry`

#### Scenario: No device header needed
- **WHEN** a valid form post arrives without `x-whim-device`
- **THEN** it is stored, and `/v1/*` routes still refuse requests without that header

### Requirement: One row per person
The waitlist store SHALL keep at most one row per email, normalized by trimming and lowercasing, and a repeat signup SHALL update platform, `updates_opt_out`, notice id and `updated_at` while keeping `created_at`.

#### Scenario: Repeat signup updates
- **WHEN** `A@Example.com ` signs up as `ios`, then `a@example.com` signs up as `android` with the opt-out ticked
- **THEN** the store holds one row for `a@example.com` with platform `android`, `updates_opt_out` true and the first signup's `created_at`

### Requirement: Abuse limits
The signup route MUST refuse, by redirecting to `/beta/retry` without storing, any request over the body cap, over the per-client hourly limit or over the global daily cap. A request with a non-empty trap field MUST redirect to `/beta/thanks` and store nothing.
The per-client key SHALL be derived from the forwarded client address, hashed with a per-process
random salt, and held only in memory.

#### Scenario: Oversized body
- **WHEN** a post exceeds `WHIM_MAX_BODY_BYTES_BETA`
- **THEN** nothing is stored and the response redirects to retry

#### Scenario: Per-client limit
- **WHEN** one client address sends more valid signups within an hour than `WHIM_BETA_LIMIT_PER_CLIENT_HOUR`
- **THEN** the signups over the limit are not stored and redirect to retry, and a different client address is still accepted

#### Scenario: Trap field
- **WHEN** a post fills the `hp_ref` field
- **THEN** nothing is stored and the response redirects to thanks

### Requirement: Emails never logged
The server MUST NOT write a submitted email, platform or client address to any log; signup log lines SHALL carry only an outcome code and a request id.

#### Scenario: Log output is clean
- **WHEN** valid, invalid, limited and trapped signups are processed with logging captured
- **THEN** no captured log line contains the submitted email or client address

#### Scenario: Redaction backstop
- **WHEN** any log call passes a field named `email`
- **THEN** the logger redacts it

### Requirement: Consent wording is recorded
The site build MUST fail when the normalized text of the signup page's `data-notice` elements does not hash to a registered notice id, and each stored signup SHALL record the notice id current at the time.

#### Scenario: Unregistered wording fails the build
- **WHEN** the consent line's wording changes without a new registered notice id
- **THEN** the site build fails and names the unregistered wording

#### Scenario: Signup records the notice
- **WHEN** a signup is stored
- **THEN** its row carries the current notice id

### Requirement: Retention and operator access
The waitlist store SHALL delete rows 730 days after their `updated_at`, and the list SHALL be reachable only through the operator command on the server host, never through an HTTP route.
The operator command SHALL export CSV (email, platform, updates_opt_out, created_at, updated_at),
optionally filtered by platform or to rows without the opt-out, and SHALL remove a person by
email.

#### Scenario: Purge
- **WHEN** the purge runs and a row's `updated_at` is more than 730 days old
- **THEN** that row is deleted and newer rows remain

#### Scenario: Android export
- **WHEN** the operator runs the export filtered to `android`
- **THEN** the CSV lists exactly the Android rows

#### Scenario: Removal
- **WHEN** the operator removes an email, in any casing
- **THEN** its row is gone and a later export omits it

### Requirement: Privacy policy covers the waitlist
The privacy policy, in English and French, SHALL describe the waitlist data (email, platform, opt-out choice, notice id), its purpose, its 730-day retention and how to leave the list, and the app's AI-consent version MUST NOT change because of it.

#### Scenario: Policy and retention agree
- **WHEN** the site is built
- **THEN** the legal-pages checks pass with the waitlist category disclosed in both languages and its retention matching the store's constant

#### Scenario: App consent unchanged
- **WHEN** this change is applied
- **THEN** the app's current AI-consent version is the same as before
