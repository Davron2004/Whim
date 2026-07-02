# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What Whim is

A React Native (Android-first) host app where users vibe-code tiny "mini-apps" by talking. Mini-apps are LLM-generated TypeScript targeting a private SDK (`vc-sdk`), executed inside a hardened WebView sandbox. The repo now spans both halves: on-device (sandbox runtime, SDK, storage engine, version store, capability bridge, launcher shell) and a stub server half (`contract/`, `server/`) for the future generation harness.

## Source of truth: docs/, not code

Architecture/decisions live in `docs/decisions.md` (numbered decision log, current through #43), `docs/spec.md`, `docs/spike2-findings.md`, and `DEVLOG.md` (raw lessons). Spikes record findings in docs and their scaffolds get deleted. **Before touching runtime / sandbox / bundle-execution / storage work, read the relevant decision first — don't re-litigate settled spikes.** `docs/spike2-findings.md` is required reading for anything touching the bundle contract: it lists five load-bearing constraints the runtime must honor. `docs/spec.md` is an explicitly stale "thinking document" (decision #42) — for current behavior, `docs/capabilities.md` + the spec it points to in `openspec/specs/` win over `spec.md` wherever they disagree.

Changes follow the OpenSpec workflow: live specs in `openspec/specs/`, proposals in `openspec/changes/` (archived to `openspec/changes/archive/` when done).

## Build harness (Opus dispatches, Sonnet implements, exit codes decide)

Two agentic loops share the same primitives. **`/dispatch <change-id>`** is the OpenSpec build loop (`docs/harness-build-guide.md`): a **researcher** subagent crawls code and returns a bounded digest; the **proposer** (this main thread, during `/opsx:*`) writes proposal/design/tasks/chains from digests; the **dispatcher** feeds one context chain at a time to **implementer** subagents and adjudicates; a **reviewer** audits diffs against reports; a **critic** (`/critic-run`) files a daily problems report. **`/fix-loop <findings>`** (`docs/parallel-fix-loop.md`, diagrams in `docs/coding-harness-diagram.md`) runs N mechanical fixes in parallel under `.Codex/worktrees/`: a planner scopes each finding, a `fix-worker` subagent (isolated worktree) writes the smallest fix + a non-vacuous test and self-gates, then the main-thread orchestrator red-checks, checks integrity against a **pinned BASE commit recorded at worktree creation** (never HEAD — once an agent can commit, a HEAD-diff tamper check is foldable into a clean tree), runs the full gate from the branch's committed tip checked out into the **main tree** (Metro can't resolve `node_modules` from an in-repo worktree, unlike Node/esbuild/tsc which walk up fine), and serializes the merge.

The mechanical definition of done is the **gate split**: `scripts/gate.sh` (fast — build + typecheck + lint + the Node suites + scaffolding tripwires, no Metro/Chromium) for every inner-loop attempt, `scripts/gate-full.sh` (full — `gate.sh` plus knip, `guard:metro`, the three Chromium invariant suites, `openspec validate`) once per change/fix before merge. Agents cannot edit the gate or its config — `.Codex/hooks/protect-harness.sh` hard-blocks subagents (and prompts the main thread) on `scripts/gate*.sh`, `scripts/fixloop.sh`, `.Codex/**`, `package.json`, `package-lock.json`, `tsconfig*.json`, `.eslintrc*`/`eslint.config.*`, `.eslintignore`, `knip.json`, `babel.config.js`, `metro.config.js`, and `build/*` (the build script runs inside the gate, so a tampered one runs arbitrary code there too). Those are human-edited in an editor. Information flows through files in the change folder (`research.md` → proposal artifacts → `chains.md` → `handoff/*.md` → `progress.md`), never through context.

Unattended/headless `/fix-loop` runs go through `.devcontainer/` (Docker, default-deny egress except the Anthropic API via `init-firewall.sh`) rather than the host OS sandbox — Chromium can't run under macOS Seatbelt, so the three Chromium-dependent commands are carved out of the host sandbox via `excludedCommands`, and that carve-out's safety assumption (a human sees the override prompt) only holds in an *attended, foreground* session — it silently doesn't fire in background/auto-mode (`docs/parallel-fix-loop.md` §6.7).

## Exploration policy
- The main thread NEVER crawls the codebase. If orienting requires reading more than 3 files, dispatch the `researcher` subagent and work from its digest. This applies with full force to all /opsx:* planning phases.
- Always read docs/capabilities.md first and pull only the specs it points to.
- During /opsx proposal/design: save the researcher digest to openspec/changes/<id>/research.md and cite it in design.md.

## Chain planning
After tasks.md is written, produce chains.md in the change folder: group tasks into context chains per the rules in any existing chains.md or, failing that: 3–7 tasks per chain, grouped by shared files/layer, sequential, each chain readable from spec excerpts + declared contracts only. Declare a writes-contract for every chain whose outputs a later chain consumes. A contract (`handoff/*.md`) is an interface — signatures, shared types verbatim, invariants, error surface — hard-capped at 60 lines, never a diary of how the chain did its work.

## Commands

