# Quebec s.17 privacy impact assessment: requests sent outside Quebec

**Status: signed 2026-09-24 by Davron Djabborov (Privacy Officer, AnyCognition Inc.).** Written for the owner to complete and sign (README blocker B3; tasks.md 11.4); the owner-completed items below are still open. It is not legal advice. Nobody read the Quebec statute first-hand: both official sites refused the fetch, so everything about s.17 here rests on consistent secondary summaries (canada.md §(f) and gap 1; README "Where the research is thin"). Known risk, accepted by the owner (2026-09-24): no lawyer will review this after launch; the owner's own reading and this assessment stand as final.

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
| B | Connection data, logs and error details | Whim's server, Montreal | Google Cloud Logging | Keep Whim secure and working; find and fix problems | Live since 2026-09-24, stored in Montreal. See section 7. |
| D | Email a user sends to `support@whim.anycognition.ca` (their address, what they write), and alert emails, which carry no user content (a report alert names only its id, reason and sizes) | The user's email provider, or Google Cloud Monitoring | Zoho Mail (Zoho Corporation), United States data centre (the account is on `mail.zoho.com`) | Answer the user; tell the owner something broke | Live. Low sensitivity; the user chooses what to write. |
| C | App-integrity key and verdict | The phone | Apple (App Attest) or Google (Play Integrity), United States | Stop scripts and modified apps | Once #65 ships. Update this assessment then. |

What doesn't go to OpenRouter or the model providers: the phone ID, the IP address, usage records, error details and reports. These reach only Whim's own server and its hosting and logging providers (draft-copy §4, note on "Shared"; README verification item 24). Reports aren't sent to AI providers (README "What goes", privacy policy row).

**Model providers, checked 2026-09-24** (OpenRouter Activity, 2026-08-25 to 2026-09-24; full table, countries and sources in `openrouter-providers-2026-09-24.md`). About 1,389 requests went to 38 providers. By country of the provider's headquarters:

- United States: most of the volume, led by Wafer, CoreWeave, Fireworks, Together and DeepInfra.
- China: Alibaba (13% of requests, the only host of the Qwen models Whim uses), Baidu, StreamLake (Kuaishou), Seed (ByteDance), SiliconFlow, Xiaomi, DeepSeek.
- Canada: Cohere. Sweden: Inceptron. Spain: NextBit. Netherlands: Nebius.
- Not determined: DekaLLM, Open Inference, Mancer, Ambient (no public company record), and Phala (sources disagree).

Six requests went to DeepSeek's own API, which may train on prompts. They predate `data_collection: 'deny'`, which has excluded that API since 2026-09-23.

**Email provider:** Zoho Mail, in the United States, receives support email and alert emails (flow D).

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

Checked 2026-09-24 (openrouter.ai/settings/privacy, which applies each toggle at once): every "allow endpoints that train on or publish request data" toggle is off, OpenRouter's own use of inputs and outputs is off, and zero-data-retention-only routing is off (not relied on, above).

**Contractual**

s.17 needs a written agreement with the recipient. Whim's contract is with OpenRouter; it has none with the model providers behind it.

Checked 2026-09-24. OpenRouter's Terms of Service (last updated 2026-08-31), Privacy Policy (2026-08-31) and Data Processing Agreement (2026-08-26) apply to Whim as they stand. Terms §10.2 incorporates the DPA by reference for commercial use, so there is nothing to sign. OpenRouter itself doesn't train on inputs or outputs, and keeps prompts only if the customer opts in.

They **don't** bind the model providers. The DPA's subprocessor list covers only OpenRouter's own 18 infrastructure vendors. For model providers, DPA §2.4(b) offers only zero-data-retention-only routing, which rests on each provider's published policy "and does not constitute OpenRouter's guarantee". So the "onward transfer under the same limits" item below is not met in writing. The closest available step is to turn on zero-data-retention-only routing. Alibaba, which hosts the Qwen models, keeps prompts for an unknown period, so that change needs a model check first.

What the agreement should cover. This is a checklist drawn from the risks in section 6, not a statement of what the law requires. Known risk, accepted by the owner: no lawyer will confirm what the law actually requires here.

- [ ] Use only to provide the service to Whim. No training, and no use for OpenRouter's or a provider's own products. (Met for OpenRouter itself; for providers, only as each one's published policy.)
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

Checked 2026-09-24. Logs moved to Cloud Logging on 2026-09-24 (`developer-observability`), and at first they went to Cloud Logging's default `_Default` bucket, whose location is **global**, not Montreal. The same day, `deploy/provision.sh` created the `whim-logs` bucket in `northamerica-northeast1` (Montreal, 30 days) and pointed the `_Default` sink at it; new entries were seen arriving there. The global `_Default` bucket now gets nothing new, and its retention was cut to 1 day, so the copies it took (a few hours of connection data and logs: low sensitivity, no request content) expire on 2026-09-25. Google's own `_Required` bucket (global, 400 days) holds only Google Cloud's admin audit logs, not Whim's logs. So flow B stays in Quebec, subject to the next paragraph.

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

- [x] Account setting and prompt logging confirmed (section 5), 2026-09-24
- [ ] Written agreement in place (section 5): OpenRouter's terms and DPA apply, but they don't bind the model providers
- [x] Provider list and countries filled in (section 2), 2026-09-24
- [x] Logging flow checked (section 7), 2026-09-24

Review this assessment when a provider or country changes, when new data goes to AI providers, when OpenRouter's terms change, and at least once a year.

Conclusion: accepted as written by the owner, 2026-09-24.

Signed: Davron Djabborov (Privacy Officer, AnyCognition Inc.) Date: 2026-09-24
