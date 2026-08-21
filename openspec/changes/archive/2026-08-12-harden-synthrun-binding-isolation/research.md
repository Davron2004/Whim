# research — harden-synthrun-binding-isolation

Two read-only researcher digests, 2026-08-11, on `integration/harden-synthrun-binding-isolation`
@ `b4d0724`. R1 read the pinned Playwright source; R2 read `synthrun/`. Every claim below carries the
citation the digest gave it. **Nothing here was verified by execution** except where it says so — the
proposal's verified-by-execution finding stands on its own separate evidence.

The proposal named three unknowns and refused to design against them. All three are now answered.

---

## Q1 — Does scrubbing more names close the hole? **No. It cannot, in principle.**

Playwright 1.60.0 ships as one bundled-but-unminified `node_modules/playwright-core/lib/coreBundle.js`.

- `Runtime.addBinding` is called with **`{name}` only** — no `executionContextId`, no
  `executionContextName` — at every call site (`coreBundle.js:36643`, re-issued per new frame session at
  `coreBundle.js:36217-36218`). The CDP protocol documents that omitting both scoping parameters "adds
  binding … on the global objects of **all** inspected contexts, including those created later, bindings
  survive reloads" (`types/protocol.d.ts:22666-22668`).
- Both scoping parameters **exist** in the protocol (`protocol.d.ts:22673-22693`). **Playwright simply
  never uses them.** So the raw binding is global to the target — every frame, opaque-origin srcdoc
  included — and no Playwright-level configuration changes that.
- Init scripts reach every frame and there is no main-frame restriction anywhere: the CDP command
  `Page.addScriptToEvaluateOnNewDocument` has no frame filter at all (`protocol.d.ts:15348-15366`), and
  the public `addInitScript(script, arg?)` takes no options object (`types.d.ts:318`, `types.d.ts:8224`).
  Playwright's own docs: "Whenever the child frame is attached or navigated … the script is evaluated in
  the context of the newly attached frame" (`types.d.ts:282-283`).
- **Deleting the controller is still not enough.** The named wrapper's entire body is
  `this._global['__playwright__binding__'](JSON.stringify({name, seq, serializedArgs}))`
  (generated `BindingsController`, `coreBundle.js:19354`), and host dispatch merely `JSON.parse`s that
  payload and looks the name up (`coreBundle.js:20451`, `20454`). Anyone holding the **raw** binding
  hand-rolls the payload without the controller.
- Deleting the raw `__playwright__binding__` as well would break the controller in that realm — but
  **whether Chromium re-materialises the raw binding into a live realm after a JS `delete` is not
  determinable from Playwright source** (R1 explicitly did not verify it; the protocol text only promises
  contexts "created later" and survival across reloads).

**Conclusion: a JS-level scrub is unfalsifiable defense at best and cosmetic at worst. It must not be the
load-bearing mechanism.** The proposal's suspicion was right.

## Q2 — Is there a frame-aware alternative in the pinned version? **Yes, and it is public API.**

This is the decisive finding.

- CDP `Runtime.bindingCalled` carries `{name, payload, executionContextId}` (`protocol.d.ts:22084-22091`).
- Chromium's handler resolves that id to a `FrameExecutionContext` **built with its owning frame** from
  `auxData.frameId` (`coreBundle.js:36454-36461`, construction at `36342-36355`). **The host has always
  known which frame called.** The identity is browser-supplied and therefore unforgeable by page JS.
- `PageBinding.dispatch` performs **no** frame or origin check — only `assert(context.world)` (true for
  any default "main" world, sandbox iframe included) and a name lookup (`coreBundle.js:20450-20465`). It
  then invokes `binding.playwrightFunction({frame, page, context}, ...args)` (`coreBundle.js:20460`),
  and that `source` is shipped over the wire (`coreBundle.js:49383-49390`) and rebuilt client-side as
  `{context, page, frame}` (`coreBundle.js:57045-57053`).
- **`exposeFunction` discards it.** Client `Page.exposeFunction` is literally
  `const binding = (source, ...args) => callback(...args)` (`coreBundle.js:57483`; `BrowserContext`
  identical at `coreBundle.js:56601`). **`exposeBinding` stores the callback unwrapped**
  (`coreBundle.js:57478`, `56607`). Types confirm the signature difference: `exposeFunction(name,
  callback)` (`types.d.ts:9236`) vs `exposeBinding(name, (source: BindingSource, ...args) => any)`
  (`types.d.ts:8187`).
