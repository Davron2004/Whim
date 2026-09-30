# DONE: launcher age and retry failures

Findings: S22 and S75 (`typescript:S9383`, `LauncherRoot.tsx:1106,1058`).

Age persistence must settle the check without changing the age decision. A failed age-outcome or guardian-acknowledgment write keeps the derived result in this legal-flow pass: `under-13` and `minor-not-approved` remain blocked; `unavailable` and allowed results retain their existing flow. Do not log the raw signal, age result, or write error. On a later action the missing record naturally causes a new on-device check. Preserve the three-second native deadline, the sixty-second guardian deadline, the successful stored shape, and the rule that only the outcome reaches local storage.

The retry continuation must not leave a rejected promise or a stranded build screen when attempt setup fails before a stream exists. It must show the established generic, content-free generation failure, make no request, and preserve the pre-existing failed ghost and journal when retry setup never begins. It must not manufacture a retry/discard record for a fresh build whose pending record was not created. Keep the retry's same-id behavior and all delivered, cancelled, and terminal-stream paths unchanged. If setup can fail after writing one sibling record, preserve the single-writer and pending/journal pairing rather than silently presenting a false `building` state.

Add two observable regressions:
1. a throwing KV `set` in the age suite proves the returned gate remains each observed blocked result and no raw age data is persisted;
2. the rendered retry test makes pending-record creation throw before writing, then proves no `/v1/generate` request, the old failed ghost and journal remain, and the generic failure screen contains none of the storage error text.

The test must exercise the real retry trigger, including the continuation that resumes after consent. It must not assert a private helper or a copied literal. One fast gate and the later full gate cover both findings.
