# effects-and-cues (v0.3)

## Why

The §15.2 ladder's v0.3 rung: mini-apps can render (v0.1) and persist (v0.2), but they cannot
yet *do anything over time* — no countdowns, no stage timers — and they cannot produce a
physical cue (vibration, beep). The pour-over timer, the canonical "logic is Tier 0 but the cue
is gated" app (spec §15.3), is inexpressible. This change is also the bridge's **append-only
readiness test** (decision #41): haptics must land as one registry row + one client stub with
zero transport/dispatcher edits, or the §5.6 abstraction has leaked.

## What Changes

- **`delay` / `interval` in `vc-sdk`** — web-resident wrapped timers (spec §5.5/§5.6: no
  bridge crossing; timers are userspace). Both are scoped so cleanup is automatic: unmount
  cancels a screen's timers, and a host-forced realm reset cancels everything (iframe
  recreation — constraint #5 — plus an SDK-level cancellation registry so nothing relies on
  engine GC timing).
- **Haptics as syscall #2** — `cues.haptic` registry row bound to RN core `Vibration` (no new
  native dependency), plus its typed `vc-sdk` stub. Closed token vocabulary, not raw patterns.
- **Short audio cues as syscall #3** — `cues.sound` registry row + typed stub; the audio
  backend is a minimal dependency chosen in design (the row/stub contract is identical
  regardless of backend — §5.6 swappability). Closed token vocabulary.
- **Foreground pour-over-timer fixture** (`fixtures/pour-over-timer.app.tsx`) — brew stages on
  `interval`/`delay`, haptic + sound at stage transitions, `capabilities: ['cues']`, no storage.
- **Invariant additions** (authored in a **separate runtime-owner session**, never by the
  implementing session — §16.4): timers die on realm teardown; cue syscalls are manifest-gated.
- Bridge Node-suite (`bridge:test`) additions for the new rows: gate denial for undeclared
  `cues`, params validation, dedup semantics (a deduped retry must not re-fire a cue).

Explicitly **not** changing: transport, dispatcher, gate, CSP, sandbox attributes, module
allowlist (locked #35/#37). No notifications/background execution (Tier 2), no media/volume
APIs, no animation (post-v1 tier).

## Capabilities

### New Capabilities

- `mini-app-effects`: web-resident timed effects (`delay`, `interval`) — scoping/cleanup
  lifecycle (unmount + realm teardown), no bridge crossing, the agent-facing timer contract.
- `mini-app-cues`: gated physical cues (haptic, short sound) as syscalls #2/#3 — closed token
  vocabularies, manifest gating, fire-and-forget semantics, at-most-once delivery per request id.

### Modified Capabilities

*(none — the capability-bridge spec already requires "a second capability is one row and one
stub"; this change fulfills that requirement rather than altering it. If implementation finds
a single dispatcher/transport line needs editing, that is a finding to surface, not a delta
to write.)*

## Impact

- **`src/sdk/`** — new exports: `delay`, `interval` (effects), `haptic`, `sound` (cue stubs
  riding the existing `__whimSyscall` transport; nothing stronger than the one-way
  `parent.postMessage` — carry-forward constraint #2). Stays within #1's 42-export budget
  (2 effects + 2 cues, already counted).
- **`src/host/bridge/rows.ts`** — two appended rows (`cues.haptic`, `cues.sound`). No other
  bridge file changes (the review rule).
- **`src/host/`** — RN-side cue handlers: `Vibration` (core) + the chosen minimal audio dep;
  `android.permission.VIBRATE` added to the Android manifest.
- **`fixtures/`** — `pour-over-timer.app.tsx`; regenerated `build/generated/*` +
  `src/runtime/generated/*` via `npm run build` (never hand-edited).
- **`src/runtime/web/`** — expected **untouched** (timers live in the SDK inject; cue stubs ride
  the existing marshaller). Any needed runtime-part change is a design red flag to surface.
- **`invariants/sandbox-isolation/`** — additions land in a separate runtime-owner session;
  the existing 42/42 must stay green throughout.
- **Suites:** `bridge:test`, `bridge:invariants`, `invariants`, `lint` all blocking-green;
  on-device acceptance = pour-over fixture with real cues (§15.2 "pour-over timer comes alive").
