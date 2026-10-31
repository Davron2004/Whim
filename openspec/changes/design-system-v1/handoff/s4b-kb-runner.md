# s4b-kb runner verdict (branch chain/design-system-v1-s4b-kb, tip 94897677, BASE a33565b1)

Overall: PASS

1. Clean tree (only .gitkeep); attribution lines in BASE..BRANCH: 0.
2. Fast gate `capped-run.sh --mb 6144 --secs 3000 -- scripts/gate.sh`: exit 0, "FAST GATE PASSED", no ^FAIL, no CAPPED.
3. `FIXLOOP_INTEGRATION_BRANCH=integration/beta-2 scripts/fixloop.sh integrity ... s4b-kb.txt`: exit 0, INTEGRITY OK
   (changed: handoff/s4b-kb.md, KeyboardShell.tsx, test/keyboard-shell-ui.suite.tsx).
4. Removal ratchet (base a33565b1): PASS, 1 changed verification file, no `authorised:` lines.
5. Red-check (weaker F1 variant: Android ask loop `keyboardWillShow` -> stop, blur handling kept),
   `npm run launcher:test -- --only keyboard-shell-ui` (--mb 4096): exit 1, 6 failures (Android 14 and 17 each):
   "the show ended hidden, so the next frame asks again..." (got [3,false] want [4,true]);
   "once the keyboard is up it asks no more"; "a show that reports nothing after it set off is asked for again".
   Restored with git checkout; tree clean.
Note: the launcher runner ran the whole launcher list (619 checks) despite --only; the 6 failures are all keyboard-shell-ui.
