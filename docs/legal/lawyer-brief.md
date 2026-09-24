# Brief for a privacy lawyer, after launch

The owner decided not to engage a lawyer before launch (README decision 7, 2026-09-23). Whim launches on research and on the fallbacks listed in section 3. This brief is what to hand a lawyer afterwards (tasks.md 11.12). It is a list of questions, not legal advice.

## 1. Whim in brief

- **Who:** AnyCognition Inc., Ottawa, Ontario. One person, who is also the Privacy Officer by title (decision 3).
- **What:** a phone app (iOS and Android) where people describe a small app and AI writes it. The app then runs on the phone. No accounts. Every App Store and Play territory except mainland China (decision 2).
- **Data:** the request goes to Whim's server in Montreal, then through OpenRouter (US) to AI model providers. Whim keeps usage records, error details, connection data, logs and user-sent reports, tied to a random per-install phone ID. What people save inside their apps stays on the phone, and nobody at Whim can read it. The full list is README "Manifest, version 2".
- **Read first:** the privacy policy and terms (`deploy/site/privacy.html`, `deploy/site/terms.html`, and the French pages under `deploy/site/fr/`), the consent screen text (`src/host/launcher/copy.ts`), `docs/research/legal-surface-2026-09/README.md` and its research files, and the drafts in this folder: `quebec-s17-assessment.md`, `uk-childrens-code-dpia.md`, `breach-runbook.md`, `change-process.md`.

## 2. Questions, in priority order

Ranked by: enforceable now with real penalties and thin research first; then answers that would change text every user agreed to or a store answer; watch items last. The number in brackets is the item's number in README "Check with a lawyer". Every-territory launch moved item 15 up (decision 2).

1. **Quebec's statute text and the s.17 transfer paperwork** [1, 2]. Nothing Quebec-specific was read first-hand; both official sites refused the fetch (canada.md, gap 1). Please check ss. 3.1, 3.3, 3.5–3.8, 4.1 (under-14 consent, on general knowledge only), 8, 8.1, 8.2, 12.1, 14, 17 and 93.1. Then: what must the s.17 written agreement contain when the recipient is a US router passing requests to other providers? Can OpenRouter's standard terms or DPA serve? Was a s.3.3 assessment already due? *Why first:* no size exemption, a $1,000 punitive-damages floor (s.93.1), and the owner signed the s.17 assessment on secondary sources.
2. **Provider role** [3]. With B1 in place, are OpenRouter and the model providers service providers (or processors) under GDPR, Quebec law and Play's definition, given that some keep requests for their own abuse checks and legal duties? Same question for Apple and Google running App Attest and Play Integrity (#65). Should routing be limited by country for EU and Quebec users? *Why:* it decides Play's "Shared" answer, the transfer mechanics and the s.17 assessment's scope.
3. **Countries outside the research** [15]. Every storefront is open. Korea: does the generated Korean-language transfer section meet PIPA Art. 26 and 28-8, and must it also say how long each recipient keeps data? Brazil (LGPD), Japan (APPI: consent for providing data to a third party abroad), India (DPDP): which storefronts can stay on with the current text?
4. **Age, and Texas** [7]. 13+ against Quebec's reported under-14 rule, GDPR Art. 8, and Texas's App Store Accountability Act, which is enforceable now (merits still on appeal). What must Whim do for Texas users? What counts as a "significant change" under §121.053, and how is the notice given to each store? (`change-process.md` §8 uses a draft rule until you answer.) Does a store age signal create COPPA "actual knowledge"? Is letting users through when the signal is unavailable acceptable? Does Apple 4.7.5 need more?
5. **EU ePrivacy, for error details and the phone ID** [4]. Are error details strictly necessary under Art. 5(3), or do they need consent? Does the phone ID stay within the exemption when it also keys cost records, or is the fallback (the Agree tap is also consent to storing and reading it) sound? *Decides:* the error-details default for EU users.
6. **Washington's My Health My Data Act, and Nevada SB 370** [16]. Does it reach health details people type into requests that Whim doesn't keep but passes to AI providers with a phone ID? No size threshold and a private right of action, and nothing has been done for it.
7. **Quebec's Charter of the French Language** [14]. Does s.55 reach an Ontario business selling through app stores, and does s.52 reach the consent screen, the policy and the listing? Is Whim's one-tap "Continue in English" an express choice?
8. **UK Children's Code** [17]. Is Whim "likely to be accessed by children" at 13+? Does `uk-childrens-code-dpia.md` cover what it should, and does it support error details on by default?
9. **GDPR basis for sending requests to AI** [5]. Contract for building apps, legitimate interests for the rest, and the Agree tap as Apple's permission, Canada's express consent and the EU ePrivacy consent for the ID. Is the framing sound under Art. 7(2) and 7(4)?
10. **Absolute words** [8]. Does the general-impression test (Competition Act s.52(4), FTC) catch "stays on your phone" given iCloud backups, or "nobody at Whim can read it" given that a user can type saved data into a report's note?
11. **Terms** [10]. Can Ontario governing law and the liability cap be enforced against consumers in the EU and Quebec? Does Quebec's Consumer Protection Act limit the change clause? Does Play require a terms link? When premium ships: what do auto-renewal laws and Apple 3.1.2 add?
12. **The separate terms step** [18]. Is one "Accept" step before the consent screen, with the terms linked, enough in Ontario, Quebec (with French first) and the EU?
13. **Keep-periods** [9]. Are 12 months for usage records and reports, and 90 days for logs, defensible under storage-limitation rules?
14. **Automated decisions** [12]. Could the content-policy refusal, or a future automatic block, be a decision under Quebec s.12.1 or GDPR Art. 22?
15. **UK ICO fee** [6]. Confirm whether it applies. The Article 27 half is answered: representatives are needed while EU and UK storefronts are open.
16. **Apple 5.1.2(i) in practice** [11]. Will App Review accept "AI companies that work for us" without a provider name on the screen? App Review may answer this first; the fallback line is ready.
17. **Watch items** [13]. Bill C-36 could replace PIPEDA. The EU-US Data Privacy Framework challenge is pending. AI Act Art. 50(2) marking of generated code is untested. A report that mentions a child's age could create COPPA actual knowledge.

