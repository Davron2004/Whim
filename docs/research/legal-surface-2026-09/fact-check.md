# Fact-check: legal-surface-2026-09 README and draft copy (issue #63)

Research, not legal advice. This checks the nine claims assigned, against primary sources where one exists (statute text, court filings/dockets, regulator pages, store policy pages). Each section: verdict first, then the quote/URL, then what the README should say instead if it's wrong or overstated. "Confirmed" means the primary source supports the README's claim as stated. "Confirmed, imprecise" means the underlying fact is right but the README's wording overstates or blurs something a primary source states more narrowly. "Unverifiable" means no primary source could be reached in this pass.

---

## 1. Texas App Store Accountability Act (SB 2420)

**Verdict: Confirmed, with one imprecision worth fixing.**

**Status.** SB 2420 was signed 2025-05-27 and took effect 2026-01-01. It is currently enforceable. Source: enrolled bill text, https://capitol.texas.gov/tlodocs/89R/billtext/html/SB02420F.HTM; timeline corroborated by https://www.mofo.com/resources/insights/251111-texas-targets-app-stores-with-new-accountability-law and https://www.wiley.law/alert-Key-Developments-With-State-App-Store-Accountability-Acts-as-Texas-Act-Takes-Effect.

**The court history, precisely.** A federal district judge (Pitman, W.D. Tex.) preliminarily enjoined the Act in December 2025. The Fifth Circuit administratively stayed that injunction on 2026-05-28 and granted the State's full stay motion on 2026-06-04 (Wiley alert, quoting the Fifth Circuit order: "that injunction was administratively stayed by U.S. Court of Appeals for the Fifth Circuit on May 28"; also https://www.texastribune.org/2026/05/28/texas-apple-google-app-store-age-verification/). Plaintiffs (Students Engaged in Advancing Texas, and separately CCIA) then asked the Supreme Court to vacate that stay (Docket 25A1389, 25A1390: https://www.supremecourt.gov/DocketPDF/25/25A1390/413782/20260622150257159_25A1389%2025A1390%20Response%20to%20Applications.pdf). On 2026-07-06 the Court **denied the emergency applications to vacate the stay** in brief, unsigned orders with no noted dissent (SCOTUSblog, https://www.scotusblog.com/2026/07/supreme-court-allows-texas-to-enforce-law-requiring-age-verification-and-parental-consent-on-app/: the orders "turned down requests to reinstate orders by a federal judge in Austin that barred the state from implementing the law").

**Why "imprecise," not "wrong":** the README's line — "The Fifth Circuit stayed the injunction in June 2026, and the Supreme Court let enforcement continue in July 2026" — is directionally right (enforcement is in fact continuing) but glosses two things a reader might get wrong: (a) the Fifth Circuit's stay process started in May, not June (administrative stay 5/28, full stay 6/4 — "June 2026" is defensible only for the full stay); (b) the Supreme Court did not rule on the law's validity or "let enforcement continue" as an affirmative holding — it denied emergency applications to vacate a lower court's stay, on the standard emergency-docket standard, with the constitutional merits (First Amendment) still pending on appeal and an expedited Fifth Circuit hearing expected in August 2026.

**Suggested README wording:** "Texas's App Store Accountability Act is in force. The Fifth Circuit stayed the district court's injunction against it (administratively on 2026-05-28, in full on 2026-06-04), and on 2026-07-06 the Supreme Court denied emergency applications to vacate that stay (SEAT v. Paxton, CCIA v. Paxton, Nos. 25A1389/25A1390) — so enforcement continues, but the Court did not rule on the law's constitutionality, which is still being litigated on appeal."

**Developer duties, exact statute sections** (enrolled text, same URL as above):
- §121.052(a): "The developer of a software application shall assign to each software application and to each purchase … an age rating based on the age categories …"
- §121.052(b): must provide each app store the rating assigned and "the specific content or other elements that led to each rating."
- §121.053(a): must give each app store notice **before making any significant change to the terms of service or privacy policy** — this is a developer duty the README's summary line omits entirely (worth adding, since it's a real ongoing obligation, not a one-time integration).
- §121.054(a): must create a system to use age-category/consent information received from the store to verify the user's age category and whether consent was obtained.
- §121.055(a): may use that personal data **only** to enforce restrictions, ensure legal compliance, and implement safety features.
- §121.055(b): must delete the personal data on completion of the §121.054 verification.

