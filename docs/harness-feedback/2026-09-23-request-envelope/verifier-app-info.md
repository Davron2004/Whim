# verifier-app-info: harness feedback, request-envelope 2026-09-23

## Blocks, stops and detours
- **What:** `timeout` command not found on macOS, blocking the given iOS launch recipe.
- **Mechanism:** build recipes (Part B step 4 used `timeout 25 ...`)
- **Verdict:** ENV
- **Cost:** ~1 tool call, ~1 minute (switched to background+sleep+kill instead)
- **Evidence:** `(eval):9: command not found: timeout`

- **What:** JS `console.log` from the iOS Release build was not visible via `simctl launch --console-pty` nor via plain `log show`/`log stream` without `--info`; it only surfaced under subsystem `com.facebook.react.log` with `log show --info`. Spent several rounds concluding the app had crashed (checked ps aux, crash reports, screenshots) before finding the real log location.
- **Mechanism:** instructions given (Part B step 4 recipe assumed `--console-pty` or a plain predicate would surface the probe line)
- **Verdict:** DRAWBACK (cost with no catch — app was fine the whole time, console-pty output looked empty by design not by failure)
- **Cost:** ~10 tool calls, ~10-15 minutes (screenshot checks, crash-report search, ps aux, multiple log show variants)
- **Evidence:** line only found via `log show --last 5m --predicate 'eventMessage CONTAINS "WHIM"' --info --debug`

## What the harness should change
- Update the iOS verification recipe to use `xcrun simctl spawn <udid> log stream/show --info --predicate 'eventMessage CONTAINS "<marker>"'` directly instead of `--console-pty`, since RN 0.85 Release JS console output goes through unified logging (`com.facebook.react.log`) at Info level, not process stdout.
- Note the macOS-has-no-`timeout` gotcha (use `perl -e 'alarm ...'` or background+sleep+kill) in shared verifier tooling notes so it isn't rediscovered per run.
