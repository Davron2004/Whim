# Whim — Project Spec

*A working specification, assembled from architectural discussion. This is a thinking document, not a contract. Decisions marked **[OPEN]** are not yet made; decisions marked **[DECIDED]** are settled for now but can be revisited with reason.*

---

## 1. What Whim is

Whim is a mobile app that lets a person vibe-code tiny apps for themselves, on their phone, by talking. No code is ever shown. You describe what you want, an AI agent builds it against a constrained in-house SDK, and the result appears in your launcher as a runnable app.

**One-line thesis:** the long tail of personal software. Apps too small, too niche, or too personal to ever deserve a store listing — the "one and done app, just for me." A custom timer with your exact pour-over recipe. A tracker for some bullshit only you care about. An alarm that reads your calendar and talks to you. These never get built today because the effort-to-payoff ratio doesn't justify a real project. Whim collapses that effort to a sentence.

This is the same long-tail thesis as Nothing's Essential Apps ("not every app needs to solve a problem for everyone"). Whim differs in being platform-independent and voice-first.

## 2. Why this is being built

Primary purpose: **portfolio / resume project.** It demonstrates the ability to design and build an agentic coding harness, and to use agentic harnesses to build other agentic harnesses. The harness itself is the artifact worth showing.

**Implication for priorities:** the harness, SDK design, eval methodology, diagnostics, and self-healing loop are where the hard, novel, judgment-worthy work lives — that's what engineers and recruiters will scrutinize most. **This is a prediction about where effort will land, not a license for weak UI.** The user-facing surface (onboarding, launcher, prompt screen, empty states) must be genuinely good: clean, intuitive, real UX best practices, deliberate spacing and typography. A product with a brilliant harness behind an ugly interface is not compelling. Both have to be good. The harness is simply where more of the time and code will go, because that's where the difficulty is — never an excuse to ship shitty UX.

The end-user audience is deliberately undecided. It will be inferred later from watching the product in action. It is unlikely to be hardcore software developers — for them this harness will be a toy next to Claude Code. The realistic audience is non-developers with micro-needs, or technical-but-casual people who want to skip building a whole project for a trivial idea.

**Recommendation captured:** document the build in public as it happens (README + short posts on the architecture decisions, SDK rationale, diagnostics catalog, eval method, rejected trade-offs). The thinking is the differentiator on a resume and is invisible from code alone.

## 3. Terminology

- **Host app** — the thing being built. The native shell, the launcher, the prompting UI, the runtime that runs mini-apps.
- **Mini-app** — a thing a user vibe-codes inside Whim. A bundle of generated code targeting the SDK.
- **The SDK** — the in-house TypeScript framework that mini-apps are written against. The only surface the generating agent is allowed to use.
- **The harness / the loop** — the server-side agentic system that plans, generates, checks, runs, and repairs mini-app code.

---

## 4. Architecture decisions

### 4.1 No native code generation [DECIDED]

Mini-apps will not be compiled native code. iOS forbids JIT and runtime execution of arbitrary native code outside JavaScriptCore/Safari, and disallows shipping compiled native binaries to a device post-install. The "compile on the server, send the binary down" route is also disallowed. The runtime is therefore an interpreter (JavaScriptCore on iOS, V8/Hermes on Android) and the language is JavaScript/TypeScript.

### 4.2 Apple Guideline 4.7 constraints (relevant once iOS is in scope)

As of November 2025, Apple's Guideline 4.7 explicitly covers HTML5 and JavaScript mini-apps. Key rules that shape Whim:

- Mini-app code must run in WebKit / JavaScriptCore.
- **4.7.2:** the host may not extend or expose native platform APIs to the mini-app software without Apple's prior permission. (This directly constrains sensors, Bluetooth, camera, etc. for mini-apps.)
- A manifest/index of all mini-apps and their capabilities must be available.
- Content reporting, blocking, and age gating are required if content can exceed the host's age rating.
- No real-money gaming, lotteries, or digital commerce inside mini-apps.

Apple also launched a Mini Apps Partner Program (85% revenue share on qualifying IAP) in late 2025, which formalizes this category — meaning the path exists, but it has rules.

Android has no equivalent restriction, which is why Nothing shipped Android-first.

### 4.3 The runtime architecture [DECIDED]

Three candidate architectures were considered:

- **A — Mini-app sandbox in a WebView** (WeChat, Telegram Mini Apps, Nothing). Native shell, mini-apps are HTML/CSS/JS in a WebView with a controlled JS bridge.
- **B — JS bundle interpreted against a constrained in-house framework** (the "private SDK" approach). Same idea as A but the agent only emits code targeting a small, defined component/capability surface, not arbitrary HTML/JS. **← chosen.**
- **C — Full React Native app generated, built on a server, shipped through the app stores** (a0.dev, Rork). Sidesteps 4.7 because each mini-app is its own store submission, but build times are minutes-to-hours, every change is a re-submission/OTA, and users install N separate apps. This is a different product and is **not** what Whim is.

**Why B (the private framework):** four wins at once —
1. **LLM reliability** — models generate far better code against a small, fully-documented API than against the open web. The entire surface fits in the system prompt; hallucinated imports become impossible.
2. **Sandboxing tractability** — the host decides exactly what mini-apps can touch.
3. **Apple 4.7 alignment** — a defined component framework with declared capabilities is defensible in review; "we run whatever the LLM wrote" is not.
4. **Cross-platform parity** — one framework renders identically on both platforms; the agent never needs to know the target OS.

### 4.4 Server in the middle [DECIDED]

