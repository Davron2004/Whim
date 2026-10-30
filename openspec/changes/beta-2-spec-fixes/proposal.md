## Why

The PO's 2026-10-30 rulings and four open issues change behaviour that live specs describe: the Making page's stall line and the transport's first-byte window (#222, #188), where a needs-newer-Whim ending lands (ruling 7, #191), the Whim sheet's See why row (ruling 4), the name of a rewind continuation's tile (ruling 1), the synthetic-run sweep's treatment of a Modal that closes late (#185), and what `npm run android:release` installs on (#221). Each needs a requirement written or changed before testers get a build; the code fixes are small once the rules are written.

## What Changes

- Keepalives are liveness, not progress: the server writes a frame as a stream opens, no slow step on a live connection ends an attempt as a lost connection, and only real stream events reset the Making page's stall clock (and so the Home tile's stuck light).
- An `update` fallback during a run ends on the Failure page in its needs-a-newer-Whim kind, not on the separate update screen; a Home tile shows Needs update only while the running Whim is still below the level its record names, and opens the Failure page.
- The Whim sheet gains a "See why" row for a failed change, after its toast has expired.
- The spec names the "Copy" tile label for copies and rewind continuations.
- The synthetic-run sweep waits for a dismissed Modal to leave (bounded, counted) before booking what it covered as blocked.
- `npm run android:release` installs on exactly one named device and refuses without one (HUMAN-BOOTSTRAP for the `package.json` line).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `prompt-flow`: MODIFIED stall heartbeat (progress events only) and fallback handling (`update` lands on the Failure page during a run); ADDED slow-step-on-live-connection rule.
- `generation-contract`: MODIFIED forward-compatibility envelope (the `update` fallback's landing).
- `generation-server`: ADDED opening frame on the generation stream.
- `app-launcher`: ADDED needs-update tile follows the running Whim; ADDED See why row in the Whim sheet; ADDED Copy label for copies and continuations.
- `synthetic-run`: MODIFIED the sweep's reach rule (late Modal close).
- `native-release-config`: MODIFIED the offline build type's install rule.

## Impact

- Code: `server/src/sse.ts`; `src/host/launcher/{prompt-flow,LauncherRoot,making-progress,home-live,grid-composition,WhimSheet}.ts(x)`, transport tests; `synthrun/sweep.ts`; new `scripts/android-release.mjs` and a release check; `package.json` (one script line, human); `CLAUDE.md`, `README.md`, `docs/release/mobile.md`, `docs/design/system.md`.
- No wire-shape change: the opening frame is a comment, which every shipped parser already skips. No protocol-level bump.
- Orchestrator note: the unarchived design-system-v1 delta (`specs/prompt-flow/spec.md:104`, "stuck after 40 s with no frame") must read "no progress event" before that change is archived.
