# chain-1 runner verdict (branch chain/separate-shared-data-1, tip 901b4365, BASE 124e5173)

Overall: PASS

1. Tree clean (only untracked .gitkeep); attribution/Co-Authored-By lines BASE..BRANCH: 0.
2. Fast gate `capped-run.sh --mb 6144 --secs 3000 -- scripts/gate.sh`: exit 0, "FAST GATE PASSED", `grep '^FAIL'` empty. Log: scratchpad/logs/gate-chain-1.log
3. `FIXLOOP_INTEGRATION_BRANCH=integration/beta-2 scripts/fixloop.sh integrity chain/separate-shared-data-1 allow/ssd-1.txt`: exit 0, INTEGRITY OK.
4. Removal ratchet (base 124e5173): exit 0, PASS; no `authorised:` lines.
5. Red-check: removed the `AppGoneError` -> `settleAppGone` branch in settleUnexpectedAttemptFailure (LauncherRoot.tsx), so it falls through to the normal failure settle. `capped-run.sh --mb 4096 -- npm run launcher:test -- --only changing-in-use`: exit 1. Deleted-app cases FAILED (7 failed assertions: "left no record, no journal and no report" (record shown as failed), "the person is on Home"; plus the "at its tip, on Home, storage refuses to remove its record" case threw "timed out waiting for the leftover to be armed"). Restored with git checkout; tree clean again.
6. `npx openspec validate separate-shared-data --strict` (1.4.1): exit 0, valid.
