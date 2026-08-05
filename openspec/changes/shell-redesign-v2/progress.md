# Progress: shell-redesign-v2

Chain dispatch (`/opsx:apply`) landed chains A–G serially onto the run's staging branch, one
implementer per chain, each self-gated and integrity-checked before merge with a post-merge
regate (`docs/harness.md` §per-chain contract). This record lists the merge commit that closed
each chain on `redesign`, together with the review fix-pass this file also closes.

| Chain | Commit | Outcome |
|---|---|---|
| A — v2 tokens, preset cut, app colour | `053bf3d` | Landed. Replaced the placeholder theme with the fixed v2 token set, cut presets/accents/shapes, added `appColor`. |
| B — Whim Syntax + v2 copy table | `7994aa6` | Landed. Added the shell-side lexer/renderer (`src/host/ui/whim-prose/`) and seeded `copy.ts`. |
| C — contract + server (clarify, summariser, tileColor, envelope) | `d7dfa45` | Landed. `POST /v1/clarify`, the `result.summary` field, `plan` rows, and `tileColor` extraction. |
| D — launcher `2a` flow | `433abe6` | Landed. `compose → clarify → plan → build → done`, the `v2` prompt envelope, the `2a` home. |
| E — launcher `4a` history | `9c1017f` | Landed. The `4a` timeline, row expansion, filter pills, confirm sheets; pin surface removed from the screen. |
| F — tile colour plumbing + `2b` tile | `1b7fc7c` | Landed. `AppManifest.tileColor`, the resolution helper, `AppTile`. |
| G — orb tapped menu, instrumented | `b4bfcbb` | Landed. `Orb.tsx` replaces `FloatingExit`, tap-count instrumentation. |
| H — docs | `5c8ac23` | Landed. Decision #59 recorded; `docs/capabilities.md` scope lines updated. |
| I — on-device verification | — | **Not done.** Genuinely outstanding — I1 is attended-only and requires a physical/emulator run against a dev server; left unticked in `tasks.md`. |

Gate status for A–H above is the chain dispatch loop's own per-chain self-gate plus the
post-merge regate at the time each chain landed (`docs/harness.md`); this fix pass did not
re-run those historical gates and relies on the commit history and current tree state as the
record of them having passed.

## Review verdict

**MERGEABLE-WITH-FIXES.** The reviewer's findings (A–J below) were ruled on by the orchestrator
and applied in this fix pass — two commits on `redesign`:

1. `fix(launcher): apply the shell-redesign-v2 review findings` — the code changes (A–H).
2. `docs(openspec): amend shell-redesign-v2 specs and record progress` — the spec/tasks/progress
   updates (D's kind-badge exemption, I's one-hue-per-sentence wording, this file, `tasks.md`).

| Finding | Outcome |
|---|---|
| A — `ClarifyStep` echo: upright `yours`, not italic quote, not double-marked | Done. Rendered as plain `Text` (not `WhimProse`), sans face, `yours` colour. |
| B — `app-tile.tsx` monogram/name styles had no `fontFamily` (Roboto fallback) | Done. `FONT_FAMILY.sansBold`/`sansSemiBold`/`sansMedium` added. |
| C — `HistoryScreen` expanded body repeated the collapsed headline | Done. Removed; expanded body now starts at "What it touched". |
| D — kind-badge hex literals moved into `design-tokens.ts` as `KIND_BADGE_COLORS`; spec exemption recorded | Done. `sdk-design-system` spec's reserved-hue requirement now names the exemption explicitly. |
| E — `MOTION.orbWheel` deleted (and its test pins); `MOTION.sheetRise` now drives the orb menu's entrance animation | Done. `Orb.tsx`'s menu rises via one `Animated.timing` on `translateY`/`opacity`. |
| F — Orb wiring: "Copy" removed, "Versions" opens real History, "Change it" opens compose prefilled | Done. Threaded `onVersions`/`onChangeIt` through `MiniAppView` from `LauncherRoot`; the orb-local placeholder sheet is gone entirely (both actions now navigate instead of showing a stand-in title), which goes slightly further than the letter of the ruling — see report. |
| G — copy.ts hygiene: ten dead keys deleted (zero callers confirmed); three Orb a11y strings moved into `COPY` | Done. Also removed `orbActionCopy`/`orbVersionsTitle`/`orbChangeTitle`/`orbChangeFooter`/`orbClose`, which finding F's navigation change made dead on top of the ten named keys — flagged as a deviation in the report. |
| H1 — source-scan test for `#4f46e5`/`Space Grotesk` under `src/` | Done, in `theme.suite.ts`. `invariants/` is a sibling of `src/`, not nested inside it, so no exclusion was needed. |
| H2 — behavioural test for `highlighting.ts` against a fake `KVBackend` | Done, in `prompt-flow-wiring.suite.ts` next to the existing highlighting wiring test. |
| H3 — tautological `tile-colour.suite.ts:146` test | Deleted per the ruling's own fallback clause — `prompt-flow-screens.suite.ts`'s skeleton-geometry test already covers the claim. |
| H4 — `theme.acceptance.ts` shell/status hexes pinned literally | Done, values copied from `docs/design/README.md`, not from the code under test. |
| I — one-colour-per-sentence wording amended for same-hue repeats | Done, in `specs/app-launcher/spec.md`; matches `render.ts`'s existing (already-correct) behavior and its existing test coverage in `whim-prose.suite.ts`. |
| J — this record | Done. `tasks.md` A–H ticked, I1 left open; `openspec validate --strict` run clean. |
