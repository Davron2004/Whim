# Whim's legal surface: what the text must say, and what it shouldn't (issue #63)

Research, not legal advice. Written 2026-09-23 and revised the same day three times: after two adversarial reviews (legal accuracy, promise consistency), after a fact-check against primary sources (`fact-check.md`), and after the owner's input on a premium tier, sync and device attestation. The Verification log at the end records every change.

The four lists below are the job. Everything after them is the reasoning, and you only need it when a list item points there. "Note 3" means item 3 under "Decision notes"; below the line, "decision 3" means the same note, while "decision 1" to "decision 7" in these lists mean the seven decisions here. B1 to B10 are the blockers. The [B1] and [D3] markers in `draft-copy.md` point at the same things.

## Decide before public launch

Seven decisions. Each one sets something every user agrees to, so changing it after launch means asking everyone again, or it changes what the store consoles say on day one. The owner answered all seven on 2026-09-23; the OpenSpec change `legal-surface-v2` lands the text and the agent tasks.

1. **What are the core promises?**
   - Recommendation: three. Nobody at Whim can read what you save in your apps (anything ever synced is encrypted with a key Whim never has). No ads, no selling or sharing for advertising, no cross-app tracking. Requests aren't kept after they're handled, except inside a report. "No accounts" stays a fact, not a promise.
   - Why now: weakening a core promise later re-asks everyone. Writing the first one around who can read the data, not where it sits, is what lets encrypted sync ship later without a re-ask. (Notes 1, 2, 21.)
   - **Owner answer (2026-09-23): as recommended.** Three core promises; "no accounts" stays a fact.
2. **Which storefronts at launch?**
   - Recommendation: Canada and the US. Add the EU and UK once their list below is done. Keep every other country off until someone checks its law.
   - Why now: Whim is currently offered in every territory except mainland China, and listing a country is what triggers its law (Korea's PIPA, the EU's trader rule). (Notes 12, 17.)
   - **Owner answer (2026-09-23): keep all territories** (every App Store and Play territory except mainland China), accepting the unresearched-country risk knowingly. Consequences: the "Only if you open EU/UK storefronts" list becomes pre-launch work, the policy gains the Korean-language section on overseas transfers, and lawyer item 15 (countries outside the research) moves up.
3. **Who does the text name, and how do people reach you?**
   - Recommendation: AnyCognition Inc. everywhere, a business address and phone (a virtual office or business line, not personal ones), a `privacy@` mailbox, and the owner as Privacy Officer by title. Move Play to an AnyCognition organization account.
   - Why now: the policy, the terms, Apple's minimum EULA terms and Quebec all need contact details, and today the Play listing names a different party from the policy. (Notes 10, 11.)
   - **Owner answer (2026-09-23): as recommended, except Play stays on the personal developer account for now.** AnyCognition Inc. in the policy, terms and App Store; a business address and phone; `privacy@anycognition.ca`; the owner as Privacy Officer by title. Open consequence: the Play listing keeps naming a different party from the policy, and with EU storefronts kept (decision 2) a Play DSA trader declaration would publish the account holder's details, so that declaration waits until the account question is revisited.
4. **French for Quebec at launch?**
   - Recommendation: yes, for the terms, the terms step, the consent screen and the policy, French first for fr-CA users with an express choice of English.
   - Why now: the Charter's French-first rule for contracts of adhesion is in force, and a store can't leave Quebec out of the Canadian storefront. Whether it reaches an Ontario seller is unconfirmed. (Note 16.)
   - **Owner answer (2026-09-23): as recommended.** French terms, terms step, consent screen and policy at launch; French first for fr-CA with an express choice of English.
5. **Adopt terms of use?**
   - Recommendation: yes, under Ontario law, accepted with their own "Accept" step right before the data consent screen.
   - Why now: acceptance is collected at first use, so adding terms later puts a new step in front of every existing user. A premium subscription will need them anyway. (Note 9.)
   - **Owner answer (2026-09-23): as recommended.** Terms at `/terms` under Ontario law, accepted in their own step right before the data consent screen; Apple's Standard EULA stays on iOS.
6. **What ceilings go in the disclosure manifest?**
   - Recommendation: reports and usage records kept at most 12 months; error details, connection data and logs at most 90 days; error details on by default with a switch to turn them off. Smaller numbers are fine.
   - Why now: after launch, raising a ceiling or turning a default on re-asks everyone. Lowering either is free. (Notes 3, 5.)
   - **Owner answer (2026-09-23): as recommended.** Reports and usage records at most 12 months; error details, connection data and logs at most 90 days; error details on by default with a Settings switch. With EU storefronts kept (decision 2), lawyer item 4 may still flip the default to off for EU users only; the wording doesn't change.
7. **Pay for a lawyer before launch, and for what?**
   - Recommendation: one scoped review of the policy and terms, the Quebec items, whether the AI providers count as service providers, and the Texas age duties. EU and UK questions only if decision 2 opens those storefronts.
   - Why now: that's where the research below is weakest, and a wrong guess lands in text every user agrees to. ("Check with a lawyer".)
   - **Owner answer (2026-09-23): no lawyer before launch.** Launch on this research; "Check with a lawyer" becomes a post-launch brief, not a launch gate. The text ships with the draft's own fallbacks where an item is unsettled (for example the Agree tap as EU ePrivacy consent for the phone ID, and Play "Shared: Yes" for request content until the provider role is confirmed).

## Do before public launch

In rough dependency order. "Yes" in the last column means an agent can do all of it; the middle column is what's left for you.

