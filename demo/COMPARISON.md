# Playwright vs Maestro demo filming — measured comparison (2026-08-12)

Both variants filmed the same Tip Splitter walkthrough. Numbers below are from the
runs that produced the checked-in flows' reference videos.

| | Playwright (`demo/cli.mjs`) | Maestro (`demo/android/film.mjs`) |
|---|---|---|
| Surface | Built web runtime in headless Chromium (`file://`, assembled from `runtime-artifacts.json`) | Real release APK on an Android emulator |
| Warm run wall-clock | ~35s (video length + ~2s) | ~81–92s (video length + ~4s orchestration; plus emulator boot / gradle on cold start) |
| Video | 1280×720 mp4, 32.5s | Device-resolution mp4, ~84s |
| Cursor / captions | Injected overlay: animated cursor, press feedback, caption bar | None — real device look; finger taps are invisible (no touch indicator) |
| Element targeting | CSS/locators against the mini-app frame | Visible text / accessibilityLabel — **including inside the sandboxed iframe** (see below) |
| Determinism | Fully deterministic pacing (no randomness); identical video per run | Deterministic flow, but real-device timing (keyboard, animations) varies slightly per run |
| Text input | `type()` replaces cleanly | `inputText` appends at the cursor; clean replace needs `longPressOn` → "Select all" → `inputText` (`eraseText` leaves a re-rendered "0"; `doubleTapOn` selects nothing in this WebView) |
| What it can film | Mini-app UI only (no launcher — that's RN) | The whole product: launcher grid, prompt flow, Orb, fork sheet, and the mini-app |

## The load-bearing finding

Android's accessibility tree **sees through Whim's sandboxed opaque-origin iframe**:
`maestro hierarchy` exposes the mini-app's labels, fields, and buttons as ordinary
nodes (`whim-iframe`/`whim-root` resource-ids), so Maestro targets in-mini-app UI by
visible text — no coordinate taps, no testIDs (none exist in `src/`). Containment
(opaque origin, CSP) governs *script* access; accessibility export is a separate OS
channel, the same one a screen reader uses. Playwright sees the opposite boundary:
it has full script/DOM access in Chromium but no launcher at all.

## When to use which

- **Feature-proof videos in the agent loop, CI, retakes, polish** → Playwright.
  Fast, deterministic, cursor + captions, runs anywhere Chromium runs.
- **Product demos of Whim itself** (launcher, conversation flow, fork, Orb) → Maestro.
  Only it films the real app; budget the emulator + APK cold start.
- Pacing philosophy differs: Playwright *simulates* human pacing; Maestro is paced by
  the real device. Don't add artificial cursor overlays to device video — a visible
  touch indicator, if ever wanted, should come from Android's "Show taps" developer
  setting, not fakery.

Both share the two-pass workflow in `README.md`: explore off-camera, compile a flow,
film only the deterministic replay.
