# g04-fixtures handoff

S96: accept-proposed
S127: fixed (structural)
S128: accept-proposed
S129: accept-proposed
S130: fixed (structural; see deviations)
S131: fixed (structural; see deviations)
S132: fixed (structural; see deviations)
S312: fixed (behavioral-capable: rejection now sets the "probe failed" line; the IIFE body already has try/catch so it is unreachable in practice)
S313: accept-proposed
S314: accept-proposed
S315: accept-proposed
S316: accept-proposed
S318: fixed (structural; Heading -> Text size="title")
S319: accept-proposed
S320: fixed (structural)
S321: fixed (structural)

## Accept proposals
S96: runtime floor: `.at()` is unavailable on Chromium 91 / iOS 15.1 WKWebView (docs/sdk-reference.md §1).
S128: see S316.
S129: see S316.
S313: see S316.
S314: see S316.
S315: see S316.
S316: cues are documented fire-and-forget; a rejection already reaches the host through the loader's unhandledrejection listener (src/runtime/web/loader.js:114); a non-rethrowing .catch would hide that report; awaiting would shift tick timing.
S319: the latency probe measures sequential round-trips on purpose.

## Red-check
none: all structural (fixtures are not importable by any Node suite; no test home).

## Commands
- npm run build: 0
- npm run -s typecheck: 0
- npx eslint --max-warnings 0 (3 fixtures): 0
- npm run -s server:test -- --only prompts: 0 (470 passed)
- npm run -s sdk:test: 0

## Deviations
S130-132: text(v, fallback) differs from String(v ?? fb) only for object values, which a `text` schema field never holds; no behavioral test possible (fixtures run only inside the WebView sandbox).

## Revision 1
- HIGH latency-probe.app.tsx:35 (S96): restored `sorted[sorted.length - 1]` (`.at()` is absent on Chromium 91 / iOS 15.1 WKWebView, docs/sdk-reference.md:46). S96 is now accept-proposed (runtime floor).
- LOW reading-list.app.tsx:49: `text()` is now `typeof v === 'string' ? v : fallback`. Identical for every schema value (text fields are string, null or undefined).
- Accept proposal for S128, S129, S313-S316 (corrected reason): a rejection already reaches the host via the loader's `unhandledrejection` listener (src/runtime/web/loader.js:114); any non-rethrowing `.catch` would hide that report; wrapping cues contradicts sdk-reference §8 fire-and-forget; awaiting shifts tick timing.
- Accept proposal S96: runtime floor (Chromium 91 / iOS 15.1 lack Array.prototype.at; esbuild es2019 does not polyfill).
- LOW latency-probe.app.tsx:75: left as is (unreachable, no effect).

## Red-check
none: all structural (fixtures are not importable by any Node suite; no test home).

Commands: npm run -s typecheck: 0; npx eslint --max-warnings 0 (2 fixtures): 0
