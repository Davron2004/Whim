## Context

The waitlist is a static, script-free `/beta` page on the pages service (`whim-site`). Its form posts cross-origin to `POST /beta/signup` on `whim-server`, which writes to one of three `WaitlistStore` backends. Production uses Firestore: collection `waitlist`, doc id = hex SHA-256 of the normalized email, `email` kept in clear for export (research.md §A.2). Every backend replaces `updatesOptOut` on a repeat signup. `remove` is a hard delete that leaves nothing behind, and the route reads neither `Origin` nor `Referer` (§A.1–A.3). The page asks people to tick "Don't email me about Whim updates", and the policy says "Unless you ticked the box, we may also email you now and then about Whim" (§A.7). Five real people are in production Firestore. The only backup is the owner's local copy under `~/.config/whim/`, which no task may read or write.

The other issues are drift on the same surface:
- **#110:** `practicesFrom` maps every manifest category to a practice, including the website-only `waitlist`, which the release check doesn't flag because a user-act category never widens (§B #110).
- **#111:** spec text lags the code (§A.5).
- **#112:** the profile tripwire's `WHIM_LIMIT_` prefix misses `WHIM_BETA_LIMIT_*` (§B #112).
- **#113:** `fs.cpSync` publishes ignored files (§B #113).
- **#114:** the provider rows don't cover the website or the beta emails (§B #114).

Constraints:
- No GCP spend increase and no DNS change.
- No launcher or app UI.
- Production data changes are idempotent, run as a dry run first, and are verified against the 5 rows.
- The AI-consent version must not move.
- No `CONFIG_SET` file is edited (§B Constraints).

## Goals / Non-Goals

**Goals:**
- Collect news consent in a way CASL recognises, keep proof of it, and make a withdrawal or a removal impossible to undo from the web.
- Refuse signups that a third-party site posts through a visitor's browser.
- Move the 5 existing rows to the new model with nothing lost and the move verified.
- Make the spec, the deploy tripwire, the site build and the privacy text describe what actually happens.

**Non-Goals:**
- Double opt-in. It needs an outbound mail service and SPF/DKIM records, which the no-DNS and no-spend constraints rule out. It is recorded as a follow-up.
- A reason line on `/beta/retry`.
- A keyed (HMAC) fingerprint. It needs a new secret, see D3.
- Any launcher, app or store-listing change.

## Decisions

### D1. News emails move from opt-out to express opt-in
The box becomes `updates_opt_in`, unticked, labelled "Email me news about Whim". The consent line is reworded to: "We keep your email and phone type to invite you to the beta. We email you news about Whim only if you tick the box above, and every email says how to stop. Leave the list by writing to {{WHIM_SUPPORT_EMAIL}}. Read our privacy policy." It is registered as notice `beta-2`. The "Other" platform hint is reworded to point at the box, but it is not a notice element.

Why: CASL needs consent for commercial electronic messages. Express consent needs a positive act, and an unticked opt-out box is silence. The fallback is implied consent through an "existing business relationship", which covers an inquiry about *purchasing or leasing* a product or service within the last 6 months. A free beta signup is a weak fit, and that consent would expire. Beta invitations themselves are solicited, so they are exempt from section 6 (proposal §CASL position).

Alternatives:
- (a) A sticky opt-out only, as #109 suggested. This keeps a consent basis that doesn't exist.
- (b) Keep the opt-out and enforce a 6-month implied-consent window in the export. This rests on the weak business-relationship argument, adds time-dependent export logic, and still expires.

### D2. A row's news-consent state, and the transition rules
Each row gains:
- `updatesOptIn` (boolean);
- `updatesConsentAt` (ms, or null);
- `updatesConsentNoticeId` (a notice id, `written-request`, or null);
- `updatesWithdrawnAt` (ms, or null).

The web-signup transitions are the five rules in the beta-waitlist spec ("News emails need express consent…"). A withdrawal sets `updatesWithdrawnAt`, and while it is set no web signup changes consent. `updates <email> on` is the only way back: it clears the withdrawal and records `written-request`. An unticked re-post after consent counts as a withdrawal. That is the safe direction, matching the `MAX` that #109 suggested. The cost is that a person who re-submits only to change platform, and forgets the box, must write to get news back.

Rollback shadow: every write also sets the legacy field `updatesOptOut` (SQLite column `updates_opt_out`) to `!updatesOptIn`. A rolled-back server revision then exports exactly the consented rows as "updates OK", and never more. The new code never reads the shadow once `updatesOptIn` exists. Dropping it is a follow-up once this revision has been stable for a release.