## 3. Fallbacks the shipped text relies on

Where an item was unsettled, the text shipped with the research's own fallback (decision 7; design.md "Risks / Trade-offs"). If you disagree with one, the fourth column says what changes. The last column is the question number in section 2. A change that widens what users agreed to asks every user again (`change-process.md` §2); narrowing or rewording doesn't.

| # | Fallback | Where it shows | If you disagree | Question |
|---|---|---|---|---|
| F1 | The Agree tap is also the EU ePrivacy consent to storing and reading the phone ID; turning AI features off withdraws it | Policy, legal-basis section | A separate EU consent for the ID | 5 |
| F2 | Error details on by default everywhere, including the EU and UK. In the EU the switch is the consent; in the UK it rests on PECR's fault-detection exception | Consent screen, Settings, policy | Default off in the EU (or UK). See G5: there's no mechanism to tell those users yet | 5, 8 |
| F3 | GDPR basis is contract and legitimate interests, not the Agree tap | Policy, legal-basis table | Rework the table; consent-based processing would bring in Art. 8's ages | 9 |
| F4 | Play "Shared: Yes" for request content and app material until the provider role is confirmed; the providers are named in "Who handles it right now" to meet Play's "any parties" clause | Data safety form, policy | Flip to No, or say more | 2 |
| F5 | AI providers named by role, not by name, on the consent screen; a "Right now:" line is ready as wording | Consent screen | Add the line (no re-ask) | 16 |
| F6 | Providers "may keep requests for a limited time" under their own retention periods; zero-retention routing isn't relied on | Policy, "How the AI part works" | Turn on zero-retention routing or narrow the providers | 2 |
| F7 | Transfers: Canada's adequacy for EU to Montreal; the Data Privacy Framework where the US recipient is certified, otherwise standard contractual clauses. Whether OpenRouter's terms carry either is unconfirmed. The s.17 assessment is the owner's own | Policy, "Where it's handled"; `quebec-s17-assessment.md` | A new agreement, routing limits | 1, 2 |
| F8 | Every storefront open on research covering Canada, the US, the EU and the UK; a Korean transfer section ships | Store availability, policy | Close storefronts or add sections | 3 |
| F9 | 13+ with "a parent's permission where local law requires it"; store age signals where available; `unavailable` lets the user through; only the outcome is kept, on the phone | Terms, policy "Children", the age check | A hard block, or other duties | 4 |
| F10 | Terms under Ontario law with a liability cap, accepted in their own step; French first on French-language phones with a one-tap English choice | Terms, terms step | Rewrite clauses for consumers; change the step | 7, 11, 12 |
| F11 | Keep-period maximums: 12 months for reports and usage records (lifetime totals 12 months after last use), 90 days for error details, connection data and logs. Records from before v2 keep the 90-day rule | Policy, manifest | Shorter bounds (no re-ask) | 13 |
| F12 | "Nobody at Whim can read it" and "What we never do" stated as absolutes, resting on network-deny acceptance (B7) and the report-note exception written in the policy | Consent screen, policy, listing | Reword (no re-ask if it narrows) | 10 |
| F13 | "A person will look" at an automated refusal, as the answer to Quebec s.12.1 and GDPR Art. 22 | Policy, "How the AI part works" | More process | 14 |
| F14 | "We may tell you in the app or publicly" after a breach, because Whim can't identify users | Policy, "Keeping it safe"; `breach-runbook.md` | Different notice channels | G1, G2 |
| F15 | The Privacy Officer published by title only | Policy, "Who we are" | Publish a name | 1 |
| F16 | Article 27 representative paragraphs appear only once someone is appointed; the policy can go live before that | Policy, "Who we are" | Appoint before EU and UK traffic | 15 |
| F17 | Play stays on the personal developer account, so the Play listing names a different party from the policy, and the Play DSA trader declaration waits | Play listing | Move the account first | Decision 3, not a README item |
| F18 | Washington health data: nothing beyond not keeping requests and keeping the terms off the consent tap | None | A separate health-data policy and consent | 6 |
| F19 | COPPA: no age field, and no actual knowledge assumed | Policy, "Children" | Depends on the age answer | 4, 17 |
| F20 | The UK DPIA and the error-details default are the owner's own decision | `uk-childrens-code-dpia.md` | Default off | 8 |

