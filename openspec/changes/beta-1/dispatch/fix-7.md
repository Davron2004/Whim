# fix-7: the device reader treats null on an optional field as absent (oldest-reader tolerance)

fix-6 found that `src/host/launcher/generation-client.ts#isClarifyResponse` (:132-138) rejects `limit: null` and
shows "Unexpected clarify response shape". Today's server never sends null (fix-6 tests the raw body), but beta-1
is the oldest reader every later server must serve (D16), and null on an optional field is a likely future
server shape. Rule: in the device's hand-rolled guards, `null` on any OPTIONAL field of a known message reads as
absent: clarify `limit`, `compat` on any event or unary body (`wire-compat.ts#gateMessage`: `compat: null` must
decode as "no compat", not as unreadable → `fail`), `summary` on `result`, `plan` on the rewrite response, and
the question `select`/`other` (already defaulted when absent). A required field that is null still fails the
guard. Add cases to `wire-future-frames.suite.ts` (null limit → the zero-question path; null compat on a known
event → used) and red-check against today's guards. Scope: `generation-client.ts`, `wire-compat.ts`, their tests.
