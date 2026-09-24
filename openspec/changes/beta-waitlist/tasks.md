## 1. Store and notice registry

- [ ] 1.1 Add the notice registry (notice id → sha256 of the normalized `data-notice` text) in a module both the server and the site build import, with the function that normalizes and hashes text
- [ ] 1.2 Add `server/src/waitlist/store.ts`: `WaitlistStore` interface, `NodeSqliteWaitlistStore` (`waitlist.db`: WAL, `secure_delete`, `busy_timeout`, `CREATE TABLE IF NOT EXISTS`), `InMemoryWaitlistStore` twin; upsert by normalized email keeping `created_at`; `export(filter)`, `remove(email)`, `purge(now)` at 730 days after `updated_at`
- [ ] 1.3 Store suite: round-trip, normalization, repeat-signup update, export filters, removal in any casing, purge boundary; run against both implementations; wire into `server/test/acceptance.ts`

## 2. Signup route and limits

- [ ] 2.1 Add config entries `WHIM_MAX_BODY_BYTES_BETA` (4096), `WHIM_BETA_LIMIT_PER_CLIENT_HOUR` (10), `WHIM_BETA_LIMIT_PER_DAY` (2000), and the pages-site origin the redirects target; cover them in `config.suite.ts`
- [ ] 2.2 Add the in-memory limiter: salted-hash client key from `X-Forwarded-For`, per-client sliding hour window, global daily count
- [ ] 2.3 Add `POST /beta/signup` on the root app outside `/v1`: body cap → trap → validation → limits → upsert with the current notice id → 303 to thanks or retry; log only outcome code and request id
- [ ] 2.4 Add `email` to `SENSITIVE_FIELD_NAMES`
- [ ] 2.5 Open `waitlist.db` in `startServer`'s stores step, close it on shutdown, schedule its purge, and pass it to `createApp`
- [ ] 2.6 Route suite: every spec scenario of "Signup route", "Abuse limits" and "Emails never logged" against `createApp()` with the in-memory store and captured logs, including that `/v1/*` still refuses without `x-whim-device`

## 3. Operator command

- [ ] 3.1 Add `server/waitlist.mjs` with `export [--platform ios|android|other] [--updates-ok]` (CSV to stdout) and `remove <email>`, opening `waitlist.db` under `WHIM_DATA_DIR`; test it against a temp data dir
- [ ] 3.2 Document running it on the VM in `docs/deploy.md` under "Operating", including the Android export for Play closed testing

## 4. Pages site

- [ ] 4.1 The designed pages are given: `deploy/site/beta.html`, `beta-thanks.html`, `beta-retry.html` and `deploy/site/assets/fonts/**` came from the design pass (see design-brief.md) and already meet its locked contract. Don't restyle or reword them. If wiring needs a change to them, make the smallest edit that keeps the look and list it in progress.md
- [ ] 4.2 Add the pages to the build's page list, add the required `WHIM_BETA_SIGNUP_URL` placeholder, copy `deploy/site/assets/**` into the output, and fail the build on an unregistered `data-notice` wording
- [ ] 4.3 `deploy/Caddyfile`: `handle` blocks for `/beta`, `/beta/thanks`, `/beta/retry` and `/assets/*`; add `font-src 'self'` to the pages CSP; `deploy/deploy.sh`: derive `WHIM_BETA_SIGNUP_URL` from the API host
- [ ] 4.4 Site suites: form contract, no script anywhere, notice fingerprint (a changed wording fails, a registered one passes), assets copied, Caddy routes and CSP pinned in `deploy-config.suite.ts`

## 5. Privacy policy

- [ ] 5.1 Disclose the waitlist as its own website-only category in `privacy.html` and `fr/privacy.html` (data, purpose, 730-day `data-keep`, how to leave the list) per `docs/legal/change-process.md`, with the manifest change it needs; stop and report if it would move the app's AI-consent version
- [ ] 5.2 Build the site, serve it with the production pages CSP, and screenshot `/beta` (with Android selected, and with an invalid email), `/beta/thanks` and `/beta/retry` at 375px and 1280px: fonts load, zero CSP violations in the console, no horizontal scroll
- [ ] 5.3 Run `scripts/gate-full.sh`; fix anything it finds
