# s4c-bar runner2 verdict: PASS (tip 21c6b3e4, BASE f7f5daf0)

1. Tree clean; attribution lines in f7f5daf0..HEAD: 0.
2. Fast gate (capped-run, 6144 MB): exit 0, "FAST GATE PASSED", `^FAIL` count 0, not CAPPED. Ratchet line: "removal ratchet: base 0ccd05d2 (merge-base with main, clamped to just before the ratchet); 152 changed verification file(s) compared", then PASS.
3. Chain-scoped ratchet (--base f7f5daf0): exit 0, "1 changed verification file(s) compared", PASS.
4. Integrity vs allowlist: exit 0, INTEGRITY OK.
5. Red-checks (npm run checks:test -- --only release, MainActivity.kt restored after each, status clean):
   (a) deleted one agreeBarAppearance() from the pre-draw listener: exit 1, the agreeBarAppearance guard cases failed (the "no longer agrees the bars' stores after the match" case, plus the real-project and temp-fixture cases).
   (b) API gate widened (VERSION_CODES.S -> R): exit 1, the "also runs on API 30" case failed (plus the real-project and temp-fixture cases).
6. :app:compileReleaseKotlin (taskpolicy -b, capped): exit 0, BUILD SUCCESSFUL.
Logs: scratchpad/runner2/{gate,red-a,red-b,kt}.log
