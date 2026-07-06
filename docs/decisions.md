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

### 39. `on-device-snapshot-store` built + accepted on-device — the retained version store ships `[DECIDED — consumes #36, retains `mini-app-versioning` + `mini-app-forking`]`

**Decided:** The retained on-device snapshot store is implemented (host-side, `src/host/version-store/`) from the #36 recipe and **accepted on the real Android target** (Pixel_9_Pro_XL arm64, RN 0.85.3 / Hermes / new arch, offline release bundle, **0 failures**). This is the build #36's spike de-risked; its capability deltas fold into `openspec/specs/` on archive.
**What runs:** a thin **product-verb API** (`snapshot`/`history`/`diff`/`rollback`/`pin`/`fork`) over an `isomorphic-git` (1.38.4) subset, git vocabulary kept strictly internal — snapshot ids are opaque (`g1`, `g2`, …), lineages are `main`/`fork-N`, and an `assertNoGitLeak` guard fails the build if a hash/ref/commit key reaches a return shape. One repo per mini-app; the store holds **no handle to any user-data store** (D2 boundary, enforced by a constructor guard). Content-agnostic (D6): a future `schema` artifact is tracked/diffed/rolled-back like any other file with zero new code.
**Polyfill recipe (consumed, not re-derived):** `buffer` + `text-encoding-polyfill` (Hermes ships `TextEncoder` but not `TextDecoder`) + a 3-line `process` shim, imported **before** isomorphic-git via ESM evaluation order.
**Persistence (the spike's #1 handed-forward item, D4):** an in-memory JS `fs` shim (the #36 substrate, ~Hermes-safe, zero native FS surface) mirrored per-path into **MMKV** (`react-native-mmkv` 4.x via nitro — `createMMKV()`/`remove()`, autolinked clean). Each FS path = one KV key, so KV key count tracks loose-object count. **Cross-app-restart confirmed:** three consecutive kill+relaunch cycles, each verifying the prior launch's snapshots/pins/forks survived intact (`restartVerified:true`, generations 1→2→3, kvKeys 32→41→48), **0 corruption**.
**Compaction (the spike's #2 handed-forward item, D5):** DIY **pack-then-drop-loose** — `packObjects` reachable oids → `indexPack` (required: isomorphic-git can't read a pack without its `.idx`) → unlink the loose copies through the FS (so KV keys drop too). On-device: **48 loose objects → 0**, history/rollback/pin/fork all still resolve against the packed repo. Triggered by a tunable loose-object-**count** threshold (default 80; count is the cost driver, not bytes).
**On-device numbers (offline release, headless software-GL emulator — conservative; cold-ish, single-op):** snapshot ~45–86 ms · history ~10–29 ms · diff ~8–16 ms · rollback ~58–183 ms · pin ~1 ms · fork ~37–68 ms · compact (pack 48 objs) ~530–590 ms. All well under an interactive second; the depth-scaling ops are still `history` and `rollback` (cap/paginate, as #36 flagged). Storage: ~4 loose objects + ~650 B per generation (matches #36); per-app KV grows ~7–9 keys/gen before compaction.
**Verified twice:** Node core suite (`npm run vstore:test`, 43/43 over the in-memory + a Map-backed KV restart simulation) is the cheap checkpoint; the Android run is the acceptance (D7). The no-merge property holds — `git.merge` exists in the lib and was never called. Evidence: `docs/vstore-android-inmemory.png` (in-memory core PASS), `docs/vstore-android-mmkv-restart.png` (MMKV cross-restart PASS, `restartVerified:true`). Rollback to a native FS backend (the D4 fallback) was **not needed** — MMKV round-tripped clean.