- Frame object identity is stable and comparable — `FrameDispatcher.from` reuses the existing dispatcher
  per server Frame (`coreBundle.js:50103-50105`) — so **`source.frame === page.mainFrame()` is a sound
  discriminator**.

Alternatives considered and rejected:

- **Raw CDP `Runtime.addBinding` with an explicit `executionContextId`.** Possible in principle
  (`newCDPSession` is available and already used at `synthrun/observe.ts:409`), but the protocol marks
  `executionContextId` **deprecated** "due to an unclear use case and bugs in implementation
  (crbug.com/1169639)" and slated for removal (`protocol.d.ts:22680-22682`). Also `newCDPSession(frame)`
  throws for a same-process srcdoc child (`coreBundle.js:37333-37337`), so per-frame session scoping is
  not available here anyway. Rejected: strictly more fragile than public API for the same guarantee.
- **`page.on('console')`.** Carries no frame identity at all — Playwright drops the frame when building
  `ConsoleMessage` (`coreBundle.js:36448-36452`). Not a provenance channel.
- **Isolated world via `executionContextName`.** Playwright's utility world is created in *every* frame
  (`coreBundle.js:36208-36211`) and there is no public API to reach it.

## Q3 — Does `whimHostDispatch` need the same treatment? **Yes, and nothing legitimate breaks.**

- Call site: `synthrun/capability.ts:135-137`, `await context.exposeFunction('whimHostDispatch', dispatch)`
  inside `beforeNavigate`. `dispatch` (`capability.ts:104-128`) parses the frame, calls the **production**
  `dispatcher.handle(raw)`, records trace entries, returns `JSON.stringify(sysret)`. **No caller-identity
  check of any kind.**
- **No rationale for context-level exposure exists.** The precedent it copies
  (`invariants/sandbox-isolation/bridge/runner.mjs:72`) and the archived design
  (`archive/2026-07-31-synthetic-run-harness/tasks.md:19`) both use **`page.exposeFunction`**;
  `capability.ts` diverged silently. The `beforeNavigate` signature is `(page, context)` and the page
  argument is discarded as `_page`.
- **The only legitimate caller is the outer page's main frame.** `build/assemble.mjs:121` `relaySyscall`
  runs in `orchestrationScript` — "runs in the WebView page, NOT the iframe" (`assemble.mjs:87`) — and
  calls `window.whimHostDispatch(raw)` only after source-verifying `ev.source === iframe.contentWindow`
  (`assemble.mjs:143`). The sandbox side calls `__whimSyscall.call` (`src/runtime/web/syscall.js:108`),
  never `whimHostDispatch`. R2 found **no** non-main-frame legitimate caller in `synthrun/`,
  `invariants/`, or fixtures.
- The generation fence lives host-side (`src/host/bridge/dispatcher.ts:85-87`, again post-await at `:115`).
  A hand-rolled `gen:1` frame **matches** it rather than defeating it — which is why the fence is not the
  layer that can fix this.

---

## Current code shape (R2), for the design's sake

- **Relay install**: `synthrun/observe.ts:428`, inside `attachObserversEarly(page, context)`, itself run
  from `RunOptions.beforeNavigate` (`report.ts:64`). Callback is `(raw: string) => void`.
- **`msg.trusted` consumed verbatim** at `observe.ts:442` (`const trusted = msg.trusted === true`), then
  `if (!trusted) return;` gates paint/probes recording (`observe.ts:438-453`).
- **`installRelayShim`** (`observe.ts:332-353`), registered via `page.addInitScript` at `observe.ts:455`,
  already does more than the proposal credits it for: it `delete`s the name **and** returns early unless
  `g.top === g`, so **no non-main frame ever gets the `ReactNativeWebView` transport**. The hole is
  entirely underneath it, in Playwright's binding machinery.
