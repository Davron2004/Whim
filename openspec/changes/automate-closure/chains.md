# Context chains: automate-closure

Most of this change edits Class-2 protected paths (`.claude/hooks/**`, `.claude/settings.json`, `.claude/commands/**`, `scripts/gate.sh` wiring) — those chains are HUMAN-BOOTSTRAP: not dispatchable; the main thread applies their edits with the human ratifying each protected write, batched per chain. Dispatchable chains (4, 6) run normally. Chains 1, 2, 4 are mutually independent and may proceed in parallel.

## chain-1: bootstrap-github-sonar (HUMAN-BOOTSTRAP, out-of-repo)

- tasks: 1.1–1.3
- rationale: one-time external state (GitHub ruleset, SonarCloud token) that everything downstream assumes; no repo files touched
- reads: specs/staging-integration-lane/spec.md §Scoped push policy (ruleset shape); specs/sonar-issue-ingestion/spec.md §Authorization visibility; handoff: none
- writes-contract: none (outcome is external state; chain-7 verifies it)

## chain-2: hook-unroller (HUMAN-BOOTSTRAP)

- tasks: 2.1–2.4
- rationale: the parser helper, its bash-policy integration, and its adversarial suite are one vocabulary (tokenizer grammar, verdict lattice) and one file cluster (`.claude/hooks/unroll-command.mjs`, `bash-policy.sh` integration point, suite files). The suite's one-line `scripts/gate.sh` wiring is deferred to chain-5's edit list.
- reads: specs/compound-command-policy/spec.md (all requirements); design.md §D1; handoff: none
- writes-contract: handoff/unroller-api.md (helper CLI/exit contract: input line → segments JSON | not-unrollable; verdict lattice; redirect pseudo-segment shape)

## chain-3: remote-policy (HUMAN-BOOTSTRAP)

- tasks: 3.1–3.5
- rationale: the push/gh/Tier-1 decision matrix in `bash-policy.sh` plus its `settings.json` sandbox/permissions counterpart are a single policy surface; splitting them risks a matrix half-updated
- reads: specs/staging-integration-lane/spec.md §Scoped push policy, §main receives only the final ratified merge (local `gh pr merge` deny); design.md §D2–D3; handoff: handoff/unroller-api.md
- writes-contract: handoff/remote-policy.md (exact allowed/ask/deny command shapes per caller class; sandbox carve-out list; env passthrough names)
- after: chain-2 (both edit `bash-policy.sh`; serial merge required)

## chain-4: sonar-script (dispatchable)

- tasks: 4.1–4.3
- rationale: `scripts/sonar-pr-issues.mjs` + its mocked-HTTP Node suite are self-contained (SonarCloud API vocabulary, findings-file format); touches no protected path. The suite's one-line `scripts/gate.sh` wiring is deferred to chain-5's edit list.
- reads: specs/sonar-issue-ingestion/spec.md (all requirements); design.md §D6; handoff: none
- writes-contract: handoff/sonar-script-cli.md (CLI args, env contract, output format, exit codes incl. the distinct auth-visibility failure)

## chain-5: closure-runbooks (HUMAN-BOOTSTRAP)

- tasks: 5.1–5.3, plus the two deferred `scripts/gate.sh` wiring lines (chain-2's unroller suite, chain-4's Node suite)
- rationale: `apply.md` step 12, `git-cleanup.md`, and `fix-loop.md`'s closure section are one narrative that must reference identical command shapes and script CLI; gate wiring rides along as the only remaining protected edits
- reads: specs/staging-integration-lane/spec.md §External quality iteration, §History cleanup, §main receives only the final ratified merge; design.md §D4–D5; handoff: handoff/remote-policy.md, handoff/sonar-script-cli.md
- writes-contract: none
- after: chain-3, chain-4

## chain-6: docs (dispatchable)

- tasks: 6.1–6.2
- rationale: `docs/harness.md` amendments and the `docs/decisions.md` entry document the final policy and runbook state; unprotected paths, pure prose
- reads: proposal.md; design.md §D1–D6; specs (all three); handoff: handoff/remote-policy.md
- writes-contract: none
- after: chain-5 (documents the runbook text as landed, not as planned)

## chain-7: verification (HUMAN-BOOTSTRAP, process)

- tasks: 7.1–7.2
- rationale: whole-change verification — `gate-full` on the integrated tip, then the first supervised end-to-end closure run with the human present but executing nothing
- reads: tasks.md §7; handoff: handoff/remote-policy.md, handoff/sonar-script-cli.md
- writes-contract: none
- after: chain-1, chain-5, chain-6
