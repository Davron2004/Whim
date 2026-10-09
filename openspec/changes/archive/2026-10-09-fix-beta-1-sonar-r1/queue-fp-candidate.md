# S29 false-positive rationale

- Current Sonar key: `AaDv2Gn6DHOwsfbTeJiM`.
- Rule/location: `typescript:S9383`, `server/src/routes/generate.ts:658`.
- Related source finding: S30 is current key `AaDv2Gn6DHOwsfbTeJiN`, `typescript:S7059`, same line; it remains source work in `queue-source.done.md`.
- Producer: `LineTicket.outcome` is documented never-rejecting in `server/src/admission/slots.ts:72-74`. Its only construction, `joinLine` at lines 223-227, captures only `resolve`; all later paths call `waiter.settle(...)`. There is no reject function.
- Observer: the current callback only writes the `LineOutcome` and calls a pending Promise resolver. Neither operation rejects in the ticket's real path.
- Boundary: move the observer out of the constructor for S30. Do not add `void`, a dummy rejection branch, an empty catch, or a synthetic error state solely for S29.
