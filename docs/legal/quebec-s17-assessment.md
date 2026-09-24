# Quebec s.17 privacy impact assessment: requests sent outside Quebec

**Status: draft, unsigned.** Written for the owner to complete and sign (README blocker B3; tasks.md 11.4). It is not legal advice. Nobody read the Quebec statute first-hand: both official sites refused the fetch, so everything about s.17 here rests on consistent secondary summaries (canada.md §(f) and gap 1; README "Where the research is thin"). Known risk, accepted by the owner (2026-09-24): no lawyer will review this after launch; the owner's own reading and this assessment stand as final.

## 1. What s.17 asks

As reported (canada.md §(f), medium-high confidence): before communicating personal information outside Quebec, the business must assess the privacy impact, taking into account:

1. how sensitive the information is,
2. the purposes it will be used for,
3. the protection measures, including contractual ones, that will apply to it, and
4. the legal framework of the place it goes to, including its privacy principles.

The information may go only if the assessment shows it would receive adequate protection. The communication must rest on a written agreement that takes the assessment's results into account and, where needed, sets terms to reduce the risks it found.

Section 3.3 may separately ask for an assessment before any new information system that handles personal information. That section's text and number weren't verified (canada.md §(f), low confidence). This document can serve as the start of that assessment too. Known risk, accepted by the owner: whether a s.3.3 assessment was already due is unconfirmed, and no lawyer will answer it.

## 2. What leaves Quebec, to whom, and why

Whim can't tell where a user is. Its server runs in Google Cloud's Montreal region (`deploy/defaults.env`: `northamerica-northeast1`), so every request enters Quebec first. This assessment therefore treats every request as possibly from a Quebec resident.

| Flow | What | From | To | Purpose | Status |
|---|---|---|---|---|---|
| A | The request (what the user typed or dictated, their answers, the plan they approved) and, for a change, the app material (name, code, description, data layout, never saved data) | Whim's server, Montreal | OpenRouter, Inc., United States, which passes it to one model provider per call | Build or change the app, after an automated safety check that is also run by an AI provider | Live. The subject of this assessment. |
| B | Connection data, logs and error details | Whim's server, Montreal | Google Cloud Logging | Keep Whim secure and working; find and fix problems | Once `developer-observability` ships. See section 7. |
| C | App-integrity key and verdict | The phone | Apple (App Attest) or Google (Play Integrity), United States | Stop scripts and modified apps | Once #65 ships. Update this assessment then. |

What doesn't go to OpenRouter or the model providers: the phone ID, the IP address, usage records, error details and reports. These reach only Whim's own server and its hosting and logging providers (draft-copy §4, note on "Shared"; README verification item 24). Reports aren't sent to AI providers (README "What goes", privacy policy row).

TODO(owner): list the model providers OpenRouter actually routed Whim's requests to over the last 30 days, with each one's country. The activity log in the OpenRouter dashboard should show the provider used for each request.