The README's "receive the store's age-range signal, get parental consent through the store for users under 18, and use that data only for compliance" is accurate as far as it goes, but should also flag §121.053's standing notice-of-material-change duty, since it's a duty Whim will owe on an ongoing basis, not just once at store-signal integration (owner decision 18).

---

## 2. UK Data (Use and Access) Act 2025 — PECR changes and DPA 2018 s.164A

**Verdict: Confirmed.**

**PECR / "fault" exception.** The DUAA inserts a new Schedule A1 into PECR (via DUAA Schedule 12), in force 2026-02-05, which widens the exceptions to the storage/access consent rule in PECR reg. 6(1) from two to six. One of the enumerated "strictly necessary" exceptions covers preventing or detecting technical faults in providing the requested service. Source: https://www.legislation.gov.uk/ukpga/2025/18/schedule/12 (fetched; paragraph 4(2)(d) reads, per the fetched text, "to prevent or detect technical faults in connection with the provision of the service requested" — note this is a very close paraphrase of the README's quoted "prevent or detect technical faults in connection with the provision of the requested service"; the word order should be double-checked against the statute directly before it's put in a legal document, but the substance is confirmed). Secondary confirmation: Clifford Chance, https://www.cliffordchance.com/insights/resources/blogs/talking-tech/en/articles/2026/02/key-aspects-of-the-data--use-and-access--act-take-effect.html, and Blake Morgan, https://www.blakemorgan.co.uk/data-use-and-access-act-2025-privacy-and-electronic-communications-regulations/. This is a genuine "fault" exception distinct from the pre-existing "strictly necessary for the service the user asked for" ground, and it did commence 2026-02-05 as the README states.

**s.164A complaints duty.** Confirmed exactly. Data Protection Act 2018 s.164A (inserted by DUAA), in force 2026-06-19: a data subject may complain to the controller about a UK GDPR / DPA Part 3 infringement; the controller must facilitate complaints, **acknowledge receipt within 30 days**, and without undue delay investigate, respond, and inform the complainant of the outcome (and of their right to escalate to the ICO). Source: https://www.legislation.gov.uk/ukpga/2018/12/section/164A/ (fetched); secondary confirmation via Lewis Silkin, https://www.lewissilkin.com/insights/2026/02/19/handling-data-protection-complaints-under-the-duaa-key-takeaways-from-ico-guidan-102miuc, and DLA Piper, https://privacymatters.dlapiper.com/2026/06/uk-new-complaints-handling-rules-under-duaa-take-effect-on-19-june-2026-are-you-ready/. This matches the README's and draft-copy's "acknowledge within 30 days" language exactly.

No change needed to the README on this claim.

---

## 3. Apple App Review Guidelines 5.1.2(i), 4.7.4, 4.7.5

**Verdict: Confirmed — exact text matches, read directly from developer.apple.com/app-store/review/guidelines/ today.**

> **5.1.2(i):** "Unless otherwise permitted by law, you may not use, transmit, or share someone's personal data without first obtaining their permission. You must provide access to information about how and where the data will be used. You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so. … You must receive explicit permission from users via the App Tracking Transparency APIs to track their activity. … Apps that share user data without user consent or otherwise complying with data privacy laws may be removed from sale …"

> **4.7.4:** "You must provide an index of software and metadata available in your app. It must include universal links that lead to all of the software offered in your app."

> **4.7.5:** "Your app must provide a way for users to identify software that exceeds the app's age rating, and use an age restriction mechanism based on verified or declared age to limit access by underage users."

Source: https://developer.apple.com/app-store/review/guidelines/ (fetched today).