## 4. Gaps found while drafting these documents

Not in README "Check with a lawyer". Found while writing `docs/legal/`.

- **G1. Breach notice outside Canada.** The research files cover PIPEDA s.10.1 and Quebec's confidentiality-incident duty, not GDPR and UK GDPR Art. 33 and 34 (the 72-hour clock) or US state breach laws. The runbook uses general knowledge for these. With no EU establishment and no way to tell where a user is, which EU authority does Whim notify?
- **G2. Indirect notice.** Whim can't write to the people affected. Does a notice on the website, the store listing and the next release meet PIPEDA's indirect-notification rule and Art. 34?
- **G3. Quebec's incident register.** Can the breach log (`breach-log.md`) serve as the register s.3.8 asks for? It's kept in a public repository and holds no personal information; any reason not to?
- **G4. Hosting in Montreal by a US company.** Does Google Cloud hosting data in Montreal count as communication outside Quebec under s.17? Where Cloud Logging stores logs depends on the bucket's region, which the owner still has to confirm.
- **G5. No mechanism for a regional default.** The fallback "default error details off for EU users" (item 5) and "off in the UK too" (README note 3) need a way to tell those users apart. Whim has no location and doesn't look up IP addresses. The phone's region setting is the only signal on the phone. Would it satisfy a regulator, or is "off everywhere" the only safe version?
- **G6. Error details on by default: legitimate interest vs consent under GDPR/UK GDPR.** The policy rests error details on legitimate interest, with a Settings switch to turn them off; it no longer calls the switch consent. Is that basis sound for an upload that is on by default, or do the EU and UK need consent (see item 5 and G5)?

## 5. What to bring back

For each answer, say which of these it changes:

- **Text only** (wording, narrowing): the owner updates the pages under `change-process.md` §4.
- **Something users agreed to** (a new category, purpose, recipient role or longer keep-period): a consent-version bump under `change-process.md` §3.
- **A store answer**: App Privacy or Data safety.
- **A document or process**: the s.17 assessment, the DPIA, the breach runbook, or the change process.