| Task | Your part | Agent? |
|---|---|---|
| In the OpenRouter account, exclude providers that train on or keep inputs, and confirm prompt logging is off (B1) | 10 minutes in the dashboard | The matching `data_collection: 'deny'` line in `server/src/openrouter.ts`, yes; the account setting, no |
| Set up the privacy mailbox (B2) | 15 minutes | No |
| Quebec transfer paperwork: the s.17 assessment, and a written agreement with OpenRouter covering the providers behind it (B3) | An hour to read and sign; check whether OpenRouter's standard DPA serves | Drafts the assessment, yes |
| Server records tied to a phone ID: keep the lifetime `usage` totals (owner decision) but purge a phone's row 12 months after it was last seen, and add `whim-admin device export\|delete` (B8) | Nothing | Yes |
| Closed list of error names in error details (B9) | Nothing | Yes |
| Consent version, app version and build number in a header on every request, enforced by the server (B10, #64) | Nothing | Yes |
| Settings rows: the error-details switch, and the phone's ID with "Make a new ID" (B4) | Nothing | Yes |
| Take the server-address override out of release builds (note 7) | Say if you want it kept | Yes |
| Texas age signals: Apple's Declared Age Range and Play's age signals, kept on the phone, with parental-consent gating for minors (note 18) | Test on both phones | Yes |
| Store privacy answers: every type "Linked", usage records and error details declared, and the release check that refuses them fixed (B6) | 30 minutes to submit both consoles | Yes, the files and the check |
| Network-deny acceptance on real devices, tasks 13.6 and 13.7 (B7) | About 30 minutes with an iPhone | Android on the emulator, yes; the iPhone run needs you |
| Terms page and terms step, after decision 5 (B5) | Read the terms | Yes |
| Land the new text (`copy.ts`, `privacy.html`, `terms.html`, listings, review notes) and bump the consent version from 1 to 2 | Read and approve | Yes, after decisions 1 to 6 |
| French versions, after decision 4 | A fluent reader's check | Drafts, yes |
| A breach runbook and a breach log (PIPEDA s.10.1, s.10.3) | 30 minutes to read | Yes |

## Only if you open EU/UK storefronts

- **Article 27 representatives, one for the EU and one for the UK.** Paid and yearly. The "occasional processing" exemption needs three conditions at once, and a service people use every day fails the first, so plan on needing them (fact-check 9c).
- **DSA trader status on both stores.** The address, phone and email from decision 3 appear on the EU product pages, and Apple removes EU apps without it. Do the Play organization account first.
- **Transfer cover.** Confirm OpenRouter's terms carry standard contractual clauses or Data Privacy Framework cover (B3).
- **UK Children's Code.** A DPIA for 13–17-year-olds that has to justify error details being on by default (note 3). Check whether the ICO fee applies.
- **EU error details.** Ask the lawyer whether they need opt-in under ePrivacy. If yes, default the switch off for EU users (lawyer item 4). This question is unsettled.

The policy's GDPR sections are already in the draft, so none of this rewrites the text.

## Later, when triggered

- **When the premium subscription ships:** a line on the paywall saying what Whim gets from the store (what was bought, until when, and the store's transaction reference, never card details or the store account), a subscriptions section in the terms, Apple's subscription disclosures with links to the terms and the policy, and a Purchases entry in both store forms. Nobody is asked again: buying is the user's own act (note 21).
- **When sync ships:** its own opt-in screen the first time someone turns it on. Encryption happens on the phone with a key Whim never holds, so no key escrow and no recovery through Whim. The screen says what Whim can see (sizes, times, which phones share a sync). Update both store forms. Nobody else is asked. Sync that Whim could read would break core promise 1 and re-ask everyone (note 21).
- **If accounts ever come** (sign-in with an email, say): everyone is asked again. Build premium and sync without them if you can.
- **When bring-your-own-key ships:** its own opt-in, and a policy line saying requests go to the user's provider under the user's own contract.
- **When device attestation ships (#65):** nothing to re-ask, because the v2 manifest already lists it. Add Apple and Google to "Who handles it right now", keep the integrity key under B8's rules, and check whether either store form wants it declared (note 22).
- **When the provider-outage message ships (#66):** no new data. Keep the vendor's name out of the message.
- **Before any significant change to the terms or the policy,** while Texas's law applies: tell each store first (Texas Bus. & Com. Code §121.053).
- **When US users near 25,000:** Montana's privacy law applies from 25,000 of its residents, other states from higher counts. Whim can't tell which state anyone is in, so the US total is the trigger.
- **Before turning on any other storefront** (Korea, Brazil, Japan, India and the rest): check that country's law. Korea needs a Korean-language section on transfers abroad naming each recipient.
- **When a provider changes:** update "Who handles it right now" and its date. Nobody is asked again.
- **When a lawyer confirms the AI providers are service providers:** Play "Shared" flips to No (note 19).
- **If App Review presses on 4.7.1's "block abusive users":** add a block list by phone ID. Not by IP address: shared Wi-Fi and carrier NAT put many people behind one address.
- **When in-app voice ships:** its own opt-in (note 13).
- **Before Utah (2027-05-06), Louisiana (2027-07-01) and California AB 1043 (2027) take effect:** the Texas age-signal work should cover them; confirm each law's duties.

## Where the research is thin

These rest on low-confidence research, and a wrong answer would change something above:

- **Quebec.** Neither official site served the statute, so s.3.1 (privacy officer), s.17 (transfers) and the under-14 consent rule rest on secondary summaries, the last on general knowledge only. The s.55 French-first text came from a mirror. Whether s.55 reaches an Ontario business selling through app stores is unknown.
- **Provider role.** Whether the AI providers, and Apple and Google for integrity checks, act only for Whim or partly for themselves. It decides Play's "Shared" answer and the transfer paperwork.
- **EU ePrivacy** for error details and the phone ID.
- **Texas mechanics.** The statute text is confirmed; how the stores' age APIs implement it and how a developer gives the §121.053 notice aren't. The law's constitutionality is still being litigated.
- **Washington's health-data law** and typed health details.
- **US state thresholds** other than Montana's.
- **Store details not read first-hand:** whether App Attest or Play Integrity need a store-form entry, Apple's subscription disclosure rule, whether App Review wants a provider named on the consent screen, and how 4.7.4 fits apps built for one user.

---

# The detail

**Scope.** The research covers Canada and Quebec, the EU, the UK, the US, and the two stores' rules. It does not cover other countries. Whim's current availability is "all App Store and Play territories except mainland China" (`release/store/answers.md`), which is wider than what was checked. One regime outside scope is already known to need more than this draft gives: South Korea (see "Other countries" and note 17). Until other regimes are checked, the launch territories should match the research, or the policy should carry the per-country annex that decision 17 describes.

What's in this folder:

- `draft-copy.md` has the proposed text: consent screen strings, privacy policy, store declarations, App Review notes and terms of use.
- `canada.md`, `eu-uk-us.md`, `stores.md` and `practice-and-terms.md` hold the research behind it, with sources and confidence tags. Section references below (like "canada.md §b") point into them.

The brief also named an `inventory.md`. Nobody wrote it, so I built the inventory of current statements myself from `src/host/launcher/copy.ts`, `deploy/site/privacy.html`, `deploy/site/support.html`, `release/store/answers.md`, `release/store/app-store/app-privacy.json`, `release/store/play/data-safety.json`, `ios/Whim/PrivacyInfo.xcprivacy`, `release/store/app-store/review_information/notes.txt`, `docs/store/review-notes.md` and both store descriptions. I then checked each claim against the app and server code. Four facts were checked first-hand today because the copy depends on them: Apple's guideline 4.7 and 5.1 text, Apple's App Privacy definitions, Play's Data safety definitions, and OpenRouter's routing defaults.

## Summary

1. **Two store answers are wrong today.** The App Store privacy answers and the iOS privacy manifest say request content and the device ID are "not linked to you". Apple's definition counts linkage "via their account, device, or other details", and adds that anything that is personal data under privacy law "is considered linked to the user". A per-install ID is very likely personal information in Canada and personal data in the EU (canada.md §b, eu-uk-us.md §1.3). The release check in `scripts/release/lib/store-listing.ts` (`checkNoLinkageOrTracking`) currently fails the build if anyone corrects this, so the check has to change along with the answers.

2. **One OpenRouter setting decides whether "AI companies only work for us" is true, and even then "they don't keep it" isn't.** OpenRouter's default routing (`data_collection: allow`) includes providers that "store user data non-transiently and may train on it". Whim's server sends no override (`requestBody` in `server/src/openrouter.ts`). Unless the OpenRouter account's privacy settings already exclude those providers, and the repo can't show that, prompts may be going to providers that keep them and train on them right now. Blocker B1 fixes the training half. The retention half is a different guarantee: OpenRouter's own ZDR guide says some providers "do not train on your data but do retain it (e.g. to scan for abuse or for legal reasons)". So the copy now promises no training and no use for the providers' own products, and says some may keep requests for a limited time for security and legal reasons. Zero-retention routing stays a hardening step, not a promise.

3. **The server keeps one thing forever, and the draft said it didn't.** Besides the 90-day request ledger, `server/src/usage-store.ts` keeps a lifetime `usage` table (one row per device ID with running token totals) that nothing purges. The retention table, the "make a new ID" promise and the Data safety deletion answer were all false against it. New blocker B8 fixes it and adds an operator tool to find and delete one ID's records.

4. **One consent screen with one Agree covers everything that's planned.** It's written at the level of kinds of data, kinds of recipient and purposes, so it already covers error diagnostics, a failure code and request id in the ledger, switching AI or cloud providers, moving off OpenRouter, logs in Cloud Logging, the app version and build number sent with every request (#64), and device attestation through Apple App Attest and Google Play Integrity (#65). Attestation is the one that needed a change: Apple and Google may process those checks under their own terms, so the v2 manifest now lists them as their own recipient role and the screen names them. Shipping it bumps the consent version from 1 to 2 once, before public launch, so only TestFlight and alpha testers see a re-ask. None of the planned items needs another one after that. Terms of use are accepted in a separate step, not on this screen: Play says the data disclosure "cannot be included with other disclosures unrelated to personal and sensitive user data collection".

5. **The re-ask rule follows a checked-in list, not the wording.** The version bumps only when the app starts sending a new kind of data, to a new kind of recipient, or for a new purpose, keeps something longer than the published maximum, turns an optional item on by default, or weakens a core promise. The server enforces the same list, because recipients, purposes and retention can change there without an app release: each request carries the version it was granted under. New optional features (in-app voice, sync, "help improve Whim") ask on their own the first time they're used and never touch the main version. So does anything that leaves the phone only through an act the user takes for that purpose, where the screen says what goes: sending a report, or buying a subscription through the store. The requirement text is below, ready for OpenSpec.

6. **The saved-data promise is now about who can read it, not where it sits.** The owner expects a premium tier with optional sync and backup across phones, end-to-end encrypted. "Whim never receives it" would be false the day that ships, and "never leaves your phone" is already slightly too strong on iPhone, where iCloud backups can include app data and the phone ID (Android has `allowBackup="false"`). The draft now says: "Nobody at Whim can read it. It stays on your phone, and anything Whim ever syncs or backs up for you is encrypted on your phone with a key Whim never has." That's true today, since nothing is synced and an iCloud backup is Apple's and the user's, not Whim's, and it stays true with encrypted sync. It binds the sync design: the key can never reach Whim, including for account recovery. It rests on two conditions today. Mini-apps have no network API, and the navigation block that closes the last leak is in the code on both platforms, but its on-device acceptance (tasks 13.6 and 13.7 of `platform-release-readiness`) is still open, so B7 gates shipping any of the v2 copy. And the planned error details turn a mini-app error's `name` into `errorClass`, a free string that generated code can fill with saved records; B9 closes it with a fixed list of error names.

7. **A lot of the current text goes.** That includes the vendor name in promises (OpenRouter), "anonymous" (legally the ID is pseudonymous, not anonymous), "no analytics, crash-reporting or advertising SDKs", "server logs hold no request content", "the front proxy keeps no access log", fixed 90-day figures, "the Whim team reads every report", and "if what Whim sends ever changes, the app asks you to agree again". That last one would force a re-ask for a single new diagnostic field.

8. **Some required things are missing.** The current text has no privacy contact by title (Quebec s.3.1) and no legal bases, rights list or right to complain to a regulator (GDPR Art. 13). It doesn't say how data is secured (Play) or confirm that providers protect data as well as Whim does (Apple 5.1.1). It lacks a Do Not Track statement, a line on whether other parties can track people through Whim, and a note on how changes are announced (CalOPPA). The GDPR notice also needs the adequacy position for transfers and a separate right-to-object paragraph (Art. 13(1)(f), 21(4)). The UK now wants a way to complain to Whim first, acknowledged within 30 days (DPA 2018 s.164A, since 2026-06-19). Keep-periods for logs are missing too.

9. **Some obligations aren't text at all.** Before Quebec users' prompts leave Quebec, Law 25 s.17 asks for a privacy impact assessment and a written agreement with the recipient. Staying available in the EU and UK means Article 27 representatives, and the US providers need transfer terms. PIPEDA s.10.1 wants a breach runbook and a breach log. Four more surfaced in review:
   - **Texas's App Store Accountability Act is in force.** A district court enjoined it in December 2025. The Fifth Circuit stayed that injunction (administratively on 2026-05-28, in full on 2026-06-04), and on 2026-07-06 the Supreme Court denied emergency applications to vacate the stay (Nos. 25A1389 and 25A1390). So Texas can enforce it now, but no court has ruled on whether it's constitutional; that appeal is still running. Developers must use the store's age-category and consent signal to verify age and parental consent for users under 18, use that data only for compliance and delete it once verified, and give each store notice before any significant change to the terms or privacy policy (§121.053). That last duty is ongoing, not a one-time integration. Whim is rated 13+, so Texas teens are in scope today.
   - **Quebec's Charter of the French Language (s.55)** wants a contract of adhesion, such as the terms of use, offered in French first. French versions of the terms, and likely the consent screen and policy, are needed before public launch.
   - **The EU DSA trader rules** publish the trader's address, phone and email on the EU store pages. That decides which address and phone Whim publishes.
   - **The UK Children's Code** covers services likely to be used by under-18s, so a DPIA covering 13–17-year-olds is expected.

   No wording fixes any of these.

10. **Terms of use aren't legally required anywhere the research found, but I'd have them on both platforms.** They carry the licence to use the app, the AI-output disclaimer, what people may not ask Whim to build, the right to cut off a phone's ID, liability limits and governing law. On iPhone they sit next to Apple's standard EULA. On Android nothing else fills the gap.

11. **The lawyer list got longer in review.** Nobody read the Quebec statute first-hand (both official sites refused the fetch). Whether error diagnostics need opt-in consent in the EU is unsettled (the UK settled it: fault detection is now exempt). The 13+ age floor meets Quebec's reported under-14 rule, Texas's under-18 parental consent and the UK Children's Code. Washington's health-data law has no size threshold and could reach health details people type into requests. Korea wants the actual recipients named in the policy. And nobody knows yet whether Apple wants a provider named on the consent screen.

12. **The owner's plans fit without a re-ask, with one design rule each.** A premium subscription bought through the stores sends Whim a record of the purchase, never payment details; buying is the user's act, so it doesn't move the consent version. Sync gets its own opt-in and must stay unreadable to Whim. Bring-your-own-key gets its own opt-in. Attestation and the version header are in the v2 manifest already. The provider-outage message sends nothing new. Accounts are the one likely change that would re-ask everyone.

### Blockers: do these before the new text ships

Each one makes a sentence in `draft-copy.md` true. The draft marks those sentences with the blocker's number.

- **B1. AI providers act only for Whim.** Turn on the OpenRouter account setting that excludes providers that train on or store inputs, and confirm prompt logging is off. Also send `provider: { data_collection: 'deny' }` from `requestBody`, so a settings change can't quietly undo it. This makes true "they may not train AI on it or use it for their own products". It does not make "they don't keep it" true, and the copy no longer says that: `deny` is documented as "use only providers which do not collect user data", while OpenRouter's ZDR guide says providers that don't train may still retain requests "to scan for abuse or for legal reasons". Zero-retention routing (`zdr: true`) is worth turning on if the DeepSeek models Whim uses have ZDR endpoints (check first, or requests fail to route), but treat it as hardening, not as something the copy relies on. OpenRouter's own request metadata and logs fall under OpenRouter's policy, not the account setting. The written agreement in B3 should cover them.
- **B2. A privacy contact.** Pick the title (the owner by default, under Quebec s.3.1) and a mailbox such as `privacy@anycognition.ca`.
- **B3. Transfer paperwork.** Do the Quebec s.17 assessment and get a written agreement with OpenRouter covering the providers behind it. Confirm OpenRouter's terms give EU/UK transfer cover (standard contractual clauses or DPF).
- **B4. Two Settings rows.** A "Send error details" switch (note 3) has to exist before diagnostics ship. "This phone's ID", with a way to make a new one (decision 8), is needed before the policy can tell people to quote their ID.
- **B5. A terms page** at `/terms`, next to `/privacy`, and a separate terms step in the app (decision 9), apart from the data consent screen.
- **B6. Update what enforces the old answers.** That means `store-listing.ts` (linkage check and the two-type mapping), the `ai-data-consent` spec (it requires naming OpenRouter on the screen), the `device-diagnostics` spec in `developer-observability` (it requires "not linked to identity") and `AI_CONSENT_VERSION` (1 → 2). The full list is in "What else changes" below.
- **B7. Network-deny acceptance.** Run tasks 13.6 and 13.7 before any v2 copy ships. The saved-data promise on the consent screen, in the policy and in the listing depends on them, and the review-notes TODO comes out only after they pass.
- **B8. Every server record tied to a phone ID has a keep-period and can be found and deleted.** The lifetime `usage` table (`server/src/usage-store.ts`, `device_id` primary key, credited by clarify, rewrite and generate) has no purge. **Owner decision (2026-09-23): keep it.** Lifetime totals are its purpose. Record when each row was last credited, and delete rows that haven't been credited for 12 months, so a phone that stops using Whim doesn't stay on the server forever. Declare it as linked usage data, not tracking. Then add a `whim-admin device export|delete <id>` subcommand covering reports, the ledger and anything else keyed by device ID, so the policy's 30-day access and deletion promise is workable. Add the table to the manifest's "Usage records" category. The same rule covers the attestation key and verdict that #65 will bind to each phone ID: give that record the "App-integrity check" keep-period and include it in `device export|delete`.
- **B9. Error details carry no free text.** Before diagnostics ship, the `device-diagnostics` requirement must map a mini-app error's `name` to a closed set of built-in error names (`TypeError`, `RangeError`, and so on), with anything else sent as `Other`, plus a red-check that a generated error name built from saved data never leaves. Without it, "never what you typed or saved" is false the day diagnostics ship (`developer-observability/design.md` D2 caps `errorClass` at 128 characters but doesn't close it).
- **B10. The consent version travels with every request.** The client sends its grant version in a header on every `/v1/*` call, and the server refuses to apply a practice outside the manifest version that request was granted under. Without this, "we'll ask you first" can't hold for a change made on the server. #64 adds the app's version and build number to every request too; send both in the same change. The manifest already covers the version and build under "Connection and log data".

## Requirements table

Only obligations with a cited source. "Met by" names the part of `draft-copy.md` that meets it. Confidence follows the research files: high means primary text was read, medium means consistent secondary sources.

### Apple

| Obligation | Source | Met by | Confidence |
|---|---|---|---|
| Privacy policy linked in App Store Connect and inside the app, easy to find | [Guideline 5.1.1(i)](https://developer.apple.com/app-store/review/guidelines/) | Policy link on the consent screen, the report sheet and Settings; policy URL in App Store Connect | High |
| Policy says what's collected, how, and every use | 5.1.1(i) | Policy: "What leaves your phone" table and "Why we use it" | High |
| Policy confirms third parties give "the same or equal protection" | 5.1.1(i) | Policy: "Every company that handles your information for us must protect it at least as well as this policy does" | High |
| Policy explains retention and deletion, and how to revoke consent or ask for deletion | 5.1.1(i) | Policy: "How long we keep it", "Your choices", "Your rights" | High |
| Consent before collecting user or usage data, "even if … anonymous", plus an easy way to withdraw | [5.1.1(ii)](https://developer.apple.com/app-store/review/guidelines/) | The consent screen gates every request except a hand-sent report; the Settings switches withdraw | High |
| Say clearly where personal data goes to third parties "including with third-party AI", and get explicit permission first | [5.1.2(i)](https://developer.apple.com/app-store/review/guidelines/) | Consent screen: lead, "Who gets it", "Agree and continue" | High on the rule; medium on whether reviewers want a provider name (stores.md §1.2) |
| No reuse for another purpose without more consent | 5.1.2(ii) | The re-consent rule (enforced on the server too, B10) and the consent line "we'll ask you first" | High |
| App Privacy answers match practice; "personal data … considered linked" | [App privacy details](https://developer.apple.com/app-store/app-privacy-details/) | Draft App Privacy table, every type marked Linked | High (definition read today) |
| Privacy manifest declares collected data types | [Privacy manifest files](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files); stores.md §1.5 | Draft `NSPrivacyCollectedDataTypes` | High |
| Mini-app software follows 5.1, has filtering, a way to report, "timely responses", and "the ability to block abusive users" | [4.7.1](https://developer.apple.com/app-store/review/guidelines/) | Consent and policy (privacy), server content check, report sheet, and the terms' right to cut off a phone's ID | High (text read today) |
| No data or privacy permissions passed to a mini-app "without explicit user consent in each instance" | 4.7.3 | Architecture: mini-apps get no host data (review notes §4.7.3). No copy needed | High |
| "An index of software and metadata … universal links that lead to all of the software offered in your app" | 4.7.4 | Whim offers no catalogue: every mini-app is built for one user on request. The Home screen lists that user's own apps, and `/a/<id>` app links open them. Say so in the review notes | Medium (the rule's fit to per-user software is untested) |
| "An age restriction mechanism based on verified or declared age to limit access by underage users" for content above the app's rating | 4.7.5 | 13+ rating; the content check refuses requests above that rating; store age signals once decision 18 lands. Lawyer item 7 | Medium |
| Only once a subscription ships: auto-renewing subscriptions show what's included, the length and price, and link to the terms of use and the privacy policy in the app and in the store metadata | 3.1.2 | Not yet. The paywall and the terms' subscription section ("Later, when triggered"; note 21) | Low (from memory, not re-read in any pass) |

### Google Play

| Obligation | Source | Met by | Confidence |
|---|---|---|---|
| Privacy policy in Play Console and in the app, labeled as a privacy policy, at a public URL that isn't geofenced and isn't a PDF | [User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311) | `/privacy` HTML page, linked in the app | High |
| Policy lists developer info and a privacy contact; "the types of personal and sensitive user data your app accesses, collects, uses, and shares; and any parties with which any personal or sensitive user data is shared"; secure handling; retention and deletion | User Data policy | Policy: "Who we are", "What leaves your phone", "Who handles it right now" (names the parties), "Keeping it safe", "How long we keep it" | High (clause re-read in review) |
| In-app prominent disclosure with an affirmative choice, before collection, where users might not expect it | User Data policy, prominent disclosure and consent (stores.md §2.2) | Consent screen, shown at the first action that would send anything | High on the text; medium that Play would call it triggered |
| The disclosure "cannot be included with other disclosures unrelated to personal and sensitive user data collection" | User Data policy, prominent disclosure | Terms acceptance moved to its own step (decision 9). The consent screen holds only the data disclosure | High (read in review) |
| Data safety form is accurate and covers data sent by any library or SDK. A type is "required" when the app's primary functionality needs it | [Data safety definitions](https://support.google.com/googleplay/android-developer/answer/10787469) | Draft Data safety table: request content, the ID and usage records Required; error details Optional | High (definitions read today) |
| EU trader status (DSA): a trader's address, phone and email appear on the EU listing | Play Console DSA trader declaration | Not copy. Notes 10–12 (decisions 2 and 3 at the top) | Medium |
| In-app reporting of AI-generated content without leaving the app | Play AI-Generated Content policy (stores.md §2.4) | Report sheet (orb menu, done step, history header) | Medium (secondary sources) |
| Don't link persistent hardware IDs to personal data | User Data policy | Design: the ID is a random UUID made by the app (`src/host/launcher/device-id.ts`) | High |

### Canada and Quebec

| Obligation | Source | Met by | Confidence |
|---|---|---|---|
| Consent counts only if people would understand the nature, purpose and consequences | [PIPEDA s.6.1](https://laws-lois.justice.gc.ca/eng/acts/p-8.6/page-1.html) | Consent screen in plain words, with separate headings for what, why and who | High |
| Emphasize what's collected, who it's shared with, why, and risks such as leaving the country | [OPC meaningful-consent guidelines](https://www.priv.gc.ca/en/privacy-topics/business-privacy/collecting-personal-information/consent/gl_omc_201805/) | The "What gets sent", "Why" and "Who gets it" headings; "Some of them are outside Canada" | High |
| Practices readily available; a named accountable person | PIPEDA Schedule 1, principles 4.1 and 4.8 ([full text](https://laws-lois.justice.gc.ca/eng/acts/P-8.6/FullText.html)) | Published policy; Privacy Officer in "Who we are" | Medium (literal clause not fetched) |
| Report breaches that create a real risk of significant harm, and keep a record of every breach | [PIPEDA s.10.1](https://laws-lois.justice.gc.ca/eng/acts/p-8.6/section-10.1.html), s.10.3 | Policy: "Keeping it safe". The real work is a runbook and a breach log | High (s.10.1), medium (s.10.3) |
| Publish the title and contact of the person in charge of personal information | [Quebec P-39.1](https://legisquebec.gouv.qc.ca/en/document/cs/p-39.1) s.3.1 | Policy: "Who we are" (blocker B2) | Medium (statute not read first-hand; the fact-check's second attempt was refused too) |
| At collection, tell people the purposes, the means, their access and correction rights, their right to withdraw, the third parties or categories, and whether data may go outside Quebec | P-39.1 s.8 | Consent screen plus policy sections "Why", "Who we share it with", "Where it's handled", "Your rights" | Medium |
| Publish a policy "in clear and simple terms", and give notice when it changes | P-39.1 s.8.2 | Plain-language policy; "Changes to this policy" with dated change log | Medium |
| Privacy impact assessment and a written agreement before personal information leaves Quebec | P-39.1 s.17 | Not copy. Blocker B3 | Medium-high |
| No false or misleading representation, judged by its general impression as well as its literal meaning | [Competition Act s.52](https://laws-lois.justice.gc.ca/eng/acts/c-34/section-52.html), s.74.01 | Wording rule: promise only what's true; absolute words only for architectural facts | High |
| A contract of adhesion must be offered in French first; English only after the parties expressly choose it. Commercial documents, websites included, must be available in French | [Charter of the French Language](https://www.legisquebec.gouv.qc.ca/fr/version/lc/C-11?code=se%3A55&langCont=en) s.55 (in force 2023-06-01), s.52 | Not met. French terms, consent screen and policy before public launch (decision 16); fr-CA users see French first with an express choice of English. Lawyer item 14 | Medium-high on the s.55 text (official English text via a mirror, cross-checked against two law-firm summaries); low on its reach to an Ontario business selling through app stores |

### EU and UK

| Obligation | Source | Met by | Confidence |
|---|---|---|---|
| Notice lists the controller and contact, purposes with legal basis, legitimate interests, recipients, transfers and safeguards, retention or its criteria, rights, withdrawal, the right to complain, whether data is required, and automated decisions | [GDPR Art. 13](https://gdpr-info.eu/art-13-gdpr/) | Policy sections in that order, including the legal-basis table | High |
| Transfers: state "the existence or absence of an adequacy decision" | GDPR Art. 13(1)(f) | Policy: "Where it's handled" (Canada has an EU adequacy decision; the US through the Data Privacy Framework where the recipient is certified, otherwise standard contractual clauses) | High |
| Right to object to legitimate-interest processing "explicitly brought to the attention" of the person, "clearly and separately from any other information" | [GDPR Art. 21(4)](https://gdpr-info.eu/art-21-gdpr/) | Policy: its own paragraph under "Your rights" | High |
| Clear, plain language | [GDPR Art. 12(1)](https://gdpr-info.eu/art-12-gdpr/) | Whole policy | High |
| Withdrawing consent is as easy as giving it | [GDPR Art. 7(3)](https://gdpr-info.eu/art-7-gdpr/) | One switch in Settings | High |
| EU and UK representatives unless processing is "occasional", doesn't include large-scale special-category or criminal data, and is unlikely to create a risk (all three must hold) | [GDPR Art. 27(2)](https://gdpr-info.eu/art-27-gdpr/) | Placeholder in the policy; needed if EU/UK storefronts open, since a service people use daily isn't "occasional" (note 12) | High on the text; medium on how regulators read "occasional" |
| Safeguards for transfers to non-adequate countries (US providers) | [GDPR Art. 44+](https://gdpr-info.eu/art-44-gdpr/) | Policy: "Where it's handled" (blocker B3) | Medium |
| Storing or reading information on the device needs consent unless strictly necessary for the service asked for | ePrivacy Art. 5(3) ([EDPB 2/2023](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf)) | The ID has several uses (limits, abuse, cost records), so the strictly-necessary exemption is doubtful for EU users. The policy therefore also treats the Agree tap as consent to storing and reading the ID, and the error-details switch as consent for error details. Withdrawing is the same switch. Lawyer item 4 | Medium |
| UK: storage or access strictly necessary "to prevent or detect technical faults in connection with the provision of the service requested" needs no consent | PECR reg. 6 and new Sch. A1, as amended by the Data (Use and Access) Act 2025 from 2026-02-05 ([ICO](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2026/02/statement-on-the-commencement-of-the-data-use-and-access-act-duaa/)) | Error details and the ID's fraud use fit the UK exceptions. No UK-specific default needed | Medium-high |
| UK: give people a way to complain to the controller, and acknowledge complaints within 30 days | DPA 2018 s.164A (DUAA, in force 2026-06-19) | Policy: "Your rights", complain to us first at the privacy mailbox; acknowledged within 30 days | Medium |
| UK: services likely to be used by under-18s follow the Children's Code: DPIA, high-privacy defaults | [ICO Children's Code](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/services-covered-by-this-code/) | Not copy. A DPIA covering 13–17-year-olds, including the error-details default (decision 3). Lawyer item 17 | Medium |
| EU trader status: the App Store removes EU apps without verified trader status; the trader's address, phone and email are shown on the EU product page | EU Digital Services Act; [Apple](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/) | Not copy. Notes 10–12 (decisions 2 and 3 at the top): a business address and phone, not personal ones, and Play moved to an organization account first | High (Apple enforcement since 2025-02-17) |
| Tell people they're dealing with AI, unless it's obvious | [AI Act Art. 50](https://artificialintelligenceact.eu/article/50/) | Consent lead: "AI companies that work for us write the code" | Medium |

### United States

| Obligation | Source | Met by | Confidence |
|---|---|---|---|
| No deceptive privacy claims; a material change can't apply to data already collected without opt-in | FTC Act §5; [Gateway Learning](https://www.ftc.gov/news-events/news/press-releases/2004/07/gateway-learning-settles-ftc-privacy-charges) | Re-consent rule, enforced on the server per request (B10); "we'll ask you first" | High |
| Effective date, categories collected, categories of third parties, how to review data, how changes are announced, how Do Not Track is handled, and whether other parties may collect information about a person's activity over time and across sites | [CalOPPA, Bus. & Prof. Code §22575(b)(1)–(6)](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=22575) | Policy header ("Effective"), tables, "Your rights", "Changes to this policy", "Do Not Track" (covers (b)(5) and (b)(6)) | Medium-high |
| Nothing directed at children under 13; no actual knowledge | [COPPA](https://www.ftc.gov/business-guidance/resources/childrens-online-privacy-protection-rule-not-just-kids-sites) | 13+ rating; policy "Children". Whim doesn't ask for age. A store age signal (next row) isn't asking, but COPPA knowledge could follow from it | Medium |
| App Store Accountability Acts: use the store's age-category and consent signal to verify age and parental consent for users in a minor bracket (under 18) (§121.054), use that data only for compliance and delete it once verified (§121.055), and notify each store before any significant change to the terms or privacy policy (§121.053) | Texas SB 2420 ([enrolled text](https://capitol.texas.gov/tlodocs/89R/billtext/html/SB02420F.HTM)), in force since 2026-01-01: the Fifth Circuit stayed the district court's injunction (administratively 2026-05-28, in full 2026-06-04), and on 2026-07-06 the Supreme Court denied emergency applications to vacate that stay (Nos. 25A1389, 25A1390). Enforcement continues; the constitutional merits are still on appeal ([Wiley](https://www.wiley.law/alert-Key-Developments-With-State-App-Store-Accountability-Acts-as-Texas-Act-Takes-Effect), [SCOTUSblog](https://www.scotusblog.com/2026/07/supreme-court-allows-texas-to-enforce-law-requiring-age-verification-and-parental-consent-on-app/), [FPF comparison](https://fpf.org/blog/comparing-enacted-app-store-accountability-acts/)). Utah (2027-05-06), Louisiana (2027-07-01) and California AB 1043 (2027) follow | Not met. Note 18 (Apple Declared Age Range and Play age signals, kept on the phone). Policy "Children" gets a conditional paragraph. The §121.053 notice is a standing step in the change process ("Later, when triggered"). Lawyer item 7 | High on the duties (enrolled bill text read in the fact-check); low on how the stores' APIs implement them and how a store takes the §121.053 notice |
| Consumer health data about Washington residents: a separate health-data privacy policy linked from the app, consent separate from other agreements, private right of action. No size threshold | [Washington My Health My Data Act](https://iapp.org/resources/article/washington-my-health-my-data-act-overview) (Nevada SB 370 is similar) | Open. Whim doesn't keep requests (decision 2), but prompts like "track my insulin doses" pass through with the device ID. Lawyer item 16. Keeping terms off the consent tap already helps | Medium |

CCPA and most comprehensive state laws don't apply yet. CCPA's thresholds are in eu-uk-us.md §2.3, but the lowest comprehensive-law thresholds are well under the 100,000 consumers that section treats as the usual figure. Montana's is confirmed at 25,000 of its residents a year since its 2025 amendment (SB 297, in force 2025-10-01). Delaware and Maryland are reported at around 35,000 but weren't re-checked. That's low enough to track, not footnote: crossing it would attach access, deletion and opt-out duties with nothing in the code to warn anyone. Whim can't tell which state a user is in, so the trigger in "Later, when triggered" is the US total nearing 25,000. The policy still states the no-sale, no-share position those laws ask for, since it costs one sentence. Washington's health-data law (above) has no threshold at all.

### Other countries

Not researched, apart from one regime a reviewer found that needs a detail this draft otherwise drops.

| Obligation | Source | Met by | Confidence |
|---|---|---|---|
| Overseas transfer for outsourcing or storage needed for the service is allowed if the privacy policy discloses the items transferred, the destination country, the recipient's name and contact, the purpose and the retention period; outsourcees must be published | South Korea PIPA Art. 28-8 (2023 amendments, in force 2023-09-15) and Art. 26 ([Lexology](https://www.lexology.com/library/detail.aspx?g=4e246fbb-9f7a-48dc-9435-410a577d6ff8), [Baker McKenzie](https://connectontech.bakermckenzie.com/south-korea-issues-guidelines-on-applying-the-personal-information-protection-act-to-foreign-business-operators/)) | Policy: "Who handles it right now", a list of current providers with country and contact that sits outside the consent manifest and is updated with notice (decision 17). This is the case the owner's principle carves out: a law requires the exact detail | Medium |
| Brazil (LGPD), Japan (APPI: consent for providing data to a third party abroad), India (DPDP) and others | Not researched | Lawyer item 15 before those storefronts stay on | Low |

## What goes

Every current statement that is neither required nor a core promise, and every one that's false. "False" means false today, measured against the code or the platform's own definition.

### Consent screen (`src/host/launcher/copy.ts`)

| Current | Verdict | Why |
|---|---|---|
| "The server uses AI models from other companies, reached through OpenRouter, to write the app." | Widen | Naming the router ties the screen to a vendor that `docs/decisions.md` already plans to replace with direct APIs. The role ("AI companies that work for us") is what the law and Apple ask for. |
| "An anonymous ID for this phone, used for daily limits" | Reword. The purpose is too narrow | "Anonymous" is a legal claim the ID doesn't meet (it's pseudonymous). The ID is also used for abuse prevention (Data safety already says so) and, once diagnostics ship, for per-device caps, and the screen names only daily limits. |
| "What never gets sent: Anything you save inside your apps" | Keep the promise, reframe it | Core promise, now stated as who can read it ("Nobody at Whim can read it"), so encrypted sync can ship without breaking it (summary 6). |
| "What Whim sends has changed since you last agreed." | Reword | Say what changed, from the manifest. |
| Missing: who else, outside Canada, core promises, error details, ask-first | Add | Quebec s.8, OPC's four elements, Apple 5.1.2, planned diagnostics. |

### Privacy policy (`deploy/site/privacy.html`)

| Current | Verdict | Why |
|---|---|---|
| "…AI models from other companies, reached through OpenRouter…" (twice) | Widen | Same as above. OpenRouter appears in the policy's "Who handles it right now" list (decisions 6 and 17), not inside a promise. |
| "Which models Whim uses can change without notice" | Drop "without notice" | It reads as evasive, and Quebec expects notice when the policy changes. The draft covers provider switches as within the disclosed role. |
| "…may process your request outside Canada." | Keep | Quebec s.8 requires it. |
| Reports "go to AnyCognition, not to the AI model providers" | Widen | Implementation detail. It would block using a service provider to store or help review reports. The recipient role is what matters. |
| "Reports are deleted after 90 days" / ledger "kept for 90 days" | Widen to an outer bound | The number is a config value (`WHIM_REPORT_RETENTION_DAYS`, `WHIM_LEDGER_RETENTION_DAYS`). Law asks for a period or the criteria, and a bound meets that. |
| Ledger field list ("…token counts and cost") | Widen | A failure code and request id are planned. "How it ended, size and cost" covers them. |
| "Whim has no accounts, no ads, and no analytics, crash-reporting or advertising SDKs." | Split | "No ads" is core, so it stays. "No accounts" stays as a present-tense fact (decision 1). "No analytics / crash-reporting SDKs" goes: "SDK" is an implementation word, and Play files crash logs under the "Analytics" purpose, so it turns false the day diagnostics ship. |
| "There is no way for people to share apps or content with each other." | Drop | A product fact, not a data promise. If sharing ever ships it adds a recipient role and the rule asks first anyway. |
| "Server logs hold no request content, and the front proxy that serves Whim keeps no access log." | Drop | Infrastructure details (Caddy config, log format). If the owner takes decision 2, "we don't keep what you ask for" replaces the log claim in words that survive the move to Cloud Logging. |
| "Nothing here is tied to a name or account, so we may not be able to find one person's rows" | Widen | Honest but a dead end. Showing the ID in Settings (decision 8) makes rights requests workable. |
| "If what Whim sends ever changes, the app asks you to agree again." | Narrow to the rule | As written, one new diagnostic field would trigger a re-ask. |
| Missing: Privacy Officer, legal bases, rights and complaint, transfers, logs and connection data, security, equal protection by providers, Do Not Track, change process, children | Add | See the requirements table. |

### Store descriptions (`release/store/*/en-US/description.txt`, `full_description.txt`)

| Current | Verdict | Why |
|---|---|---|
| The paragraph listing exactly what is sent, "to AnyCognition's server… AI models from other companies" | Shorten | Every sentence in a listing is a public representation (Competition Act s.52, FTC). Detail belongs in the policy, where it can change with notice. |
| "An anonymous ID for this phone travels along too…" | Drop | "Anonymous" again. It's covered in the policy. |
| "Whim has no accounts, no login, no ads, and no analytics." | Drop "no analytics" | It contradicts Play's purpose for crash logs once diagnostics ship. |
| "Anything you have already saved inside an app never leaves your phone." | Keep, reworded | Core promise. Reworded to lead with "nobody at Whim can read it", which survives encrypted sync and iCloud backups. |
| Play short description "Describe an app out loud." | Note only | There's no in-app voice. Speech works through the keyboard's dictation. Not a privacy problem, but worth knowing. |

### Store declarations

| Current | Verdict | Why |
|---|---|---|
| App Privacy `OTHER_USER_CONTENT` and `DEVICE_ID`: `DATA_NOT_LINKED_TO_YOU` | **False** | By Apple's definition (linkage via device; personal data counts as linked). |
| Privacy manifest `NSPrivacyCollectedDataTypeLinked` = false for both | **False** | Same reason. |
| `answers.md`: "neither type is linked to an identity" | **False** under Apple's definition | Same. |
| No usage-record type in any declaration | **Incomplete** | The ledger keeps a row per request, with the device ID, for 90 days. That's collected usage data. |
| Data safety `deletionRequestMechanism`: "There is no account to delete data from…" | Reword | It contradicts the policy, which invites deletion requests. |
| Data safety `sharedWith: "AI model providers through OpenRouter"` | Widen | Internal note only, but keep the vendor out. |
| `answers.md`: "Whim ships no ad SDK and no analytics or crash-reporting SDK" | Reword at diagnostics launch | True today (diagnostics go to Whim's own server, no SDK), but the reviewer answer should say "no ad or tracking SDK". |

### App Review notes (`notes.txt`, `docs/store/review-notes.md`)

| Current | Verdict | Why |
|---|---|---|
| "[TODO -- network-deny is not fully shipped yet]" | Stale, but keep for now | The code merged on both platforms. On-device acceptance (13.6, 13.7) hasn't run, so keep the careful wording until it does, then delete the TODO. |
| "Nothing else: no analytics, no crash reporter, no ads SDK, no background telemetry." | Replace | It stops being true when diagnostics ship. Draft paragraph in `draft-copy.md`. |
| Consent screen described as naming OpenRouter | Update | Name OpenRouter in the notes instead (reviewer-only), not on the screen. |

### Report sheet and Settings (`copy.ts`)

| Current | Verdict | Why |
|---|---|---|
| "An anonymous ID for this phone travels with this report, which goes to AnyCognition." | Reword | "Random", not "anonymous". |
| "Thanks. The Whim team reads every report." | Drop the promise | A promise Whim doesn't need to make, and "every" won't scale. |
| No privacy policy link on the report sheet | Add | Reports skip the consent screen, so the sheet is the at-collection notice (Quebec s.8). |
| Settings server-address override ("Where Whim sends your prompts to build apps.") | Note 7 | If the override ships, the policy needs a line that it doesn't cover other servers. |

## Consent

### What truly needs opt-in

| Flow | Opt-in needed? | Basis |
|---|---|---|
| Request and app material to Whim's server and AI providers | **Yes.** It's the one item every source agrees on | Apple 5.1.2(i) requires explicit permission before sharing with third-party AI, whatever the law says. Play's prominent-disclosure test very likely applies. PIPEDA leans toward express consent (canada.md §b). Under GDPR it can rest on contract, since building the app is the service the user asked for. |
| Random phone ID | No separate ask; the one Agree covers it | Legitimate interest and necessity under GDPR (fraud prevention is named in Recital 47). The ePrivacy strictly-necessary exemption holds only while the ID is single-purpose (eu-uk-us.md §1.3), and it isn't: it keys limits, abuse control and cost records. So for EU users the policy says the Agree tap is also the consent to storing and reading the ID, and turning AI features off withdraws it (the ID is only read to send a request). UK: the DUAA fraud and fault exceptions fit. Implied consent under PIPEDA. Apple 5.1.1(ii) wants consent for any collection, which the one screen gives. |
| Usage records | No | Same as the ID. |
| Connection data and server logs | No | Security is a legitimate interest (GDPR Recital 49). Nobody expects a server with no logs. |
| Error details | **EU unsettled; UK settled** | Legitimate interest under GDPR. In the UK, PECR now exempts storage or access strictly necessary to "prevent or detect technical faults" (DUAA, from 2026-02-05). In the EU, ePrivacy may still count it as needing consent (eu-uk-us.md §1.3 calls this the most contested item); the own switch is the consent there. Apple 5.1.1(ii) wants consent. |
| Reports | No separate ask | Sending one is the user's own act. The sheet shows exactly what goes, and tapping Send is the consent. |
| App-integrity check (#65) | No separate ask; the one Agree covers it | Fraud prevention and security, a legitimate interest (GDPR Recital 47). The consent screen names Apple and Google as checkers. Under EU ePrivacy the key App Attest stores on the phone is arguably strictly necessary for security, and the Agree tap covers it if not (lawyer item 4). |
| App version and build (#64) | No | Part of connection data. Every request needs it to be answered correctly. |
| Purchase records (premium, later) | No separate ask | Buying is the user's own act, like a report. The paywall says what Whim gets from the store. Contract under GDPR. |
| Sync and backup (premium, later) | **Yes, its own** | A new optional category. It asks the first time it's turned on and sends nothing before that. It never moves the main consent version, as long as it stays unreadable to Whim. |
| Bring-your-own-key (later) | **Yes, its own** | Requests go to a provider the user picked, under the user's contract. |

### One Agree, several jobs

The single "Agree and continue" does different legal work in different places, and the policy says so:

- For Apple and Play it is the explicit permission and affirmative action before data goes to third-party AI.
- In Canada and Quebec it is express consent to the practices described.
- Under GDPR it is **not** the legal basis. There, building apps rests on contract and the rest on legitimate interests. That keeps GDPR's bundling rules (Art. 7(4)) and child-consent ages (Art. 8) from attaching to the core service. A lawyer should confirm this framing (lawyer item 5).
- Under the EU ePrivacy rule it **is** the consent to storing and reading the phone ID on the device. The error-details switch is the consent for error details.

It does not accept the terms of use. Play forbids bundling the data disclosure with unrelated disclosures, and a contract is unrelated. Washington's health-data law, if it applies, wants consent separate from other agreements too. The terms get their own step (decision 9).

Error details are the one item that isn't needed to build an app, which is why they get their own switch. That way agreeing to the AI features never forces diagnostics on anyone who objects.

### Proposed screen structure

One screen, reached the first time the user does something that would send data (unchanged from today's spec). Top to bottom:

1. **Title and one-line lead.** What happens and that AI does the writing.
2. **What gets sent.** Four bullets: the request, app material (never the data itself), a random phone ID, error details.
3. **Why.** One sentence listing every purpose in the manifest, in short words, including running Whim within its costs.
4. **Who gets it.** AnyCognition and companies working for it, some outside Canada, which can't train AI on it or use it for their own products; Apple or Google, which may check that requests come from the real Whim app; authorities when the law requires it. The manifest says which recipient roles the screen must name.
5. **What you save in your apps.** The core promise: nobody at Whim can read it.
6. **What we never do.** No ads, no selling or sharing for advertising, no cross-app tracking.
7. **Ask-first line.** The re-consent rule in one sentence, at category level.
8. **Settings line.** AI features and error details can each be turned off, and apps keep working.
9. **Link.** Privacy policy.
10. **Agree and continue / Not now.**

When the stored grant is outdated, one line goes above the title: "This has changed since you last agreed", plus a "what's new" line generated from the manifest diff. It must name every widening, including a longer keep-period.

The terms step is a separate screen shown right before this one on first use (decision 9): a short line, a link to the terms, and "Accept". It's a contract step, so it carries nothing about data.

### Why this won't need another ask

- Diagnostics, the ledger's failure code and request id, and any new allowlisted diagnostic field fit inside the "error details" and "usage records" categories.
- Moving off OpenRouter, switching model vendor, moving logs to Cloud Logging and owner alert emails are all providers inside an existing role ("companies that do work for us").
- Device attestation (#65) is in the v2 manifest as its own category and recipient role, because Apple and Google may run those checks partly under their own terms and so might not fit "companies that work for us". The version and build header (#64) sits in "Connection and log data". The provider-outage message (#66) sends nothing new.
- A future optional feature that sends something new (in-app voice, sync and backup, bring-your-own-key, "help improve Whim with your requests") asks for itself the first time it's used. It sends nothing until then, and the main version doesn't move. The user turning sync on is their own opt-in, not a widening for everyone.
- A premium subscription doesn't move the version either. Apple or Google take the payment under their own terms, and Whim gets a purchase record only when the user buys, which is the user's own act (the same path as a report).
- Only things that change the deal for everyone move the version: accounts, a new kind of data in the core flow, a recipient that uses data for its own ends, a new purpose such as training on requests, keeping something longer than its published maximum, turning an optional item on by default, or a weaker core promise. Sync that Whim could read is the last kind, and no opt-in can carry it.
- The published maximums leave room: 12 months for reports and usage records, 90 days for error details, connection data and logs, against today's 90-day and roughly 30-day settings.

## Re-consent rule

Drop-in requirement for the `ai-data-consent` capability (SHALL on line one, as strict validation expects):

```markdown
### Requirement: The consent version changes only when the disclosure manifest widens
The launcher SHALL bump `AI_CONSENT_VERSION` whenever the published disclosure manifest widens, before any app or server practice that relies on the wider manifest takes effect, and SHALL NOT bump it for any other change unless a reviewed reason entry records why.

The disclosure manifest SHALL be one checked-in, typed structure listing: the data categories that can leave the phone, each described at category level together with what the category excludes, whether Whim keeps it, its published maximum keep-period, and how it is consented to (the main grant, its own opt-in, or an act the user takes for that purpose), plus whether an optional category is on by default; the recipient roles, marking which ones the consent screen must name; the purposes; the allowed (category, role, purpose) combinations; and the core promises. The consent screen, the privacy policy and the store declarations SHALL be checked against it. A version-1 manifest describing the v1 disclosure SHALL be checked in as the first baseline.

A change widens the manifest when it:
- adds a data category covered by the main grant, such as audio, location, contacts, or a name or email;
- adds a field whose content the category's description excludes, such as typed text in error details or saved data in app material; such a field counts as a new category;
- adds a (category, role) or (category, purpose) combination, such as requests used to train or evaluate AI models, or any data used for advertising;
- adds a recipient role, such as a party that may use data for its own purposes;
- makes a category Whim keeps that the manifest lists as not kept, or lengthens a category's published maximum keep-period;
- changes an optional category's default from off to on, or moves a category from its own opt-in or a user act into the main grant;
- removes or narrows a core promise, for example by letting anything saved inside a mini-app reach Whim in a form Whim can read, whatever consent path it takes.

A change does not widen the manifest when it rewords or translates copy; adds, removes or switches a provider within an existing role; adds a field inside an existing category that the category's description does not exclude; changes a keep-period within the published maximum; removes or narrows anything; or adds an optional category that keeps every core promise and leaves the phone only after the user turns its feature on (such as sync, backup, in-app voice or bring-your-own-key) or takes an act for that purpose on a screen that says what goes (such as sending a report or buying a subscription), and sends nothing before that. Such a category is added to the manifest with its own consent path; the feature's own screen records the user's choice, and the main version does not move.

A release check SHALL run on every app build and every server deploy. It SHALL compare the manifest with the manifest of the last released consent version, and SHALL fail when the manifest widened without a version bump, and when the version was bumped although the manifest did not widen and no reviewed reason entry (for example, a defect found in the previous consent, or data sent without a grant) explains the bump. When the version bumps, the consent screen SHALL show one line, derived from the manifest diff, naming everything that widened.

The client SHALL send the consent version it was granted under with every request to `/v1/*`. The server SHALL NOT apply to a request any practice that the manifest of that request's granted version does not list; a request from an older grant is either handled under its own version's practices or refused with a signal that makes the app ask again.

#### Scenario: Switching AI provider does not ask again
- **WHEN** the server moves from OpenRouter to a model vendor's direct API, and both act only for Whim
- **THEN** the manifest is unchanged and `AI_CONSENT_VERSION` stays the same

#### Scenario: A new diagnostic field does not ask again
- **WHEN** the diagnostics allowlist gains a field and the ledger gains a `failure_reason` column
- **THEN** both fall inside existing categories and the version stays the same

#### Scenario: Accounts ask again
- **WHEN** a release adds sign-in with an email address
- **THEN** the manifest gains a category, the release check fails until the version is bumped, and the consent screen names the new category

#### Scenario: A new purpose asks again unless it is its own opt-in
- **WHEN** requests start being kept to evaluate model quality
- **THEN** the version bumps, unless the feature is an optional switch that asks on first use and sends nothing until the user agrees

#### Scenario: Turning on sync is the user's own opt-in
- **WHEN** a release adds end-to-end encrypted sync, off by default, with its own consent screen the first time a user turns it on
- **THEN** the manifest gains an optional category with its own opt-in, `AI_CONSENT_VERSION` stays the same, and nothing is synced for a user who hasn't turned it on

#### Scenario: Sync that Whim could read asks everyone
- **WHEN** a sync design would let Whim decrypt saved data, for example by holding a recovery key
- **THEN** it narrows a core promise, the release check fails until the version is bumped, and the feature's own opt-in does not count as consent for it

#### Scenario: Buying a subscription does not ask everyone
- **WHEN** a release adds a subscription bought through App Store or Google Play in-app purchase, and the server starts receiving the store's purchase record
- **THEN** the purchase record is an optional category consented to by the purchase itself, the paywall says what Whim receives, and the version stays the same

#### Scenario: A bump with nothing new is refused
- **WHEN** `AI_CONSENT_VERSION` changes, the manifest does not widen, and no reviewed reason entry exists
- **THEN** the release check fails, so nobody is asked again for a wording change

#### Scenario: A longer keep-period asks again
- **WHEN** the published maximum for reports goes from 12 months to 5 years
- **THEN** the manifest widened, and the release check fails until the version is bumped

#### Scenario: A server-only change can't skip the ask
- **WHEN** a server deploy adds a purpose to requests without an app release
- **THEN** the deploy check fails until the version is bumped, and requests still carrying the old granted version don't get the new practice
```

### Manifest, version 2

This is what the draft copy discloses, and it's the baseline the check compares against.

| Category | What it is | Excludes | Whim keeps it? | Published maximum | Default |
|---|---|---|---|---|---|
| Request | What you type or dictate, your answers, the plan you approve | | No, only while the request is handled (decision 2), except inside a report | While handled | Core |
| App material | For a change: an app's name, code, description and data layout | Anything saved in the app | No | While handled | Core |
| Phone ID | Random ID made on the phone | Hardware IDs, name, number | Yes, inside usage records and reports | As those records | Core |
| App-integrity check (#65) | A key made on the phone and a verdict from Apple or Google on whether a request comes from a genuine Whim app on a real device, bound to the phone ID | Hardware IDs, the user's Apple or Google account | Yes | 12 months after the phone ID's last use | Core |
| Usage records | Per request: type, times, how it ended (including an error code), size, cost, request number; running lifetime totals per phone ID | Request content | Yes | 12 months (lifetime totals: 12 months after the phone ID was last used) | Core |
| Error details | Technical details when something breaks: versions, error type from a fixed list, code location, screen, request number | Typed text, saved data, any free-text error name or message from a mini-app (B9) | Yes | 90 days | Optional, on (decision 3) |
| Connection and log data | IP address, times, the app's version and build number (#64), the consent version (B10) and similar details any server sees, including visits to Whim's website; security and operational logs | Request content | Yes | 90 days | Core |
| Reports | Reason, note, app name, the app's code if saved, and the prompt if the user includes it | Anything saved in the app, unless the user types it into the note | Yes | 12 months | User-sent |

Recipient roles: AnyCognition (screen names it); service providers acting only for AnyCognition, such as hosting, AI, logging and email, which may keep data briefly for their own security and legal duties but never train AI on it or use it for their own products (screen names it); the phone's platform, Apple or Google, for app-integrity checks under their own terms, and for verifying a purchase the user made with them (screen names it); authorities when the law requires it, and handling fraud, security or safety problems (screen names it); a successor if Whim changes hands, bound by the same policy (policy only).

Purposes: build and change your apps; run Whim (daily limits, abuse and fraud prevention, security, keeping it working, finding and fixing problems, cost and capacity); handle reports and keep Whim safe; meet legal obligations.

Store mapping, recorded with the manifest: every type is "Linked" on Apple. Apple purposes are App Functionality plus Analytics for usage records and error details; Play purposes match. Play "Shared" follows one rule: a type is Shared when it goes to a recipient whose service-provider status isn't yet confirmed (today, only request content and app material, which go to AI providers). Once lawyer item 3 confirms the AI providers are service providers, it becomes No for every type. The app-integrity key and verdict ride with the phone ID, so they map to Apple's Device ID and Play's "Device or other IDs" (purposes: fraud prevention, security); whether either store expects App Attest or Play Integrity to be declared separately wasn't checked (note 22). Purchase records would map to Apple's Purchases and Play's "Purchase history" when a subscription ships.

Outside the manifest: the "Who handles it right now" list in the policy (current providers by name, country and contact). It changes with notice and never moves the version, because each entry sits inside an existing role.

Core promises: nobody at Whim can read what's saved inside mini-apps (it reaches Whim, if ever, only encrypted on the phone with a key Whim never has, and only through a feature the user turns on); no ads; no selling or sharing for advertising; no tracking across other apps and websites; plus decision 2 if the owner takes it (request content isn't kept).

Added later without moving the version, each with its own consent path (the rule's non-widening case):

| Category | What Whim gets | Consent | Keep-period to publish |
|---|---|---|---|
| Purchase records (premium) | What was bought, when it started and renews or ends, and the store's transaction reference, which is the same on every phone that shares the subscription. Never card details, name, email or the store account | The purchase, with a line on the paywall | While the subscription runs, then within 12 months unless tax law needs longer |
| Sync and backup (premium) | Saved data and apps, encrypted on the phone; plus what any sync service sees: sizes, times, and which phones share a sync | Its own opt-in, off by default | Until the user turns sync off or deletes it, then within 90 days |
| Bring-your-own-key | Requests go to the user's chosen provider under the user's contract | Its own opt-in | Whim keeps nothing new |

What would widen: Whim accounts, sync Whim can decrypt, and turning any of these on by default.

## Terms of service

No statute in the research requires a terms document (practice-and-terms.md A5). Whether Play requires a terms link wasn't verified. The case for having terms is liability, not compliance: without them, a user's app that miscalculates a dose or a bill has nothing saying AI output can be wrong.

| Platform | What applies without Whim doing anything | Gap | Recommendation |
|---|---|---|---|
| iOS | Apple's [Standard EULA](https://www.apple.com/legal/internet-services/itunes/dev/stdeula/): the license, and Apple's disclaimers | Nothing on AI output, acceptable use, cutting off abusers (4.7.1), the server relationship, governing law | Publish terms of use at `/terms` and keep the Standard EULA. A custom EULA means carrying Apple's ten [minimum terms](https://www.apple.com/legal/internet-services/itunes/dev/minterms/); skip it unless a lawyer wants something the Standard EULA lacks |
| Android | Google Play's terms, which bind the user and Google only | No license and no disclaimer at all | The same terms of use. Their section 3 grants the licence |
| Web pages | Nothing | | Host the terms beside the policy |

Acceptance: a separate terms step right before the data consent screen, the first time someone turns on the AI features, with its own "Accept" button. A clear tap is what makes terms enforceable, and a separate step keeps the Play disclosure free of unrelated content (and matches Washington's separate-consent rule if it applies). Using the examples offline needs no terms. Terms changes are versioned separately from the consent version and don't re-ask for data consent. Material changes get 30 days' notice in the app.

Language: Quebec's Charter s.55 wants the terms offered in French first, with English only after an express choice (decision 16). The step can do that: French first for fr-CA users, with a "Continue in English" choice.

The terms reserve the right to stop a phone's ID from building apps. The server has no block list today (`server/src/admission/` has limits and refusals but no per-ID block). The review notes answer 4.7.1's "block abusive users" by saying there's no user-to-user content to block. That holds while nothing is shared, but a block list by phone ID is a cheap follow-up if App Review pushes. Once attestation (#65) makes IDs expensive to mint, such a block actually binds. Blocking by IP address is off the table: the owner decided against per-IP limits, because shared Wi-Fi and carrier NAT put many people behind one address.

A premium subscription adds to the terms without changing the free ones: a short section saying the store sells and bills it, cancellations and refunds go through the store, what's included can change with notice, and, once sync exists, that Whim can't recover encrypted data if the user loses every device and their recovery key. Draft wording is in `draft-copy.md` §6, bracketed until it ships. Adding it isn't a material change for existing users, since it only binds people who buy.

## Decision notes

The detail behind the seven decisions at the top. The numbers stay fixed because `draft-copy.md`'s [D…] markers point at them. Most notes are no longer separate decisions:

- Folded into a top decision: 1, 2 and 21 (decision 1); 12 and 17 (decision 2); 10 and 11 (decision 3); 16 (decision 4); 9 (decision 5); 3 and 5 (decision 6).
- Consequences, now tasks in "Do before public launch": 4 (Apple's definition leaves no choice), 7, 8 (the rights promise needs it), 18 (Texas law is in force), 19 and 20.
- Defaults nobody needs to decide: 6, 14, 15. Later triggers: 13, 22.

1. **Is "no accounts" a core promise?** Recommendation: no. State it as today's fact ("Whim doesn't have accounts"). If accounts ever come, they're a new category and the rule asks everyone anyway, so a promise buys nothing and risks sounding broken. The premium tier makes this more likely to matter: build subscription and sync without Whim accounts if you can (note 21).
2. **Does Whim promise not to keep what people ask for once the request is done (except inside a report)?** Recommendation: yes. It's true today, it's the promise people care about after "saved data stays on the phone", and it replaces three implementation claims about logs and the proxy. If real requests are ever wanted for improving Whim, make that a separate opt-in switch. Apple 5.1.2(ii) would require fresh consent anyway.
3. **Error details: separate switch?** Recommendation: a "Send error details" switch in Settings, on by default and named on the consent screen. The UK question is settled (fault detection is exempt since 2026-02-05). If a lawyer says the EU needs opt-in, default it off there. The UK DPIA for 13–17-year-olds (Children's Code) has to justify "on"; if it can't, default it off in the UK too. The screen wording doesn't change either way. Once shipped, turning it on by default where it was off counts as widening.
4. **App Store "linked to you".** Recommendation: declare every type Linked. Apple's definition leaves no real room, and "Not linked" is a promise past what's true. The cost is that the listing shows "Data Linked to You" rather than "Not Linked". The policy now has a sentence explaining the label: it's tied to the phone's Whim ID, and never used to track across other companies' apps. This also changes the `developer-observability` design (D11) and its spec, which expect "not linked".
5. **Keep-periods.** Recommendation: publish outer bounds, not config values. Reports and usage records within 12 months; error details, connection data and logs within 90 days. Keep today's settings (90 days, and about 30 days for Cloud Logging). The bound is the promise, the config is free to be shorter. v1 promised 90 days for reports and ledger rows, so the v2 "what's new" line says the bound grew, and records made under v1 keep the 90-day rule (today's config already does that). Pick smaller numbers if you like, for example 90 days everywhere, which would drop that line; lawyer item 9 checks the bounds are defensible.
6. **Name the AI routing company?** Recommendation: not on the consent screen. Name it in the policy's "Who handles it right now" list (decision 17), which changes with notice and sits outside the manifest, and in the App Review notes. If App Review insists on a name on the screen, add it as a separate "Right now:" line that the manifest treats as wording.
7. **Keep the Settings server-address override in store builds?** Recommendation: take it out of release builds. It lets requests go to a server the policy can't vouch for. If it stays, the draft policy has a line for it.
8. **Show the phone's ID in Settings, with a way to make a new one?** Recommendation: yes. It makes access and deletion requests possible, it matches Play's preference for resettable IDs, and it's a small change.
9. **Adopt terms of use, and how are they accepted?** Recommendation: yes, with governing law Ontario, accepted in a separate step right before the data consent screen with its own "Accept" button. Not on the consent screen: Play's prominent-disclosure rule forbids bundling unrelated disclosures, and a contract is unrelated.
10. **Legal identity and contact.** Confirm the exact legal name ("AnyCognition Inc." is used everywhere), the address to publish (Apple's minimum terms and Quebec both want contact details), and a privacy mailbox. EU distribution adds the DSA trader declaration on both stores, which shows an address, phone number and email publicly on the EU listing. Recommendation: a business address and phone (a virtual office or a business line), not personal ones, used the same way in the policy, the terms and both trader declarations. The Privacy Officer is the owner by default; publishing the title is enough.
11. **Play account.** The Play developer account is a personal account, not AnyCognition Inc.'s (`docs/store/review-notes.md` §6), so the Play listing and the policy name different parties, and a Play DSA trader declaration would publish a private person's details. Recommendation: move to an organization account under AnyCognition Inc. before public launch, and make the Play trader declaration only after that.
12. **EU and UK at public launch.** Staying available there means paid Article 27 representatives (one EU, one UK), transfer terms, verified DSA trader status (Apple removes EU apps without it), possibly the UK ICO fee, and a UK DPIA covering 13–17-year-olds. The representatives aren't a "possibly": Art. 27(2) exempts only processing that is occasional and low-risk and free of large-scale sensitive data, all at once, and a service people use every day isn't occasional. Recommendation: if EU/UK users aren't a launch goal, leave those storefronts off until the paperwork is done. The copy works either way.
13. **In-app voice.** Voice works today only through the keyboard's dictation, so Whim receives text. Recommendation: if you add in-app recording, ship it as an optional feature that asks on first use, not as part of the main consent.
14. **Age floor.** Recommendation: keep 13+ for now, with "a parent's permission where local law requires it" in the terms, pending lawyer item 7. Decision 18 covers the store age signals that Texas already requires.
15. **Human review of refusals.** Recommendation: say that a person will look if someone thinks the automated safety check refused them wrongly. It's cheap, and it covers Quebec's automated-decision rule (s.12.1) if that ever applies.
16. **French.** Recommendation: before public launch, French versions of the terms, the terms step, the consent screen and the privacy policy, with French shown first to fr-CA users and an express choice of English. Quebec's Charter s.55 likely requires it for the terms, and s.52 may reach the rest (lawyer item 14). A translation is a wording change, so it never moves the consent version.
17. **Launch territories and the provider list.** Recommendation: two parts. First, publish a "Who handles it right now" list in the policy naming the current providers (hosting, AI routing, the model providers OpenRouter may route to), their countries and a contact, updated with notice and kept outside the consent manifest. That meets Korea's PIPA, Play's "any parties" clause and GDPR's recipients item in one place without tying any promise to a vendor. Second, until a lawyer has looked at Brazil, Japan and India (lawyer item 15), either restrict the storefronts to Canada, the US, the EU/UK (per decision 12) and Korea, or accept that risk knowingly.
18. **Store age signals.** Texas's App Store Accountability Act is in force now (the Supreme Court declined to lift the Fifth Circuit's stay of the injunction; the merits are still on appeal), and Utah, Louisiana and California follow in 2027. Recommendation: integrate Apple's Declared Age Range and Play's age signals, keep the result on the phone, use it only to apply age rules (including parental-consent gating through the store for Texas minors), delete it once verified as §121.055 asks, and send nothing about age to the server. The policy's "Children" section has a conditional paragraph for it. This also answers Apple 4.7.5. The Act also makes each significant terms or policy change a notice to each store first (§121.053), which belongs in the change process, not the copy. Confirm the exact duties with a lawyer (item 7).
19. **Play "Shared" answer.** Recommendation: one rule, recorded with the manifest (a type is Shared when it goes to a recipient whose service-provider status isn't confirmed). Today that means request content Yes and everything else No. Flip request content to No once B1, B3 and lawyer item 3 are done; nothing in the app or consent changes when it flips.
20. **The lifetime `usage` table.** Decided by the owner (2026-09-23): keep it, because lifetime totals are its purpose. It is declared as linked usage data and purged 12 months after a phone ID was last used (B8). The editors had recommended dropping it; that recommendation is withdrawn.
21. **Premium, sync and the saved-data promise** (owner input, 2026-09-23). The likely premium tier is a subscription bought through App Store or Play in-app purchase, with more generations and optional sync and backup of mini-apps and their saved data across phones; bring-your-own-key may follow for power users. Recommendation: write the saved-data promise around who can read it: "Nobody at Whim can read it. It stays on your phone, and anything Whim ever syncs or backs up for you is encrypted on your phone with a key Whim never has." Checked against the absolute-words concern (lawyer item 8): "nobody at Whim can read it" holds today because Whim never receives saved data, holds under iCloud backup because that copy is Apple's and the user's, and holds under sync only if the key never reaches Whim, so no key escrow and no Whim-side recovery. The one exception, a user typing saved data into a report's note, is in the policy. What this binds: sync must be end-to-end encrypted, and its opt-in screen must say what Whim can still see (sizes, times, which phones share a sync). The store takes the payment under its own terms, so Whim never sees card details; the purchase record the server checks for "more generations" is an optional category consented to by buying. None of this needs an account, and keeping it that way keeps "no accounts" true.
22. **Device attestation** (#65). Apple App Attest and Google Play Integrity let the server check that a request comes from a genuine Whim install, and bind the phone ID to an attested key so a script can't mint IDs. Recommendation: disclose it in v2, before it ships: an "App-integrity check" category, Apple and Google as a named role on the consent screen, a row in "Who handles it right now" once live, and the key under B8's keep-period and delete tool. They may process those checks partly for themselves, which is why they're a separate role rather than "companies that work for us" (lawyer item 3). Whether either store form wants App Attest or Play Integrity declared on its own is unverified; check when it ships. #64's version header and #66's outage message need nothing beyond what v2 already says.

## Check with a lawyer

1. **Quebec's actual statute text.** Nothing Quebec-specific was read first-hand: legisquebec and CanLII both refused the fetch (canada.md, gap 1). Stakes are high because there's no size exemption and s.93.1 sets a $1,000 punitive-damages floor. Sections: 3.1, 3.3, 8, 8.1, 8.2, 12.1, 14, 17, and 4.1 (under-14 consent, which isn't in the research files; I'm going on general knowledge).
2. **The s.17 assessment and agreement.** What the written agreement must contain when the recipient is a US router (OpenRouter) passing requests to other providers. Whether OpenRouter's standard terms or DPA can serve. Whether the s.3.3 assessment for a new information system was already due.
3. **Provider role.** With B1 in place, are OpenRouter and the model providers service providers or processors under GDPR, Quebec law and Play's definition, given that some keep requests for their own abuse monitoring and legal compliance? The answer flips Play's "shared" answer (decision 19), transfer mechanics and the assessment's scope. If Play's "Shared: Yes" stays, does naming the providers in "Who handles it right now" satisfy the policy's "any parties with which … data is shared"? Related: DeepSeek models can be served from several countries. Should routing be limited by country for EU and Quebec users? Same question for Apple and Google when they run App Attest and Play Integrity checks (#65): service providers, or controllers of their own?
4. **The EU ePrivacy question, for error details and the phone ID.** The UK half is settled by the DUAA's fault-detection and fraud exceptions. For the EU (Art. 5(3)): are error details strictly necessary, or do they need consent? And does the ID stay within the strictly-necessary exemption when it also keys cost records, or is the draft's fallback (the Agree tap is also the consent to storing and reading the ID) sound? This decides the error-details default for EU users (eu-uk-us.md §1.3).
5. **GDPR basis for sending requests to AI.** The draft uses contract, with the Agree tap as Apple's permission, Canada's express consent and the EU ePrivacy consent for the ID. Terms acceptance is now a separate step. Is the framing sound (Art. 7(2), 7(4))?
6. **The UK ICO fee** (only if UK storefronts open). The Article 27 half of this item is answered by the text: the "occasional" exemption needs all three of its conditions, so representatives are needed from the day EU/UK storefronts open. Only confirm that reading.
7. **Age.** 13+ against Quebec's reported under-14 parental-consent rule, GDPR Art. 8 (13 to 16 by country, for consent-based processing), and Texas's App Store Accountability Act (enforceable since the Supreme Court declined on 2026-07-06 to lift the stay, merits still on appeal; parental consent through the store for under-18s; Utah, Louisiana and California follow in 2027). What exactly must Whim do now for Texas users: receive the store's age category, gate on parental consent, rate on the statute's tiers? How is the §121.053 notice of a significant terms or policy change given to each store? Does the store signal create COPPA "actual knowledge"? Separately, Apple 4.7.5 asks for "an age restriction mechanism based on verified or declared age" for mini-app content above the app's rating. Keep any age data on the phone so it doesn't become a new data category.
8. **Absolute words.** "Nobody at Whim can read it" and "what we never do" are architectural or commercial facts, so they should hold. The saved-data line no longer says "Whim never receives it" on the screen, so encrypted sync can't make it false (note 21). Confirm the general-impression test (Competition Act s.52(4), FTC) doesn't catch "stays on your phone" given iCloud backups, or "nobody at Whim can read it" given that a user can type saved data into a report's note.
9. **Keep-periods.** Are 12 months for usage records and reports, and 90 days for logs, defensible under storage-limitation rules for abuse prevention and cost records?
10. **Terms.** Can Ontario governing law and a liability cap be enforced against consumers in the EU and Quebec? Quebec's Consumer Protection Act limits one-sided changes to consumer contracts (not in the research files; general knowledge). Does Play require a terms link? When premium ships: what do auto-renewal laws and Apple 3.1.2 add, given the stores do the billing?
11. **Apple 5.1.2(i) in practice.** Will App Review accept "AI companies that work for us" without a provider name on the screen? Worth pressure-testing at submission with the fallback line ready.
12. **Automated decisions.** Could the content-policy refusal, or a future automatic block, count as a decision under Quebec s.12.1 or GDPR Art. 22?
13. **Watch items, no action yet.** Bill C-36 could replace PIPEDA. The EU-US Data Privacy Framework challenge is pending. AI Act Art. 50(2) marking of generated code is untested. COPPA "actual knowledge" could arise through a report that mentions a child's age.
14. **Quebec's Charter of the French Language.** Does s.55 (French-first contracts of adhesion) reach an Ontario business distributing through app stores to Quebec consumers, and does s.52 reach the consent screen, the policy and the store listing? What does an "express choice" of English look like in an app?
15. **Countries outside the research.** Korea's PIPA (listing the Korean storefront is enough to trigger it; the draft's provider list is meant to meet Art. 26 and 28-8, but a Korean-language section on overseas transfers is also needed; confirm, and whether the list must also say how long each recipient keeps data), Brazil's LGPD, Japan's APPI (consent for providing data to a third party abroad) and India's DPDP. Which storefronts can stay on at public launch with the current text?
16. **Washington's My Health My Data Act (and Nevada SB 370).** Does it reach health details people type into requests that Whim doesn't keep but passes to AI providers with a device ID? If yes, Whim needs a separate consumer health data policy linked from the app and a separate consent, and "no size threshold" means it applies now.
17. **UK Children's Code.** Is Whim "likely to be accessed by children" at a 13+ rating? What should the DPIA cover, and does it support error details on by default for UK teens?
18. **Terms enforceability of the separate step.** Is a one-time "Accept" step before the data consent screen, with the terms linked, enough for enforceability in Ontario, Quebec (with the French-first rule) and the EU?

## What else changes if you adopt this

- `openspec/changes/store-launch-compliance/specs/ai-data-consent/spec.md`: the disclosure requirement names OpenRouter; change it to roles. Add the re-consent requirement above.
- `scripts/release/lib/store-listing.ts`: `PRIVACY_TYPE_MAPPING` allows only two types, and `checkNoLinkageOrTracking` refuses `DATA_LINKED_TO_YOU`. Both encode the old, wrong answer.
- `openspec/changes/developer-observability/design.md` D11 and its `device-diagnostics` spec ("not linked to identity"): change to linked, and point the coverage check at the manifest.
- `openspec/changes/developer-observability/specs/device-diagnostics`: a closed set of mini-app error names, with `Other` for anything else, and a red-check (B9).
- `src/host/launcher/release-config.ts`: `AI_CONSENT_VERSION` goes to 2. Its comment ("Bump it whenever what Whim sends, or to whom, changes") becomes the manifest rule.
- `src/host/launcher/transport-shared.ts` (`requestHeaders`) and the server's `/v1/*` admission: send and check the granted consent version (B10). The manifest check runs in the server deploy path as well as the app build.
- `src/host/launcher/copy.ts`, `deploy/site/privacy.html`, a new `deploy/site/terms.html`, `release/store/*`, `ios/Whim/PrivacyInfo.xcprivacy`, `release/store/app-store/review_information/notes.txt` and `docs/store/review-notes.md`: replace with `draft-copy.md`. French versions follow (decision 16).
- A new terms step in the launcher, before the consent screen (decision 9).
- `server/src/openrouter.ts`: add `provider: { data_collection: 'deny' }` (B1), and `zdr: true` where the endpoints support it.
- `server/src/usage-store.ts`: add a last-credited day to the lifetime `usage` table and purge rows idle for 12 months; `server/src/admin/cli.ts`: a `device export|delete <id>` subcommand (B8).
- The #64 version header ships in the same header change as B10. The #65 attestation record joins B8's keep-period and delete tool. The #66 outage copy follows this draft's tone and doesn't name the vendor.
- The change process gains one step while Texas's law applies: before a significant change to the terms or the policy, notify each store (§121.053).

## Verification log

Two adversarial reviews (legal accuracy, promise consistency) checked this README and `draft-copy.md`, then a fact-check and the owner's input changed it again (items 37 onward). I checked each finding against its cited code, file or source before acting. Code claims were read in the repo. Web sources re-read in this pass: OpenRouter's provider-routing and provider-logging pages and search results for its ZDR guide, Play's User Data policy, the ICO's DUAA commencement statement, and search results for Texas SB 2420, the DUAA's PECR amendments and Korea's PIPA. For the others I relied on the reviewer's citation and my own knowledge, and each one has a lawyer item.

Legal accuracy:

1. Provider retention vs "don't keep" (major): **accepted.** `deny` is documented as "use only providers which do not collect user data"; OpenRouter's ZDR guide says non-training providers may still retain for abuse or legal reasons. Copy now promises no training and no use for their own products and discloses short retention. Review notes drop "or keep". B1 notes OpenRouter's own logs.
2. Terms bundled into Play's prominent disclosure (major): **accepted.** Play's text read: the disclosure "cannot be included with other disclosures unrelated to personal and sensitive user data collection". Terms moved to a separate step; Play table row added.
3. Texas App Store Accountability Act (major): **accepted, and stronger than stated.** Search confirms the Fifth Circuit stay (June 2026) and that the Supreme Court let enforcement continue (July 2026); the court history is corrected in item 37. US row, decision 18, lawyer item 7, a conditional "Children" paragraph.
4. Quebec Charter s.55 French-first terms (major): **accepted.** Well established since 2023-06-01; reach to an app-store seller is the open part. Canada row, decision 16, lawyer item 14.
5. Research scope narrower than availability; Korea needs recipient names (major): **accepted.** Korea's PIPA disclosure duty confirmed by search. Scope note, "Other countries" table, a "Who handles it right now" list in the policy outside the manifest (decision 17), lawyer item 15.
6. DSA trader status (major): **accepted.** Apple's enforcement since 2025-02-17 is well documented. EU and Play rows; folded into decisions 10–12.
7. Washington MHMDA; lower state thresholds (minor): **accepted.** US row, lawyer item 16, threshold note corrected (medium confidence on exact figures).
8. UK DUAA changes (minor): **accepted.** ICO statement confirms 2026-02-05 commencement and complaints from 2026-06-19; search confirms the technical-faults exception. Lawyer item 4 and decision 3 now EU-only on that point; s.164A row; complain-to-us-first paragraph in "Your rights".
9. CalOPPA (b)(6) and effective date (minor): **accepted.** Sentence added to "Do Not Track"; policy and terms dated "Effective"; row expanded.
10. GDPR Art. 13(1)(f) adequacy and Art. 21(4) objection (minor): **accepted.** Adequacy position in "Where it's handled"; separate objection paragraph.
11. Phone ID not single-purpose, so ePrivacy exemption doubtful (minor): **accepted (second option).** Dropping "analytics" wouldn't make the ID single-purpose (it still keys cost records), so the policy now says the Agree tap is also the EU ePrivacy consent for the ID; withdrawal is the same switch. Lawyer item 4 widened.
12. Apple 4.7.4 and 4.7.5 missing (minor): **accepted.** Rows and review-note answers added. The 4.7.5 answer's claim that the content check refuses above-13+ content was checked against `docs/content-policy.md`.
13. Play "any parties" clause (minor): **accepted.** Row quotes the full clause; the provider list names the parties; lawyer item 3 asks whether that suffices while Shared stays Yes.
14. Required vs Optional in Data safety (minor): **accepted.** Request content, ID and usage records Required; error details Optional; the conflict with Play's opt-in wording noted.
15. Terms have no licence grant (minor): **accepted.** New section 3 licence; later sections renumbered.
16. UK Children's Code (minor): **accepted.** UK row, lawyer item 17, decision 3 now requires the DPIA to justify error details on by default.

Promise consistency:

17. Lifetime `usage` table never purged (blocker): **accepted.** Confirmed in `server/src/usage-store.ts` (CREATE TABLE `usage`, `device_id` primary key); the only purges are `DELETE FROM requests` and `DELETE FROM reports`. New blocker B8 and decision 20 (drop the table); manifest and retention rows tagged.
18. "Send something new … ask you here first" repeats the v1 defect (major): **accepted.** Screen now uses the policy's category-level wording, adds "keep it longer", drops "here".
19. Keep-periods and defaults outside the manifest (major): **accepted.** Manifest gains per-category maximums and defaults; lengthening a maximum and turning an optional item on by default now widen.
20. Server-side changes bypass an app-keyed rule (major): **accepted.** Confirmed `requestHeaders` sends only content type and `x-whim-device`. Requirement now has the client send its grant version and the server honour it; the check runs on server deploys too (B10).
21. v1→v2 "what's new" hides 90 days → 12 months (major): **accepted.** Confirmed v1 policy says 90 days. The line names the longer bound, and the policy says pre-v2 records keep 90 days.
22. Review notes "don't … keep" vs the rest (major): **accepted.** Same fix as 1; one statement everywhere.
23. Purposes differ between screen, Play and Apple (major): **accepted.** Confirmed "Top devices by cost" in `server/src/admin/cli.ts`. Screen Why names costs; Apple gains Analytics where Play has it; mapping recorded with the manifest.
24. Two rules for Play "Shared" (major): **partly accepted.** The answers follow one coherent rule (Shared = goes to a recipient whose service-provider status isn't confirmed; only request content reaches AI providers, and the ID never leaves Whim's server), so a move to Sentry would not flip an answer. But the rule was unstated. It is now written into the Data safety notes and the manifest (decision 19).
25. Saved-data promise carries no [B7] (major): **accepted.** Confirmed 13.6 and 13.7 unchecked. Tagged on the screen, policy and listing; B7 gates any v2 copy.
26. `errorClass` can carry saved data (major): **accepted.** Confirmed in `developer-observability/design.md` D2 (bounded, not closed). New blocker B9; tagged sentences.
27. Release check blocks justified re-asks; no v1 baseline; category exclusions not binding (minor): **accepted.** Reviewed-reason bumps allowed, v1 manifest as baseline, an excluded-content field counts as a new category.
28. Consent "Who" omits authorities (minor): **accepted.** Clause added; the manifest marks which roles the screen must name.
29. "We don't store what you ask for" lacks the report exception (minor): **accepted.** Confirmed the `prompt` column in `reports/store.ts`.
30. App material row over-describes reports (minor): **accepted.** Confirmed `ReportRequest` has reason, note, appName, prompt, source. Row now covers changes only.
31. iCloud backup carries the ID (minor): **accepted.** The ID lives in the launcher's KV store in the app container; Android has `allowBackup="false"`. Backup paragraph extended.
32. "Linked to you" unexplained (minor): **accepted.** One policy sentence added.
33. Website not covered by the policy (minor): **accepted.** Scope line and connection-data row cover whim.anycognition.ca and `/a/` pages.
34. No operator tool for access or deletion by ID (minor): **accepted.** Confirmed `cli.ts` has no device subcommand. Folded into B8.
35. "Deleted on the usual schedule" reads as evasive (minor): **accepted.** Reset text states 12 months and invites earlier deletion.
36. "It's free" is an unneeded promise (minor): **accepted.** Dropped from the terms; the legal-basis row says "running Whim safely and within budget".

Fact-check pass (`fact-check.md`, primary sources where reachable). All nine claims held in substance. What changed:

37. Texas court history (claim 1, imprecise): **corrected.** Item 3 above said the Fifth Circuit stayed the injunction "in June" and the Supreme Court "let enforcement continue". Now: administrative stay 2026-05-28, full stay 2026-06-04, and on 2026-07-06 the Supreme Court denied emergency applications to vacate the stay (Nos. 25A1389, 25A1390), with the merits still on appeal. Changed in summary 9, the US row, note 18 and lawyer item 7.
38. Texas §121.053 (claim 1, omitted): **added.** A standing duty to notify each store before a significant change to the terms or the policy. In summary 9, the US row, note 18, lawyer item 7, "Later, when triggered" and "What else changes". The US row's confidence on the duties rises to high (enrolled text); how the stores implement them stays low.
39. UK PECR quote (claim 2): **corrected** to the statute's word order, "in connection with the provision of the service requested". Substance unchanged.
40. GDPR Art. 27 (claim 9c, understated): **strengthened.** The exemption's three conditions are conjunctive and a daily-use service isn't "occasional", so representatives are needed if EU/UK storefronts open. EU/UK row, note 12, lawyer item 6, and "Only if you open EU/UK storefronts".
41. Montana threshold (claim 9d): **confirmed at 25,000, now a tracked trigger** rather than a footnote. Delaware and Maryland stay unverified. State-law paragraph and "Later, when triggered".
42. Quebec s.3.1 (claim 9b): **still unverifiable**, as disclosed. Row notes the second refused fetch; "Where the research is thin" lists it.
43. Quebec Charter s.55 (claim 6): **confirmed from a mirror of the official text.** Confidence on the text raised to medium-high; its reach to an Ontario app-store seller stays low.
44. Korea PIPA (claim 8): **confirmed; one addition.** Listing the storefront triggers it, and the policy would also need a Korean-language section on overseas transfers. Lawyer item 15 and "Later, when triggered".
45. Apple 5.1.2(i), 4.7.4, 4.7.5; DSA trader rules; Washington MHMDA; Play's bundling rule; Apple's "linked" definition (claims 3, 4, 5, 7, 9a): **confirmed, no change.**

Owner input (2026-09-23):

46. Premium subscription through in-app purchase, with optional multi-device sync and backup, and bring-your-own-key later: **folded in.** Saved-data promise rewritten around who can read it, on the screen, in the policy, in the listing and in the manifest's core promises (summary 6, note 21, decision 1). The re-consent rule now treats turning on sync, and buying a subscription, as the user's own opt-in, with scenarios for both and for sync Whim could read. Manifest gains a table of categories that can be added later without a bump. Bracketed subscription text in the policy and terms.
47. Device attestation (#65): **added to the v2 manifest** as a category and a named recipient role, because Apple and Google may not fit "companies that work for us". Summary 4 no longer counts it as a provider inside an existing role. Note 22, lawyer item 3, consent table, B8, the screen's "Who gets it" and the v1 → v2 "what's new" line.
48. Version and build header (#64): **covered** by "Connection and log data"; shipped with B10.
49. Provider-outage message (#66): **no new data**; only a tone and no-vendor-name note.
50. No per-IP limits: **respected.** The Data safety note that said "if IP-based abuse controls ever arrive" now says Whim doesn't limit by IP; the block-list follow-up is by phone ID.

Triage restructure: the top of this file now opens with seven decisions, the pre-launch tasks, the EU/UK-only list, the triggered list and the thin-research list. The 20 owner decisions became "Decision notes", with the mapping at their head; 4, 7, 8, 18, 19 and 20 turned into tasks because they follow from a rule or an earlier decision.
51. Lifetime `usage` table (owner decision, 2026-09-23): **kept, not dropped.** The owner wants lifetime token totals per phone. It's disclosed as linked usage data with a 12-month idle purge, so the retention promise stays true and an inactive phone ID doesn't stay forever. B8, note 20, the task list, the manifest row and the policy retention rows were updated.
52. Owner wording note (2026-09-23): "a random ID, never your name" reads as filler, and users never give Whim a name, so the name contrast is gone from the consent line, the data table, the report line and the "linked to you" explanation. That explanation now leans on linked vs tracking instead.
