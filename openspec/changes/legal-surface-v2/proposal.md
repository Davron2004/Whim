## Why

Whim's consent screen, privacy policy, store declarations and listings were an unreviewed AI draft (#63). Two of the store answers are false today ("not linked"). The lifetime `usage` table keeps a row per phone ID forever, against the text. The screen ties a promise to one vendor, and the v1 re-ask rule would force a re-ask for one new diagnostic field. The research is done (`research.md` points at `docs/research/legal-surface-2026-09/README.md`), and the owner answered its seven launch decisions on 2026-09-23. The new text has to land before public launch, because each thing it sets is something every user agrees to. It also has to land before `developer-observability` ships diagnostics (its chains 4 and 5 wait on it).

## What Changes

- **Disclosure manifest and re-consent rule.** A checked-in, typed manifest (version 1 baseline, version 2) lists categories, recipient roles, purposes, keep-period maximums, defaults, core promises and the store mapping. `AI_CONSENT_VERSION` moves only when the manifest widens, and a release check on every app build and server deploy enforces it. `request-envelope`'s server consent-practices table is derived from the manifest, so the server can't apply a practice a request's grant doesn't cover.
- **Consent screen v2** (`AI_CONSENT_VERSION` 1 → 2). The screen names recipients by role, not vendor. It states the three core promises (owner decision 1), names error details and the app-integrity check, and derives its "what's new" line from the manifest diff. **BREAKING** for testers holding a v1 grant: they're asked once more.
- **Terms of use** at `/terms` under Ontario law (decision 5), with a separate "Accept" step right before the consent screen, versioned apart from the consent version.
- **Privacy policy v2** at `/privacy`. It covers who we are, the Privacy Officer, a "Who handles it right now" provider list kept outside the manifest, legal bases, rights, transfers, security, Do Not Track, children and the change log. Because every storefront stays open (decision 2), it also carries the EU/UK sections with representative contacts and a Korean-language overseas-transfer section. Pages ship with no unfilled placeholder.
- **French** (decision 4): French terms, terms step, consent screen and policy. French shows first when the phone's language is French, with an express choice of English.
- **Store declarations** (B6): every type is declared Linked, with usage records and error details added. App Privacy, Data safety, the iOS privacy manifest and `answers.md` follow the manifest's store mapping. The release check stops refusing "linked" and starts checking agreement with the manifest. Listings and App Review notes are replaced (4.7.4 and 4.7.5 answers included).
- **Settings** (B4, note 7): a "Send error details" switch (on by default) and "This phone's ID" with "Make a new ID". The server-address override leaves release builds.
- **Report sheet**: it becomes the at-collection notice for reports, with a random-ID line, a privacy policy link and no "we read every report" promise.
- **Server records by phone ID** (B8): the lifetime `usage` table records when each row was last credited and purges rows idle for 12 months. `whim-admin device export|delete <id>` covers every record keyed by device ID. The deploy check refuses a configured keep-period above its published maximum.
- **Store age signals** (note 18, Texas SB 2420): Apple Declared Age Range and Play Age Signals. The result stays on the phone and gates AI features for minors without the store's parental approval.
- **`developer-observability` amended in this PR** (B6, B9, B4): diagnostics are declared Linked. A mini-app error name maps onto a closed set of built-in names, with `Other` for anything else. Uploads also need the error-details switch.
- **Docs and attended work:** a breach runbook and breach log, drafts of the Quebec s.17 assessment and the UK Children's Code DPIA, and a post-launch lawyer brief (decision 7: no lawyer before launch; declined by the owner 2026-09-24 — the brief was deleted, no lawyer will ever be engaged). The owner does the store-console steps, the OpenRouter account setting, the mailbox, the identity values, the EU/UK representatives (declined by the owner 2026-09-24), the Texas §121.053 store notice, the fluent French and Korean checks (declined by the owner 2026-09-24 — AI-drafted text is final), and the on-device network-deny runs (B7).
- **Not here:** B10, the consent-version header and server enforcement, which `request-envelope` already adds. This change only fills its table.

## Capabilities

### New Capabilities
- `terms-acceptance`: the in-app terms step before the consent screen, its versioned acceptance, and its place in the send gate.
- `legal-pages`: the published privacy policy and terms pages (English, French, Korean transfer section), their required sections, and the no-placeholder rule.
- `legal-text-localization`: French-first legal text for French-language phones with an express English choice, for the terms step, the consent screen and the pages.
- `store-privacy-declarations`: App Privacy, Data safety, the iOS privacy manifest, `answers.md`, the listings' privacy lines and the review notes, all derived from and checked against the manifest.
- `privacy-settings`: the error-details switch, the phone-ID row with reset, and no server-address override in release builds.
- `device-records`: keep-periods and export/delete for every server record keyed by a phone ID, and configured keep-periods capped by the manifest.
- `store-age-signals`: reading the store's age signal on the phone and gating AI features for minors, with nothing about age leaving the phone.

### Modified Capabilities
- `ai-data-consent` (base spec lives in the unarchived `store-launch-compliance`; archive order below): the disclosure requirement changes from naming OpenRouter to the v2 categories and roles; grant versioning gains the manifest-derived "what's new" line; adds the re-consent rule and the manifest-derived server practices.
- `content-reporting` (base also in `store-launch-compliance`): the report preview's ID line drops "anonymous", and the thank-you state drops "we read every report".
- `app-launcher` (current text from `store-launch-compliance`): the server-address override exists only in internal builds; Settings sections gain the error-details switch, the terms link and the phone-ID row.

## Impact

- **App:** `src/host/launcher/` (`copy.ts`, `ConsentScreen.tsx`, the consent flow, `SettingsScreen.tsx`, `device-id.ts`, `release-config.ts`, the report sheet, a new terms step, a language choice), plus a small native age-signal module on iOS and Android.
- **Server:** `server/src/consent-practices.ts` (from `request-envelope`), `usage-store.ts`, `admin/cli.ts`, retention config checks, and `deploy/` checks.
- **Shared:** a zod-free manifest module in `contract/`, imported by the server and the release scripts, never by Metro at runtime.
- **Site and store:** `deploy/site/` (`privacy.html`, new `terms.html`, French pages), `release/store/**`, `ios/Whim/PrivacyInfo.xcprivacy`, `docs/store/review-notes.md`, and `scripts/release/lib/store-listing.ts` with its suite.
- **Other changes:** `developer-observability`'s spec, design, tasks and chains are edited in this PR. Archive order: `store-launch-compliance` (#69) before `legal-surface-v2`.
- **Ordering:** `request-envelope` is applied first, and the server's version-2 practices deploy before any app build that asks for version 2. The v2 saved-data copy doesn't ship until `platform-release-readiness` 13.6 and 13.7 pass (B7).