```sh
npm run build              # esbuild → runtime HTML + bundles + artifacts (also verifies the source-map round-trip)
npm run invariants         # never-regress sandbox-isolation suite vs the CURRENT build (headless Chromium; run `npm run build` first)
npm run bridge:invariants  # sandbox-side capability-bridge invariants (headless Chromium)
npm run vstore:test        # version-store acceptance suite under Node
npm run storage:test       # storage-engine acceptance suite under Node (node:sqlite)
npm run bridge:test        # capability-bridge acceptance suite under Node
npm run launcher:test      # launcher acceptance suite under Node
npm run server:test        # generation-server acceptance suite under Node
npm run lint               # eslint
```

`npm test` is the untouched RN template jest script — there are no jest tests; the real suites are the ones above. `npm run guard:metro` is a CI-only check that the `contract`/`server` npm workspaces don't change what Metro resolves for the RN bundle (byte-size assertion). CI (`.github/workflows/invariants.yml`) runs two jobs as a blocking gate: `quality-gate` (typecheck, lint, knip, `openspec validate --all --strict`, scaffolding tripwires) and `isolation-suite` (every Node suite + `guard:metro` + `build` + all three Chromium invariant runners) — together, effectively `gate-full.sh`.

Regenerate after editing anything in `src/runtime/web/`, `src/sdk/`, `build/`, or `fixtures/`: `src/runtime/generated/*` and `build/generated/*` are auto-generated by `npm run build` — never edit them by hand.

### Android build & run

