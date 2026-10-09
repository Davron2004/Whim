Constraints for every task:
- No `CONFIG_SET` file is edited (`package.json`, the lockfile, `tsconfig*.json`, eslint, knip, `scripts/gate*.sh`, `scripts/fixloop.sh`, `scripts/worktree.sh`, `.claude/**`, `.codex`, `build/`, `invariants/`, `babel.config.js`, `metro.config.js`).
- No test contacts production or a deployed server, and no task reads or writes `~/.config/whim/`.
- No GCP resource, DNS record or spend change.
- No launcher or app UI file is touched.
- Logs never carry an email, platform or client address.
- `/v1/*` stays gated by `x-whim-device`.
- `AI_CONSENT_VERSION` does not change.
- Each red-check is run against the plausible weaker variant named in the task, not only against the guard deleted, and recorded in the chain report.
- A chain that edits Firestore code or its tests also runs `npm run -s stores:firestore:test` from the main tree on its committed tip.

## 1. Category surface keeps website data out of app consent (#110)

- [x] 1.1 `contract/src/disclosure-manifest.ts`: add a required `surface: 'app' | 'website'` to the category type, with no default. Mark every existing category `app` and `waitlist` `website`. Change the `waitlist` row description to the design D6 text. The snapshot reader treats a category without `surface` as `app`. Do not edit `contract/disclosure/released/*.json`.
- [x] 1.2 `server/src/consent-practices.ts`: `practicesFrom` keeps only `app` categories. Rewrite the "never gains a category" comment to state the invariant in design D6.
- [x] 1.3 Release check: add the finding "version N's category X changed surface since release" to the logic shared by the gate suite, the release preflight and `deploy.sh`. Extend `checks/test/release/disclosure.suite.ts` with these cases:
  - a surface flip on a released version fails, naming the version and the category;
  - a snapshot without `surface` reads as `app`;
  - the live manifests produce no finding, and `AI_CONSENT_VERSION` is unchanged.

  Red-check the flip case against today's check.
- [x] 1.4 Route static check (`server/test/request-edge.suite.ts`, the "every route … declares its category" section): a `/v1` route that declares a `website` category fails, naming the route and the category. Red-check it with a forged route declaring `waitlist`.
- [x] 1.5 `request-edge.suite.ts`: drop `waitlist` from the version-2 expectation and assert that no version permits it. Add a forged-manifest case where a `website` category under version 1 is not permitted while an `app` category is. Red-check against today's unfiltered `practicesFrom`.
- [x] 1.6 Write `handoff/consent-surface.md`: the `surface` type, the waitlist category's new description verbatim, and the release-check finding text.

## 2. Waitlist store: news consent, sticky withdrawal, removal fingerprints (#109)

- [x] 2.1 `server/src/waitlist/store.ts`: change the `WaitlistStore` interface per design D2/D3:
  - the signup carries `updatesOptIn`;
  - the row carries `updatesOptIn`, `updatesConsentAt`, `updatesConsentNoticeId` and `updatesWithdrawnAt`;
  - `upsert` returns `stored | updated | suppressed`;
  - `remove(email, now)` always keeps the fingerprint and reports whether a row existed;
  - add `setUpdates(email, on, now)` and `restore(email)`;
  - `purge(now)` reports rows and fingerprints separately;
  - export the legacy-row mapping as one pure function that every backend and the migration share.

  Implement it in `InMemoryWaitlistStore`.
- [x] 2.2 `server/test/store-conformance.suite.ts`: add one case per spec scenario:
  - each of the five consent rules;
  - a web post that cannot undo a withdrawal;
  - a written request that restores consent;
  - removal before signup;
  - restore;
  - a suppressed signup;
  - an unmigrated legacy row read the same way (rows written in the exact shape `git show 4276f86d:server/src/firestore/waitlist-store.ts` and `…/waitlist/store.ts` produce, not a hand-written guess);
  - fingerprint purge at the 730-day cutoff;
  - a concurrent signup and removal.

  Update `waitlistRows`. Red-check the sticky case against the weaker variant "consent = latest web answer", and the suppression case against today's hard delete.
