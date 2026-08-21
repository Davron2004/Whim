# Whim demo-video tool

Films a human-paced, watchable `.mp4` of a scripted walkthrough of a Whim mini-app running
inside the actual built runtime (same load path as `invariants/sandbox-isolation/`) — a real
Chromium window, a real animated cursor, real clicks and keystrokes, and caption text overlaid
on top.

## (a) CLI usage

```sh
npm run build                                   # once, so runtime-artifacts.json is fresh
node demo/cli.mjs demo/flows/tip-splitter.demo.mjs
node demo/cli.mjs demo/flows/tip-splitter.demo.mjs --out /tmp/somewhere
node demo/cli.mjs demo/flows/tip-splitter.demo.mjs --tighten   # also writes a dead-air-cut -tight.mp4, see (e)
```

Prints the output path on success (`demo/out/<flow-name>.mp4` by default — the flow file's
basename with a trailing `.demo` stripped). Exits non-zero with the flow's error printed if the
flow throws. If system `ffmpeg` isn't on `PATH`, the tool keeps the raw `.webm` recording and
says so instead of failing.

## (b) Flow-file API

A flow file's default export is `async ({ stage }) => { ... }`. `stage` (from
`demo/lib/stage.mjs`, `createStage()`) is the director:

- `stage.open(bundleName, { showDiagnostics? })` — assemble + load a bundle from the current
  build, wait for it to be ready, and find its sandboxed iframe. Call once, first.
- `stage.click(target)` — animate the cursor to `target`'s center, dwell, show press feedback,
  then perform a real `page.mouse.click`.
- `stage.point(target)` — same animation, no click (for gesturing at a value while narrating).
- `stage.type(target, text)` — click into `target`, select existing text, type `text` with a
  deterministic per-character delay.
- `stage.caption(text)` / `stage.clearCaption()` — a caption bar overlaid at the bottom, fading
  in/out. Non-interactive (`pointer-events: none`), sits above the iframe.
- `stage.pause(ms)` — a plain beat.
- `stage.frame` / `stage.page` — the mini-app's `Frame` and the top-level `Page`, for building
  custom Playwright locators.

`target` (for `click`/`point`/`type`) is a CSS selector (resolved against `stage.frame`), a
Playwright `Locator`, or `(frame) => Locator` for compound queries — e.g. filtering by text:

```js
stage.point((frame) => frame.locator('div').filter({ hasText: 'Per person' }).last().locator('span').last());
```

The CLI calls `stage.finish()` after the flow returns (transcodes to `.mp4`, closes the
browser) and `stage.abort()` if the flow throws (closes the browser, no video).

**Determinism**: every timing value (cursor-move duration, per-character type delay, dwell/
settle pauses) is a pure function of distance / text length / fixed constants in
`demo/lib/stage.mjs` — never `Math.random()` or wall-clock-derived jitter. Re-filming the same
flow against the same build reproduces the same choreography every time.

## (c) Two-pass workflow

**Pass 1 (exploration, not built by this tool)**: an agent drives the real runtime interactively
— open the bundle, look at the rendered DOM, try selectors — and writes down a plain step list:
what to click/type in what order, which selectors work, what to wait for. Nothing is filmed.

**Pass 2 (compilation)**: the agent turns that step list into a flow file under `demo/flows/`
using the API above — narration as `caption()` calls, actions as `click()`/`type()`/`point()`.

The camera only rolls on the compiled flow file, run through `demo/cli.mjs` — never on the
exploration pass. This keeps the recorded video deterministic and reviewable as source: the
flow file *is* the shot list.

## Output & scratch dirs

`demo/out/` (rendered videos) and `demo/.pages/` (assembled HTML scratch) are build output —
gitignored, regenerated on every run.

## (d) Android variant

`demo/android/film.mjs` films the REAL Whim app (the release APK) on a real Android emulator,
instead of a Chromium rendering of one bundle in isolation:

```sh
npm run build && cd android && ./gradlew assembleRelease && cd ..   # once, or pass --rebuild
node demo/android/film.mjs demo/android/flows/tip-splitter.yaml [--out demo/out/] [--rebuild] [--avd <name>] [--tighten]
```

