# Context chains: harden-binding-provenance

<!--
  Three chains. The protected-file system (Class 1/2, HUMAN-BOOTSTRAP) was retired on 2026-09-21,
  so every chain is agent-executable. The gate's CONFIG_SET tripwire still refuses while
  invariants/, .claude/** or .codex/ differ from the base, so commit those edits before gating.
-->

## chain-2: invariants-binding-guard

- tasks: 2.1–2.3
- reads: design.md D2, D3, D6; handoff/invariants-binding-guard.md (scenario shape and red-check).
- writes-contract: none.
- after: none. Goes first: the detector must never land on a tree whose live binding it flags.
- files touched: `invariants/sandbox-isolation/bridge/runner.mjs`.

## chain-1: checks-binding-provenance-detector

- tasks: 1.1–1.5, 4.1
- reads: design.md D1, D2, Risks/Trade-offs; research.md "Pattern census".
- writes-contract: none.
- after: chain-2. The pre-fix proof is pinned to commit 754e2f7 rather than to live tree state, so
  the chain self-gates green against the guarded tree and the evidence stays reproducible.
- files touched: `checks/test/repo/binding-provenance.ts`, `checks/test/repo/binding-provenance.suite.ts`,
  `checks/test/acceptance.ts`, `openspec/critic/open-follow-ups.md`, `evidence-red-check.md`.

## chain-3: harness-research-primitive-amendments

- tasks: 3.1–3.5
- reads: design.md D5; research.md "How the research primitive failed across three runs";
  handoff/process-amendments.md.
- writes-contract: none.
- after: none. Shares no files with chain-1 or chain-2.
- files touched: `.claude/agents/researcher.md`, `.claude/commands/opsx/apply.md`,
  `openspec/schemas/whim-harness/schema.yaml`, `openspec/schemas/whim-harness/templates/research.md`,
  `.codex/agents/researcher.toml` (generated), `docs/capabilities.md`.

## Closure (not a chain)

Tasks 4.2–4.3: fast gate plus validate in the change worktree, `gate-full.sh` at the staging merge.
