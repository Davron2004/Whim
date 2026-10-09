Terminal-recovery adjudication for `f80392a9099a5b5229ef9be24d0e2d4e2a144755..2cc74989c414a91ecaeacac39cf1498e47dd0774`

A partially failed rollback is fixable within the existing DONE scope when MMKV can still accept a later pending-record write. The pending record, not the journal or `liveRef`, is the lifecycle authority. After a failed terminal write and unsuccessful old-pair rollback, the launcher can independently try to persist the actual generic `failed` pending record. It must read that record back and use the readback to decide the UI.

If that generic pending write succeeds, the resulting state is truthful: Home will render a `failed` ghost, and reopening it uses the generic persisted failure. The journal may be absent, empty, or stale because its write failed; it must not decide the ghost state. The live generic failure should carry `recordId` only after this pending readback succeeds. It should withhold `journalId`, because no terminal journal was verified. An identity-free generic failure is appropriate only when no persisted pending state was verified; it cannot make the later Home rendering truthful.

Concrete acceptance fault selection:

1. Seed the old failed pending/journal pair and start the real Retry -> consent -> Agree stream, as in the added test.
2. Once setup has recreated the record, end the stream with no terminal event.
3. Make the MMKV predicate reject the new generic `journal:failed` terminal value, then reject restoration writes whose values exactly equal `journalBefore` and `pendingBefore`. Allow a later `pending:failed` value containing `GENERIC_STREAM_ERROR`.
4. Assert one request, no unhandled rejection, generic content without the native error, a read-back `pending:failed` record with `state: 'failed'` and the generic reason, no claimed terminal journal, and a failed ghost after Back. This is a separate recovery boundary from the existing test, which permits both old-pair restores.

That case needs no visible spec or architecture change. It uses the existing generic failure, current record states, and the existing independent `recordId`/`journalId` screen fields. It must not infer completion from `liveRef`; the finished stream and the persisted pending readback are the relevant evidence.

The fully unwritable case has a hard limit. If the old-pair restore and the generic pending fallback both fail, the raw record remains `building`. Current requirements make Home render every raw pending record, reserve deletion for delivery/cancel/dismiss, reserve `interrupted` for persisted process-loss demotion, and provide no sanctioned volatile lifecycle projection. The code cannot guarantee that Back avoids the dead building ghost without a new degraded-storage policy and rendering mechanism. The fix should cover the recoverable selective-write case above; a requirement to guarantee durable correctness while every relevant MMKV write fails needs a spec-visible architecture decision.

This addendum narrows the earlier high finding: it remains blocking for recoverable partial writes, including the unhandled update-fallback and refusal branches, but it should not demand an impossible guarantee under a fully unwritable store.