It boots-or-reuses an emulator, installs the APK, `pm clear`s the app for a fresh seeded first
run, runs `adb shell screenrecord` in the background while `maestro test` drives a `.yaml` flow
(Maestro's UI-automation DSL — no Playwright, no `stage.mjs` director API), then pulls and
remuxes the recording to `demo/out/<flow-name>-android.mp4`. Maestro has no first-class
fixed-duration "sleep" command; flows use an `extendedWaitUntil: { visible: <never-appears>,
timeout, optional: true }` idiom for human-paced beats instead.

**WebView-visibility finding**: unlike Playwright/Chromium's cross-origin isolation, Android's
accessibility tree (what `maestro hierarchy` reads) sees straight through the sandboxed
opaque-origin iframe — mini-app text (`"Bill"`, `"Reset"`, computed `$` rows) is visible as
ordinary node `text`, alongside `resource-id: "whim-iframe"`/`"whim-root"`. So the Android flow
targets in-app content with plain text/relative selectors, no coordinate taps needed, no
testIDs added.

## (e) Tightening — cutting dead air (`demo/edit.mjs`)

Both `demo/cli.mjs` and `demo/android/film.mjs` accept an opt-in `--tighten` flag that runs a
dead-air cut over the raw recording once it's written. The raw file is always kept — tighten
never replaces it — and a `-tight` variant is written alongside it; a tighten failure (e.g.
`ffmpeg` missing) is reported but does NOT fail the overall film/record command, since the raw
recording already succeeded by that point.

```sh
node demo/cli.mjs demo/flows/tip-splitter.demo.mjs --tighten
node demo/android/film.mjs demo/android/flows/tip-splitter.yaml --tighten

# standalone, against an already-rendered video:
node demo/edit.mjs demo/out/tip-splitter-android.mp4
node demo/edit.mjs demo/out/tip-splitter-android.mp4 --out /tmp/out.mp4 --min-still 1.0 --keep 0.4 --noise -50dB
```

**What it does**: two ffmpeg passes. Pass 1 runs `freezedetect` (`n=`noise, `d=`min-still) to
find visually-static stretches — mini-app generation waits, Maestro's ~1s inter-action safety
windows, settle pauses. Pass 2 clamps each one down to `--keep` seconds (default **0.6s**) rather
than removing it outright: a demo cut edge-to-edge on hard action boundaries reads as broken, not
snappy — a short held beat after each action lands still reads as an edit, not a glitch. Static
stretches shorter than `--min-still` (default **1.2s**) are left untouched entirely
(freezedetect's own `d` threshold — nothing that short is worth cutting). If freezedetect finds
nothing, the tool prints "already tight" and writes nothing (exit 0) rather than emitting a copy.

**Defaults were tuned against real footage, not guessed**: `demo/out/tip-splitter-android.mp4`
(an 81s Android recording) needed no tuning at freezedetect's own default noise floor (`-60dB`)
combined with `d=1.2` — it found 23 real static stretches (from ~0.6s idle bounces up to a 6.3s
generation wait) and tightened the video to ~24s. Verified by extracting frames at several points
across the tightened output and confirming the mini-app's state (typed values, computed rows,
menu sheets) still appears in the correct order.

**Which end of the freeze survives the clamp**: the FIRST `--keep` seconds, not a centered slice
or the trailing edge. Every frame inside a freeze is visually identical by definition (that's
what "frozen" means to freezedetect), so the only thing that changes between first/last/centered
is the felt rhythm of the cut. Keeping the leading edge reads as "the action lands, we hold on
the result for a beat, then cut" (a natural edit beat); keeping the trailing edge reads as
anticipation for something the mini-app gives no visible tell is about to happen.

**A real-footage gotcha worth knowing if you touch `demo/edit.mjs`**: these screen recordings are
genuinely variable-frame-rate — the encoder doesn't emit a new frame while nothing changes, and
even authors an explicit long *duration* value on the one frame representing a static stretch. A
naive `trim`+`concat` filter graph either collapses the "kept beat" to near-zero (the trim window
can legitimately contain zero real frames) or overshoots by seconds (several ffmpeg
filters/encoders were found to use that inherited duration value for output pacing instead of
recomputing it). `edit.mjs` sidesteps both failure modes by resampling to a constant frame rate
up front and using the classic `select`+`setpts` idiom instead (no `trim`/`concat` at all) — see
the VFR GOTCHA comment at the top of that file for the full story.
