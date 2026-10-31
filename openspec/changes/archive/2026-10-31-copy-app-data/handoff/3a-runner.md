# 3a runner verdict: PASS

Branch chain/copy-app-data-3a, BASE 482985d7. Attribution lines in BASE..BRANCH: 0. Worktree clean at start.

1. Fast gate (capped-run --mb 6144 --secs 3000 scripts/gate.sh): exit 0, "FAST GATE PASSED", no ^FAIL lines.
2. Integrity (fixloop.sh integrity, FIXLOOP_INTEGRATION_BRANCH=integration/beta-2): exit 0, INTEGRITY OK; 11 files changed, all in allowlist.
3. Removal ratchet (base 482985d7): PASS, no `authorised:` lines.
4. Red-check: store-access.ts hasSavedData asks entry.id instead of engineAppId(entry); `npm run launcher:test -- --only saved-data` exit 1; failed:
   - "the member's answer is the group's: it has saved data (got false, want true)"
   - "the read was asked of the group store id (got 'a__fork-1', want 'a')"
   Restored with git checkout; tree clean.
5. knip (npx knip, --mb 4096 --secs 600, in worktree): exit 0, no output. It does NOT flag the new hasSavedData export as unused.
