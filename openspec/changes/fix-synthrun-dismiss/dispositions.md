# Dispositions: fix-synthrun-dismiss

Nested on the active staging branch `integration/beta-2` (no second staging branch cut). One finding: F185 (#185).

## Ledger

- 2026-10-19T21:15Z F185 planning — read-only planner dispatched (opus, effort high)
- 2026-10-19T21:22Z F185 planned — defect live at HEAD; the issue's hypothesis (dismiss transition covers the control) refuted by `surfaces.tsx:1048` (exiting backdrop is pointer-events:none); cause (a) late close vs (b) lost click unconfirmed
- 2026-10-19T21:22Z F185 escalated — not mechanical-lane: the fix adds a timed wait the synthetic-run spec's "A toast is the one cover that leaves by itself" clause and its determinism bound describe, so it needs a delta (whim-harness change); and the cause must be reproduced first. Next: an instrumented reproduction under load after chain-16l reports (CPU spinners would starve its simulator builds), then a whim-harness change. Recorded on #185.
