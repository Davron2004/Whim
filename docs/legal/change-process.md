# Changing what Whim sends, keeps or says

How to change the consent screen, the privacy policy, the terms, the provider list or a keep-period without breaking a promise. A working document for the owner, not legal advice. Sources: the re-consent rule in README "Re-consent rule" and the `ai-data-consent` spec of `legal-surface-v2`; design.md D1–D5, D7–D9 and the Migration Plan; README "Later, when triggered".

## 1. Classify the change first

| The change | Consent version | What to do |
|---|---|---|
| Rewording or translating copy | Stays | Section 4 |
| A different company doing a job inside an existing role (for example, a new AI provider or log host that acts only for Whim) | Stays | Section 5 |
| Removing or narrowing anything; a shorter keep-period | Stays | Section 4 |
| A keep-period change within the published maximum | Stays | Section 6 |
| A new optional feature that sends nothing until the user turns it on or takes an act for it on a screen that says what goes (sync, backup, in-app voice, bring-your-own-key, a report, a purchase) | Stays; the feature asks for itself | Section 3, "Own opt-in" |
| A widening (list below) | Bumps | Section 3 |
| A terms change | Consent version stays; `TERMS_VERSION` may move | Section 7 |

Before any of these reaches users, check section 8: Texas may need a notice to each store first.

## 2. The re-consent rule

`AI_CONSENT_VERSION` moves only when the disclosure manifest widens. A change widens the manifest when it:

- adds a data category covered by the main grant (audio, location, contacts, a name or email);
- adds a field the category's description excludes (typed text in error details, saved data in app material), which counts as a new category;
- adds a (category, role) or (category, purpose) combination, such as training AI on requests or any advertising use;
- adds a recipient role, such as a party that may use data for its own purposes;
- starts keeping a category the manifest lists as not kept, or lengthens a published maximum;
- turns an optional category on by default, or moves a category from its own opt-in or a user act into the main grant;
- removes or narrows a core promise, for example by letting Whim read anything saved inside a mini-app.

Nothing else moves the version, unless a reviewed reason entry in `BUMP_REASONS` says why (for example, a defect in the previous consent).

### Where it's checked

| Check | What it refuses | Where it runs |
|---|---|---|
| The re-consent release check, a pure function in `contract/` (design D3) | `AI_CONSENT_VERSION` in `src/host/launcher/release-config.ts` isn't the highest key in `MANIFESTS` (`contract/src/disclosure-manifest.ts`); a released version widened against its frozen snapshot `contract/disclosure/released/v<N>.json`; a version with no widening and no `BUMP_REASONS` entry; a `consentWhatsNew` line whose `covers` list doesn't equal the diff | The fast gate (through `checks/test/acceptance.ts`), the app release preflight under `scripts/release/`, and `deploy/deploy.sh` before anything is pushed |
| Screen coverage (design D4) | A screen category or screen-named role with no non-empty copy key in every language table; "OpenRouter" or "anonymous" in consent or report copy | The fast gate |
| Server practices, derived from the manifest (design D2) | The server applying to a request a practice its granted version doesn't list | At runtime, per request, from the `x-whim-consent` header |
| Keep-period caps (design D9) | A configured keep-period (reports, ledger, idle usage, log retention) above its category's published maximum | Server startup, and the same parse in `deploy/deploy.sh` |
| Legal pages (design D7) | A published legal page with an unresolved `{{…}}` or a draft marker, or a manifest category missing from the policy | The site deploy |
| Store declarations (design D8) | App Privacy, Data safety, `PrivacyInfo.xcprivacy` or `answers.md` disagreeing with the manifest's store mapping; any tracking | `scripts/release/lib/store-listing.ts` in the release checks |

The checks catch a widening you forgot to declare. They don't decide whether a new practice is a widening you should want. That judgment is yours, using the list above.

## 3. A widening: bump the version

In this order. Server first, then site, then app: an app that sends a new consent version before the server knows it gets refused (design.md Risks and Migration Plan).

