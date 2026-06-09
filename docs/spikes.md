# Whim — Spikes / De-risking Plan

*The architecture is sketched; these are the throwaway experiments that confirm or kill its risky assumptions before real code is committed. Each spike is self-contained and spec-ready: hand it to an agent, supervise, record the lesson, delete the code.*

## How to read each spike

Every entry has the same shape:

- **Unknown** — the one question the spike answers.
- **Blocks** — the decision or milestone that can't be finalized until it's answered.
- **Moving parts** — the variables in play.
- **Options** — the candidate approaches (H1/H2/…), each with a one-line trade-off.
- **Leading hypothesis** — the default we expect to hold, so the spike has something concrete to confirm or refute.
- **Build** — the minimal, throwaway thing to make (scoped to the unknown, not the real foundation).
- **Accept** — concrete criteria under which the leading hypothesis stands.
- **Reject / red flags** — what would force a different option.
- **Watch for** — known gotchas to probe deliberately.
- **Artifact** — the knowledge to write into `DEVLOG.md` (the code gets thrown away; this doesn't).

**Rule for all of them:** the deliverable is the *lesson*, not the code. The discipline is **scope and disposability** — build only what answers the unknown, and delete the code once the lesson is recorded (a spike scaffold is never the real foundation; rebuild that properly). Note this is *not* the human "build it ugly, stop the moment it looks polished" maxim: that caps a person's quality-vs-time tradeoff, which an agent mostly doesn't have. Clean-enough, debuggable code costs an agent almost no extra time and makes the finding trustworthy, whereas deliberately scrappy code can *cost* time and obscure the result by failing in avoidable ways — a spike told to be ugly may take *longer*, because ugly code is likelier not to work first try. So keep it clean enough to trust the result; just don't invest in reusability, breadth, or polish the throwaway doesn't need.

---

# Tier 1 — Blocks v0.1 (do these first)

## Spike 1 — The sandbox runtime

**Unknown:** Can an untrusted JS bundle run inside the RN WebView in a contained context where the forbidden globals are gone and a controlled SDK is the only capability surface, while still rendering UI?

**Blocks:** All of v0.1. This is the single most foundational experiment. If it has no clean answer, the whole WebView architecture is in question.

**Moving parts:**
- *Isolation primitive* — what actually contains the code.
- *Global stripping* — how `fetch`, `XMLHttpRequest`, `WebSocket`, `eval`, `Function`, `localStorage`, `indexedDB`, `import()`, `Worker`, and `window.parent` become unavailable or inert.
- *SDK injection* — how the contained code gets exactly one reachable capability surface and nothing else.
- *Rendering path* — how the contained code paints to the screen.

**Options (isolation):**
- **H1 — Sandboxed `<iframe>` inside the WebView's HTML** (`sandbox="allow-scripts"`, no `allow-same-origin`). Bundle runs in the iframe, renders to the iframe's DOM, talks to the host via `postMessage`. *Trade-off:* simplest, native browser isolation, React-to-DOM works directly; but iframe isolation must be probed for escapes (`window.parent`, prototype reach).
- **H2 — SES / `lockdown()` (hardened JS compartments)** in the main document. *Trade-off:* very strong language-level containment and fine-grained endowments; but a real learning curve and some perf/ergonomic cost.
- **H3 — QuickJS compiled to WASM** as a true separate VM. *Trade-off:* maximum isolation (separate heap, no ambient DOM); but no DOM means React can't render directly — you'd need a custom renderer that posts a tree out, which is really the native-reconciler path in disguise. Heavier, larger bundle, serialization boundary.

**Options (rendering, coupled to the above):**
- **R1 — React-to-DOM inside the sandbox** (pairs with H1/H2). The SDK is a React component library; `react-dom` renders into the contained document.
- **R2 — Custom renderer posting a tree out** (forced by H3). Overlaps with the future native-reconciler; out of scope for v0.1 unless H1/H2 both fail.

**Leading hypothesis:** **H1 + R1.** A sandboxed iframe with scripts-but-not-same-origin, globals stripped by deleting/neutralizing them on the iframe's `window` before the bundle loads, SDK injected as the one module the bundle can import, React rendering to the iframe DOM. SES (H2) is the hardening fallback if iframe isolation proves leaky.

**Build:** A bare RN screen with one `react-native-webview`. Inside it, an HTML page that creates a sandboxed iframe, neutralizes the forbidden globals on the iframe, injects a fake one-function SDK (`{ Button }`), and loads a ~20-line hand-written bundle that renders a button and posts a message to the host on tap.

**Accept (leading hypothesis stands if all hold):**
- A bundle calling `fetch(...)`, `eval(...)`, `localStorage`, `new Function(...)`, `new WebSocket(...)` each throws or is provably inert — verified by a checklist of probe lines.
- A bundle importing the fake SDK renders the button, and the tap round-trips to the RN host.
- Mount-to-first-paint is fast enough to feel instant for a trivial app (eyeball; set a rough ceiling like <150 ms).
- No obvious escape: probing `window.parent`, `top`, and prototype-chain reach does **not** yield host or native access.

**Reject / red flags:** iframe can reach the host context; globals can't be reliably removed (some are non-configurable in the WebView's engine); React won't mount in the sandbox; perf is visibly janky. Any of these → fall back to H2 (SES), and only if that also fails, reconsider H3.

