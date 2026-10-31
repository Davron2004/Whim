# 3b1r runner verdict (re-run, tip acca7b7f, BASE 20d7a0f9)

Overall: PASS

1. Clean tree (only untracked .gitkeep); Co-Authored-By/attribution lines BASE..BRANCH: 0.
2. Fast gate: capped-run.sh --mb 6144 --secs 3000 -- scripts/gate.sh -> exit 0, "FAST GATE PASSED", `grep -c '^FAIL'` = 0.
3. Integrity: FIXLOOP_INTEGRATION_BRANCH=integration/beta-2 scripts/fixloop.sh integrity chain/copy-app-data-3b1r allow/3b1r.txt -> exit 0, "INTEGRITY OK".
4. Removal ratchet (base 20d7a0f9): PASS, exit 0. One authorised line:
   authorised: src/host/storage-engine/test/saved-data.suite.ts: assertions 29 -> 26, tests 10 -> 9 -- fbfb4553 Check-removal (ruling 40 REVISED). No other drops.
5. Red-check (ruling 41): declarationOf made to also call getSnapshot (whole-snapshot read); `npm run vstore:test` via watchdog -> exit 1 with:
   - the manifest and the schema are each read once (got [2,2], want [1,1])
   - the code, the source and the prompt are never read (got [1,1,1], want [0,0,0])
   - and neither reads its code (got 2, want 0)
   Restored with git checkout; tree clean again (only .gitkeep).
Logs: scratchpad/logs/gate-3b1r.log, red-3b1r.log.