- **Load-bearing ordering, currently undocumented and untested**: the scrub only works because
  `exposeFunction` (`observe.ts:428`) is awaited **before** `addInitScript` (`observe.ts:455`).
  **Reverse those two lines and the scrub silently no-ops.**
  > **Correction (chain-1, verified during implementation).** R1 attributed this to `allInitScripts()`
  > ordering (`coreBundle.js:20343-20348`). That is an over-read: that path applies only to *fresh frame
  > sessions*. For this call path the guarantee is **CDP registration order** on the already-created
  > page. The conclusion is unchanged — do not reorder the two lines — and the comment at the call site
  > states the accurate reason rather than this one.
- **Verdict**: `recordProbesOutcome` (`observe.ts:229-247`) assigns `state.contained = contained`
  **unconditionally** — the last-writer-wins mechanism. `state.paintAtMs` is the one field already
  guarded first-write-wins (`observe.ts:451`).
- **Tri-state**: `contained: boolean | null` (`observe.ts:89`, `contract.ts:150`). `null` = *unobserved*
  and never travels without a `containment_unobserved` diagnostic, minted from the single site
  `pushContainmentUnobserved` (`observe.ts:252-262`) plus close-out `finalizeContainmentVerdict`
  (`observe.ts:274-277`, called from `report.ts:116`). `evals/adapters/synthetic-run.ts:49-53` maps
  `null → {authenticated:false, contained:false}` — fail-closed. **The fix must preserve all of this.**
- **Existing forgery accounting**: kind `rejected-forgery` with `REJECTED_FORGERY_CAP = 16`
  (`contract.ts`), incremented at `observe.ts:445`. `RUNTIME_OBSERVED_KINDS` (`observe.ts:27-34`) is a
  **closed** union also mirrored in `checks/contract.ts` — adding a new kind is a multi-file change;
  reusing `rejected-forgery` is not.
- **The quarantine** is a local helper `quarantined(name, reason, fixtureItNeeds)`
  (`test/acceptance.ts:74-82`) — not a `.phase` file, not a `greenBy` marker, not an env var. It pushes to
  a `quarantines[]` array, `console.warn`s, asserts only `fixtureItNeeds.length > 0`, never runs the body,
  and never affects exit code. The call is `test/acceptance.ts:670-674` with
  `RELAY_REBIND_PROBE` (`:273`). The neighbouring name-level test (4.2a, `:611-647`) pins
  `typeof relay === 'undefined'`, `g.top !== g`, and rejected-forgery accounting — **it must keep passing.**
- **Sandbox injection idiom**: `findAppFrame(page, timeoutMs)` (`sweep.ts:113`) returns the opaque-origin
  candidate `Frame`; callers then use `frame.evaluate(fn, arg)` directly (exactly what 4.2a does at
  `acceptance.ts:616-641`). There is no other wrapper. Outer-page injection uses
  `relayFromOuterPage(ctx, frame)` (`acceptance.ts:426-431`).
- **Suite wiring**: `npm run synthrun:test` → `synthrun/test/run.mjs` (real Chromium). It runs **only in
  `scripts/gate-full.sh:40`**, never in `gate.sh` — decision #55 records that deviation deliberately
  (Chromium + a documented mount race stay off the inner loop).

## Gap found in passing (NOT fixed by this change — see design D6)

`.github/workflows/invariants.yml` does **not** run `synthrun:test` (nor `vstore:test`, `sdk:test`,
`server:e2e`, `launcher:deliver-verify`, `codex-sync`). CLAUDE.md's "CI is effectively `gate-full.sh` on
every push" is therefore inaccurate today. `.github/workflows` is **not** in `gate.sh`'s `CONFIG_SET`
(`scripts/gate.sh:23-32`) and not protected, so closing it is mechanically possible — but it is out of
this change's scope and is recorded as a recommendation instead.

## What remains genuinely unverified

- Whether Chromium re-materialises `__playwright__binding__` into a live realm after a JS `delete`
  (Chromium/V8 behaviour, absent from Playwright source). **The design does not depend on the answer** —
  D1 deliberately puts no weight on any scrub.
- Whether `Runtime.addBinding`'s deprecated `executionContextId` still functions in the pinned Chromium.
  Not needed: the chosen mechanism is public API.
- Neither researcher executed the suite. All pass/fail expectations below are code readings until the
  implementer's gate says otherwise.
