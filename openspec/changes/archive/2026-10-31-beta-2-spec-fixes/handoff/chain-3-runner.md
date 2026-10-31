# chain-3 runner verdict (branch chain/beta-2-spec-fixes-3, tip 255d9b92)
Verdict: FAIL (gate), integrity/ratchet/attribution clean.
- gate.sh: FAST GATE FAILED: fixloop preflight (log: scratchpad/runner-3-gate.log). Only failing step.
  - FAIL "the park is reported" and "the note resumes in the primary tree": output printed the expected text (PARKED ... / PRIMARY working tree) but the test emitted
    `scripts/test/fixloop-preflight.test.sh: line 80: printf: write error: Broken pipe` (SIGPIPE from grep -q under load) -> likely test flake, unrelated to chain-3 files. Not re-run per rules.
  - All other gate steps passed (SDK motion, protected-patch, scaffolding tripwires, etc.). No #232 seen.
- integrity (allowlist c3-allow.txt, base 9ec4bd3b): INTEGRITY OK, exit 0; changed = exactly the 9 allowlisted files.
- removal ratchet: PASS (exit 0).
- Co-authored-by count: 0.
