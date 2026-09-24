# OpenRouter providers and terms, as checked 2026-09-24

Evidence for `quebec-s17-assessment.md` sections 2 and 5. Gathered 2026-09-24 in the owner's logged-in OpenRouter session (Activity → Explore, "Past 1 Month") and from OpenRouter's public docs; nothing was changed or accepted. Provider countries come from public company records (Crunchbase, filings, company sites), not from OpenRouter, which publishes none.

## 1. Account privacy settings — openrouter.ai/settings/privacy

Page observed: https://openrouter.ai/settings/privacy (2026-09-24). Screenshot: `screenshots/openrouter-privacy-1.png`.

No "Save changes" control exists anywhere on this page, and no "unsaved changes" banner was present — each toggle appears to be an instant-apply control (confirmed via DOM: no `<button>` containing "save" text, no unsaved-changes text in `document.body.innerText`). So the states below are the account's live, in-effect settings, not a pending draft.

**Data Policies → Zero Data Retention** (per-provider ZDR enforcement toggles) — all OFF (`aria-checked="false"`, `data-state="unchecked"`):
- "All other models" — OFF (ZDR is not required for the bulk of routed providers)
- "Anthropic" — OFF
- "OpenAI" — OFF
- "Google" — OFF
- "SpaceXAI" — OFF

Meaning: the account does **not** restrict routing to Zero-Data-Retention-only endpoints. Non-ZDR providers (which may retain prompts for a bounded period, e.g. "30 days") are eligible for routing.