- [x] 2.3 `NodeSqliteWaitlistStore`: make the schema migration on open idempotent and run it in one transaction:
  - add the consent columns and `waitlist_suppressed(fingerprint PRIMARY KEY, suppressed_at)`;
  - convert legacy rows with the shared mapping;
  - keep `updates_opt_out` as the D2 rollback shadow, written as `!updatesOptIn` on every write.

  `remove` deletes the row and keeps the fingerprint atomically, and `upsert` reads the fingerprint in the same transaction. `secure_delete` and WAL stay.
- [x] 2.4 `server/src/firestore/waitlist-store.ts`:
  - add the `waitlistSuppressed/{waitlistDocId}` collection;
  - the upsert transaction reads the row and the fingerprint together, and `remove` deletes the row and creates the fingerprint in one transaction;
  - legacy docs (no `updatesOptIn`) are read through the shared mapping and rewritten in the new shape on their first write;
  - every write sets the `updatesOptOut` shadow;
  - the purge deletes fingerprints with `suppressedAt` before the cutoff through `deleteInBatches`.

  Confirm that `firestore-index-coverage.ts` reports no missing index. Add the Firestore-specific scenarios (sticky withdrawal, a signup racing a removal) to `server/test/firestore-conformance.ts`.
- [x] 2.5 The purge wiring (the in-process hourly purge and `server/src/admin/purge.ts`): the `waitlist:` line counts rows and fingerprints. Extend `server/test/admin-purge.suite.ts`.
- [x] 2.6 Write `handoff/waitlist-store.md`: the interface verbatim, the outcome values, the legacy mapping function's name and module, the Firestore collection and field names, and the SQLite table and column names.

## 3. Legacy-row migration and SQLite import (#109 data)

- [ ] 3.1 `server/src/admin/import-sqlite.ts`: carry the consent fields and the fingerprints. An opt-out-model `waitlist.db` (legacy column only) imports into the opt-in model through the shared mapping, and re-running changes nothing. Extend `server/test/import-sqlite.suite.ts` and the Firestore import cases (`server/test/firestore-import.ts`). Build the legacy fixture with BASE's SQLite schema.
- [ ] 3.2 New `server/src/admin/migrate-waitlist.ts`, wired as `whim-admin migrate-waitlist [--apply]` in `server/src/admin/{cli,main}.ts`, per design D5:
  - it is a dry run by default;
  - each legacy row is rewritten in its own transaction that re-checks the row is still legacy;
  - per row it prints the 12-hex fingerprint prefix, `platform`, `noticeId`, `createdAt`, `updatedAt` and the planned consent fields;
  - it then prints the totals (migrated or planned, already migrated, total);
  - it never prints an address, and runs against whichever backend the factory selects.
- [ ] 3.3 New `server/test/migrate-waitlist.suite.ts`, registered in `server/test/acceptance.ts`, covering the four spec scenarios on SQLite with a 5-row legacy fixture that mixes ticked and unticked:
  - the dry run leaves the database file byte-identical;
  - apply then re-run gives 5 migrated, then 0 migrated with 5 already migrated, with the preserved fields equal;
  - a migrated legacy opt-out stays respected;
  - an unmigrated row is read correctly.

  Also assert that stdout contains none of the 5 addresses. Red-check the idempotence case against a variant that rewrites already-migrated rows.
- [ ] 3.4 Add the same dry-run, apply and re-run scenario on the Firestore emulator (`server/test/firestore-import.ts`, registered where the emulator runner already picks it up). Assert that the docs are deep-equal before and after the dry run.
- [ ] 3.5 Write `handoff/waitlist-migration.md`: the command line, the exact output format and totals line, the exit codes, and what "already migrated" means.

