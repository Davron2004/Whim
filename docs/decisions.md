# Whim — Decisions Log

*A running record of the meaningful decisions behind Whim: what was decided, why, and what was rejected. Ordered roughly as the thinking happened, so it reads as a narrative. Each entry is small on purpose. New decisions get appended; reversed ones get marked, not deleted (the reversal is part of the story).*

**Legend:** `[DECIDED]` settled for now · `[PLANNED]` agreed but later · `[OPEN]` not yet decided · `[REVERSED]` changed our mind (kept for the record)

---

## A. Product & scope

### 1. Whim is a host app that runs sandboxed mini-apps — not a full-app generator `[DECIDED]`

**Decided:** Whim is one app containing a launcher and a runtime; the things users make ("mini-apps") run *inside* it.
**Why:** Matches the vision of making and running tiny apps on your phone with instant iteration. Keeps everything in one place the user already has open.
**Instead of:** Generating a full standalone React Native app per idea and shipping it through the app stores (the a0.dev / Rork model). Rejected because build-and-submit cycles take minutes-to-hours, every change is a re-submission, and users would install N separate apps — a different product entirely.

### 2. The thesis is the long tail of personal software `[DECIDED]`

**Decided:** Target the "one and done app, just for me" — ideas too small or niche to ever deserve a store listing.
**Why:** This is the real, namable need (it surfaced from a pile of personal app ideas that individually weren't worth a project). Same long-tail thesis as Nothing's Essential Apps.
**Instead of:** Chasing a mass-market need. There isn't one; the value is in the aggregate of tiny personal ones.

### 3. Primary purpose is a portfolio / resume project `[DECIDED]`

**Decided:** Build it to demonstrate agentic-harness design skill; infer the real audience later from watching it used.
**Why:** Honest about motivation, and it correctly orders priorities — the harness is the artifact worth showing.
**Consequence:** The harness, SDK, eval, and self-healing loop must be excellent. The UI must still be genuinely good (not just "not embarrassing"), but it's where *less* of the novel difficulty lives.

### 4. The name is "Whim" `[DECIDED — easily reversed]`

**Why:** Captures the spirit — apps made on a whim, the long tail of personal needs. Short, memorable.

### 5. Sharing is deferred to v2+ `[PLANNED]`

**Decided:** v1 is personal-use only; no sharing UI.
**Why:** Sharing changes the threat model fundamentally — the moment one user's app runs on another's phone, you inherit a malicious-app problem (egress, moderation, abuse reporting). Build the personal version first; design the manifest/capability model so sharing *can* be added without rewrites.

---

## B. Runtime architecture

### 6. No native code generation `[DECIDED]`

**Decided:** Mini-apps are interpreted JavaScript/TypeScript, never compiled native code.
**Why:** iOS forbids JIT and running arbitrary native code outside JavaScriptCore, and forbids shipping compiled binaries post-install.
**Instead of:** (a) compiling Swift/Kotlin on the device — impossible on iOS; (b) compiling on the server and shipping the binary down — disallowed by App Store rules. The interpreter route is the only viable one.

### 7. A private, constrained SDK — not arbitrary HTML/JS `[DECIDED]`

**Decided:** The agent only ever writes code against an in-house SDK (a defined component + capability surface).
**Why, four wins at once:** (1) the model generates far better code against a small fully-documented API; (2) sandboxing becomes tractable because the host controls the whole surface; (3) it's defensible under Apple's mini-app rules; (4) one framework renders identically on every platform.
**Instead of:** An open WebView running whatever HTML/JS the model emits. Rejected because it maximizes the model's degrees of freedom exactly where reliability and security matter most.

### 8. The server sits between the phone and the model `[DECIDED]`

**Decided:** Generation runs server-side; the phone is the front end.
**Why:** The harness *is* the product, and it has to run between model output and user delivery — that's where static checks, the repair loop, filtering, and prompt protection live. None of that is possible if the phone calls the model directly.
**Instead of:** Phone-direct-to-model to "save traffic." Rejected — the WebSocket fan-out concern is a non-issue at any realistic early scale (hundreds of concurrent streams are trivial), and going direct would architect the product into a place where it can't be iterated on. *(This one was debated and the middleman position won on the merits.)*

### 9. Stack: React Native + an in-house TypeScript SDK `[DECIDED]`

**Decided:** One RN host app; the SDK is TypeScript.
**Why:** One toolchain, one rendering pipeline, identical output across platforms, and the model writes TypeScript better than Swift/Kotlin (more training data, fewer language constraints).
**Instead of:** Separate native Swift and Kotlin SDKs — double the work and divergent rendering.

### 10. Android first `[DECIDED]`

**Decided:** Build and prove everything on one platform — Android — before touching iOS.
**Why:** No Mac/Xcode/provisioning friction, Android tolerates this app category, the sandbox story is simpler, and iterating doesn't require App Review. iOS becomes v1.5/v2 once there's a stress-tested Apple-4.7 story.
**Instead of:** Both platforms from commit zero — the last 10% of platform-specific quirks would eat all the time.

### 11. WebView rendering — with a backend-agnostic contract `[DECIDED — deliberately revertible]`

**Decided:** Mini-apps render as HTML/CSS inside a WebView; SDK components emit DOM.
**Why:** Far less work; sandboxing is free and battle-tested (the browser already isolates the JS context); it's automatically Apple-4.7-aligned (it literally is WebKit). For Tier-0 utility apps the feel is ~90% native.
**Instead of:** A native reconciler (isolated JS engine → serialized render tree → real native views). More work on every axis, *and* it would raise Apple-4.7 risk by definition (it's "exposing native APIs to the software"). Deferred, not dismissed.
**Key hedge:** the SDK contract stays backend-agnostic — the agent writes `<Button radius="md">`, never HTML — so a future swap to a native reconciler leaves every existing mini-app working unchanged.

---

## C. The SDK & security model

### 12. Capability-based security in three layers `[DECIDED]`

**Decided:** Code can only do what it's handed a reference to. Layer 1 (pure computation) is free; Layer 2 (any effect on the outside world) is SDK-gated; Layer 3 (escape hatches like `eval`, raw `fetch`, DOM) is physically stripped from the runtime.
**Why:** It's the cleanest way to make generated code safe and reliable. The dividing line — *pure computation is free, side effects are gated* — also answers "do I need arithmetic in the SDK?" (no, and you couldn't).

### 13. UI accepts tokens, not values `[DECIDED]`

**Decided:** Components take semantic tokens (`radius="md"`, `color="primary"`), never raw hex or pixels or arbitrary styles.
**Why:** Keeps generated apps a coherent family, keeps dark mode sane, and slashes the agent's degrees of freedom. If a token doesn't exist, that's a feature request, not a workaround. (Same philosophy as SwiftUI / Material 3 / Radix Themes.)
**Escape hatch:** a `<Canvas>` primitive for genuinely free-form visuals (game boards), later.

### 14. The manifest is the capability contract `[DECIDED]`

**Decided:** Each mini-app declares its capabilities up front; capabilities can't be acquired at runtime.
**Why:** One artifact does quadruple duty — user-facing install disclosure, the Apple-4.7 manifest, a runtime enforcement boundary, and a generation-time signal the host can validate before running anything.

### 15. The capability bridge is a syscall boundary `[DECIDED — the core porting abstraction]`

**Decided:** Native-backed capabilities are added as rows in a host-side "syscall table": transport (postMessage, written once) → dispatcher → capability registry + permission gate → typed SDK stub. Adding a capability = one registry row + one client stub, never touching the transport.
**Why:** This is the systematic "porting gate" — it guarantees capability #15 costs the same as capability #2, instead of every new native feature being a fresh ordeal. Mental model: the WebView is a sandboxed process and the bridge is its syscall interface; theory framing: the host is an effect interpreter and mini-apps emit effects as data.
**Key reframe:** rendering does *not* cross the bridge (UI is DOM inside the WebView), so only a short, append-only list of things — storage, haptics, audio, notifications, sensors, network — are ever syscalls.

### 16. Capability tiers 0–5 define the roadmap `[DECIDED]`

**Decided:** Tier 0 = UI + local storage (this is v1); then AI, then notifications/timers, then HTTP, then sensors/camera, then games. Apps are never added one at a time — each tier unlocks a whole class.
**Why:** Ties the SDK's growth to concrete capability unlocks and keeps v1 in the safest, most reliable zone (which covers ~60% of what people actually want).

### 17. Curated integrations before raw HTTP `[DECIDED]`

**Decided:** When network arrives (Tier 3), start with specific APIs wrapped as typed SDK capabilities (`weather.current()`), not arbitrary URL access.
**Why:** The killer problem with raw HTTP isn't only security — it's that the agent doesn't know an arbitrary API's contract and will guess wrong, producing exactly the on-phone debugging nobody wants. (Nothing did the same: weather as a system capability.) Raw HTTP comes much later, behind warnings, and is gated hard if sharing ever lands.

---

## D. The generation harness

### 18. The loop: plan → generate → static-check → run → observe → repair `[DECIDED]`

**Decided:** Generation is a staged loop with a structured plan first, automated static checks, a synthetic smoke-test run, and capped (~3) repair attempts before surfacing to the user.
**Why:** What makes a harness good is the *quality of diagnostics fed back*, not the model. Closed-world API + single bundle + full control of the runtime make this dramatically simpler than general-purpose harnesses.

### 19. Zero-warning steady state; severity shown but nothing excused `[DECIDED]`

**Decided:** Working generated code emits no warnings. Warning *definitions* are global to the harness (no per-app/per-user suppression). Severity is shown to the agent to *order* its work, but every error and warning must be resolved before a bundle ships.
**Why:** The agent lacks the private context a human uses to triage warnings, so every warning costs tokens — which forces warning definitions to be ruthlessly pruned to genuine pre-errors, each carrying a fix hint.

### 20. Agent memory is bounded and legible `[DECIDED]`

**Decided:** State that helps the agent is either (a) part of the SDK (you control) or (b) scoped to one mini-app (the user controls) — nothing in between. Per-app `LEARNED.md`, a short user-editable profile, and an examples library of apps the user loved. All of it user-visible and editable.
**Why:** Learned state that drifts invisibly breaks the user's ability to predict what a prompt will produce and erodes trust. No embedding-based behavioral inference, no silent personality drift, no background fine-tuning.
**Instead of:** Letting the agent invent and persist its own global rules/toolset — an un-auditable style guide that drifts across users.

### 21. Two-stage prompt: voice → rewrite → preview → engineer `[DECIDED — build early-ish]`

**Decided:** Dictated input is rewritten by a small model into a detailed, specific prompt the user reviews on a preview screen before the engineer model sees it.
**Why:** Turns "make this button bigger" into a precise instruction, and turns "make it shareable" into a spec the user can sanity-check — writing tedious prompts *for* the user from their casual words. Pairs with versioning (each snapshot is tagged with the prompt that made it).

### 22. Control modes: full-vibe vs controlled `[PLANNED — not v1, but fairly early]`

**Decided:** Offer a spectrum — full-vibe (proceeds with minimal clarification) and controlled (surfaces an elaborated prompt/plan for review).
**Why:** Lets control-seekers steer and lets everyone else just talk. Generalizes the two-stage prompt into a selectable mode.
**Open within it:** whether the controlled-mode preview shows user-facing *intent* or the actual detailed prompt (the user probably should never see SDK internals).

---

## E. App lifecycle

### 23. Versioning & rollback are first-class `[DECIDED]`

**Decided:** Every generation is a snapshot; undo goes back a step; users can pin a known-good version.
**Why:** In vibe coding, rollback happens roughly an order of magnitude more than in normal coding — try it, trash it, roll back. It has to be a prominent, trustworthy action.

### 24. Offline: apps run, generation doesn't `[DECIDED]`

**Decided:** Already-made mini-apps work offline (they're just a bundle + local storage); new generation needs network.
**Why:** Trivially true in v1 (no network capability anyway).

### 25. One model for v1, no bring-your-own-keys; DeepSeek is the bet `[DECIDED for v1 / model choice OPEN]`

**Decided:** Tune the harness for a single model; no user-supplied keys; self-billed via an env key during development. DeepSeek is the leading candidate for price/quality.
**Why:** The system prompt, SDK reference, examples, and repair loop all get tuned to one model's quirks; multi-model support would degrade those tunings or multiply the work.
**Caveat / open:** verify DeepSeek's structured-output and streaming reliability against the eval corpus before committing — the whole loop depends on reliably well-formed, SDK-only code.

---

## F. Process & methodology

### 26. Build the runtime track before the harness track `[DECIDED]`

**Decided:** The LLM is *not* in the first commits. Hand-write mini-app bundles as stand-ins and use them to build and prove the runtime + SDK; point the harness at the SDK only once the runtime reliably runs hand-written bundles.
**Why:** You can't generate against an SDK that doesn't exist and isn't proven. Debug the rendering/bridge contract with code you control, not code a model is improvising.

### 27. Phasing: v0.1 (render) → v0.2 (bridge + storage) → v0.3 (effects) → harness `[DECIDED]`

**Decided:** v0.1 proves a hand-written bundle can render in the WebView (tip splitter, zero syscalls). v0.2 builds the bridge with storage as syscall #1. v0.3 adds effects + haptics/audio. Then wire the server + harness against the now-stable SDK.
**Why:** Each milestone proves exactly one foundational thing, cutting v0.1 at the smallest provable slice (no bridge, no LLM, no server).

### 28. Testing: two surfaces, TDD the invariants, test-after the UI `[DECIDED]`

**Decided:** Separate Surface 1 (Whim's deterministic code) from Surface 2 (the non-deterministic eval corpus). TDD the bridge and sandbox as never-regress invariants — the network-isolation assertion is the most important in the codebase. Test-after the UI. Eval corpus is three tiers (deterministic gate → behavioral → LLM-as-judge against an English rubric), with a held-out prompt set to catch reward-hacking.
**Why:** The two surfaces need fundamentally different methods; conflating them is the biggest testing risk. Anything the implementing agent can see, it can game.

### 29. Workflow: OpenSpec + an English test-spec phase `[DECIDED]`

**Decided:** Keep OpenSpec (spec-driven), add a phase: spec the feature in English → spec the tests in English (while it's fresh) → implement → write tests from the test-spec. Plus a failing-requirements checklist and this decisions log (ADRs).
**Why:** Forgetting to test interconnected features happens because tests get written last, after the what-could-break context is lost. Bracketing implementation between two English artifacts captures it at peak clarity. *(Noted: this "specify intent in prose before committing to the artifact" pattern is the same move as the two-stage prompt — a recurring Whim-wide principle.)*

### 30. Documentation: capture continuously, publish at milestones `[DECIDED]`

**Decided:** A cheap per-session `DEVLOG.md` (the capture layer) feeds curated milestone posts + an excellent README + a few deep-dive writeups + a demo (the publish layer).
**Why:** The good material (decisions, dead ends, "I was wrong about X") evaporates within days; splitting capture from publishing means publishing is just editing, not writing from scratch. Same principle as the product's own memory model: versioned artifacts, not chat history.

---

## G. Backend & data residency

### 31. Backend in TypeScript `[DECIDED — runtime open]`

**Decided:** The backend is TypeScript. (Runtime — Node vs Bun vs Deno — is open; Bun is the leading "try something current" option, pending a check on its production maturity for long-lived streaming workloads.)
**Why:** Not familiarity — *toolchain gravity*. The hardest, most correctness-critical part of the backend is the static-check/transpile layer (TS compiler API, ts-morph, ESLint, esbuild), all native to the JS/Node world. And the SDK is already TypeScript, so the backend shares one type system with it — the manifest types, capability definitions, allowed-symbol list, and validation logic become literally shared code (SDK ↔ backend ↔ linter ↔ client), one source of truth, no serialization boundary on the hard part.
**Instead of:** Go (best at the concurrency that *isn't* the bottleneck; would force a Node sidecar for the TS tooling anyway), Rust (SWC is Rust-native for AST checks, but full type-checking still wants tsc → Node sidecar; slowest solo-dev velocity for a bottleneck that's upstream), Python (rich LLM ecosystem, but TS LLM SDKs are equally first-class and it loses the SDK type-sharing). The decisive point: the bottleneck is the LLM (latency, cost, rate limits), not the backend language, so coordination work goes to whichever language keeps the *checks* native — and that's TS.
**Note:** CPU-bound checks can block the event loop → run them in worker threads / subprocesses (esbuild & tsc already are). If that layer ever contends, isolate it as a Node worker pool — still TypeScript, just another process. Never needs a second language.

### 32. Transport: SSE streaming + thin REST/tRPC; no GraphQL `[DECIDED]`

**Decided:** The generation/iteration channel is a streaming HTTP response (SSE). The CRUD surface (auth, list apps, fetch/fork versions) is plain REST, or tRPC if staying all-TS (end-to-end types to the RN client). GraphQL is rejected.
**Why:** Generation is request → stream-back → done, not an always-on bidirectional conversation, so a single streaming response fits and stays stateless-friendly (a persistent WebSocket is only warranted if the user must interrupt mid-generation — not a v1 need). GraphQL earns its complexity with many varied clients over a rich relational graph; Whim has one first-party client, a ~3-table model, and its hard problem is *streaming*, which GraphQL only handles by bolting on subscriptions. Pure ceremony here.
**Fact check:** OpenRouter itself is HTTP + SSE (not WebSockets), a drop-in for the OpenAI API — so the server↔model leg is also SSE, open only during an active generation.

### 33. Data residency: stateless server, device is system of record (Model 1) `[DECIDED for v1]`

**Decided:** The server persists only ~KB per user (anonymous device ID + token-usage counter). All app content — source, JS bundle, manifest, data, version history — lives on the device. Each edit re-sends the current source as context.
**Why:** Matches the "your apps never leave your phone except while being built" privacy story, and spares all account/sync/storage infrastructure. Re-send cost is negligible at Tier-0 app sizes (KB to low tens of KB); the *real* cost lever is LLM input tokens for the source-as-context, addressed by **prompt caching + diff-based edits**, not by a phone-facing file cache.
**Instead of / upgrade paths:** **Model 2** (server persists bundles in blob storage + relational metadata) — only if cross-device sync / cloud backup later becomes a *feature* worth the multi-database load and the "hosting user apps" cost. **Model 3** (stateless server + ephemeral, session-scoped source cache in memory/Redis, evicted after the session) — the precise form of the "cache, not database" idea; the right fix for re-send/token cost *when it actually bites*. Adopt 3 before 2.
**Consequence:** flips **Spike 4** to **on-device git** (isomorphic-git over a JS FS shim) rather than server-side. Fork-without-merge still makes it tractable.
**Guards (2026-06-09 architecture review, Model 1 re-affirmed):** (a) any future Model-3 cache must be keyed by **content hash only** — never by app-ID-with-"latest" semantics — so it stays provably a cache (evictable with zero data loss) and can't rot into a second source of record. (b) **Phone↔server transport diffs are rejected**: they save the cheapest resource (wire bytes, KB-scale) while importing base-version/replica-reconciliation fragility into a single-writer system, and save zero model tokens — the harness must reconstruct full files for context/typecheck anyway. The "send diffs" instinct belongs in the harness (prompt caching + edit-format model output, the cost lever above), not on the wire; if transfer size ever bites (multi-file apps), the mechanism is content-addressed have/want over the git object model the snapshot store already provides, not line diffs. (c) The future backup/restore story is **one encrypted packfile blob** (`packObjects`, proven in Spike 4) pushed to user-owned storage — Model 2-lite, never a sync protocol.

### 34. The harness lives on the server; phone owns stable, server owns volatile `[DECIDED — core principle]`

**Decided:** The full harness (agent loop, prompts, checks, repair, model access, policy enforcement, telemetry) runs server-side. The phone sends "here's my app + what I want changed" and receives a finished bundle. This is the deepened rationale behind #8.
**Why, three principled reasons (strongest first):**

1. **Volatility vs. durability.** The harness changes constantly (the core dev loop for the project's whole life); the apps it makes must persist. Server-side, a running mini-app depends on *nothing* volatile — rewrite the harness ten times, every existing app still runs. Phone-side welds generator to generated: every harness change ships as an app update, users spread across many harness versions, and "edit my 3-month-old app" raises "*which* harness edits it?" — a compounding version-compatibility matrix on devices you don't control. Server-side collapses that matrix to one always-current row.
2. **Enforcement only works where the user can't reach it.** The harness sits in front of a shared, metered, abusable resource (OpenRouter spend, rate limits). Quotas/spend caps/model routing/filtering are only *enforced* if the gate is server-side. On the spender's device they're advisory; your cost-control surface and only metering point would be handed to the people it's meant to gate.
3. **Telemetry is how the harness improves.** The eval/diagnostics loop feeds on watching real failures — which prompts break, where repair stalls, which SDK gaps recur. Server-side that's one firehose feeding the improvement process directly; phone-side it's sampled, laggy, after-the-fact. For a project whose point is a well-engineered harness, that's self-defeating.
**The dividing line (reusable for any "phone or server?" question):** *the phone owns what belongs to the user and must stay stable (their apps, data, version history, the runtime that executes a finished bundle); the server owns what belongs to you and changes constantly (harness, model access, checks, policy, telemetry).* This is the same principle as #33 — user-owned stable things on the device, your-owned volatile things on the server — so they don't conflict, they rhyme.

---

## H. Spike findings

### 35. Spike 1 — H1+R1 containment confirmed on the real Android WebView; CSP is load-bearing `[DECIDED — confirms #11, refines "free"]`

**Decided:** The leading hypothesis is proven. An untrusted bundle runs *contained* inside `react-native-webview` and still renders UI. **H1** (sandboxed `<iframe sandbox="allow-scripts">`, **no** `allow-same-origin`) + **R1** (React-to-DOM inside it) wins; H2 (SES) and H3 (QuickJS/WASM) are not needed.
**Verified on the target, not desktop Chrome (D3):** Android API 36 emulator, react-native-webview 13.16, RN 0.85 / React 19 host. Probe checklist: **26/26 pass, `contained:true`**, negative control fires.
**The exact neutralization technique that worked on the RN engine:**

- *Value globals* (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `RTCPeerConnection`, `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `Worker`, `SharedWorker`, `navigator.sendBeacon`): `delete`-then-`Object.defineProperty` to a throwing stub. On this engine all were configurable, so redefinition stuck; lexical shadowing in the bundle's execution scope is kept as the belt-and-suspenders for any non-configurable global (none were needed here).
- *`eval` / `Function` / the `({}).constructor.constructor('…')` prototype-walk*: **NOT** value-replaced — a CSP `script-src 'unsafe-inline'` **without `'unsafe-eval'`** kills them at the engine level (`EvalError: Refused to evaluate a string…`). This is the load-bearing finding: CSP is the *only* thing that closes the constructor-walk codegen hole, which value-stripping can never reach. Plus `default-src 'none'` / `connect-src 'none'` as network defense-in-depth.
**Escape vectors probed (all blocked):** `window.frameElement` → `null`; `window.parent`/`window.top` `.document`, `.location`, and `.ReactNativeWebView` (the real native bridge) → `SecurityError`; prototype-walk codegen → `EvalError`; dynamic `import()` → rejects; non-SDK `require(...)` → throws; no ambient `module`/`exports`/`process`. The bundle's only crossing is `parent.postMessage` (one-way string), which the host relays to the real bridge — the iframe never holds a native handle.
**Perf:** mount-to-first-paint ≈ **104 ms cold, ≈ 12 ms warm** (≤ the ~150 ms instant-feel ceiling).
**Refines #11's "sandboxing is free and battle-tested":** mostly upheld — the browser primitives do the heavy lifting — but it is *not literally free*. Containment needs three things together: (a) a cross-origin iframe (omit `allow-same-origin`), (b) a CSP without `unsafe-eval`, and (c) a strip that is surgical (do **not** replace `Function`/`eval` by value — it breaks React's `instanceof Function`). "Strip the globals and inject the SDK" (the #12 framing) is *necessary but not sufficient* on its own; without CSP, `constructor.constructor` leaves dynamic code-exec wide open. Not a reversal of #11 — a sharpening of what "free" costs.
**Artifact:** the probe checklist is preserved at `invariants/sandbox-isolation/` as the seed of the §16.2 invariant / Spike 6 CI suite. Spike code deleted.

### 36. Spike 4 — H2 on-device `isomorphic-git` runs under Hermes; full versioning lifecycle confirmed `[DECIDED — confirms #33/#34 + §11, demotes server-side git to fallback]`

**Decided:** The lead hypothesis is proven. `isomorphic-git` (v1.38.4) loads and runs **under Hermes (new arch / bridgeless)** over a JS filesystem shim and provides the entire snapshot/fork/rollback/diff/history lifecycle on-device, driven 100% programmatically, with **0 failures**. **H2** wins; **H1** (server-side git) stays a fallback only — it returns to the table solely if on-device proves unworkable or later under Model 2 (#33). **H3** (roll-your-own) is off the table.
**Verified on the target, not Node (D6):** Pixel_9_Pro_XL Android emulator (arm64), RN **0.85.3** / Hermes / new arch, offline release bundle. Node was the cheap checkpoint; this run is the acceptance. Every check green (init, ×2 snapshot, history, rollback, pin, diff, fork, no-merge, 50 commit/checkout reliability cycles, manual compaction). Evidence: `docs/spike4-android-result.png`.
**The Hermes polyfill recipe (the load-bearing finding, D2).** What Hermes provides natively, probed on-device *before* any polyfill:

| Capability | Native in Hermes (RN 0.85)? | Action |
| --- | --- | --- |
| `Buffer` | **No** | **Required** — `global.Buffer = require('buffer').Buffer`. isomorphic-git uses `Buffer.from/concat/alloc/isBuffer` ~70×. |
| `TextEncoder` | **Yes** | none |
| `TextDecoder` | **No** (the surprise — encoder ships, decoder doesn't) | **Required** — without it the app crashes at load: `ReferenceError: Property 'TextDecoder' doesn't exist`. Used `text-encoding-polyfill` (installs both). |
| `crypto.subtle` | **No** | none — isomorphic-git auto-falls back to pure-JS `sha.js` (works, just slower hashing). |
| `process.env` / `.platform` | partial | tiny shim fills the gaps. |
| `fs` | n/a — **injected**, never `require`d | the FS backend is the injected param; no `fs` polyfill. |

Minimal set: **`buffer` + `text-encoding-polyfill` + a 3-line `process` shim**, imported *before* isomorphic-git. `pako` (zlib), `sha.js`, `crc-32` are pure-JS and run as-is.
**Operation→UI-verb mapping (D3) holds — git vocabulary never reached the surface.** snapshot=`commit` · history=`log` · undo/rollback/open=`checkout` · pin=`tag` · fork=`branch` · diff=`walk`+compare (isomorphic-git has no `git.diff`). Every op sits behind a product-verb wrapper; no hash/git term is needed to express any of them. **Gotcha:** "fork" is **two calls** — `branch({object})` **then** `checkout({ref})`; `branch({checkout:true})` moves HEAD but does **not** materialize the working tree.
**No merge, ever (D4) — confirmed.** Expressing fork → diverge → rollback → pin → diff never wanted `git.merge` (it exists in the lib; it was never called). Forks are independent lineages; the original and the fork stay provably unchanged by each other.
**Storage growth (the top risk, D2/Risks) — measured on-device, ~3 KB Tier-0 bundle writing 3 files/gen:** 10 gens → 9.9 KB / 48 objects · 50 → 35 KB / 213 · 100 → 67 KB / 412 · **200 → 130 KB / 812 objects**. So **~650 B and ~4 git objects per generation**. Byte volume is a non-issue (~650 KB at 1000 gens); the real pressure is **loose-object count** (~4000 files at 1000 gens — each is a key in an MMKV/AsyncStorage-backed FS). **`isomorphic-git` has no `git.gc`/`prune`/`repack`** — every object stays loose forever — so **on-device compaction is DIY**, but viable: `git.packObjects` packed all 200 commits into a **28 KB packfile** on-device. v0.2 must hand-build a periodic "pack-then-drop-loose" compaction.
**Latency (just a number, not the fear) — on-device Hermes, deep history (~290 commits):** snapshot **2.5 ms** · pin **0.2 ms** · diff **0.8 ms** · history(log) **46 ms** · rollback(checkout) **166 ms**. All fine for an interactive feel; the two depth-scaling ops are `log` and `checkout` → **cap/paginate history** and expect rollback in the tens-to-~150 ms range on deep lineages (still well under a second). Hashing is pure-JS (no `crypto.subtle`), so these are conservative.
**Repo contents (D5) + where the prompt lives:** one repo per mini-app holding **code artifacts only** — `bundle.js`, `manifest.json`, `LEARNED.md`, `prompt.md` — and **no runtime user data** (rolling back code must never revert the user's data; the old-code-meets-current-data schema-drift problem is named and deferred to `on-device-snapshot-store`). The producing prompt is carried **both** ways and both work: as the **commit message** (reads well in history) **and** as a tracked **`prompt.md`** (diffs, survives reformatting). Recommend keeping both.
**FS backend (D2):** validated the **in-memory JS fs** option (a ~120-line Hermes-safe shim, zero native modules) — it isolates the Hermes question from native-module/new-arch risk and yields the real git-object byte numbers (RAM vs flash is only the backing store). Persisting that volume to **MMKV/AsyncStorage** (serialize-to-KV) is the recommended v0.2 backing; `react-native-fs`/`expo-file-system` (real device files) are alternatives but add native surface. *Not done in this spike:* a head-to-head backend benchmark and cross-app-restart persistence — those are `on-device-snapshot-store` work.
**Artifact:** decision recorded here + `DEVLOG.md` capture; evidence screenshot at `docs/spike4-android-result.png`. No capabilities retained (doc-only spike) — the versioning/forking capability specs live downstream in `on-device-snapshot-store`, which consumes this recipe. Spike code deleted.

### 37. Spike 2 — bundle/module contract: H1 (TS → esbuild IIFE) + DOM-inserted inline `<script>` delivery (channel b) + H1b injected SDK `[DECIDED — confirmed on-device + pen-tested]`

> **✅ ACCEPTANCE (read first; updated 2026-06-07).** Originally filed PROPOSED because the implementation environment blocked all command execution for the authoring agent. It has since been **fully executed in the foreground**: Node chain green → desktop-Chromium shakeout green → **on-device pass on the real Android System WebView** → **pen test (T1–T4) green on-device**. The headline unknown is **ANSWERED: yes** — the Android System WebView *does* run a DOM-inserted inline `<script>` under the unmodified #35 CSP (`'unsafe-inline'`, no `'unsafe-eval'`), the app renders, and containment holds. On-device results: baseline 23/23; **channel (b) lead 34/34 CONTAINED** (paints 22–96 ms), channel (a) fallback 34/34, both h1a/h1b; **`blob:` (c) REFUSED** under the unmodified CSP (reject-signal holds on the real engine). **Pen test:** a malicious "evil app" delivered end-to-end through channel (b) had **every escape blocked on-device** — T1 (self-injected fresh `<script>` reclaiming stripped globals → fetch/xhr/ls TypeError, eval EvalError; the **window-level value-strip holds in a fresh top-level scope**), T2 (host/native reach → SecurityError; only the loader's `parent.postMessage` stub is reachable, no native bridge), T3 (SDK-prototype → Function-constructor → EvalError), T4 (all codegen → EvalError). Measured (was *predicted*): H1a 8.1 KiB / H1b 4.5 KiB bundles; warm transpile+bundle ~2.7 ms (≪300 ms ceiling); D4 source map maps a thrown error to the exact original TS line. **Code DELETED** (2026-06-07, the spike is throwaway) — but the **runnable adversarial suite (T1–T7 + F4) was preserved** at `invariants/sandbox-isolation/spike2-bundle-contract/` (self-contained pages + a headless Playwright runner; `npm test` → all invariants held) as the Spike-6 CI seed. The production bundle-execution mechanism is built downstream in `webview-sandbox-runtime` from this recipe + the 5 constraints in `docs/spike2-findings.md`.
>
> **New load-bearing constraints for `webview-sandbox-runtime` (carry these forward):**
>
> 1. **The global strip MUST be a window-level non-configurable value-strip, never a lexical/closure shadow** — because channel (b) runs the bundle (and any script it self-injects, T1) in *global* scope; only a window-level strip survives a fresh top-level script.
> 2. **The trusted loader/SDK must never hold (on `window`, or in a closure reachable from a window-exposed function) any capability stronger than `parent.postMessage`** — the bundle shares the iframe global scope with them.
> 3. **F4 — the harness MUST compute containment from a trusted vantage, NEVER trust the bundle's self-reported verdict.** Demonstrated: the evil app, sharing the iframe scope, overwrote `__whimRunProbes` and posted a forged `contained:true 999/999` that the host displayed as a pass. The sandbox *contained* it, but the *report* was a lie. The production smoke test (Spike 3) and CI invariants (Spike 6) must run probes from code the generated bundle cannot overwrite, and/or verify escapes out-of-band.
> 4. **(T6) The host must authenticate/ignore bundle-origin control messages** — don't trust a message by its `kind` tag (the bundle can forge any `{__whimHarness:true, kind:…}` frame; confirmed on-device). Generalizes F4 to all control frames.
> 5. **(T7) Re-injection must reset the realm (re-create the iframe) OR re-strip/re-freeze globals + `Object.prototype` between generations** — confirmed on-device: re-injecting a 2nd generation into the same iframe lets generation-1 pollution (backdoor fn, `Object.prototype.__whimPwned`, mutated global) **persist into generation 2**. Containment still held (persistence ≠ escape), but this is load-bearing for Spike-8 hot-reload (channel b's re-injection win is only safe with a per-generation reset).
>
> **T5–T8 follow-up pen test (complete, on-device 2026-06-07):** T5 module confinement (relative/dynamic/subpath/off-allowlist requires all throw; a non-vc-sdk import resolve-fails the build) → blocked; **T6** (transport eavesdrop/spoof) → constraint #4 above; **T7** (re-injection persistence) → constraint #5 above, the prize finding; **T8** (build-step) → analysis: the spike's token-scan static check MISSES `Object.prototype`/`globalThis`-alias pollution (the §8.1 AST/dataflow checker must close it). All legit channels CONTAINED **43/43** on-device (T5/T6 probes added). Full constraint list: `docs/spike2-findings.md`.
>
> **Authoring bugs found + fixed while making the agent's wired-but-never-run code actually run** (kept for the DEVLOG lesson): a leaked `</content>` wrapper tag in all 25 files; esbuild `write:false` with no `outdir` (lost the source map); a source-map checker that false-negatived on a `new Function` V8 header offset; `tsconfig jsx:"react-jsx"` overriding the intended classic transform (emitted unresolved `react/jsx-runtime` requires); a *placeholder/prose collision* class in `fill()` (replaced `__TOKEN__` inside HTML doc-comments, error strings, and a JS comment); and four probe-logic bugs (inverted vc-sdk assertion, over-strict `require('react')`-must-throw, a false-positive on the benign `module/exports` CJS shim, SDK-mode-awareness).

**Emit format (D1):** one TS/TSX file, imports **only** from `vc-sdk`, a single default export `defineApp(...)`. One-line shape:

```ts
import { defineApp, useState, Screen, Stack, Button, NumberInput } from 'vc-sdk';
export default defineApp({ name: 'Tip Splitter', initial: 'Home', screens: { Home }, capabilities: [] });
```

`defineApp` returns a plain **AppSpec descriptor** (not a running app) — the trusted runtime decides when/where to mount, so the agent's code describes and the host renders. Fixture: `fixtures/tip-splitter.app.tsx` (the §15.3 tip splitter, hand-written, Tier-0 pure compute). **H3 (ESM + import map) is dead** under the CSP and dropped without measuring (`web/H3-import-map-is-dead.md`): dynamic `import()` rejects (the #35 probe), and `default-src/connect-src 'none'` + opaque origin leave an import map nothing it's allowed to resolve a bare specifier *to*. Therefore the emit is bundled to an **IIFE** (`format:'iife'`), not ESM — plain inline-executable text, no module loader.

**Delivery under the locked CSP (D2 — the load-bearing finding):** three channels were built against the **unmodified** #35 CSP:

- **(a) inline `<script>` baked into `srcdoc`** — `web/iframe-srcdoc-a.html`. Closest to the proven Spike-1 shape; parser-inserted inline script, squarely covered by `'unsafe-inline'`. Expected to run (predicted). Weakness: re-injection needs an iframe re-create.
- **(b) pre-injected loader + DOM-created inline `<script>`** (`script.textContent = src; head.appendChild(script)`) — `web/iframe-loader-b.html`. **The recommended lead.** The host posts the bundle source in over the #35 string transport; the trusted loader inserts it as an inserted inline script (NOT eval). Survives re-injection (post a new bundle, append a new `<script>`; no iframe re-create) → the Spike-8 hot-reload-friendly choice. **THE HEADLINE UNKNOWN, still open:** does the **RN WebView engine (Android System WebView)** gate *DOM-inserted* inline scripts the same as *parser-inserted* ones under `'unsafe-inline'`-without-`'unsafe-eval'`? Desktop Chromium runs them; some engines/CSP paths treat dynamically-inserted inline scripts differently. **This is the one thing that MUST be confirmed on-device** (task 3.2). If the engine blocks them, fall back to (a) and carry the re-injection cost to Spike 8.
- **(c) `blob:`/`data:` `<script src>`** — `web/iframe-blob-c.html`. **Reject signal.** Under the unmodified CSP this is **refused** (`script-src 'unsafe-inline'` does not cover blob/data *sources* — only inline scripts); making it run requires **widening** `script-src` to include `blob:`, which widens the load-bearing CSP beyond what #35 validated (an attacker who can mint a same-origin blob gains a script surface). The asset generator builds BOTH `channel-c.unmodified` (expected: refused, CSP holds) and `channel-c.widened` (runs, cost recorded) so the on-device run *shows* the refusal. Per D2, widening the load-bearing CSP is a reject — prefer (a)/(b).
- **Delivery never uses `eval`/`Function`/`import()`** — those stay forbidden (probes assert it). The whole point: source becomes executable script via **inline-script insertion**, which `'unsafe-inline'` permits and `'unsafe-eval'` is not needed for.

**Module resolution + SDK presence (D3):** react/react-dom are **always external** (host-injected as `window.React`/`window.ReactDOM`, built to an IIFE by `build.mjs`) — required for correctness (the trusted runner and the mini-app must share **one** React instance; mixed instances break hooks) and the realistic shape (react is the runtime, injected once, not re-shipped per generation). The H1a/H1b axis is therefore purely about `vc-sdk`:

- **H1a** — `vc-sdk` bundled in (self-contained IIFE, no runtime resolution).
- **H1b** — `vc-sdk` external → esbuild emits `require("vc-sdk")`, answered by a host-injected global (`vc-sdk-global.js` → `window.__WHIM_VC_SDK__`); a ~6-line resolver in each channel returns it. **Recommended.** Tiny per-generation bundles → fewer #36 loose objects in `on-device-snapshot-store` (the version-store-friendly choice). `vc-sdk` is the **only** module that resolves (carries #35's "one reachable module" forward); `require('react'|'fs'|'axios')` all throw (probes + `bad-app.example.tsx` negative fixture). **Sizes are (predicted), not measured** — `build.mjs` prints H1a, H1b, and the delta; confirm on run.

**Source maps (D4 — hard requirement):** `build.mjs` emits a source map with `sourcesContent`. `build/sourcemap-check.mjs` (a self-contained VLQ decoder, zero extra deps) triggers a deliberate throw in `fixtures/throw-fixture.app.tsx:11`, reads the generated stack position, and asserts it maps back to the **original** TS line. Static findings (`build/static-check.mjs`: parse + SDK-only-imports + forbidden-global scan) carry the original `line` directly (they ARE on the original). Together they cover both diagnostic sources §8.1 + the repair loop feed back. **Wired, NOT RUN** — confirm the map round-trips on execution.

**Where transpile happens + latency (D6/§7):** a **local** esbuild step (`build/build.mjs`) is the stand-in for the future server build (the real server doesn't exist — Non-Goal). Latency: **(predicted)** a small-app warm transpile+bundle is well under the ~300 ms ceiling (esbuild is a Go binary; model latency is seconds) — `build.mjs` measures 3 warm rebuilds and checks the ceiling. Confirm on run; if it ever bites, H2 (plain JS, no build) is the fallback.

**Re-containment under real delivery (D5):** `web/probes.js` (adapted from the preserved `invariants/sandbox-isolation/` suite — task 1.3) runs in the **same scope as the delivered bundle** in every channel: network/ambient globals throw, `({}).constructor.constructor('…')` `EvalError`s, `import()` rejects, `parent`/`top`/`frameElement` yield no host/native handle, only `parent.postMessage` crosses, `vc-sdk`-only module resolution. Two negative controls (a generic planted leak **and** a delivery-path leaked-host-handle, task 6.3) must both be flagged or `contained` is false. A baseline tab (`baseline.handinjected.html`, the preserved probe verbatim — task 1.4) confirms the substrate still passes pre-delivery. **The full probe JSON renders on-screen** (logcat truncates at ~4 KB — the #35/#36 gotcha). **Wired, NOT RUN** — green here is part of acceptance; a green render with a red probe is a reject.

**Format sanity (§7.2):** by hand, the format is ordinary idiomatic React/TS (a few `vc-sdk` imports, function components, one default export) — plausible for a model to emit consistently; full verification is Spike 7.

**Recommendation (CONFIRMED on-device):** **H1 + channel (b) + H1b** — agent emits TS, esbuild bundles to an IIFE, the loader inserts it as a DOM-created inline script, `vc-sdk` resolves to a host-injected global. Confirmed on the Android System WebView; pen-tested (T1–T4 blocked). Fallbacks remain pre-wired and characterized: channel (a) (parser-inline, also 34/34 on-device) if a future engine gates DOM-inserted inline scripts; H2 (plain JS, no build) if build latency ever bites (it doesn't — ~2.7 ms); never widen the CSP for (c) (blob refused on-device, as intended). **Downstream `webview-sandbox-runtime` can now build the real bundle-execution mechanism from this lesson — observing the three carry-forward constraints in the acceptance block above (window-level strip, loader ≤ postMessage, trusted-vantage containment verdict).**

**Artifact:** code retained at `spikes/bundle-contract/` (NOT deleted — task 8.4, pending pen-test + user approval); run recipe in `spikes/bundle-contract/rn-substrate/README-RUN.md`; `DEVLOG.md` Spike 2 capture. No capabilities retained (doc-only spike). The bundle-execution mechanism is chosen-and-recipe-in-hand, built downstream in `webview-sandbox-runtime`.

---

## Reversed / changed our minds (kept on the record)

- **Native code generation** was the initial instinct ("if it's iOS, can the agent emit Swift?") → reversed to interpreted JS/TS once the platform constraints were clear (#6).
- **"UI only needs to not embarrass the project"** → corrected to "the UI must be genuinely good; the harness is just where more of the difficulty lives" (#3).
- **Phone-direct-to-model** was floated to reduce server load → reversed in favor of the server-as-middleman after weighing what the harness needs to do (#8).
- **Phone-side harness + pre-authorized connection handoff** (phone opens a server-brokered direct line to OpenRouter and runs the agent loop locally) → rejected. Technically there's no connection-handoff primitive (OpenRouter is one-way SSE; the nearest mechanism is minting scoped keys), but the principled kill is #34: it would put volatile, multi-tenant, cost-gating, telemetry-bearing infrastructure on devices you can't change, meter, or observe. The connection-scaling problem it solves isn't real yet (connections exist only during active generation; the cost driver is tokens, not sockets).
- **The floating back button as the primary exit** (spec §10, `[DECIDED, prototype the button early]`) → reversed to **Android system back as primary** (#42): back pops the mini-app's nav stack, then exits to the launcher at the root — the overlap risk §10 itself flagged disappears by construction. The floating affordance survives demoted to a small draggable "home / start prompting" extra.
- **DeepSeek as the dev-target model** (#25 "DeepSeek is the bet") → reversed to **strong-model-first, downgrade by eval** (#42): tune the harness against a top coding model so harness bugs aren't confounded with model weakness; DeepSeek stays a bakeoff candidate for the same end state.
- **"Storage is schemaless JSON soup"** (spec §5.6) → reversed to **schema-declared storage with forgiving reads** (#40, realizing what #38 already implied). The property the "soup" protected — rollback/roll-forward never losing data, unknown fields surviving read-modify-write — was never about JSON-as-notation; it was about *blob granularity*. Under a relational layout (one SQLite column per burned field ID) that retention is **free and structural**: an UPDATE that sets only the columns a generation declares cannot strip the ones it doesn't. "No SQL exposed" is **unchanged** — mini-apps still see only product verbs + structured filters; SQL exists solely host-side, parameterized, host-authored.

---

## v0.1 build — `webview-sandbox-runtime` (#35 + #37 realized as retained code)

**On-device acceptance recorded (full capture in `DEVLOG.md`).** Both spike recipes are now
real runtime code (RN 0.85.3 / Hermes / new-arch / React 19; `src/runtime/web/*` + the
`vc-sdk` SDK + the esbuild build step + the RN `WebViewHost`). On the Android System WebView
(Chromium 133, API 36 arm64 emulator): the tip splitter renders, a tap round-trips to the RN
host, and the trusted-vantage probe verdict is **`contained:true` 42/42** with the full probe
JSON on-screen.

- **mount→first-paint (the §5.4 / spike number):** ≈ **119 ms cold** (first render, WebView
  sandbox cold-start) / ≈ **32 ms** on a re-created realm — under the ~150 ms ceiling, on
  headless software-GL (hardware should be faster; in line with #31's ≈104 ms and #37's ≈95 ms).

- **All five #37 carry-forward constraints are enforced as code:** window-level strip (T1),
  loader ≤ `parent.postMessage` (T3), trusted-vantage verdict via a closure-captured probe fn
  (F4/#3), bundle-origin frames authenticated by a per-realm secret nonce (T6/#4), realm-reset
  by iframe re-creation per generation (T7/#5). The desktop suite (`npm run invariants`, the
  §16.2 blocking-CI seed) reproduces the T7 finding and its reset fix, plus a broken-CSP
  negative control it correctly flags red.

- **Settled an open question:** the tip splitter uses `NumberInput` for all numeric inputs, so
  v0.1 ships neither `Slider` nor `SegmentedControl` ("implement only what it uses"); the
  control choice + the real visual language remain the deferred SDK design-system change (D6).

### 38. Schema drift: additive-only evolution with burned field identities; data transforms are engine-owned catalog ops `[DECIDED — design position for the v0.2 storage layer]`

**Context:** Rollback is a hot, casual product verb (§11) and #33's code/data split means rolling back code never touches data — so old code routinely meets newer data (the drift seam named in `on-device-snapshot-store` D6). Storage is schemaless JSON (§5.6), so both concrete failure cases are *silent*: (1) a field name retired by a rollback gets reused later with a different meaning — old rows serve stale values under the new meaning, nothing throws; (2) an in-place type/unit change (kg doubles → g ints) leaves mixed-unit rows, and a rollback makes it a three-way mix.
**Decided — the properties are structural, not promised by the agent:**

1. **Additive-only schema, burned identities.** Every persisted field gets a stable ID in the declared-`schema` artifact; the **physical storage key is the ID, never the display name**. IDs are never reused and never change type; rename = alias metadata on the same ID; delete = tombstone (ID retired forever, data retained). Enforced as **static checks** on the schema-artifact diff across generations — which the snapshot store already versions for free (D6). A post-rollback name reuse thereby gets a *new* ID and is structurally incapable of colliding with stale data.
2. **Rollback needs no migration in the common case.** Old code reads the IDs it knows; newer fields are invisible but preserved — so rollback-then-roll-forward loses nothing. (This is the test agent-written down-migrations fail: a `down` that drops a field destroys exactly the data the user expects back on redo.)
3. **Unknown-field retention is an engine obligation.** The storage syscall handler must round-trip fields the running generation doesn't declare (or store per-field rather than per-record blobs); otherwise rolled-back code strips newer fields on every read-modify-write and the loss arrives through the back door.
4. **In-place mutations are inexpressible.** A change that needs data transformation is a *new field plus a declarative transform from a closed catalog of invertible ops* (add-with-default, alias, scale-by-rational-constant, …), declared in the schema artifact and executed host-side by the engine with an op log. The agent never writes imperative migration code: **idempotency comes from the engine's op log; reversibility comes from the catalog containing only invertible ops** — system properties, not model promises.
**Rejected:** (a) **DB snapshots at schema-changing generations** — restoring one time-travels the *data* when the user asked to time-travel the *code* (it would un-log everything recorded since); wrong semantics, not a storage-cost issue. (b) **Agent-written up/down migration pairs** — the harness can verify idempotency mechanically (run twice, compare) but *cannot* verify an inverse's semantic correctness; downs are inherently lossy; and the failure mode fires during the user's undo, the worst possible moment.
**Phasing:** `on-device-snapshot-store` is untouched (the schema artifact is just another tracked file, D6). The v0.2 storage layer ships rules 1–3 (static checks + retention — cheap, mechanical). The transform catalog (rule 4) lands when the first real unit-change need appears; that deferral is safe precisely because rules 1–3 guarantee nothing is lost in the meantime.

### 39. `on-device-snapshot-store` built + accepted on-device — the retained version store ships `[DECIDED — consumes #36, retains`mini-app-versioning` + `mini-app-forking`]`

**Decided:** The retained on-device snapshot store is implemented (host-side, `src/host/version-store/`) from the #36 recipe and **accepted on the real Android target** (Pixel_9_Pro_XL arm64, RN 0.85.3 / Hermes / new arch, offline release bundle, **0 failures**). This is the build #36's spike de-risked; its capability deltas fold into `openspec/specs/` on archive.
**What runs:** a thin **product-verb API** (`snapshot`/`history`/`diff`/`rollback`/`pin`/`fork`) over an `isomorphic-git` (1.38.4) subset, git vocabulary kept strictly internal — snapshot ids are opaque (`g1`, `g2`, …), lineages are `main`/`fork-N`, and an `assertNoGitLeak` guard fails the build if a hash/ref/commit key reaches a return shape. One repo per mini-app; the store holds **no handle to any user-data store** (D2 boundary, enforced by a constructor guard). Content-agnostic (D6): a future `schema` artifact is tracked/diffed/rolled-back like any other file with zero new code.
**Polyfill recipe (consumed, not re-derived):** `buffer` + `text-encoding-polyfill` (Hermes ships `TextEncoder` but not `TextDecoder`) + a 3-line `process` shim, imported **before** isomorphic-git via ESM evaluation order.
**Persistence (the spike's #1 handed-forward item, D4):** an in-memory JS `fs` shim (the #36 substrate, ~Hermes-safe, zero native FS surface) mirrored per-path into **MMKV** (`react-native-mmkv` 4.x via nitro — `createMMKV()`/`remove()`, autolinked clean). Each FS path = one KV key, so KV key count tracks loose-object count. **Cross-app-restart confirmed:** three consecutive kill+relaunch cycles, each verifying the prior launch's snapshots/pins/forks survived intact (`restartVerified:true`, generations 1→2→3, kvKeys 32→41→48), **0 corruption**.
**Compaction (the spike's #2 handed-forward item, D5):** DIY **pack-then-drop-loose** — `packObjects` reachable oids → `indexPack` (required: isomorphic-git can't read a pack without its `.idx`) → unlink the loose copies through the FS (so KV keys drop too). On-device: **48 loose objects → 0**, history/rollback/pin/fork all still resolve against the packed repo. Triggered by a tunable loose-object-**count** threshold (default 80; count is the cost driver, not bytes).
**On-device numbers (offline release, headless software-GL emulator — conservative; cold-ish, single-op):** snapshot ~45–86 ms · history ~10–29 ms · diff ~8–16 ms · rollback ~58–183 ms · pin ~1 ms · fork ~37–68 ms · compact (pack 48 objs) ~530–590 ms. All well under an interactive second; the depth-scaling ops are still `history` and `rollback` (cap/paginate, as #36 flagged). Storage: ~4 loose objects + ~650 B per generation (matches #36); per-app KV grows ~7–9 keys/gen before compaction.
**Verified twice:** Node core suite (`npm run vstore:test`, 43/43 over the in-memory + a Map-backed KV restart simulation) is the cheap checkpoint; the Android run is the acceptance (D7). The no-merge property holds — `git.merge` exists in the lib and was never called. Evidence: `docs/vstore-android-inmemory.png` (in-memory core PASS), `docs/vstore-android-mmkv-restart.png` (MMKV cross-restart PASS, `restartVerified:true`). Rollback to a native FS backend (the D4 fallback) was **not needed** — MMKV round-tripped clean.

### 40. `mini-app-storage-engine` built + accepted on-device — the per-app SQLite storage engine ships `[DECIDED — realizes #38 rules 1–3, consumes #39 D2/D7, reverses §5.6]`

**Decided:** The host-side storage engine is implemented (`src/host/storage-engine/`) and **accepted on the real Android target** (Pixel_9_Pro_XL arm64, RN 0.85.3 / Hermes / new arch, offline release bundle, **0 failures**, `pass:true`). It is the engine for mini-app *user data* — separate substrate from the version store (#33 code/data split): **SQLite, one database file per mini-app, schema-declared storage, product verbs — never SQL**. This change builds the engine; the follow-up `capability-bridge` wires it to mini-apps as syscall #1, implementing against the contract pinned here (`contract.ts`, D8).

**The §5.6 reversal, on the record:** "schemaless JSON soup" → **schema-declared with forgiving reads** (the reversal #38 already half-decided; see the Reversed section). Blob granularity, not JSON-the-notation, was the problem; columns make #38 rule 3 (unknown-field retention) structural rather than an engine obligation — the hardest thing to get right under blobs evaporates under a relational layout.

**What runs (the verbs, lean):** `kv.get/set/remove` for size-capped scalars (default 32 KiB; an oversized write is refused with a hint pointing at `records.append`) + `records.append/list/update/remove` with `{where, orderBy, limit, offset}` filters (equality + `gt/gte/lt/lte`, AND-only). All SQL is **host-authored and compiled from the verbs**; `records.update` patches only named fields (record-granular — unnamed columns provably untouched); `records.remove` **hard-deletes** (D6 — no engine soft delete).

**Isolation by construction (D2, the #39 constructor-guard pattern):** `createStorageEngine({appId, mode})` resolves exactly one file (`storage/<appId>.db`) or `:memory:` and returns an instance whose API has **no per-call app addressing** — there is no parameter with which to name another app's store. One DB file per app is the cleanest physical boundary available (no shared keyspace for a routing bug to leak across). Ephemeral `:memory:` mode behind the identical surface gives Spike-3's test-storage isolation nearly free.

**Schema evolution (D3/D4), #38 rules 1–3 as code:** a declared `SchemaArtifact` with **burned IDs as physical names** (table/column = the ID, display name = metadata, rename = a display-key change over the same ID → **zero DDL, zero data movement**), a closed six-type set (`text/int/float/bool/date/json`; `int` write-validated to the JS safe-integer range; `int→float` widening is still a rejected type change). `open(artifact)` runs **validate → diff → {identical | additive | older-subset | conflict}**: additive emits the only two DDL forms the engine can ever produce (`CREATE TABLE` / `ALTER TABLE ADD COLUMN` with the declared default — the default backfills old rows, SQLite semantics); older-subset (rollback) is accepted with **zero DDL** (unaddressed columns persist untouched); conflicts (type change, ID reuse, tombstone violation, missing default) are refused with structured fix-hint errors. The diff is a **pure exported function** the future harness reuses as a generation-time static check.

**Design clarification worth flagging:** `_meta` holds the **accumulated** applied schema (the monotone union of every column ever created), not literally "the last-applied artifact." Additive-only + no-DROP means this only grows, which is exactly what makes the rollback/roll-forward retention scenario lossless — re-opening an older artifact is an older-subset no-op, rolling forward again is `identical` (columns already exist) rather than a doomed re-ADD. Tombstoned columns keep their physical column and their **type** in `retired`, so a same-typed re-appearance (rollback across a tombstone) is distinguishable from repurposing a retired ID for a different field (the rejected violation).

**D5a injection defense — a never-regress security invariant (§16.4), gated per-push:** caller text reaches SQL in exactly two ways, never a third. **Values** (record/kv/where-comparison) are *always* bind parameters — `'); DROP TABLE c1;--` is stored and compared as that literal string. **Identifiers** (collection/field names) cannot be parameters, so they are **resolved through the applied schema** to burned IDs (`c1`, `f3`); an unresolvable name is a structured `unknown_collection`/`unknown_field` error, **never** concatenated as a fallback. Because burned IDs are minted from a `[a-z][0-9]+` alphabet they are structurally metacharacter-free even post-mapping. The injection block of `storage:test` captures **every executed statement** and asserts the set is exactly the fixed host-authored templates with dangerous input only ever in the param array — and it now runs as a **blocking CI step** (`.github/workflows/invariants.yml`) alongside sandbox containment.

**Verified twice (D7):** Node suite (`npm run storage:test`, **131/131** over real `node:sqlite` behind a statement-recording executor — zero new devDependency) is the cheap checkpoint; the **op-sqlite Android run is the acceptance**. op-sqlite **16.2.0** autolinked + compiled clean under RN 0.85.3 / new arch (`libop-sqlite.so` loads under Hermes; D1 fallback `react-native-nitro-sqlite` **not needed**). Full lifecycle on-device — schema apply + evolution (add / rename / tombstone + display-name reuse / rollback-shaped reopen), all verbs, KV cap, ephemeral isolation — **all green**, and **cross-restart confirmed** (`restartVerified:true`, `priorRecords` accumulating across real process kills, separate persist-probe app id).

**On-device numbers (offline release, headless software-GL emulator — conservative; 2000-row ledger):** single-op latencies are interactive — `list` over 2000 rows ~4–11 ms · filtered/ordered/limited `list` ~0–1 ms · `update` ~1–11 ms · `remove` ~1–7 ms · `kv.set` ~1–9 ms · single `append` ~1.2 ms warm. DB file ~**76 KB** fresh for 2000 ledger rows (file doesn't shrink on DROP without VACUUM, so a reset run shows the ~164 KB high-water mark). **Caveat recorded:** a 2000-append *bulk loop* is ~2.4 s warm but ~19 s when first-launch `ProfileInstaller`/dex compilation runs concurrently — each append is its own implicit transaction (one fsync); the lean verb set has no batch API by design. Single-op append (the actual interactive path — a user logs one expense) is ~1–10 ms; a future batch/transaction verb (or `PRAGMA journal_mode=WAL`) would collapse bulk seeding if it's ever needed. Toggle the run with `RUN_STORAGE_PROBE` in `App.tsx`.

**Deferred, not precluded (the exploration note's boundary):** the invertible transform catalog (#38 rule 4), aggregation push-down (`GROUP BY` verbs), cross-app sharing, and physical column deletion — nothing built here makes the future audited column drop impossible (tombstones retain enough identity for it).

### 41. `capability-bridge` built — the syscall boundary between sandboxed mini-apps and host capabilities; storage is syscall #1 `[DECIDED — realizes §5.6, consumes #40 (contract.ts), extends #37 constraints to the bridge]`

**Decided:** The governed path between the contained runtime (#35/#37) and host capabilities (#40) is implemented (`src/host/bridge/` + `src/runtime/web/syscall.js` + the `vc-sdk` `storage` facade), with **storage wired as syscall #1**. §5.6's mental model is now code: the WebView is a sandboxed process; the bridge is its syscall interface — transport written once, dispatcher written once, an **append-only syscall table**, and a **gate that is `seccomp` + `capabilities(7)`** with the host-held manifest as the declared capability set. Desktop gates are green; the on-device acceptance harness is wired and is the remaining step (see *Verification*).

**The four-layer machinery (each written once; capability #N+1 = one row + one stub):**

- **Two frame families, never crossed (D1).** Control frames (loader lifecycle + verdicts, nonce-authenticated — unchanged from #37) and syscall/sysret frames (`{whim:'syscall'|'sysret', v, id, …}`). A single `classifyFrame` (bridge `contract.ts`, mirrored by discriminator in the runtime JS) keys both handlers, so neither interprets the other's frames. Syscalls are **deliberately NOT nonce-authenticated**: the legitimate sender *is* the untrusted bundle (via the SDK stub), so there is no honest-sender property — authority comes entirely from the host gate. A forged "sysret" the bundle posts to its own window is inert (the marshaller accepts a response only from `ev.source === window.parent`, and resolves only an id it issued).
- **Channel-derived identity (D2).** The envelope carries **no** app/store/realm field. The outer document relays only `event.source`-verified frames from its own iframe; the RN host keys the realm record off which WebView delivered the message; the dispatcher closes over a realm record bound at launch to one app's manifest + one engine handle. A cross-app read is not "denied" — it is **inexpressible** (the Node suite proves a frame with forged `appId`/`dbPath` hits only the bound store; the SyscallFrame surface has no addressing field). One WebView == one realm == one app, so the launcher era (N apps) is a loop, not a redesign.
- **Dispatcher: correlation + idempotent delivery + generation fences (D3).** Per-realm-generation request-id dedup (a bounded LRU; a retried `append` **replays the recorded outcome**, never double-appends — the #40 storage requirement, implemented once at transport level for every capability). Generation fences extend #37 constraint #5 to the bridge: a frame stamped with a stale generation is dropped, and a handler result completing after its realm was torn down is **discarded**, never delivered into the successor (the host is the generation authority — it stamps the realm's generation into the init frame the marshaller echoes).
- **Append-only registry + gate (D4/D5).** `register(method, {capability, paramsSchema, handler})`; a duplicate method is a **startup error** (no override). The gate runs in **fixed order** — registered → capability ∈ **host-held** manifest → permission hook (pass-through for Tier-0 storage; the seam exists for notifications/sensors) → params shape — and every denial is structured data carrying a machine-readable `kind` + fix hint (`{kind:'undeclared_capability', capability:'storage', hint:…}`), the §8.1 shape the future repair loop consumes. **Host-held manifest, never the bundle's self-description** (a hostile bundle's runtime capability claim gates nothing); today the record is extracted by the build from each fixture's own `defineApp` (single source of truth — fixtures can't drift); later it is harness-validated and version-store-tracked.

**Storage as syscall #1 (D5/D6/D7):** seven rows (`storage.kv.get/set/remove`, `storage.records.append/list/update/remove`), each a thin binding onto `realm.engine`. The engine's structured `StorageEngineError`s (`unknown_collection`/`unknown_field`/…) surface verbatim on the `sysret`, so the #40 injection defense holds **end-to-end through a hostile bundle**, not only at the engine API. The `vc-sdk` `storage` facade is typed client stubs holding nothing stronger than the one-way transport (constraint #2 — the marshaller's only window-reachable surface is `__whimSyscall.call`, which posts a string). At launch the host `createStorageEngine` → `engine.open(schema)` **before** the bundle runs (D7), so a conflict-class schema error is a structured launch failure and old code never executes against a store it can't open.

**The §5.6 porting abstraction, on the record:** adding a capability must be one registry row + one client stub, with **zero** transport/dispatcher edits — else the abstraction leaked (the review rule). The `diag.echo` row is the in-tree proof (the "second capability"): gated, callable, and the latency echo, added without touching either. The v0.3 readiness test stands: the haptics row must be addable the same way.

**Verification (D8):**

- **`npm run bridge:test`** — **63 checks** over the REAL `node:sqlite` engine + a fake transport: gate order + every denial kind, dedup replay (no double-append), stale-generation drop, late-result discard across a reset, append-only registry, channel-derived identity, storage round-trip, the second-capability proof, launch-time schema-conflict refusal, and the end-to-end injection block. Blocking CI.
- **`npm run bridge:invariants`** — **7 checks** over the REAL sandbox (headless Chromium enforcing the #35 CSP + iframe) delivering a REAL hostile bundle over the REAL syscall transport to a Node host shim built from the SAME gate/dispatcher/registry modules over a REAL `:memory:` engine: storage-reachable round-trip (water-counter), undeclared-capability denial (cap-intruder), stub-authority (no escalation beyond the transport), forged-sysret inertness, stale-generation drop, `sql-injector` end-to-end (values inert, identifiers rejected), **plus a negative control** (a deliberately misconfigured gate that grants an undeclared capability is correctly FLAGGED — the suite isn't vacuous). Blocking CI.
- **Retained suite untouched:** `npm run invariants` still **42/42** contained with all scenarios green (no CSP/`script-src`/module-allowlist drift; the new `syscall.js` part added no escape), and `npm run storage:test` still **131/131**.
- **On-device acceptance — DONE (Pixel_9_Pro_XL arm64, RN 0.85.3 / Hermes / new arch, offline release).** Two complementary runs, **0 failures**:
  - **Host-core probe over op-sqlite** (`RUN_BRIDGE_PROBE`, `bridge/device-acceptance.ts`, `pass:true`): every gate denial, dedup-no-double, stale-generation drop, storage round-trip, **end-to-end injection (values inert + identifiers rejected) on real op-sqlite**, append-only registry, and **cross-restart persistence** — `priorRecords` 0→1→2 across real process kills, `restartVerified:true`. Host-side latencies (gate + engine, no transport): `diag.echo` ~0.04–0.12 ms · `kv.get` ~0.1 ms · `records.list` ~0.4 ms · cold first-writes `kv.set` ~20 ms / `records.append` ~14 ms (each its own fsync — the #40 pattern).
  - **Full WebView round-trip** (the normal app path, `WebViewHost` deliver buttons): `latency-probe` ran **111 syscalls** marshaller → relay → host dispatcher → op-sqlite → back, all ok; `water-counter` **incremented to 3, survived a force-stop, reloaded 3** through syscalls (§15.2 acceptance, literal); `sql-injector` **INJECTIONS LANDED: 0** (every value an inert literal, every crafted identifier `unknown_collection`/`unknown_field`); `cap-intruder` denied with **`undeclared_capability`**, forged cross-app frame ignored, forged self-`sysret` inert, and the F4 spoof-probe control frame rejected by nonce auth — **containment held `42/42` throughout** (the new `syscall.js` part adds no escape; no CSP/allowlist drift). **Round-trip latency ≈ 16–17 ms median for every verb** because the postMessage + `injectJavaScript` hop dominates (the engine is sub-ms); the **10 s** D8 timeout has vast headroom (a tighter ~2 s default would still be 100× the observed max — left at 10 s pending real-hardware numbers, since the emulator is the conservative case). Cold start: tip-splitter ~116 ms, a re-injected realm ~12–30 ms.
  - **The device run earned its keep:** it caught a host-wiring bug the desktop suite couldn't — `WebViewHost` skipped building a dispatcher for a zero-capability app, so `cap-intruder`'s undeclared syscall was silently dropped into a 10 s timeout instead of a structured denial (the `bridge:invariants` Node shim always builds a dispatcher, masking it). Fixed: the host **always** binds a realm + dispatcher (engine opened only if storage is declared), so the gate refuses every verb at the capability step. The §16.4/D8 lesson restated: the on-device run is the acceptance, not the desktop filter.

**Not in this change (unchanged from the proposal):** capabilities #2+ (haptics/audio — v0.3), web-resident effects (`delay`/`interval`), runtime permission prompts (the gate has the hook), generation-time static manifest/schema extraction (harness phase), and any widening of the CSP / sandbox attributes / module allowlist (locked by #35/#37).

### 42. The v1 roadmap locked — thirteen changes, four lanes; the planning session's scope resolutions `[DECIDED — resolves most §17 OPENs, refines #25/#31/#32, reverses §10's floating-button-primary]`

**Decided:** The remaining work from the capability bridge (#41) to v1 is split into **13 OpenSpec changes across four lanes** (runtime/SDK · host UX · server/harness · integration), with per-change briefs, the dependency graph, the wave plan, and the proposal protocol persisted in **`docs/v1-roadmap.md`** — the standalone handoff artifact so any fresh session can propose a change without this session's context. The app corpus (the §18 list, user-authored) is persisted in **`docs/app-corpus.md`**; its 11 Tier-0 rows are the v1 corpus.

**Session resolutions (former OPENs, now settled):**

- **Model strategy (refines #25):** build and tune the harness against a **strong coding model first**, then let the eval corpus decide the downgrade — DeepSeek becomes a *candidate in the bakeoff*, not the dev target. Rationale: while the harness is unproven, a weak model means debugging two unknowns at once. The two-stage **rewrite model** is picked in the same bakeoff (a much easier task; the cheapest models get their shot there). Model access via **OpenRouter** for dev/bakeoff; moving the chosen model to its direct API afterward is a known follow-up (prompt caching — the §4.7 cost lever — is weaker through a router).
- **Backend runtime (resolves #31's open half):** **Node 22.** Already pinned across the repo and CI; the check toolchain is battle-tested on it; one fewer variable while debugging the loop. Bun rejected as a second runtime with no pull. **Transport (narrows #32):** plain typed REST + SSE with zod-validated schemas shared from a monorepo `contract/` package; **tRPC dropped** (SSE is the hard part; tRPC doesn't help it). **Repo:** monorepo — `server/` workspace in this repo, because shared TS types between SDK, checks, and server is the whole point of #31.
- **Identity/auth (resolves §17):** anonymous device UUID, generated on first run, stored in MMKV, sent as a header; the server keeps only a per-ID token counter. No accounts, no PII.
- **Two-stage prompt (sharpens #21): in v1.** The rewrite stage runs server-side; the device shows the preview the user reviews/edits before the engineer model runs. The §10.1 boundary holds: the user reviews *intent in their own terms*; SDK internals never surface.
- **First-run (resolves §17):** seed **two example apps** — tip splitter + water counter (both exist as fixtures) — labeled as examples, forkable/deletable, plus a prominent "make your first app" CTA.
- **Back navigation (reverses §10's floating-button-as-primary):** **Android system back is the primary exit** — back pops the mini-app's own nav stack, then exits to the launcher at the root. Zero screen real estate, native muscle memory, and the spec's self-flagged overlap risk disappears by construction. A small **draggable, auto-dimming floating affordance** survives, demoted to "home / start prompting."
- **Acceptance device:** spike a fresh AVD (non-Play image; also retry `adb reverse` for plain HTTP — the Metro failure may have been dev-server-specific) for daily dev; **a real Android device on LAN is the v1 acceptance target** — also the first representative perf/touch read (everything so far was emulator + software GL).
- **Synthetic run location:** server-side **headless Chromium reusing the invariants machinery** (same generated artifacts, same trusted-vantage rule per F4). On-device remains the acceptance tier, never the per-generation smoke test.
- **Holdout custody (§16.4 as process):** the held-out eval prompts live with the user, outside the agent-readable tree, never committed.

**Doc deviations, on the record (spec.md is deliberately not retro-edited — the #40/§5.6 precedent: the log supersedes, the spec stays a thinking document):**

1. **DeepSeek-first → strong-first** (#25 refined): same destination (the cheapest model that passes the corpus), inverted methodology.
2. **Floating button primary → system back primary** (§10 reversed; see Reversed section).
3. **SDK "~60–80 exports" is a ceiling, not a target** (§5.2 reread): every export costs system-prompt tokens and eval coverage; the corpus gap analysis sets the real number.
4. **tRPC dropped** (within §4.7's stated options — picking the boring half).
5. **`Chart` added to the SDK surface** (beyond the §5.2 sketch, which stopped at `ProgressBar`): the corpus demands it (spending graph, streak heatmap). Scoped to exactly three declarative shapes — bar, line, calendar-heatmap — tokens-only, no canvas, its own change (`sdk-charts`). This is the §18 gap-analysis process working as designed.
6. **Animation/motion deferred to one post-v1 tier** (affects the flashcard flip — instant in v1 — and the drinking roulette's ceremony).

**Working agreement for the roadmap phase:** roadmap/proposal sessions **propose only** (artifacts under `openspec/changes/<name>/`) and update the roadmap ledger; implementation happens in separate sessions. Invariant-suite edits stay in dedicated runtime-owner sessions, never inside the feature session they guard (§16.4). The full protocol lives in `docs/v1-roadmap.md`.

### 43. v0.3 `effects-and-cues` — time + physical feedback; the bridge's append-only readiness test PASSED `[DONE — desktop + emulator; runtime-owner invariants & real-hardware felt-cue check pending]`

**Shipped (roadmap change #2, the §15.2 v0.3 rung):** mini-apps can now *act over time* and *cue the body*.

**Effects — userspace, no bridge (D1/D2):** `vc-sdk` exports `delay(ms): Promise<void>` (one-shot sequencing) and `interval(cb, ms, { running })` (a React **hook** — auto-cleanup on unmount falls out of the hook contract, so the §5.5 "interval without cleanup" leak class is deleted *by construction*, not detected; `running:false` pauses without teardown). Both are wrapped web `setTimeout`/`setInterval` inside the iframe: **no syscall frame, no capability, no gate**. `setTimeout` is deliberately NOT stripped (#35 — strip capabilities, not time; React's scheduler and the marshaller need it). Realm-teardown cancellation is **structural** (iframe recreation, carry-forward #5 destroys the timer queue) — **no SDK-level cancel registry was built** (D2); the property is *proven* by a runtime-owner invariant (pending), not trusted.

**Cues — syscalls #2/#3, one `cues` capability (D3/D4/D7):** `cues.haptic(kind)` + `cues.sound(name)` ride the **same** one-way `__whimSyscall` transport as storage (nothing stronger — constraint #2). Closed token sets, single source `src/host/bridge/contract.ts` — haptic `tap|double|heavy`, sound `tick|chime|alarm`; the host owns token→pattern/tone, so the bundle expresses **no** raw pattern/duration/asset (tokens-not-values). Off-set tokens get the gate's `invalid_params` with a hint that **enumerates the valid set** (§8.1 self-repair). Fire-and-forget + at-most-once: the sysret is `{}` posted as soon as the cue triggers (no completion/duration/device-state — cues add zero sensing surface), and the dispatcher's existing dedup means a retried frame **replays without re-firing** (no double-buzz).

**The #41 readiness test PASSED (D5):** haptics + sound landed as **two registry rows + two SDK stubs + the contract types + the registry factory's `cueBackend` option — and *nothing else***. `dispatcher.ts`/`gate.ts`/`registry.ts`/`launch.ts` untouched; `src/runtime/web/` + `build/assemble.mjs` untouched (no D9 red flag); CSP/sandbox/allowlist unchanged (#35/#37). The §5.6 abstraction held: capability #N+1 really is one row + one stub. Cue rows bind to an injected `CueBackend` interface (RN-free) so `bridge/` stays loadable under Node; the RN implementation lives host-side (`src/host/cue-backend.ts`: `Vibration` + the D6 audio module), injected via `createDefaultRegistry({ cueBackend })`.

**Audio backend (D6) — the minimal dep was *none*:** an in-repo ~40-line Kotlin TurboModule (`WhimTone`) wrapping `android.media.ToneGenerator`, codegen spec at `src/native/NativeWhimTone.ts` + `codegenConfig` in package.json. **Codegen generated `NativeWhimToneSpec` and the Kotlin compiled + installed clean — the named fallback (`react-native-sound`) was NOT needed.** `android.permission.VIBRATE` added (a normal install-time permission). The token→tone table lives in Kotlin; the contract never sees it (sound design can change behind the tokens).

**Verification:**

- **`npm run bridge:test` — 91 checks** (was 63): the new **§G** section drives cues against a recording-fake `CueBackend` — append-only registry, `undeclared_capability` denial (backend never invoked), `invalid_params` with token-listing hints, one-invocation-per-valid-cue resolving `{}`, **dedup-no-double-buzz**, stale-generation drop, and a **missing-backend → structured `handler_error`** (never an unshaped throw). Blocking CI.
- **Effects in headless Chromium** (`effects-desktop-check.mjs`, the fast filter — not the never-regress suite): E1 a running `interval` ticks with **zero syscall frames**, E2 `delay` sequences (~121 ms for 120), E3 unmount cancels, E4 `running:false` pauses then resumes. All hold.
- **Retained suites untouched:** `npm run invariants` green (7 isolation checks + the non-vacuous broken-CSP negative control); `npm run lint` adds no new errors (the 37 pre-existing are all in untouched `src/runtime/web/` eval-probes).
- **On-device — EMULATOR acceptance DONE** (Pixel_9_Pro_XL arm64, RN 0.85.3 / Hermes / new arch, offline release): pour-over delivered through the normal path, **`interval` countdown ticked at 1 Hz through the 30 s Bloom stage**, the **get-ready beat and a stage-transition cue fired** (`syscalls: 8 · last: cues.sound → ok`; no native cue errors in logcat), **pause froze the countdown** (`running:false`), and **containment held `CONTAINED ✓ 42/42`** throughout (the "42/42" the design names is this on-device probe fraction). The Kotlin TurboModule + codegen compiled and the APK installed. **Pending:** (a) the *felt* buzz/tone on **real hardware** (the emulator verifies the full software path SDK→syscall→gate→`Vibration`/`ToneGenerator` but can't show the physical sensation — the design's stated device policy); (b) the **two runtime-owner invariants** (INV-TIMER, INV-CUEGATE) — authored in a separate session per §16.4; English statements handed off in the change's `test-spec.md §3b`.

**Deviations / notes, on the record:**

1. **Cues are a `cues.{haptic,sound}` facade**, not top-level `haptic`/`sound` exports (the proposal's loose phrasing) — matches D8's `cues.haptic('double')` call syntax and mirrors `storage`. Counts as the "2 cues" in the budget.
2. **`interval`-as-hook keeps the spec-fixed name with a scoped `eslint-disable react-hooks/rules-of-hooks`** (design D1's accepted tension), rather than renaming to `useInterval` — the agent-facing vocabulary #1 fixed wins; aliasing stays additive if hook-rule tooling ever becomes load-bearing.
3. **Missing-backend surfaces as `handler_error`** (the dispatcher's existing generic shaping of a thrown `Error`), NOT a new `BridgeErrorKind` — keeps the dispatcher untouched (the #41 review rule) while still being structured + non-leaky.
4. **`interval` opts kept minimal `{ running }`** — `immediate` wasn't needed by the fixture; additive later (the design open question, resolved by "implement only what it uses").
5. **SDK surface: 14 runtime value exports** after this change (added `delay`, `interval`, `cues`) — far under #1's ~42 ceiling.

**Not in this change (unchanged from the proposal):** notifications / background execution / schedules (Tier 2 — the "fires while closed" pour-over variant), media/volume APIs, arbitrary sounds or vibration patterns (closed token sets only), animation/motion (post-v1), runtime permission prompts (the gate's hook stays pass-through; the seam exists), and any widening of CSP / sandbox attributes / module allowlist (locked #35/#37).

---

## I. v1 product shell

### 43b. `launcher-shell` built — the product shell over the contained runtime; back navigation as task 1 `[BUILT — desktop gates green; on-device acceptance (task 7.2) PENDING — roadmap change #5, consumes #39/#40/#41, realizes #42's back-nav + first-run resolutions]` `[renumbered from a duplicate #43 (effects-and-cues keeps 43), 2026-07-07]`

**Decided / built:** the host stops being a probe screen and becomes a **product**: a persistent home grid of installed mini-apps, full-screen launch over the existing one-WebView-one-realm loop, Android-system-back + a floating affordance as exits, fork + delete, and first-run seeding. The probe screen survives as a `__DEV__`-only surface (`DevProbeScreen`) — it is the standing containment/bridge harness, not legacy UI. Implemented on branch `launcher-shell` off `dev/v1`.

**D1 — record store = a thin MMKV index over version-store-held bundles.** `src/host/launcher/app-index.ts` holds the small synchronous list (one `InstalledApp` record per app + an ordered id list + a seed marker) behind the same `KVBackend` seam the version store uses (`react-native-mmkv` on device, `MapKVBackend` in Node). The bundle SOURCE is never in the index — launching reads it from the version store's active snapshot (D3), so every install/seed/fork is a tagged snapshot from generation #1 and #6 has history the day it lands.

**D2 — one launcher entry == one store appId; fork = store fork + a new entry on a new lineage.** `src/host/launcher/store-access.ts` is the **only sanctioned `VersionStore` path** (the ledger contract note — #6 reads through it, never raw). It carries the two-id model: an original install's launcher id IS its store appId; a **fork** carries an explicit `storeId` (the shared repo) + its own `lineageId`. Load-bearing (D8): the runtime ENGINE appId is always the launcher id, so a fork gets its **own** user data even sharing a repo. Lineage discipline switches only on an actual change (an in-memory per-repo lineage cache; `fork()`'s HEAD-switch is accounted for). **Delete** drops the index entry + the per-app SQLite db, and — only when the repo is no longer referenced (refcount over the index) — calls the new store `remove(appId)`. A surviving sibling fork keeps the repo.

**D3 — bundle delivery by source, iframe contract untouched.** `__whimControl.reinject` gained a `bundleSource` option: the OUTER trusted page delivers the host-supplied source through the **byte-identical** channel-(b) path it uses for baked bundles (`{__whimDeliver:true, bundle:src}` after iframe recreation). The host side JSON-escapes once + size-guards (`src/host/launcher/deliver.ts`, 512 KiB ceiling). **Zero** CSP / sandbox / module-allowlist / iframe-loader changes (review rule held — the diff is confined to the outer orchestration script). A standalone desktop verify (`deliver-by-source.desktop.mjs`, NOT in `invariants/`) proves a fixture delivered by source over an EMPTY baked map renders + contains identically to its baked twin.

**D4 — the nav-depth seam (the #3↔#5 contract) + the guaranteed-exit invariant.** Declared in `src/host/bridge/contract.ts` (`NavDepthFrame`/`NavBackFrame`, added to `classifyFrame` as control-family; the anchor #3 implements against) with the iframe-side TODO anchor in `src/runtime/web/loader.js`. SDK→host nav-depth is a deliberately **unauthenticated hint** (F4: the bundle could forge depth by really calling `nav.push()`, so authentication buys nothing) — the outer page source-verifies + stamps the generation (the same #41 D3 fence). The exit decision is a **pure state machine** (`src/host/launcher/back-policy.ts`, TDD'd under Node): depth-0 → immediate exit; depth>0 → forward one `nav-back`, then a single unhandled-press window (**400 ms**, tunable) arms a double-back escape; a genuine late decrease disarms it (cooperation not punished); inflated/stale claims buy nothing. In #5 depth is always 0 (no SDK nav yet) → back exits at root.

**D5 — floating affordance:** a host-layer RN overlay (`FloatingExit.tsx`), draggable with edge-snap (the answer to §10's overlap risk), auto-dimming after idle, restoring on touch, tap → exit. Host-rendered, unreachable from the realm — the third leg of guaranteed-exit.

**D6 — host structure:** `WebViewHost.tsx`'s realm loop extracted **verbatim** into `useMiniAppHost` + `MiniAppView` (so the cap-intruder lesson — always bind a realm + dispatcher — is preserved by construction); the probe UI became `DevProbeScreen`; a plain-state `LauncherRoot` switches home / mini-app / dev-probe (no nav library). `App.tsx` defaults to `LauncherRoot`; the version-store/storage/bridge probe flips remain. `WebViewHost.tsx` removed.

**D7 — first-run seeding:** `build/build.mjs` now emits `src/runtime/generated/app-bundles.ts` (fixture name → IIFE source) so the RN side can seed. `seedFirstRun` installs tip-splitter + water-counter as example-labeled, snapshot-backed records; a single MMKV seed marker makes it idempotent and keeps deleted examples deleted.

**Verification (D8):**

- **`npm run launcher:test`** — **433 checks**, 0 failed (back-policy state machine incl. the double-back escape + generation fencing; app-index CRUD/ordering/restart-survival/seed-marker; store-access fork mapping/independent evolution/lineage discipline/own-engine-appId/delete-refcount; seed idempotence + deleted-stay-deleted; the product-verbs guard). Wired into the blocking CI alongside storage/bridge.
- **`npm run vstore:test`** — **52 checks** (gains `remove(appId)`: zero-keys-after on the KV backend, prefix-scoped, idempotent, no git leak).
- **Retained suites untouched:** `npm run invariants` still **42/42** (7 scenarios, negative control flags the broken CSP); `storage:test` **131**; `bridge:test` **63**. `tsc --noEmit` clean; lint adds **zero** new errors over baseline.
- **On-device acceptance (task 7.2): NOT YET RUN** — the authoritative pass per the #39/#40/#41 precedent is the offline release APK walk in `src/host/launcher/test/acceptance.spec.md` (seed → launch water-counter by source → syscalls + persistence → system back exits → fork runs independently → delete leaves no residue → containment 42/42). This entry is updated to `[BUILT + ACCEPTED]` once that run is recorded.

**Not in this change:** the prompt/generation screen (#7 — the "make your first app" CTA is a labeled placeholder), history UX (#6), the SDK `useNavigation`/`useRoute` (#3 — #5 ships the host half + the seam), any server talk (#8+), and any widening of the CSP / sandbox / module allowlist (locked #35/#37; the diff held the line).

### 44. `useRef` joins the SDK hook surface `[SHIPPED 2026-07-01 — fix-loop disposition B4, human-approved 36a6a5c; entry recorded 2026-07-02 per critic finding]`

**Decided:** `vc-sdk` re-exports `useRef` alongside `useState`/`useEffect` (`src/sdk/index.tsx`). The B4 fix (pour-over-timer "ghost restart") needed an async-live readable cancellation token: a coroutine that has already begun awaiting must be able to observe a cancellation set *after* it started, which a `useState` value cannot do (it freezes at the value it had when the closure was created). The fix-worker correctly refused two bad-practice workarounds (module-scope mutable state; setState-updater contortions) and class-B-stopped; the export was approved by the user as a deliberate public-surface expansion.

**Why it's containment-neutral (the test any future hook must pass):** `useRef` is a pure fiber-memory cell — a stable mutable `{current}` box with NO ambient authority: no network/storage/native reach, nothing the three containment legs (#35) govern. It widens what a mini-app can *remember*, not what it can *reach*. The full rationale lives as a comment at the export site in `src/sdk/index.tsx`.

**Boundary restated:** the SDK exposes React hooks case-by-case — each addition needs (a) the no-ambient-authority test above and (b) a concrete Tier-0 corpus need, recorded here. `useMemo`/`useCallback`/`useReducer` stay OUT until a corpus app demands them (they remain listed as candidates in `docs/sdk-gap.md` §5). This supersedes the "`useState`, `useEffect` only" line in `docs/sdk-gap.md` §1 (a dated snapshot, annotated in place).

### 45. `sdk-design-system` built — the themeable token contract, the component kit, and user theme customization `[BUILT 2026-07-02 — roadmap change #3 plus launcher theming; owner waived the #44 corpus-need rule for this change, recorded in the proposal]`

- **Theme is inert data riding the existing init frame.** A `WhimTheme` (semantic color roles, shape, dark flag) travels as an optional field on `__whimHostInit`; `loader.js` installs it frozen as `globalThis.__WHIM_THEME__` before mount, and `tokens.ts` sanitizes it field-by-field (hex-pattern colors, enumerated shape) with hard fallback to the default theme. No new message kinds, no CSP/resolver/bridge change; a bundle mutating the global only mis-themes itself. Rejected: a theme syscall (capability creep for inert data), CSS variables (no stylesheet exists), baking the theme into bundles (breaks snapshot immutability + byte-identical delivery, #43b D7).
- **Semantic roles stay the contract; themes swap values.** `ColorToken` grew exactly `positive` + `warning`; every pre-existing snapshot themes for free because it already speaks tokens (#13 upheld).
- **Customization = 6 curated presets + two knobs** (10 curated accent *pairs* so contrast is a curation property, not runtime math; 3 corner shapes scaling the radius tokens). One `src/sdk/theme.ts` (pure data + pure functions) serves both the iframe SDK and the RN launcher — the shell derives its palette from the same resolved theme (`shellPalette`), so there is no second color table.
- **Component kit shipped** (`controls.tsx` / `surfaces.tsx` behind the same `vc-sdk` barrel): TextInput, Switch, Checkbox, Slider, SegmentedControl, Card, Divider, Badge, ProgressBar, List/ListItem, Spacer, EmptyState, Modal, Grid; Button variants/disabled; Text align; Row align/justify. ~35 exports, under the #42 ceiling. Native-control styling leans on `accent-color` (pseudo-elements are unreachable from inline styles) — device look-check pending like #43b's task 7.2.
- **The gallery fixture is the corpus app** (`fixtures/style-gallery.app.tsx`, seeded example #3 via SEED_VERSION 2): exercises every export, anchors knip, and is the manual-QA surface.
- Launcher settings (preset cards, accent swatches, corner pills) persist a `ThemePref` under `whim.theme:v1` in the existing launcher MMKV backend; changes apply live and ride into the next app launch.

### 46. `sdk-navigation` lands recovered roadmap #3 as a stable `nav` object with no v1 params `[BUILT 2026-07-13 — host seam from #43b consumed; desktop acceptance pending final change gate]`

**Scope recovered:** roadmap change #3 now supplies mini-app-owned screen navigation: a declared `initial` screen, a closed `screens` map, stack pushes through `nav.navigate('LiteralScreen')`, and one-level pops through `nav.back()`. The SDK root emits depth hints over the already reserved #43b seam so Android system back can pop the mini-app stack before the launcher exits. This adds no host capability or containment surface; iframe recreation still destroys the entire stack.

**Stable object, not a hook:** `nav` is a module-scope object because navigation is an event-handler action, not render-derived state. This spelling works directly in `Button` handlers and gives the static screen-graph pass one exact, literal-target row to recognize. A hook would add lifecycle/call-site constraints without supplying useful state and would make generated code and static analysis less direct.

**No params in v1:** `navigate` accepts only a declared screen name. Route params, route-reading hooks, deep links, replace/reset operations, and nested navigators remain out. The Tier-0 corpus only needs screen changes, while omitting params avoids a second type/schema/serialization contract before a concrete app demonstrates the need.

**Verification correction (2026-07-13, append-only):** The heading's "desktop acceptance pending final change gate" marker is superseded. Production Chromium acceptance passed List → Detail → production `navBack` → List, with generation-stamped depth hints 0 → 1 → 0 at generation 1 and zero page errors. The durable loader-only bootstrap passed its normal case and missing, invalid, and undeletable fail-closed variants. Final `scripts/gate-full.sh` and the whole-change reviewer both passed. Android System WebView acceptance remains pending.

### 47. `sdk-charts` built — one `Chart` component covers bar, line, and calendar-heatmap `[BUILT — roadmap change #4, corpus need recorded in `docs/sdk-gap.md`/`docs/app-corpus.md` per #44's corpus-need rule]`

**Decided / built:** `vc-sdk` gains exactly one new value export, `Chart` (`src/sdk/charts.tsx`), covering the corpus's three chart shapes (`docs/app-corpus.md`'s spending-tracker bar/line and habit-tracker calendar heatmap) with a single `kind: 'bar' | 'line' | 'heatmap'` discriminant rather than three separate components — the same "one export, many kinds" shape `sdk-navigation` (#46) used for `nav`. Pure display: no bridge traffic, no new hooks, no interactive marks, so it composes under `capabilities: []`. Geometry (scaling, bucketing, calendar day math) lives in a pure sibling module (`src/sdk/chart-geometry.ts`) that `charts.tsx` never reimplements, only feeds resolved theme colors into.

**Containment-neutral by the same test #44 established:** every color derives from the active theme's existing roles through `color(tone)` (no new color token, #13 upheld) — a light→dark theme switch recolors with no app-side handling. Rendering is inline SVG/DOM under the locked CSP (no canvas, no external resources); the component reads no wall clock (`Date.now()`/`new Date()` never appear — the heatmap anchors to the latest date present in its own `data`). Empty `data` renders a fixed-height reserved frame with a `"No data yet"` placeholder rather than collapsing or throwing.

**Corpus anchor:** the style-gallery fixture (`fixtures/style-gallery.app.tsx`, `capabilities: []`) now has a Charts section demonstrating all three kinds with seeded demo data plus one empty-data example, so the shape is exercised without a real corpus app existing yet.

**Not in this change:** legend/axis-label chrome beyond the bar axis labels, tooltips/interactive hover marks, animation, and any chart shape beyond bar/line/heatmap — deferred until a concrete corpus app demonstrates the need, per #44's case-by-case rule.

### 48. `version-history-ux` built — prompts-as-history, restore-before-prompt, and roll-forward `[BUILT — desktop gates green; on-device acceptance (task 5.2) PENDING — roadmap change #6, consumes #43b's `StoreAccess`]`

**Decided / built:** the launcher gains a per-app History screen: each row is one of the user's own prompts (rendered through the D4 envelope below), tap-to-restore, named pins, fork-from-any-point, and lazy schema-diff annotations.

**D1 — a history row restores the state BEFORE its prompt.** Row *i* (the prompt that produced snapshot Sᵢ) restores to Sᵢ₋₁ — Claude-Code-rewind semantics: "undo the change I just asked for," not "redo it." The install row (S₀) has no predecessor and renders with no restore affordance. Restore is instant, backed by the store's non-destructive `rollback`, with a screen-local undo toast (~5 s) that calls `rollback` back to the pre-restore active id — there is no store-level undo concept, only screen state.

**D2 — new store verb `timeline(appId, {limit?}): Promise<Snapshot[]>`.** Additive: enumerates every snap tag, keeps the ones on the active lineage's line (ancestors AND tag-reachable descendants of the current tip, via the existing `isSameLine` predicate), orders newest-first by commit timestamp, caps at `historyLimit` — same shape as `history()`, but survives a rollback (later snapshots stay listed as roll-forward targets instead of falling off HEAD's ancestry). The History screen uses `timeline()` for roll-forward on the primary lineage.

**F1, on the record (a limitation, not silently patched):** `timeline`/`isSameLine` are pure DAG-ancestry with no lineage stamp on commits — for an **un-diverged fork** (zero snapshots of its own since the fork point, so its tip literally IS the shared fork point), `timeline()` can over-include the ORIGINAL lineage's later descendants as if they were the fork's own roll-forward targets. Self-heals once the fork takes any snapshot of its own. The UI guards this today as an interim measure: **fork entries always list via `history()`** (a strict backward ancestor walk — provably safe, never a sibling lineage's snapshot, in every case including forks), while only the primary/original lineage uses `timeline()`. The lineage-correct fix (per-snapshot lineage stamping, or a per-lineage reflog, plus rollback re-gating) is **deferred to `linked-apps-data-model`** (roadmap change adjacent to #6); this UI guard is retired once that lands.

**D4 — prompt envelope `{v: 1, text: string}`, for #7/#11 to conform to.** Lives launcher-local (`src/host/launcher/prompt-envelope.ts`), NOT in `contract/` (the RN app must not grow a workspace import — the `guard:metro` seam). `parsePromptEnvelope(raw: string): {text: string}` strict-parses JSON with `v === 1` and a string `text`; any mismatch (invalid JSON, wrong `v`, missing/non-string `text`, non-object) falls back to `{text: raw}`, never throws. Defined ahead of its writers: `prompt-flow-ux` (#7) and `generation-loop` (#11) surface this shape in `@whim/contract` later and must conform to it; a wrong guess today only degrades to showing raw text, never breakage.

**Verification:** `npm run vstore:test` green (adds the `timeline` scenarios: descendants after rollback, other lineages excluded, cap respected, shape parity with `history`, empty/unborn repo). `npm run launcher:test` green (adds the `StoreAccess` history-surface wrappers, the envelope parser, the History screen's behavioral suite including an explicit F1-repro case, and the product-verbs guard over the new copy). No storage-engine, CSP, sandbox, or existing-verb changes — purely additive per the design's migration plan.

**Not in this change:** rewind-then-new-prompt behavior, linked/shared databases, DB clone, cursor pagination, visual code diffing, and the F1 data-model fix — all deferred to `linked-apps-data-model` or a later change. On-device acceptance (task 5.2) is attended/human-run and updates this entry's status tag once recorded.