- **Node 22 required** (`engines: >=22.11`). Watch out: Homebrew's node sits ahead of the nvm shim in PATH, so `nvm use 22` may not actually switch — verify with `node -v`.
- Gradle is pinned to **JDK 21** via `org.gradle.java.home` in `android/gradle.properties` (JDK 24 breaks RN's C++ codegen). Builds are **arm64-v8a only** (`reactNativeArchitectures`).
- The emulator's NAT route to Metro is dead on this machine — use the **offline release build**: `npm run android:release` (debug-signed, no Metro dependency).
- RN 0.85 is bridgeless: JS `console` output goes to **logcat (`ReactNativeJS`)**, not Metro stdout, and logcat truncates at ~4 KB — the on-screen diagnostics render is the source of truth for full probe JSON.
- `App.tsx` renders `LauncherRoot` by default (the product shell), not a probe screen. On-device acceptance probes are flag-gated, default `false`: `RUN_VSTORE_PROBE` (version store), `RUN_STORAGE_PROBE` (storage engine, decision #40), `RUN_BRIDGE_PROBE` (capability bridge, decision #41).
- Desktop Chromium (the invariants suites) is the fast pre-check only; the authoritative containment verdict is the real Android System WebView on-device.

## Architecture

### Build pipeline (`build/`)

`build/build.mjs` is the local stand-in for the future server-side harness build. A mini-app is **one TS file that imports only `vc-sdk`** and `export default defineApp({...})` (see `fixtures/*.app.tsx`). esbuild emits it as a single IIFE with **classic JSX** (`React.createElement`) and externals `{vc-sdk, react, react-dom}` resolved at runtime from host-injected globals (the "H1b" contract), plus an external source map so errors map back to the original .tsx line. Gotcha: `tsconfigRaw: '{}'` is load-bearing — without it esbuild picks up the project tsconfig's `jsx: "react-jsx"` and emits `require("react/jsx-runtime")`, an off-allowlist specifier the resolver rejects.

`build/assemble.mjs` composes the runtime parts into a srcdoc + outer HTML → `src/runtime/generated/runtime-html.ts`, which `src/host/launcher/useMiniAppHost.ts` (via `MiniAppView`) loads into the WebView. It also emits `src/runtime/generated/runtime-artifacts.json` so the invariant suite generates its scenario pages against *this* build.

### Containment (`src/runtime/web/`)

Three legs, all load-bearing (Spike 1 finding):

1. Cross-origin `<iframe sandbox="allow-scripts">` **without** `allow-same-origin` → opaque origin, no host/native reach.
2. CSP `script-src` **without** `'unsafe-eval'` → kills `eval`/`new Function` *and* the `({}).constructor.constructor` prototype-walk, which global-stripping cannot close. **Never widen the CSP** (`blob:` script delivery stays refused). Conversely, never value-replace `Function`/`eval` — React's internals need them; CSP handles codegen.
3. Surgical neutralization of named network/storage/threading globals (`neutralize.js`) — strip the capability, not the identifier.

Runtime pieces inlined by the build: `neutralize.js`, `resolver.js` (allowlist module resolution), `probes.js` (containment checklist), `loader.js` (bundle delivery: channel (b) DOM-inserted inline `<script>`, fallback (a) srcdoc-inline), `syscall.js` (the capability-bridge's iframe-side marshaller — see below). A mini-app shares the iframe scope and **can forge its self-reported verdict** (finding F4) — the host only trusts frames authenticated with the per-realm nonce, and the trusted verdict comes from closure-captured probes. Reset = recreate the iframe; same-realm re-injection is known-poisoned.

The invariant suite (`invariants/sandbox-isolation/`) is the most important never-regress assertion in the codebase, including a negative control proving it isn't vacuously green. Invariants are authored by runtime owners, never by a feature-implementing agent.

### SDK (`src/sdk/`)

`vc-sdk`: semantic components (`Screen`, `Stack`, `Row`, `Text`, `Heading`, `NumberInput`, `Button`) + design tokens (`tokens.ts`) + web-resident timed effects (`delay`, `interval` — hooks, not handle-returning starters, so unmount/pause cleanup has no leak class to forget) + capability facades (`storage`, `cues`) that call through the bridge below. The contract is deliberately backend-agnostic — mini-apps never see HTML/DOM, so the WebView render backend can later be swapped for a native reconciler without breaking existing apps. Tokens not values, components not raw styles. Type-only re-exports from `storage-engine`/`bridge` (`JsonValue`, `StorageRecord`, `HapticKind`, …) cross that seam — never anything executable.

### Storage engine (`src/host/storage-engine/`)

Per-app SQLite user-data store — `@op-engineering/op-sqlite` on-device, `node:sqlite` in tests, behind a ~3-method `SqlExecutor` seam so the whole engine is proven on Node before a device exists. `contract.ts` declares a closed six-type field set (text/int/float/bool/date/json) and burned, never-reused field IDs (`BURNED_ID_RE = /^[a-z][0-9]+$/`) — schema evolution (add/rename/tombstone+reuse/rollback) is additive-only, so a rename is a display-name change, never a migration. `_meta` stores the *accumulated* schema (monotone union), not the last-applied artifact — overwriting it with a rolled-back artifact would break roll-forward. Test: `npm run storage:test`.

### Capability bridge (`src/host/bridge/`)

The governed-syscall boundary between sandboxed mini-apps and host capabilities (decision #41) — storage is syscall #1, `cues` (haptics/sound) #2/#3. `contract.ts` classifies every cross-frame message as `control` (nonce-authenticated lifecycle/nav, unchanged from v0.1) or `syscall`/`sysret` (the RPC envelope — authority comes from `ev.source === window.parent`, which a bundle can't forge by posting to itself, not from a nonce). `registry.ts` (append-only `CapabilityRegistry`), `gate.ts` (fixed-order denial), `dispatcher.ts` (generation-fenced: the host stamps the realm generation into the init handshake so a realm reset can't replay stale syscalls), `launch.ts`, `rows.ts` (per-capability row registration). Manifests are extracted at build time by re-bundling each fixture against the real SDK with react/react-dom stubbed (never rendered) — keeps the gated capability set and the declared one structurally identical, no second source of truth. Test: `npm run bridge:test`; sandbox-side: `npm run bridge:invariants`.

### Launcher (`src/host/launcher/`)

The product shell — `App.tsx` renders `LauncherRoot` by default. `AppIndex` (installed-apps record), `StoreAccess`/`storeIdOf` (the one sanctioned version-store access path), `BackPolicy` (a pure reducer guaranteeing system-back always resolves to an exit, never a trap or crash), `seedFirstRun` (first-run seeded example apps), `deliverBySourceJs` (bundle delivery from the store rather than a baked map — byte-identical to baked delivery, same loader/CSP/sandbox path, zero invariant edits). A fork shares the original's version-store repo (`storeId`) for history but gets its **own** launcher id as the storage-engine `appId` — get this backwards and a fork writes into the original's user data. Test: `npm run launcher:test`; desktop delivery-by-source parity: `npm run launcher:deliver-verify`.

### Version store (`src/host/version-store/`)

On-device snapshot store built on isomorphic-git running under Hermes. Public API (`index.ts`) speaks **product verbs only** — snapshot, history, rollback, pin, fork, diff; git vocabulary never crosses the surface. FS backends: `MemoryFs` (Node tests) and `KvBackedFs` over MMKV (device). Hermes needs `polyfills.ts` (`buffer` + `text-encoding-polyfill` + a `process` shim — Hermes ships `TextEncoder` but **not** `TextDecoder`) imported before isomorphic-git. isomorphic-git has no `gc`/`prune`, so `compaction.ts` does a DIY pack-then-drop-loose pass — the pressure point is loose-object count, not bytes.

### Generation contract & server (`contract/`, `server/`)

Two npm workspaces standing up the (currently stub) server half of the harness. `contract/` (`@whim/contract`) is a TS-source-only zod package, no build step — the single source of truth for device↔server wire shapes: `GenerateRequest`/`RewriteRequest`, the discriminated `GenerationEvent` union (`stage`/`token`/`diagnostic`/`usage`/`result`/`failure` — exactly one terminal event per stream), the `Diagnostic` envelope, `WireAppRecord`, `Usage`. `server/` (`@whim/server`) is a Hono app, LAN-dev-only: `POST /v1/generate` (SSE over a stub pipeline streaming a canned plan→generate→check→run sequence), `POST /v1/rewrite` (canned), `POST /v1/usage`; every `/v1/*` route is gated by an `x-whim-device` UUID header. Token metering is a durable `node:sqlite` store that survives restart. An OpenRouter streaming client wrapper exists (`openrouter.ts`) but is **unmounted** — no route imports it yet.
