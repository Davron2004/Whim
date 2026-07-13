# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Whim is

A React Native (Android-first) host app where users vibe-code tiny "mini-apps" by talking. Mini-apps are LLM-generated TypeScript targeting a private SDK (`vc-sdk`), executed inside a hardened WebView sandbox. The repo now spans both halves: on-device (sandbox runtime, SDK, storage engine, version store, capability bridge, launcher shell) and a stub server half (`contract/`, `server/`) for the future generation harness.

## Source of truth: docs/, not code

Architecture/decisions live in `docs/decisions.md` (numbered, append-only decision log — read the file for the current tail; never cite a count, counts rot), `docs/spec.md`, `docs/spike2-findings.md`, and `DEVLOG.md` (raw lessons). Spikes record findings in docs and their scaffolds get deleted. **Before touching runtime / sandbox / bundle-execution / storage work, read the relevant decision first — don't re-litigate settled spikes.** `docs/spike2-findings.md` is required reading for anything touching the bundle contract: it lists five load-bearing constraints the runtime must honor. `docs/spec.md` is an explicitly stale "thinking document" (decision #42) — for current behavior, `docs/capabilities.md` + the spec it points to in `openspec/specs/` win over `spec.md` wherever they disagree.

Changes follow the OpenSpec workflow: live specs in `openspec/specs/`, proposals in `openspec/changes/` (archived to `openspec/changes/archive/` when done).

## Build harness (exit codes decide; canonical reference: `docs/harness.md`)

**`docs/harness.md` is the single source of truth for the coding harness** — roles, trust model, enforcement map, both loops, and the do-not-re-derive gotchas. The superseded design docs live in `docs/archive/` (kept for spike evidence); diagrams in `docs/coding-harness-diagram.md`. The integration branch is **`main`** (`dev/v1` was merged and retired 2026-07).

Two agentic loops share the same worktree-parallel primitives. **`/opsx:apply <change-id>`** is the OpenSpec build loop and routes by schema (`/dispatch` no longer exists — it was folded in): `whim-harness` changes get the chain dispatch loop (runbook: `.claude/commands/opsx/apply.md`) — one **implementer** subagent per context chain from `chains.md`, each in an orchestrator-created worktree branched from `main`, self-gated, integrity-checked, serially merged with a post-merge regate, then `gate-full.sh` + a **reviewer** pass; `whim-fixloop` changes route to **`/fix-loop <findings>`** (runbook: `.claude/commands/fix-loop.md`) — N mechanical fixes in parallel under `.claude/worktrees/`, each red-checked, integrity-checked against a **pinned BASE commit recorded at worktree creation** (never HEAD), full-gated from the branch's committed tip checked out into the **main tree** (Metro can't resolve `node_modules` from a worktree), and serially merged. The main thread NEVER implements inline. A **critic** (`/critic-run`) files a daily problems report; `/git-cleanup` is the history-rewrite lane.

The mechanical definition of done is the **gate split**: `scripts/gate.sh` (fast — build + typecheck + lint + the Node suites + scaffolding tripwires, no Metro/Chromium) for every inner-loop attempt, `scripts/gate-full.sh` (full — `gate.sh` plus knip, `guard:metro`, the three Chromium invariant suites, `openspec validate`) once per change/fix before merge. Agents cannot edit the gate or its config — `.claude/hooks/protect-harness.sh` hard-blocks subagents (and prompts the main thread) on `scripts/gate*.sh`, `scripts/fixloop.sh`, `scripts/git-cleanup-check.sh`, `scripts/sync-codex.mjs`, `.claude/**`, `.codex/**`, `package.json`, `package-lock.json`, `tsconfig*.json`, `.eslintrc*`/`eslint.config.*`, `.eslintignore`, `knip.json`, `babel.config.js`, `metro.config.js`, `invariants/`, and `build/*` (the build script runs inside the gate, so a tampered one runs arbitrary code there too). Class 2 is human-ratified: subagents are always denied; an attended Codex root task with `approvals_reviewer = "user"` may apply one exact SHA-256-bound patch through `.codex/hooks/apply-reviewed-protected-patch.sh`, whose prompt, root-transcript binding, immutable Git-private snapshot, one-shot grant, and denial/replay/TOCTOU/rename tests are enforced by the fast gate. Direct protected `apply_patch` remains denied. Information flows through files in the change folder (`research.md` → proposal artifacts → `chains.md` → `handoff/*.md` → `progress.md`), never through context.

Cross-agent mirror: `AGENTS.md` is a **symlink** to this file. The protocol-compatible Codex stop hook symlinks to its Claude source; Codex PreToolUse/PermissionRequest hooks are provider adapters because Codex does not support Claude's bare `allow`/`ask` outputs and `apply_patch` has a different input shape. `.codex/agents/*.toml` are **generated** from `.claude/agents/*.md` by `scripts/sync-codex.mjs` (`--write` after editing an agent; `gate-full.sh` runs `--check`). See `docs/harness.md` §10.

Unattended/headless `/fix-loop` runs go through `.devcontainer/` (Docker, default-deny egress except the Anthropic API via `init-firewall.sh`) rather than the host OS sandbox — Chromium can't run under macOS Seatbelt, so the three Chromium-dependent commands are carved out of the host sandbox via `excludedCommands`, and that carve-out's safety assumption (a human sees the override prompt) only holds in an *attended, foreground* session — it silently doesn't fire in background/auto-mode (`docs/archive/parallel-fix-loop.md` §6.7).

## Exploration policy

