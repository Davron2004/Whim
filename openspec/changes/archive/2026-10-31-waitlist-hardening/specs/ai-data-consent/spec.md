## MODIFIED Requirements

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

## ADDED Requirements

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
