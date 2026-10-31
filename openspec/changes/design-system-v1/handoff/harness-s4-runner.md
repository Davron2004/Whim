# harness-s4 runner verdict - PASS (partial: #238 red not reproduced)

1. Clean tree (only .gitkeep); Co-Authored-By/attribution lines in BASE..BRANCH: 0.
2. Fast gate (capped-run, 6144 MB/3000 s): FAST GATE PASSED, exit 0, no ^FAIL lines.
   Log: scratchpad/logs/gate-harness-s4.log
3. Integrity (FIXLOOP_INTEGRATION_BRANCH=integration/beta-2 fixloop.sh integrity): INTEGRITY OK, exit 0.
   No CONFIG_SET file changed; no file outside the allowlist.
4. Removal ratchet (base ded0b62b): PASS, 19 changed verification files, no `authorised:` lines.
5. Red-check (a): title-match-keeps-call rule removed in scripts/lib/only-filter.mjs
   (`|| unit.titles.some(...)` dropped); `node checks/test/run.mjs --only only-filter` -> PASS 9, FAIL 3 (fails as required).
   Restored via git checkout; tree clean.
6. Red-check (b) #238 under load: 10 busy-loop spinners (hw.ncpu=10), BASE copy of
   fixloop-preflight.test.sh (git show ded0b62b) 10 runs: 0 red; tip 10 runs: 0 red.
   "Broken pipe" in any log: 0. => red not reproduced on BASE (a fact for #238, not a FAIL).
   Spinners killed by PID; temp copy removed; tree clean.
