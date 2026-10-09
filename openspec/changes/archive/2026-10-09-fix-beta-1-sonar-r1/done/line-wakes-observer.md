# DONE: sonar-r1-line-wakes-observer
Findings: S29, S30, typescript:S9383/S7059, MAJOR/CRITICAL.

Move the never-rejecting LineTicket outcome observation out of LineWakes construction. Preserve one wake per settled outcome; pre-settlement registration before the wait loop; the pending-wake set; abort, slot, drain, and timeout priority; and the microtask check of a ticket already at position zero. Do not change S31/S32's serial awaits: their false-positive disposition is recorded separately. Structural only; existing routes-generate queue/abort/drain coverage is the regression surface. No new test.
