## Why

The beta waitlist went live on 2026-09-24 and now holds 5 real people in production Firestore. The reviewer pass on `beta-waitlist` left six issues (#109–#114), and #109 is a CASL problem. Anyone, from any website, can re-post a person's address and clear their "don't email me" choice, or put back a person who asked to be removed. Both stores require this today, because the spec says a repeat signup replaces `updates_opt_out` and removal is a hard delete that leaves nothing behind.

Looking at #109 also shows a deeper CASL gap. The signup page asks people to tick a box to *refuse* news emails ("Unless you tick the box above, we may occasionally email you about Whim"). Under CASL an unticked opt-out box is silence, and silence is not express consent. So none of the 5 people has consented to news emails, and the page should not keep collecting signups this way. The other five issues are smaller drift between the code, the spec, the deploy rules and the privacy policy, all on the same surface. They are cheapest to fix in the same pass, before outside testers arrive.

## What Changes

- **News emails need express consent (#109, CASL).** The box becomes an unticked opt-in, "Email me news about Whim" (`updates_opt_in`). The page gets new consent wording, registered as notice `beta-2`. Each row records whether the person consented, when, and under which wording. **BREAKING** (form and CSV field): `updates_opt_out` becomes `updates_opt_in`, and `--updates-ok` now means "consented".
- **Withdrawal is sticky (#109).** Once a person's news consent is off, because they unticked the box on a later signup or the operator recorded their request, no web post can turn it back on. Only the operator can turn it back on, after a written request from that address.
- **Removed people stay removed (#109).** `whim-waitlist remove` deletes the row and keeps a one-way fingerprint of the address (the SHA-256 the Firestore doc id already uses), so a later signup with that address stores nothing. The page still shows "thanks", so the page doesn't reveal who asked to leave. Fingerprints are deleted 730 days after removal, the waitlist's published maximum. `whim-waitlist restore <email>` lifts a fingerprint on that person's written request.
- **Cross-site posts are refused (#109).** `POST /beta/signup` refuses a post whose `Origin` header is present and isn't the pages origin, including `null`. A post without `Origin` is still accepted, so curl and older clients work. The pages host sends an explicit `Referrer-Policy: strict-origin-when-cross-origin`, which keeps browsers sending the real origin.
- **The 5 existing rows move to the new model without loss.** The migration command `whim-admin migrate-waitlist` is a dry run by default, idempotent, and prints no addresses. It maps a ticked legacy opt-out to a sticky withdrawal and an unticked one to "no consent". Email, platform, notice id, `created_at` and `updated_at` are preserved, and the run is verified before and after.
- **Website-only categories leave the app's consent table (#110).** Each disclosure-manifest category declares a `surface` (`app` or `website`). `practicesFrom` skips website categories, a `/v1` route that declares one fails the static check, and the release check fails when a released version's category changes surface.
- **The spec says what the code does (#111).** It records the stricter email rule, the `errorClass` field on the `error` log line, and the build's "current notice" rule. The CSV export also neutralises spreadsheet formulas at the sink, so it no longer relies on the route alone.
- **Deploy profiles can't carry beta limits (#112).** The profile tripwire forbids any key containing `_LIMIT_`, so `WHIM_BETA_LIMIT_*` too. This matches `docs/deploy.md` and the server-deployment spec.
- **The site publishes only real assets (#113).** The site build copies `deploy/site/assets` through an extension allowlist, never copies a hidden file such as `.DS_Store`, and fails on any other file.
- **Provider rows and beta emails match what happens (#114).** The Google Cloud row covers the website signup, and the Zoho row covers the beta emails Whim sends (en/fr/ko). The runbook gets a "Sending beta emails" procedure:
  - one recipient per message, or BCC;
  - sender identification and a stop instruction in every email;
  - stop requests handled within 10 business days;
  - news only to `--updates-ok`;
  - iOS people get the TestFlight link by email, and their addresses are never uploaded to App Store Connect.
- **Privacy policy (en/fr)** describes the opt-in, sticky withdrawal and the removal fingerprint with its keep-period, and the effective dates move. The app's AI-consent version does not change.

### CASL position, stated plainly

- **Beta invitations** (Play invite, TestFlight link) are messages the person asked for by signing up. A message sent in response to a request is exempt from CASL's section 6 (Electronic Commerce Protection Regulations, SOR/2013-221, s. 3(b)). Every invitation still names AnyCognition Inc. with its mailing address and says how to leave.
- **News about Whim** is a commercial electronic message, so it needs consent. After this change that is express consent: an unticked box the person ticks, stored with the time and the exact wording, with identification and a working stop instruction in every message, and a stop handled within 10 business days. None of the 5 existing people gets news unless they tick the new box or ask in writing.
- **Residual risk:** there is no confirmation email (double opt-in), so a third party can still type someone else's address on our own page. A confirmation email needs an outbound mail service and SPF/DKIM DNS records, which this change's no-DNS and no-new-spend constraints exclude. The first email anyone gets is a solicited invitation that says why they got it and how to leave. Double opt-in is recorded as a follow-up.

### Scope decisions per issue

| Issue | Decision | Why |
|---|---|---|
| #109 | **In**, widened to express opt-in | Sticky withdrawal, a suppression fingerprint and the Origin check are what the issue asks. Opt-in is needed because the opt-out box never obtained CASL consent. Fixing stickiness on a consent model that is itself invalid would leave the CASL problem in place. |
| #110 | In | Consent data that this change already edits (the waitlist category's description). It closes a latent server permission hole, and the fix sits in the contract and the server with no app UI. |
| #111 | In (spec follows code, plus export-side formula safety) | The code's rules are safe and live, and all 5 rows passed them. The spec is wrong, not the code. Neutralising formulas in the CSV protects the place where the formula would actually run. |
| #112 | In | A test-rule fix in the deploy-config tripwire. It is the retired VM path, but the tripwire still runs in the fast gate. |
| #113 | In | Same site build this change republishes. An allowlist works without git, so it also works in temp-dir test builds and the staging assembly. |
| #114 | In | The privacy text this change already rewrites. The TestFlight rule is an operator procedure, so it goes in the runbook, with no code that could enforce it. |

Out of scope: launcher or app UI (a design-system redesign is in flight elsewhere); double opt-in (above); a reason on `/beta/retry` (the page stays generic); any GCP resource, DNS record or spend increase.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `beta-waitlist`: express news consent with sticky withdrawal, removal fingerprints, the Origin refusal and the pages host's referrer policy, the stricter email rule and the extra `error` field written down, the current-notice rule, the asset allowlist, the CSV formula guard, the operator commands (`remove` always suppresses, `updates`, `restore`), the legacy-row migration, the beta-email procedure, and the privacy policy and provider rows that describe all of it.
- `server-storage-backends`: the shared conformance suite covers the consent-state rules and suppression on all three backends; the purge deletes expired fingerprints; `import-sqlite` carries the new columns and fingerprints.
- `ai-data-consent`: the practice table holds only `app`-surface categories; categories declare a surface; a surface change on a released version fails the release check; a route declaring a website category fails the static check.

## Impact

- **Server:** `server/src/routes/beta-signup.ts`, `server/src/waitlist/{store,cli,notices}.ts`, `server/src/firestore/waitlist-store.ts`, `server/src/admin/{import-sqlite,purge}.ts` and a new `server/src/admin/migrate-waitlist.ts`, `server/src/consent-practices.ts`, `server/src/site/build.ts`.
- **Contract:** `contract/src/disclosure-manifest.ts` (`surface` on categories, the waitlist description), the snapshot reader in `scripts/release/lib/disclosure-check.ts`. Frozen snapshots are not edited.
- **Site:** `deploy/site/beta.html`, `deploy/site/privacy.html`, `deploy/site/fr/privacy.html`, `deploy/site/legal-identity.json`, and `deploy/cloudrun/Caddyfile` (one header).
- **Tests:** existing suites only (`beta-signup`, `waitlist`, `beta-site`, `web-site`, `store-conformance`, `import-sqlite`, `admin-purge`, `request-edge`, `deploy-config`, the disclosure suite, `firestore-conformance`/`firestore-import` under the emulator), plus one new migration suite. No `CONFIG_SET` file changes, so no chain is HUMAN-BOOTSTRAP.
- **Production (attended, after merge):** one Cloud Run server deploy, one migration of 5 Firestore docs (dry run, apply, verify), and one site deploy. No new GCP resources, no DNS changes, and no spend change (one extra document read per signup).
- **Docs:** `docs/deploy.md` (waitlist operations, beta-email procedure, migration), `docs/decisions.md`, `docs/capabilities.md`.

## Product-owner rulings (2026-10-09)

1. **Opt-in is approved** (unticked opt-in box; the opt-out-with-implied-consent alternative in design D1 is rejected). The 5 existing rows migrate as "no news consent" — the old unticked opt-out box never gave express consent. Beta invitations remain allowed (requested messages).
2. **Removal fingerprints are kept for 730 days**, matching the published waitlist retention maximum; a longer block would contradict published policy text.
3. **Open owner question (non-blocking):** whether anyone already asked to be removed before this change; if the owner still has such addresses they are blocked at migration time via the operator CLI. Tasks must not wait on the answer.
4. **Sticky withdrawal stands:** after withdrawal or removal, news consent comes back only through a written request to support — not by resubmitting the form — because without a confirmation email the form cannot prove the address owner is the one ticking the box.
5. **Amendment — keyed fingerprint:** the removal fingerprint MUST be HMAC-SHA-256 with a server-side key held in Secret Manager (read by the server like the OpenRouter secret; free tier), not an unkeyed SHA-256, so database read access alone cannot confirm a guessed address. Add the secret's creation to the attended rollout tasks and to `docs/deploy.md`; the key is never logged or exported.
6. **Sequencing:** this change shares files with `server-ops-hardening` (docs/deploy.md, deploy-config.suite.ts, firestore-conformance.ts); it is applied after that change merges, rebasing as needed.
7. **Key path for the keyed fingerprint (2026-10-09, after chain-2's class-B stop):** chain-2 is widened to wire the HMAC key end to end — env `WHIM_WAITLIST_FINGERPRINT_KEY` (production boot and the `whim-purge` job refuse to start without it; dev-only default outside production; the in-memory store may use a random per-instance key), mounted by `deploy/cloudrun/deploy.sh` from the Secret Manager secret named by `WHIM_WAITLIST_FINGERPRINT_SECRET` (default `whim-waitlist-fingerprint-key`) on the server and the purge job, like `OPENROUTER_API_KEY`. The secret is created before the first deploy of this code (rollout task); until then a deploy fails closed, by design. Chain-2 may make compile-only edits in chain-3/4 callers; the signup route passes `updatesOptIn: false` until chain-4. The Firestore waitlist row's document id stays an unkeyed SHA-256; only the removal fingerprint is keyed.

8. **Owner answer to ruling 3's question (2026-10-09):** nobody asked to be removed before this change, so the migration blocks no addresses.
