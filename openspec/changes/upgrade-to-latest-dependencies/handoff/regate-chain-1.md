REGATE: chain-1 merged tip 8022d32f
VERDICT: PASS
NODE: v22.23.5
GATE: exit 0; FAST GATE PASSED yes; ratchet PASS (base 193e5f83, 4 changed verification files compared; ratchet suite also PASS); FAIL lines: none (only "FAIL 0" counters and test titles containing "FAILURES")
FINDINGS: none. HEAD was 8022d32f and status clean before the run. No CAPPED/137.
HARNESS FEEDBACK: NEUTRAL - gate ran ~20.8k log lines without trouble under the 6144 MB / 1500 s watchdog; no env issues. DRAWBACK (minor): grep for "FAIL" matches many passing test titles; a distinct failure marker (e.g. "FAIL:" prefix only) in the gate would ease runner triage.