- The main thread NEVER crawls the codebase. If orienting requires reading more than 3 files, dispatch the `researcher` subagent and work from its digest. This applies with full force to all /opsx:* planning phases.
- Always read docs/capabilities.md first and pull only the specs it points to.
- During /opsx proposal/design: save the researcher digest to openspec/changes/<id>/research.md and cite it in design.md.

## Chain planning

After tasks.md is written, produce chains.md in the change folder: group tasks into context chains per the whim-harness schema's chain rules or, failing that: 3–7 tasks per chain, grouped by shared files/layer, each chain readable from spec excerpts + declared contracts only. Declare a writes-contract for every chain whose outputs a later chain consumes, plus an explicit `after:` for any ordering contracts don't capture — the dispatcher parallelizes dependency-free chains, so two undeclared-independent chains must never touch the same files. Mark Class-2-touching chains HUMAN-BOOTSTRAP. A contract (`handoff/*.md`) is an interface — signatures, shared types verbatim, invariants, error surface — hard-capped at 120 lines, never a diary of how the chain did its work.

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
npm run sdk:test           # independently-discovered vc-sdk acceptance suites under Node
npm run lint               # eslint
```

`npm test` is the untouched RN template jest script — there are no jest tests; the real suites are the ones above. `npm run guard:metro` is a CI-only check that the `contract`/`server` npm workspaces don't change what Metro resolves for the RN bundle (byte-size assertion). CI is effectively `gate-full.sh` on every push — see `docs/harness.md` §4.

Regenerate after editing anything in `src/runtime/web/`, `src/sdk/`, `build/`, or `fixtures/`: `src/runtime/generated/*` and `build/generated/*` are auto-generated by `npm run build` — never edit them by hand.

### Android build & run

- **Node 22 required** (`engines: >=22.11`). Watch out: Homebrew's node sits ahead of the nvm shim in PATH, so `nvm use 22` may not actually switch — verify with `node -v`.
- Gradle is pinned to **JDK 21** via `org.gradle.java.home` in `android/gradle.properties` (JDK 24 breaks RN's C++ codegen). Builds are **arm64-v8a only** (`reactNativeArchitectures`).
- The emulator's NAT route to Metro is dead on this machine — use the **offline release build**: `npm run android:release` (debug-signed, no Metro dependency).
- RN 0.85 is bridgeless: JS `console` output goes to **logcat (`ReactNativeJS`)**, not Metro stdout, and logcat truncates at ~4 KB — the on-screen diagnostics render is the source of truth for full probe JSON.
- `App.tsx` renders `LauncherRoot` by default (the product shell), not a probe screen. On-device acceptance probes are flag-gated, default `false`: `RUN_VSTORE_PROBE` (version store), `RUN_STORAGE_PROBE` (storage engine, decision #40), `RUN_BRIDGE_PROBE` (capability bridge, decision #41).
- Desktop Chromium (the invariants suites) is the fast pre-check only; the authoritative containment verdict is the real Android System WebView on-device.

## Architecture map & standing invariants

The subsystem map is `docs/capabilities.md` (one line per capability → its spec); rationale and history are `docs/decisions.md` + `docs/spike2-findings.md`. Do not re-derive architecture from code — pull the spec the map points to. What follows is only the **never-violate list**, each with its source:

- **Containment is three legs** (spike2 §security model; decisions #35/#37): opaque-origin sandboxed iframe, CSP without `unsafe-eval`, surgical global neutralization. **Never widen the CSP** (`blob:` script delivery stays refused). **Never value-replace `Function`/`eval`** — React's internals need them; CSP handles codegen.
- **Only nonce-authenticated frames are trusted** — a bundle can forge its self-reported verdict (finding F4, spike2 §3). Realm reset = **recreate the iframe**, never re-inject (spike2 §5).
- **`invariants/` is owner-authored** — never edited by a feature-implementing agent; its negative control keeps it non-vacuous (#28).
- **Bundle contract (H1b — spike2, #37):** one TS file importing only `vc-sdk`, emitted as a single IIFE with classic JSX, externals `{vc-sdk, react, react-dom}` from host-injected globals. esbuild gotcha: `tsconfigRaw: '{}'` is load-bearing — without it the project tsconfig's `jsx: "react-jsx"` leaks in and emits an off-allowlist `require("react/jsx-runtime")`.
- **SDK (`vc-sdk`):** tokens not values, components not raw styles (#13); backend-agnostic — mini-apps never see HTML/DOM (#11); `delay` is a Promise, `interval` a hook, so timer cleanup has no leak class (#43); type-only re-exports cross the SDK↔engine seam — never anything executable.
- **Storage engine (#38/#40):** closed field-type set, burned never-reused field IDs, additive-only evolution — a rename is a display-name change, never a migration; `_meta` stores the *accumulated* schema (monotone union), never the last-applied artifact.
- **Capability bridge (#41/#43):** syscall authority = `ev.source === window.parent`, not a nonce; registry is append-only; dispatcher is generation-fenced (a realm reset can't replay stale syscalls); manifests are extracted at build time — no second source of truth.
- **Launcher (#43b):** a fork shares the original's version-store repo but gets its **own** storage-engine `appId` — reversed, a fork writes into the original's user data. `StoreAccess` is the one sanctioned version-store access path.
- **Version store (#36/#39):** the public API speaks product verbs only — git vocabulary never crosses the surface; Hermes polyfills must be imported *before* isomorphic-git.
- **Server (`capabilities.md` → generation-contract/generation-server):** exactly one terminal `GenerationEvent` per stream; every `/v1/*` route is gated by the `x-whim-device` header.
