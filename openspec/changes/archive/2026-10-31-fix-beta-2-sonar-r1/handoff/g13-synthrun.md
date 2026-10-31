# g13-synthrun handoff

All fixes are structural (no behavioral delta; regression = synthrun suite).

S83: fixed (structural) optional chain `el.style?.position`
S86: fixed (structural) `String.raw\`\$&\`` (same string `\$&`)
S88: fixed (structural) `firstActionableIndex` no longer async; returns the evaluate promise
S89: fixed (structural) for-of over `Array.from(options)`
S125: fixed (structural) for-of over `Array.from(children)`
S305: fixed (structural) `dispatch: () => Promise.resolve(null)`
S307: fixed (structural) `getScreenInfo` no longer async
S308: fixed (structural) `enumerateInteractiveElements` no longer async
S22: accept-proposed
S23: accept-proposed
S24: accept-proposed
S54: accept-proposed
S84: accept-proposed
S85: accept-proposed
S87: accept-proposed
S101: accept-proposed
S126: accept-proposed
S170: accept-proposed
S171: accept-proposed
S306: accept-proposed
S309: accept-proposed
S310: accept-proposed

## Accept proposals
S84, S85 (sweep.ts 755, awaitToastGone): poll loop re-probing page state until a deadline, 30 ms sleep between probes; each probe depends on the previous result.
S22, S23 (sweep.ts 770, awaitBackdropGone): same bounded poll.
S306 (sweep.ts 141, findAppFrame), S126 (228, awaitSettledScreen), S87 (399, awaitMotionStill), S309 (912, waitForNewMount): bounded deadline polls; they return at the first satisfied probe, so they are sequential by definition.
S24 (sweep.ts 853, sweepLive): the awaited backdrop wait follows the action just performed on the single shared page; the sweep is one-action-at-a-time by design.
S101 (998, navigateBack in the back-step loop): each pop must settle before the next step is decided (nav-depth read after each); one page, ordered.
S54, S310 (1045/1046, cold-mount loop): each declared screen is cold-mounted onto the single shared page/observers and swept; concurrent mounts would race the same iframe.
S170, S171 (session.ts 289/297, launchBrowser): launch retry loop; each attempt must follow the previous failure and the retry delay.

## Red-check
none: all structural

## Commands
- `npx eslint --max-warnings 0 synthrun/sweep.ts synthrun/capability.ts`: exit 0
- `npm run -s synthrun:test` (capped-run, whole runner): exit 0
- `npm run -s typecheck` (capped-run): exit 0

## Deviations
none
