# UK Children's Code DPIA: users aged 13 to 17

**Status: draft, unsigned.** For the owner to read, decide and sign (tasks.md 11.5). It is not legal advice. It is needed because every storefront stays open (decision 2), including the UK, and the ICO's Age Appropriate Design Code covers services likely to be used by under-18s (README, EU and UK table; "Only if you open EU/UK storefronts"). The standards cited below are from the [ICO code](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/services-covered-by-this-code/) itself; the research files cover the code only at the level of "a DPIA, high-privacy defaults" (README), so the per-standard reading here is this draft's, with medium confidence at best.

## 1. Why a DPIA

Whim is rated 13+, so people aged 13 to 17 can use it. The code applies to services likely to be accessed by children, meaning anyone under 18, and its standard 2 asks for a DPIA. This draft assumes Whim is covered. Known risk, accepted by the owner (2026-09-24): whether Whim is actually covered, and whether this DPIA supports error details on by default, is undetermined; no lawyer will confirm either.

## 2. What Whim does with personal data

Facts from the manifest (README "Manifest, version 2") and the owner's decisions.

**Context.** No accounts. Whim doesn't ask for a name, email or age. People describe a small app, and AI companies working for Whim write it. The app then runs on the phone. There is no way for people to share apps or content with each other (README "What goes", privacy policy row). The server's content check refuses requests for content above the 13+ rating (README, Apple 4.7.5 row).

**Data, from the manifest:**

