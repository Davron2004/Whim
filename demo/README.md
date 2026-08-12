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
