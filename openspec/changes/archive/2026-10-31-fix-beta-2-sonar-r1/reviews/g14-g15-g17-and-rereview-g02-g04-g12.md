# VERIFY g14 / g15 / g17 and RE-VERIFY g02 rev1 / g04 doc / g12 rev1 (Opus medium)

- g14-deploy: ACCEPT. `[`→`[[` conversions keep meaning (all RHS quoted/numeric; no -a/-o; quoted vars); `whim_uptime_var_name` works on bash 3.2 (printf -v; tr classes). [LOW] the handoff wrongly says no test covers deploy/lib.sh: server/test/deploy-config.suite.ts does (gate.sh runs it). [LOW] deploy-config.suite.ts:3374 swaps in text with the stale `$uptime_PERIOD_MINUTES` name (still checks the right thing; out of allowlist; follow-up). accept: S297, S298, S299.
- g15-ios: ACCEPT. Swift extractions type/capture-safe by reading (static funcs in an enum; Swift 5). [LOW] AppDelegate.swift ships and was only parse-checked: one simulator build recommended before the release PR. accept: S81, S82.
- g17-palette-py: ACCEPT. No findings; output byte-identical.
- g02-launcher-screens (rev 1): ACCEPT. Tests for S44/S49 added (red on BASE); null guard fixed; HomeScreen `.catch` `String(e)` on `any` will not be re-flagged. [LOW] HistoryScreen.tsx:103 `?'non-Error` formatting. accept: S52.
- g04-fixtures (doc fix): ACCEPT. [LOW] latency-probe.app.tsx:75 `.catch((e: unknown) => ... String(e))` may be re-flagged S6551 (explicit unknown). [LOW] duplicate `## Red-check` heading. accept: S96, S128, S129, S313-S316, S319.
- g12-version-store (rev 1): ACCEPT. S304 sequential again (Accept, memory); S317 exact `new Promise` form; test pins the original Error. accept: S303, S304, S322, S323, S325-S329.
