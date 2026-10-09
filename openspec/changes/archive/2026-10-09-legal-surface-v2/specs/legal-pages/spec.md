## ADDED Requirements

### Requirement: The privacy policy page states the version-2 disclosure
The site SHALL serve the privacy policy at `/privacy` in English and `/fr/privacy` in French, each an HTML page (not a PDF) reachable without geofencing. Each SHALL carry the text of `draft-copy.md` §2 with the owner's decisions of 2026-09-23 applied, in this order:
- an effective date and version with the change log;
- the scope (the app and whim.anycognition.ca, including app-link pages);
- the short version with the three core promises;
- who we are, with AnyCognition Inc.'s address, phone, privacy mailbox and the Privacy Officer by title;
- what leaves the phone, per manifest category, with what each excludes;
- why, and the legal bases;
- who handles it, by role;
- a dated "Who handles it right now" list of current providers with country and contact;
- where it's handled, including the adequacy and transfer position;
- how long it's kept, stating each category's published maximum and that records made under version 1 keep the 90-day rule;
- keeping it safe;
- your choices;
- your rights, including the separate right-to-object paragraph, complaining to Whim first with acknowledgement within 30 days, and the right to complain to a regulator;
- Do Not Track and cross-site tracking;
- children;
- changes to the policy.

The policy SHALL NOT tie any promise to a named provider, and SHALL NOT call the phone ID anonymous.

#### Scenario: The policy matches the manifest
- **WHEN** the release check compares the policy's retention and data sections with the current manifest
- **THEN** every manifest category appears with its published maximum, and the check fails if one is missing or differs

#### Scenario: Vendor names only in the provider list
- **WHEN** the English and French policies are scanned
- **THEN** "OpenRouter" appears only inside the "Who handles it right now" list

### Requirement: The policy carries the sections every open storefront needs
Because every storefront stays open, the policy SHALL carry the EU and UK sections of `draft-copy.md` §2. When the owner has recorded an EU or UK Article 27 representative, the section SHALL name that representative's contact. The policy SHALL also carry a Korean-language section on overseas transfers that lists, for each current provider, the items transferred, the destination country, the recipient's name and contact, the purpose and the retention period. That section SHALL be generated from the same provider rows as the "Who handles it right now" list, so the two cannot disagree.

#### Scenario: A provider change updates both lists
- **WHEN** a provider row is added to the identity file and the pages are rebuilt
- **THEN** the provider appears in both the "Who handles it right now" list and the Korean transfer section

#### Scenario: A recorded representative is named
- **WHEN** the owner has recorded an EU representative and the pages are rebuilt
- **THEN** both policies name that representative in the EU section

### Requirement: The terms of use page is published beside the policy
The site SHALL serve the terms of use at `/terms` in English and `/fr/terms` in French, carrying the text of `draft-copy.md` §6 under Ontario law, with the subscription and sync sections left out until those features ship. Each legal page SHALL link its other-language twin.

#### Scenario: The terms page exists in both languages
- **WHEN** the site is deployed
- **THEN** `/terms` and `/fr/terms` answer 200 with HTML, and each links the other

### Requirement: No placeholder or draft marker reaches a published legal page
The legal pages SHALL take every owner-only value from one checked-in identity file: legal name, address, phone, privacy mailbox, Privacy Officer title, effective dates, the optional representatives, and the provider rows. The deploy check SHALL fail when any published legal page contains an unresolved `{{…}}` substitution, a draft marker such as `[B7]` or `[D21]`, or a bracketed placeholder such as `[street address]`.

#### Scenario: A missing required identity value blocks the deploy
- **WHEN** the identity file has no contact email (or another required value: legal name, Privacy Officer title, a stated effective date) and the site deploy check runs
- **THEN** the check fails, naming the page and the missing value

#### Scenario: An address not yet set is left out, not left blank
- **WHEN** the identity file has no street address and phone (owner decision 2026-09-24: optional until set)
- **THEN** the pages publish with the email contact only, with no empty address line, and the check passes

#### Scenario: A leftover draft marker blocks the deploy
- **WHEN** a policy page still contains `[B9]`
- **THEN** the deploy check fails, naming the page and the marker
