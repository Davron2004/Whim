Text sources: `docs/research/legal-surface-2026-09/draft-copy.md` (§1 consent, terms step, Settings and report; §2 policy; §3 listings; §4 declarations; §5 review notes; §6 terms), with the owner decisions recorded at the top of `README.md`. Drop every `[B…]`/`[D…]` marker when landing text; keep bracketed subscription and sync text out.

## 1. Disclosure manifest and re-consent check

- [x] 1.1 Write `contract/src/disclosure-manifest.ts` (zod-free, design D1): the types, `MANIFESTS[1]` (the v1 disclosure: request material, the phone ID, usage records, connection logs, reports, with v1's 90-day bounds) and `MANIFESTS[2]` (README "Manifest, version 2", owner decisions applied), category ids per D2, the store mapping per README "Store mapping", roles with screen-named flags, purposes, allowed triples, core promises, and an empty `BUMP_REASONS`.
- [x] 1.2 Implement `diffManifests(from, to)` returning stable widening ids for each clause of spec ai-data-consent §"The consent version changes only when the disclosure manifest widens". Node-suite cases on fixture manifests cover every scenario of that requirement, plus the non-widening list (provider switch, in-category field, shorter keep-period, narrowing, own-opt-in category).
- [x] 1.3 Implement the release check (D3): `AI_CONSENT_VERSION` equals the highest manifest key; released versions only narrow against `contract/disclosure/released/v<N>.json`; consecutive versions widen or carry a reason; what's-new copy `covers` equals the diff for every older version in every language table present. Check in the v1 and v2 snapshots. Red-check each failure mode (edit a released version, bump with nothing new, what's-new missing a widening).
- [x] 1.4 Set `AI_CONSENT_VERSION` to 2 in `release-config.ts` (its comment becomes a pointer to the rule), and add `consentWhatsNew[1]` to the English copy table with draft-copy §1's text and its `covers` list, so the check passes.
- [x] 1.5 Derive `PRACTICES` in `server/src/consent-practices.ts` from `MANIFESTS` (spec ai-data-consent §"The server's consent practices are derived from the manifest"). Version 1 gains `phone-id`. Keep `request-envelope`'s `permits` suite green and add the version-2 scenarios.
- [x] 1.6 Run the check in the gate (through `checks/test/acceptance.ts`, with no `gate.sh` edit), in the release preflight under `scripts/release/`, and in `deploy/deploy.sh` before anything is pushed.

## 2. Server records by phone ID

- [ ] 2.1 `usage-store.ts`: add `last_credited_day` with an idempotent migration that backfills the run day, set it on every `credit`, and purge rows idle longer than `WHIM_USAGE_IDLE_DAYS` (default 365) in the existing daily purge path. Tests for each scenario of spec device-records §"Every server record keyed by a phone ID has a keep-period".
- [ ] 2.2 Server config parsing refuses at startup any keep-period env value above its category's maximum in the current manifest: reports, ledger, usage idle, and log retention the server controls. Tests for §"A configured keep-period never exceeds its published maximum".
- [ ] 2.3 `deploy/deploy.sh` runs the same parse against the deploy environment and fails on the same condition. Red-check with an over-long value.
- [ ] 2.4 `whim-admin device export <id>` and `device delete <id>` in `server/src/admin/cli.ts`, covering reports, ledger rows and the usage row. Tests for §"The operator can export and delete one phone ID's records", including idempotence and an unknown ID.

## 3. Consent screen v2 and the report sheet

- [x] 3.1 Replace the consent keys in `copy.ts` with draft-copy §1 (typographic apostrophes; review-mode keys unchanged), and delete the v1 keys.
- [x] 3.2 `ConsentScreen.tsx` renders the sections in the order of spec ai-data-consent §"The disclosure names what is sent…", and shows the outdated line plus `consentWhatsNew[grant.version].text` when the grant is outdated. The privacy link uses the active legal language's URL; the language hook can return English until task 6.1.
- [x] 3.3 Add the screen coverage check (D4) to the gate. Every screen category and screen-named role in the current manifest has a non-empty copy key in every language table. No consent or report string contains "OpenRouter" or "anonymous". Red-check by deleting the app-integrity sentence.
- [x] 3.4 Report sheet: `reportDeviceIdLine` replaces `reportAnonIdLine`, and `reportThanksTitle` becomes draft-copy's line. Tests for spec content-reporting §"The sheet previews exactly the body that Send transmits".
- [x] 3.5 Update `ai-consent.suite.ts` and `consent-gate-ui.suite.tsx` for version 2, including the version-1-grant scenario with its what's-new line.

