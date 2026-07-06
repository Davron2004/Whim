# effects-and-cues — tasks

*Order matters: English test specs (§16.5) come first; bridge work is TDD (§16.2); the
fixture/UI is test-after; invariant authoring (tasks 7.x) happens in a SEPARATE runtime-owner
session, never this one (§16.4). `src/runtime/generated/*` and `build/generated/*` are build
outputs — regenerate via `npm run build`, never hand-edit.*

## 1. English test specs (before any implementation — §16.5)

- [x] 1.1 Write the English test spec for the bridge surface: every `bridge:test` assertion
      tasks 3.x will implement — gate denials (`undeclared_capability` without `cues`;
      `invalid_params` with token-listing hint), recording-fake backend invocation,
      dedup-no-double-cue, missing-backend structured error, registry append-only intact.
      → `test-spec.md` §1 (G1–G9).
- [x] 1.2 Write the English test spec for SDK effects: unmount cancels `interval`; paused
      interval doesn't tick; `delay` sequences; zero syscall frames from timer use.
      → `test-spec.md` §2 (E1–E4).
- [x] 1.3 Write the English acceptance spec for the pour-over fixture on-device (stage cue +
      finish alarm + containment green), and the English statements of the two invariants
      (gen-1 timers dead in gen-2; hostile cue denial end-to-end) to hand to the
      runtime-owner session. → `test-spec.md` §3 (3a + INV-TIMER / INV-CUEGATE).

## 2. Bridge contract types (design D3/D4/D5)

- [x] 2.1 Add `CueBackend` interface + the closed cue token types (haptic kinds, sound names)
      to `src/host/bridge/contract.ts` — pure types, no RN import.
      → `HAPTIC_KINDS`/`SOUND_NAMES` const arrays (single source for validators + hints) +
      `HapticKind`/`SoundName`/`CueBackend`.

## 3. Cue rows, TDD against the Node suite (design D5/D7)

- [x] 3.1 Extend `src/host/bridge/test/acceptance.ts` with the task-1.1 assertions against a
      recording fake `CueBackend` (red first). → §G1–G8 (G9 is the review/diff rule).
- [x] 3.2 Implement `registerCueRows(registry, backend)` in `src/host/bridge/rows.ts`:
      `cues.haptic` + `cues.sound`, params validators rejecting off-set tokens with hints
      listing the valid set, handlers as thin backend bindings; missing backend → structured
      handler error.
