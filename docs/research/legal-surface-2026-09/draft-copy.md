# Draft copy for review (issue #63)

Ready-to-review text for everything Whim says about data. The reasoning is in `README.md`, which this file follows: the owner decisions it assumes are listed below, and every choice traces back to a row in its requirements table.

How to read it:

- Every sentence is meant to be true of the app today and to stay true once the planned items ship (error details, a failure code and request id in the ledger, logs in Cloud Logging, provider changes, the app version header from #64, device attestation from #65, and later encrypted sync). Where a planned item isn't live yet, the text says "may". Text for a feature that doesn't exist yet (a subscription) sits in square brackets and stays out until it ships.
- **[B1]** to **[B10]** mark a sentence that only becomes true once that blocker from `README.md` is done. Remove the marker when the blocker is. Copy carrying **[B7]** (the saved-data promise) can't ship at all until B7 passes.
- **[D3]** and similar mark text that depends on an owner decision. The draft assumes the README's recommendation for each one. If the owner decides otherwise, the note says what to cut.
- Square brackets like [street address] are values only the owner can fill in.
- A lawyer should read the policy and terms before public launch. The README's "Check with a lawyer" list says where to look hardest.

Decisions this draft assumes (numbers are the README's decision notes; the seven decisions at the top of the README group them): 1 "no accounts" is a fact, not a promise; 2 request content isn't kept; 3 an error-details switch, on by default; 4 every store type declared Linked; 5 outer bounds of 12 months and 90 days; 6 OpenRouter named in the policy's provider list, not on the screen; 7 the server override leaves release builds (one policy paragraph is marked for deletion if it stays); 8 the phone ID is shown in Settings with a reset; 9 terms of use, accepted in their own step before the consent screen; 16 French versions follow (not drafted here); 17 a "Who handles it right now" provider list; 18 store age signals kept on the phone; 19 Play "Shared" by one recorded rule; 21 the saved-data promise is about who can read it, so encrypted sync fits; 22 device attestation disclosed now.

Everything here is English only. Quebec's Charter s.55 likely requires the terms, and possibly the rest, in French first before public launch (README decision 16).

---

## 1. Consent screen

Keys for `src/host/launcher/copy.ts`. The draft uses straight apostrophes; switch to copy.ts's typographic ones (’) when landing. Keys that already exist keep their names where the meaning is unchanged.

```ts
// ── AI-data consent (consent version 2) ──
consentTitle: 'Before Whim builds apps for you',
consentLead:
  'To build or change an app, Whim sends what you ask for to our server. AI companies that work for us write the code.',

consentSentTitle: 'What gets sent',
consentSentRequest: 'What you ask for: your description, your answers and the plan you approve',
consentSentEdit: 'When you change an app: its name, code and description, and the layout of its data, never the data itself',
consentSentDevice: 'An ID Whim makes for this phone, used for daily limits and usage totals.',
consentSentErrors: 'Error details when something goes wrong. They\'re technical only, not what you typed or saved.', // [B9]

consentWhyTitle: 'Why',
consentWhy: 'To build your apps and run Whim: daily limits, stopping abuse, keeping costs in check, and finding and fixing problems.',

consentWhoTitle: 'Who gets it',
consentWho:
  'AnyCognition, the company that makes Whim, and companies that do work for us, like cloud hosting and AI providers. Some of them are outside Canada. They can\'t train AI on it or use it for their own products, though some may keep it for a short time for security and legal reasons. Apple or Google may also check that requests come from the real Whim app. We give information to authorities when the law requires it.', // [B1][D22]

consentStaysTitle: 'What you save in your apps',
consentStays: 'Nobody at Whim can read it. It stays on your phone, and anything Whim ever syncs or backs up for you is encrypted on your phone with a key Whim never has.', // [B7][B9][D21]

consentNeverTitle: 'What we never do',
consentNever: 'Show ads, sell your data or share it for advertising, or track you across other apps and websites.',

consentAskFirst:
  'If we ever want to collect a new kind of information, use it for a new purpose, keep it longer, or give it to a new kind of company, we\'ll ask you first.', // [B10]
consentFootnote: 'You can turn AI features and error details off in Settings. Apps you already have keep working either way.', // [B4]

consentAgree: 'Agree and continue',
consentDecline: 'Not now',

// Shown above the title when the stored grant is from an older version.
consentOutdatedLine: 'This has changed since you last agreed.',
// Generated from the manifest diff between the grant's version and this one. It names every widening. The v1 → v2 line:
consentWhatsNew:
  'New: error details when something goes wrong, checks by Apple or Google that requests come from the real Whim app, and we may now keep reports and usage records for up to 12 months instead of 90 days. The list of who gets what and why is plainer too.',

privacyPolicyLabel: 'Privacy policy',

// Review mode keeps today's three keys unchanged:
// consentReviewKeepOn 'Keep AI features on', consentReviewTurnOff 'Turn off AI features',
// consentReviewTurnOn 'Turn on AI features'.
```

Screen order, top to bottom: outdated line and what's new (only when outdated), title, lead, "What gets sent" with four bullets, "Why", "Who gets it", "What you save in your apps", "What we never do", ask-first line, footnote, the privacy policy link, then the buttons. Nothing is pre-selected, and back or "Not now" grants nothing (unchanged from today's spec). Nothing about the terms appears on this screen: Play's prominent-disclosure rule says it "cannot be included with other disclosures unrelated to personal and sensitive user data collection".

The "keep it longer" clause in the ask-first line is backed by the manifest: lengthening a published maximum counts as widening (README, re-consent rule).

Why the saved-data line reads the way it does [D21]: it has to be true today and stay true once encrypted sync ships. "Nobody at Whim can read it" leads because it's the promise that survives both. "It stays on your phone" is today's fact, and the rest of the sentence covers sync and any backup Whim offers without describing a feature that doesn't exist. An iCloud or Google backup is the phone maker's, not Whim's, and the policy says so. The sentence binds the sync design: the key can never reach Whim, recovery included. When sync ships, this line doesn't change and nobody is asked again; sync asks for itself the first time it's turned on.

If App Review insists on seeing a provider name (decision 6's fallback), add this line under "Who gets it". It's a fact, not part of the manifest, so changing it never bumps the version:

```ts
consentProvidersNow: 'Right now, requests reach AI providers through OpenRouter.',
```

### Terms step [D9][B5]

A separate screen, shown once, right before the consent screen the first time someone turns on the AI features. It says nothing about data.

```ts
termsTitle: 'Terms of use',
termsLead: 'Whim\'s AI features come with a few rules: what you can build, what AI gets wrong, and what we\'re responsible for.',
termsLabel: 'Read the terms of use',
termsAccept: 'Accept',
termsDecline: 'Not now', // grants nothing; the AI features stay off and the consent screen isn't shown
// Shown instead of termsLead when the terms changed materially (30 days after the in-app notice):
termsUpdatedLine: 'We\'ve updated the terms of use.',
```

For fr-CA users, the step shows French first, with an express "Continue in English" choice (decision 16, lawyer item 14).

### Settings, report sheet

```ts
// Settings → AI features section [B4]
settingsErrorDetailsTitle: 'Send error details',
settingsErrorDetailsHint: 'When something goes wrong, Whim sends technical details so we can fix it. Not what you typed or saved.', // [B9]

// Settings → About section [D8][B4]
settingsDeviceIdTitle: 'This phone\'s ID',
settingsDeviceIdHint: 'The ID Whim made for this phone. Include it if you ask us about your data.',
settingsDeviceIdReset: 'Make a new ID',
settingsDeviceIdResetConfirm:
  'Whim will use a new ID from now on. Records tied to the old one are kept for up to 12 months, then deleted. Write to us if you want them deleted sooner.', // [B8]

// Report sheet
reportDeviceIdLine: 'This phone\'s Whim ID goes with your report. The report goes to AnyCognition, the company that makes Whim.', // replaces reportAnonIdLine
reportPrivacyLink: 'Privacy policy', // new: the sheet is the notice for reports, which skip the consent screen
reportThanksTitle: 'Thanks. We\'ll look into it.', // replaces "The Whim team reads every report."
// reportCodeDisclosure, reportNoCodeDisclosure, reportIncludePrompt and the rest stay as they are.
```

---

## 2. Privacy policy

Replaces `deploy/site/privacy.html` (convert to the same HTML shell). `{{WHIM_SUPPORT_EMAIL}}`-style placeholders can carry the privacy mailbox the same way.

> # Privacy policy
>
> Effective [date]. Version 2. What changed is listed at the end.
>
> This policy covers the Whim app and Whim's website, whim.anycognition.ca, including the app-link pages that open when someone taps a link to a Whim app.
>
> ## The short version
>
> - Nobody at Whim can read what you save inside your apps. It stays on your phone, and anything Whim ever syncs or backs up for you is encrypted on your phone with a key Whim never has. [B7][B9][D21]
> - When you ask Whim to build or change an app, it sends your request to our server, and AI companies that work for us write the code.
> - No ads. We don't sell your information or share it for advertising, and we don't track you across other apps or websites.
> - If we ever want to collect a new kind of information, use it for a new purpose, keep it longer, or give it to a new kind of company, the app will ask you first. [B10]
>
> ## Who we are
>
> Whim is made by AnyCognition Inc., [street address], Ottawa, Ontario, Canada. In this policy, "we" and "us" mean AnyCognition.
>
> Our Privacy Officer, the [title], is responsible for how Whim handles personal information. Write to [privacy@anycognition.ca] with any question or request. [B2]
>
> [Only if appointed: Our representative in the European Union is [name, address, email]. Our representative in the United Kingdom is [name, address, email].]
>
> ## What you save in your apps
>
> Nobody at Whim can read it. The apps Whim builds for you run on your phone, and what you save in them is stored there. Nothing the app sends includes it: not build requests, not error details, not reports. It leaves your phone only if you copy it out yourself, for example by typing it into a report's note. [B7][B9]
>
> If Whim ever offers to sync or back up your apps for you, it will be a choice you turn on, and what it sends will be encrypted on your phone with a key Whim never has, so we still can't read it. [D21]
>
> If your phone backs itself up, for example to iCloud, the backup can include your apps and what's in them. That backup is between you and your phone's maker, and Whim can't read it. A backup also carries this phone's Whim ID to any phone you restore it onto. Make a new ID in Settings if you want a fresh one.
>
> ## What leaves your phone
>
> Whim sends nothing until you tap "Agree and continue" on the "Before Whim builds apps for you" screen. The one exception is a report, which you send yourself. [Once subscriptions ship, replace the last sentence with: "The exceptions are a report you send yourself and a subscription you buy."]
>
> | What | When | Why |
> |---|---|---|
> | **Your request.** What you type to describe an app, your answers to Whim's questions, and the plan you approve. | When you build or change an app. | To build or change the app, after an automated safety check. |
> | **App material.** An app's name, code and description, and the layout of its data: the names and kinds of its fields, never what's in them. | When you change an app. | To change the app. |
> | **An ID for this phone.** Whim makes it on your phone. It isn't your phone number or the phone's hardware ID. | With build and change requests, error details and reports. | Daily limits, stopping abuse, keeping costs in check, telling one phone's requests apart from another's, and finding your records if you ask. |
> | **Error details.** App and system versions, the kind of error, where in the code it happened, which screen you were on, and a request number. Never what you typed or saved. [B9] | Whim may send these when something goes wrong, unless you turn them off. | To find and fix problems. |
> | **App-integrity check.** A key made on your phone, and a verdict from Apple or Google on whether a request comes from a genuine Whim app on a real phone. It's tied to your phone's Whim ID, not to your Apple or Google account. [D22] | Whim may ask for one with requests it sends. | To stop scripts and modified copies of the app from abusing Whim and using up everyone's daily limits. |
> | **Connection data.** Your IP address, the time, the Whim version and build you're running, and similar details that any internet service sees. | With everything the app sends, and when you visit Whim's website. | To answer the request, keep Whim secure and working, tell old versions to update, and stop abuse. |
> | **Reports.** The reason you pick, any note you write, the app's name, and the app's code if it's saved on your phone. You choose whether to include the prompt that made it. | Only when you tap "Send report". | To look into what went wrong and keep Whim safe. |
> | [Only once subscriptions ship: **Purchases.** What you bought, when it started and when it renews or ends, and the store's reference for it. Apple or Google takes the payment under their own terms; we never see your card, your name or your store account. | When you subscribe, and when the app checks your subscription. | To give you what you paid for.] |
>
> From these, we keep **usage records** tied to your phone's ID: for each request, the kind of request, when it started and ended, how it ended (including any error code), its size, what it cost us, and reference numbers. Usage records never contain what you asked for. We also keep security and operational **logs** of how our servers are running.
>
> App stores list this information as "linked to you" because it's tied to your phone's Whim ID. Whim doesn't use it to track you across other companies' apps or websites.
>
> If you speak instead of typing, your keyboard turns your speech into text before Whim sees it. Apple, Google or your keyboard's maker does that under their own terms. Whim gets only the text.
>
> ## How the AI part works
>
> Our server sends your request, and app material when you change an app, to AI model providers that write or change the code. First, an automated safety check, also run by an AI provider, decides whether the request is allowed. If it refuses something you think is fine, write to us and a person will look at it.
>
> AI providers work for us. They may not train AI models on what we send or use it for their own products. Some keep requests for a limited time to check for abuse and meet legal duties, under their own published retention periods. [B1]
>
> We may change which companies do this work. The current ones are listed under "Who handles it right now". If a change would let any company use your information for its own purposes, we'll ask you first.
>
> ## Why we use it, and the legal basis
>
> Some privacy laws, including the EU's and the UK's, ask us to name a legal basis for each use.
>
> | What we do | With what | Legal basis |
> |---|---|---|
> | Build and change your apps | Your request, app material, the phone ID | Needed to provide the service you ask for (our terms of use) |
> | Apply daily limits, stop abuse, keep Whim secure and running, understand our costs | The phone ID, the app-integrity check, usage records, connection data, logs, the safety check on requests | Our legitimate interest in running Whim safely and within budget |
> | [Only once subscriptions ship: Give you what you subscribed to] | [Purchases, the phone ID] | [Needed to provide the service you bought] |
> | Find and fix problems | Error details, usage records, logs | Our legitimate interest in keeping Whim working. You can turn error details off. |
> | Look into reports | Reports | You asked us to, and our legitimate interest in keeping Whim safe |
> | Meet legal duties | Whatever the law requires | Legal obligation |
>
> In Canada, and anywhere else the law asks for consent, we rely on the consent you give on the "Before Whim builds apps for you" screen, and on your choice to send a report. In the EU, that same tap is also your consent to Whim storing the phone ID on your phone and reading it, and the error-details switch is your consent for error details. You can take back your consent at any time in Settings.
>
> ## Who we share it with
>
> - **Companies that do work for us**, like cloud hosting, AI providers, logging and monitoring, and email. They handle information only on our instructions, and each must protect it at least as well as this policy does. [B1][B3]
> - **Apple or Google**, when they check that a request comes from a genuine Whim app, and when we confirm a purchase you made with them. They handle that under their own terms. [D22]
> - **When the law requires it**: a valid law, court order or government demand. We may also share what's needed to deal with fraud, security or safety problems.
> - **If Whim changes hands.** If AnyCognition or Whim is sold or merged, the records we hold go to the new owner, who must follow this policy or ask you first.
>
> Nobody else. We don't sell or rent your information, and we don't give it to advertisers or data brokers.
>
> ## Who handles it right now
>
> [D17] The companies that currently handle information for us, what they do, and where. We update this list when it changes, with the date.
>
> | Company | What it does | What it receives | Where |
> |---|---|---|---|
> | Google Cloud (Google LLC) | Hosts our server and logs | Everything the app sends | Canada (Montreal) [confirm log storage region] |
> | OpenRouter, Inc. [confirm legal name and contact] | Passes each AI request to a model provider | Your request and app material | United States |
> | [AI model providers OpenRouter may route to, with country] | Write and check the code | Your request and app material | [countries] |
> | [Email provider, if any] | Sends us alerts | [what] | [country] |
> | [Once #65 ships: Apple Inc. (App Attest) and Google LLC (Play Integrity)] | Check that requests come from a genuine Whim app | The app-integrity check | United States |
>
> Last changed: [date].
>
> ## Where it's handled
>
> We and the companies that work for us handle information in Canada, the United States and other countries listed above. When the law requires safeguards for sending personal information out of your country or province, for example from Quebec, the EU or the UK, we put them in place. [B3] For the EU and UK: Canada has an adequacy decision for businesses covered by its federal privacy law. For the United States, we rely on the EU-US Data Privacy Framework (and its UK extension) where the recipient is certified, and otherwise on standard data-protection contract clauses. Write to us if you want details.
>
> ## How long we keep it
>
> | What | How long |
> |---|---|
> | Your request and app material | Only while your request is being handled. We don't keep it afterwards, except inside a report you send. [D2] AI providers may keep it for a limited time, as "How the AI part works" says. |
> | Reports | Deleted within 12 months. [D5] |
> | Usage records | Per-request records: deleted within 12 months. Running totals for your phone's ID: kept while you use Whim, deleted 12 months after the ID was last used. [D5][B8] |
> | Error details, connection data and logs | Deleted within 90 days. [D5] |
> | The phone ID | On your phone until you delete Whim or make a new ID in Settings. On our side it lives only inside usage records, error details and reports, which are deleted as above. [B4][B8] |
> | The app-integrity check | Deleted within 12 months after the phone ID was last used. [D22][B8] |
> | [Only once subscriptions ship: Purchases | While your subscription runs, then deleted within 12 months unless tax law requires longer.] |
>
> Reports and usage records made before [v2 date] are deleted within 90 days, as the earlier version of this policy said. We keep something longer only when the law requires it, or while we deal with a specific security or legal problem.
>
> ## Keeping it safe
>
> Everything the app sends is encrypted in transit. We don't store what you ask for, except inside a report you send, and we keep as little else as we can. Only the people who run Whim can reach our servers and the records on them.
>
> If a breach creates a real risk of significant harm, we'll tell the regulators the law requires and the people affected. We don't know who you are, so we may tell you in the app or publicly.
>
> ## Your choices
>
> - **Don't agree.** Tap "Not now" and nothing is sent. The example apps and any apps already on your phone keep working.
> - **Turn off AI features** in Settings at any time. That stops everything the app sends except reports you choose to send. Your apps keep working.
> - **Turn off error details** in Settings, and keep everything else. [B4]
> - **Make a new phone ID** in Settings. Records tied to the old one are kept for up to 12 months, then deleted. Write to us if you want them deleted sooner. [B4][B8]
> - **Reports are up to you.** You see what's in one before you send it, and you choose whether to include the prompt.
>
> ## Your rights
>
> Depending on where you live, you can ask us to tell you what we hold about you and give you a copy, correct it, delete it, limit how we use it, or take back your consent.
>
> **You can object at any time** to our use of your information based on legitimate interests (see the legal-basis table). Write to us, or turn off AI features or error details in Settings, which stops it at once.
>
> To ask, write to [privacy@anycognition.ca]. Include your phone's ID from Settings. We don't know who you are, so without it we can't tell which records are yours. [B4][B8] We answer within 30 days, and there's no charge.
>
> If you're unhappy with how we handle your information, complain to us first at the same address. We'll acknowledge your complaint within 30 days and tell you what we're doing about it. You can also complain to a privacy regulator at any time, such as the Office of the Privacy Commissioner of Canada, Quebec's Commission d'accès à l'information, the UK Information Commissioner's Office, or the data protection authority where you live in the EU.
>
> ## Children
>
> Whim is for people 13 and older. It isn't meant for children under 13, and we don't knowingly collect information from them. If you think a child under 13 has sent us something, tell us and we'll delete it.
>
> [D18: only once store age signals are integrated.] Where the law requires it, Whim asks your app store for your age range and whether a parent has approved. That answer stays on your phone. Whim uses it only to apply age rules and never sends it to us.
>
> ## Do Not Track, and tracking by others
>
> We don't track you across other apps or websites, so a browser's Do Not Track signal has nothing to switch off. We don't let other companies collect information about your activity over time or across other apps and websites through Whim.
>
> ## US state privacy laws
>
> We don't sell or share personal information as California and other US states define those words, and we don't use it for targeted advertising.
>
> ## If you point Whim at another server
>
> [D7: delete this section if the server override is removed from release builds.] Settings lets you send Whim's requests to a different server. If you do, that server's operator gets them, not us, and this policy doesn't cover what they do.
>
> ## Changes to this policy
>
> If we want to collect a new kind of information, use it for a new purpose, keep it longer than this page says, or give it to a new kind of recipient, the app will ask you first, and it won't send anything new until you agree. A new feature you choose to turn on asks for itself when you first use it.
>
> For other changes, like clearer wording, a different company doing the same job, or keeping something for less time, we update this page, change the date at the top and add a line below.
>
> - [date], version 2: rewritten in plainer words. Adds error details, app-integrity checks by Apple or Google, connection data and logs, the list of companies that handle information for us, the Privacy Officer, your rights, legal bases, and where information is handled. Reports and usage records may now be kept for up to 12 months instead of 90 days; those made before this version still go within 90 days.
> - 2026-09-22, version 1: first version.
>
> ## Contact
>
> [privacy@anycognition.ca], or AnyCognition Inc., [street address], Ottawa, Ontario, Canada.

---

## 3. Store listing text

Only the privacy lines of `release/store/app-store/en-US/description.txt` and `release/store/play/en-US/full_description.txt` change. No URLs: the listing checker refuses them.

Replace the paragraph that begins "To build or change an app, Whim sends your request…" with:

> To build or change an app, Whim sends what you describe to its server, and AI companies working for Whim write the code. Nobody at Whim can read what you save inside your apps; it stays on your phone. The privacy policy has the details.

[B7]: this paragraph can't ship until network-deny acceptance passes.

Replace "Whim has no accounts, no login, no ads, and no analytics." with:

> Whim has no accounts, no login and no ads.

---

## 4. Store declarations

Declare error details now, before diagnostics ship. Both stores present these answers as what the app "may" collect, so declaring early is accurate, and it means nothing changes in either console on diagnostics launch day. Confirm every value in its own console before submitting.

### Google Play Data safety

| Data type (Play name) | Collected | Shared | Processed ephemerally | Required or optional | Purposes |
|---|---|---|---|---|---|
| Other user-generated content (requests, app material, reports) | Yes | Yes | No | Required | App functionality; Fraud prevention, security and compliance |
| Device or other IDs (the random phone ID) | Yes | No | No | Required | App functionality; Analytics; Fraud prevention, security and compliance |
| App interactions (usage records) | Yes | No | No | Required | App functionality; Analytics; Fraud prevention, security and compliance |
| Crash logs (error details) | Yes | No | No | Optional | Analytics; App functionality |
| Diagnostics (error details) | Yes | No | No | Optional | Analytics; App functionality |

Security section: data is encrypted in transit, **Yes**. Users can ask for their data to be deleted, **Yes**.

Notes on the answers:

- "Shared" follows one rule, recorded with the manifest (decision 19): a type is Shared when it goes to a recipient whose service-provider status isn't confirmed. Today only user content goes to AI providers, so only it is Yes. The phone ID, usage records and error details reach only Whim's own server and its hosting and logging providers, which are service providers under Play's exception, so moving logs or diagnostics to another such provider (Cloud Logging, Sentry) doesn't change an answer. User content flips to No once B1 and B3 are done and lawyer item 3 confirms the AI providers' role. Until then, the policy's "Who handles it right now" list names the parties, as Play's policy clause asks ("any parties with which any personal or sensitive user data is shared").
- Required or optional follows Play's definition: "required" when the app's primary functionality needs the type. Building apps is the primary functionality, and it needs the request, the ID and a usage record, so those are Required. Error details have their own switch and are Optional. Reports are hand-sent, but Play asks per type and user content is already Required. (Play's "optional" wording about opting in pulls the other way, since the AI features are off until the user agrees; stores.md §2.3 reached the same Required answer.)
- Analytics is declared for the ID and usage records because the operator report looks at cost per phone ID. Keeping it declared gives room; it isn't tracking and isn't shared.
- Play files crash logs and app-health monitoring under "Analytics" (its definition: "monitoring app health and diagnosing bugs"). That's why no text anywhere should say "no analytics".
- IP addresses aren't declared: Play says to declare them by how they're used, and Whim doesn't use them to work out location or to set limits. The owner decided against per-IP limits (shared Wi-Fi and carrier NAT put many people behind one address), so this should stay true.
- The app-integrity check (#65) rides with the phone ID, so "Device or other IDs" already covers it; its purposes include fraud prevention. Whether Play expects Play Integrity itself to be declared wasn't checked. Look when #65 ships [D22]. The app version header (#64) is part of the request, not a new type.
- [Once subscriptions ship: add "Purchase history" under Financial info, Collected Yes, Shared No, Optional, purpose App functionality. On Apple, add Purchases, Linked, App Functionality.]

`release/store/play/data-safety.json`:

```json
{
  "encryptedInTransit": true,
  "deletionRequestMechanism": "Email the privacy contact in the privacy policy with the ID shown in Whim's Settings, and we delete the records tied to it within 30 days. Reports and usage records are deleted automatically within 12 months, and error details and logs within 90 days.",
  "types": [
    {
      "id": "other_user_generated_content",
      "collected": true,
      "shared": true,
      "sharedWith": "AI providers acting for AnyCognition",
      "optional": false,
      "ephemeral": false,
      "purposes": ["app_functionality", "fraud_prevention_security_compliance"]
    },
    {
      "id": "device_or_other_ids",
      "collected": true,
      "shared": false,
      "optional": false,
      "ephemeral": false,
      "purposes": ["app_functionality", "analytics", "fraud_prevention_security_compliance"]
    },
    {
      "id": "app_interactions",
      "collected": true,
      "shared": false,
      "optional": false,
      "ephemeral": false,
      "purposes": ["app_functionality", "analytics", "fraud_prevention_security_compliance"]
    },
    {
      "id": "crash_logs",
      "collected": true,
      "shared": false,
      "optional": true,
      "ephemeral": false,
      "purposes": ["analytics", "app_functionality"]
    },
    {
      "id": "diagnostics",
      "collected": true,
      "shared": false,
      "optional": true,
      "ephemeral": false,
      "purposes": ["analytics", "app_functionality"]
    }
  ]
}
```

### App Store App Privacy

| What it covers | Apple data type | Linked to you | Used to track you | Purpose |
|---|---|---|---|---|
| Requests, app material, reports | Other User Content | Yes | No | App Functionality |
| The random phone ID | Device ID | Yes | No | App Functionality; Analytics |
| Usage records | Product Interaction | Yes | No | App Functionality; Analytics |
| Error details | Crash Data | Yes | No | App Functionality; Analytics |
| Error details | Other Diagnostic Data | Yes | No | App Functionality; Analytics |

Why "Linked" everywhere: Apple's definition counts linkage "via their account, device, or other details", and says that personal data under privacy law "is considered linked to the user". Everything here travels with the phone ID or can be joined to it (error details carry a request number that matches a usage record). Apple's App Functionality purpose explicitly includes "prevent fraud", "minimize app crashes" and "perform customer support", which covers limits, error details and reports. Analytics is added wherever Play declares it, so the two stores tell the same story: usage records feed a cost-per-phone report, and error details are app-health data. It gives room and costs nothing, since it's neither tracking nor shared. No tracking: nothing is combined with other companies' data, and there are no ads, so no App Tracking Transparency prompt.

`release/store/app-store/app-privacy.json`:

```json
[
  { "category": "OTHER_USER_CONTENT", "purposes": ["APP_FUNCTIONALITY"], "data_protections": ["DATA_LINKED_TO_YOU"] },
  { "category": "DEVICE_ID", "purposes": ["APP_FUNCTIONALITY", "ANALYTICS"], "data_protections": ["DATA_LINKED_TO_YOU"] },
  { "category": "PRODUCT_INTERACTION", "purposes": ["APP_FUNCTIONALITY", "ANALYTICS"], "data_protections": ["DATA_LINKED_TO_YOU"] },
  { "category": "CRASH_DATA", "purposes": ["APP_FUNCTIONALITY", "ANALYTICS"], "data_protections": ["DATA_LINKED_TO_YOU"] },
  { "category": "OTHER_DIAGNOSTIC_DATA", "purposes": ["APP_FUNCTIONALITY", "ANALYTICS"], "data_protections": ["DATA_LINKED_TO_YOU"] }
]
```

This fails today's release check until B6 lands (`checkNoLinkageOrTracking` refuses `DATA_LINKED_TO_YOU`, and `PRIVACY_TYPE_MAPPING` allows only two types). Check the exact purpose token (`ANALYTICS`) against the release tooling's schema when landing.

### iOS privacy manifest

Replace the `NSPrivacyCollectedDataTypes` array in `ios/Whim/PrivacyInfo.xcprivacy`. `NSPrivacyAccessedAPITypes` and `NSPrivacyTracking` (false) stay as they are.

```xml
<key>NSPrivacyCollectedDataTypes</key>
<array>
	<dict>
		<key>NSPrivacyCollectedDataType</key>
		<string>NSPrivacyCollectedDataTypeOtherUserContent</string>
		<key>NSPrivacyCollectedDataTypeLinked</key>
		<true/>
		<key>NSPrivacyCollectedDataTypeTracking</key>
		<false/>
		<key>NSPrivacyCollectedDataTypePurposes</key>
		<array>
			<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
		</array>
	</dict>
	<dict>
		<key>NSPrivacyCollectedDataType</key>
		<string>NSPrivacyCollectedDataTypeDeviceID</string>
		<key>NSPrivacyCollectedDataTypeLinked</key>
		<true/>
		<key>NSPrivacyCollectedDataTypeTracking</key>
		<false/>
		<key>NSPrivacyCollectedDataTypePurposes</key>
		<array>
			<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			<string>NSPrivacyCollectedDataTypePurposeAnalytics</string>
		</array>
	</dict>
	<dict>
		<key>NSPrivacyCollectedDataType</key>
		<string>NSPrivacyCollectedDataTypeProductInteraction</string>
		<key>NSPrivacyCollectedDataTypeLinked</key>
		<true/>
		<key>NSPrivacyCollectedDataTypeTracking</key>
		<false/>
		<key>NSPrivacyCollectedDataTypePurposes</key>
		<array>
			<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			<string>NSPrivacyCollectedDataTypePurposeAnalytics</string>
		</array>
	</dict>
	<dict>
		<key>NSPrivacyCollectedDataType</key>
		<string>NSPrivacyCollectedDataTypeCrashData</string>
		<key>NSPrivacyCollectedDataTypeLinked</key>
		<true/>
		<key>NSPrivacyCollectedDataTypeTracking</key>
		<false/>
		<key>NSPrivacyCollectedDataTypePurposes</key>
		<array>
			<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			<string>NSPrivacyCollectedDataTypePurposeAnalytics</string>
		</array>
	</dict>
	<dict>
		<key>NSPrivacyCollectedDataType</key>
		<string>NSPrivacyCollectedDataTypeOtherDiagnosticData</string>
		<key>NSPrivacyCollectedDataTypeLinked</key>
		<true/>
		<key>NSPrivacyCollectedDataTypeTracking</key>
		<false/>
		<key>NSPrivacyCollectedDataTypePurposes</key>
		<array>
			<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			<string>NSPrivacyCollectedDataTypePurposeAnalytics</string>
		</array>
	</dict>
</array>
```

---

## 5. App Review notes

Replaces the "WHAT LEAVES THE PHONE, AND WHEN" section of `release/store/app-store/review_information/notes.txt` (and §4 of `docs/store/review-notes.md`). It's reviewer-only, so it names the router; the in-app screen doesn't. Keep the network-deny TODO above it until tasks 13.6 and 13.7 pass [B7]. About 1,200 characters with the bracketed sentences, so it fits the 4,000-character limit alongside the rest of the notes.

> WHAT LEAVES THE PHONE, AND WHEN
> Nothing leaves the phone from inside a mini app (see the note above while it stands). Outside mini apps, Whim sends nothing until the user taps "Agree and continue" on the AI-data consent screen. That screen says what is sent, why, and who receives it, including third-party AI (guideline 5.1.2(i)), and Settings can turn it off at any time. After that, building or changing an app sends what the user typed, their answers and the approved plan. A change also sends the app's name, code, description and data layout, never the data saved inside it. A random per-install ID is sent too, for daily limits and abuse prevention, with the app's version and build [#64]. [Once #65 ships: Each request carries an App Attest assertion, which the server checks to confirm a genuine install.] Right now the server passes requests to AI model providers through OpenRouter, restricted to providers that don't train on the data or use it for their own products [B1]. The app may also send technical error details with no user content, which the user can turn off in Settings [B4][B9], and it checks server health. A report is sent only when the user taps "Send report" and doesn't need AI consent. No ads, no ad or tracking SDK, no tracking, so no ATT prompt.

In the 4.7.1 paragraph, "the consent screen ("Before Whim makes apps for you") discloses what is sent and to whom" becomes "the consent screen ("Before Whim builds apps for you") discloses what is sent, why, and to whom".

Add two short answers for guidelines 4.7.4 and 4.7.5:

> 4.7.4: Whim offers no catalogue of software. Each mini app is built on request for the one user who asked for it and lives only on their phone. The Home screen is the index of that user's apps, and each has a universal link (whim.anycognition.ca/a/<id>) that opens it.
> 4.7.5: Whim is rated 13+. The server's content check refuses requests for content above that rating, so no mini app needs a separate age gate. [D18: once store age signals are integrated, add: "Whim also reads the store's age range where the law requires it and keeps it on the device."]

---

## 6. Terms of use

New page at `/terms` [B5], accepted in the terms step (section 1). A draft for a lawyer to tighten, not a finished contract: the governing-law, liability and change clauses are exactly where consumer law differs by country (lawyer item 10). It needs a French version offered first to Quebec users (decision 16). It no longer says Whim is free: nothing requires that promise, and a paid tier would force an edit. Sections 7a and 7b are bracketed until a subscription and sync ship; adding them later binds only people who buy or turn sync on, so it isn't a material change for anyone else.

> # Terms of use
>
> Effective [date].
>
> These terms are an agreement between you and AnyCognition Inc. ("we", "us"), [street address], Ottawa, Ontario, Canada, the company that makes Whim. You accept them by tapping "Accept" on the terms screen before you first turn on Whim's AI features. The licence in section 3 applies to the app itself from the moment you install it.
>
> ## 1. Who can use Whim
>
> You must be at least 13. If the law where you live sets a higher age for using a service like this without a parent's permission, you need that permission.
>
> ## 2. What Whim does
>
> Whim uses AI to build small apps from what you describe. We set daily limits and may change them. We may change, pause or stop Whim or any part of it. If we stop the AI features, apps already on your phone keep working.
>
> ## 3. Your licence to use Whim
>
> We give you a personal, non-exclusive, non-transferable licence to use Whim on devices you own or control, for as long as these terms apply, subject to the rules of the app store you got it from. You may not copy, resell or reverse-engineer the app except where the law allows it. We keep all rights we don't give you here. We may end the licence if you break these terms.
>
> ## 4. Your requests and your apps
>
> What you type is yours. You let us use it to build and change your apps and as the privacy policy describes. We don't claim ownership of the apps Whim builds for you, and you can use them as you like. AI can give other people similar results, and the law may not give anyone copyright in what AI produces, so we can't promise you exclusive rights.
>
> ## 5. AI makes mistakes
>
> Apps Whim builds can be wrong, incomplete or behave in ways you don't expect, even when they look right. Check anything that matters. Don't rely on them for medical, legal, financial or safety decisions, or anywhere a mistake could hurt someone.
>
> ## 6. What you may not do
>
> Don't use Whim to:
>
> - build anything illegal, or anything that harms, harasses, deceives or defrauds people;
> - build malware, or anything meant to break into, disrupt or spy on devices, accounts or systems;
> - create sexual content involving minors, or content that exploits anyone;
> - infringe anyone else's rights;
> - get around daily limits, safety checks or security, overload our servers, or try to extract how our service works;
> - break the terms of the app store you got Whim from.
>
> ## 7. Safety checks, reports and limits
>
> An automated check may refuse a request. If you think it got it wrong, tell us and a person will look. You can report an app from inside Whim, and we look into reports. If a phone's ID is used to break these terms, we may stop it from building or changing apps. Apps already on that phone keep working.
>
> [Only once subscriptions ship:
>
> ## 7a. Subscriptions
>
> You buy a subscription through the App Store or Google Play, and the store bills you, renews it and handles cancellations and refunds under its own terms. The subscription page in Whim says what it includes and what it costs. We may change what a subscription includes; if a change takes something away, we'll tell you in the app at least 30 days before your next renewal, so you can cancel first.]
>
> [Only once sync ships:
>
> ## 7b. Sync and backup
>
> Sync is encrypted on your phone with a key we never have. That's what keeps us from reading your data, and it also means we can't get it back for you. If you lose every phone and your recovery key, what you synced is gone.]
>
> ## 8. Privacy
>
> The privacy policy explains what Whim sends, why, and who gets it.
>
> ## 9. Other companies
>
> Other companies help us run Whim, including AI providers. They work for us, and you don't have a separate agreement with them through Whim. If you got Whim from the App Store, Apple's standard license agreement for apps also applies, and Apple isn't responsible for Whim or these terms. Google's terms cover your use of Google Play.
>
> ## 10. No warranty
>
> Whim is provided as it is and as available. To the extent the law allows, we don't promise that it will work without interruptions or errors, or that the apps it builds will suit your purpose. Some places don't allow these exclusions, so parts of this section may not apply to you.
>
> ## 11. Limits on our liability
>
> To the extent the law allows, we aren't liable for indirect or consequential losses, or for lost data, profits or opportunities, and our total liability to you for anything to do with Whim is limited to CAD 100. Nothing here limits liability that the law doesn't allow us to limit, or your rights as a consumer where you live.
>
> ## 12. Changes to these terms
>
> We may update these terms. For changes that matter, we'll tell you in the app at least 30 days before they apply. If you keep using the AI features after that, the new terms apply. If you don't agree, stop using them. Changes to what Whim sends follow the privacy policy's ask-first rule, not this section.
>
> ## 13. Ending
>
> You can stop at any time by turning AI features off or deleting Whim. We may end these terms, or stop providing Whim, as sections 2 and 7 describe.
>
> ## 14. Law and disputes
>
> The laws of Ontario and the federal laws of Canada that apply there govern these terms, and the courts of Ontario hear disputes, unless the law where you live gives you the right to use its own laws or courts.
>
> ## 15. Contact
>
> [support email], or AnyCognition Inc., [street address], Ottawa, Ontario, Canada.
