# effects-and-cues — design

## Context

v0.1 proved rendering, v0.2 proved the bridge with storage as syscall #1 (#41). The §15.2
v0.3 rung adds the two remaining ingredients of a "live" mini-app: time (timers) and physical
feedback (vibration, sound). The two are architecturally opposite by design (§5.6's reframe):

- **Timers are userspace.** `delay`/`interval` are wrapped `setTimeout` inside the iframe — no
  bridge, no gate, no manifest entry. The host's only stake is cancellation: nothing a dead
  screen or a torn-down realm scheduled may keep running.
- **Cues are syscalls.** Vibration and sound touch the device — they cross the bridge, are
  manifest-gated, and must land as **registry rows + client stubs only** (#41's review rule:
  zero transport/dispatcher edits, or the §5.6 abstraction has leaked). This change is the
  bridge's first post-storage customer — its append-only readiness test.

Constraints inherited: the five `docs/spike2-findings.md` carry-forwards (notably #2 — the SDK
holds nothing stronger than the one-way transport — and #5 — reset = recreate the iframe);
never widen CSP/sandbox/allowlist (#35/#37); F4 trusted-vantage verification; invariants are
authored by runtime owners, never the implementing session (§16.4). #1's gap analysis budgets
exactly 2 effect + 2 cue exports inside the 42-export surface.

## Goals / Non-Goals

**Goals:**

- `delay` and `interval` in `vc-sdk`, with cleanup the app author cannot forget: unmount
  cancels a screen's intervals, realm teardown cancels everything.
- Haptics (syscall #2) and short audio cues (syscall #3) as one row + one stub each, gated by
  a `cues` capability, with closed token vocabularies.
- The foreground pour-over-timer fixture alive on-device with real cues.
- Bridge Node-suite coverage for the new rows; invariant additions specified here, authored in
  a separate runtime-owner session.

**Non-Goals:**

- Notifications, background execution, schedules (Tier 2 — the pour-over "fires while closed"
  variant stays out).
- Media/volume APIs, music playback, arbitrary sounds or vibration patterns (closed token sets
  only), animation/motion (post-v1 tier).
- Runtime permission prompts (the gate's permission hook stays pass-through; the seam exists).
- Stripping `setTimeout` in the sandbox (see D1 rationale).

## Decisions

### D1 — `interval` is a hook; `delay` is a promise; raw `setTimeout` stays available but untaught

- **`interval(callback, ms, opts?)`** is a React hook (it follows hook rules; the SDK reference
  doc says so explicitly). Auto-cleanup on unmount falls out of the hook contract — there is no
  handle to forget and no cleanup for the agent to omit, which deletes the §5.5 "interval
  without cleanup" lint class *by construction* instead of detecting it. `opts` carries at
  minimum `{ running?: boolean }` so a fixture can pause/resume without tearing the hook down
  (the pour-over needs start/stop).
  - *Alternative rejected:* a handle-returning `interval.start()` requiring `useEffect`
    cleanup — reintroduces the exact leak class §5.5 exists to prevent, and costs the agent a
    pattern it will get wrong.
- **`delay(ms): Promise<void>`** — plain promise for one-shot sequencing inside event handlers
  and effects (`await delay(3000)`). It is deliberately *not* component-scoped: an in-flight
  `delay` across an unmount resolves harmlessly (callers update state via React, which already
  no-ops on unmounted trees in 18+); realm teardown cancels it structurally (D2).
- **Raw `setTimeout` is NOT stripped.** Neutralization is surgical (#35): the strip targets
  *capabilities* (network/storage/threading); `setTimeout` is pure web-resident time and is
  load-bearing for React's scheduler and the syscall marshaller itself. The SDK timers are the
  *taught* path (prompt examples land there, §5.5); flagging raw `setTimeout` in generated
  code is #9's SDK-lint job, not the sandbox's.

### D2 — Realm-teardown cancellation is structural, and an invariant proves it

Reset = recreate the iframe (carry-forward #5; same-realm re-injection is known-poisoned).
Destroying the browsing context destroys its timer queue, so "host can force cancellation"
is already guaranteed by the existing realm lifecycle — **no SDK-level realm registry is
needed, and none is built.** The claim is load-bearing, so it is *proven*, not trusted: an
invariant (runtime-owner authored) shows a gen-1 interval can never tick into gen-2, observed
from the trusted vantage (F4 — never the bundle's self-report).

- *Alternative rejected:* an SDK-side "cancel everything" registry the host pings over a
  control frame — machinery duplicating what iframe recreation already does, and a new
  host→web control surface to maintain for zero added guarantee.

### D3 — One `cues` capability, two methods: `cues.haptic` + `cues.sound`

The manifest unit should be the *user-meaningful permission*, and "this app can buzz/beep" is
one user-meaningful thing. One `cues` capability covers both rows; method names stay
per-effect so a future finer split (when runtime permission prompts become real) is purely
additive on the append-only registry.

- *Alternative rejected:* separate `haptics`/`audio` capabilities — doubles the manifest
  surface the model must get right, for a permission distinction no v1 user is ever shown.

### D4 — Cue vocabularies are closed token sets; the host owns the mapping

Tokens-not-values (§5.3) extended to cues:

- `cues.haptic` params: `{ kind: 'tap' | 'double' | 'heavy' }`.
- `cues.sound` params: `{ name: 'tick' | 'chime' | 'alarm' }`.

The row's params validator rejects anything off-set with the gate's structured
`invalid_params` denial whose hint *lists the valid tokens* (the §8.1 fix-hint shape — the
repair loop can self-correct from the denial alone). The host-side mapping (token → vibration
pattern / tone) is an implementation table the contract never exposes — sound design can
change without touching the contract. Token sets may be tuned for on-device feel during
implementation but only by closed-set substitution, never by opening the type.

### D5 — Cue rows take an injected `CueBackend`; RN APIs never enter `src/host/bridge/`

`bridge/` modules are imported by the Node suites (`bridge:test`, `bridge:invariants`) — an
`import { Vibration } from 'react-native'` inside `rows.ts` would break them. So:

- `CueBackend` interface (pure types, in `bridge/contract.ts`): `{ haptic(kind): void;
  sound(name): void }`.
- `registerCueRows(registry, backend)` in `rows.ts` — handlers are thin bindings onto the
  injected backend, deriving everything from `(params, backend)`; they touch no realm engine.
- `createDefaultRegistry(opts?: { cueBackend?: CueBackend })` registers cue rows **always**
  (gate denials must be testable even with no backend), with a missing backend surfacing as a
  structured `cue_unavailable`-style handler error, never a throw the dispatcher can't shape.
- The RN implementation lives host-side (e.g. `src/host/cue-backend.ts`): `Vibration` from RN
  core for haptics; the D6 audio module for sound. Node suites inject a recording fake.

This is the same dumb-rows discipline storage rows follow (#41 D5) and keeps the readiness
test honest: the diff to `bridge/` is rows + types only.

### D6 — Audio backend: a tiny in-repo Android module wrapping `ToneGenerator`; no external dependency

The roadmap asks for a "minimal dep, decide in design." The minimal dep is **none**: a small
in-repo Kotlin module (TurboModule, ~30 lines) wrapping `android.media.ToneGenerator`, mapping
the three sound tokens to tone constants + durations. Android-only matches v1 scope; arm64
native builds already exist (op-sqlite); no assets to bundle, no third-party maintenance risk
on bridgeless RN 0.85.

- *Alternatives rejected:* `react-native-sound` (old-bridge era; new-arch compat risk —
  retained as the **named fallback** if TurboModule codegen fights back, since D5 means the
  swap never touches the contract); `expo-av`/`expo-audio` (drags expo infra into a bare RN
  app for three beeps).
- Synthesized tones are aesthetically modest; v0.3 needs *a cue*, not sound design (post-v1
  polish, behind the same tokens).
- Haptics: RN core `Vibration` suffices (roadmap's stated preference) — `vibrate(pattern)`
  driven by the host-side token table. `android.permission.VIBRATE` (a normal, install-time
  permission) is added to the Android manifest.

### D7 — Cue syscall semantics: fire-and-forget, at-most-once, nothing observable

Cue stubs return `Promise<void>` (the sysret is `{}` posted as soon as the cue is triggered —
the handler never awaits playback). Completion, duration, and device state are deliberately
unobservable: cues add zero sensing surface. The dispatcher's existing dedup gives
**at-most-once per request id** — a retried frame replays the recorded `{}` outcome and does
*not* re-fire the cue (no double-buzz); same D3 machinery as storage, exercised for a
side-effecting verb. Stale-generation frames drop as today; a cue from a torn-down realm
never fires.

### D8 — Fixture: `fixtures/pour-over-timer.app.tsx`, foreground only

Declares `capabilities: ['cues']`, **no storage** (the brew is ephemeral). Stages
(e.g. bloom 30 s → pour 90 s → drawdown 45 s) driven by a 1 s `interval` countdown; `await
delay(...)` for the 3-2-1 get-ready beat (exercising both effects); `cues.haptic('double')` +
`cues.sound('chime')` at stage transitions, `'heavy'` + `'alarm'` at done. Start/pause/reset
via the hook's `running` opt. The build extracts its manifest as usual (single source of
truth — no hand-maintained record).

### D9 — Verification: two surfaces + runtime-owner invariants

- **TDD (deterministic, `bridge:test`):** new-row gate denials (`undeclared_capability` for a
  manifest without `cues`; `invalid_params` with token-listing hints), backend invocation via
  the recording fake, dedup-no-double-cue, missing-backend structured error, registry
  append-only intact.
- **Test-after (UI):** the fixture, eyeballed via the existing deliver path; desktop Chromium
  first (fast filter), then the authoritative on-device run (§16.4 lesson: the device run is
  the acceptance).
- **Invariants (separate runtime-owner session — specified here, not authored here):**
  (1) gen-1 timers cannot tick into gen-2 after realm teardown, trusted vantage;
  (2) a hostile bundle without `cues` gets a structured denial end-to-end through the real
  sandbox (cap-intruder pattern); suite stays non-vacuous (negative-control discipline).
- **Never-regress:** `npm run invariants` stays 42/42 — this change adds **no runtime part**
  (`src/runtime/web/` untouched; timers live in the SDK inject, cue stubs ride the existing
  marshaller). Any discovered need to touch `src/runtime/web/` or `build/assemble.mjs` is a
  design red flag to surface, not quietly absorb.

## Risks / Trade-offs

- [TurboModule authoring is new to this repo; codegen friction could stall audio] → fallback
  is pre-named (`react-native-sound` behind the same `CueBackend`); D5 guarantees the swap is
  invisible to the contract and suites.
- [`interval`-as-hook violates the `use*` naming convention eslint uses for hook linting] →
  the repo's eslint covers SDK source (written once, by hand); generated code is linted by #9,
  which knows SDK semantics. Accepted for the name the gap budget and spec vocabulary already
  fixed. If hook-rule tooling becomes load-bearing, alias `useInterval` additively.
- [ToneGenerator cues may feel cheap] → accepted for v0.3; tokens insulate later sound design.
- [An in-flight `delay` resolving after unmount could mask logic bugs (state writes that
  silently no-op)] → accepted: harmless at runtime; #10's synthetic run observes thrown
  errors/warnings from the trusted vantage if it ever isn't.
- [Emulator vibration is inaudible/invisible — acceptance can false-pass] → on-device
  acceptance is on real hardware per the roadmap's device policy; the host-core probe can also
  log backend invocations.

## Open Questions

- Exact token sets (D4) may be tuned during implementation for on-device feel — closed-set
  substitution only; the spec scenarios name the *property* (closed set + listing hint), not
  the members.
- Whether `interval`'s `opts` also wants `{ immediate?: boolean }` (fire on mount vs after the
  first period) — decide in implementation from the fixture's needs; additive either way.