- [x] 3.3 Extend `createDefaultRegistry` (bridge `index.ts`) with `opts.cueBackend`; rows
      register unconditionally so denials are testable backend-less. `npm run bridge:test`
      green (91 checks); diff touches only contract/index/rows (+test) — dispatcher, gate,
      registry, launch UNTOUCHED (#41 review rule holds).

## 4. SDK effects + cue stubs (design D1/D7; budget: 2+2 exports per #1)

- [x] 4.1 Implement `delay(ms)` and the `interval(callback, ms, opts)` hook in `src/sdk/` —
      web-resident, auto-cleanup on unmount, `running` opt for pause/resume; nothing stronger
      than the existing transport reachable from either. (Scoped `react-hooks/rules-of-hooks`
      disable on `interval` keeps the spec-fixed name lint-clean — design D1.)
- [x] 4.2 Implement the `haptic(kind)` / `sound(name)` stubs riding `__whimSyscall` (typed
      against the task-2.1 tokens), returning fire-and-forget promises. → `cues.haptic` /
      `cues.sound` (a `cues` facade mirroring `storage`, per design D8's call syntax).
- [x] 4.3 Quick fixture-level check of task 1.2's spec in desktop Chromium (timers tick, no
      syscall frames) — the fast filter, not the acceptance. → `effects-desktop-check.mjs`,
      all E1–E4 hold (ticks=8/200ms, delay≈121ms, unmount/pause cancel, 0 syscall frames).

## 5. Host-side cue backend (design D5/D6)

- [x] 5.1 Implement the RN `CueBackend` (`src/host/cue-backend.ts`): haptics via RN core
      `Vibration` + the host-side token→pattern table. (tsc + eslint clean; RN-free bridge
      preserved — cue-backend imported only host-side.)
- [x] 5.2 Implement the audio half: tiny in-repo Kotlin TurboModule wrapping
      `android.media.ToneGenerator`, token→tone table host-side. → `src/native/NativeWhimTone.ts`
      (codegen spec) + `com/whim/tone/WhimToneModule.kt` + `WhimTonePackage.kt` + `codegenConfig`
      in package.json + MainApplication registration. **Kotlin compiles only under the gradle
      build (task 8.1); codegen-friction fallback (`react-native-sound`) stays pre-named, swap
      invisible to the contract (D5).**
- [x] 5.3 Add `android.permission.VIBRATE` to the Android manifest; wire the backend into
      `WebViewHost`'s `createDefaultRegistry` call. → `createDefaultRegistry({ cueBackend:
      createCueBackend() })`.

## 6. Fixture + build (design D8)

- [x] 6.1 Write `fixtures/pour-over-timer.app.tsx`: staged brew on `interval` countdown,
      `delay` for the get-ready beat, haptic+sound at transitions, alarm at done,
      start/pause/reset, `capabilities: ['cues']`, no storage. (Wired into `build.mjs` APPS +
      deliverable bundles + `WebViewHost` DELIVERABLE.)
- [x] 6.2 `npm run build` (manifest extracted: `pour-over-timer → capabilities=[cues]`); verify
      `src/runtime/web/` needed no edits — confirmed UNTOUCHED (`assemble.mjs` too) → no D9 red
      flag. `npm run invariants` green (7 isolation checks + non-vacuous negative control; the
      design's "42/42" is the on-device probe fraction, checked in 8.1, not this desktop count).
      `npm run lint`: no new errors (37 pre-existing, all in untouched `src/runtime/web/`); my
      shipping files lint clean.

## 7. Invariant additions — SEPARATE runtime-owner session (§16.4; specified in design D9)

> ⏸ DEFERRED to a SEPARATE runtime-owner session (§16.4 — this feature-implementing session must
> NOT author invariants). The English statements are handed off in `test-spec.md §3b`
> (INV-TIMER, INV-CUEGATE). Left intentionally unchecked.

- [ ] 7.1 (runtime-owner) Author the timer-teardown invariant: gen-1 `interval` marks ticks
      observably; after realm reset + gen-2 delivery, trusted vantage shows zero gen-1 ticks.
- [ ] 7.2 (runtime-owner) Author the cue-gating invariant in the `bridge:invariants` hostile-
      bundle suite: undeclared cue syscalls denied end-to-end, forged sysret inert, zero fake-
      backend invocations; keep the suite's negative control non-vacuous.

## 8. On-device acceptance (the real verdict — CLAUDE.md build env)

- [x] 8.1 Offline release build on device/emulator: pour-over fixture through the normal
      deliver path — stages tick, cues fire (real hardware for the felt check; emulator run
      logs backend invocations), containment verdict green, system back/relaunch sane.
      → EMULATOR (Pixel_9_Pro_XL arm64, offline release): codegen+Kotlin compiled, APK
      installed, pour-over delivered; `interval` ticked 1 Hz through Bloom; get-ready +
      stage-transition cues fired (`syscalls: 8 · last: cues.sound → ok`, no native errors);
      pause froze the countdown; **CONTAINED 42/42 throughout**; back didn't crash. *Felt*
      buzz/tone on REAL HARDWARE remains the user's check (emulator can't show the sensation —
      design device policy).
- [x] 8.2 Capture round-trip + cue-latency observations (the marshaller timeout note feeds
      future D8 tuning) in DEVLOG. → DEVLOG v0.3 lesson 5 (cue round-trip = the same
      transport-bound ~16–17 ms hop; fire-and-forget makes latency uncritical; 10 s timeout
      left as-is pending real-hardware numbers).

## 9. Close out

- [x] 9.1 Update `docs/decisions.md` with the v0.3 entry (what shipped, deviations) and
      DEVLOG lessons; update the `docs/v1-roadmap.md` ledger Status + contract notes for #2.
      → decisions #43, DEVLOG "v0.3 — effects-and-cues" (5 lessons), roadmap #2 Status +
      Contract notes.
- [x] 9.2 Confirm export count still matches #1's budget (2 effects + 2 cues within ~42) and
      that no CSP/sandbox/allowlist line changed anywhere in the diff. → SDK has **14** runtime
      value exports (added `delay`, `interval`, `cues` = 2 effects + 2 cues); `git diff` shows
      NO CSP / sandbox-attribute / module-allowlist line changed; `src/runtime/web/` +
      `build/assemble.mjs` untouched.