| Category | What | Kept by Whim | Default |
|---|---|---|---|
| Request | What the user types or dictates, their answers, the plan they approve | No, only while handled, except inside a report | Core |
| App material | For a change: name, code, description, data layout; never saved data | No | Core |
| Phone ID | Random ID made on the phone | Inside usage records and reports | Core |
| App-integrity check (#65) | A key and a verdict from Apple or Google | 12 months after the phone ID's last use | Core |
| Usage records | Per request: type, times, outcome, size, cost; lifetime totals per phone ID | 12 months; totals 12 months after last use | Core |
| Error details | Versions, error type from a fixed list, code location, screen, request number; no typed text or saved data (B9) | 90 days | Optional, on |
| Connection and log data | IP address, times, app version and build, consent version | 90 days | Core |
| Reports | Reason, note, app name, app code, prompt if included | 12 months | Sent by the user |

What people save inside their apps stays on the phone, and nobody at Whim can read it (core promise 1). Nothing about age leaves the phone (design D11).

**Purposes** (manifest): build and change apps; run Whim (daily limits, abuse and fraud prevention, security, keeping it working, finding and fixing problems, cost and capacity); handle reports and keep Whim safe; meet legal duties.

**Recipients** (manifest): AnyCognition; service providers acting only for AnyCognition (hosting, AI, logging, email), which may not train AI on the data or use it for their own products; Apple or Google for integrity checks; authorities when the law requires it.

## 3. Knowing who is a child (standard 3)

Whim can't tell a 15-year-old from an adult. It doesn't ask for age. It reads the store's age signal where the store gives one, keeps only the outcome on the phone, and lets the user through when the signal is `unavailable` (design D11; README note 18). Whether the stores give a signal in the UK wasn't checked, so Whim can't count on it there.

The code allows two approaches: establish age with enough certainty for the risk, or apply the code's standards to all users. This draft takes the second. Every UK user gets the protections below. That is also why the error-details default (section 5) is a question for all UK users, not only teens.

## 4. The code's standards

| Standard | How Whim meets it | Gap or action |
|---|---|---|
| 1. Best interests of the child | No ads, no selling, no cross-app tracking (core promise 2). Data is used to build what the user asked for and keep the service working. | None found |
| 2. DPIA | This document | Owner to sign |
| 3. Age-appropriate application | Code applied to all users (section 3) | None |
| 4. Transparency | The consent screen, shown at the first action that would send anything, says in plain words what is sent, why and to whom (README "Proposed screen structure"). Plain-language policy; French for French-language phones. | The policy is long for a 13-year-old. The consent screen is the short version. |
| 5. Detrimental use of data | No advertising, no engagement design built on personal data. The content check refuses content above 13+. | None found |
| 6. Policies and community standards | Terms of use with acceptable-use rules; the content check; the report sheet | The terms reserve the right to cut off a phone's ID, but there is no block list yet (README "Terms of service"). A block list by phone ID is the follow-up if needed. |
| 7. Default settings | High privacy by default for everything optional, except error details, which are on (section 5) | The owner's decision in section 5 |
| 8. Data minimisation | No account, no name, no age sent. Requests aren't kept. Error details are a separate choice with their own switch (B4). Keep-periods are capped by the manifest and enforced at server startup and deploy (design D9). | None found |
| 9. Data sharing | Requests go to AI providers because that is the service the user asked for. The providers act for Whim and may not train on the data (B1). | Known risk, accepted by the owner: whether this counts as sharing with third parties or use of service providers is undecided; no lawyer will confirm it. |
| 10. Geolocation | No location feature. Whim can't tell which state or country anyone is in (README, US thresholds paragraph). | None |
| 11. Parental controls | None in Whim. Where Texas-style laws apply, parental approval runs through the store (note 18). | None |
| 12. Profiling | No profiling for content, recommendations or ads. Usage records per phone ID serve daily limits, abuse checks and cost (README verification item 23: the operator report lists top devices by cost). | Keep usage records to those purposes. |
| 13. Nudge techniques | On the consent screen nothing is pre-selected, and back or "Not now" grants nothing; the examples keep working (draft-copy §1). | Check the "Agree and continue" and "Not now" buttons don't differ in weight in a way that pushes one. |
| 14. Connected toys and devices | Not applicable | None |
| 15. Online tools | In-app report sheet. Settings switches for AI features and error details. The phone ID is shown in Settings, with "Make a new ID" (B4). Rights requests go to `support@anycognition.ca`. | Rights requests need an email. An in-app request tool would be easier for a teen; not planned. |

## 5. Error details on by default

The code sets high privacy as the default and asks for a compelling reason to differ, weighed against the child's best interests (standard 7). README note 3 says this DPIA has to justify "on", and if it can't, error details default to off in the UK too. The consent-screen wording doesn't change either way.

**The case for on**

- What goes is technical only: versions, an error type from a fixed list, where in the code it happened, the screen, a request number. No typed text, no saved data, no free-text error name or message from a generated app (B9 closes the list before diagnostics ship).
- The purpose is to find and fix faults. A generated app that breaks for a young user is a harm to that user. With the switch off by default, Whim would see errors only from the few people who turn it on, and most failures would go unseen.
- UK law already treats fault detection as low-intrusion: since 2026-02-05, storage or access strictly necessary to detect technical faults in the service needs no consent under PECR (README, EU and UK table: PECR Sch. A1, as amended by the Data (Use and Access) Act 2025).
- It is a separate choice (standard 8): named on the consent screen, one switch in Settings, and turning it off changes nothing else.
- It is kept at most 90 days, and it isn't used for profiling, advertising or anything but fixing faults.

**The case against**

- Error details carry the phone ID, and the connection data that travels with them includes the IP address. The stores declare them "Linked" (README note 4).
- Fixing bugs benefits Whim as a business as well as the user. A regulator may weigh that as a commercial interest, not a compelling reason.
- Whim can't tell teens from adults (section 3), so the reasoning covers every UK user.

**If the default goes off for the UK**

Whim has no reliable way to tell a UK user. It has no location, and IP addresses aren't looked up. The only signal on the phone is the phone's region setting, and using it would be a new rule in the error-details preference module (design D10), which today treats a missing value as on. The simpler alternative is off everywhere. Either change must happen before diagnostics ship, because turning a default on later counts as widening the manifest (README note 3).

**Draft recommendation:** keep error details on, on three conditions: B9 and B4 ship before diagnostics do, the 90-day cap holds, and the consent screen names error details. Known risk, accepted by the owner: no lawyer will check this after launch; the draft recommendation stands as final.

TODO(owner): decide on or off for UK users, and record why: ______

## 6. Risks

| Risk to a young user | Likelihood | Severity | Reduced by | Left over |
|---|---|---|---|---|
| Types personal details (health, school, family) into a request | Possible | Medium | Not kept by Whim; no ID or IP sent with it to AI providers; providers may not train on it (`docs/legal/quebec-s17-assessment.md` §3–5) | Providers may keep a copy briefly for abuse checks (B1) |
| Gets a generated app that isn't suitable for 13+ | Possible | Medium | Content check refuses above-13+ requests; report sheet in the app | The check can miss things |
| Records tied to the phone ID reveal usage patterns | Unlikely | Low | No content in usage records; 12-month cap; "Make a new ID" in Settings | Records stay up to 12 months after a reset (policy, "Your choices") |
| Error details reveal something typed or saved | Unlikely once B9 ships | Medium | Fixed error-name list, no free text (B9) | None expected |
| Age data leaks | Unlikely | Low | Only the outcome is stored, on the phone; nothing about age is sent (design D11) | None |
| A breach of Whim's server | Unlikely | Low to medium | Little is kept; `docs/legal/breach-runbook.md` | Reports can hold free text |
| Pushed to agree | Unlikely | Low | Nothing pre-selected; "Not now" keeps the examples working | Button weight to check (standard 13) |

## 7. Other UK items

- TODO(owner): check whether the ICO data protection fee applies (tasks.md 11.5).
- The code's DPIA standard expects the views of children and parents to be sought where appropriate. TODO(owner): decide whether to ask a few teen users or parents before signing, and record the answer: ______

## 8. Sign-off

Review this DPIA when a new data category, recipient role or purpose is added, when the error-details default changes, or when a feature aimed at younger users ships.

Signed: ______ (Privacy Officer, AnyCognition Inc.) Date: ______
