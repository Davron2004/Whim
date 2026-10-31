# 236 runner verdict: PASS

1. Preflight: worktree clean; 0 Co-Authored-By/attribution lines in df7d770f..chain/design-system-v1-236 (2 commits). No stray node process.
2. Fast gate: capped-run (6144MB/3000s) scripts/gate.sh -> "FAST GATE PASSED", exit 0, 0 `^FAIL` lines. Log: scratchpad/logs/gate-236.log
3. Integrity: fixloop.sh integrity chain/design-system-v1-236 allow/236.txt -> INTEGRITY OK, exit 0. Changed: docs/design/system.md, handoff/236.md, specs/app-launcher/spec.md, shell-controls-ui.suite.tsx, GroupedList.tsx.
4. Removal ratchet (base df7d770f): PASS, exit 0, no `authorised:` lines.
5. Red-check: in GroupedList.tsx flipper(), replaced `!(direct && nativeBuzz)` with `true` (iOS direct-switch skip never applies); `npm run launcher:test` (4096MB/1500s) -> 19711 passed, 1 failed:
   "ios: the switch itself flipped (got [ 'impact:light,1,TOGGLE_ON' ], want [])" (the #236 test). File restored via git checkout, status clean.

Overall: PASS
