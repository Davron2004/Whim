# Review LOWs fix batch (branch chain/beta-2-spec-fixes-lows, BASE f25f56ec)

1. SSE opening-frame test: the two bare `reader.read()` calls in `testSseOpeningFrame` now go through `within(...)`; a timeout makes the named check fail (`second/first !== TIMED_OUT`). `npm run server:test` exit 0.
2. `server/src/sse.ts` `@param keepaliveMs` doc now says a frame is also written as the stream opens. Doc only.
3. `--device` with no value, an empty value or `--device=` now refuses with exit 2 ("`--device` needs a serial"); `flagSerial` returns `''` for a valueless flag. New unit case in `checks/test/release/android-dev-script.suite.ts`.
   Red-check: guard condition neutralised, `npm run checks:test` gave `PASS 439 · FAIL 1` (the new case, fell back to the "no device named" message). Restored: `PASS 440 · FAIL 0`, exit 0.
4. `specs/native-release-config/spec.md`: two scenarios now `npm run android:release -- --device …`, names unchanged. `openspec validate beta-2-spec-fixes --strict` valid on the repo version and on 1.14.1.
5. `prompt-flow-ui.suite.tsx`: before the 30 s no-stall assertion, `waitHeld(() => page().props.now === clockBase + 30_000, 'the page to redraw at 30 s')`.
   Red-check: with `STALL_MS = 25_000`, `npm run launcher:test` failed "keepalives with no event for 30 s are no stall yet" (exit 1; also an unrelated 60 s case that depends on 40 s, expected). Restored via `git checkout`; `npm run launcher:test` exit 0.

Also: typecheck OK, eslint --max-warnings 0 on touched files rc 0. Test counts only grew (+1 case in checks).
Logs: /Users/davrondjabborov/.cache/whim-run/lows-*.log
