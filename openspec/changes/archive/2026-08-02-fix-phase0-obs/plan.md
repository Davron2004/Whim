# Plan: fix-phase0-obs

Three disjoint-file lanes over the six findings in findings.md. Per-lane DONE specs are filled
in by the read-only planners; a checkbox is ticked only at a TERMINAL ledger event.

## Checklist

- [x] lane-A — findings 1+2: LauncherRoot.tsx generation-path breadcrumbs (merged 64e2978)
- [x] lane-B — finding 3: transport/client error-mapping breadcrumbs (merged 09c3e79)
- [x] lane-C — findings 4+5+6: server per-run pipeline logging (merged d466624, 1 revision)

## DONE specs

### lane-A (findings 1+2) — severity med — STRUCTURAL-NO-TEST
Reconciled live at 0ca8675. One local `logGenError(stage, err)` helper near `errorReason()` in
LauncherRoot.tsx logging ctor / GenerationClientError kind/status/hint / message / stack; four
call sites: openPlan catch ('rewrite failed'), onComposeContinue catch non-skip branch
('clarify failed'), onBuildIt catch ('build failed'), and the terminal==null path with
stage/token/diagnostic event counts accumulated count-only in the existing for-await loop
(never reading event.text or diagnostic.kind — screen-state invariant intact). No test:
LauncherRoot is an RN component unreachable from the Node suites (which assert on its source
text only); assurance = suites stay green + reviewer inspection. Allowlist:
`src/host/launcher/LauncherRoot.tsx` only.

### lane-B (finding 3) — severity low — BEHAVIORAL
Reconciled live (all six mapping sites unlogged). Shared `logMappedError(path, baseUrl, kind,
{status?, readyState?, message?})` exported from transport-shared.ts; `httpErrorFrom` gains
(path, baseUrl) params and logs before each return; three network-catch sites in
generation-client.ts (clarify/rewrite/fetch-stream) and finishTransportError in
xhr-transport.ts call it directly; finishHttpError covered via the threaded httpErrorFrom.
Tests: console-spy tests in generation-client.suite.ts (clarify 404 → '[whim:gen]' line with
/v1/clarify, 404, kind=http) and xhr-transport.suite.ts (transport error → kind=network line).
Red-without: no '[whim:gen]' string exists in these files today. Allowlist: the three prod
files + the two suites.

### lane-C (findings 4+5+6) — severity med — BEHAVIORAL
Reconciled live (zero console calls in machine.ts). dev-log.ts gains a `logRun` export keeping
the `[whim-server]` prefix centralized; machine.ts logs at: run start, every stage yield
(stage/status/attempt), model-call failure at the two runModelTurn throw sites (never inside
the token delta loop — decision #58 D5), repair triggers (diagnostic kind counts), all
terminal-outcome sites (unscrubbed reason to stdout only; wire events byte-identical),
summariser catch (bind + log, finding 5), runGenerator top-level catch (bind + log
class/message/stack after the abort guard, finding 6). No DI/logger field on
GenerationPipelineDeps — tests use the established global-console-capture pattern
(server-core.suite.ts:650-719). Tests: extend testModelStreamThrowYieldsOneFailure
(machine.suite.ts) and the throwing-summariser block (wire-v2.suite.ts). Red-without: the
captured-lines assertions fail (machine.ts logs nothing today). Allowlist: machine.ts,
dev-log.ts + the two suites.
