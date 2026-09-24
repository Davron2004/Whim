## Context

The pages site is static files that Caddy serves with a script-free CSP. The API is a separate
Hono app behind Caddy on `api.<web host>`, and every `/v1/*` route is device-gated by construction
(research.md, "Current behavior" Q1–Q2). Server data lives in one SQLite file per concern under
`WHIM_DATA_DIR`, covered by a daily disk snapshot (Q3). Rate limits today are keyed by device id,
which a browser doesn't have (Q4). The privacy policy says "we don't know who you are" and covers
the website (Q5). Emails are a new kind of data for Whim.

The page's visual design is a separate pass with its own brief (`design-brief.md`). This change
owns everything around it, and fixes the form contract that brief locks.

## Goals / Non-Goals

**Goals:**
- A QR scan becomes a stored signup in about ten seconds, with no JavaScript on the page.
- The signup route can't be used to flood the store or the logs, and emails never reach the logs.
- Each stored signup records which consent wording its author saw.
- The operator can export the list (Android addresses for Play closed testing) and remove a person
  on request.
- The privacy policy truthfully covers the new data, without moving the app's consent version.

**Non-Goals:**
- The page's visual design (design-brief.md).
- Sending any email. The list is exported, and sending happens outside Whim.
- Accounts, double opt-in and unsubscribe links. There's no mail pipeline to attach them to yet.
- Changing any `/v1` route or the app.

## Decisions

**1. A native form POST to an anonymous route on the API app, answered with a 303 redirect.**
The page posts `application/x-www-form-urlencoded` to `POST /beta/signup` on the API host, which
answers `303 See Other` to `/beta/thanks` or `/beta/retry` on the pages host. `form-action` is
absent from the pages CSP and doesn't fall back to `default-src`, so the post is allowed. A
top-level form navigation needs no CORS, and the page stays script-free.
*Alternatives:* a `fetch()` from the page (needs a script, so a CSP change on every page); a
reverse proxy from the pages host (the pages-site spec forbids one, research.md Constraints); a
third-party form service (the owner ruled it out).

**2. Outside `/v1`, registered on the root app like `/healthz`.** `/v1` stays device-gated by
construction (research.md Constraints). The route has its own body limit and doesn't pass through
the device, envelope or minimum-build middlewares.

**3. Abuse limits that need no identity.** In order: a small body cap (`WHIM_MAX_BODY_BYTES_BETA`,
default 4 KiB); the honeypot (a filled `company` field gets a thanks redirect and stores nothing, so
bots learn nothing); a per-client sliding-window limit (`WHIM_BETA_LIMIT_PER_CLIENT_HOUR`, default
10); a global daily cap (`WHIM_BETA_LIMIT_PER_DAY`, default 2000). The client key is the
`X-Forwarded-For` value Caddy sets. Caddy replaces client-supplied forwarding headers from
untrusted peers, so the value is the real peer address. It is hashed with a per-process random
salt and held only in memory. It is never stored or logged, which keeps the "no access logs"
stance. A refused request redirects to `/beta/retry`.
*Alternative:* reusing `usageStore.admit`, which is keyed by device id and has nothing to key on
here.

**4. Its own store, `waitlist.db`.** It follows the reports store's shape: `DatabaseSync`, WAL,
`secure_delete`, `CREATE TABLE IF NOT EXISTS`, an in-memory twin for tests, and an hourly purge. It
has one row per normalized email (trimmed, lowercased), with columns platform
(`ios|android|other`), `updates_opt_out`, `notice_id`, `created_at` and `updated_at`. A repeat
signup updates platform, opt-out, notice and `updated_at`, and keeps `created_at`, so a person can
change their answers by signing up again. Rows are purged 730 days after `updated_at`, and that
retention is published in the privacy policy.

**5. Consent evidence by fingerprint.** The consent line and the opt-out label carry `data-notice`.
At build time the site build normalizes their text (whitespace collapsed), hashes it, and looks the
hash up in a closed registry of notice ids in code (for example `beta-1 → sha256`). An unregistered
wording fails the build, fail-closed like the legal pages (research.md Q1). The registry is shared
with the server, which stores the current `notice_id` with each signup. Changing the wording means
registering a new id, and old rows keep the id their author saw.
*Alternative:* storing a boolean alone, which can't show what was agreed to.

**6. Opt-out, as the owner asked.** The checkbox is unchecked by default and records an opt-out.
The notice says occasional Whim emails may follow. Under CASL this is implied consent from an
inquiry, good for 6 months after each signup, not express consent. The export marks each row's
signup date so the sender can tell. If the owner flips it to an opt-in, only the label, the column meaning and the notice change;
nothing else in this design moves.

**7. Emails stay out of logs.** `email` joins `SENSITIVE_FIELD_NAMES`. The route logs only an
outcome code (`stored`, `updated`, `invalid`, `limited`, `trap`) and a request id: no email, no
platform, no client key.

**8. Operator commands, not an admin route.** A `server/waitlist.mjs` CLI prints CSV (`export
[--platform ios|android|other] [--updates-ok]`) and removes a person (`remove <email>`). It runs on
the VM next to the data file. No HTTP route exposes the list.

**9. Site wiring.** Pages are flat files (`beta.html`, `beta-thanks.html`, `beta-retry.html`) with
explicit Caddy `handle` blocks for `/beta`, `/beta/thanks` and `/beta/retry` (research.md Q1). The
pages join the build's closed page list. A new required placeholder, `WHIM_BETA_SIGNUP_URL`, is
derived in `deploy.sh` from the API host. The build copies `deploy/site/assets/**`, which Caddy
serves at `/assets/*`. The pages CSP gains `font-src 'self'`.

**Where the pages-site additions are specified.** The server-deployment spec text still lives in the
open change `public-generation-server`, not under `openspec/specs/` (research.md Constraints). A
delta against it can't be archived cleanly yet, so this change specifies its own pages-site
additions (the routes, `font-src 'self'`, the assets path) inside `beta-waitlist`. When
`public-generation-server` archives, its CSP requirement must include `font-src 'self'`.

**10. The privacy disclosure doesn't move the app consent version.** The waitlist is website-only
data that the app never sends. Following docs/legal/change-process.md (the "own opt-in" doctrine,
research.md Q5), it's added as its own category with its own section in `privacy.html` and
`fr/privacy.html`. It has a `data-keep` row of 730 days, and the app's AI-consent version stays
unchanged. If the manifest mechanics make that impossible without a version bump, the implementer
stops and reports rather than bumping.

## Risks / Trade-offs

- [The talk is 2026-09-24; if this isn't deployed, the QR lands on a 404] → The URL is fixed
  independently of the implementation, so the slide can be rendered now. Deploy is the critical
  path.
- [A shared client address (bar Wi-Fi NAT) hits the per-client limit] → 10 per hour per address,
  and a refusal lands on a retry page instead of failing silently. Raise it by env on the night if
  needed.
- [Honeypot-only bot defence] → Enough at this scale. The global daily cap bounds the worst case.
- [In-memory limiter resets on restart] → Acceptable: it's a flood brake, not an audit trail.
- [Wording drift between page and registry] → The build fails closed, so it can't silently drift.

## Migration Plan

This is additive: a new SQLite file created on first boot, new pages and new Caddy routes. Deploy
with `deploy/deploy.sh`, both server and site, since the site needs the new placeholder. Rollback
is the previous release. `waitlist.db` stays on disk untouched.

## Open Questions

- Retention of 730 days is a proposed default. The owner may choose another number, and only the
  constant and the policy row change.