### D3. Removal fingerprints
Removal writes `waitlistSuppressed/{waitlistDocId(email)}` with `{ suppressedAt }` in Firestore, a `waitlist_suppressed(fingerprint PRIMARY KEY, suppressed_at)` table in SQLite, and a map entry in memory. The fingerprint is the same SHA-256 hex the Firestore doc id already uses.
- **Firestore:** one transaction does the delete and the create on `remove`, and the upsert transaction reads the fingerprint doc with the row. So a race resolves to "removed", never to "row plus fingerprint" (server-storage-backends delta). A suppressed signup returns outcome `suppressed`, and the route answers `/beta/thanks`, so the page never reveals who asked to leave.
- **`remove`:** always keeps the fingerprint, exits 0, and says whether a row existed. A person may ask never to be added.
- **`restore <email>`:** deletes the fingerprint. The runbook allows it only on that person's written request.
- **Retention:** fingerprints are deleted 730 days after `suppressedAt`, in the same purge pass, because the waitlist category's published maximum is 730 days. Keeping them forever would lengthen a published keep-period.

The fingerprint is unkeyed. A pepper would need a new Secret Manager secret, a possible cost above the free tier, and a rotation story that breaks every existing fingerprint. Anyone holding the database can confirm a guessed address against a fingerprint, but that person already sees every active row's address in clear. The policy says "a one-way fingerprint", which is accurate.

### D4. Origin refusal and the pages referrer policy
In `beta-signup.ts` the check runs after the body cap and before the content-type check: if `Origin` is present and not exactly `config.webOrigin`, the post is refused with outcome `origin` and a 303 to retry. `null` counts as present.
- **Why before the trap:** a smoke post can then prove the check with a trap post that stores nothing.
- **Why an absent `Origin` is accepted:** every current browser sends `Origin` on a cross-origin POST. A script without a browser is not the threat here. That threat is a hostile page making a visitor's browser post, and the abuse limits cover scripts.
- **Referrer policy:** under `no-referrer` or `same-origin`, a browser serializes the form post's `Origin` as `null`. The pages site block in `deploy/cloudrun/Caddyfile`, and in the retired `deploy/Caddyfile` so a return to the VM keeps it, therefore sets `Referrer-Policy: strict-origin-when-cross-origin` explicitly. The deploy-config suite asserts the header, and the site suite asserts that no page sets a `<meta name="referrer">`.
- **Rejected alternatives:** `Sec-Fetch-Site`, which older Safari doesn't send; a CSRF token, which needs server-rendered pages and the pages are static.

### D5. Legacy rows: tolerant reads plus an explicit migration
- **Reading legacy rows:** a row without `updatesOptIn` is legacy. Every backend maps it on read as follows:
  - opt-out ticked: no consent, `updatesWithdrawnAt = updatedAt`;
  - opt-out unticked: no consent, no withdrawal.

  The first write rewrites the row in the new shape.
- **SQLite:** migrates on open. In one transaction it adds the new columns when they are missing and converts the legacy rows. It is idempotent, and it never drops `updates_opt_out`, the D2 shadow. `import-sqlite` therefore reads either file shape.
- **`whim-admin migrate-waitlist [--apply]`:** walks the configured backend and rewrites only legacy rows, each in its own transaction that re-checks it is still legacy.
  - Per row it prints the first 12 hex characters of the fingerprint, `platform`, `noticeId`, `createdAt`, `updatedAt` and the planned consent fields.
  - It then prints the totals: migrated or planned, already migrated, and total.
  - It never prints an address, and without `--apply` it writes nothing.
- **Why both:** the tolerant read makes the deploy window and any old SQLite file correct, and the migration makes production uniform and verifiable. The tolerant read stays as a guard; it is a few lines.

### D6. Category surface (#110)
`DisclosureCategory` gains a required `surface: 'app' | 'website'`. Every existing category is `app`; `waitlist` is `website`. The rest:
- `practicesFrom` filters to `app`, and the "never gains a category" comment is rewritten to state the real invariant: a version's practices never gain a main-grant category or any website category.
- The snapshot reader treats an absent `surface` as `app`. Frozen snapshots are not edited.
- The release check gains one finding: a category whose surface differs between a released version's snapshot and its live manifest.
- The route static check refuses a route whose declared category is `website`.
- `request-edge.suite.ts` drops `waitlist` from its version-2 expectation and adds a forged-manifest case: a website category under version 1 is not permitted.
- The waitlist category's row description changes from "updates opt-out" to "news consent and its record, and the fingerprint of an address removed from the list". The category is absent from both frozen snapshots and is not main-grant, so nothing widens and the consent version stays.

Alternative: the issue's literal "notice any new category under a released version". This contradicts ai-data-consent, which lets a non-widening user-act or own-opt-in category join the current version.

### D7. Spec follows code for the email rule; formulas neutralised at the sink (#111)
The validator stays as it is, and the spec now states it. `csvCell` prefixes `'` to any cell that starts with `= + - @ | %`, a tab or a CR, before quoting. This guards the place where a formula would run, against rows that reach the store by import or by a future validator change. The `error` line's `errorClass` and the build's current-notice rule are written into the spec unchanged.