**Watch for:** non-configurable global properties (need shadowing in a function scope rather than `delete`); prototype pollution as an escape vector; `react-native-webview` quirks vs a desktop browser; whether stripping breaks React itself (it may expect some globals — strip the *dangerous* set, not everything).

**Artifact:** which isolation primitive won, the exact forbidden-globals neutralization technique that worked, the escape vectors probed, and the rough perf number.

---

## Spike 2 — The bundle / module contract

**Unknown:** What exactly does the agent emit, and how does the runtime turn that text into a running app?

**Blocks:** v0.1 (the runtime has to load *something*), the static-check step (you check the thing the agent emits), and the SDK-as-docs format.

**Moving parts:**
- *Artifact shape* — one file with `export default defineApp(...)`? multiple files? code + a separate JSON manifest?
- *Module resolution* — ESM `import {...} from 'vc-sdk'` resolved by an import map? a server bundling step? or no imports at all, SDK as an injected global (`Whim.Button`)?
- *Transpilation* — does the agent emit TS (needs compiling) or plain JS? where does TS→JS happen (server, or never)?
- *Delivery* — how the final JS reaches the contained context from Spike 1.

**Options:**
- **H1 — Agent emits one TS file using `import … from 'vc-sdk'`; server transpiles + bundles (esbuild) to one JS string; runtime injects it with `vc-sdk` pre-resolved.** *Trade-off:* most ergonomic for the model and best static-checking; but adds a server build step (latency vs the streaming/iteration feel).
- **H2 — Agent emits plain JS against injected globals, no imports, no build step.** *Trade-off:* least infrastructure, lowest latency; slightly less natural for the model and weaker type ergonomics, but very promptable.
- **H3 — ESM + import map, browser-native resolution inside the iframe, no server bundler.** *Trade-off:* no build server; but RN-WebView ESM/import-map support is the variable to verify.

**Leading hypothesis:** **H1.** esbuild is fast enough that the transpile/bundle step is negligible next to model latency, and the ergonomic + type-checking win for the agent is large. H2 is the fallback if build latency or complexity bites.

**Build:** Take the hand-written bundle from Spike 1. Run it through each path: (a) esbuild transpile+bundle on a tiny local server, inject the output; (b) rewrite it as globals-only plain JS, inject directly. Measure both round-trips and compare loading reliability.

**Accept:** the round-trip (source text → running, rendering app) works for the chosen path; transpile+bundle latency is a small fraction of expected model latency (rough ceiling: <300 ms for a small app); the format is something a model can plausibly emit consistently (sanity-check by hand now; full verification is Spike 7).

**Reject / red flags:** build latency noticeably hurts the iteration feel → H2. Import maps unsupported/flaky in `react-native-webview` → drop H3.

**Watch for:** TS in the browser is a non-starter without transpilation (so either server-side TS→JS, or agent emits JS); bundling source-map needs for the static checker to report line numbers; keeping the *injection* mechanism identical to whatever Spike 1 settled on.

**Artifact:** the chosen emit format (with a one-line example), where transpilation happens, the measured latency, and the exact module-resolution mechanism.

---