**On the "Nov 2025" dating of the third-party-AI clause:** I could not reach an Apple-hosted changelog with a precise date (Apple doesn't version guideline diffs publicly in an easily fetchable way), but multiple independent secondary sources converge on 2025-11-13 as the date this clause was added, e.g. https://dev.to/arshtechpro/apples-guideline-512i-the-ai-data-sharing-rule-that-will-impact-every-ios-developer-1b0p and https://www.techrepublic.com/article/news-apple-app-review-guidelines-ai-data-sharing/, both stating the revised guidelines "went live on Nov. 13, 2025" and that this was the first time third-party AI was brought within the data-sharing disclosure rule. Confidence: high on the current text (primary), medium-high on the exact date (secondary only, but multiple independent sources agree).

No change needed to the README or draft copy on this claim; the guideline text they build from is exactly current.

---

## 4. EU DSA trader-status rules on the app stores — do they apply to Whim?

**Verdict: Confirmed — they apply.**

The DSA's "trader" definition (as applied by Apple's compliance flow) is "any natural person, or any legal person … who is acting … for purposes relating to his or her trade, business, craft or profession." AnyCognition Inc. selling/distributing an app through the store is squarely inside that definition — this is not the "hobbyist acting outside their trade" case that would exempt it. Source: https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/ (fetched today).

