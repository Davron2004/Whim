# Whim — v1 Roadmap & Change Map

*The handoff artifact from the 2026-06-11 planning session (decision #42). This file is
**self-sufficient planning state**: a fresh session must be able to propose any change below
from this file + the docs it references, with zero access to the planning conversation.
It is also the **ledger** — each change's `Status` block is updated as proposals land.*

---

## Protocol for a proposing session (read this first)

You are proposing **one** OpenSpec change from the map below. Rules:

1. **Read before proposing:** this file end-to-end; the target change's *Read first* refs;
   the `Status`/*Contract notes* of every change it depends on (read their
   `openspec/changes/<name>/proposal.md` only if the notes aren't enough).
2. **Propose via the OpenSpec workflow** (`/openspec-propose`): proposal + design + tasks +
   spec deltas under `openspec/changes/<name>/`. The brief below is the scope contract —
   honor its *Out* list. If code-on-disk contradicts a brief (another change landed and moved
   things), **prefer reality** and record the delta in your ledger update.
3. **Propose only.** Do not implement, do not edit invariant suites (§16.4 — invariants are
   authored in dedicated runtime-owner sessions), do not touch `src/runtime/generated/*` or
   `build/generated/*` (build outputs).
4. **After proposing, update this file:** set the change's `Status` to `proposed <date>` and
   add **≤ 10 lines** of *Contract notes* — only the interface decisions other changes need
   (names, schemas, file paths, commands, deviations from the brief). Never restructure or
   renumber this file.
5. Contradiction in the roadmap itself? Add it under **Open deltas** at the bottom and tell
   the user; don't silently resolve it.
6. English test-spec discipline (§16.5): every proposal's tasks include "spec the tests in
   English" before implementation tasks.

## What "v1" means (spec §15.4, as resolved by decision #42)

A user speaks/types a prompt on the phone → server harness (plan → generate → static check →
synthetic run → repair ≤ 3) returns a verified bundle → it installs to the launcher, runs in
the hardened sandbox, persists data, and every generation is a tagged snapshot with
rollback/pin/fork. **Tier-0 SDK only** (UI + local storage + v0.3 effects/cues). Two-stage
prompt (rewrite → preview → engineer model) **is in v1**. Android only, personal use, no
sharing/billing/network/sensors, one engineer model (picked by bakeoff). "v1" = first complete
coded version, not a public release.

The v1 corpus = the 11 Tier-0 apps in `docs/app-corpus.md`. v1 is done when the
`v1-end-to-end` acceptance passes: several corpus apps generated end-to-end on a real device.

## Locked decisions (full rationale in decisions.md #42)

- **Model:** strong-first, downgrade-by-eval via OpenRouter; rewrite model picked in the same
  bakeoff. — **Backend:** Node 22; REST + SSE; zod schemas in a shared `contract/` package;
  monorepo `server/` workspace. — **Identity:** anon device UUID (MMKV) + server token counter.
- **Back nav:** system back primary (pops app nav stack, then exits); small draggable
  auto-dimming floating extra. — **First run:** seed tip splitter + water counter, forkable/
  deletable, + CTA. — **Devices:** fresh-AVD spike for daily dev; real device on LAN for
  acceptance. — **Synthetic run:** server-side headless Chromium reusing invariants machinery.
- **SDK:** ~60–80 exports is a **ceiling**; gap analysis sets the number. `Chart` = own change,
  3 shapes only. Animation/motion = post-v1 tier. — **Holdout evals:** exist; location is NOT recorded
  anywhere in this repo — the user supplies it to the eval runner at runtime (local,
  gitignored config). Implementing and prompt/SDK-tuning sessions must not seek it.

## Standing constraints every change inherits

- **Never widen** the CSP, sandbox attributes, or module allowlist (#35/#37 — locked).
  Anything touching the runtime/bundle contract reads `docs/spike2-findings.md` first
  (five load-bearing constraints).
- **F4:** trust only nonce-authenticated control frames / trusted-vantage probes — never a
  bundle's self-report. **Capability additions** = one registry row + one client stub, zero
  transport/dispatcher edits (#41's review rule).
- **Product verbs only** on user-facing surfaces (no git vocabulary; a build guard enforces it).
- **Diagnostics discipline** (§8.1/§8.2): every diagnostic is structured, carries a fix hint
  shaped like the right SDK answer; zero-warning steady state — a warning that doesn't block
  shipping shouldn't exist.
- **Two test surfaces** (§16.1): TDD the bridge/checks (deterministic), test-after the UI,
  eval-corpus methodology for generated output. Suites are blocking CI.
- Build env for device work: Node 22 on PATH, JDK 21, arm64-only, offline release APK,
  logs → logcat `ReactNativeJS` (see CLAUDE.md).

---

## The 13 changes

**Pre-existing dependency:** `capability-bridge` is **complete** (decisions #41 — desktop
gates green + on-device acceptance done; syscall round-trip ≈16–17 ms median on the emulator).

### Lane 0 — groundwork

#### 1. `tier0-corpus-and-sdk-gap` — Size S · Deps: none

**Status:** DONE 2026-06-12 — executed inline as a working session with the user (analysis
only, no code; OpenSpec ceremony skipped by agreement). Deliverable: **`docs/sdk-gap.md`**.
**Contract notes:**

- v1 SDK surface = **~42 exports** (ceiling held); every export traces to a corpus app.
- **Navigation does not exist yet** — built in #3 (`useNavigation`/`useRoute`). ⚠️ #3↔#5
  coordination: system back needs a nav-depth seam; first proposal to land defines it.
- Search = **client-side filter** idiom (no engine `contains` in v1; engine untouched).
- DatePicker = native `<input type="date">` wrapper · overlays = **Alert + Toast only** ·
  Icon = closed ~16-name set · Chart = one export, `kind: bar|line|heatmap` (#4 finalizes).
- json-vs-collection modeling rule is SDK-reference-doc material (also the no-batch-verb
  workaround). Eval visible seeds in `docs/sdk-gap.md` §6; the holdout set exists
  (2026-06-12) — location deliberately unrecorded here, supplied at runtime by the user.
**Why:** the §18 artifact that sizes the SDK and seeds the evals; gates #3, #4, #12.
**In:** break each of the 11 Tier-0 apps (`docs/app-corpus.md`) onto the SDK surface
(components / tokens / storage verbs / effects); produce the SDK gap list (expected: `Grid`,
`Chart`×3 shapes, SegmentedControl, search/filter UI, nested-form patterns); **verify whether
recipe-box search needs a text-`contains` filter** the storage engine's `where` lacks (if yes:
flag a small additive engine-verb task, don't build it here); set the SDK export count
(ceiling 60–80); write 2–3 eval prompt phrasings per app — visible set committed, **holdout
delivered to the user privately, never committed**.
**Out:** any code; any SDK design (that's #3/#4).
**Read first:** `docs/app-corpus.md`, spec §5.2/§6/§18, storage spec (`openspec/specs/mini-app-storage/`).
**Done when:** every Tier-0 app is expressible on paper against the gapped SDK.

### Lane A — runtime/SDK (device) — serialize within lane (shared `src/sdk`)

#### 2. `effects-and-cues` (= v0.3) — Size M · Deps: capability-bridge (done)

**Status:** implemented 2026-06-12 — desktop suites green (`bridge:test` 91 checks incl. the new
§G cues; effects E1–E4 in headless Chromium; `invariants` 7/non-vacuous; build + lint clean) and
**emulator acceptance done** (Pixel_9_Pro_XL arm64, offline release): pour-over delivered, the
`interval` countdown ticks at 1 Hz, **get-ready + stage-transition cues fire** (8 syscalls, all
`ok`), pause/resume work, **containment held 42/42** throughout; the Kotlin `WhimTone` TurboModule

- codegen compile and install. **Pending:** the runtime-owner invariants (INV-TIMER, INV-CUEGATE —
authored in a separate session, §16.4) and the *felt* cue check on real hardware.
**BLOCKED (archive):** INV-TIMER and INV-CUEGATE (see docs/backlog.md) plus the real-hardware felt-cue check. Not yet archived.
**Contract notes (durable — Lane A #3/#4 share `src/sdk`):** `vc-sdk` now exports `delay(ms)` and
`interval(cb, ms, { running })` (web-resident wrapped timers — **no** syscall, no capability, hook
auto-cleanup on unmount, `running` pauses) and a `cues` facade `cues.haptic(kind)` /
`cues.sound(name)` (syscalls **#2/#3** under ONE `cues` capability). Closed token sets, single
source `src/host/bridge/contract.ts` (`HAPTIC_KINDS = tap|double|heavy`, `SOUND_NAMES =
tick|chime|alarm`); the host owns token→pattern/tone, the bundle expresses only tokens. Cues are
fire-and-forget + at-most-once (the dispatcher's existing dedup). Bridge diff was **rows + types +
the registry factory only** (`createDefaultRegistry({ cueBackend })`) — transport/dispatcher/gate
untouched, so the #41 append-only readiness test PASSED. RN side: `src/host/cue-backend.ts`
(`Vibration`) + the in-repo `WhimTone` `ToneGenerator` TurboModule; `android.permission.VIBRATE`
added. SDK export budget after this change: **14** runtime value exports (this change added
exactly `delay` + `interval` + the `cues` facade — the "2 effects + 2 cues" — well under #1's
~42 ceiling). No CSP / sandbox-attribute / module-allowlist line changed anywhere in the diff
(locked #35/#37 intact; `src/runtime/web/` + `build/assemble.mjs` untouched — no D9 red flag).
**Why:** the §15.2 v0.3 rung: web-resident effects + the bridge's append-only readiness test.
**In:** `delay`/`interval` in `vc-sdk` — **web-side** wrapped timers (no bridge) with
unmount/teardown cleanup the host can force (realm reset cancels everything); haptics as
syscall #2 (RN `Vibration` — avoid a new native dep if it suffices) and short audio cues as
syscall #3 (minimal dep, decide in design) — **registry rows + client stubs only**; foreground
pour-over-timer fixture; invariant additions (timers die on realm teardown; cue syscalls
manifest-gated) — *invariants authored in a separate runtime-owner session*.
**Out:** notifications/background execution (Tier 2), media/volume APIs, animation.
**Read first:** decisions #41, `docs/spike2-findings.md`, spec §5.5/§5.6, `src/host/bridge/`.
**Done when:** pour-over fixture runs on-device with cues; haptics row landed with zero
transport/dispatcher edits; suites green.

#### 3. `sdk-design-system` — Size L · Deps: #1; after #2 (file overlap)

**Status:** unproposed
**Why:** the SDK is currently "exactly what the fixtures use"; the corpus needs the real set,
and the reference doc *is* the future system prompt.
**In:** components per the gap list (forms incl. nested patterns for workout log; List +
search/filter; SegmentedControl, Picker, Toggle, Checkbox; Modal/Sheet/Toast/Alert; Card,
Badge, Divider, EmptyState, ProgressBar; `Grid` for tic-tac-toe); full token scales + dark
mode; **the prompt-ready SDK reference doc** (one artifact, written for a model: terse,
exhaustive, example-bearing); a component-gallery fixture for on-device eyeballing.
**Out:** `Chart` (#4), animation/motion (post-v1), `Canvas`, raw-style props of any kind.
**Constraints:** tokens-not-values; backend-agnostic contract (no DOM concepts leak into the
component API — the native-reconciler revert option, spec §4.6); ceiling discipline — every
export must be justified by a corpus app.
**Read first:** #1's gap list, spec §5.2/§5.3, `src/sdk/`, `fixtures/`.
**Done when:** gallery renders on-device; each corpus app expressible; reference doc covers
every export.

#### 4. `sdk-charts` — Size M · Deps: #1 · Parallelizable with late #3 (new `src/sdk/charts/` module)

**Status:** unproposed
**Why:** corpus demands charts (spending graph, streak heatmap); big enough surface to own a
change (user's call, decision #42).
**In:** declarative `Chart` — exactly **bar, line, calendar-heatmap**; data-as-props; tokens-only
styling; sensible empty/overflow behavior; SVG-or-DOM rendering choice made in design (no canvas).
**Out:** pie/scatter, tooltips, pan/zoom, animation, interactivity beyond static render.
**Read first:** #1's gap list, spec §5.3, `docs/app-corpus.md` notes.

### Lane B — host product UX (device) — serialize within lane (shared `src/host`)

#### 5. `launcher-shell` — Size M–L · Deps: none hard

**Status:** implemented 2026-06-12 (branch `launcher-shell`, off `dev/v1`) — desktop gates green
(build · invariants 42/42 (7 scenarios) · lint (no new errors) · vstore 52 · storage 131 ·
bridge 63 · launcher 433 · tsc clean · by-source desktop parity); **on-device acceptance
(task 7.2) PENDING** (offline release APK walk per `acceptance.spec.md`). As-built: decisions #43.
**Contract notes (as-built, for #3 — the nav-depth seam):** the SDK↔host back-navigation seam
is declared in `src/host/bridge/contract.ts` (`NavDepthFrame`/`NavBackFrame`, added to
`classifyFrame` as control-family) with the anchor comment #3 implements against; the iframe-side
TODO anchor is in `src/runtime/web/loader.js`. #3's SDK half emits
`{__whimNavDepth:true, depth, generation}` on every nav-stack change (the outer page source-checks
- stamps the generation, relays as `kind:'nav-depth'`) and listens for `{__whimNavBack:true}`
(posted by the host's `__whimControl.navBack()` on system back when depth>0) to pop one screen and
re-emit depth. The host guaranteed-exit policy (`src/host/launcher/back-policy.ts`) is independent
of any SDK cooperation. In #5, depth is always 0 (no SDK nav) → back exits at root.
**Why:** the host is currently a probe screen; this is the product shell.
**In:** installed-apps record store (id, name, manifest, schema, bundle ref — design decides
MMKV record vs version-store-backed); home grid + full-screen launch through the existing
`useMiniAppHost`/`MiniAppView` (one WebView == one realm == one app — #41 D2: "the launcher era is a loop, not
a redesign"); delete + fork entry points; first-run seeding (tip splitter + water counter
fixtures as pre-installed, example-labeled records); **back navigation as task 1** (the spec's
own "prototype early" flag): system back pops the mini-app nav stack then exits at root —
needs an SDK-nav↔host coordination design (e.g., a control frame or host-mirrored nav depth) —
plus the draggable auto-dimming floating extra.
**Out:** prompt screen (#7), history UX (#6), any server talk.
**Read first:** decisions #41/#42, `src/host/launcher/useMiniAppHost.ts`, spec §10.
**Done when:** seeded launcher → tap app → runs → system back exits → delete/fork work, on-device.

#### 6. `version-history-ux` — Size M · Deps: #5

**Status:** unproposed
**In:** per-app history screen over the version store's product verbs (paginate/cap — history
and rollback are the depth-scaling ops, #39); prominent rollback (§11: rollbacks are ~10×
normal coding), pin, fork→new launcher entry; **snapshot↔structured-prompt tagging** (verify
the snapshot metadata surface supports a prompt payload; extend additively if not — product
verbs only, no git vocabulary).
**Out:** visual diffing beyond what the store's `diff` verb gives; cross-app anything.
**Read first:** `src/host/version-store/index.ts`, specs `mini-app-versioning`/`mini-app-forking`, decisions #39.

#### 7. `prompt-flow-ux` — Size M–L · Deps: contract types from #8 (mockable before it)

**Status:** unproposed
**In:** prompt screen (text input + OS-dictation affordance — no in-app STT); the **two-stage
flow**: casual prompt → server rewrite → **preview screen** where the user reviews/edits
*intent in their own terms* (SDK internals never surface, §10.1) → approve → engineer
generation; SSE client + staged progress UI (plan / generate / check / repair states);
the honest failure screen ("couldn't get this working — rephrase, or see what I tried");
re-prompt entry on an existing app (edit flow).
**Out:** control-modes selector (§10.1, post-v1), examples-library UI (§9, post-v1), voice harness.
**Read first:** #8's contract notes, spec §10/§8.1.

### Lane C — server/harness (new `server/` + `contract/` workspaces)

#### 8. `harness-server-skeleton` — Size M · Deps: none

**Status:** implemented 2026-06-18 — all four chains (A–D) complete; desktop gates green
(`server:test` 111/111; guard:metro byte-identical 1,834,658-byte bundle before/after
workspace-ification → provably inert; tsc clean both workspaces; CI gates added). As-built:
`NodeSqliteUsageStore` (`node:sqlite` built-in under Node 22, `WHIM_DATA_DIR`); `makeUsageRoute`
(`GET /v1/usage`, zeros for unknown id, scoped to `x-whim-device`); `OpenRouterClient`
(injectable fetch, typed error classes, model-id param). On-device LAN acceptance (task 8.2)
is human-run and not part of the automated gate.
**Contract notes (as-built, for #7/#11):**

- New specs `generation-contract`/`generation-server`. Workspaces `contract/`+`server/` (`@whim/
  contract` zod-only TS-source; `@whim/server` = **Hono**; RN app stays root pkg). Blocking gates:
  `npm run server:test` (+tsc both pkgs), `npm run guard:metro` (RN bundle still resolves);
  `server:dev` = 0.0.0.0:`WHIM_SERVER_PORT` (8787). `/v1/*` need header **`x-whim-device`** (UUID)
  else 400: `POST /v1/generate` (SSE **over POST**; no EventSource) · `POST /v1/rewrite` ·
  `GET /v1/usage`; `GET /healthz` open. `GenerationEvent`: stage(plan|generate|check|run ×
  start|done)/token/diagnostic/usage/result/failure — one terminal event, always last.
- `Diagnostic {kind,symbol?,line?,hint}`, `kind` open — #9 narrows it in `@whim/contract`.
  `WireAppRecord {name,source,bundle,sourceMap?,manifest,schema}`, install-state-free (#5 owns the
  stored record). Wire `schema` ↔ stored `schemaArtifact` naming seam (P3 — no overlap). Stub
  behind `Pipeline` iface (`[[fail]]` → failure path); #11 swaps the impl, route/schema unchanged.
  Metering = `node:sqlite` under `WHIM_DATA_DIR` (the only server state). OpenRouter wrapper
  unmounted; model id always a param. Deviations from contract spec: `Diagnostic`/`Usage` etc. use
  zod-4 two-arg `z.record(z.string(), z.unknown())` for manifest/schema sub-shapes (P4). A
  `DeviceIdError` schema was added to `@whim/contract` for the 400 body (chain-B decision).
**In:** monorepo workspaces (`server/`, shared `contract/` with zod schemas for generation
request / SSE event stream / diagnostics / app record) — design must keep Metro away from
workspace resolution issues; SSE generation endpoint over a **stub pipeline** (canned stage
events, so #7 can build against it); device-UUID header middleware + per-ID token counter
(server-side SQLite or flat file — the only server state, §4.7 Model 1); OpenRouter client
wrapper (model-agnostic, streaming, usage capture); framework: thin (Hono or plain `http`),
decided in design.
**Out:** real pipeline stages (#9/#10/#11), deployment/TLS (LAN dev only), accounts.
**Read first:** spec §4.4/§4.7, decisions #31–#34, #42.
**Done when:** phone-shaped client can open SSE, stream canned stages, get metered.

#### 9. `static-check-pipeline` — Size M–L · Deps: none (pure lib; TDD per §16.2)

**Status:** proposed 2026-06-12 (`openspec/changes/static-check-pipeline/` — proposal/design/specs/tasks)
**Contract notes:**

- Top-level **`checks/`** (workspace-ified once #8's exist). `runStaticChecks(source,
  {appliedSchema?, filename?}) → {ok, diagnostics, manifest?}` — pure, AST-only, **never
  executes** the candidate. Suite `npm run checks:test`, blocking CI.
- Diagnostics: closed kind union + required `hint` in dependency-free `checks/contract.ts`,
  surfaced in `@whim/contract` as the narrowing of #8's open wire `kind` (wired by whichever
  is *implemented* second); adds `severity` (§8.2 — shown to the agent) + `message`; `ok` ⇔
  zero diagnostics of ANY severity; kinds reuse runtime names (`undeclared_capability`).
- `extractAppManifest` (literal-only `defineApp`) feeds #11's record; schema check = #40's
  `validateArtifact`/`diffSchemas`, `appliedSchema` caller-supplied (device ships it on edits).
  ⚠️ #3: nav-target check is table-driven on #1's `useNavigation`/`useRoute` — finalizing
  against #3's as-built API is a data edit. New specs `static-checks`/`harness-diagnostics`
  (#10 extends additively); hostile bypass corpus = separate §16.4 session. No brief deviations.
**In:** a pure TS library (usable by server, evals, and tests): TS parse gate; import
allowlist (only `vc-sdk`); **forbidden-global AST walk that closes T8** — direct refs,
prototype-walk patterns, `globalThis`/alias indirection, `Object.prototype` pollution
attempts (`docs/spike2-findings.md` constraint: token-scan is insufficient); capability⇄use
consistency **both directions** vs `defineApp`; screen/`nav.push` target resolution; SDK lint
(e.g., `interval` without cleanup, §5.5); **the diagnostics catalog** — structured kinds +
fix hints (§8.1's `{kind, symbol, line, hint}` shape) shared via `contract/`; reuse the
storage engine's exported pure schema-diff as the generation-time schema check (#40).
**Out:** execution (that's #10); bundling (build pipeline exists).
**Constraints:** adversarial test fixtures authored under §16.4 discipline (not by the
implementing session).
**Read first:** `docs/spike2-findings.md`, spec §8.1–8.2, `build/build.mjs` (esbuild gotchas), `src/host/storage-engine/contract.ts`.

#### 10. `synthetic-run-harness` — Size M · Deps: none hard (lib-first; #8 to mount it)

**Status:** unproposed
**Why:** productionizes Spike 3 — the loop's "run + observe" stage.
**In:** boot a candidate bundle in the **real runtime page** (reuse `build/assemble.mjs`
artifacts + the invariants suite's headless-Chromium machinery); synthetic event stream —
mount initial screen, enumerate interactive elements, tap each, visit every screen; observe
from the **trusted vantage** (closure-captured, F4 — never the bundle's self-report): throws,
unhandled rejections, SDK warnings, gate denials, containment verdict; emit into the #9
diagnostics catalog.
**Out:** behavioral assertions (eval Tier B, #12); device execution.
**Constraints:** consume the real build artifacts; never loosen the page/CSP to ease testing.
**Read first:** `invariants/sandbox-isolation/`, `build/assemble.mjs`, decisions #35/#37/#41, spec §8.1 step 4–5.

#### 11. `generation-loop` — Size L · Deps: #8, #9, #10, SDK reference from #3 (+#4)

**Status:** unproposed
**In:** the orchestrated pipeline — **rewrite stage** (small model: casual → detailed prompt,
returned for device-side preview; approved text feeds the engineer model) → **plan** (structured
plan: screens/state/capabilities/storage keys; validated against the request, §8.1.1) →
**generate** (streamed) → **static check** (#9) → **synthetic run** (#10) → **repair ≤ 3**
(minimal-diff, diagnostics fed back) → verified bundle + **harness-validated app record**
(manifest + schema extraction — closes #41's "later: harness-validated"); prompt assembly
(SDK reference + token vocab + hand-curated few-shot examples); SSE stage events wired to #7's
states; token metering per device.
**Out:** agent memory/`LEARNED.md` (§9, post-v1), control modes, multi-model serving.
**Carryover (from `server-cancellation`):** the client-disconnect abort path already landed — both
`ReadableStream.cancel()` and `Request.signal` wire to one per-request `AbortController`, threaded
through `Pipeline.run(request, signal?)`, and the OpenRouter wrapper now accepts a `signal` and
captures the generation `id` from the first SSE chunk (`StreamResult.id`). Two things are left for
this change: (a) **LAN acceptance** — kill the device app mid-generation and confirm the server log
shows the abort, verifying `@hono/node-server` fires `Request.signal` on a real TCP disconnect (only
the `cancel()` surface is covered by deterministic tests today); (b) **usage reconciliation** — on
abort, poll `GET /api/v1/generation?id=<StreamResult.id>` for authoritative post-abort token counts
(retry until the record resolves). Cancellation stops upstream billing only on supported providers —
factor that into provider selection.
**Read first:** spec §8 entire, §10.1, #42 model strategy, #9/#10 contract notes.

#### 12. `eval-harness` — Size M · Deps: #1, #9; full value after #11

**Status:** unproposed
**In:** corpus runner CLI (on-demand, not CI — cost): **Tier A** deterministic gate (= #9 + #10
pass/fail); **Tier B** behavioral specs per corpus app, English-first then encoded; **Tier C**
LLM-judge against an English rubric + a human-eyeball protocol; visible/holdout protocol
(user runs the holdout; divergence = overfitting alarm, §16.4); diffable run reports (re-run
on every prompt/SDK change, §18); **the model bakeoff** — engineer candidates (strong baseline,
DeepSeek, et al.) and rewrite-model candidates, decided on corpus results → resolves #25's
open model choice.
**Out:** CI wiring of evals; corpus growth beyond Tier 0.
**Read first:** spec §16.3–16.4/§18, `docs/app-corpus.md`, #1's prompt seeds.

### Lane D — integration

#### 13. `v1-end-to-end` — Size M · Deps: all of the above

**Status:** unproposed
**In:** device↔server on a real network — **fresh-AVD spike** (non-Play image so `adb root`
works; retry `adb reverse` for plain HTTP/SSE — the Metro failure may have been dev-server-
specific) for daily dev, **real device on LAN for acceptance**; the full path: prompt →
rewrite preview → generate → deliver into a fresh realm → tagged snapshot → launcher install;
edit flow on an existing app (re-send source, minimal diff); kill/relaunch persistence;
**the v1 acceptance script**: generate ~5 corpus apps end-to-end on-device, each passing its
Tier-B spec; README/demo refresh.
**Read first:** everything's contract notes; DEVLOG build-gotcha sections.

---

## Wave plan (parallel windows; lanes touch disjoint trees)

- **Wave 1 — now:** #1 (quick, with user) ∥ #2 (lane A) ∥ #5 (lane B) ∥ #8 + #9 (lane C — two
  windows; disjoint: server scaffold vs pure lib).
- **Wave 2:** #3 → #4 (lane A) ∥ #6 then #7 (lane B; #7 wants #8's contract) ∥ #10 (lane C).
- **Wave 3:** #11 ∥ #12.
- **Wave 4:** #13, single window.

Within a lane, serialize. Proposals for independent changes can also be authored in parallel
(separate `openspec/changes/<name>/` dirs — no collisions). Propose **just-in-time per wave**,
not all 13 up front: later proposals should see earlier changes' as-built contracts.

## Post-v1 backlog (ordered, from the corpus + spec §6)

1. Animation/motion tier (flashcard flip ceremony, drinking roulette). 2. **Tier 1 — `ai.complete`**
(meal-plan generator, journal summary, fridge-to-recipe). 3. **Tier 2 — notifications/schedules**
(meal-plan alarm, full pour-over, med/plant reminders). 4. Control modes (§10.1) + examples
library / per-app `LEARNED.md` (§9). 5. **Tier 3a — curated HTTP** (weather day-picker).
6. Direct provider API + prompt caching for the chosen model. 7. Canvas/games (Tier 5).
8. Sharing track; iOS.

## Open deltas

*(Proposing sessions: record roadmap contradictions here instead of silently resolving them.)*

- 2026-07-02, change `sdk-design-system` (#3): shipped with a launcher-theming half (settings surface, persisted `ThemePref`, theme handed to delivery) that the 13-change list never mapped — it is neither #5 (`launcher-shell`, done before this) nor any later change. Owner-directed scope (unattended-run instruction); recorded here rather than restructuring the list. The #44 corpus-need rule was owner-waived for this change's exports (proposal.md records the waiver); the gallery fixture stands in as the use-case app.
