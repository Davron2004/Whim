# Context chains: beta-waitlist

The owner asked for this change to be built by one agent, so it is one chain. It is larger than
the usual 3–7 tasks but stays in one layer (server + pages-site build) with one vocabulary, and
nothing is gained by a handoff between two agents.

The page files (`deploy/site/beta*.html`, `deploy/site/assets/**`) belong to the separate design
pass (`design-brief.md`). This chain creates stand-ins only if they're absent (task 4.1) and never
restyles them. The design pass touches nothing else, so the two never write the same file after
the stand-ins exist.

## chain-1: server-beta-waitlist

- tasks: 1.1–5.2
- rationale: one route, its store, its limits, its operator command and the site/Caddy wiring that
  serves the form; all of it is server-side TypeScript plus deploy config sharing the waitlist
  vocabulary
- reads: specs/beta-waitlist/spec.md (all requirements); design.md §Decisions 1–10;
  design-brief.md §"Locked: the form contract"; research.md; handoff: none
- writes-contract: none