TODO(owner): say whether an email provider receives anything (draft-copy §2's provider list has an "[Email provider, if any]" row). If it receives personal information and sits outside Quebec, add it as a flow.

## 3. How sensitive the information is

Flow A is free text. Whim doesn't ask for anything personal, but people can type anything: health details ("track my insulin doses", README Washington row), money, names, other people's details. Treat it as possibly sensitive.

Two things lower the risk. The request reaches OpenRouter with no phone ID, IP address or device data attached, because Whim's server makes the call. And Whim doesn't keep the request after handling it, except inside a report the user sends (decision 1, third core promise). Identifying someone from what OpenRouter receives would take something the user typed, such as their own name.

## 4. Purposes

Only to build or change the app the user asked for, and to run the safety check on the request first. The providers may not train AI models on it or use it for their own products (README B1). Every request carries `provider: { data_collection: 'deny' }`, which tells OpenRouter to use only providers that don't collect user data (design.md Non-Goals: already sent since f542669).

## 5. Protection measures

**Technical and operational**

- Encrypted in transit (draft-copy §2, "Keeping it safe").
- No identifiers go with the request (section 3).
- `data_collection: 'deny'` on every request (section 4).
- The OpenRouter account setting that excludes providers that train on or keep inputs, and prompt logging off (B1).
- Whim keeps no request after handling (decision 1).
- Zero-retention routing (`zdr: true`) is not relied on (README B1). Some providers that don't train still keep requests for a limited time for abuse checks and legal duties, and the policy says so (draft-copy §2, "How the AI part works").

TODO(owner): confirm the OpenRouter account setting and prompt logging (tasks.md 11.3), with the date checked: ______

**Contractual**

s.17 needs a written agreement with the recipient. Whim's contract is with OpenRouter; it has none with the model providers behind it.

TODO(owner): check whether OpenRouter's standard terms or DPA can serve as the written agreement, and whether they bind OpenRouter's model providers to the same limits (B3). Record the document name, version and date: ______

What the agreement should cover. This is a checklist drawn from the risks in section 6, not a statement of what the law requires. Known risk, accepted by the owner: no lawyer will confirm what the law actually requires here.

- [ ] Use only to provide the service to Whim. No training, and no use for OpenRouter's or a provider's own products.
- [ ] Onward transfer to model providers only under the same limits.
- [ ] Retention: a stated limit for OpenRouter's own request metadata and logs, and for providers' abuse-check copies.
- [ ] Security measures, and confidentiality for anyone who can see requests.
- [ ] Notice to Whim of any incident involving Whim's requests, fast enough for the breach runbook's 72-hour clock.
- [ ] Help with access and deletion requests, where a copy still exists.
- [ ] Notice to Whim before a change in these terms.

## 6. The legal framework where the information goes

**United States (OpenRouter, and any model provider based there).** No federal comprehensive privacy law. The FTC Act §5 makes a company's privacy promises enforceable, with no size threshold (eu-uk-us.md §2.1). State comprehensive privacy laws apply above user-count thresholds (eu-uk-us.md §2.3). The research files don't analyse US government access to data held by US companies for Quebec's purposes. Known risk, accepted by the owner: unresolved, and no lawyer will analyse it.

**Other countries.** Which ones depends on the provider list in section 2. DeepSeek models can be served from several countries. One option, if a country's framework looks weak, is to restrict routing to named providers or countries. Known risk, accepted by the owner: whether routing should be limited by country for Quebec and EU users is undecided, and no lawyer will answer it.

## 7. The logging flow (B)

Server logs live on the VM in Montreal today (`docs/backlog.md`). `developer-observability` moves them to Cloud Logging. Where Cloud Logging stores them depends on the log bucket's region.

TODO(owner): once logs move, confirm the log bucket's storage region (draft-copy §2's provider list also asks this). If it's Montreal, flow B doesn't leave Quebec. If it isn't, assess it here: connection data and logs are low sensitivity (IP addresses, times, versions; no request content), and Google acts for Whim under Google Cloud's terms.

Google Cloud is a US company even when the data stays in Montreal. Whether that alone counts as communication outside Quebec isn't answered by the research. Known risk, accepted by the owner: no lawyer will answer it.

## 8. Risks and what reduces them

| Risk | Reduced by | What's left |
|---|---|---|
| A provider keeps requests longer than it says, or trains on them | `data_collection: 'deny'`, the account setting, the written agreement | Relies on OpenRouter's and the providers' own compliance |
| OpenRouter routes to a new provider without Whim knowing | `data_collection: 'deny'` travels with every request, so a settings change can't undo it (README B1) | The provider list in the policy can fall behind; `docs/legal/change-process.md` covers updating it |
| A government in the destination country demands data | No identifiers sent; nothing kept by Whim; providers keep copies only briefly | Not analysed (section 6) |
| A breach at OpenRouter or a provider | The agreement's incident-notice term; `docs/legal/breach-runbook.md` | Whim learns only if told |
| A user types sensitive details | The consent screen says what is sent and that some recipients are outside Canada (README, Canada rows) | Whim can't stop people typing what they choose |

## 9. Conclusion

Draft view, for the owner to accept or change: with the account setting confirmed and a written agreement covering the points in section 5, the information would receive adequate protection, and flow A may continue. The main reasons are that no identifiers travel with the request, nothing is kept by Whim, and the providers may not train on it or use it for themselves. Without a written agreement, s.17's condition isn't met.

- [ ] Account setting and prompt logging confirmed (section 5)
- [ ] Written agreement in place (section 5)
- [ ] Provider list and countries filled in (section 2)
- [ ] Logging flow checked (section 7)

Review this assessment when a provider or country changes, when new data goes to AI providers, when OpenRouter's terms change, and at least once a year.

TODO(owner): conclusion accepted or changed: ______

Signed: ______ (Privacy Officer, AnyCognition Inc.) Date: ______