1. Add `MANIFESTS[N+1]` in `contract/src/disclosure-manifest.ts`. Never edit a released version to widen it; the check refuses that.
2. Set `AI_CONSENT_VERSION` to N+1 in `release-config.ts`.
3. For every older version, write a `consentWhatsNew` line in every language table (English and French) whose `covers` lists every widening, including a longer keep-period.
4. Update the consent screen copy in both languages if a new category or screen-named role appears.
5. Update the policy in English and French (`deploy/site/`), its change-log line and effective date.
6. Update the store declarations to the new mapping, and the review notes if they describe the change.
7. Add the frozen snapshot for the new version under `contract/disclosure/released/` (design D3).
8. Run `./scripts/gate.sh`.
9. Send the Texas notice (section 8).
10. Deploy the server (`deploy/deploy.sh`), then the site (`deploy/deploy.sh --site-only`), then release the app. Submit changed store forms with the app release.

**Own opt-in.** A new optional category that keeps every core promise and sends nothing before the user acts is added to the manifest with its own consent path. The main version doesn't move. The feature's first-use screen says what goes. Update the policy, and the store forms if the stores list the new data type. Sync that Whim could decrypt doesn't qualify: it narrows core promise 1 and asks everyone (README note 21).

## 4. Wording, translation, narrowing

1. Change the text in every language it appears in. Known risk, accepted by the owner (2026-09-24): no fluent French or Korean reader checks the translation; the AI-drafted text is final.
2. For the policy: change the effective date and add a line to "Changes to this policy". Quebec expects notice when the policy changes (P-39.1 s.8.2; canada.md §(d)), and the dated change log is that notice.
3. Send the Texas notice if the change is significant (section 8).
4. Deploy the site with `deploy/deploy.sh --site-only`.

## 5. Updating the provider list

The policy's "Who handles it right now" list sits outside the manifest. Changing it never moves the consent version, as long as the new company fits an existing role (README "Manifest, version 2").

1. **Check the role.** Does the company act only for Whim, and may it not train on the data or use it for its own products? If yes, go on. If it uses data for its own purposes, it's a new recipient role: stop, that's a widening (section 3).
2. **Check the agreement.** Get written terms that match the policy: "each must protect it at least as well as this policy does" (draft-copy §2, "Who we share it with").
3. **Quebec.** If the company receives personal information outside Quebec, update `docs/legal/quebec-s17-assessment.md` (sections 2, 5 and 6) and sign the change before data flows. s.17 asks for the assessment and the written agreement first (canada.md §(f)).
4. **EU and UK.** Confirm transfer cover for the new company: Data Privacy Framework certification or standard contractual clauses (README B3).
5. **Edit the provider rows** in `deploy/site/legal-identity.json`: name, role, country, contact, what it receives, retention. The English and French pages and the Korean overseas-transfer section are all generated from these rows (design D7), so they can't disagree.
6. **Date it.** Update "Last changed" under the list and add a change-log line.
7. **Store forms.** Play "Shared" follows one rule: a type is Shared when it goes to a recipient whose service-provider status isn't confirmed (README note 19). A new service provider inside a confirmed role changes no answer.
8. **Texas notice** if the change is significant (section 8).
9. **Deploy the site** with `deploy/deploy.sh --site-only`.

Removing a provider needs steps 5, 6 and 9 only.

## 6. Keep-periods

- **Within the published maximum:** change the server's environment value and deploy. Server config refuses a value above the maximum at startup, and `deploy/deploy.sh` refuses it before anything changes (design D9). The policy states only the maximums, so its text doesn't change.
- **Shorter maximum:** free. Change the manifest and the policy (section 4).
- **Longer maximum:** a widening (section 3).

## 7. Terms changes

