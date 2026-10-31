# Review: F177 (`fix/F177` @ 8c086237)

Reviewer: Opus, effort high, 2026-10-30. Saved by the integration orchestrator.

VERDICT: reject (two scheduling races remain; DONE "cannot fail from scheduling delay alone" not met). Q1 protocol followed, no retries/longer timeouts; Q2 non-vacuous (mutation 1), descheduled-after-marker escape is pass-only; Q4 no hang/leak path (withTimeout :135, finally kills child, marker under mkdtemp); Q5 `waited >= HOLD_MS/2` replaced by a stronger `doneAt >= committedAt - 25`; Q6 handoff honest (missed the races, didn't hide them).

## HIGH
1. copy.suite.ts:259-260: the child takes its timestamp AFTER `COMMIT` and `db.close()`. The lock is gone once COMMIT returns; a child preempted >25 ms lets the parent write and record `doneAt` first → `committedAt > doneAt + 25`, :308 fails with a correct engine. Done: the child records `const t = Date.now()` BEFORE `db.exec('COMMIT')` and prints that value (the parent cannot return before `t` by causality). The 25 ms slack may stay as clock-granularity margin or go. Mutation (1) must still fail.
2. copy.suite.ts:284-289: the `lines()` helper rejects on `'exit'` when `committed` hasn't been seen. Node fires `'exit'` before stdio drains, so exit and the final stdout data can arrive in either order → false failure. Done: reject on `'close'` (or stdout `'end'`), still re-checking `seen` first; the `held` wait may keep the same handler.

## LOW
3. plan.md F177 prescribes the post-COMMIT timestamp (orchestrator corrects the plan).
- Note: after the `held` wait the `data` listener is removed while the stream keeps flowing; nothing is lost today (the only later output is `committed`, emitted after the marker, which is written after the second listener is attached).
