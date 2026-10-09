## Context

The server address is a free-form `TextInput` that saves on every keystroke
(`SettingsScreen.tsx`'s `onChangeText` calls `onServerUrlChange` directly, which calls
`saveServerUrl(kv, url)` unconditionally — `LauncherRoot.tsx:407-410`) with no round-trip check
(research.md "Server address handling"). `clientOptions` is the single derived value gating
every network call in the shell (`LauncherRoot.tsx:329-331`); it is `null` until a URL is
configured. There is no connectivity state anywhere in shell state today (research.md "Lifecycle
context for a startup probe"). `/healthz` sits outside the `/v1/*` device-header gate
(`server/src/app.ts:107`, `app.ts` route comment) and returns the bare string `ok`; multiple
unrelated local listeners were measured to 200 on `/healthz` this cycle, so a bare 200 does not
prove the address points at a Whim server (research.md "Lifecycle context").

This change lands after `launcher-ghost-tiles`, which also edits `LauncherRoot.tsx`'s shell
state (pending-build records, generation lifecycle handlers) — sequencing avoids two
independently-planned changes racing on the same file.

## Goals / Non-Goals

**Goals:**
- A saved server address is checked against a real Whim server, not just "something answered."
- A misconfigured or currently-down server is discoverable at Settings save time and at launch,
  without ever blocking use of installed apps or blocking the save itself.
- Exactly one retry loop per session, cheap and self-terminating: capped exponential backoff
  until the first success, then silence for the rest of the process lifetime.
- A real generation success (not just the dedicated probe) counts as proof of connectivity, so
  the retry loop doesn't keep polling in the background of a session that's already working.

**Non-Goals:**
- Consuming `/v1/usage`.
- Queueing generation requests made while offline for later replay.
- Any background/push-triggered connectivity check — the loop only runs while the JS runtime is
  foregrounded, by construction (RN timers don't fire while suspended).
- Periodic re-checking after the first success of a session.
- URL scheme/format validation beyond the existing `sanitizeServerUrl` trim/deslash.

## Decisions

1. **Healthz identity stamp is the verification primitive.** `GET /healthz` returns
   `{ ok: true, service: 'whim-server' }` (200, JSON) instead of the bare string `ok`
   (`server/src/app.ts`). The client's probe treats a 200 response whose body parses and carries
   `service === 'whim-server'` as **verified**; a 200 with any other/unparseable body as
   **reachable-but-unverified** (something answered, but it isn't provably this server); a
   non-200, network error, or timeout as **unreachable**. The route stays outside the `/v1/*`
   prefix and the device-header gate — unchanged from today, and still probeable by a bare
   `curl`/browser per the existing route comment's contract.

2. **One probe helper, two callers.** A single function,
   `probeServer(baseUrl: string, opts?: { timeoutMs?: number }): Promise<ProbeResult>` where
   `type ProbeResult = 'verified' | 'unverified' | 'unreachable'`, lives beside `server-address.ts`
   (new file `server-probe.ts`, same layer, no RN import — Node-suite testable per this repo's
   pure-logic-in-non-RN-siblings convention). It issues `GET ${baseUrl}/healthz`, aborts via
   `AbortController` + `setTimeout` at `timeoutMs` (default 4000ms per the decided ~4s save-time
   budget), and classifies the response per Decision 1. Both the Settings save-time check and the
   startup/retry probe call this same function — no duplicated request-building or
   response-classification logic.

3. **Save-time verification is debounced, not per-keystroke.** `SettingsScreen`'s `TextInput`
   already saves on every `onChangeText` (`LauncherRoot.tsx:407-410`); probing on every keystroke
   would fire a probe per character typed. The save path is unchanged (still saves immediately,
   still allows an unreachable address), but the *probe* is debounced ~600ms after the last
   keystroke, cancelling any in-flight probe when a new edit arrives. `SettingsScreen` owns this
   local debounce/probe-state (`'idle' | 'checking' | ProbeResult`) since it's presentational and
   scoped to the screen's own lifetime; it calls the shared `probeServer` helper directly rather
   than routing through shell state (the result never needs to outlive the screen). The inline
   result renders under the server-address field, replacing nothing else in the existing layout.

4. **Session connectivity state lives in `LauncherRoot`, keyed off `clientOptions`.** New state:
   `connectivity: 'unknown' | 'checking' | 'online' | 'offline'`. A `useEffect` keyed on
   `clientOptions` (mirroring the existing `serverUrl`-keyed dev-log-sink effect at
   `LauncherRoot.tsx:349-351`) drives it: `clientOptions == null` → stays `'unknown'` (nothing
   configured, nothing to check — distinct from `'offline'`, which means "configured but not
   reachable"); once configured, the effect starts the retry loop described in Decision 5.

5. **Retry loop: capped exponential backoff, stop after first success, foreground-only by
   construction.** On mount (or whenever `clientOptions` newly becomes non-null), set
   `'checking'`, call `probeServer`. `'verified'` or `'unverified'` both count as *reachable* for
   this state machine (Decision 1's distinction is Settings-screen informational text only —
   startup/retry treats any 200 as success, matching the proposal's "reachable-but-unverified ...
   startup treats it as success" instruction) → set `'online'`, stop scheduling further probes for
   the session. `'unreachable'` → set `'offline'`, schedule the next attempt at
   `min(2000 * 2^attempt, 30000)` ms (2s, 4s, 8s, 16s, 30s, 30s, ...) via `setTimeout`, incrementing
   `attempt`. The effect's cleanup clears the pending timer, so unmount/`clientOptions` change
   cancels a stale schedule. No explicit "app backgrounded" handling is added: RN JS timers do not
   fire while the app is suspended, so a scheduled retry simply resumes counting down on
   foreground — the proposal's stated foreground-only behavior falls out of the platform, not new
   code.

6. **Any successful server response stops the loop, not just the dedicated probe.** The
   generation-client call sites already funnel through `clarifyPrompt`/`generateApp`
   (`LauncherRoot.tsx:482`, `525`) — each is wrapped so that any call which completes without a
   transport-classified failure invokes the same "mark online, cancel pending retry" transition
   the probe uses. This is a thin success hook (`markOnline()`), not a second connectivity
   subsystem: the retry effect and the generation call sites both call into it, and it is
   idempotent (calling it once the state is already `'online'` is a no-op).

7. **Placement: indicator on `app-launcher`, notice on `prompt-flow`.** The connectivity
   indicator (`HomeScreen`) is a launcher-surface concern — it's part of the home screen's chrome,
   alongside the existing grid — so its requirement lives in `app-launcher`'s spec, matching how
   that spec already owns other home-screen chrome requirements ("honest layout with few apps",
   status-bar inset). The "server unreachable" notice on the compose entry point is a prompt-flow
   concern — it's conditioning the same entry point that already has an "unconfigured address"
   requirement in `prompt-flow`'s spec ("The Settings screen persists a server address for the
   prompt flow" — the unconfigured-address scenario already lives there), so the offline variant
   of that same messaging surface is added as a sibling requirement in `prompt-flow`, not
   `app-launcher`. Generation stays permitted while offline (per the proposal) — the notice is
   advisory text, not a gate; existing gating stays keyed on `clientOptions != null`
   ("configured or not"), unchanged.

## Risks / Trade-offs

- [A currently-unreachable-but-configured server look identical to an offline device from the
  client's perspective] → out of scope by the proposal's own framing; the UX text says "server
  unreachable," not "you are offline," which stays honest either way.
- [Debounced save-time probing (Decision 3) means the inline result can lag the save by ~600ms]
  → the save itself is synchronous and unconditional (unchanged), so nothing about *persistence*
  is delayed — only the informational probe result renders slightly after.
- [`markOnline()` as a cross-cutting hook into every generation-client call site (Decision 6)
  risks becoming diffuse] → scoped to exactly the two call sites `LauncherRoot.tsx` already owns
  (`clarifyPrompt`, `generateApp`); no new call sites are introduced by this change.
- [Sequencing after `launcher-ghost-tiles` risks a stale plan if that change's `LauncherRoot.tsx`
  shape shifts before this one lands] → accepted per the proposal's explicit dependency; this
  design's `LauncherRoot.tsx` decisions (4-6) name only pre-existing anchors (`clientOptions`,
  the `serverUrl`-keyed effect, `clarifyPrompt`/`generateApp` call sites), not ghost-tile state,
  minimizing overlap.

## Open Questions

- None blocking. Exact indicator glyph/copy and notice copy are implementation-time choices
  within `copy.ts`'s existing tone conventions and the product-verbs guard.
