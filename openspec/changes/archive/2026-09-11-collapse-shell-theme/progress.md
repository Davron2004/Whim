# Ledger: collapse-shell-theme

- 2026-09-11 docs authored in parallel with chain-1's implementation; both land on PR #31
  (branch `cleanup/worktree`), not a run-staging branch: the harness hooks were switched off
  on 2026-07-30 (`c7592cb`) and the owner asked for the change appended to the open PR.
- chain-1 implemented in the primary tree by one builder; docs by a second on disjoint files.
- Independent verifier: `./scripts/gate.sh` green; tripwire red-checked three ways (palette prop,
  `as ShellPalette` cast, `useTheme` call, and a "theme picker" comment in a new file), each
  failure naming the file; `openspec validate --all --strict` 37/37; delivery path diff empty.
- Independent reviewer: no rendered-value drift, delivery contract intact. Findings fixed before
  commit: docs undercounted the removed palette parameters; spec lacked the delivery carve-out;
  tripwire regex had cast/generic false negatives; walk could pass vacuously; stale
  `shellPalette()` mention in `src/sdk/theme.ts`.
- Commits: `e7d4052` (code), docs commit following. `./scripts/gate-full.sh` on the committed tip:
  FULL GATE PASSED.
