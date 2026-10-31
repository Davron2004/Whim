# g01-firestore-loop handoff

S178: fixed (structural) - `String.raw` for the shell-quote escape; verified a `'` in an argument still reaches the script as `'\''`.
S294: fixed (structural) - `freePorts` opens the four probe servers concurrently (`holdPort`), then releases them together; ports are now guaranteed distinct, so the dedup Set loop is gone.
S295: fixed (behavioral-in-form, no test home) - `for (...; ; ...)` became `for (let attempt = 1; attempt <= ATTEMPTS; attempt++)`; the in-body `attempt === ATTEMPTS` exit is kept, so the loop is bounded by its own condition and the exit code is unchanged.
S296: accept-proposed

## Accept proposals

S296: the retry loop must await each `runOnce()` before deciding to retry; the next attempt cannot start until the previous emulator run has ended and its output was inspected for "port taken". Running attempts concurrently would defeat the purpose (and start several emulators).

## Red-check

none: no test file in this lane's allowlist and no suite covers this script's retry path (the S2189 change preserves behavior: the old loop exited via `process.exit` on attempt 3 at the latest, the new one does too). The script itself was run end-to-end against the real emulator.

## Commands run

- `capped-run.sh -- npm run -s stores:firestore:test` (before lint fix): exit 0, 62 passed, 0 failed
- `capped-run.sh -- npx eslint --max-warnings 0 scripts/firestore-emulator-test.mjs`: first run exit 1 (sonarjs nested template / nested functions, fixed), then exit 0
- `capped-run.sh --mb 3072 --secs 170 -- npm run -s stores:firestore:test` (final code): exit 0, 62 passed, 0 failed
- `node scripts/firestore-emulator-test.mjs "/tmp/it's here.mjs"`: script path with an apostrophe quoted correctly (`'/tmp/it'\''s here.mjs'`)
- `capped-run.sh --mb 3072 --secs 170 -- npm run -s typecheck`: exit 0

## Deviations

- S294 was fixed by changing the port-picking strategy (hold all four then release) rather than just dropping the await; the original sequential loop could re-hand the same port, which is why it needed a Set.