- `TERMS_VERSION` lives in `release-config.ts`, apart from the consent version. A terms bump never touches consent, and a consent bump never re-shows the terms (design D5).
- For a change that matters, the terms promise at least 30 days' notice in the app before it applies (draft-copy §6, section 12). That in-app notice isn't built yet; it gets built with the first such change (design.md Non-Goals).
- The French version is offered first to French-language phones (decision 4). Change both.
- Send the Texas notice (section 8) before the new terms apply.
- Deploy the site with `deploy/deploy.sh --site-only`.

## 8. Texas: notify each store before a significant change

While Texas's App Store Accountability Act applies, a developer must give each app store notice before making any significant change to the terms of service or the privacy policy (Texas Bus. & Com. Code §121.053(a); fact-check.md, claim 1; README summary 9). This is a standing step, not a one-time task. Utah, Louisiana and California follow in 2027 (README "Later, when triggered"); check whether their laws add similar duties.

What counts as "significant" isn't settled (README "Where the research is thin", Texas mechanics). Known risk, accepted by the owner: no lawyer will resolve this before launch.

How each store takes the notice:

- **Google Play:** Play Console → the app → **Age signals** → **Significant changes** → **Submit a significant change**. No new release is needed.
  - The description is at most 200 characters per language. Write each language as its own block on its own lines, such as `<en-US>…</en-US>` and `<fr-CA>…</fr-CA>`.
  - The effective date is at least today + 3 days. Play prompts the parents of supervised users 2 days before it.
  - Up to 3 changes can be scheduled at once, up to 90 days ahead and more than 2 days apart. Each can be cancelled until 2 days before its effective date.
- **Apple:** there's no App Store Connect form. The channel is PermissionKit's Significant Change API, which the app itself calls (issue #86). Until the app calls it, Apple gets no notice.

**File the notice before publishing, and set the pages' effective date to the notice's effective date or later** (`deploy/site/legal-identity.json`, `effectiveDates`). A page may go live early with a future effective date; what it says applies from that date.

No lawyer will answer this; the draft's rule is treated as final:

- **Send the notice** for any consent-version bump, any change to what the policy says Whim collects, keeps, shares or why, any provider-list change that adds a company or a country, and any terms change that gets the 30-day in-app notice.
- **Skip it** for typo fixes, formatting, translations of unchanged text, removing a provider, and correcting a contact detail.

Send it before the changed page goes live, and log it:

| Date sent | Store | Change | Channel | Reference |
|---|---|---|---|---|
| 2026-09-24 | Google Play | Privacy policy and terms v2 (consent version 2), effective 2026-09-27 | Play Console → Age signals → Significant changes | en-US and fr-CA descriptions (`openspec/changes/legal-surface-v2/progress.md`, 11.10) |
| | Apple | Same change | PermissionKit Significant Change API | Not sent: the app doesn't call it yet (issue #86) |

## 9. Other triggers

From README "Later, when triggered". Each one points back to a section above.

- **Premium subscription:** a paywall line on what Whim gets from the store, a subscriptions section in the terms, Apple's subscription disclosures, a Purchases entry in both store forms. Own opt-in: the purchase itself (section 3).
- **Sync or backup:** its own opt-in screen, encrypted on the phone with a key Whim never holds. Update both store forms (section 3).
- **Accounts:** a widening; everyone is asked again (section 3).
- **Bring-your-own-key:** its own opt-in and a policy line (section 3).
- **Device attestation (#65):** already in the v2 manifest. Add Apple and Google to the provider list (section 5), keep the integrity record under the B8 keep-period, and add it to `whim-admin device export|delete <id>`.
- **Provider role (whether the AI providers are service providers or a "shared" third party):** unresolved. Known risk, accepted by the owner: no lawyer will confirm this; Play "Shared" stays Yes for request material (section 5, step 7) until the owner decides otherwise.
- **US users near 25,000:** Montana's privacy law applies from 25,000 of its residents; Whim can't tell states apart, so the US total is the trigger.
- **Storefronts outside Canada, the US, the EU and the UK:** all stay open on law nobody has checked (decision 2). Known risk, accepted by the owner: no lawyer will research these territories; the storefronts stay open regardless.
