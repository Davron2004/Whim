# Findings: Phase 0 generation-path breadcrumb logging (dev observability)

Context: a stale-server 404 on /v1/clarify surfaced in the app as a bare "Something went wrong"
with zero log output on either side — every error-handling site on the generation path discards
the underlying error before it reaches any log. Phase 0 adds dev breadcrumb logging at those
exact swallow points. Logging only: no wire-contract change, no new event types, no persistence,
no UI change. All six findings verified live at redesign tip 0ca8675 against the archived
2026-08-01-fix-generate-stream-transport change (which fixed the transport itself and added
request-level `[whim-server]` logging, but left all six sites below unlogged — its research
digest is the reconcile evidence).

Standing constraints for every finding:
- Client breadcrumbs use `console.log('[whim:gen]', ...)` — consistent with the existing
  `[whim:page]` / `[whim]` host-side prefixes (useMiniAppHost.ts:170, LauncherRoot.tsx:224).
- Server lines reuse/extend `server/src/dev-log.ts`'s `[whim-server]` prefix convention.
- NEVER log: prompt text, generated source, the x-whim-device header value, or
  OPENROUTER_API_KEY (dev-log.ts doc comment + generation-server spec). Error class/kind,
  message, HTTP status, stage names, attempt counts, timings, and target host:port are fair.
- Log the EXISTING error taxonomy (`GenerationClientError.kind/status/hint`,
  transport-shared.ts:79) rather than re-deriving XHR internals.
- `failure.reason` stays scrubbed on the wire; FailureScreen stays hint-only. The UI-facing
  `errorReason()` discipline (LauncherRoot.tsx:128-131) governs the screen, not the console.

## Finding 1 — LauncherRoot onBuildIt catch swallows the raw generation error
src/host/launcher/LauncherRoot.tsx:395-399: the caught `e` goes to `failure(...)` for the
screen but is never logged. Log constructor name, GenerationClientError kind/status/hint when
present, message, stack when present. Also cover the sibling catches in the same file that end
in `errorReason()`-mapped generic screens (clarify/rewrite/plan flows).

## Finding 2 — silent "stream ended with no terminal event" path
src/host/launcher/LauncherRoot.tsx:374-378: stream ends with no terminal event and no cancel →
GENERIC_STREAM_ERROR screen, nothing logged. Log a breadcrumb including counts of events seen
by type (stage/token/diagnostic) to distinguish "connected then dropped" from "never streamed".

## Finding 3 — transport/client error-mapping sites drop the underlying cause
The sites that construct `GenerationClientError` never log what they classified:
- generation-client.ts:276-281 (fetch-stream catch), :178-180 and :212-214 (clarify/rewrite
  unary catches — the exact "/v1/clarify → 404" case that motivated this batch)
- xhr-transport.ts:189-201 (finishTransportError), :212-230 (finishHttpError)
- transport-shared.ts:113-123 (httpErrorFrom, pre-stream non-2xx classification)
Log at the mapping site: route path (path only, no query/body), target host:port, HTTP status
when any, readyState/underlying message, and the mapped kind.

## Finding 4 — server pipeline has no per-run stage/outcome logging
server/src/generation/machine.ts (651 lines, zero console calls): every stage transition only
`yield`s a wire event. Add per-run stdout lines via/consistent with dev-log.ts: run start, each
stage start/done with attempt number, each model-call failure (provider error class + message,
never the key), repair triggers (diagnostic kind counts), terminal outcome — including the
UNSCRUBBED internal reason on failure (stdout is the developer's; the scrub is a wire rule).

## Finding 5 — summariser failures swallowed silently
server/src/generation/machine.ts:550-552: `catch { return undefined; }` — the error is not
even bound. Log it (error class + message) with the same per-run prefix as Finding 4.

## Finding 6 — top-level runGenerator catch discards every pipeline exception
server/src/generation/machine.ts:273-281: the catch that folds ANY uncaught plan/generate/
repair exception into GENERIC_INTERNAL_ERROR_REASON does not bind or log the error. This is
the single server-side site where a real thrown Error becomes "Something went wrong". Log the
error class, message, and stack before emitting the generic failure.
