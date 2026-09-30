# DONE: sonar-r1-launcher-explicit-discard
Findings: S2, S5, S74-S76, S83, typescript:S9383, MAJOR.

Mark only the established fire-and-forget calls explicitly discarded. `runAppOp` releases its slot and the supplied open body catches its own failure; `runAttempt` catches and settles every generation failure; first-run seeding and the edit description reader already catch their expected failures; and the server-probe contract never rejects. Preserve first-run readiness/link-release order, Home fallback after a failed reopen, consent-retry routing, app-link safe exit, cancellation fences, and best-effort edit context. Do not include S22. Structural only; existing launcher and settings-probe coverage is the regression surface. No new test.
