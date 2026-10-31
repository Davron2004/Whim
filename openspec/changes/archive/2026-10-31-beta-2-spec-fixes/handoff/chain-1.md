# chain-1 server-stream-open-frame — handoff

## What changed
- `server/src/sse.ts`: `buildSseStream`'s `start()` enqueues `: keepalive\n\n` once, right
  before it arms the interval, when keepalives are on (`keepaliveMs` > 0). No `id:`, so event ids
  still start at 1. Doc comment updated. Off (0/undefined): nothing written at open or after.
- `server/test/server-core.suite.ts`: new section "SSE writes a keepalive frame as the stream
  opens" (`testSseOpeningFrame`). A source held on a controllable promise (no sleeps):
  with keepalive on, the first chunk read is exactly `: keepalive\n\n`, then after release the event
  follows ending `id: 1`; with `keepaliveMs` 0 and undefined the first chunk is the event, no comment.

## Red-check
Removed the enqueue: the case fails fast ("got 'no first byte', expected ': keepalive'"),
log `/Users/davrondjabborov/.cache/whim-run/c1-red2.log`. Restored afterwards.
Note: my first version of the test used a bare `reader.read()`; with the enqueue removed it
still passed, because the 60 s interval eventually fired (suite took 8 min, green). The first
read is therefore wrapped in `within(...)` so a missing opening frame fails instead of waiting.

## Checks run
- `npm run server:test` (watchdog): 5176 passed, 0 failed (includes e2e suite).
- eslint --max-warnings 0 on both files: clean. `tsc --noEmit -p .`: clean.
- 1.3: `loadtest/drive.ts` already skips `:` lines (line 57) and measures first REAL event;
  `flowbench.mjs` and the e2e files have no keepalive/first-byte expectation. No edits needed.

## For the runner's curl E2E
Server default keepalive is whatever `createApp({keepaliveMs})` / config sets; with
`WHIM_STUB_DELAY_MS=20000`, `curl -N` should print `: keepalive` immediately, then `event:` at ~20 s.

## Deviations
none