### D8. Asset allowlist (#113)
`build.ts` replaces `cpSync` with a walk over `deploy/site/assets` that works as follows:
- it skips any entry whose name starts with `.`, at any depth;
- it copies files with extension `.woff2`, `.txt` (font licences), `.svg`, `.png`, `.ico` or `.webp`;
- it throws a build error naming any other file.

`beta-site.suite.ts`'s "every file is published byte for byte" becomes "every allowlisted file", plus the two new scenarios, built from a temp copy of the assets dir.

Alternative: `git ls-files`. Test builds and the staging assembly don't always run inside a git checkout, and a new font would be dropped silently until it was committed.

### D9. Profile tripwire (#112)
`isForbiddenProfileKey` forbids any key containing `_LIMIT_`, not just keys starting with `WHIM_LIMIT_`. This matches the spec ("sets no daily limit") and `docs/deploy.md` ("operator values"). No profile sets one today, so nothing else changes.

### D10. Provider rows and the beta-email procedure (#114)
`legal-identity.json` changes:
- **Google Cloud `receives`:** "Everything the app sends, and what you give on our website's beta sign-up page".
- **Zoho `receives`:** "What you write to us by email, and anything you include, such as your phone ID, and the beta invitations and news we email you".

Both get fr and ko translations, written here: per the owner, AI translations are final. `effectiveDates.privacy` and `providerList` move to the release date.

`docs/deploy.md` "Beta waitlist" gains a "Sending beta emails" procedure:
- send from the support mailbox, one recipient per message or in BCC;
- every email carries an identification footer (AnyCognition Inc., the street address and locality from `legal-identity.json`, and the support address) and a stop line;
- Android: Play closed-testing list;
- iOS: the TestFlight public link by email, and never an App Store Connect tester upload;
- news: `--updates-ok` only;
- stop and removal requests are handled with the operator command within 10 business days.

## Risks / Trade-offs

- [The two services switch revisions a few minutes apart during the full deploy, so a signup in that window can record the other page's notice id] → One full deploy ships both. Signups run at about 5 in two weeks. The post-deploy check lists any row with `updatedAt` inside the window, so the operator can see it.
- [A privacy tool that rewrites `Origin` to `null` turns a genuine signup into a retry] → It is rare. `origin` outcomes are countable in Cloud Logging, and the runbook names the saved query.
- [A third party can still sign someone up on our own page (no double opt-in)] → The first email is a solicited invitation that says why it was sent and how to leave. Double opt-in is a recorded follow-up.
- [Unkeyed fingerprints can be dictionary-checked by someone holding the database] → That person already holds active rows in clear. Keying is a follow-up if a secret is ever free to add.
- [A rollback after the migration] → The D2 shadow keeps a rolled-back revision's `--updates-ok` export correct. The tolerant read keeps the new revision correct over either shape.
- [File overlap with the in-flight `server-ops-hardening` (`docs/deploy.md`, `deploy-config.suite.ts`, `firestore-conformance.ts`, `deploy/cloudrun/*`)] → Run the two changes as separate runs. Whichever lands second rebases its staging branch. The Cloud Run smoke from that change posts a trap signup without `Origin`, which this change still accepts.
- [An unticked re-post withdraws news consent for good] → The rule is deliberate, stated on the policy page, and reversible on a written request.

## Migration Plan

All attended, by the orchestrator with the owner's credentials, after the run's merge into `main` (tasks §8):
1. **Pre-deploy, read only.** Count the rows (`whim-waitlist export | tail -n +2 | wc -l`, piped so no address is shown) and expect 5. Run `whim-admin migrate-waitlist` (dry run) against production and save its output to the session scratchpad, never to `~/.config/whim/`. Expect 5 planned.
2. **Full Cloud Run deploy** (server and pages) from the merged commit.
3. **Post-deploy smoke**, all trap posts, so nothing is stored:
   - `Origin: https://evil.example` → retry;
   - the pages origin → thanks;
   - no `Origin` → thanks;
   - `/beta` carries `Referrer-Policy` and notice `beta-2`.
4. **Dry run again.** Expect 5 planned, or fewer only when a person re-signed in the window, in which case "already migrated" is above 0 and the total is still at least 5.
5. **Migrate:** `--apply`, then a dry run. Expect 0 planned and every row already migrated. Diff the preserved fields per fingerprint prefix against step 1's output: all equal. Count rows again: still 5, plus any new signup visible in the window listing.
6. **Rollback.** The previous revision is safe over migrated rows (D2 shadow). No data rollback is needed, and the step-1 output records each row's legacy state if one is ever wanted.

## Open Questions

1. Is the opt-in switch (D1) approved? The alternative, a sticky opt-out under a 6-month implied-consent window, is written up in D1. The tasks assume opt-in.
2. Fingerprint retention is 730 days after removal (D3). Should a removed address stay blocked for as long as the waitlist runs instead? That would need a new published keep-period.
3. Has anyone already asked to leave? Their rows were hard-deleted. If the owner still has those addresses, `remove` can fingerprint them now (no row needed).
4. Is it acceptable that an unticked re-post withdraws news consent for good (D2)?
