# fix-13b independent review

Range: `34c866650b821ea70d4469c7a1d7bdad7fbe0551..4892fc5c`.

VERDICT: clean
REPORT HONESTY: matches diff
FINDINGS: none
SPEC CONFORMANCE: conforms

Only KeyboardShell and its existing rendered UI suite changed. Reveal requests coalesce to a frame; stale scheduled and measured callbacks are invalidated. Keyboard completion requests another reveal. Unmount removes the listener and cancels work; blur cancels only its own target, so an old blur cannot cancel a newly focused field. Interactive/on-drag modes are unchanged.

Both native-layout orderings are modeled through observed scroll geometry: the old code clamps against the old viewport and leaves the row hidden, while a frame or keyboard-completion recheck reveals the complete row. The tests also cover typing, refocus, no self-scheduling loop, and blur cancellation. Separate native red evidence is preserved in `acceptance/ios-repro-resume/`.

No config, generated or shared-helper edits were found. The reviewer did not rerun a suite during the root's gate lease. Final rebuilt device timing remains to be verified.