**Data Training** (all OFF, i.e., all "Allow ..." toggles unchecked):
- "Allow paid endpoints that train on request data" — OFF → paid endpoints that may train on data are **excluded** from routing.
- "Allow free endpoints that train on request data" — OFF → free endpoints that may retain/train on prompts are **excluded**.
- "Allow free endpoints that publish prompts" — OFF → free endpoints that may publish prompts/completions to public datasets are **excluded**.
- "Allow 1% data discount in workspaces" — OFF → the account has not opted OpenRouter itself into using inputs/outputs to improve its product (this is the same toggle described in OpenRouter's docs as "OpenRouter Use of Inputs/Outputs," off by default).

**Regional routing**: "BUSINESS" plan feature, not enabled on this account (shows "Upgrade to Business" — not clicked). No EU/US-only inference-region restriction is currently in force.

**Providers allow/ignore lists**: both empty (no providers explicitly allow-listed or ignore-listed).

**API key expiry**: "No expiration" (max API key lifetime is unrestricted).

## 2. Providers actually used, last 30 days (2026-08-25 – 2026-09-24, OpenRouter's own "Past 1 Month" default)

Source: https://openrouter.ai/activity/explore (dimension=provider), read live in-browser (no CSV export needed; full 38-row table extracted from the page's DOM table). Observed 2026-09-24.

**By request count** (38 distinct providers served requests in the last 30 days; total ≈1,389 requests):

| Provider | Requests | % of total |
|---|---|---|
| Alibaba | 183 | 13.2% |
| Wafer | 162 | 11.7% |
| CoreWeave | 160 | 11.5% |
| Fireworks | 82 | 5.9% |
| Together | 79 | 5.7% |
| DeepInfra | 74 | 5.3% |
| Baidu | 60 | 4.3% |
| Sail Research | 51 | 3.7% |
| Parasail | 43 | 3.1% |
| Novita | 42 | 3.0% |
| Relace | 41 | 2.9% |
| OpenInference | 39 | 2.8% |
| BaseTen | 38 | 2.7% |
| DekaLLM | 38 | 2.7% |
| StreamLake | 36 | 2.6% |
| Cohere | 34 | 2.4% |
| Venice | 30 | 2.2% |
| Seed | 27 | 1.9% |
| Mancer 2 | 21 | 1.5% |
| Phala | 19 | 1.4% |
| DigitalOcean | 15 | 1.1% |
| SiliconFlow | 13 | 0.9% |
| Xiaomi | 13 | 0.9% |
| Reka | 12 | 0.9% |
| Makora | 10 | 0.7% |
| Morph | 9 | 0.6% |
| Inceptron | 8 | 0.6% |
| Cloudflare | 7 | 0.5% |
| GMICloud | 7 | 0.5% |
| AtlasCloud | 7 | 0.5% |
| NextBit | 6 | 0.4% |
| DeepSeek | 6 | 0.4% |
| Nebius | 5 | 0.4% |
| Krea | 3 | 0.2% |
| Modal | 3 | 0.2% |
| Darkbloom | 3 | 0.2% |
| Ionstream | 2 | 0.1% |
| Ambient | 1 | 0.1% |
| Google | 1 | 0.1% |

**By token volume** (top 10, ≈8.2M tokens total, source same page, metric=tokens_total): DeepInfra 24.6%, Alibaba 13.2%, CoreWeave 12.3%, Together 10.4%, Wafer 9.2%, Fireworks 5.2%, DekaLLM 5.1%, Relace 4.4%, Venice 2.2%, Baidu 2.1% (top 10 ≈ 90.7% of tokens; the request-count ranking above differs somewhat because some providers serve fewer, longer requests).

**Models used, by provider** (model×provider request-count matrix, dimension=model/subgroup=provider, 117-row table, top rows shown — source same Explore page, 2026-09-24):
Whim's server routes almost entirely to DeepSeek-family and Qwen(Alibaba)-family open-weight models, e.g.: DeepSeek V4 Flash 0731 (served via Wafer 147, CoreWeave 85, Baidu 54, Fireworks 49, Sail Research 34, Cohere 34, OpenInference 34, BaseTen 27, StreamLake 26, Relace 26, DeepInfra 17, Parasail 12, Reka 12, DigitalOcean 11, Mancer 9, Venice 8, Inceptron 8, Together 6, Morph 6, ...); DeepSeek V4.1 Flash (CoreWeave 70, Together 70, DeepInfra 36, Fireworks 31, Parasail 22, Relace 15, Wafer 15, Sail Research 14, Makora 7, Alibaba 10); DeepSeek V4 Pro 0813 (StreamLake, DeepSeek, BaseTen, Baidu, ~6 each); Qwen3.5-Flash / Qwen3 Coder Next / Qwen3 VL 32B & 8B Instruct / Qwen3.8 Flash / Qwen3.7 Flash / Qwen3 235B A22B Instruct 2507 / DeepSeek V4 Flash 0423 (all via Alibaba); Qwen3.8 27B (DekaLLM 34, Venice 18, Mancer 12); Qwen3 Next 80B A3B Instruct (DeepInfra 17); Seed 1.6 Flash (Seed/ByteDance 23); Ling 3.0 Flash / GLM 4.7 Flash (Novita); MiMo-V2.6-Flash (Xiaomi); Hy3 (Phala).

**Flag for the assessment**: 6 of the ~1,389 requests (0.4%) were routed to the provider named literally **"DeepSeek"** (its own first-party endpoint, serving "DeepSeek V4 Pro 0813"), not to a re-hosting provider. Per OpenRouter's own aggregated provider-policy table (§A3 below), that endpoint's declared policy is **"Prompts are retained for unknown period" / "✕ May train"** — the only elevated-risk entry among Whim's actually-used providers. This is inconsistent with the account's Data Training toggles being OFF (paid endpoints that may train are supposed to be excluded) — worth flagging to the owner as a discrepancy to investigate (possible causes: the toggle was enabled more recently than some of the 30-day window, or a specific request pinned `provider: ["deepseek"]` explicitly, bypassing the training filter — not verified further in this session).

**Resolved by the orchestrator (2026-09-24):** the server has sent `provider: { data_collection: 'deny' }` on every request since commit `f5426690` (2026-09-23 21:19 EDT, deployed with `request-envelope` that night), and that filter drops DeepSeek's own API (measured 2026-09-23, comment in `server/src/openrouter.ts`). Whim pins no provider. So these 6 requests predate the filter.

## 2b. Provider countries (headquarters), with basis for each claim

OpenRouter's own provider pages (e.g. https://openrouter.ai/provider/<slug>) do **not** state a company's headquarters or country — they only link to the provider's own Terms of Service and list served models. So all country claims below come from web research done today (2026-09-24) via public company-information sources (Crunchbase/PitchBook/company sites/news), not from OpenRouter itself, except where noted. Ordered by request-count share (§A2):

| Provider | HQ country (basis) |
|---|---|
| Alibaba | China (Alibaba Group, Hangzhou/global; Qwen API/Model Studio endpoints via Alibaba Cloud, which documents regional processing endpoints in China (Beijing), US (Virginia), Singapore, Japan (Tokyo), and Hong Kong — search results today) |
| Wafer | United States — San Francisco, CA (AI inference-optimization startup, founded 2025; WOWTALE/aVenture funding coverage) |
| CoreWeave | United States — Livingston, NJ (Wikipedia/company filings) |
| Fireworks (Fireworks AI) | United States — Redwood City, CA (company records) |
| Together (Together AI) | United States — San Francisco, CA (company records) |
| DeepInfra | United States — Palo Alto, CA (company records) |
| Baidu (Baidu Qianfan/ERNIE) | China — Beijing (Wikipedia/SEC 20-F); Baidu Cloud documents Chinese data-residency requirements for the ERNIE API |
| Sail Research | United States — San Francisco, CA (Sequoia/Fortune funding coverage, June 2026) |
| Parasail | United States — San Mateo, CA (Crunchbase/press) |
| Novita (NovitaAI) | United States — San Francisco, CA (per search results; note some directories list it ambiguously) |
| Relace | United States — San Francisco, CA (Crunchbase/PitchBook) |
| OpenInference ("Open Inference") | **Not determined** — no company/HQ information found (not a known/indexed company distinct from generic "open inference" search noise); OpenRouter's own provider page for it states no company details either |
| BaseTen | United States — San Francisco, CA (company records) |
| DekaLLM | **Not determined** — no public company/HQ information found; site (dekallm.co) did not resolve during this session |
| StreamLake | China — described in search results as "the intelligent computing brand and enterprise-facing subsidiary of ... Kuaishou Technology" (a Chinese company); exact HQ city not confirmed |
| Cohere | Canada — Toronto (co-headquartered Toronto/San Francisco per company records; offers a separate Canada-region "Model Vault" for data residency) |
| Venice (Venice.ai) | United States — Sheridan, WY (company records; Venice markets a zero-data-retention, local-only architecture) |
| Seed (ByteDance Seed) | China — Beijing (ByteDance HQ); the Seed team also operates labs in China, Singapore and the U.S., served via Volcano Engine (China) / BytePlus (international) |
| Mancer 2 (Mancer, mancer.tech) | **Not determined** — no public company/HQ information found for the mancer.tech LLM-inference service (distinct from an unrelated India-based "Mancer Consulting Services" that also appears in search) |
| Phala (Phala Network) | Disputed in public sources — Crunchbase says San Francisco, CA; Tracxn says Beijing, China; CB Insights says Singapore. Not resolved to a single answer today. |
| DigitalOcean | United States — Broomfield, CO (per FY2025 SEC 10-K) |
| SiliconFlow | China — Beijing (Caixin Global/Baidu Baike) |
| Xiaomi | China — well-known HQ (Beijing); not independently re-verified today beyond general knowledge |
| Reka (Reka AI) | United States — Sunnyvale, CA (company records) |
| Makora | United States — New York, NY (company records) |
| Morph | Not independently verified today (widely reported as a US/SF-based code-model inference startup; not re-confirmed this session) |
| Inceptron | Sweden — Lund (Ideon Science Park; Nordic9/cortecs.ai coverage) |
| Cloudflare | United States — San Francisco, CA; well-known, not re-verified today beyond general knowledge |
| GMICloud | United States — Mountain View, CA (with data centers also in Taiwan, Japan, Singapore, Thailand per company site) |
| AtlasCloud | United States — New York, NY (distinct from an unrelated UK "Atlas Cloud" IT-services company found in the same search) |
| NextBit | Spain (described as a Spain-based/EU AI-inference-infrastructure company, per search results and nextbit256.com) |
| DeepSeek | China — Hangzhou (Hangzhou DeepSeek Artificial Intelligence Co., Ltd.) |
| Nebius | Netherlands — Amsterdam (Nebius Group N.V., the post-Yandex-sale rebrand) |
| Krea | United States — San Francisco, CA (company records) |
| Modal (Modal Labs) | Not independently verified today (generally known as US/SF-based; not re-confirmed this session) |
| Darkbloom | Provided by Eigen Labs, Inc.; Eigen Labs' HQ is reported as Seattle/Redmond, WA, United States (search results) |
| Ionstream (ionstream.ai) | United States — The Woodlands/Spring, TX (company records) |
| Ambient | **Not determined** — described as a decentralized inference network; no HQ information found |
| Google | United States — well known; not re-verified today beyond general knowledge |

**Processing-location claims** (distinct from HQ, where stated): Alibaba's Model Studio documents regional API endpoints in China, US, Singapore, Japan, Hong Kong (each API key is bound to one region). ByteDance Seed is served via Volcano Engine in China and BytePlus internationally. No other provider in the used-list publishes a processing-location statement that OpenRouter or the provider surfaced during this session's research.

## 3. OpenRouter's aggregated provider data-retention/training table

Source: https://openrouter.ai/docs/guides/privacy/provider-logging ("Data Retention & Logging" table), read 2026-09-24. This is OpenRouter's own self-declared aggregation of each provider's disclosed policy ("as reflected in each provider's terms"), not an independently audited fact. Entries for providers Whim actually used in the last 30 days:

| Provider (OpenRouter's table label) | Data Retention | Train on Prompts |
|---|---|---|
| Alibaba Cloud Int. | Prompts retained for unknown period | Does not train |
| Baidu Qianfan | Prompts retained for unknown period | Does not train |
| Baseten | Zero retention | Does not train |
| Cloudflare | Prompts retained for unknown period | Does not train |
| Cohere | Retained for 30 days | Does not train |
| CoreWeave | Zero retention | Does not train |
| Darkbloom | Prompts retained for unknown period | Does not train |
| DeepInfra | Zero retention | Does not train |
| **DeepSeek** | **Prompts retained for unknown period** | **✕ May train** |
| DekaLLM | Zero retention | Does not train |
| DigitalOcean | Zero retention | Does not train |
| Fireworks | Zero retention | Does not train |
| GMICloud | Prompts retained for unknown period | Does not train |
| Google AI Studio | Retained for 55 days | Does not train |
| Google Vertex | Zero retention | Does not train |
| Inceptron | Zero retention | Does not train |
| Ionstream | Zero retention | Does not train |
| Krea | Zero retention | Does not train |
| Makora | Zero retention | Does not train |
| Mancer | Zero retention | Does not train |
| Modal | Zero retention | Does not train |
| Morph | Zero retention | Does not train |
| Nebius Token Factory | Zero retention | Does not train |
| NextBit | Zero retention | Does not train |
| NovitaAI | Zero retention | Does not train |
| Open Inference | Zero retention | Does not train |
| Parasail | Zero retention | Does not train |
| Phala | Zero retention | Does not train |
| Reka AI | Zero retention | Does not train |
| Relace | Zero retention | Does not train |
| Sail Research | Zero retention | Does not train |
| Seed | Zero retention | Does not train |
| SiliconFlow | Zero retention | Does not train |
| StreamLake | Prompts retained for unknown period | Does not train |
| Together | Zero retention | Does not train |
| Venice | Zero retention | Does not train |
| Wafer | Zero retention | Does not train |
| Xiaomi | Retained for 30 days | Does not train |

"AtlasCloud" also appears in this table (listed once, "Prompts retained for unknown period / Does not train"). **"Ambient" does not appear in OpenRouter's provider-policy table at all** — OpenRouter has published no retention/training statement for it.

## 4. Written agreements

All read 2026-09-24, all currently live/in-effect (not accepted or modified in this session):

- **Terms of Service** — https://openrouter.ai/terms — "Last Updated: August 31, 2026"
- **Privacy Policy** — https://openrouter.ai/privacy — "Last Updated: August 31, 2026"
- **Data Processing Agreement (DPA)** — https://openrouter.ai/data-processing-agreement — "Last Updated: August 26, 2026"
- **Trust Center / Subprocessor list** — https://trust.openrouter.ai/ (SafeBase-hosted; publicly viewable without "Get access" — that gated flow, which was NOT clicked, is only for extra artifacts like the pentest report/SOC 2 report)

**(a) Does a DPA exist, and is it self-serve, part of the ToS, or enterprise/on request?**
Self-serve and automatically incorporated — not a separate enterprise negotiation. ToS §10.2: *"If you are part of and represent an organization in entering into these Terms or use the Service for commercial, for-profit purposes, please read the OpenRouter Data Processing Agreement ('DPA') ... The DPA is incorporated by reference into, and made a part of, these Terms."* The DPA document itself opens: *"This Data Processing Agreement ... forms a part of the Terms of Service or other electronic agreement between OpenRouter, Inc. ... and the individual or entity that accepts or otherwise agrees to the Agreement ('Customer') ... Customer enters into this DPA on behalf of itself..."* — no separate signature, order form, or sales contact is required for the DPA to apply to a commercial/organizational user; "Enterprise" is a distinct, paid upsell tier (regional routing, SSO, etc.), not a precondition for the DPA.

**(b) Do the terms/docs bind the model providers (subprocessors) to OpenRouter's limits (no training, no retention, provider data policies, `data_collection: deny` routing)?**
**Not in the way "subprocessor" usually implies.** Two separate things are labeled differently in OpenRouter's own documents:
- The DPA's formal "Subprocessors" (Schedule 3, list at trust.openrouter.ai, "Legal – Subprocessors") is a list of **18 of OpenRouter's own infrastructure/SaaS vendors** — Clerk, ClickHouse, Cloudflare, Coinbase, Customer.io, Datadog, Fivetran, GitHub, Google Cloud, Microsoft Azure, OpenAI, PostHog, Pylon, Resend, Stripe, Upstash, Vercel, Zendesk — **all listed as "United States."** Only 3 of these ("Google Cloud," "Microsoft Azure," "OpenAI") are tagged "Inference" purpose. **None of the dozens of AI Model Providers Whim's requests actually route to (Wafer, CoreWeave, Alibaba, DeepInfra, Together, Baidu, DekaLLM, etc.) appear on this formal Subprocessors list.**
- Those AI Model Providers are instead handled under a separate, weaker mechanism. DPA §2.4(b): *"When ZDR-only routing is enabled by Customer, OpenRouter will not route Customer API requests to AI Model Providers that are not designated as ZDR-eligible in OpenRouter's provider registry. Inclusion on such list reflects the AI Model Provider's published or represented policy of 'no retention and no training' on zero-data-retention API payloads; it does not constitute OpenRouter's guarantee of AI Model Provider compliance."* — i.e., OpenRouter does not contractually bind these providers itself; it relies on, and explicitly disclaims any guarantee of, each provider's own self-published policy. Privacy Policy, "Model Provider Data Practices": *"Different Model Providers have different data practices... Before using a Model, you should review the applicable Model Provider's data practices, which are linked here... If you have a Data Processing Agreement with us, the terms of that agreement and our separate agreements with Model Providers govern how your data is handled by each Model Provider..."* — this signals OpenRouter does have "separate agreements with Model Providers," but their terms are not published to the customer, and the DPA text above shows OpenRouter is not warranting the providers' compliance.
- The `data_collection: deny` (Zero Data Retention) routing filter is real and enforceable at the routing layer (it removes non-ZDR-eligible providers from the candidate pool) but, per the same clause, is built on providers' self-reported policy rather than a subprocessor contract chain running through OpenRouter.
- Also directly relevant: OpenRouter's own Privacy Policy states *"OpenRouter does not use your Inputs or Outputs for model training"* (OpenRouter itself, distinct from Model Providers) and *"Any prompt retention on OpenRouter is always opt-in... OpenRouter has never shared, sold, or licensed underlying prompt data to any third party"* (docs, Data Collection page).

**(c) Does using the service mean the standard terms (incl. DPA) already apply, with nothing new to accept?**
Yes, for a commercial/organizational customer as described above — the DPA is "incorporated by reference" automatically once the ToS apply; there is no separate acceptance click required for the DPA to be part of the agreement. (This session did not click "I Accept" or any agreement button; the observation is based purely on reading the ToS/DPA text, which states this incorporation-by-reference as a fact of the current, live agreement — not something this session triggered.)



