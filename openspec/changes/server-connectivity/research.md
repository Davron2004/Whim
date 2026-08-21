# Research digest: what would a server-connectivity check (save-time + startup + session retry) touch?

<!-- Compiled verbatim from the waiting-state census (recon-sweep) and the /v1/clarify 404 investigation (researcher + live verifier), both this cycle. -->

## Current state: the client never checks the server

- **`GET /healthz` exists server-side** (`server/src/app.ts:107`, returns 200 `ok`; NOT gated by the `x-whim-device` header — the gate is `app.use('/v1/*', ...)`, `app.ts:101-126`). **Zero hits for `healthz` anywhere in `src/`** — the client never calls it.
- **`GET /v1/usage`** (`server/src/routes/usage.ts:1-20`, mounted `app.ts:139`) is likewise never called by the client (only a comment reference at `generation-client.ts:311`). Both are dead surface from the device's perspective.
- The server binds `0.0.0.0` (`server/src/main.ts:77`), port from `WHIM_SERVER_PORT` default 8787 (`main.ts:25`).

## Server address handling (the bug class this closes)

- The address is a **user-typed, persisted setting**: `src/host/launcher/server-address.ts`, KV key `whim.server-url:v1`, read via `loadServerUrl(kv)` in `LauncherRoot.tsx:325`. Until set, `clientOptions` is `null` (`LauncherRoot.tsx:330`) and prompt-flow network calls are gated off entirely.
- `SettingsScreen.tsx:73-86` is a free-form TextInput; **no round-trip verification on save**. `sanitizeServerUrl()` trims whitespace and (as of the trailing-slash fix, this cycle) strips trailing slashes on both save and load — but a wrong host, wrong port, missing scheme, or stale server still saves silently and only fails later, deep in the prompt flow (measured this cycle: a trailing slash produced `//v1/clarify` → 404 surfaced as `[whim:gen] transport failed` mid-flow).
- Settings placeholder text is `'http://192.168.1.20:4000'` (`copy.ts:137`) — scheme included; nothing validates a scheme is present. A schemeless address most likely fails as an RN fetch `network` error, unconfirmed.
- Client URL construction: `${opts.baseUrl}/v1/...` (`generation-client.ts:176-199, 204-234, 271-300`); headers via `transport-shared.ts:104-114` (`hostPortOf` strips scheme for redacted logging only).

## Transport + error-classification facts

- RN 0.85 fetch is whatwg-fetch over XHR; no streaming body; no built-in timeout. `generation-client.ts:185-188` classifies thrown fetch errors as `network`-kind failures for clarify; similar classification exists per-wrapper.
- Device-header gate returns **400** (`missing_device_id`/`invalid_device_id`) — never 404 — for `/v1/*`; `/healthz` needs no header, so a healthz probe exercises reachability + address correctness but NOT device-header validity.
- A wrong-but-listening address can 200 on `/healthz` while lacking `/v1/*` (measured this cycle: multiple local listeners — Metro :8081, another node :3000 — can answer). A healthz 200 alone does not prove "this is a current Whim server"; the healthz body is currently the bare string `ok` with no version/identity stamp (`app.ts:107`).

## Lifecycle context for a startup probe

- `LauncherRoot.tsx:353-364`: first-run seeding runs in a `useEffect` before `setReady(true)`; the shell then renders the grid. There is no existing "connectivity" state anywhere in shell state; `clientOptions` (derived from the stored URL) is the natural dependency for a probe effect.
- The app is fully usable offline today for installed apps (grid, open, fork, history are all local/version-store operations); only clarify/rewrite/generate need the server. Nothing in prompt-flow currently distinguishes "server unreachable" from any other failure until a request fails.
- `SettingsScreen` back navigation and save flow were not read in full beyond the URL field; where a "test connection" result would render is a design choice, not a discovered constraint.

## Risks / unknowns

- No existing client-side scheduler/backoff utility was found in `src/host/launcher/` — a session-scoped retry loop is new machinery; RN timers pause behavior when the app is backgrounded (JS timers don't fire while suspended) is a known platform property to design around, not measured here.
- Whether `/healthz` should gain a version/identity stamp (to distinguish "a server" from "the Whim server this app version expects") is a server-side spec question this change may raise; current body is the bare string `ok`.
- The `flow-wait-hygiene` and `launcher-ghost-tiles` changes (same cycle) both touch `LauncherRoot.tsx`; a startup-probe effect adds another writer to shell state — sequencing matters, overlap is real.