# Tier 2 — Blocks finalizing the runtime + harness architecture

## Spike 3 — Synthetic event stream (app introspection for the smoke test)

**Unknown:** How does the harness drive an *arbitrary* generated app through a smoke test without knowing its structure — specifically, how does it find what's tappable and what screens exist?

**Blocks:** The "run + observe" step of the agent loop (§8 of the spec). Without it the self-healing loop can't see runtime failures.

**Moving parts:**
- *Discovery* — how the harness learns the set of screens and interactive elements.
- *Driving* — how it actually fires the interactions.
- *Pass definition* — what counts as "the app booted clean."
- *Side-effect containment* — making sure a smoke test doesn't corrupt real user data.

**Options:**
- **H1 — SDK-level self-registration.** Interactive components register a node (id + handler reference) into a runtime tree the harness can query; screens come from the declared `defineApp` graph. *Trade-off:* robust and structure-agnostic, survives a future render-backend swap; costs a little SDK instrumentation (but you own the SDK, so it's cheap).
- **H2 — DOM-walking for SDK data-attributes.** SDK emits `data-*` markers; harness walks the DOM. *Trade-off:* no runtime tree to maintain; but couples the smoke test to DOM rendering (breaks if you go native-reconciler) and is brittle.
- **H3 — Static AST analysis of the bundle** to extract screens/handlers. *Trade-off:* no runtime needed for part of it; but misses anything created dynamically at runtime.

**Leading hypothesis:** **H1, plus the declared screen graph from `defineApp` (a touch of H3 for free).** Self-registration is the robust core; declared screens make navigation targets known up front without execution.

**Build:** Add a tiny registry to the fake SDK so `Button` registers `{id, screen, onPress}` on mount. Write 3 hand-written apps of different shapes (one screen; multi-screen with nav; one where a modal reveals a *new* button after a tap). Write a driver that: mounts initial screen → scans the registry → invokes each handler → re-scans (to catch newly-revealed elements) → visits each declared screen → collects throws/rejections. Inject one deliberate bug (a handler that throws) and confirm the driver catches it.

**Accept:** across all 3 apps, the driver discovers every interactive node and every screen (zero missed tappables on the test set), drives them without the harness itself erroring, and **catches the injected bug**. The modal case proves the iterative tap→rescan loop works.

**Reject / red flags:** elements remain undiscoverable; the loop can't terminate cleanly on apps that reveal new elements; smoke-testing mutates persistent storage.

**Watch for:** **iteration, not single-pass** — interactions reveal new interactions, so scan-tap-rescan in a loop with a depth/iteration cap. **Termination** — a tap that opens a tap that opens… needs a visited-set and a cap. **Ephemeral storage during tests** — the smoke test must run against a throwaway storage namespace, never the user's real data. (This is a real constraint that feeds back into the storage capability design — note it.)

**Artifact:** the discovery mechanism that worked, the structure of the registry node, the iteration/termination strategy, and the storage-isolation requirement for test runs.

---

## Spike 4 — Git as the versioning engine

**Unknown:** Can real git serve as the snapshot / version / fork engine for mini-apps — giving versioning, forking, and diff "for free" — without ever exposing git to the user?

**Blocks:** The snapshot-storage shape (v0.2-ish) and the versioning/rollback model (§11).

**Moving parts:**
- *Where git runs* — server-side, on-device, or both.
- *Mapping* — snapshot = commit; pin = tag; fork = branch; the producing prompt = commit message; rollback = checkout.
- *Repo contents* — bundle source, manifest, `LEARNED.md`, prompt.
- *The merge question* — whether you ever need it (likely not).

**Options:**
- **H1 — Server-side bare repo per mini-app.** Harness commits each generation; the phone caches the current checked-out bundle. *Trade-off:* full real git, the server is already in the loop, trivially robust; version *operations* need network (fine — generation already does, and offline only needs the current cached bundle).
- **H2 — On-device git via `isomorphic-git`** over a JS filesystem shim. *Trade-off:* offline version history, no server dependency for history; more on-device moving parts and FS/perf risk.
- **H3 — Don't use git; roll a content-addressed append-only snapshot list.** *Trade-off:* trivial to build; but reimplements forking/diff that git gives you, which is the whole reason to want git.

**Leading hypothesis:** **H2, on-device.** *(Updated: decision #33 makes the server stateless with the device as system of record, so version history must live on the device — this flips the earlier server-side lean.)* On-device git via `isomorphic-git` over a JS filesystem shim. **Key simplifier (unchanged):** forks are independent lineages, so you likely **never merge** — which removes git's hardest feature and leaves only the rock-solid subset (commit, branch, checkout, diff, log). Server-side git (H1) remains the fallback only if on-device perf/FS reliability proves unworkable *and* you accept versioning requiring network.

**Build:** A throwaway harness that runs `isomorphic-git` over a JS FS shim (in a Node or RN-like context), driven entirely programmatically (no human git commands): inits a repo, commits two "generations" of a bundle with the prompt as the commit message, branches ("fork"), commits divergently on the branch, checks out an old commit ("rollback"), and diffs two versions. Map each operation to the intended UI verb. Measure timings on the JS implementation specifically.

**Accept:** every operation (commit, fork, checkout, diff, log) works programmatically and fast for realistic bundle sizes; prompt-as-commit-message reads well in `git log`; the version/fork UI verbs map cleanly with **no need for merge**.

**Reject / red flags:** you discover a real need for auto-merge (you probably won't); `isomorphic-git` perf or the JS FS shim's reliability is poor on-device for realistic histories; repo bloat over many generations is unmanageable without gc → fall back to H1 (server-side git, accepting network-dependent versioning) or H3.

**Watch for:** git concepts leaking into the UX (they must not); `isomorphic-git` performance and FS-backend reliability on the device (now the primary risk, since on-device is the lead); history/repo size growth on the phone; large/binary assets (Tier 0 is text, so fine for now).

**Artifact:** where git runs, the operation→UI-verb mapping, confirmation that merge is unnecessary, and the rollback/fork latency.

---

## Spike 5 — SDK-as-docs pipeline

**Unknown:** Can a single annotated SDK source produce both the system-prompt API reference *and* human docs, with no drift?

**Blocks:** The harness phase (the system prompt needs an always-accurate SDK reference) and long-term maintainability.

**Moving parts:**
- *Doc source* — TSDoc/JSDoc comments on each SDK export (signatures, dos/don'ts, examples).
- *Extractor* — TypeDoc, api-extractor, or a small custom script.
- *Two targets* — a compact reference for the model (token-budgeted) vs richer docs for humans.

**Options:**
- **H1 — TSDoc comments → custom extractor → a compact projection for the prompt + a fuller human doc.** *Trade-off:* single source of truth; needs a small extraction script and a convention for what the model sees.
- **H2 — Maintain the prompt reference separately from the code.** *Trade-off:* simplest today; guarantees drift tomorrow (the failure mode you're trying to avoid).

**Leading hypothesis:** **H1**, with an explicit tag (e.g., `@agent`) marking the parts of each comment that go into the system prompt, so the model gets a *curated projection*, not the verbose full output.

**Build:** Annotate 3 fake SDK exports with rich TSDoc. Write a tiny extractor that emits (a) a compact markdown/JSON reference containing only `@agent`-tagged content and signatures, and (b) a fuller human page. Change one comment, regenerate, confirm both update.

**Accept:** one edit propagates to both outputs; the model-facing projection is compact enough to fit a sane prompt budget while still carrying the dos/don'ts and a usage example per export; nothing is hand-maintained twice.

**Reject / red flags:** the full extraction is too verbose to budget and there's no clean way to curate it down; examples in comments rot silently.

**Watch for:** system-prompt token budget (the whole reason for the curated projection); consider lint-checking the in-comment examples so they can't drift from the real API.

**Artifact:** the extractor approach, the tagging convention for model-facing content, and the rough token size of the projected reference.

---

## Spike 6 — The CI headless boundary

**Unknown:** Which test tiers can run headlessly in CI on every push, and which must be on-demand?

**Blocks:** Making the testing methodology (§16) real rather than aspirational.

**Moving parts:**
- *Headless feasibility* — can the web-based sandbox (Spike 1) run in a headless browser in CI without an emulator?
- *The three tiers you named* — component tests (small/fast), end-to-end interaction tests (bigger), harness/prompt-correctness eval (extended, token-costly, non-deterministic).
- *The RN-host gap* — the parts that genuinely need an emulator.

**Options / structure (this spike confirms a policy more than it picks one design):**
- **H1 — Web-tech sandbox runs in headless Playwright/Puppeteer in CI per push** (security invariants + component + smoke-test logic, since they're all web). The **RN host shell** needs an emulator → run on a reduced cadence (nightly / pre-merge), not every push. The **eval corpus** runs on-demand/nightly only (cost + nondeterminism), never per push.

**Leading hypothesis:** **H1.** Because the sandbox is web tech, the most important suite — the security invariants, especially network-isolation — runs cheaply in a headless browser on every push; emulator and eval suites run less often.

**Build:** Stand up the Spike-1 sandbox under headless Playwright in a CI job. Run the forbidden-globals probe checklist as assertions. Separately, time how long an emulator-based RN smoke run takes, to decide its cadence.

**Accept:** the security-invariant suite runs green headlessly in CI in a small time budget (rough ceiling: a few minutes); you've drawn an explicit line — per-push (web invariants + component), reduced-cadence (emulator/RN-host, end-to-end), on-demand (eval corpus).

**Reject / red flags:** the headless browser environment diverges enough from the real `react-native-webview` that green-in-Playwright doesn't predict on-device behavior — in which case some invariants must move to the (slower) emulator cadence.

**Watch for:** **Playwright ≠ RN WebView** — a passing headless test doesn't fully guarantee on-device parity, so keep *some* on-device runs, just less frequent; flaky emulator CI; eval token cost ballooning if it ever sneaks into per-push.

**Artifact:** the per-push / reduced-cadence / on-demand split as a written policy, the headless invariant-suite runtime, and the known Playwright-vs-device caveats.

---

# Tier 3 — Harness-phase spikes (not v0.1 blockers; flagged so they're not forgotten)

## Spike 7 — Model reliability (SDK-only, well-formed output)

**Unknown:** Can the chosen model (DeepSeek is the bet) reliably emit valid, SDK-only code in the agreed bundle format across many prompts?

**Blocks:** Committing to a v1 model; the entire loop assumes reliably well-formed, SDK-only output.

**Leading hypothesis:** DeepSeek is good enough for Tier-0 apps against a tightly-documented ~80-symbol SDK, but its structured-output/format-adherence needs measuring before commitment.

**Build (harness phase):** Run 20–30 of the eventual corpus prompts through the model with the SDK reference in context; measure rate of (a) parses, (b) imports only from the SDK, (c) boots clean under Spike 3's driver.

**Accept:** high first-pass validity (set a bar, e.g., ≥80% parse + SDK-only) and the rest recoverable within the repair cap. **Reject:** frequent malformed or non-SDK output that the repair loop can't rescue → reconsider model.

**Watch for:** streaming format adherence; how gracefully it takes structured diagnostics back; cost per generation.

## Spike 8 — Streaming + hot-reload UX

**Unknown:** Can generated code stream in with the preview hot-swapping as it arrives, so iteration feels instant?

**Blocks:** The vibe-coding feel (not the architecture).

**Leading hypothesis:** feasible — stream tokens, debounce, re-inject the bundle into the sandbox on each stable chunk.

**Build (harness phase):** stream a known bundle in chunks and re-mount the sandbox progressively; judge the feel.

**Accept:** visible progress without flicker/jank. **Watch for:** partial/invalid intermediate code (only hot-swap on parseable checkpoints), state preservation across reloads.

---

# Suggested order

1. **Spike 1** (sandbox runtime) — everything rests on it.
2. **Spike 2** (bundle contract) — shares the injection mechanism with Spike 1; do it right after.
3. **Spike 4** (git versioning) — independent, cleanly parallelizable, and high-payoff if it lands.
4. **Spike 3** (synthetic event stream) — needed before the harness; may push a small requirement back into the SDK (self-registration, ephemeral test storage).
5. **Spike 5** (SDK-as-docs) and **Spike 6** (CI boundary) — light, can slot in alongside.
6. **Spikes 7–8** — at the harness phase, once the runtime + SDK are proven.

Spikes 1, 2, and 4 are the ones that genuinely gate the foundation. The rest sharpen it. Cut each into its own spec, generate it, supervise, record the lesson, throw the code away.
