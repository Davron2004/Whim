# Tasks: sdk-navigation

## 0. Human bootstrap — test lane and harness repair

- [x] 0.1 Add a first-class `sdk:test` runner under `src/sdk/test/` that discovers and executes `*.acceptance.ts(x)` suites independently, uses the repository's esbuild-to-temporary-module pattern with `tsconfigRaw: '{}'`, externalizes React and `react-test-renderer`, and fails vacuously when no suite exists
- [x] 0.2 Add a permanent SDK smoke acceptance, add the `sdk:test` package script, and wire `sdk:test` into `scripts/gate.sh` so SDK acceptance is part of every fast gate
- [x] 0.3 Repair `.claude/hooks/bash-policy.sh` by safely normalizing exact simple-command `git -C <absolute .claude/worktrees/<id>> ...` forms before all Git security checks, then applying the existing ownership binding; preserve tier-1 denies, compound-command fallback, traversal/nested-path rejection, and universal read-only behavior; update Codex worktree-agent contracts to use narrow per-command sandbox escalation for mutating linked-worktree Git
- [x] 0.4 Add a tracked non-vacuous bash-policy regression suite covering same-agent bind/allow, second-agent denial, main-tree denial, malformed/traversal/nested `-C`, tier-1 `push`/`config` denial, and compound-command fallback; wire it into `scripts/gate.sh`
- [x] 0.5 Preserve PARK recovery notes as ignored runtime state, run the new focused suites, `scripts/sync-codex.mjs --check`, `openspec validate sdk-navigation --strict`, and `scripts/gate.sh`; commit this bootstrap as the clean BASE before dispatching feature chains
- [x] 0.6 Replace Codex's incompatible PreToolUse symlinks with provider-specific Bash, PermissionRequest, and `apply_patch` adapters; keep Claude hooks unchanged, add provider-parity tests to the fast gate, and update mirror invariants/documentation
- [x] 0.7 Add an attended root-only Codex Class-2 approval lane: user-routed prompt, exact SHA-256 patch binding, immutable Git-private snapshot, one-shot authority, categorical subagent denial, and a non-vacuous fast-gate regression suite; repair all newly surfaced lint findings without globally weakening a rule

## 1. SDK nav primitive

- [x] 1.1 Add the module-scope nav emitter and the `nav` object (`navigate(screenName)`, `back()`) to `src/sdk/index.tsx` — additive barrel export, isolated from the `sdk-charts` export region (design D1/D2)
- [x] 1.2 Implement the SDK-owned nav root component: `useState`-backed stack initialized to `[spec.initial]`, renders `spec.screens[top]`, subscribes to the emitter on mount (design D2)
- [x] 1.3 Implement depth-hint emission: post `{__whimNavDepth:true, depth, generation: window.__whimGeneration}` via `parent.postMessage` on every stack-length change (design D3; shape verbatim from `NavDepthFrame`, type-only import if referenced)
- [x] 1.4 Implement `__whimNavBack` consumption: in-realm `message` listener pops one entry; tolerate stray frames at depth 0 as a no-op (design D3)
- [x] 1.5 Implement unknown-target handling: `navigate` to an undeclared screen is a no-op with a console warning naming the target and the declared screens (design D4)
- [x] 1.6 SDK acceptance tests under `src/sdk/test/navigation.acceptance.tsx`: stack semantics (push/pop/duplicate push/no-op back at 0), depth-hint emission on every change, navBack pop, unknown-target warn+no-op — exercised exclusively by the bootstrapped `sdk:test` lane, with no wiring through `checks/test/acceptance.ts`; red-check at least the depth-emission test against the pre-change SDK
- [x] 1.7 Align nav-back consumption with the existing host wire contract: parse the JSON-string `message` payload produced by `window.__whimControl.navBack()`, validate `{__whimNavBack:true}`, ignore malformed/non-object/unknown payloads, update SDK acceptance with the serialized production shape, and revise `handoff/nav-api.md`

## 2. Runtime loader mount path

- [x] 2.1 Change `window.__whimAfterBundle` in `src/runtime/web/loader.js` to mount the SDK nav root (`render(createElement(NavRoot, {spec}))`) instead of the fixed `spec.screens[spec.initial]`; keep the `mountedGen` guard and `delivery`/`paint` semantics untouched (design D2); minimal diff — no other loader changes
- [x] 2.2 Update the loader nav-seam anchor comment (lines 43–54) to reflect that the SDK now emits/consumes the frames; keep the frame-shape documentation verbatim
- [x] 2.3 `npm run build` to regenerate `src/runtime/generated/*` and `build/generated/*` (never hand-edit); confirm the source-map round-trip check passes
- [x] 2.4 Run `npm run invariants` and `npm run bridge:invariants` against the fresh build — all probes green, zero modifications under `invariants/` or `build/`

## 3. Static-check shapes row

- [x] 3.1 Add `{object: 'nav', method: 'navigate', argIndex: 0}` to `NAV_CALL_SHAPES` in `checks/contract.ts` (no row for `back` — design D4)
- [x] 3.2 Update the checks acceptance suite: dangling-target and non-literal-target scenarios now exercised via the shipped row (keep or retire the test-injected row per what the suite's negative control needs); red-check the dangling-target case against the empty-table baseline

## 4. Specs, docs, and end-to-end verification

- [x] 4.1 Add the `sdk-navigation` row to `docs/capabilities.md` pointing at the new spec; append the decision-log entry for nav landing (recovered #3 scope, `nav` object over hook, no params in v1)
- [x] 4.2 Author a multi-screen fixture app (list → detail via `nav.navigate`, back via `nav.back`) under `fixtures/`, regenerate, and verify end-to-end in headless Chromium: navigate → depth-1 frame observed, navBack → initial screen renders (this fixture doubles as synthetic-run-harness test material)
- [x] 4.3 Run `scripts/gate.sh`; resolve anything red

## 5. Full-gate closure

- [x] 5.1 Under a human-ratified Class-1 grant, add the independently discovered `src/sdk/test/*.acceptance.ts` and `*.acceptance.tsx` suites as knip entrypoints (do not ignore them), prove `npx knip` and `scripts/gate.sh` pass, then rerun the full gate