## 4. Terms step

- [ ] 4.1 `release-config.ts`: `TERMS_VERSION = 1` and `RELEASE.termsUrl` (with French twins for both legal URLs). Add a non-RN terms-acceptance module for `whim.terms:v1` that fails closed. Tests for spec terms-acceptance §"Terms acceptance is versioned apart from consent".
- [ ] 4.2 Add the terms step screen and the terms copy keys from draft-copy §1. Wire the flow: data-sending action → terms (if not current) → consent (if not current) → the started action. Tests for each scenario of §"Terms are accepted in their own step before the consent screen".
- [ ] 4.3 The request gate yields options only with both a current acceptance and a current grant, and reports stay exempt. Tests for §"The send gate requires both a terms acceptance and a consent grant".
- [ ] 4.4 Add the Settings About "Terms of use" link (§"The terms are reachable from Settings").

## 5. Settings rows and the server override

- [ ] 5.1 Add a non-RN error-details preference module (`whim.error-details:v1`, missing means on) and the "Send error details" switch in the AI features section. Write `handoff/privacy-settings.md` with the module's signatures for `developer-observability` chain-4. Tests for spec privacy-settings §"Settings carries a 'Send error details' switch…".
- [ ] 5.2 `device-id.ts`: add `resetDeviceId(kv)`. The About section gets a "This phone's ID" row (selectable text) and "Make a new ID" behind a confirm step, using draft-copy's strings. Tests for §"Settings shows this phone's ID and can make a new one", including that the header equals the shown ID.
- [ ] 5.3 Compile the server-address override out of store builds and make them ignore a saved override. Internal builds (dev, and the local offline `android:release`) keep it. Record which flag each build path sets in `progress.md`. Tests for spec app-launcher §"The Settings screen persists a server address…" and §"Settings groups its controls…".

## 6. French

- [ ] 6.1 Write a non-RN `legal-language.ts`: a persisted choice (`whim.legal-language:v1`) wins; otherwise French when the device's preferred language subtag is `fr`, read through Hermes `Intl` with the platform locale constant as fallback. Tests with injected locales, including fr-CA, fr-FR, en-US, and a choice overriding the locale.
- [ ] 6.2 Add a French copy table for every terms-step, consent-screen and what's-new key, including `consentWhatsNew[1]` with the same `covers`. Add the one-tap language switch to both screens, and make every legal link follow the active language. Tests for spec legal-text-localization §"Legal text is French first…".
- [ ] 6.3 Extend the gate check so that every legal key exists and is non-empty in both tables (§"Every legal copy key exists in both languages"). Red-check with a key deleted from the French table.
- [ ] 6.4 On the Android emulator, with the system language set to fr-CA, confirm the terms step and the consent screen render in French and that "Continue in English" persists. Record screenshots in `progress.md`.

## 7. Legal pages

- [ ] 7.1 Add `deploy/site/legal-identity.json` and fill every legal page from it through the site's existing `{{…}}` substitution. Owner-only fields stay empty for task 11.1.
- [ ] 7.2 Replace `deploy/site/privacy.html` with draft-copy §2, owner decisions applied. Include the "Who handles it right now" list from the provider rows, the EU/UK sections (a representative paragraph renders only when set), and the v1 90-day note. Tests for spec legal-pages §"The privacy policy page states the version-2 disclosure".
- [ ] 7.3 Generate the Korean-language overseas-transfer section from the same provider rows (§"The policy carries the sections every open storefront needs").
- [ ] 7.4 Add `deploy/site/terms.html` from draft-copy §6 (without the subscription and sync sections), plus `fr/privacy.html` and `fr/terms.html` translated from the English pages. Each page links its twin, and the web server routes are updated to serve them.
- [ ] 7.5 Add the deploy check (spec legal-pages §"No placeholder or draft marker…" and the policy-vs-manifest scenario). Red-check with a missing address, a leftover `[B9]` and a manifest category missing from the policy.

## 8. Store declarations, listings and review notes

