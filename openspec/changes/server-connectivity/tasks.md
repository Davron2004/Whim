# Tasks — server-connectivity

## 1. Server-side healthz identity stamp

- [ ] 1.1 Change `server/src/app.ts`'s `GET /healthz` handler to return `c.json({ ok: true, service: 'whim-server' }, 200)` instead of `c.text('ok', 200)`; keep the route outside `/v1/*` and the device-header gate unchanged.
- [ ] 1.2 Update/extend the server suite's healthz coverage (`npm run server:test`): body shape assertion, still-anonymous (no device header required, still 200) assertion.

## 2. Client probe helper (Node-suite testable, no RN import)

- [ ] 2.1 Create `src/host/launcher/server-probe.ts`: `probeServer(baseUrl, opts?) → Promise<'verified' | 'unverified' | 'unreachable'>` per design.md decisions 1-2 — `GET <baseUrl>/healthz`, `AbortController` + `setTimeout` timeout (default ~4000ms), classify per the healthz body shape.
- [ ] 2.2 Node suite coverage in `launcher:test`: verified (JSON body with service identity), unverified (200 with other/unparseable body), unreachable (non-200, network error, timeout), timeout actually aborts the in-flight request.

## 3. Session connectivity state and retry loop (LauncherRoot)

- [ ] 3.1 Add `connectivity: 'unknown' | 'checking' | 'online' | 'offline'` state to `LauncherRoot.tsx`, plus a `markOnline()` helper (design.md decision 6) that sets `'online'` and cancels any pending scheduled retry; idempotent when already online.
- [ ] 3.2 Add the startup/retry effect keyed on `clientOptions` (design.md decision 4-5): `clientOptions == null` → stays `'unknown'`; on becoming non-null, `'checking'` → probe → `'online'` via `markOnline()` on success (verified or unverified both count), or `'offline'` + scheduled retry (2s doubling to a 30s cap) on `'unreachable'`. Effect cleanup clears the pending timer.
- [ ] 3.3 Wire `markOnline()` into the existing `clarifyPrompt`/`generateApp` call sites (`LauncherRoot.tsx`) so a real successful call stops the retry loop, per design.md decision 6.
- [ ] 3.4 Node suite coverage: backoff schedule values, stop-after-first-success (including via `markOnline()` from a simulated successful call, not just the probe), unknown-vs-offline distinction (no address configured never reaches offline), no scheduled retry after online.

## 4. Settings save-time verification

- [ ] 4.1 `SettingsScreen.tsx`: add local debounced (~600ms, design.md decision 3) probe state (`'idle' | 'checking' | ProbeResult`) driven off the existing `onChangeText`/save path — save behavior itself (immediate, unconditional) stays unchanged; only the probe is debounced and cancels on a new edit.
- [ ] 4.2 Render the inline result under the server-address field: verified/reachable, unreachable, and a distinct unverified-warning treatment, using `copy.ts` strings and the shell palette (no hex literals, matching the screen's existing token-only styling).
- [ ] 4.3 Add the three result strings (and any label) to `copy.ts` following existing tone conventions; product-verbs guard applies.
- [ ] 4.4 Node suite coverage: debounce cancels an in-flight probe on rapid retyping, save persists regardless of probe result, each of the three classifications renders its distinct copy.

## 5. Offline UX surfaces

- [ ] 5.1 `HomeScreen.tsx`: quiet connectivity indicator sourced from `LauncherRoot`'s `connectivity` state — visible only for `'offline'` (not `'unknown'`), does not obscure or gate the grid.
- [ ] 5.2 Prompt-flow entry screen: "server unreachable" notice shown when `connectivity === 'offline'` and an address is configured, distinct from and not overriding the existing "unconfigured" message; notice does not gate submission.
- [ ] 5.3 Copy additions in `copy.ts` for the indicator and the notice.
- [ ] 5.4 Node suite coverage: indicator/notice visibility matrix across the four connectivity states × configured/unconfigured, unconfigured always shows neither offline surface.