## 4. Signup route and operator command (#109, #111)

- [x] 4.1 `server/src/routes/beta-signup.ts`, per design D4:
  - the Origin check runs after the body cap and before the content-type check, compares against `config.webOrigin` exactly, refuses `null`, and logs outcome `origin`;
  - read `updates_opt_in` (absent or `1`) and ignore `updates_opt_out`;
  - outcome `suppressed` redirects to thanks;
  - the outcome set is the one in the spec;
  - the `error` line keeps `errorClass`.

  Leave the email validator unchanged.
- [x] 4.2 `server/test/beta-signup.suite.ts`:
  - Origin cases: cross-site, `null`, same-site, absent, and a trap post with a cross-site Origin (retry);
  - a stale `updates_opt_out` field;
  - a suppressed signup;
  - a table-driven refusal for each of `= + - @ | %` as the leading character, and for a dotless domain;
  - a store error whose message holds the email, logging only `outcome`, the request id and `errorClass`;
  - log cleanliness across every outcome.

  Red-check the cross-site case against today's route, and the `null` case against a variant that only refuses non-null foreign origins.
- [x] 4.3 `server/src/waitlist/cli.ts`:
  - export columns `email, platform, updates_opt_in, updates_consent_at, notice_id, created_at, updated_at`;
  - `--updates-ok` filters to rows with consent;
  - `csvCell` prefixes `'` to cells starting with `= + - @ | %`, a tab or a CR;
  - `remove` always keeps the fingerprint and exits 0, saying whether a row existed;
  - new `updates <email> on|off` and `restore <email>`;
  - usage text.
- [x] 4.4 `server/test/waitlist.suite.ts`: cover the CLI scenarios (news export, removal with the fingerprint kept, removal before signup, restore, `updates on|off`, a formula cell from a row written straight to the store). Red-check the formula case against today's `csvCell`.
- [x] 4.5 Write `handoff/signup-route.md`: the outcome codes and their redirects, the order of checks, the form field names, the CLI commands with their output and exit codes, and the CSV columns.

## 5. Signup page, privacy policy and provider rows (#109, #114)

- [ ] 5.0 (added by the orchestrator after chain-1) Reword the `beta` purpose text in `contract/src/disclosure-manifest.ts` ("Invite people to test Whim and, unless they opt out, email them about Whim") to the opt-in model (ruling 1): invitations are requested messages; news only with express consent. Rewording must not widen any category (the disclosure check enforces this).

- [ ] 5.1 `deploy/site/beta.html`: replace the opt-out checkbox with the unticked `updates_opt_in` box labelled "Email me news about Whim". Reword the consent line to the design D1 text, both as `data-notice`, and reword the "Other" hint to point at the box. In `server/src/waitlist/notices.ts`, register `beta-2` with the page's fingerprint and make it `CURRENT_NOTICE_ID`. `beta-1` stays.
- [ ] 5.2 `server/test/beta-site.suite.ts`: the form contract (unticked `updates_opt_in`, no `updates_opt_out`), and the superseded-wording scenario: a page carrying `beta-1` text fails the build, naming both ids.
- [ ] 5.3 `deploy/site/privacy.html` and `deploy/site/fr/privacy.html`, `#beta-waitlist`:
  - the data kept: news consent with its time and wording, and the removal fingerprint;
  - news only when the box is ticked;
  - an unticked re-signup or a written request stops news for good unless the person writes to restart it;
  - signing up again after removal adds nothing;
  - the retention line for rows and fingerprints (730 days each), which the legal-pages checks hold to the store constants;
  - the legal-basis row and the Canada paragraph name consent for news;
  - a dated note that the section changed.

  Match the waitlist category description from `handoff/consent-surface.md`.
