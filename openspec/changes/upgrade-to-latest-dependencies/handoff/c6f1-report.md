# c6f1 — F1: log the generation transport choice

## The line
Channel `whim:gen`, level `info`, message exactly `generate stream transport`, fields
`{ transport: 'xhr' | 'fetch' | 'injected', fetchCanStream: boolean }`. On device it renders as
`[whim:gen] generate stream transport {"transport":"xhr","fetchCanStream":false}` in logcat
(`ReactNativeJS`); grep `generate stream transport`. No URL, device id or request data in it.

## Why `info` reaches release logcat
`src/host/logging/index.ts:100` default threshold is `debug`; `:101` `console` mirroring defaults
true; `consoleWrite` (`:82-90`) sends non-warn records to `console.log`, which RN routes to logcat.
No product code calls `setLevel`/`setChannelLevel`/`createSeam` (grepped `src`, `App.tsx`), so no
release-only filter exists and `info` is emitted. (`warn` would also work but would misreport a
healthy path as a warning.)

## Where it fires
`openGenerateStream` in `src/host/launcher/generation-client.ts`, the single call site of the
transport choice (called once from `streamEvents`). Exactly once per stream open: no per-chunk
log and no retry loop inside it. A user-level retry calls `generateApp` again and so logs again,
which is correct (a new POST). Transport behavior is unchanged. The function is now exported with
an optional 4th parameter `canStream = fetchCanStream` (module-load value by default) so the
suite can drive the XHR choice, because Node's real `fetch` makes the module probe true.

## Test
Two cases at the end of `src/host/launcher/test/generation-client.suite.ts` (read via the seam's
ring buffer, `recordsSince`): (a) `canStream=false` opens the real built-in XHR transport and
yields one `info` line `{transport:'xhr', fetchCanStream:false}`; (b) `canStream=true` yields
`fetch`, and `generateApp` with an injected `streamTransport` yields `injected`, one line each.
Red-check: deleted the log call (grep count of the message 0), suite RED (4 checks failed,
"got []"); restored (count 1), `launcher:test --only generation-client` green, 294 checks.
`./scripts/gate.sh`: FAST GATE PASSED (includes lint + typecheck).

## HARNESS FEEDBACK
- ENV: `git diff --stat` cannot prove a deletion when the tree already carries the uncommitted change; grepping the deleted string is the real proof.
- NEUTRAL: the Node suite's capability probe is module-load fixed, so an optional parameter was the smallest seam for testing the XHR choice.
