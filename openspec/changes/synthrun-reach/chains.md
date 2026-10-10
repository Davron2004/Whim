# Context chains: synthrun-reach

This change runs as a side track on one branch, `fix/synthrun-reach`, in one worktree. The chains
are sequential and each implementer commits on that branch; there is no per-chain branch and no
merge onto the staging branch from here. No chain touches Class-2 files.

## chain-1: delivery-replies

- tasks: 1.1–1.4
- rationale: one file of product code (`synthrun/session.ts`) and the suite's fixtures and isolation tests; everything later depends on replies arriving
- reads: specs/synthetic-run/spec.md §"A capability reply reaches the candidate realm"; design.md D1, D8; evidence.md §3; handoff: none
- writes-contract: handoff/fixtures.md

## chain-2: sweep-hit-test

- tasks: 2.1–2.6
- rationale: the per-screen loop in `synthrun/sweep.ts`, its report counts and the quiet wait
- reads: specs/synthetic-run/spec.md §"The sweep acts only on an element that can receive the action", §"Interaction sweep covers the interactive surface with fingerprint dedup", §"Watchdog makes every timeout an explicit outcome"; design.md D2, D3, D4, D7; handoff: handoff/fixtures.md
- writes-contract: handoff/sweep-loop.md
- after: chain-1

## chain-3: sweep-order-and-coverage

- tasks: 3.1–3.8
- rationale: fingerprint labels and order, and what the sweep reports for an unreached screen; same file as chain-2, so it follows it
- reads: specs/synthetic-run/spec.md §"The sweep enters values before it presses commands", §"Screen coverage follows real navigation, then cold-mounts the rest", §"Interaction sweep covers the interactive surface with fingerprint dedup" (per-path limit, toast host, labels), §"One candidate in, one deterministic run report out"; design.md D5, D6, D7, D9; handoff: handoff/fixtures.md, handoff/sweep-loop.md
- writes-contract: none
- after: chain-2

## chain-4: spec-sync-and-closing

- tasks: 4.1–4.3
- rationale: documentation and verification once the code is final; run by the orchestrator with a builder for 4.1
- reads: specs/synthetic-run/spec.md (whole delta); handoff: none
- writes-contract: none
- after: chain-3
