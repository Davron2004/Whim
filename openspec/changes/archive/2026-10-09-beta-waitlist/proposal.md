## Why

Whim is presented live on 2026-09-24, and neither store listing is public yet: Apple and Google both
still have review rounds to go. The stage slide carries a QR code, and it needs somewhere real to
point that stays valid after launch. The people who scan it are the first beta audience, and on
Android they are the answer to Google Play's 12-testers-for-14-days rule, which needs their Google
account emails. Signups stay on Whim's own server: no third-party form service sees them.

## What Changes

- A new page on the pages site at `https://whim.anycognition.ca/beta`: email, platform (iOS /
  Android / Other), a short notice of what is collected and why, and an opt-out checkbox for future
  update emails (unticked means updates may be sent). A plain HTML form with no JavaScript, so the
  pages site keeps serving no script.
- Static result pages the form lands on: a thank-you page, and a page for a submission the server
  refused.
- A new anonymous route on the API server, outside `/v1` (a browser has no device id), that
  validates the submission and stores it in a new SQLite file under `WHIM_DATA_DIR`. It answers
  with a redirect to a result page. A second submission with the same email updates the row and
  does not add another.
- Abuse limits that don't rely on a device id: a body cap, a per-client-address rate limit held
  only in memory, a global daily cap, and a hidden honeypot field.
- Emails never reach the logs: `email` joins the logger's redacted field names, and the route logs
  only outcome codes.
- An operator export command that prints the list as CSV, filterable by platform, so the Android
  addresses can go straight into Play's closed-testing list.
- The privacy policy gains a "beta waitlist" section (what is kept, why, for how long, how to leave
  the list), and the pages-site CSP gains `font-src 'self'` so the later design pass can use
  Whim's self-hosted brand fonts.
- The visual design of `/beta` is **not** in this change. It ships with plain, correct markup and a
  fixed form contract (field names, action URL, result pages), and a separate design pass restyles
  it later without touching the server.

## Capabilities

### New Capabilities
- `beta-waitlist`: the public `/beta` signup page and its result pages, the anonymous signup route
  with its validation and abuse limits, the waitlist store, the export command, and the waitlist's
  privacy disclosure.

### Modified Capabilities
<!-- The pages-site CSP and site-page list are specified in server-deployment, whose spec text
     still lives in the open change `public-generation-server` and is not under openspec/specs/
     (research.md, Constraints). The additions are therefore specified inside beta-waitlist; see
     design.md, "Where the pages-site additions are specified". -->

## Impact

- `server/src/app.ts` (new anonymous route), a new `server/src/waitlist/` module (store, route,
  limiter), `server/src/config.ts` (new limits), `server/src/logger.ts` (redaction list), the
  server entry point (opens the new store), a new export command under `server/`.
- `deploy/site/`: new `beta.html` and result pages; `privacy.html` and `fr/privacy.html` gain the
  waitlist section; `contract/src/disclosure-manifest.ts` gains the category if the legal-pages
  gate requires it.
- `deploy/Caddyfile`: `font-src 'self'` on the pages site.
- `docs/deploy.md`: how to export the list.
- New data on the server: email addresses, which Whim has never held before. They are covered by
  the existing daily disk snapshot.
- Nothing changes in the app or the SDK.
