# Progress: fix-list-keys-simplify-harness

- 2026-07-15: Validated proposal, design, SDK design-system delta, tasks, and two disjoint implementation chains. Main base: `0ffda318e33268989bbffc74ff1584efdd873810`.
- 2026-07-15: Dispatched `sdk-list-reconciliation` at base `0ffda318e33268989bbffc74ff1584efdd873810` in `.claude/worktrees/fix-list-keys-simplify-harness-sdk-list-reconciliation`.
- 2026-07-15: Dispatched `node-harness-direct-accounting` at base `0ffda318e33268989bbffc74ff1584efdd873810` in `.claude/worktrees/fix-list-keys-simplify-harness-node-harness-direct-accounting`.
- 2026-07-15: `node-harness-direct-accounting` committed `4dc428a`; fast gate and integrity check passed, then merged as `chain(fix-list-keys-simplify-harness): node-harness-direct-accounting`.
- 2026-07-15: `sdk-list-reconciliation` committed `788a41b`; SDK acceptance and fast gate passed, integrity check passed, then merged as `chain(fix-list-keys-simplify-harness): sdk-list-reconciliation`.
- 2026-07-15: Full gate passed build, typecheck, lint, all Node suites, static checks, Metro, Codex checks, and OpenSpec validation. Its three Chromium checks fail under the host macOS sandbox (`bootstrap_check_in ... Permission denied`); direct bridge and delivery verification passed with browser permission, while the isolation runner did not return a completion record in this environment.
- 2026-07-15: Independent review of `0ffda31..HEAD` found no code findings. The reviewer mutation-tested the new repeated-primitive `List` acceptance test by changing its wrapper key to the child value; React emitted the expected duplicate-key diagnostic and the test failed as intended.
