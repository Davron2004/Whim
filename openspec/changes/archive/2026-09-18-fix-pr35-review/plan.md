# Fix plan

Use isolated worktrees, behavioral regressions, independent review, and serialized integration. Do not let a broken workflow step substitute for testing or stop unrelated fixes. No protected config changes or new dependencies are planned.

- [x] F01 — Release unary capacity on all completion paths; reproduce settlement failure through both real routes.
- [x] F02 — Preserve all rewrite-attempt usage in the durable request ledger; verify stored token counts.
- [x] F03 — Associate connectivity success with the originating configuration; exercise late responses after reconfiguration.
- [x] F04 — Reject incomplete and incorrectly refused load-test outcomes; cover valid below/at/above-cap results.
- [x] F05 — Generate supported SVG/PNG assets with correct metadata; exercise actual PNG input.
- [x] F06 — Require HTTPS on download and redirect; retain fingerprint validation.
- [x] F07 — Test firewall command behavior and meaningful broken-rule mutations with harmless command stubs.
- [x] F08 — Replace weak launcher source scans with interaction tests using existing dependencies.
- [x] F09 — Remove test-only probe synchronization from production while retaining cancellation/debounce regressions.
- [x] F10 — Replace mutable-value/count/comment pins with checks of required outputs and configuration propagation.

Server ownership: routes/clarify, routes/rewrite, loadtest/drive and their existing suites.
Client ownership: src/host/launcher.
Release ownership: release asset tooling/suite, VM bootstrap and deployment suite.

Each lane must demonstrate relevant red-before-green behavior, run its subsystem suites, and commit a reviewable result. Review each lane independently, integrate without altering main, then run the combined checks. Leave any device-only acceptance explicitly outstanding.
