## Why

Today a wrong, stale, or unreachable server address fails silently: `sanitizeServerUrl` accepts
anything non-blank, `SettingsScreen` never round-trips the value against the server, and the
first the user hears about it is a raw transport failure deep inside the prompt flow
(research.md "Server address handling" — measured this cycle: a trailing slash produced a 404
`[whim:gen] transport failed` mid-generation). The launcher also has no notion of connectivity
at all: no probe at startup, no visible state on the home screen, no distinction between "the
Whim server" and "some other listener that happens to answer on that host:port" (research.md
"Current state" — `/healthz` returns the bare string `ok` and is never called by the client;
multiple local listeners were measured to 200 on `/healthz` this cycle).

## What Changes

- **Save-time verification**: saving a server address in Settings immediately probes
  `GET <url>/healthz` with a short timeout and shows the result inline (reachable / unreachable /
  reachable-but-unverified). Saving an unreachable or unverified address stays allowed —
  pre-configuration is legitimate — the probe result is informative, not blocking.
- **Startup probe + session retry**: when a URL is configured, the shell probes `/healthz` at
  launch. On failure it retries perpetually with capped exponential backoff (~2s doubling to a
  30s cap) until the first success of the session, then stops re-checking for the remainder of
  the process lifetime. Any successful server response — the probe itself, or a real
  clarify/rewrite/generate call — counts as that first success. The loop is foreground-only: RN
  JS timers don't fire while suspended, so it naturally pauses in the background and resumes on
  foreground with no extra scheduling.
- **Offline UX**: a new session-scoped connectivity state (`'unknown' | 'checking' | 'online' |
  'offline'`) drives a quiet home-screen indicator and a "server unreachable" notice on the
  compose flow's entry point. Installed apps stay fully usable offline (they're local);
  generation attempts remain permitted while offline (a success flips the state and stops the
  retry loop).
- **Server-side identity stamp** (**BREAKING** for any client parsing `/healthz`'s body as plain
  text): `GET /healthz` returns a small JSON body identifying the service
  (`{ ok: true, service: 'whim-server' }`) instead of the bare string `ok`, so the client can
  distinguish "the Whim server" from "some other listener that answers 200 on `/healthz`". The
  route stays outside the `/v1/*` device-header gate — it must remain probeable by browsers and
  `curl` with no header.

Non-goals: consuming `/v1/usage`; offline queueing of generation requests; background/push
connectivity; periodic health polling after the first success of a session; URL scheme
validation or linting beyond what `sanitizeServerUrl` already does.

## Capabilities

### New Capabilities
- `server-connectivity`: the healthz probe lifecycle (save-time verification, startup probe),
  session retry semantics (capped exponential backoff, stop-after-first-success, real-call-counts
  -as-success, foreground-only), and the offline UX states (home indicator, compose notice,
  generation stays permitted).

### Modified Capabilities
- `generation-server`: `GET /healthz` returns a JSON identity body instead of the bare string
  `ok`; still ungated by the device header.
- `app-launcher`: the home screen gains a quiet connectivity indicator sourced from the new
  session connectivity state.
- `prompt-flow`: the compose entry point surfaces a "server unreachable" notice when the session
  connectivity state is `offline`, without blocking a generation attempt.

## Impact

- `server/src/app.ts` — `/healthz` handler's response body.
- `src/host/launcher/`: `server-address.ts` (probe helper), `SettingsScreen.tsx` (inline
  save-time result), `LauncherRoot.tsx` (session connectivity state, startup probe effect,
  retry loop, success hook-in from real calls), `HomeScreen.tsx` (indicator), the prompt-flow
  entry screen (offline notice), `copy.ts` (new strings).
- Tests: `server:test` (healthz body), `launcher:test` (probe helper, backoff schedule,
  stop-after-first-success, offline-state derivation).
- Sequenced after `launcher-ghost-tiles` — both change `LauncherRoot.tsx`'s shell state; this
  change lands on top of its ghost-tile state additions rather than in parallel with them.
