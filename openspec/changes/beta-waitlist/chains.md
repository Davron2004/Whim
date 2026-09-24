# Context chains: beta-waitlist

The owner asked for this change to be built by one agent, so it is one chain. It is larger than
the usual 3–7 tasks but stays in one layer (server + pages-site build) with one vocabulary, and
nothing is gained by a handoff between two agents.

The page files (`deploy/site/beta*.html`, `deploy/site/assets/**`) came from the separate design
pass (`design-brief.md`) and are committed with this proposal. This chain wires and verifies them
and never restyles them (task 4.1).

## chain-1: server-beta-waitlist

- tasks: 1.1–5.3
- rationale: one route, its store, its limits, its operator command and the site/Caddy wiring that
  serves the form; all of it is server-side TypeScript plus deploy config sharing the waitlist
  vocabulary
- reads: specs/beta-waitlist/spec.md (all requirements); design.md §Decisions 1–10;
  design-brief.md §"Locked: the form contract"; research.md; handoff: none
- writes-contract: none