- [ ] 5.4 `deploy/site/legal-identity.json`: the Google Cloud and Zoho `receives` per design D10 in en, fr and ko, and `effectiveDates.privacy` and `providerList` moved to the change's date. Add the "Provider rows cover the website and the emails" assertion to the site suite that already reads the identity file.
- [ ] 5.5 Run the legal-pages, site and disclosure checks, and confirm that `AI_CONSENT_VERSION` and the released snapshots are unchanged.

## 6. Site build allowlist, referrer policy and profile tripwire (#113, #109, #112)

- [ ] 6.1 `server/src/site/build.ts`: replace `fs.cpSync` of `deploy/site/assets` with the design D8 walk:
  - skip any name starting with `.` at any depth;
  - copy `.woff2 .txt .svg .png .ico .webp`;
  - throw a build error naming any other file.
- [ ] 6.2 `server/test/beta-site.suite.ts`: "every allowlisted file is published byte for byte", a hidden `.DS_Store` that is not published, and `notes.md` failing the build. Build from a temp copy of the assets dir. Red-check the hidden-file case against today's `cpSync`.
- [ ] 6.3 `deploy/cloudrun/Caddyfile` and the retired `deploy/Caddyfile` pages block: add `Referrer-Policy strict-origin-when-cross-origin` to the pages `header` block. `server/test/deploy-config.suite.ts` asserts it for both. The site suite asserts that no built page has `<meta name="referrer">`.
- [ ] 6.4 `deploy-config.suite.ts` `isForbiddenProfileKey`: forbid any key containing `_LIMIT_`, and add a case where a profile setting `WHIM_BETA_LIMIT_PER_DAY` is refused. Red-check against today's prefix rule.

## 7. Runbook, decision and capability map

- [ ] 7.1 `docs/deploy.md`, Operating → Beta waitlist:
  - the new commands and CSV columns, `--updates-ok` meaning consent, fingerprints and `restore`;
  - the `origin` and `suppressed` outcomes, with a saved Cloud Logging query for `origin`;
  - the migration procedure (design §Migration Plan).

  Add a "Sending beta emails" procedure (design D10: one recipient or BCC, an identification footer from `legal-identity.json`, a stop line, 10 business days, iOS by TestFlight link with no App Store Connect upload, news only to `--updates-ok`). Make the "Tuning limits" wording agree with the #112 tripwire.
- [ ] 7.2 `docs/decisions.md`: one entry for this change (express opt-in, sticky withdrawal, unkeyed fingerprints at 730 days, the Origin rule, category surface). `docs/capabilities.md`: update the beta-waitlist, server-storage-backends and ai-data-consent lines.

## 8. Attended production rollout (not dispatched)

- [ ] 8.1 Pre-deploy, read only, against production with the owner's credentials:
  - count the rows with `whim-waitlist export | tail -n +2 | wc -l` and expect 5;
  - run `whim-admin migrate-waitlist` without `--apply` and save its output to the session scratchpad, never `~/.config/whim/`; expect 5 planned.
- [ ] 8.2 Full Cloud Run deploy from the merged `main` commit (server and pages). There is no env, DNS or resource change.
- [ ] 8.3 Smoke, trap posts only, so nothing is stored:
  - `Origin: https://evil.example` → 303 retry;
  - the pages origin → 303 thanks;
  - no `Origin` → 303 thanks.

  Also check that `/beta` carries `Referrer-Policy: strict-origin-when-cross-origin` and the `beta-2` wording, and that Cloud Logging shows outcomes `origin` and `trap` with no address.
- [ ] 8.4 Run the dry run again (expect 5 planned, or "already migrated" above 0 only when someone re-signed in the window), then `--apply`, then a dry run again (expect 0 planned). Diff the preserved fields per fingerprint prefix against 8.1's output: all equal. Count the rows again (5 plus any new signup), and list any row whose `updatedAt` falls inside the deploy window.
- [ ] 8.5 Comment on and close #109–#114 with the commit and the verification. File `ai-proposed` follow-up issues for double opt-in, dropping the `updatesOptOut` rollback shadow, and a keyed fingerprint.
