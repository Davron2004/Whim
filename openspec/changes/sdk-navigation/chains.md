# Context chains: sdk-navigation

## chain-0: human-bootstrap-test-and-ownership

- tasks: 0.1–0.7
- marker: HUMAN-BOOTSTRAP — separate attended main-tree session; touches Class-2 `scripts/gate.sh` and `.claude/hooks/**` plus Class-1 `package.json`; never dispatch to an implementer
- rationale: establish the dedicated SDK acceptance lane that makes chains 1 and 3 genuinely file-disjoint, and repair the Codex worktree ownership failure before any subagent must stage a commit
- file-scope: `src/sdk/test/run.mjs`, `src/sdk/test/smoke.acceptance.ts`, `package.json`, `scripts/gate.sh`, `.claude/hooks/bash-policy.sh`, `.claude/hooks/test/bash-policy.test.sh`, `.codex/config.toml`, `.codex/hooks.json`, `.codex/hooks/*.sh`, `.codex/hooks/test/*.test.sh`, `.codex/rules/protected-patch.rules`, `.eslintrc.js`, `build/build.mjs`, `scripts/sync-codex.mjs`, `.gitignore`, `CLAUDE.md`, `docs/harness.md`, and the `sdk-navigation` planning/ledger/contract artifacts
- reads: design.md D0; docs/harness.md §4/§5/§10 + operational gotchas; handoff: none
- writes-contract: handoff/human-bootstrap.md (the `sdk:test` discovery/execution contract, fast-gate command, exact supported `git -C` worktree form, ownership and rejection invariants)

## chain-1: sdk-nav-primitive

- tasks: 1.1–1.6
- rationale: all edits live in `src/sdk/` (emitter, `nav` object, nav root, tests) and share the SDK vocabulary; the bootstrapped `sdk:test` runner discovers the nav acceptance directly, so this chain never touches `checks/test/acceptance.ts`; no build regeneration here — generated artifacts are owned by chain-2/chain-4 to avoid worktree conflicts
- file-scope: `src/sdk/index.tsx`, `src/sdk/test/navigation.acceptance.tsx`, `openspec/changes/sdk-navigation/handoff/nav-api.md`
- reads: specs/sdk-navigation/spec.md §Requirement: Mini-apps navigate via the `nav` object, §Navigation is a stack rooted at `initial`, §Depth changes emit the untrusted depth hint, §System back pops the stack, §Unknown targets degrade never crash; design.md D1–D5; handoff: handoff/human-bootstrap.md
- writes-contract: handoff/nav-api.md (the `nav` object surface, the nav-root export name/signature the loader mounts, the exact frame shapes emitted/consumed, the emitter's mount-subscription contract)
- after: chain-0

## chain-2: runtime-loader-mount

- tasks: 2.1–2.4
- rationale: the loader diff, the anchor-comment update, the regeneration, and the invariants runs are one working context — the containment-surface edit and its verification must not be split
- reads: specs/sdk-navigation/spec.md §Navigation adds no containment surface, §Navigation is a stack rooted at `initial` (mount-once semantics); design.md D2/D3 + Risks (loader is containment surface); handoff: handoff/nav-api.md
- writes-contract: none

## chain-3: static-checks-row

- tasks: 3.1–3.2
- rationale: pure `checks/` data-table addition + its acceptance tests; different layer and files from chains 1–2, dependency-free (the row is data over source strings, independent of the SDK implementation), so the dispatcher may run it in parallel with chain-1
- file-scope: `checks/contract.ts`, `checks/passes/screens.ts`, `checks/test/acceptance.ts`
- reads: specs/static-checks/spec.md §Requirement: Screen graph resolves statically (MODIFIED); design.md D0/D4; handoff: handoff/human-bootstrap.md
- writes-contract: none
- after: chain-0

## chain-4: fixture-docs-verify

- tasks: 4.1–4.3
- rationale: end-to-end closure — the multi-screen fixture, capabilities/decision-log rows, and the gate run need the merged SDK + loader + checks state; touches `fixtures/` and regenerated artifacts (same generated files as chain-2, hence the explicit ordering)
- reads: specs/sdk-navigation/spec.md (all requirements, as the e2e checklist); handoff: handoff/nav-api.md
- writes-contract: none
- after: chain-2, chain-3