Generation runs on a server. The phone is the front end / interface; the harness lives server-side. The phone talks to the server (likely WebSocket for streaming), the server calls the LLM endpoint, runs the check-and-repair loop, and streams the final clean bundle down.

Rejected alternative: phone talks directly to the model endpoint. Rejected because it would mean the harness (the actual product) can't run between model output and user delivery — no static checks, no repair loop, no filtering, no prompt protection. WebSocket fan-out concerns at small scale are a non-issue (hundreds of concurrent streams are trivial; this only becomes an architecture problem in the tens of thousands, at which point it's a funded business problem).

### 4.5 Platform & stack [DECIDED]

- **Stack:** React Native host app + an in-house TypeScript SDK. One rendering pipeline, one toolchain, identical rendering across platforms, and the model writes TypeScript better than Swift/Kotlin.
- **First target:** one platform, built well, before touching the other. Android is the practical first target (no Mac/Xcode/provisioning friction, Android tolerates this category, easier sandbox story). Verify on the second platform every few weeks rather than every commit.
- **Versioning note:** "V1" here means *the first version being coded*, not the first public release. Public release (App Store / Play) is expected after V2 or V3.

### 4.6 Rendering model: WebView [DECIDED — revertible]

Architecture B (§4.3) has two sub-flavors for *how* SDK components actually paint pixels:

- **WebView** — the bundle renders to HTML/CSS inside a WebView; SDK components emit DOM. **← chosen.**
- **Native reconciler** — the bundle runs in an *isolated* JS engine, emits a tree of "render component X with props Y," that tree is serialized across a bridge, and the host instantiates real native RN views from it (marshalling touch events back). Genuinely more work: a serialization protocol, a cross-bridge reconciler/differ, event marshalling, plus VM isolation. (Note: this does *not* mean running the mini-app in the host's own RN runtime — that would share a JS context with the host and is a security non-starter.)

**Why WebView for the starting point:**
- Far less work; HTML/CSS is the most well-trodden render target and the one the model knows most deeply.
- Sandboxing is essentially free and battle-tested — the browser already isolates the JS context, so strip-globals-and-inject-SDK runs *inside* a hardened isolation boundary.
- Automatic Apple 4.7 alignment — it literally is WebKit/JavaScriptCore, exactly what 4.7.2 demands. The native reconciler, by definition "exposing native platform APIs to the software," would *raise* 4.7.2 risk, not lower it.
- Flexbox/grid layout engine for free; trivial hot-swap; remote DevTools debugging.

**Cost (acceptable for Tier 0):** "webby" feel — scroll momentum/rubber-band, tap-highlight, keyboard avoidance, gestures. Most is CSS-fixable (`-webkit-overflow-scrolling`, `touch-action`, system font stack, `safe-area-inset`, kill tap highlight & text-size-adjust); the rest (real native pickers, swipe-to-delete, drag-to-reorder) is bridged out or deferred. For Tier-0 utility apps a good WebView reads ~90% native; the gap only widens for scroll/gesture/animation-heavy apps in later tiers.

**Why it's cleanly revertible:** the SDK contract stays **backend-agnostic**. The agent never writes HTML — it writes against semantic components (`<Button radius="md">`, `<List>`, `<Card>`). Whether `<Button>` becomes a DOM `<button>` or a native `<Pressable>` is an implementation detail *inside the SDK runtime* that mini-apps never see. To go native later, you implement the same component contract as a reconciler and every existing mini-app keeps working unchanged. This is the "tokens not values, components not raw styles" discipline (§5.3) doing a second job: decoupling the render backend from everything above it.

### 4.7 Backend, transport, data residency, harness location [DECIDED]

- **Backend language: TypeScript** (runtime — Node/Bun/Deno — open; Bun is the leading novelty pick pending a maturity check). Chosen on *toolchain gravity*, not familiarity: the hardest part (static-check/transpile — tsc, ts-morph, ESLint, esbuild) is JS-native, and the backend shares one type system with the (TypeScript) SDK, making manifest types, capability defs, the allowed-symbol list, and validation literally shared code. The bottleneck is the LLM, not the backend language, so coordination work goes wherever the *checks* stay native. CPU-bound checks run in worker threads/subprocesses.
- **Transport: SSE streaming** for the generation channel (request → stream-back → done; no persistent WebSocket needed for v1), **thin REST or tRPC** for CRUD, **GraphQL rejected** (one client, ~3-table model, the hard problem is streaming). OpenRouter itself is HTTP+SSE, so the server↔model leg is also SSE, open only during an active generation.
- **Data residency: stateless server, device is system of record (Model 1).** Server persists only ~KB/user (anon device ID + token counter); all app content (source, bundle, manifest, data, version history) lives on the device; each edit re-sends source as context. Re-send is negligible at Tier-0 sizes; the real cost lever is LLM input tokens, addressed by prompt caching + diff-based edits. Upgrade paths: *Model 3* (ephemeral session-scoped source cache) when re-send/token cost bites; *Model 2* (server persists bundles in blob storage) only if sync/backup becomes a wanted feature. Consequence: version history is on-device, so Spike 4 runs **on-device git**.
- **Harness location: server-side, always.** Principle — *the phone owns what's user-owned and must stay stable (apps, data, version history, the runtime that executes a finished bundle); the server owns what's yours and changes constantly (harness, model access, checks, policy enforcement, telemetry).* The harness is volatile, multi-tenant infrastructure in front of a metered resource and is the source of the improvement-telemetry; all three properties demand it live where you can change, meter, and observe it. (Deepens §4.4. A phone-side harness — welding generator to generated, moving cost-enforcement onto the spender's device, and scattering telemetry — was considered and rejected.)

---

## 5. The SDK

### 5.1 Capability-based security: three layers

The mini-app's code can only do what it's handed a reference to. Everything sorts into three layers:

| Layer | What | Examples | Rule |
|---|---|---|---|
| **1 — Free** | The JS language itself; pure computation | `2+2`, control flow, functions/classes, `Array.map`, `JSON.parse`, `Math.random`, `Date`, regex, `async/await` syntax | Cannot be restricted, and there's no reason to. Lives in the mini-app's own heap. |
| **2 — SDK-gated** | Every effect on the outside world | Rendering UI, network, storage, timers, sensors, navigation, user input, permissions, anything that persists | Goes through the SDK. Total design & security control here. |
| **3 — Forbidden** | Escape hatches that defeat the sandbox | `eval`, `new Function`, raw `fetch`/`XHR`/`WebSocket`, DOM access, `localStorage`/`IndexedDB`, dynamic imports of non-SDK modules, workers | Physically stripped from the runtime before the bundle executes. Calling them throws. |

**The dividing principle:** *pure computation is free; side effects are gated.* This is the answer to "do I have to put arithmetic in the SDK" — no, and you couldn't. A decision spinner, a calculator, a unit converter are all Tier-0 apps precisely because their logic is Layer-1 free and only their UI is gated.

Enforcement of Layer 3 is done by the runtime, not by trusting the agent: before executing a bundle you create a fresh JS realm, strip the global object to an allowlist, inject the SDK as the only importable module, and run there. A stray `fetch(...)` throws `ReferenceError`, which the repair loop catches.

### 5.2 SDK surface sketch (first cut, ~60–80 named exports)

```typescript
// App definition — every mini-app has exactly one
import { defineApp } from 'vc-sdk';
export default defineApp({
  name: 'Habit Tracker',
  initial: 'Home',
  screens: { Home, AddHabit, Detail },
  capabilities: ['storage', 'notifications'],  // declared upfront
});

// UI primitives — the ONLY way to render
import {
  Screen, View, Stack, Row, Spacer, ScrollView, SafeArea,           // layout
  Text, Heading,                                                     // typography
  Button, IconButton, TextInput, TextArea, Toggle, Checkbox,         // inputs
  Slider, Picker, SegmentedControl, DatePicker, NumberInput,
  Card, List, ListItem, Image, Icon, Divider, Badge, ProgressBar,    // display
  Avatar, EmptyState, Skeleton,
  Modal, Sheet, Toast, Alert, Menu,                                  // overlay
} from 'vc-sdk/ui';

// Theme tokens — the ONLY accepted style values
//   Color:    primary secondary accent success warning danger neutral
//             text text-muted bg surface
//   Spacing:  none xs sm md lg xl 2xl
//   Radius:   none sm md lg full
//   TextSize: caption body subtitle title heading display
//   Weight:   regular medium bold
// Components accept tokens, never raw hex/px.  <Button radius="md" /> ✓   radius={17.3} ✗

import { useState, useEffect, useMemo, useCallback, useReducer } from 'vc-sdk/state';
import { useNavigation, useRoute } from 'vc-sdk/navigation';   // nav.push/back/replace
import { http } from 'vc-sdk/net';                              // get/post; routed through egress filter
import { storage } from 'vc-sdk/storage';                       // namespaced KV, schemaless JSON
import { delay, interval } from 'vc-sdk/effects';               // timers that the host can pause/cancel
import {
  location, motion, camera, notifications,
  share, clipboard, haptics, audio,
} from 'vc-sdk/capabilities';                                   // each requires manifest + consent
import { ai } from 'vc-sdk/ai';                                 // ai.complete(prompt,{schema}); ai.classify
```

### 5.3 The UI line: tokens, not values [DECIDED]

Components accept semantic tokens only — no raw hex, no raw pixel values, no arbitrary `style` props. If the SDK has no token for what's wanted, that's a feature request (add one semantic token like `radius="pill"`), not a workaround. This is how SwiftUI / Material 3 / Radix Themes work; the constraints are the point. They keep generated apps looking like a coherent family, keep dark mode sane, and slash the agent's degrees of freedom.

Escape hatch for genuinely free-form visuals (game boards, calendar grids): a `<Canvas />` primitive taking a draw function over a constrained 2D context. Arbitrary visuals become possible without polluting the rest of the design system. (Canvas is a later tier.)

### 5.4 The manifest as a contract

The `capabilities: [...]` line does quadruple duty:
1. The install-time disclosure shown to the user ("this app wants to: send notifications, save data").
2. The Apple 4.7.4 manifest of what each mini-app does.
3. A runtime enforcement boundary — a capability not in the manifest returns a stub that throws; mini-apps cannot acquire capabilities at runtime, only declare them up front.
4. A generation-time signal — the agent declares capabilities from the prompt, and the host validates them against the allowed set before even running the code.

### 5.5 Subtle decisions captured

- **Promises are free; `setTimeout` is not.** The agent must use `await delay(ms)` / `interval`. Keep all prompt examples consistent so the agent's pattern-matching lands there.
- **`useEffect` cleanup discipline.** SDK `useEffect` should warn when subscriptions are created without a returned cleanup. Better: make `interval.start` / `motion.subscribe` require a scope that auto-cleans on unmount.

### 5.6 The capability bridge: a syscall boundary [DECIDED — the core porting abstraction]

This is the systematized "porting gate" — the standard, append-only way native-backed capabilities get added, so capability #15 costs the same as capability #2. The governing mental model: **the WebView is a sandboxed process, and the bridge is its syscall interface.**

**Transport (written once, never touched again).** A WebView talks to the host through one narrow channel: web→host via `window.ReactNativeWebView.postMessage(string)` received by the host's `onMessage`; host→web by posting/injecting a string the web side hears on a `message` event. String-only (so JSON), asynchronous, one pipe each way.

**The process-model mapping (the analogy is exact):**
- Pure computation (arithmetic, loops, building data) = **userspace**. No bridge — a process doesn't trap into the kernel to add two numbers.
- Touching the outside world (persist, vibrate, network) = a **syscall**: post a message to the host.
- The host holds a **syscall table** — a registry mapping a method name (`storage.get`, `haptics.tap`) to a handler. A **dispatcher** reads `{id, method, params}`, looks up the handler, runs it, posts back `{id, result}` or `{id, error}`. The `id` correlates request↔response so the web side models each call as a Promise.
- Before dispatch, **the gate** runs: is this method registered? is its capability in the mini-app's manifest? has the user granted the permission? This is `seccomp` + `capabilities(7)`; the manifest is the process's declared capability set.

**The layering, bottom to top:** transport (postMessage, once) → RPC dispatcher (id/method/params, once) → capability registry + gate (the syscall table, **append-only**) → SDK facade (typed client stubs the agent imports). The mini-app only ever sees the top layer — it imports `storage`, never `call('storage.get')`, never `postMessage`. So the whole bridge underneath is swappable, which is what preserves the revert-to-native-reconciler option (§4.6): the syscall contract — method names + param/result schemas — stays identical; only each handler's implementation changes.

**Why this bounds the cost of every future capability:** adding one = **one row in the syscall table + one thin client stub**, both template-shaped, never touching transport or dispatcher. If adding a feature ever requires modifying the transport, that's the smell that the abstraction has leaked.

**Theory framing (for the why):** this is an *effect interpreter*. The mini-app emits effects as data (messages); the host is the sole interpreter of those effects. Pure code needs no interpreter; effects are reified at the boundary and run by the host. The capability registry is the interpreter's handler map.

**The reframe that shrinks the work: rendering does NOT cross the bridge.** UI is just DOM inside the WebView. So Layer 2 (SDK-gated effects, §5.1) splits in two:
- **Web-resident gated things** — rendering, navigation (just swapping which screen renders), in-memory state, even timers (`delay`/`interval` = wrapped `setTimeout`, web-side; host only needed to cancel on unmount). **No bridge.** This is the bulk of the SDK.
- **Native-backed gated things** — storage (persists past the WebView), haptics, audio, notifications, sensors, network. **These, and only these, are the syscalls.** A short, append-only list.
- **Storage is schemaless and forgiving.** JSON soup with sane defaults. This is what prevents data loss on regeneration. No SQL exposed.
- **`ai.complete` is the secret weapon.** Most personal apps people actually want involve a little natural-language work. Baking AI in makes mini-apps feel magical with no key-wiring.
- **No arbitrary URL access on day one.** Start with curated integrations / an allowlist; liberalize later. The reverse (locking down what was open) is much harder.

---

## 6. Capability tiers (= SDK evolution roadmap)

Each tier is "ship this capability, this whole class of apps becomes possible." Apps are never added individually; they're sampled from whatever tier the SDK has reached.

| Tier | Unlocks | Example apps | Notes |
|---|---|---|---|
| **0 — UI + local storage** | The base. ~60–80 SDK exports, schemaless KV, zero network/permissions. | Trackers (calories, water, pushups, spending, mood, habits), to-do lists, notes, checklists, counters, countdowns/days-since, custom calculators, unit converters, reference cards, journals, flashcards, watchlists, **decision spinners** (free via `Math.random`), random pickers. | ~60% of what people actually want. Most reliable & safest. **This is V1.** |
| **1 — AI** | `ai.complete` with an agent-written system prompt. | Journal that summarizes the week, mood tracker that reflects patterns, "what can I cook with X", flashcard generator from notes, language buddy, workout log that interprets free text. | The differentiator. V1-of-AI = model + custom system prompt only. MCP / tools / custom-tool-creation is a far later tier; resist it. |
| **2 — Notifications + timers** | Local notifications, scheduling. | Reminders, custom timers, Pomodoro, recurring nudges, plant-watering pings. | First tier that crosses into system territory; harder than it looks (Doze, background limits). |
| **3 — HTTP** | Network. See §7 for the asterisks. | Weather, currency/crypto/stock tickers, sports scores, public-API apps. | Split into 3a curated integrations and 3b raw HTTP. |
| **4 — Sensors / camera** | Motion, location, camera, mic. | Step counters, shake-to-X, compass, receipt logger, photo journals. | Permission-gated; Apple 4.7.2 relevant; niche enough to defer. |
| **5 — Games** | `Canvas` + tight render loop. | Snake, 2048, tic-tac-toe, memory match, idle clickers. | Demo-friendly, not load-bearing. Late. |

**Guiding scope principle:** anything that doesn't need heavy server infrastructure or insane graphics should be vibe-codeable on the phone without reaching for Claude Code. "Average" complexity apps already generate consistently.

---

## 7. HTTP design (the asterisks)

Two very different things get called "HTTP," and the curated one comes first:

- **Curated integrations (Tier 3a).** Specific useful APIs wrapped as first-class SDK capabilities with known response shapes. The agent calls `sdk.weather.current()` and gets a typed object — never sees a URL, never guesses a schema, never handles auth. Reliable and safe. (Nothing did exactly this: weather as a system capability, not raw HTTP.)
- **Raw HTTP (Tier 3b, much later, behind warnings).** The agent builds arbitrary requests to arbitrary endpoints. The killer problem is not security first — it's that **the agent doesn't know the API contract.** "Make me a weather app" → which API, what response shape, what auth? It guesses, guesses wrong, and now someone is debugging a network integration on a phone, the exact thing nobody wants. Plus: where the API key lives, downtime, rate limits.

**Sharing detonates raw HTTP.** A shared app calling `evil.com` means Whim is distributing something that phones home. Rule once sharing exists: shared apps use curated integrations freely; any raw outbound request must disclose every domain it contacts before install, with a hard allowlist likely. This is a Tier-3b-meets-sharing problem, years away.

---

## 8. The agent loop & self-healing

### 8.1 The loop

**plan → generate → static check → run → observe → repair**, with a hard cap (~3) on repair attempts before surfacing to the user.

1. **Plan.** Agent emits a short structured plan first (screens, state, capabilities, storage keys) as 1–2 paragraphs + a JSON skeleton. Cheap to validate ("asked for reminders, plan has no `notifications` capability → reject & retry") and produces better code than prompt-to-file in one shot.
2. **Generate.** Write the full bundle, streamed to the user so something is visibly happening.
3. **Static check** (before running anything): does it parse (TS compiler)? does it import only from `vc-sdk/*`? any forbidden globals (AST walk)? do declared capabilities match used ones, both directions? do all referenced screens / `nav.push` targets resolve? SDK-specific lint rules.
4. **Run.** Boot the bundle in the sandbox against a synthetic event stream (mount initial screen, simulate a tap on each interactive element, navigate to each screen). Non-user-perceptible smoke test.
5. **Observe.** Collect everything: thrown errors, unhandled rejections, SDK warnings, capability denials, off-allowlist network attempts.
6. **Repair.** Feed original code + structured diagnostics back; ask for a minimal diff. Cap at ~3. On exhaustion, surface honestly: "couldn't get this working — rephrase, or see what I tried?"

**The thing that makes a harness good is the quality of diagnostics fed back, not the model.** Every diagnostic is structured and carries a fix hint shaped like the right SDK answer, e.g. `{ kind: 'forbidden_global', symbol: 'fetch', line: 47, hint: 'Use http.get from vc-sdk/net instead' }`.

### 8.2 Warning discipline [DECIDED]

The human habit of "100 warnings is fine in dev" must not apply, because the agent has none of the private context a human uses to triage warnings — every warning in context is taken as a thing to fix, costing tokens/time. Therefore:

- **Zero-warning steady state.** Working generated code produces no warnings. Warning *definitions* live in the harness and are global to all apps and all users. During harness development you observe warnings across many apps; if a warning class proves useless (fires routinely on working code, never points at a real bug), you remove it *from the harness* so it stops firing for everyone. There is no per-app or per-user "ignore this warning" mechanism — that would reintroduce exactly the human-triage drift this is meant to avoid.
- **Warnings are pre-errors.** Each must describe a state that becomes a bug under some plausible input. "Unused variable" is not a warning here; "useEffect subscribing to motion with no cleanup" is.
- **Severity is shown to the agent, but nothing gets a pass.** The error/warning distinction is surfaced because it's useful debugging signal — fix the error crashing the boot before the warning about a leaky effect; severity *orders* the work. But because of the zero-warning steady state, everything must be resolved before the bundle ships. Severity prioritizes; it never excuses. (Severity also matters to *you* for what blocks deployment.)
- **Every diagnostic carries a fix hint.** If you can't articulate the fix, the agent probably can't either.

### 8.3 What to borrow from big harnesses

Claude Code / Cursor / Aider all converge on propose → execute → observe → iterate. Whim is dramatically simpler in three exploitable ways: single bundle (no filesystem to navigate), closed-world API (every import verifiable against ~80 symbols), and full control of the runtime (make diagnostics excellent). The one thing worth copying: **sub-tasking via the planning step** — for anything beyond a tiny tweak, break work into pieces, do one at a time, check after each, to avoid the "rewrote 400 lines, nothing works" failure.

---

## 9. Agent memory & learning

The principle that bounds all of this: **state that helps the agent must be either (a) part of the SDK, which you control, or (b) scoped to one mini-app, which the user controls. Nothing in between.** And: **learned state must be legible and editable** — if you can't show the user in plain English what the agent "knows" and let them edit/delete it, the system drifts in ways neither of you can reason about.

- **Per-app `LEARNED.md` (good).** App-specific facts not in the SDK docs: "the user's endpoint is X, auth token under storage key `apiToken`", "prefers metric", "'archive' means soft-delete via `archived:true`". Loaded when the user returns to that app weeks later. Viewable in the app's settings, user-editable.
- **Agent inventing global rules (bad — don't).** "I learned we use camelCase storage keys everywhere." Emergent un-audited style guide that drifts across users. The SDK docs are the rules. If the agent keeps re-writing the same helper, that's a signal to add it to the SDK, not to let the agent grow its own utility library.
- **User profile (the right adaptation surface).** A short, user-editable text blob (a few hundred words max) read on every generation: "prefers minimal layouts, no emojis in UI copy, metric, dark theme default." The agent may *suggest* additions ("you've mentioned no animations twice — add to your profile?") but never edits silently.
- **Examples library.** When a user marks an app "I love this," it joins a small in-context example set for future generations. The most powerful adaptation because it's grounded in concrete artifacts, not vibes.

**Where to stop:** the point where the user can no longer predict what a fresh prompt will produce. If "make me a timer app" varies wildly based on last month's builds and the user can't see why, adaptation has gone too far. No embedding-based behavioral inference, no silent personality drift, no background fine-tuning.

**Three buckets of "preference," handled differently:** host-app prefs → explicit settings (not learned); mini-app look/feel → user-editable profile; patterns in what they build → used lightly, never as silent generation bias.

---

## 10. Authoring UX

- **On-device and voice-first [DECIDED].** The whole point is making an app on your phone, from your phone. Speech-to-text is the recommended input. Built-in STT is desired but the full voice harness is not required for V1 (an external dictation tool suffices to start).
- **Two-stage prompt [DECIDED, build early-ish].** Voice in → transcribed → a small/cheap model rewrites it into a detailed, specific prompt → a **preview screen** shows that detailed prompt → the user reviews/edits → the engineer model receives it. Turns "make this button bigger" into "increase this specific button on this screen from 10pt to 12pt," and turns "make it shareable" into a detailed spec the user can sanity-check and discover implications in before committing. This is how tedious prompts get written *for* the user from their casual words. Pairs naturally with versioning: each snapshot is tagged with the structured prompt that produced it.
- **Launcher & navigation [DECIDED, prototype the button early].** Home is an app grid (like a phone home screen) with a `+` button → prompt screen. Mini-apps launch full-screen. A single floating "back to host" affordance (à la the Next.js dev button, bottom corner) overlays the running app; tapping it pops a menu (back to menu / start prompting) over the app view. **Open risk:** the floating button can overlap a generated layout's important UI. Needs either a guaranteed-safe zone (impossible with free generated layouts) or a dismiss-and-recall gesture. Prototype early; it's load-bearing.
- **Background "daemons"** (apps that run in the background) are wanted eventually but hit hard system constraints. Explicitly later.

### 10.1 Control modes [PLANNED — not V1, but fairly early]

Two (or more) "human-control" modes, letting users choose how much they steer:

- **Full vibe mode** — takes the user's instruction, asks for minimal clarification at most, and proceeds. For users who just want to talk and get an app.
- **Controlled mode** — a small agent first judges whether the prompt needs elaboration; if so, it builds a more detailed prompt (or a plan) and surfaces it to the user for review/edit before the engineer model runs. For users who want more control over what gets built.

This generalizes the two-stage prompt (§10) into a selectable spectrum rather than a fixed pipeline. Lets control-seekers steer and lets everyone else fully vibe.

**[OPEN]** What exactly the controlled-mode preview shows. Likely two distinct surfaces: the user reviews **intent** in their own terms ("a slightly bigger button on the settings screen that exports my data"), while the **SDK-specific detail** the engineer model consumes stays internal — the user should probably never see SDK internals. Not to be resolved now.

---

## 11. Versioning & rollback [DECIDED]

Every generation is a snapshot. Undo goes back one step. Users can pin "this version works, don't lose it." Rollback is a first-class, prominent action — in vibe coding the practice is aggressive (try it, if it doesn't work trash it and roll back), and rollbacks happen roughly an order of magnitude more often than in normal coding. Each snapshot is tagged with the structured prompt that produced it (see §10).

## 12. Offline [DECIDED]

No code generation while offline. All already-generated mini-apps keep working — they're just a bundle plus local storage. In V1 (no network capability) this is trivial.

## 13. Models & cost

- **Generation runs server-side** (settled, §4.4).
- **V1 model:** leaning DeepSeek (strong price/quality, and a chance to try it in agentic coding). **[OPEN — verify against the eval corpus.]** Caveat to test early: cheap/smart models often fall down on structured-output and tool-use reliability, and the whole loop depends on reliably-well-formed code that imports only the SDK. If DeepSeek can't do that consistently, the price/quality math changes.
- **Prompt-rewrite model** (the §10 stage): a separate small/fast/cheap model, not the full coder. **[OPEN.]**
- **One model for V1, not user-selectable [DECIDED for V1].** The system prompt, SDK reference, few-shot examples, and repair loop get tuned to one model's quirks. Multi-model support degrades those tunings or multiplies the work; add it when eval data justifies it. Advertise the single choice as deliberate.
- **No bring-your-own-keys in V1 [DECIDED].** Own key in env for dev; self-billed. If it ever becomes a business, reselling tokens is the likely model (a per-user token counter exists from the start regardless). Business model otherwise **[OPEN / deferred]**.

## 14. North-star demo: the AI alarm

The origin idea — an alarm that reads your Google Calendar and generates a spoken wake-up ("five hours of exam prep today, rise and shine") — is the motivating story and also one of the *hardest* apps on the roadmap. It needs alarms (background/system execution), calendar read (a permission), and AI. Alarms are the hard part: neither platform reliably runs arbitrary code (let alone an AI call) at alarm time in the background (iOS effectively forbids it; Android fights it via Doze). **Realistic implementation:** pre-generate the wake-up text the night before and attach it to a scheduled local notification — the "alarm" is a rich pre-baked notification. This makes the alarm a Tier-2+ app and a *north-star demo the tiers build toward*, not an early deliverable. (Motivating examples usually aren't the first thing you ship.)

---

## 15. Development methodology & phasing

### 15.1 Two decoupling principles

1. **Separate the runtime track from the harness track.** You cannot generate against an SDK that doesn't exist and isn't proven, so the LLM is *not* in the first commits. Hand-write mini-app bundles as stand-ins for the agent's eventual output and use them to build and prove the runtime + SDK. Point the harness at the SDK only once the runtime reliably runs hand-written bundles. This lets you debug the rendering/bridge contract with code you control, not code a model is improvising.
2. **The bridge is its own milestone, and storage is its first customer.** This is where v0.1 gets cut: prove the most foundational thing first — *can an SDK-targeting bundle render and run in the WebView* — with an app that makes zero syscalls. No bridge, no storage, no effects, no server, no LLM.

### 15.2 The v0.1 → harness ladder

| Milestone | Ships | Proves |
|---|---|---|
| **v0.1** | WebView shell; a thin slice of SDK UI (`Screen`, `Stack`, `Text`, `Heading`, `NumberInput`, `Slider`/`SegmentedControl`, `Button`) + theme tokens; `useState` for in-memory state; the bundle-execution mechanism (fresh context, globals stripped, SDK injected). One hand-written app: **tip splitter**. | Rendering + the component contract. |
| **v0.2** | Transport + dispatcher + capability registry + gate (§5.6), with **storage as syscall #1**. Exactly one capability, so the machinery is the focus, not breadth. | The bridge architecture. Trackers become real apps. |
| **v0.3** | `delay`/`interval` (web-side, with the unmount-cleanup lifecycle), then **haptics/audio as syscalls #2 and #3**. | Effects + a second/third capability following the append-only template. Pour-over timer comes alive. |
| **then** | Wire the server + harness; point the model at the now-proven SDK; build the plan→check→run→repair loop (§8). | The actual product loop, against a stable target. |

### 15.3 Candidate starter apps, split along the bridge boundary

Five candidates serve as the first implementation fixtures and corpus seeds (the full ~20-app list and per-app capability detail are still to be built — these are starting points, not the final corpus):

- **Tip splitter** — complete at **v0.1**; pure Layer-1 compute + rendering, zero syscalls. (Persisting a default tip is an optional v0.2 nicety.)
- **Decision spinner** — **v0.1** if the option list is hardcoded (random pick is pure Layer 1); becomes "real" at **v0.2** when the list is editable + persisted. (A spinning-wheel *animation* needs `Canvas`, later — a clean tier boundary.)
- **Water counter** & **habit tracker** — **v0.1** shells (in-memory, reset on close) are useful runtime test fixtures; genuine apps at **v0.2** with storage.
- **Pour-over timer** — **v0.3**; needs effects, and its beep/buzz crosses into the haptics/audio capabilities (a good "logic is Tier 0 but the cue is gated" boundary example).

### 15.4 MVP scope (what V1 is)

- SDK at **Tier 0** (UI + local storage), sized to support a concrete target list of ~20 apps (see §18).
- The agent loop with plan → static checks → synthetic run → repair, hand-tuned prompt, no agent learning yet.
- Structured diagnostics with fix hints + an eval corpus re-run on every prompt/SDK change.
- **Android only. Personal use only. No sharing. No billing. No network. No sensors.** One model. Hand-curated examples library. Anonymous device identity (see §18).
- On-device prompting; voice recommended (external STT acceptable); two-stage prompt + preview screen ideally in the first batch after the core loop works.

Phases beyond V1 = adding tiers (§6) and resolving deferred questions, roughly in dependency order: AI → notifications/timers → curated HTTP → sensors → games, with sharing as a parallel track that gates network features.

---

## 16. Testing methodology

### 16.1 Two test surfaces — never let them blur

The single biggest testing risk is conflating these:

- **Surface 1 — Whim's own code** (WebView shell, SDK runtime, bridge, harness server). Normal deterministic software: same input, same output, real assertions.
- **Surface 2 — the harness's *output*** (the mini-apps the LLM generates). Non-deterministic; you cannot `assertEquals` against "did the model build a good tip splitter." This is the **eval corpus** and needs a different methodology (§16.3).

Both need testing, differently. Most of Whim's *code* is Surface 1; most of the "design the checks" thinking from current AI-coding practice is about Surface 2.

### 16.2 Surface 1: TDD where it earns its place, test-after where it doesn't

TDD is not all-or-nothing; the project splits cleanly:

- **TDD the bridge and the sandbox.** Pure-logic, contract-driven, unambiguous right answers (this message routes to that handler; an unmanifested capability throws; `fetch`/`eval` do not exist in the executed context). Write the assertion first — you already know what "correct" means.
- **Sandbox tests are invariants, not feature tests.** Security properties that must *never* regress. Treat them as a separate, sacred suite that blocks everything else if it goes red. **The most important assertion in the whole codebase: a mini-app bundle cannot reach the network (or any native capability) except through the SDK.** Write it early; never let it go red.
- **Test-after the UI.** SDK components, layout, launcher, prompt screen — exploratory; the right answer emerges as you build. Writing tests first just calcifies undecided choices. Build, then pin behavior with tests once settled.
- **The SDK freeze is what makes Surface-1 tests stable.** A test against `<Button radius="md">` rendering, or `storage.get` round-tripping the bridge, stays valid as long as the contract holds. Freeze the contract first; unstable code is miserable to test.

### 16.3 Surface 2: the eval corpus, three tiers (cheapest/most-mechanical first)

- **Tier A — deterministic gate.** Does the generated bundle parse, import only from the SDK, declare capabilities consistent with use, and boot without throwing under the synthetic event stream? This *is* the static-check loop (§8.1) doubling as a hard gate.
- **Tier B — behavioral.** Drive the app through synthetic taps and assert outputs (tip splitter: 100 at 20% split 4 ways → 30 each). Per-app, written **in English first** ("a working tip splitter must: compute tip correctly, handle party size of 1, not crash on empty input"), then encode what's encodable.
- **Tier C — subjective quality.** Does it look good, is the UX sane? No escape from human eyeballing or **LLM-as-judge against an English rubric**. This is where "unit tests for English" is literal.

### 16.4 The reward-hacking trap [important]

Any test the implementing agent can see while it works, it can satisfy *without solving the real problem*. This bites both surfaces. Defenses:
- **Security invariants are authored by you (or a dedicated review agent), never by the agent implementing the feature being secured.**
- **Hold out a portion of eval prompts.** Tune the SDK/prompt against the visible set; validate against a held-out set the agent never saw. Divergence between the two = overfitting caught.

### 16.5 The workflow: extend OpenSpec with an English test-spec phase

Already using and liking OpenSpec (spec-driven) — don't replace it, add one phase:

> spec the feature in English → **spec the tests in English** (a checklist of what must be true, including the invariants, written *while the feature is fresh*) → implement → write the actual tests from the test-spec.

The test-spec phase is the antidote to the real fear — *forgetting to test an interconnected feature*. Forgetting happens because tests get written last, after the context of what-could-break is lost. Capturing the test-spec right after the feature-spec pins it at peak clarity, with implementation bracketed between two English artifacts.

Two cheap additions (from current long-running-agent practice) that fit a solo, multi-session, fresh-context workflow:
- **A failing-requirements checklist** — every feature starts marked *failing*, flips to *passing*. An at-a-glance "what actually works" dashboard; worth its weight for an interconnected project.
- **A decisions log (ADR-style)** — the WebView call, the syscall-bridge model, the SDK freeze, etc., so a fresh agent session (or future-you) doesn't relitigate settled architecture.

### 16.6 The recursion worth noticing

Harness-first methodology (invest in automated checks that verify correctness in seconds; capture taste once as mechanical rules; keep memory in versioned artifacts, not chat) *is* the mini-app generation loop being designed as the product (§8). The dev harness and Whim's harness are the same idea at two scales — so apply harness-first to the development of Whim itself, not just to what Whim produces.

---

## 17. Open questions

### Resolved
- Who is it for → portfolio project; end-audience inferred later; thesis = long tail of personal apps. (§2)
- Sharing in V1? → No, on the radar for later. (§15)
- Authoring web vs on-device → on-device, voice-first. (§10)
- iOS vs Android V1 → Android first, for practical + sandbox reasons. (§4.5)
- What an "app" is → full-screen, app-grid launcher, floating back button. (§10)
- Server as middleman → yes, the harness lives there. (§4.4)
- Stack → React Native + in-house TS SDK. (§4.5)
- Rendering model → **WebView**, with a backend-agnostic SDK contract so it's revertible to a native reconciler later. (§4.6)
- How native capabilities get added → **syscall-style bridge** with an append-only capability registry; rendering doesn't cross the bridge. (§5.6)
- Testing approach → two surfaces; TDD the bridge/sandbox as invariants, test-after the UI, three-tier eval corpus with held-out prompts, an English test-spec phase bolted onto OpenSpec. (§16)
- First commits → runtime track before harness track; v0.1 = WebView + thin UI slice + tip splitter, no bridge/LLM. (§15)
- Backend language → **TypeScript** (runtime Node/Bun/Deno still open), on toolchain-gravity + SDK type-sharing. (§4.7)
- Transport → **SSE streaming** for generation, thin REST/tRPC for CRUD, GraphQL rejected. (§4.7)
- Data residency → **stateless server, device is system of record (Model 1)**; Models 2/3 as upgrade paths; flips Spike 4 to on-device git. (§4.7)
- Harness location → **server-side**, per the phone-owns-stable / server-owns-volatile principle. (§4.7)

### Still open
- **[OPEN]** Which single model for V1 (DeepSeek is the bet — validate on eval corpus).
- **[OPEN]** Which small model for the prompt-rewrite stage.
- **[OPEN]** Floating back-button overlap handling (prototype early).
- **[OPEN]** Empty-state / first-run: what the launcher shows before any app exists. Likely seed with 1–2 pre-made example apps to run / fork / delete. Decide deliberately — it's the first impression.
- **[OPEN]** Auth — needs *some* identity from day one (even anonymous device ID), or per-user rate limits, persistent versioning across reinstalls, and a clean migration to real accounts later all break. Minimal is fine; it just has to exist. (See §18.)
- **[OPEN]** Backend runtime — Node vs Bun vs Deno (language is TypeScript regardless, §4.7). Bun leads as the novelty pick; verify production maturity for streaming workloads.
- **[OPEN / deferred]** Business model beyond "self-billed for now."

### Premature (noted, not now)
- Component-level visual editing (drag to resize) — maybe V3.
- Cross-app communication (mini-app A reading mini-app B's data) — likely never, definitely not V1.
- App-store-style discovery — this is the sharing question wearing a hat.
- Multimodal prompting ("here's a screenshot, make something like it") — cheap on the model side (models are multimodal) but carries real UX/onboarding cost; introduce once the core loop is excellent, as a wow feature.
- Built-in voice harness — recommended from the start, but the full in-app STT pipeline isn't needed for V1.

---

## 18. First concrete actions (before more architecture)

1. **One-page concept doc** (non-technical): who it's for, what an app looks like, the first thing a user does, the first app they build, why they're delighted. Forces the §16 decisions to actually get made.
2. **List 20 mini-apps you want to exist** — concrete ones ("tracks my pull-ups, shows weekly count", "grocery list auto-categorized by aisle via AI", "pour-over timer with my exact recipe"). Doubles as the seed of the eval corpus.
3. **Break each of the 20 down onto the SDK surface (§5.2).** Wherever an app needs something the SDK lacks, write it down — that list is your SDK gap analysis. Small gap → SDK is roughly right. Big gap → another pass.

Then the MVP scope writes itself, and later phases fall out of which deferred question you pick up next.

**The unsexy thing to underline:** the eval corpus is the single biggest determinant of whether the product feels good or janky. When you change the system prompt or the SDK, you need to *know* whether you made it better or worse. 20–50 representative prompts re-run on every change, with the outputs actually looked at, is how you avoid vibes-driven development hell.