**What it requires**, per the same source: Apple has required verified trader status for EU-distributed apps since 2025-02-17 (README's date, corroborated). For an organization account, Apple auto-populates the address from the D-U-N-S number and requires the developer to additionally enter a **phone number** and an **email address**; all three (address, phone, email) are then displayed publicly on the app's EU product page, per DSA Articles 30/31. An individual account must supply an address or P.O. box, phone, and email instead. Apple also requires a certification that the app's products/services comply with applicable EU law.

This confirms the README's decision 10–12 framing exactly: since the current Play account is a personal account rather than AnyCognition Inc.'s, a Play DSA trader declaration today would publish a private individual's contact details, which is the problem decision 11 flags. No wording fix needed — this is an operational/decision item, not copy, and the README already treats it that way.

---

## 5. Washington's My Health My Data Act — does it plausibly apply to Whim?

**Verdict: Confirmed as plausible; README's "Open" framing is correct and should stay.**

RCW 19.373.010 defines "regulated entity" as any legal entity that (a) conducts business in Washington, or produces/provides products or services targeted to Washington consumers, and (b) alone or jointly determines the purpose and means of collecting/processing/sharing/selling **consumer health data** — with **no revenue or size threshold** and no carve-out for small companies. Source (definition, via search of the official RCW): https://app.leg.wa.gov/RCW/default.aspx?cite=19.373.010; secondary corroboration: https://calawyers.org/privacy-law/the-washington-my-health-my-data-act-not-just-washington-or-health/ and https://www.eff.org/deeplinks/2025/06/how-build-washingtons-my-health-my-data-act.

Whim is distributed to "all App Store and Play territories except mainland China" (per the README's own scope note), which includes Washington State, so prong (a) is met. "Consumer health data" is defined broadly enough (personal information that identifies or can be used to infer past/present/future physical or mental health status) that a prompt like "track my insulin doses" plausibly counts, even though Whim doesn't retain request content past handling — the Act's data-collection triggers fire on collection/processing, not just retention, so a request that merely transits the server with the device ID attached is enough to raise the question. This is exactly the scenario the README flags (lawyer item 16), and "Open" is the right verdict, not "confirmed inapplicable" or "confirmed applicable" — it turns on facts (what people actually type) a static compliance review can't resolve. No change needed.

---

## 6. Quebec Charter of the French Language, s.55 (contracts of adhesion)

**Verdict: Confirmed (statute text), open on application — matches the README.**

Official English text of s.55, C-11 (in force since the Bill 96 amendments, 2023-06-01): "Contracts pre-determined by one party and the related documents, must be drawn up in French. The parties to such a contract may be bound only by its version in a language other than French if, after its French version has been remitted to the adhering party, such is their express wish." I could not fetch legisquebec.gouv.qc.ca directly (HTTP 403, same as the README's own note that "both official sites refused the fetch"); the quote above comes from a WebSearch result that itself points at https://www.legisquebec.gouv.qc.ca/en/version/cs/C-11?code=se:55, cross-checked against secondary discussion of the same text at https://gowlingwlg.com/en/insights-resources/articles/2023/bill-96-s-french-first-rule-takes-effect and https://www.nortonrosefulbright.com/en/knowledge/publications/38625c3d/doing-business-in-quebec-language-legislation. Treat this as medium-high, not the "read it myself on the primary site" bar the README correctly says is still missing (lawyer item 1/14).

This confirms the README's paraphrase ("a contract of adhesion must be offered in French first; English only after the parties expressly choose it") word for word in substance: a terms-of-use document Whim presents on a take-it-or-leave-it basis (no negotiation) is a textbook contract of adhesion under Quebec civil law, so s.55 applies to it on its face. What remains genuinely open — and the README is right to flag it as a lawyer item rather than assert an answer — is whether s.55 reaches an out-of-province (Ontario) business distributing through the app stores to Quebec consumers who never "do business in Quebec" in a more traditional sense; that's a jurisdictional/conflicts question the statute text alone doesn't answer, and nothing found in this pass resolves it either way. No wording change needed; the README already states the statute's substance correctly and correctly declines to guess the jurisdictional question.

---

## 7. Google Play — prominent disclosure must not be bundled with unrelated disclosures

**Verdict: Confirmed, exact quote.**

Google Play's User Data policy (https://support.google.com/googleplay/android-developer/answer/10144311, fetched today) states the in-app disclosure:

> "Cannot only be placed in a privacy policy or terms of service; and Cannot be included with other disclosures unrelated to personal and sensitive user data collection."

This is exactly the clause the README quotes ("cannot be included with other disclosures unrelated to personal and sensitive user data collection") and exactly what decision 9 and the draft's separate terms-step / consent-screen split are built to satisfy. No change needed.

---

## 8. Korea PIPA — disclosure of recipients, and whether it matters for merely listing Korea as a storefront

**Verdict: Confirmed, and yes it matters — this is not a paperwork nicety that a storefront listing can dodge.**

PIPA's territorial scope (2023 amendments) reaches foreign businesses that process the personal information of people located in Korea, regardless of where the business itself is based — so making Whim available in the Korean storefront is what triggers PIPA, not any separate decision to "do business" there in a corporate sense. Once triggered:

- **Art. 28-8** (overseas transfer): where a transfer rests on consent, the required disclosure includes the recipient country, the recipient's identity, the purpose of the transfer, and the retention period abroad; where PIPA applies, the Korean-language privacy policy must carry a separate, clearly labeled section on overseas provision of personal information. Source (secondary, statute text not independently re-derived): https://www.lexology.com/library/detail.aspx?g=4e246fbb-9f7a-48dc-9435-410a577d6ff8.
- **Art. 26** (outsourcing): outsourcees (e.g., a hosting or AI-routing vendor acting on Whim's behalf) must be disclosed/published, similarly to the "who handles it right now" style list the README proposes.

This directly confirms the README's decision 17 approach — a "Who handles it right now" list naming current providers, their countries, and a contact, sitting outside the versioned consent manifest so it can be updated with notice — is the right shape of fix, and confirms that simply choosing "Korea" as an available territory in App Store Connect / Play Console is what creates the obligation, independent of whether AnyCognition has any Korean entity, staff, or bank account. The README's framing ("this is the case the owner's principle carves out: a law requires the exact detail") is accurate. One gap worth noting for the lawyer list: I could not confirm from a primary or secondary source in this pass whether Art. 28-8's disclosure must also state **how long each recipient itself keeps the data** (as opposed to Whim's own retention) — the README's lawyer item 15 already asks this question; it remains open, not resolved by this pass.

---

## 9. Other low-confidence claims in the requirements tables that would change a decision if wrong

I checked four more that are load-bearing for specific owner decisions:

### 9a. Apple's "linked to you" definition (decision 4 — declaring every store type Linked)

**Verdict: Confirmed.** Apple's own definition: "Data Linked to You" means data collected in a way that is linked to your identity, "such as to your account, your device, or your details" — this is the exact test the README applies to justify declaring the phone ID and other categories Linked rather than "Not Linked." Source: Apple support documentation on App Privacy Details, surfaced via search of https://support.apple.com (App Store privacy label definitions) and consistent with https://developer.apple.com/app-store/app-privacy-details/. This is the single fact decision 4 and blocker B6 hinge on, and it holds up. No change needed — if anything, this is the best-supported claim in the whole document.

### 9b. Quebec P-39.1 s.3.1 (named privacy officer) — still unverified

**Verdict: Unverifiable in this pass.** Same as the README already discloses (lawyer item 1): legisquebec.gouv.qc.ca returned HTTP 403 to a direct fetch here too, and I did not find a mirror with the literal s.3.1 text (as opposed to secondary summaries) in the time available. The README is correct to keep this at "medium (statute not read first-hand)" and as a standing lawyer item; I could not raise its confidence.

### 9c. GDPR Art. 27 "occasional" exemption (decision 12 — whether EU/UK representatives are needed at launch)

**Verdict: Confirmed, exact text.** From gdpr-info.eu (the same site the README already cites elsewhere): the Art. 27 representative duty does not apply to "processing which is occasional, does not include, on a large scale, processing of special categories of data … or processing of personal data relating to criminal convictions and offences …, and is unlikely to result in a risk to the rights and freedoms of natural persons." All three conditions are conjunctive. This matters for decision 12: Whim's processing (recurring, ongoing, for every EU/UK user who uses the AI features) is very unlikely to qualify as "occasional" in the sense this article uses (regulatory guidance and case commentary consistently read "occasional" as sporadic/one-off, not "an ordinary recurring part of the service"), so the README's recommendation to treat EU/UK representatives as needed from public launch, rather than deferrable on an "occasional processing" theory, is the safer and better-supported reading. Worth stating this more explicitly in the README's decision 12 rather than leaving it as "possibly ... paid Article 27 representatives" — on this text, "possibly" undersells how weak the occasional-processing escape hatch is for a live product used repeatedly by the same population.

### 9d. State comprehensive-privacy-law thresholds below the commonly-cited 100,000 (§ "CCPA and most comprehensive state laws don't apply yet")

**Verdict: Confirmed for Montana, the one checked.** Montana's Consumer Data Privacy Act, as amended (SB 297, effective 2025-10-01), lowered its general applicability threshold from 50,000 to **25,000** Montana consumers processed annually (and a second, revenue-linked prong at 15,000 consumers + >25% of gross revenue from data sales). Source: https://www.beneschlaw.com/insight/montana-amends-consumer-data-privacy-act-to-broaden-applicability-and-enhance-protections-for-minors/ and https://www.cooley.com/news/insight/2025/2025-10-15-the-evolving-state-privacy-landscape-major-updates-to-consumer-privacy-laws-in-montana-and-connecticut. This confirms the README's "some states (Montana, Delaware, Maryland and others) start at 25,000–35,000 consumers" at least for the Montana figure; I did not independently re-verify Delaware's or Maryland's exact thresholds in this pass, so those two should stay at the README's stated "medium confidence, not read from the statutes" until someone does. If Whim's Canada+US+EU/UK+Korea user base is genuinely small, this whole paragraph may be moot regardless of the exact numbers — but if growth is a stated goal, 25,000 is a low enough bar (a single US state) that it's worth turning into a real threshold-tracking to-do rather than a footnote, since crossing it silently would mean CCPA-style state law obligations (data subject rights, opt-outs, etc.) attach with no separate trigger or warning in the codebase today.

---

## Summary table

| # | Claim | Verdict |
|---|---|---|
| 1 | Texas SB 2420 status + SCOTUS | Confirmed, imprecise on court procedural framing (see wording fix above) |
| 1 | Texas SB 2420 developer duties | Confirmed; missing the §121.053 material-change notice duty |
| 2 | UK PECR fault exception | Confirmed |
| 2 | UK DPA s.164A complaints duty | Confirmed |
| 3 | Apple 5.1.2(i) / 4.7.4 / 4.7.5 exact text | Confirmed |
| 4 | EU DSA trader rules apply to Whim | Confirmed |
| 5 | Washington MHMDA plausibly applies | Confirmed (as plausible/open, matching README) |
| 6 | Quebec Charter s.55 | Confirmed (statute text); application to an Ontario app-store seller stays open |
| 7 | Google Play bundling rule | Confirmed |
| 8 | Korea PIPA recipient disclosure | Confirmed; matters even for a bare storefront listing |
| 9a | Apple "linked" definition | Confirmed |
| 9b | Quebec P-39.1 s.3.1 | Unverifiable (as README already discloses) |
| 9c | GDPR Art. 27 "occasional" | Confirmed; README's "possibly" understates how narrow the exemption is |
| 9d | State privacy thresholds (Montana) | Confirmed |