- [ ] 8.1 `scripts/release/lib/store-listing.ts`: replace `PRIVACY_TYPE_MAPPING` with the manifest's store mapping, turn `checkNoLinkageOrTracking` into `checkNoTracking`, and have `checkTypeAgreement` compare all four declarations with the mapping. Red-checks in `store-listing.suite.ts` for each scenario of spec store-privacy-declarations §"Store privacy declarations follow the manifest's store mapping".
- [ ] 8.2 Rewrite `release/store/app-store/app-privacy.json`, `release/store/play/data-safety.json`, `ios/Whim/PrivacyInfo.xcprivacy` and `release/store/answers.md` from draft-copy §4.
- [ ] 8.3 Replace the privacy lines in `release/store/app-store/en-US/description.txt` and `release/store/play/en-US/full_description.txt` with draft-copy §3.
- [ ] 8.4 Replace "What leaves the phone, and when" and the 4.7.1 sentence, and add the 4.7.4 and 4.7.5 answers, in `release/store/app-store/review_information/notes.txt` and `docs/store/review-notes.md` §4. Keep the network-deny TODO, and keep the notes within 4,000 characters (checked).

## 9. Store age signals

- [ ] 9.1 Add an iOS native module `WhimAgeSignal` over Declared Age Range (iOS 26+), with the entitlement. It returns `unavailable` on older iOS or on error.
- [ ] 9.2 Add the Android counterpart over Play Age Signals (a Gradle dependency, no npm package). It returns `unavailable` without Play services or on error.
- [ ] 9.3 Write a non-RN age-check module: reduce the native result to the four values, store only `{ outcome, checkedAt }`, and re-check when there's no outcome, when the outcome is more than 30 days old, or when it's blocked. Tests with an injected native result for both requirements of spec store-age-signals, including "no age field in any request".
- [ ] 9.4 Run the check before the terms step in the flow. Add the parental-approval message in English and French. Tests for the three flow scenarios.
- [ ] 9.5 Add draft-copy §5's age-signal sentence to the 4.7.5 review answer in both review-notes files, and recheck the 4,000-character limit.
- [ ] 9.6 On the Android emulator, confirm the flow reaches the terms step when the signal is unavailable. Record the result in `progress.md`.

## 10. Compliance documents

- [x] 10.1 Write `docs/legal/breach-runbook.md` (detect, contain, assess real risk of significant harm, notify the OPC and people, PIPEDA s.10.1) and `docs/legal/breach-log.md` (a record of every breach, s.10.3).
- [x] 10.2 Draft `docs/legal/quebec-s17-assessment.md` for requests leaving Quebec to OpenRouter and the providers behind it (README B3, canada.md), for the owner to sign.
- [x] 10.3 Draft `docs/legal/uk-childrens-code-dpia.md` covering 13–17-year-olds, including the case for error details on by default (README note 3).
- [x] 10.4 Write `docs/legal/lawyer-brief.md` for after launch (decision 7). It lists README "Check with a lawyer" in priority order and every fallback the shipped text relies on.
- [x] 10.5 Write `docs/legal/change-process.md`. It covers the re-consent rule and where it's checked, the provider-list update, and the standing Texas §121.053 notice to each store before a significant terms or policy change.

## 11. Attended: owner and console steps

- [ ] 11.1 Fill `deploy/site/legal-identity.json`: the business street address and phone, `privacy@anycognition.ca`, the Privacy Officer title, and the effective dates.
- [ ] 11.2 Set up the `privacy@anycognition.ca` mailbox (B2).
- [ ] 11.3 In the OpenRouter account, exclude providers that train on or keep inputs, and confirm prompt logging is off (B1).
- [ ] 11.4 Read and sign the Quebec s.17 assessment. Check whether OpenRouter's DPA serves as the written agreement and gives EU/UK transfer cover (SCCs or DPF) (B3).
- [ ] 11.5 Appoint the EU and UK Article 27 representatives and record them in the identity file. Check whether the ICO fee applies, and read the UK DPIA.
- [ ] 11.6 Confirm Apple's EU DSA trader status with the business address and phone. The Play trader declaration waits on the account question (decision 3).
- [ ] 11.7 Have a fluent reader check the French pages and the French legal copy, and a Korean reader check the transfer section.
- [ ] 11.8 Run `platform-release-readiness` 13.6 (Android) and 13.7 (iPhone) and confirm both pass before any v2 copy ships (B7). Then remove the network-deny TODO from both review-notes files.
- [ ] 11.9 Test the age signals on a real iPhone (iOS 26+) and a real Android phone with Play.
- [ ] 11.10 Give each store the Texas §121.053 notice before the v2 terms and policy go live.
- [ ] 11.11 Deploy in the design's migration order: server first, then site, then the app release. Submit App Privacy and Data safety in both consoles with the release, and upload the listings and review notes.
- [ ] 11.12 After launch, engage a lawyer with `docs/legal/lawyer-brief.md` (decision 7).
